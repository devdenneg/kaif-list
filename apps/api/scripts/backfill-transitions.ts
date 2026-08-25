import { ActivityType, COLUMN_PIPELINE_RANK, ColumnKey } from '@kaif/shared';
import { prisma } from '../src/lib/prisma.js';
import { logger } from '../src/lib/logger.js';

/**
 * Разметка задач, созданных до появления таблицы переходов.
 *
 * Проигрывает ленту активности по каждой задаче и восстанавливает, когда
 * она входила в каждую колонку. Без этого отчёты по времени в колонке
 * начинались бы с пустого места: у старых задач нет ни одного отрезка,
 * и они просто выпадали бы из статистики.
 *
 * Запускать один раз после выкатки миграции:
 *   docker compose exec api node apps/api/dist/scripts/backfill-transitions.js
 *   npx tsx apps/api/scripts/backfill-transitions.ts   (локально)
 *
 * Скрипт идемпотентный: задачи, у которых переходы уже есть, пропускаются.
 * Прерывать и запускать заново безопасно.
 */

/** Батч подобран под сервер с 961 МБ памяти: больше — риск словить OOM. */
const BATCH_SIZE = 200;

interface MoveEvent {
  at: Date;
  from: ColumnKey | null;
  to: ColumnKey;
  actorId: string | null;
}

async function main(): Promise<void> {
  const total = await prisma.task.count();
  logger.info({ total }, 'Разметка переходов: начало');

  let processed = 0;
  let filled = 0;
  let skipped = 0;
  let cursor: string | undefined;

  for (;;) {
    const tasks = await prisma.task.findMany({
      take: BATCH_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      orderBy: { id: 'asc' },
      select: {
        id: true,
        boardId: true,
        columnKey: true,
        createdAt: true,
        reporterId: true,
        completedAt: true,
      },
    });
    if (tasks.length === 0) break;
    cursor = tasks[tasks.length - 1]?.id;

    for (const task of tasks) {
      processed += 1;

      const existing = await prisma.taskColumnTransition.count({ where: { taskId: task.id } });
      if (existing > 0) {
        skipped += 1;
        continue;
      }

      const events = await loadMoveEvents(task.id);
      await writeTransitions(task, events);
      filled += 1;
    }

    logger.info({ processed, total, filled, skipped }, 'Разметка переходов: прогресс');
  }

  logger.info({ processed, filled, skipped }, 'Разметка переходов: готово');
}

/** Переходы восстанавливаем из ленты: там лежат `from` и `to` каждого переноса. */
async function loadMoveEvents(taskId: string): Promise<MoveEvent[]> {
  const rows = await prisma.activity.findMany({
    where: {
      taskId,
      type: {
        in: [
          ActivityType.TASK_MOVED,
          ActivityType.TASK_MOVED_TO_BOARD,
          ActivityType.TASK_MOVED_TO_BACKLOG,
        ],
      },
    },
    orderBy: { createdAt: 'asc' },
    select: { createdAt: true, actorId: true, payload: true },
  });

  const events: MoveEvent[] = [];
  for (const row of rows) {
    const payload = (row.payload ?? {}) as { from?: unknown; to?: unknown };
    const to = asColumn(payload.to);
    if (!to) continue;
    events.push({
      at: row.createdAt,
      from: asColumn(payload.from),
      to,
      actorId: row.actorId,
    });
  }
  return events;
}

async function writeTransitions(
  task: {
    id: string;
    boardId: string;
    columnKey: ColumnKey;
    createdAt: Date;
    reporterId: string;
    completedAt: Date | null;
  },
  events: MoveEvent[],
): Promise<void> {
  // Первый отрезок — от создания задачи до первого переноса.
  const first = events[0];
  const startColumn = first?.from ?? (events.length === 0 ? task.columnKey : ColumnKey.TODO);

  const rows: {
    taskId: string;
    boardId: string;
    fromColumn: ColumnKey | null;
    toColumn: ColumnKey;
    actorId: string | null;
    enteredAt: Date;
    leftAt: Date | null;
    durationMinutes: number | null;
  }[] = [
    {
      taskId: task.id,
      boardId: task.boardId,
      fromColumn: null,
      toColumn: startColumn,
      actorId: task.reporterId,
      enteredAt: task.createdAt,
      leftAt: null,
      durationMinutes: null,
    },
  ];

  for (const event of events) {
    const previous = rows[rows.length - 1];
    if (previous) {
      previous.leftAt = event.at;
      previous.durationMinutes = minutesBetween(previous.enteredAt, event.at);
    }
    rows.push({
      taskId: task.id,
      boardId: task.boardId,
      fromColumn: event.from ?? previous?.toColumn ?? null,
      toColumn: event.to,
      actorId: event.actorId,
      enteredAt: event.at,
      leftAt: null,
      durationMinutes: null,
    });
  }

  const firstInProgress = rows.find((row) => row.toColumn === ColumnKey.IN_PROGRESS)?.enteredAt;
  const firstDone = rows.find((row) => row.toColumn === ColumnKey.DONE)?.enteredAt;
  const returns = rows.filter((row, index) => index > 0 && isBackward(row.fromColumn, row.toColumn));
  const reopens = rows.filter((row) => row.fromColumn === ColumnKey.DONE);
  const onHold = rows.filter((row) => row.toColumn === ColumnKey.ON_HOLD);

  await prisma.$transaction(async (tx) => {
    await tx.taskColumnTransition.createMany({ data: rows });
    await tx.task.update({
      where: { id: task.id },
      data: {
        firstInProgressAt: firstInProgress ?? null,
        firstCompletedAt: firstDone ?? null,
        returnCount: returns.length,
        reopenCount: reopens.length,
        onHoldCount: onHold.length,
        onHoldTotalMinutes: onHold.reduce((sum, row) => sum + (row.durationMinutes ?? 0), 0),
        cycleTimeMinutes:
          firstInProgress && firstDone ? minutesBetween(firstInProgress, firstDone) : null,
        leadTimeMinutes: firstDone ? minutesBetween(task.createdAt, firstDone) : null,
      },
    });
  });
}

const PIPELINE: ColumnKey[] = [
  ColumnKey.TODO,
  ColumnKey.ON_HOLD,
  ColumnKey.IN_PROGRESS,
  ColumnKey.QA,
  ColumnKey.READY_TO_RELEASE,
  ColumnKey.DONE,
];

function isBackward(from: ColumnKey | null, to: ColumnKey): boolean {
  if (!from) return false;
  // Уход в ON_HOLD — пауза, а не возврат: браком его считать нельзя.
  if (to === ColumnKey.ON_HOLD) return false;
  // Порядок — общий, иначе размеченная история разойдётся с живой.
  return COLUMN_PIPELINE_RANK[to] < COLUMN_PIPELINE_RANK[from];
}

function asColumn(value: unknown): ColumnKey | null {
  return typeof value === 'string' && PIPELINE.includes(value as ColumnKey)
    ? (value as ColumnKey)
    : null;
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}

main()
  .then(() => prisma.$disconnect())
  .catch(async (error) => {
    logger.error({ err: error }, 'Разметка переходов провалилась');
    await prisma.$disconnect();
    process.exit(1);
  });
