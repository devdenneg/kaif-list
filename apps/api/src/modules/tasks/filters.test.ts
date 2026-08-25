import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ColumnKey, TaskPriority } from '@kaif/shared';

/**
 * Фильтры доски должны складываться, а не затирать друг друга.
 *
 * Раньше условия писались прямо в объект `where`, и «просрочено» молча
 * стирало выбранную колонку: человек видел не то, что просил. Теперь всё
 * собирается в `AND`, и эти проверки следят, чтобы так и осталось.
 */

const findMany = vi.fn(async () => [] as { userId: string }[]);

vi.mock('../../lib/prisma.js', () => ({
  prisma: { boardGroupMember: { findMany: (...args: unknown[]) => findMany(...(args as [])) } },
}));

type WhereShape = {
  boardId?: string;
  AND?: Record<string, unknown>[];
};

let buildTaskWhere: (boardId: string, filters: Record<string, unknown>) => Promise<WhereShape>;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:4998',
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/kaif_test?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    INTERNAL_API_SECRET: 'internal-secret-internal-secret-1234',
    TELEGRAM_BOT_TOKEN: '123456789:AAHfaketokenfaketokenfaketokenfaketoken',
    TELEGRAM_BOT_USERNAME: 'kaif_test_bot',
    STORAGE_DIR: './.tmp-test-storage',
    ENABLE_WORKERS: 'false',
    ENABLE_REALTIME: 'false',
  });
  ({ buildTaskWhere } = (await import('./service.js')) as never);
});

/** Условия лежат плоским списком в AND — так их удобно искать в тестах. */
function conditions(where: WhereShape): Record<string, unknown>[] {
  return where.AND ?? [];
}

function has(where: WhereShape, predicate: (item: Record<string, unknown>) => boolean): boolean {
  return conditions(where).some(predicate);
}

describe('buildTaskWhere', () => {
  it('«просрочено» не затирает выбранную колонку', async () => {
    const where = await buildTaskWhere('board-1', {
      due: 'overdue',
      columns: [ColumnKey.IN_PROGRESS],
    });

    // Оба условия должны дожить до запроса: и срок, и колонка.
    expect(has(where, (item) => 'dueDate' in item)).toBe(true);
    expect(
      has(where, (item) => JSON.stringify(item.columnKey ?? '').includes(ColumnKey.IN_PROGRESS)),
    ).toBe(true);
    // При этом «не DONE» из правила просрочки тоже на месте.
    expect(has(where, (item) => JSON.stringify(item.columnKey ?? '').includes('not'))).toBe(true);
  });

  it('исполнитель и «без исполнителя» складываются через ИЛИ', async () => {
    const where = await buildTaskWhere('board-1', {
      assigneeIds: ['user-1'],
      unassigned: true,
    });

    const or = conditions(where).find((item) => Array.isArray(item.OR));
    expect(or).toBeDefined();
    expect((or?.OR as unknown[]).length).toBe(2);
  });

  it('группа разворачивается в её участников', async () => {
    findMany.mockResolvedValueOnce([{ userId: 'dev-1' }, { userId: 'dev-2' }]);

    const where = await buildTaskWhere('board-1', { groupIds: ['group-1'] });
    const assignee = conditions(where).find((item) => 'assigneeId' in item);

    expect(assignee).toBeDefined();
    expect((assignee?.assigneeId as { in: string[] }).in.sort()).toEqual(['dev-1', 'dev-2']);
  });

  it('пустая группа не показывает вообще ничего', async () => {
    findMany.mockResolvedValueOnce([]);

    const where = await buildTaskWhere('board-1', { groupIds: ['empty-group'] });
    const assignee = conditions(where).find((item) => 'assigneeId' in item);

    // Иначе фильтр по пустой группе выглядел бы как «показать всё».
    expect((assignee?.assigneeId as { in: string[] }).in).toEqual([]);
  });

  it('группа и выбранные люди объединяются, а не исключают друг друга', async () => {
    findMany.mockResolvedValueOnce([{ userId: 'dev-1' }]);

    const where = await buildTaskWhere('board-1', {
      groupIds: ['group-1'],
      assigneeIds: ['manager-1'],
    });
    const assignee = conditions(where).find((item) => 'assigneeId' in item);

    expect((assignee?.assigneeId as { in: string[] }).in.sort()).toEqual(['dev-1', 'manager-1']);
  });

  it('все фильтры разом попадают в запрос', async () => {
    const where = await buildTaskWhere('board-1', {
      search: 'оплата',
      assigneeIds: ['user-1'],
      labelIds: ['label-1'],
      priorities: [TaskPriority.HIGH],
      columns: [ColumnKey.QA],
      due: 'today',
    });

    expect(where.boardId).toBe('board-1');
    expect(has(where, (item) => 'searchText' in item)).toBe(true);
    expect(has(where, (item) => 'assigneeId' in item)).toBe(true);
    expect(has(where, (item) => 'labels' in item)).toBe(true);
    expect(has(where, (item) => 'priority' in item)).toBe(true);
    expect(has(where, (item) => 'columnKey' in item)).toBe(true);
    expect(has(where, (item) => 'dueDate' in item)).toBe(true);
    // Архив и бэклог исключаются по умолчанию.
    expect(has(where, (item) => item.archivedAt === null)).toBe(true);
    expect(has(where, (item) => item.isBacklog === false)).toBe(true);
  });
});
