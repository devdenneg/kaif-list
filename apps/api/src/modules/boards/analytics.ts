import {
  COLUMN_ORDER,
  ColumnKey,
  type BoardAnalyticsDto,
  type TaskPriority,
} from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { mapPublicUser, publicUserSelect } from '../../lib/mappers.js';
import type { BoardContext } from '../../lib/rbac.js';

/**
 * Метрики доски: сколько создаём и сколько закрываем, за какое время,
 * кто перегружен и где задачи застревают.
 */
export async function boardAnalytics(
  context: BoardContext,
  days: number,
): Promise<BoardAnalyticsDto> {
  const now = new Date();
  const since = new Date(now.getTime() - days * 86_400_000);
  const boardId = context.board.id;

  const [created, completed, byPriority, byColumn, byAssignee, overdueCount, unassignedCount, stuck] =
    await Promise.all([
      prisma.task.findMany({
        where: { boardId, createdAt: { gte: since } },
        select: { createdAt: true },
      }),
      prisma.task.findMany({
        where: { boardId, completedAt: { gte: since } },
        select: { createdAt: true, completedAt: true },
      }),
      prisma.task.groupBy({
        by: ['priority'],
        where: { boardId, archivedAt: null, columnKey: { not: ColumnKey.DONE } },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['columnKey'],
        where: { boardId, archivedAt: null, isBacklog: false },
        _count: { _all: true },
      }),
      prisma.task.groupBy({
        by: ['assigneeId'],
        where: {
          boardId,
          archivedAt: null,
          isBacklog: false,
          columnKey: { not: ColumnKey.DONE },
          assigneeId: { not: null },
        },
        _count: { _all: true },
      }),
      prisma.task.count({
        where: {
          boardId,
          archivedAt: null,
          isBacklog: false,
          columnKey: { not: ColumnKey.DONE },
          dueDate: { lt: now },
        },
      }),
      prisma.task.count({
        where: {
          boardId,
          archivedAt: null,
          isBacklog: false,
          columnKey: { not: ColumnKey.DONE },
          assigneeId: null,
        },
      }),
      prisma.task.findMany({
        where: {
          boardId,
          archivedAt: null,
          isBacklog: false,
          columnKey: { notIn: [ColumnKey.DONE] },
        },
        select: { columnKey: true, lastActivityAt: true },
      }),
    ]);

  // ── Динамика по дням ──
  const dayKeys: string[] = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = new Date(now.getTime() - i * 86_400_000);
    dayKeys.push(date.toISOString().slice(0, 10));
  }
  const createdByDay = new Map<string, number>();
  for (const task of created) {
    const key = task.createdAt.toISOString().slice(0, 10);
    createdByDay.set(key, (createdByDay.get(key) ?? 0) + 1);
  }
  const doneByDay = new Map<string, number>();
  for (const task of completed) {
    if (!task.completedAt) continue;
    const key = task.completedAt.toISOString().slice(0, 10);
    doneByDay.set(key, (doneByDay.get(key) ?? 0) + 1);
  }

  // ── Время цикла ──
  const cycleTimes = completed
    .filter((t) => t.completedAt)
    .map((t) => ((t.completedAt as Date).getTime() - t.createdAt.getTime()) / 86_400_000)
    .filter((value) => value >= 0)
    .sort((a, b) => a - b);

  const percentile = (values: number[], p: number): number => {
    if (values.length === 0) return 0;
    const index = Math.min(values.length - 1, Math.floor((values.length - 1) * p));
    return round(values[index] ?? 0);
  };

  // ── Где застревают задачи ──
  const stuckByColumn = new Map<string, number[]>();
  for (const task of stuck) {
    const daysStuck = (now.getTime() - task.lastActivityAt.getTime()) / 86_400_000;
    const list = stuckByColumn.get(task.columnKey) ?? [];
    list.push(daysStuck);
    stuckByColumn.set(task.columnKey, list);
  }

  const assigneeIds = byAssignee
    .map((row) => row.assigneeId)
    .filter((id): id is string => id !== null);
  const users =
    assigneeIds.length > 0
      ? await prisma.user.findMany({ where: { id: { in: assigneeIds } }, select: publicUserSelect })
      : [];
  const usersById = new Map(users.map((u) => [u.id, u]));

  const overdueByAssignee = await prisma.task.groupBy({
    by: ['assigneeId'],
    where: {
      boardId,
      archivedAt: null,
      isBacklog: false,
      columnKey: { not: ColumnKey.DONE },
      assigneeId: { in: assigneeIds },
      dueDate: { lt: now },
    },
    _count: { _all: true },
  });
  const overdueMap = new Map(
    overdueByAssignee
      .filter((row) => row.assigneeId)
      .map((row) => [row.assigneeId as string, row._count._all]),
  );

  return {
    throughput: dayKeys.map((date) => ({
      date,
      created: createdByDay.get(date) ?? 0,
      done: doneByDay.get(date) ?? 0,
    })),
    cycleTimeDays: {
      median: percentile(cycleTimes, 0.5),
      average:
        cycleTimes.length > 0
          ? round(cycleTimes.reduce((sum, value) => sum + value, 0) / cycleTimes.length)
          : 0,
      p90: percentile(cycleTimes, 0.9),
    },
    byPriority: byPriority.map((row) => ({
      priority: row.priority as TaskPriority,
      count: row._count._all,
    })),
    byColumn: COLUMN_ORDER.map((column) => ({
      column,
      count: byColumn.find((row) => row.columnKey === column)?._count._all ?? 0,
    })),
    byAssignee: byAssignee
      .filter((row) => row.assigneeId && usersById.has(row.assigneeId))
      .map((row) => ({
        user: mapPublicUser(usersById.get(row.assigneeId as string)!),
        count: row._count._all,
        overdue: overdueMap.get(row.assigneeId as string) ?? 0,
      }))
      .sort((a, b) => b.count - a.count),
    bottlenecks: COLUMN_ORDER.filter((column) => column !== ColumnKey.DONE).map((column) => {
      const values = stuckByColumn.get(column) ?? [];
      return {
        column,
        averageDaysStuck:
          values.length > 0
            ? round(values.reduce((sum, value) => sum + value, 0) / values.length)
            : 0,
      };
    }),
    overdueCount,
    unassignedCount,
  };
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
