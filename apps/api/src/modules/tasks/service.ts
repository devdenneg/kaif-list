import {
  ActivityType,
  ColumnKey,
  NotificationType,
  ParticipantRole,
  SOCKET_EVENTS,
  ranksBetween,
  assigneeChangeRequiresReason,
  docFromText,
  dueDateChangeRequiresReason,
  extractMentionIds,
  isValidReason,
  rooms,
  type CreateTaskInput,
  type TaskCardDto,
  type TaskDetailDto,
  type TaskFiltersInput,
  type UpdateTaskInput,
} from '@kaif/shared';
import { Prisma } from '@prisma/client';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError, NotFoundError, ReasonRequiredError } from '../../lib/errors.js';
import { sanitizePlainText, sanitizeRichText } from '../../lib/sanitize.js';
import {
  attachmentSelect,
  checklistSelect,
  mapAttachment,
  mapChecklist,
  mapParticipants,
  mapTaskCard,
  mapTaskLink,
  participantSelect,
  taskCardSelect,
  taskLinkSelect,
} from '../../lib/mappers.js';
import {
  assertCan,
  assertCanTask,
  checkTask,
  loadTaskContext,
  type BoardContext,
  type RequestUser,
  type TaskContext,
} from '../../lib/rbac.js';
import { recordActivity } from '../../services/activity.js';
import { dispatchNotification, taskRecipients } from '../../services/notify.js';
import { ensureContributor, syncCoreParticipants } from '../../services/participants.js';
import { publishRealtime } from '../../realtime/bridge.js';
import { computeRank } from './rank.js';

/** Поля, которые участвуют в полнотекстовом поиске. */
function buildSearchText(key: string, title: string, descriptionText: string): string {
  return `${key} ${title} ${descriptionText}`.toLowerCase().slice(0, 8000);
}

// ─────────────────────────────── Создание задачи ────────────────────────────

export async function createTask(
  user: RequestUser,
  context: BoardContext,
  input: CreateTaskInput,
): Promise<TaskDetailDto> {
  assertCan(user, context, input.isBacklog ? 'backlog.manage' : 'task.create');

  const title = sanitizePlainText(input.title, 200);
  const { doc, text } = sanitizeRichText(input.description ?? null);

  await assertBoardMembers(context.board.id, [input.assigneeId, input.testerId]);
  const labelIds = await filterBoardLabels(context.board.id, input.labelIds);

  const created = await prisma.$transaction(async (tx) => {
    const board = await tx.board.update({
      where: { id: context.board.id },
      data: { taskCounter: { increment: 1 } },
      select: { key: true, taskCounter: true },
    });
    const number = board.taskCounter;
    const key = `${board.key}-${number}`;

    const columnKey = input.isBacklog ? ColumnKey.TODO : input.columnKey;
    const rank = await computeRank(tx, {
      boardId: context.board.id,
      columnKey,
      isBacklog: input.isBacklog,
      beforeTaskId: input.beforeTaskId ?? null,
    });

    const task = await tx.task.create({
      data: {
        boardId: context.board.id,
        number,
        key,
        title,
        descriptionJson: doc ? (doc as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        descriptionText: text,
        searchText: buildSearchText(key, title, text),
        type: input.type,
        priority: input.priority,
        columnKey,
        rank,
        isBacklog: input.isBacklog,
        reporterId: user.id,
        assigneeId: input.assigneeId ?? null,
        testerId: input.testerId ?? null,
        storyPoints: input.storyPoints ?? null,
        estimateMinutes: input.estimateMinutes ?? null,
        startDate: input.startDate ?? null,
        dueDate: input.dueDate ?? null,
        completedAt: columnKey === ColumnKey.DONE ? new Date() : null,
        ...(labelIds.length > 0
          ? { labels: { create: labelIds.map((labelId) => ({ labelId })) } }
          : {}),
      },
      select: { id: true, key: true },
    });

    await syncCoreParticipants(tx, task.id, {
      reporterId: user.id,
      assigneeId: input.assigneeId ?? null,
      testerId: input.testerId ?? null,
    });

    for (const watcherId of input.watcherIds ?? []) {
      await tx.taskParticipant.upsert({
        where: {
          taskId_userId_role: { taskId: task.id, userId: watcherId, role: ParticipantRole.WATCHER },
        },
        create: { taskId: task.id, userId: watcherId, role: ParticipantRole.WATCHER },
        update: {},
      });
    }

    if (input.checklists && input.checklists.length > 0) {
      await createChecklistsForTask(tx, task.id, input.checklists);
    }

    if (input.attachmentIds && input.attachmentIds.length > 0) {
      await attachUploads(tx, input.attachmentIds, user.id, {
        taskId: task.id,
        boardId: context.board.id,
      });
    }

    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: task.id,
      actorId: user.id,
      type: ActivityType.TASK_CREATED,
      payload: { key: task.key, title, columnKey, isBacklog: input.isBacklog },
    });

    return task;
  });

  await publishRealtime({
    room: rooms.board(context.board.id),
    event: SOCKET_EVENTS.TASK_CREATED,
    data: { boardId: context.board.id, taskId: created.id, actorId: user.id },
  });

  if (input.assigneeId && input.assigneeId !== user.id) {
    await dispatchNotification({
      type: NotificationType.TASK_ASSIGNED_TO_YOU,
      recipientIds: [input.assigneeId],
      actorId: user.id,
      boardId: context.board.id,
      taskId: created.id,
      payload: {
        taskKey: created.key,
        taskTitle: title,
        boardName: context.board.name,
        actorName: user.displayName,
        dueDate: input.dueDate?.toISOString() ?? null,
        priority: input.priority,
      },
    });
  }

  if (input.testerId && input.testerId !== user.id) {
    await dispatchNotification({
      type: NotificationType.TASK_TESTER_ASSIGNED,
      recipientIds: [input.testerId],
      actorId: user.id,
      boardId: context.board.id,
      taskId: created.id,
      payload: {
        taskKey: created.key,
        taskTitle: title,
        boardName: context.board.name,
        actorName: user.displayName,
      },
    });
  }

  const mentions = extractMentionIds(doc);
  if (mentions.length > 0) {
    await notifyMentions(mentions, user, context, created.id, created.key, title, text.slice(0, 160));
  }

  return getTaskDetail(user, created.id);
}

/** Проверяем, что назначаемые люди действительно есть на доске. */
async function assertBoardMembers(
  boardId: string,
  userIds: (string | null | undefined)[],
): Promise<void> {
  const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
  if (ids.length === 0) return;
  const members = await prisma.boardMember.findMany({
    where: { boardId, userId: { in: ids } },
    select: { userId: true },
  });
  if (members.length !== ids.length) {
    throw new BadRequestError('Можно назначать только участников доски');
  }
}

async function filterBoardLabels(
  boardId: string,
  labelIds: string[] | undefined,
): Promise<string[]> {
  if (!labelIds || labelIds.length === 0) return [];
  const labels = await prisma.label.findMany({
    where: { boardId, id: { in: [...new Set(labelIds)] } },
    select: { id: true },
  });
  return labels.map((l) => l.id);
}

async function createChecklistsForTask(
  tx: Prisma.TransactionClient,
  taskId: string,
  checklists: { title: string; items: { text: string; done: boolean }[] }[],
): Promise<void> {
  const listRanks = ranksBetween(null, null, checklists.length);
  let total = 0;
  let done = 0;

  for (const [index, checklist] of checklists.entries()) {
    const created = await tx.checklist.create({
      data: {
        taskId,
        title: sanitizePlainText(checklist.title, 120),
        rank: listRanks[index] ?? 'a0',
      },
      select: { id: true },
    });
    if (checklist.items.length === 0) continue;
    const itemRanks = ranksBetween(null, null, checklist.items.length);
    await tx.checklistItem.createMany({
      data: checklist.items.map((item, itemIndex) => ({
        checklistId: created.id,
        text: sanitizePlainText(item.text, 300),
        done: item.done,
        rank: itemRanks[itemIndex] ?? 'a0',
        completedAt: item.done ? new Date() : null,
      })),
    });
    total += checklist.items.length;
    done += checklist.items.filter((i) => i.done).length;
  }

  if (total > 0) {
    await tx.task.update({
      where: { id: taskId },
      data: { checklistTotal: total, checklistDone: done },
    });
  }
}

/** Привязывает ранее загруженные файлы к задаче или комментарию. */
export async function attachUploads(
  tx: Prisma.TransactionClient,
  attachmentIds: string[],
  uploaderId: string,
  target: { taskId?: string; commentId?: string; boardId: string },
): Promise<number> {
  const ids = [...new Set(attachmentIds)];
  if (ids.length === 0) return 0;

  const result = await tx.attachment.updateMany({
    where: { id: { in: ids }, uploaderId, status: 'PENDING' },
    data: {
      status: 'ATTACHED',
      expiresAt: null,
      boardId: target.boardId,
      ...(target.taskId ? { taskId: target.taskId } : {}),
      ...(target.commentId ? { commentId: target.commentId } : {}),
    },
  });

  if (target.taskId && result.count > 0) {
    await tx.task.update({
      where: { id: target.taskId },
      data: { attachmentCount: { increment: result.count } },
    });
  }

  return result.count;
}

async function notifyMentions(
  mentionedIds: string[],
  user: RequestUser,
  context: BoardContext,
  taskId: string,
  taskKey: string,
  taskTitle: string,
  preview: string,
): Promise<void> {
  const members = await prisma.boardMember.findMany({
    where: { boardId: context.board.id, userId: { in: mentionedIds } },
    select: { userId: true },
  });
  const recipients = members.map((m) => m.userId).filter((id) => id !== user.id);
  if (recipients.length === 0) return;

  await prisma.$transaction(async (tx) => {
    for (const userId of recipients) await ensureContributor(tx, taskId, userId);
  });

  await dispatchNotification({
    type: NotificationType.MENTIONED,
    recipientIds: recipients,
    actorId: user.id,
    boardId: context.board.id,
    taskId,
    payload: {
      taskKey,
      taskTitle,
      boardName: context.board.name,
      actorName: user.displayName,
      commentPreview: preview,
    },
  });
}

// ──────────────────────────────── Чтение задач ──────────────────────────────

export async function getTaskDetail(user: RequestUser, taskIdOrKey: string): Promise<TaskDetailDto> {
  const context = await loadTaskContext(user, taskIdOrKey);

  const task = await prisma.task.findUnique({
    where: { id: context.task.id },
    select: {
      ...taskCardSelect,
      descriptionJson: true,
      checklists: { orderBy: { rank: 'asc' }, select: checklistSelect },
      attachments: {
        where: { status: 'ATTACHED', commentId: null },
        orderBy: { createdAt: 'asc' },
        select: attachmentSelect,
      },
      participants: { select: participantSelect },
      linksFrom: { select: taskLinkSelect },
    },
  });
  if (!task) throw new NotFoundError('Задача не найдена', 'TASK_NOT_FOUND');

  const watching = task.participants.some((p) => p.userId === user.id && !p.muted);

  return {
    ...mapTaskCard(task),
    description: (task.descriptionJson as TaskDetailDto['description']) ?? null,
    descriptionText: task.descriptionText,
    checklists: task.checklists.map(mapChecklist),
    attachments: task.attachments.map(mapAttachment),
    participants: mapParticipants(task.participants),
    links: task.linksFrom.map(mapTaskLink),
    watching,
    board: {
      id: context.board.id,
      key: context.board.key,
      name: context.board.name,
      color: context.board.color,
      myRole: context.role,
    },
    permissions: {
      canUpdate: checkTask(user, context, 'task.update'),
      canMove: checkTask(user, context, 'task.move'),
      canComment: checkTask(user, context, 'comment.create'),
      canArchive: checkTask(user, context, 'task.archive'),
      canDelete: checkTask(user, context, 'task.delete'),
      canAttach: checkTask(user, context, 'attachment.create'),
      canManageLinks: checkTask(user, context, 'task.link.manage'),
      canModerateComments: checkTask(user, context, 'comment.delete'),
    },
  };
}

/** Список задач доски с фильтрами. Используется и доской, и бэклогом, и поиском. */
export async function listBoardTasks(
  context: BoardContext,
  filters: TaskFiltersInput,
): Promise<{ items: TaskCardDto[]; nextCursor: string | null }> {
  const where = await buildTaskWhere(context.board.id, filters);

  const orderBy: Prisma.TaskOrderByWithRelationInput[] =
    filters.sort === 'rank'
      ? [{ columnKey: 'asc' }, { rank: 'asc' }]
      : [{ [filters.sort]: filters.order } as Prisma.TaskOrderByWithRelationInput, { id: 'asc' }];

  const tasks = await prisma.task.findMany({
    where,
    orderBy,
    take: filters.limit + 1,
    ...(filters.cursor ? { cursor: { id: filters.cursor }, skip: 1 } : {}),
    select: taskCardSelect,
  });

  const hasMore = tasks.length > filters.limit;
  const page = hasMore ? tasks.slice(0, filters.limit) : tasks;

  return {
    items: page.map(mapTaskCard),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/**
 * Сборка условия выборки задач.
 *
 * Каждый фильтр добавляет отдельное условие в `AND`, а не пишет поле в объект
 * напрямую. Так фильтры гарантированно комбинируются: раньше «Просрочено»
 * перезаписывало `columnKey`, и выбранные колонки молча терялись — человек
 * видел не тот список, который просил, и не понимал почему.
 */
export async function buildTaskWhere(
  boardId: string,
  filters: TaskFiltersInput,
): Promise<Prisma.TaskWhereInput> {
  const and: Prisma.TaskWhereInput[] = [];

  if (!filters.includeArchived) and.push({ archivedAt: null });

  if (filters.onlyBacklog) and.push({ isBacklog: true });
  else if (!filters.includeBacklog) and.push({ isBacklog: false });

  if (filters.search && filters.search.length >= 2) {
    and.push({ searchText: { contains: filters.search.toLowerCase() } });
  }

  // «Кто» — один фильтр из нескольких источников: выбранные люди, участники
  // выбранных групп и «без исполнителя». Между собой они складываются (ИЛИ),
  // потому что выбор человека И его группы должен расширять выборку, а не
  // сводить её к пустоте.
  const assigneeOptions: Prisma.TaskWhereInput[] = [];

  const selectedAssignees = new Set(filters.assigneeIds ?? []);
  if (filters.groupIds && filters.groupIds.length > 0) {
    const groupMembers = await prisma.boardGroupMember.findMany({
      where: { groupId: { in: filters.groupIds }, group: { boardId } },
      select: { userId: true },
      distinct: ['userId'],
    });
    for (const member of groupMembers) selectedAssignees.add(member.userId);

    // Группа без людей не должна показывать всю доску: явно отсекаем.
    if (groupMembers.length === 0 && selectedAssignees.size === 0) {
      assigneeOptions.push({ assigneeId: { in: [] } });
    }
  }

  if (selectedAssignees.size > 0) {
    assigneeOptions.push({ assigneeId: { in: [...selectedAssignees] } });
  }
  if (filters.unassigned) assigneeOptions.push({ assigneeId: null });

  if (assigneeOptions.length === 1) and.push(assigneeOptions[0] as Prisma.TaskWhereInput);
  else if (assigneeOptions.length > 1) and.push({ OR: assigneeOptions });

  if (filters.reporterIds?.length) and.push({ reporterId: { in: filters.reporterIds } });
  if (filters.testerIds?.length) and.push({ testerId: { in: filters.testerIds } });
  if (filters.priorities?.length) and.push({ priority: { in: filters.priorities } });
  if (filters.types?.length) and.push({ type: { in: filters.types } });
  if (filters.columns?.length) and.push({ columnKey: { in: filters.columns } });
  if (filters.labelIds?.length) {
    and.push({ labels: { some: { labelId: { in: filters.labelIds } } } });
  }

  const now = new Date();
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);

  switch (filters.due) {
    case 'overdue':
      // Отдельными условиями: фильтр по колонкам, если он задан, остаётся в силе.
      and.push({ dueDate: { lt: now } }, { columnKey: { not: ColumnKey.DONE } });
      break;
    case 'today':
      and.push({
        dueDate: { gte: startOfDay, lt: new Date(startOfDay.getTime() + 86_400_000) },
      });
      break;
    case 'week':
      and.push({
        dueDate: { gte: startOfDay, lt: new Date(startOfDay.getTime() + 7 * 86_400_000) },
      });
      break;
    case 'none':
      and.push({ dueDate: null });
      break;
    case 'has':
      and.push({ dueDate: { not: null } });
      break;
    default:
      break;
  }

  return and.length > 0 ? { boardId, AND: and } : { boardId };
}

/** Все задачи доски, сгруппированные по колонкам — основной запрос канбана. */
export async function getBoardTasks(
  context: BoardContext,
  filters: TaskFiltersInput,
): Promise<Record<ColumnKey, TaskCardDto[]>> {
  const where = await buildTaskWhere(context.board.id, { ...filters, sort: 'rank', order: 'asc' });

  const tasks = await prisma.task.findMany({
    where,
    orderBy: [{ columnKey: 'asc' }, { rank: 'asc' }],
    take: 2000,
    select: taskCardSelect,
  });

  const grouped = {
    TODO: [],
    ON_HOLD: [],
    IN_PROGRESS: [],
    QA: [],
    READY_TO_RELEASE: [],
    DONE: [],
  } as Record<ColumnKey, TaskCardDto[]>;

  for (const task of tasks) {
    grouped[task.columnKey].push(mapTaskCard(task));
  }
  return grouped;
}

// ────────────────────────────── Обновление задачи ───────────────────────────

const FIELD_LABELS: Record<string, string> = {
  title: 'заголовок',
  description: 'описание',
  type: 'тип',
  priority: 'приоритет',
  assigneeId: 'исполнитель',
  testerId: 'тестировщик',
  labelIds: 'метки',
  startDate: 'дата начала',
  dueDate: 'дедлайн',
  storyPoints: 'оценка',
  estimateMinutes: 'план по времени',
  spentMinutes: 'затраченное время',
};

export async function updateTask(
  user: RequestUser,
  context: TaskContext,
  input: UpdateTaskInput,
): Promise<TaskDetailDto> {
  assertCanTask(user, context, 'task.update');

  const current = await prisma.task.findUnique({
    where: { id: context.task.id },
    select: {
      id: true,
      key: true,
      title: true,
      dueDate: true,
      assigneeId: true,
      testerId: true,
      priority: true,
      columnKey: true,
      descriptionText: true,
      dueDateChangedCount: true,
    },
  });
  if (!current) throw new NotFoundError('Задача не найдена', 'TASK_NOT_FOUND');

  // ── Правила, требующие письменного объяснения ──
  const dueRequirement = dueDateChangeRequiresReason(
    current.dueDate,
    input.dueDate === undefined ? current.dueDate : input.dueDate,
    context.board.settings,
  );
  if (dueRequirement.required && !isValidReason(input.reason)) {
    throw new ReasonRequiredError(dueRequirement.code ?? 'DUE_DATE_CHANGED', dueRequirement.message ?? '');
  }

  const assigneeRequirement = assigneeChangeRequiresReason(
    current.assigneeId,
    input.assigneeId === undefined ? current.assigneeId : input.assigneeId,
    current.columnKey,
    context.board.settings,
  );
  if (assigneeRequirement.required && !isValidReason(input.reason)) {
    throw new ReasonRequiredError(
      assigneeRequirement.code ?? 'ASSIGNEE_CHANGED',
      assigneeRequirement.message ?? '',
    );
  }

  await assertBoardMembers(context.board.id, [input.assigneeId, input.testerId]);
  const labelIds =
    input.labelIds !== undefined
      ? await filterBoardLabels(context.board.id, input.labelIds)
      : undefined;

  const data: Prisma.TaskUpdateInput = {};
  const changedFields: string[] = [];

  if (input.title !== undefined) {
    data.title = sanitizePlainText(input.title, 200);
    changedFields.push('title');
  }
  let descriptionText = current.descriptionText;
  if (input.description !== undefined) {
    const sanitized = sanitizeRichText(input.description);
    descriptionText = sanitized.text;
    // Prisma требует явный DbNull, чтобы очистить JSON-колонку.
    data.descriptionJson = sanitized.doc
      ? (sanitized.doc as unknown as Prisma.InputJsonValue)
      : Prisma.DbNull;
    data.descriptionText = sanitized.text;
    changedFields.push('description');
  }
  if (input.title !== undefined || input.description !== undefined) {
    data.searchText = buildSearchText(
      current.key,
      input.title !== undefined ? sanitizePlainText(input.title, 200) : current.title,
      descriptionText,
    );
  }
  if (input.type !== undefined) {
    data.type = input.type;
    changedFields.push('type');
  }
  if (input.priority !== undefined) {
    data.priority = input.priority;
    changedFields.push('priority');
  }
  if (input.assigneeId !== undefined) {
    data.assignee = input.assigneeId ? { connect: { id: input.assigneeId } } : { disconnect: true };
    changedFields.push('assigneeId');
  }
  if (input.testerId !== undefined) {
    data.tester = input.testerId ? { connect: { id: input.testerId } } : { disconnect: true };
    changedFields.push('testerId');
  }
  if (input.startDate !== undefined) {
    data.startDate = input.startDate;
    changedFields.push('startDate');
  }
  if (input.dueDate !== undefined) {
    data.dueDate = input.dueDate;
    if (current.dueDate) data.dueDateChangedCount = { increment: 1 };
    changedFields.push('dueDate');
  }
  if (input.storyPoints !== undefined) {
    data.storyPoints = input.storyPoints;
    changedFields.push('storyPoints');
  }
  if (input.estimateMinutes !== undefined) {
    data.estimateMinutes = input.estimateMinutes;
    changedFields.push('estimateMinutes');
  }
  if (input.spentMinutes !== undefined) {
    data.spentMinutes = input.spentMinutes;
    changedFields.push('spentMinutes');
  }
  if (labelIds !== undefined) changedFields.push('labelIds');

  if (changedFields.length === 0) return getTaskDetail(user, context.task.id);

  data.lastActivityAt = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.task.update({ where: { id: context.task.id }, data });

    if (labelIds !== undefined) {
      await tx.taskLabel.deleteMany({ where: { taskId: context.task.id } });
      if (labelIds.length > 0) {
        await tx.taskLabel.createMany({
          data: labelIds.map((labelId) => ({ taskId: context.task.id, labelId })),
        });
      }
    }

    await syncCoreParticipants(
      tx,
      context.task.id,
      {
        reporterId: context.task.reporterId,
        assigneeId: input.assigneeId === undefined ? current.assigneeId : input.assigneeId,
        testerId: input.testerId === undefined ? current.testerId : input.testerId,
      },
      { assigneeId: current.assigneeId, testerId: current.testerId },
    );
    await ensureContributor(tx, context.task.id, user.id);

    // Причина обязательна — сохраняем её как системный комментарий,
    // чтобы объяснение навсегда осталось в истории задачи.
    if (input.reason && (dueRequirement.required || assigneeRequirement.required)) {
      const isDue = dueRequirement.required;
      await tx.comment.create({
        data: {
          taskId: context.task.id,
          authorId: user.id,
          kind: 'SYSTEM',
          bodyJson: docFromText(input.reason) as object,
          bodyText: input.reason,
          systemMeta: {
            kind: isDue ? 'DUE_DATE' : 'ASSIGNEE',
            from: isDue ? (current.dueDate?.toISOString() ?? null) : current.assigneeId,
            to: isDue
              ? ((input.dueDate ?? null)?.toISOString() ?? null)
              : (input.assigneeId ?? null),
            reasonCode: isDue ? 'DUE_DATE_CHANGED' : 'ASSIGNEE_CHANGED',
          } as object,
        },
      });
      await tx.task.update({
        where: { id: context.task.id },
        data: { commentCount: { increment: 1 } },
      });
    }

    if (input.dueDate !== undefined && current.dueDate) {
      await recordActivity(tx, {
        boardId: context.board.id,
        taskId: context.task.id,
        actorId: user.id,
        type: ActivityType.TASK_DUE_DATE_CHANGED,
        payload: {
          from: current.dueDate.toISOString(),
          to: input.dueDate?.toISOString() ?? null,
          reason: input.reason ?? null,
        },
      });
    }
    if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
      await recordActivity(tx, {
        boardId: context.board.id,
        taskId: context.task.id,
        actorId: user.id,
        type: input.assigneeId ? ActivityType.TASK_ASSIGNED : ActivityType.TASK_UNASSIGNED,
        payload: { from: current.assigneeId, to: input.assigneeId, reason: input.reason ?? null },
      });
    }

    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: ActivityType.TASK_UPDATED,
      payload: { fields: changedFields },
    });
  });

  await publishRealtime([
    {
      room: rooms.board(context.board.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id, fields: changedFields },
    },
    {
      room: rooms.task(context.task.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id, fields: changedFields },
    },
  ]);

  await sendUpdateNotifications(user, context, current, input, changedFields);

  return getTaskDetail(user, context.task.id);
}

async function sendUpdateNotifications(
  user: RequestUser,
  context: TaskContext,
  current: { key: string; title: string; assigneeId: string | null; dueDate: Date | null },
  input: UpdateTaskInput,
  changedFields: string[],
): Promise<void> {
  const basePayload = {
    taskKey: current.key,
    taskTitle: input.title ?? current.title,
    boardName: context.board.name,
    actorName: user.displayName,
    reason: input.reason ?? null,
  };

  if (input.assigneeId !== undefined && input.assigneeId !== current.assigneeId) {
    if (input.assigneeId) {
      await dispatchNotification({
        type: NotificationType.TASK_ASSIGNED_TO_YOU,
        recipientIds: [input.assigneeId],
        actorId: user.id,
        boardId: context.board.id,
        taskId: context.task.id,
        payload: { ...basePayload, dueDate: (input.dueDate ?? current.dueDate)?.toISOString() ?? null },
      });
    }
    if (current.assigneeId) {
      await dispatchNotification({
        type: NotificationType.TASK_UNASSIGNED_FROM_YOU,
        recipientIds: [current.assigneeId],
        actorId: user.id,
        boardId: context.board.id,
        taskId: context.task.id,
        payload: basePayload,
      });
    }
  }

  if (input.testerId !== undefined && input.testerId && input.testerId !== user.id) {
    await dispatchNotification({
      type: NotificationType.TASK_TESTER_ASSIGNED,
      recipientIds: [input.testerId],
      actorId: user.id,
      boardId: context.board.id,
      taskId: context.task.id,
      payload: basePayload,
    });
  }

  if (input.dueDate !== undefined && current.dueDate) {
    const recipients = await taskRecipients(context.task.id, { excludeUserId: user.id });
    await dispatchNotification({
      type: NotificationType.TASK_DUE_DATE_CHANGED,
      recipientIds: recipients,
      actorId: user.id,
      boardId: context.board.id,
      taskId: context.task.id,
      payload: {
        ...basePayload,
        dueDate: input.dueDate?.toISOString() ?? null,
        previousDueDate: current.dueDate.toISOString(),
      },
    });
  }

  // Прочие правки — одно спокойное уведомление, без спама по каждому полю.
  const noisyFields = changedFields.filter(
    (field) => !['assigneeId', 'testerId', 'dueDate'].includes(field),
  );
  if (noisyFields.length > 0) {
    const recipients = await taskRecipients(context.task.id, { excludeUserId: user.id });
    if (recipients.length > 0) {
      await dispatchNotification({
        type: NotificationType.TASK_UPDATED,
        recipientIds: recipients,
        actorId: user.id,
        boardId: context.board.id,
        taskId: context.task.id,
        payload: {
          ...basePayload,
          fields: noisyFields.map((field) => FIELD_LABELS[field] ?? field),
        },
      });
    }
  }

  if (input.description !== undefined) {
    const mentions = extractMentionIds(input.description);
    if (mentions.length > 0) {
      await notifyMentions(
        mentions,
        user,
        context,
        context.task.id,
        current.key,
        input.title ?? current.title,
        '',
      );
    }
  }
}

// ─────────────────────────── Архивация и удаление ───────────────────────────

export async function setTaskArchived(
  user: RequestUser,
  context: TaskContext,
  archived: boolean,
  reason?: string,
): Promise<TaskDetailDto> {
  assertCanTask(user, context, 'task.archive');

  await prisma.$transaction(async (tx) => {
    await tx.task.update({
      where: { id: context.task.id },
      data: { archivedAt: archived ? new Date() : null, lastActivityAt: new Date() },
    });
    if (reason) {
      await tx.comment.create({
        data: {
          taskId: context.task.id,
          authorId: user.id,
          kind: 'SYSTEM',
          bodyJson: docFromText(reason) as object,
          bodyText: reason,
          systemMeta: { kind: 'ARCHIVE', to: archived ? 'archived' : 'restored' } as object,
        },
      });
      await tx.task.update({
        where: { id: context.task.id },
        data: { commentCount: { increment: 1 } },
      });
    }
    await recordActivity(tx, {
      boardId: context.board.id,
      taskId: context.task.id,
      actorId: user.id,
      type: archived ? ActivityType.TASK_ARCHIVED : ActivityType.TASK_RESTORED,
      payload: { reason: reason ?? null },
    });
  });

  await publishRealtime([
    {
      room: rooms.board(context.board.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id },
    },
    {
      // Если задача у кого-то открыта, он должен увидеть, что она уехала в архив.
      room: rooms.task(context.task.id),
      event: SOCKET_EVENTS.TASK_UPDATED,
      data: {
        boardId: context.board.id,
        taskId: context.task.id,
        actorId: user.id,
        fields: ['archivedAt'],
      },
    },
  ]);

  if (archived) {
    const recipients = await taskRecipients(context.task.id, { excludeUserId: user.id });
    await dispatchNotification({
      type: NotificationType.TASK_ARCHIVED,
      recipientIds: recipients,
      actorId: user.id,
      boardId: context.board.id,
      taskId: context.task.id,
      payload: {
        taskKey: context.task.key,
        taskTitle: context.task.title,
        boardName: context.board.name,
        actorName: user.displayName,
        reason: reason ?? null,
      },
    });
  }

  return getTaskDetail(user, context.task.id);
}

export async function deleteTask(
  user: RequestUser,
  context: TaskContext,
  confirm: string,
): Promise<void> {
  assertCanTask(user, context, 'task.delete');
  if (confirm.trim().toUpperCase() !== context.task.key) {
    throw new BadRequestError('Для подтверждения введите ключ задачи', {
      confirm: `Введите «${context.task.key}»`,
    });
  }

  await prisma.$transaction(async (tx) => {
    await recordActivity(tx, {
      boardId: context.board.id,
      actorId: user.id,
      type: ActivityType.TASK_DELETED,
      payload: { key: context.task.key, title: context.task.title },
    });
    await tx.task.delete({ where: { id: context.task.id } });
  });

  await publishRealtime([
    {
      room: rooms.board(context.board.id),
      event: SOCKET_EVENTS.TASK_DELETED,
      data: { boardId: context.board.id, taskId: context.task.id, actorId: user.id },
    },
    {
      // Открытую карточку удалённой задачи нужно закрыть, а не оставлять
      // человека смотреть на то, чего уже нет.
      room: rooms.task(context.task.id),
      event: SOCKET_EVENTS.TASK_DELETED,
      data: {
        boardId: context.board.id,
        taskId: context.task.id,
        taskKey: context.task.key,
        actorId: user.id,
      },
    },
  ]);
}

// ──────────────────────────────── Выгрузка ──────────────────────────────────

