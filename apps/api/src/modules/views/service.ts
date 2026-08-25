import type { CreateSavedViewInput, SavedViewDto, SavedViewFilters } from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { sanitizePlainText } from '../../lib/sanitize.js';
import { assertCan, type BoardContext, type RequestUser } from '../../lib/rbac.js';

/**
 * Сохранённые фильтры.
 *
 * «Мои баги», «Горит на этой неделе», «Без исполнителя» — наборы, которые
 * человек настраивает один раз и потом переключает одним кликом.
 * Фильтр можно сделать общим для доски: так команда договаривается,
 * что считать «горящим», а не изобретает это каждый заново.
 */

const MAX_VIEWS_PER_BOARD = 30;

function toDto(
  row: {
    id: string;
    name: string;
    boardId: string | null;
    filters: unknown;
    isShared: boolean;
    userId: string;
    createdAt: Date;
  },
  currentUserId: string,
): SavedViewDto {
  return {
    id: row.id,
    name: row.name,
    boardId: row.boardId,
    filters: (row.filters as SavedViewFilters) ?? {},
    isShared: row.isShared,
    isOwn: row.userId === currentUserId,
    createdAt: row.createdAt.toISOString(),
  };
}

export async function listSavedViews(
  user: RequestUser,
  context: BoardContext,
): Promise<SavedViewDto[]> {
  assertCan(user, context, 'board.view');

  const rows = await prisma.savedView.findMany({
    where: {
      boardId: context.board.id,
      OR: [{ userId: user.id }, { isShared: true }],
    },
    orderBy: [{ isShared: 'desc' }, { createdAt: 'asc' }],
    select: {
      id: true,
      name: true,
      boardId: true,
      filters: true,
      isShared: true,
      userId: true,
      createdAt: true,
    },
  });

  return rows.map((row) => toDto(row, user.id));
}

export async function createSavedView(
  user: RequestUser,
  context: BoardContext,
  input: CreateSavedViewInput,
): Promise<SavedViewDto> {
  assertCan(user, context, 'board.view');

  // Общий фильтр видят все — создавать его может тот, кто управляет доской.
  if (input.isShared) assertCan(user, context, 'board.settings.manage');

  const existing = await prisma.savedView.count({
    where: { boardId: context.board.id, userId: user.id },
  });
  if (existing >= MAX_VIEWS_PER_BOARD) {
    throw new ForbiddenError(`Не больше ${MAX_VIEWS_PER_BOARD} сохранённых фильтров на доску`);
  }

  const row = await prisma.savedView.create({
    data: {
      userId: user.id,
      boardId: context.board.id,
      name: sanitizePlainText(input.name, 40),
      filters: input.filters as object,
      isShared: input.isShared,
    },
    select: {
      id: true,
      name: true,
      boardId: true,
      filters: true,
      isShared: true,
      userId: true,
      createdAt: true,
    },
  });

  return toDto(row, user.id);
}

export async function updateSavedView(
  user: RequestUser,
  context: BoardContext,
  viewId: string,
  input: { name?: string; filters?: SavedViewFilters; isShared?: boolean },
): Promise<SavedViewDto> {
  const view = await prisma.savedView.findFirst({
    where: { id: viewId, boardId: context.board.id },
    select: { userId: true },
  });
  if (!view) throw new NotFoundError('Фильтр не найден');
  if (view.userId !== user.id) throw new ForbiddenError('Можно менять только свои фильтры');
  if (input.isShared) assertCan(user, context, 'board.settings.manage');

  const row = await prisma.savedView.update({
    where: { id: viewId },
    data: {
      ...(input.name !== undefined ? { name: sanitizePlainText(input.name, 40) } : {}),
      ...(input.filters !== undefined ? { filters: input.filters as object } : {}),
      ...(input.isShared !== undefined ? { isShared: input.isShared } : {}),
    },
    select: {
      id: true,
      name: true,
      boardId: true,
      filters: true,
      isShared: true,
      userId: true,
      createdAt: true,
    },
  });

  return toDto(row, user.id);
}

export async function deleteSavedView(
  user: RequestUser,
  context: BoardContext,
  viewId: string,
): Promise<void> {
  const view = await prisma.savedView.findFirst({
    where: { id: viewId, boardId: context.board.id },
    select: { userId: true },
  });
  if (!view) throw new NotFoundError('Фильтр не найден');

  // Свой фильтр удаляет автор, общий — тот, кто управляет доской.
  const isOwn = view.userId === user.id;
  if (!isOwn) assertCan(user, context, 'board.settings.manage');

  await prisma.savedView.delete({ where: { id: viewId } });
}
