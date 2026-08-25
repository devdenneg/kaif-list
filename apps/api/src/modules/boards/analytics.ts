import {
  COLUMN_ORDER,
  ColumnKey,
  TaskPriority,
  TaskType,
  type AttentionTaskDto,
  type BoardAnalyticsDto,
  type DistributionStat,
  type MetricDelta,
  type PersonStatsDto,
} from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { mapPublicUser, publicUserSelect } from '../../lib/mappers.js';
import type { BoardContext } from '../../lib/rbac.js';

/**
 * Метрики доски для владельца.
 *
 * Считается по таблице переходов между колонками и денормализованным полям
 * задачи, а не проигрыванием ленты событий: на одном ядре разворачивать
 * историю на каждый показ дашборда нельзя. Всё, что можно, делается
 * агрегатами в базе — сюда приезжают уже готовые числа.
 *
 * Порядок в ответе повторяет порядок на экране: сначала то, с чем надо
 * что-то делать сегодня, потом динамика, потом люди, потом распределения.
 */

const DAY_MS = 86_400_000;
/** Задача считается застрявшей, если её не трогали столько дней. */
const STALE_DAYS = 7;

export async function boardAnalytics(
  context: BoardContext,
  days: number,
): Promise<BoardAnalyticsDto> {
  const boardId = context.board.id;
  const now = new Date();
  const since = new Date(now.getTime() - days * DAY_MS);
  const previousSince = new Date(since.getTime() - days * DAY_MS);
  const staleBefore = new Date(now.getTime() - STALE_DAYS * DAY_MS);
  const weekAhead = new Date(now.getTime() + 7 * DAY_MS);

  /** Живые задачи доски: не в архиве, не в бэклоге, не закрытые. */
  const openTasks = {
    boardId,
    archivedAt: null,
    isBacklog: false,
    columnKey: { not: ColumnKey.DONE },
  } as const;

  const [
    attentionCounts,
    createdRows,
    completedRows,
    previousCreated,
    previousCompleted,
    durations,
    previousDurations,
    byPriority,
    byType,
    byColumn,
  ] = await Promise.all([
    countAttention(boardId, now, staleBefore, weekAhead, openTasks),
    prisma.task.findMany({
      where: { boardId, createdAt: { gte: since } },
      select: { createdAt: true },
    }),
    prisma.task.findMany({
      where: { boardId, firstCompletedAt: { gte: since } },
      select: { firstCompletedAt: true },
    }),
    prisma.task.count({ where: { boardId, createdAt: { gte: previousSince, lt: since } } }),
    prisma.task.count({
      where: { boardId, firstCompletedAt: { gte: previousSince, lt: since } },
    }),
    prisma.task.findMany({
      where: { boardId, firstCompletedAt: { gte: since } },
      select: { cycleTimeMinutes: true, leadTimeMinutes: true },
    }),
    prisma.task.findMany({
      where: { boardId, firstCompletedAt: { gte: previousSince, lt: since } },
      select: { cycleTimeMinutes: true },
    }),
    prisma.task.groupBy({
      by: ['priority'],
      where: openTasks,
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['type'],
      where: openTasks,
      _count: { _all: true },
    }),
    prisma.task.groupBy({
      by: ['columnKey'],
      where: { boardId, archivedAt: null, isBacklog: false },
      _count: { _all: true },
    }),
  ]);

  const [returnedNow, returnedBefore, columnTime, people, attention] = await Promise.all([
    countTransitions(boardId, since, now, { backward: true, isPause: false }),
    countTransitions(boardId, previousSince, since, { backward: true, isPause: false }),
    columnDurations(boardId, since),
    peopleStats(boardId, since, now, openTasks),
    attentionTasks(boardId, now, staleBefore, openTasks),
  ]);

  const [reopenedNow, reopenedBefore] = await Promise.all([
    countTransitions(boardId, since, now, { fromColumn: ColumnKey.DONE }),
    countTransitions(boardId, previousSince, since, { fromColumn: ColumnKey.DONE }),
  ]);

  const cycleMinutes = durations
    .map((row) => row.cycleTimeMinutes)
    .filter((value): value is number => value !== null);
  const leadMinutes = durations
    .map((row) => row.leadTimeMinutes)
    .filter((value): value is number => value !== null);
  const previousCycle = previousDurations
    .map((row) => row.cycleTimeMinutes)
    .filter((value): value is number => value !== null);

  return {
    period: { days, from: since.toISOString(), to: now.toISOString() },
    attentionCounts,

    flow: {
      created: delta(createdRows.length, previousCreated),
      completed: delta(completedRows.length, previousCompleted),
      cycleTimeDays: delta(medianDays(cycleMinutes), medianDays(previousCycle)),
      returned: delta(returnedNow, returnedBefore),
      reopened: delta(reopenedNow, reopenedBefore),
    },

    cycleTime: distribution(cycleMinutes),
    leadTime: distribution(leadMinutes),
    throughput: buildThroughput(days, now, createdRows, completedRows),
    columnTime,

    byPriority: byPriority
      .map((row) => ({ priority: row.priority as TaskPriority, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    byType: byType
      .map((row) => ({ type: row.type as TaskType, count: row._count._all }))
      .sort((a, b) => b.count - a.count),
    byColumn: COLUMN_ORDER.map((column) => ({
      column,
      count: byColumn.find((row) => row.columnKey === column)?._count._all ?? 0,
    })),

    people,
    attention,
  };
}

// ─────────────────────────────── Разделы ────────────────────────────────────

type OpenTasksFilter = {
  boardId: string;
  archivedAt: null;
  isBacklog: false;
  columnKey: { not: ColumnKey };
};

async function countAttention(
  boardId: string,
  now: Date,
  staleBefore: Date,
  weekAhead: Date,
  openTasks: OpenTasksFilter,
): Promise<BoardAnalyticsDto['attentionCounts']> {
  const [overdue, blocked, unassigned, stale, inProgress, dueThisWeek] = await Promise.all([
    prisma.task.count({ where: { ...openTasks, dueDate: { lt: now } } }),
    prisma.task.count({ where: { ...openTasks, blockedByCount: { gt: 0 } } }),
    prisma.task.count({ where: { ...openTasks, assigneeId: null } }),
    prisma.task.count({ where: { ...openTasks, lastActivityAt: { lt: staleBefore } } }),
    prisma.task.count({ where: { boardId, archivedAt: null, columnKey: ColumnKey.IN_PROGRESS } }),
    prisma.task.count({ where: { ...openTasks, dueDate: { gte: now, lt: weekAhead } } }),
  ]);
  return { overdue, blocked, unassigned, stale, inProgress, dueThisWeek };
}

/** Сколько переходов заданного вида случилось за период. */
async function countTransitions(
  boardId: string,
  from: Date,
  to: Date,
  filter: { backward?: boolean; isPause?: boolean; fromColumn?: ColumnKey },
): Promise<number> {
  return prisma.taskColumnTransition.count({
    where: {
      boardId,
      enteredAt: { gte: from, lt: to },
      ...(filter.backward !== undefined ? { backward: filter.backward } : {}),
      ...(filter.isPause !== undefined ? { isPause: filter.isPause } : {}),
      ...(filter.fromColumn ? { fromColumn: filter.fromColumn } : {}),
    },
  });
}

/**
 * Сколько задача реально стоит в каждой колонке.
 *
 * Медиану считает сама база: вытаскивать все отрезки в память ради одного
 * числа на доске с тысячами задач — верный способ уронить сервер.
 */
async function columnDurations(
  boardId: string,
  since: Date,
): Promise<BoardAnalyticsDto['columnTime']> {
  const rows = await prisma.$queryRaw<
    { toColumn: ColumnKey; sample: bigint; avg: number | null; med: number | null }[]
  >`
    SELECT "toColumn",
           COUNT(*) AS sample,
           AVG("durationMinutes") AS avg,
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "durationMinutes") AS med
    FROM "TaskColumnTransition"
    WHERE "boardId" = ${boardId}
      AND "leftAt" >= ${since}
      AND "durationMinutes" IS NOT NULL
    GROUP BY "toColumn"
  `;

  const byColumn = new Map(rows.map((row) => [row.toColumn, row]));

  return COLUMN_ORDER.map((column) => {
    const row = byColumn.get(column);
    return {
      column,
      medianDays: round((row?.med ?? 0) / (60 * 24)),
      averageDays: round(Number(row?.avg ?? 0) / (60 * 24)),
      sample: Number(row?.sample ?? 0),
    };
  });
}

/** Подробная таблица по людям — то, ради чего владелец сюда и заходит. */
async function peopleStats(
  boardId: string,
  since: Date,
  now: Date,
  openTasks: OpenTasksFilter,
): Promise<PersonStatsDto[]> {
  const members = await prisma.boardMember.findMany({
    where: { boardId },
    select: { user: { select: publicUserSelect } },
  });
  if (members.length === 0) return [];

  const userIds = members.map((member) => member.user.id);

  const [active, inProgress, qa, overdue, blocked, completed, reported, tested] = await Promise.all([
    groupCount({ ...openTasks, assigneeId: { in: userIds } }, 'assigneeId'),
    groupCount(
      { boardId, archivedAt: null, columnKey: ColumnKey.IN_PROGRESS, assigneeId: { in: userIds } },
      'assigneeId',
    ),
    groupCount(
      { boardId, archivedAt: null, columnKey: ColumnKey.QA, assigneeId: { in: userIds } },
      'assigneeId',
    ),
    groupCount({ ...openTasks, assigneeId: { in: userIds }, dueDate: { lt: now } }, 'assigneeId'),
    groupCount(
      { ...openTasks, assigneeId: { in: userIds }, blockedByCount: { gt: 0 } },
      'assigneeId',
    ),
    groupCount(
      { boardId, assigneeId: { in: userIds }, firstCompletedAt: { gte: since } },
      'assigneeId',
    ),
    groupCount({ boardId, reporterId: { in: userIds }, createdAt: { gte: since } }, 'reporterId'),
    groupCount(
      { boardId, testerId: { in: userIds }, firstCompletedAt: { gte: since } },
      'testerId',
    ),
  ]);

  // Медиана времени цикла по каждому человеку — одним запросом.
  const cycleRows = await prisma.$queryRaw<{ assigneeId: string; med: number | null }[]>`
    SELECT "assigneeId",
           PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY "cycleTimeMinutes") AS med
    FROM "Task"
    WHERE "boardId" = ${boardId}
      AND "assigneeId" IS NOT NULL
      AND "firstCompletedAt" >= ${since}
      AND "cycleTimeMinutes" IS NOT NULL
    GROUP BY "assigneeId"
  `;
  const cycleByUser = new Map(cycleRows.map((row) => [row.assigneeId, row.med ?? 0]));

  const returnRows = await prisma.$queryRaw<{ actorId: string; count: bigint }[]>`
    SELECT t."assigneeId" AS "actorId", COUNT(*) AS count
    FROM "TaskColumnTransition" tr
    JOIN "Task" t ON t.id = tr."taskId"
    WHERE tr."boardId" = ${boardId}
      AND tr."enteredAt" >= ${since}
      AND tr.backward = true
      AND tr."isPause" = false
      AND t."assigneeId" IS NOT NULL
    GROUP BY t."assigneeId"
  `;
  const returnsByUser = new Map(returnRows.map((row) => [row.actorId, Number(row.count)]));

  return members
    .map((member) => {
      const id = member.user.id;
      return {
        user: mapPublicUser(member.user),
        active: active.get(id) ?? 0,
        inProgress: inProgress.get(id) ?? 0,
        qa: qa.get(id) ?? 0,
        overdue: overdue.get(id) ?? 0,
        blocked: blocked.get(id) ?? 0,
        completed: completed.get(id) ?? 0,
        medianCycleDays: round((cycleByUser.get(id) ?? 0) / (60 * 24)),
        returned: returnsByUser.get(id) ?? 0,
        reported: reported.get(id) ?? 0,
        tested: tested.get(id) ?? 0,
      };
    })
    // Сверху те, у кого больше работы: с них взгляд и начинают.
    .sort((a, b) => b.active - a.active || b.completed - a.completed);
}

async function groupCount(
  where: Record<string, unknown>,
  field: 'assigneeId' | 'reporterId' | 'testerId',
): Promise<Map<string, number>> {
  const rows = await prisma.task.groupBy({
    by: [field],
    where: where as never,
    _count: { _all: true },
  });
  const result = new Map<string, number>();
  for (const row of rows) {
    const id = (row as Record<string, unknown>)[field];
    if (typeof id === 'string') result.set(id, row._count._all);
  }
  return result;
}

/** Конкретные задачи, с которыми надо что-то делать. Списки короткие — до пяти. */
async function attentionTasks(
  boardId: string,
  now: Date,
  staleBefore: Date,
  openTasks: OpenTasksFilter,
): Promise<BoardAnalyticsDto['attention']> {
  const select = {
    id: true,
    key: true,
    title: true,
    columnKey: true,
    priority: true,
    dueDate: true,
    lastActivityAt: true,
    returnCount: true,
    blockedByCount: true,
    assignee: { select: publicUserSelect },
  };

  const [overdue, blocked, stale, mostReturned] = await Promise.all([
    prisma.task.findMany({
      where: { ...openTasks, dueDate: { lt: now } },
      orderBy: { dueDate: 'asc' },
      take: 5,
      select,
    }),
    prisma.task.findMany({
      where: { ...openTasks, blockedByCount: { gt: 0 } },
      orderBy: { lastActivityAt: 'asc' },
      take: 5,
      select,
    }),
    prisma.task.findMany({
      where: { ...openTasks, lastActivityAt: { lt: staleBefore } },
      orderBy: { lastActivityAt: 'asc' },
      take: 5,
      select,
    }),
    prisma.task.findMany({
      where: { boardId, archivedAt: null, returnCount: { gt: 0 } },
      orderBy: { returnCount: 'desc' },
      take: 5,
      select,
    }),
  ]);

  const map = (rows: typeof overdue): AttentionTaskDto[] =>
    rows.map((row) => ({
      id: row.id,
      key: row.key,
      title: row.title,
      columnKey: row.columnKey,
      priority: row.priority as TaskPriority,
      assignee: row.assignee ? mapPublicUser(row.assignee) : null,
      dueDate: row.dueDate?.toISOString() ?? null,
      idleDays: round((now.getTime() - row.lastActivityAt.getTime()) / DAY_MS),
      returnCount: row.returnCount,
      blockedByCount: row.blockedByCount,
    }));

  return {
    overdue: map(overdue),
    blocked: map(blocked),
    stale: map(stale),
    mostReturned: map(mostReturned),
  };
}

// ──────────────────────────────── Мелочи ────────────────────────────────────

function buildThroughput(
  days: number,
  now: Date,
  created: { createdAt: Date }[],
  completed: { firstCompletedAt: Date | null }[],
): BoardAnalyticsDto['throughput'] {
  const createdByDay = new Map<string, number>();
  for (const task of created) {
    const key = dayKey(task.createdAt);
    createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
  }

  const doneByDay = new Map<string, number>();
  for (const task of completed) {
    if (!task.firstCompletedAt) continue;
    const key = dayKey(task.firstCompletedAt);
    doneByDay.set(key, (doneByDay.get(key) ?? 0) + 1);
  }

  const result: BoardAnalyticsDto['throughput'] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = dayKey(new Date(now.getTime() - i * DAY_MS));
    result.push({
      date,
      created: createdByDay.get(date) ?? 0,
      done: doneByDay.get(date) ?? 0,
    });
  }
  return result;
}

function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function delta(current: number, previous: number): MetricDelta {
  return { current, previous };
}

function distribution(minutes: number[]): DistributionStat {
  if (minutes.length === 0) return { median: 0, average: 0, p90: 0, sample: 0 };
  const sorted = [...minutes].sort((a, b) => a - b);
  const sum = sorted.reduce((total, value) => total + value, 0);
  return {
    median: round(percentile(sorted, 0.5) / (60 * 24)),
    average: round(sum / sorted.length / (60 * 24)),
    p90: round(percentile(sorted, 0.9) / (60 * 24)),
    sample: sorted.length,
  };
}

function medianDays(minutes: number[]): number {
  if (minutes.length === 0) return 0;
  const sorted = [...minutes].sort((a, b) => a - b);
  return round(percentile(sorted, 0.5) / (60 * 24));
}

function percentile(sorted: number[], p: number): number {
  const index = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[index] ?? 0;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
