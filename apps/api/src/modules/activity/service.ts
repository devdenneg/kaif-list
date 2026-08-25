import type { ActivityDto } from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { activitySelect, mapActivity } from '../../lib/mappers.js';

/** Лента активности доски. */
export async function listBoardActivity(
  boardId: string,
  options: { cursor?: string; limit: number },
): Promise<{ items: ActivityDto[]; nextCursor: string | null }> {
  const rows = await prisma.activity.findMany({
    where: { boardId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: activitySelect,
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  return {
    items: page.map(mapActivity),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** История конкретной задачи. */
export async function listTaskActivity(
  taskId: string,
  options: { cursor?: string; limit: number },
): Promise<{ items: ActivityDto[]; nextCursor: string | null }> {
  const rows = await prisma.activity.findMany({
    where: { taskId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: options.limit + 1,
    ...(options.cursor ? { cursor: { id: options.cursor }, skip: 1 } : {}),
    select: activitySelect,
  });

  const hasMore = rows.length > options.limit;
  const page = hasMore ? rows.slice(0, options.limit) : rows;
  return {
    items: page.map(mapActivity),
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}
