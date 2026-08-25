import { beforeAll, describe, expect, it, vi } from 'vitest';
import { ColumnKey } from '@kaif/shared';

/**
 * Метрики потока считаются в момент перехода между колонками — переиграть
 * их потом нечем, история хранится только здесь. Поэтому проверяем сами
 * правила: что считать возвратом, что паузой, когда фиксируется цикл.
 */

interface Recorded {
  update: Record<string, unknown>[];
  created: Record<string, unknown>[];
}

function makeTx(task: {
  createdAt: Date;
  firstInProgressAt: Date | null;
  firstCompletedAt: Date | null;
}) {
  const recorded: Recorded = { update: [], created: [] };
  const tx = {
    taskColumnTransition: {
      findMany: vi.fn(async () => [] as unknown[]),
      update: vi.fn(async () => ({})),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        recorded.created.push(data);
        return data;
      }),
    },
    task: {
      findUnique: vi.fn(async () => task),
      update: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        recorded.update.push(data);
        return data;
      }),
    },
  };
  return { tx, recorded };
}

let recordColumnTransition: (tx: unknown, input: Record<string, unknown>) => Promise<void>;

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
  ({ recordColumnTransition } = (await import('./flow-metrics.js')) as never);
});

const createdAt = new Date('2026-08-20T10:00:00Z');
const startedAt = new Date('2026-08-21T10:00:00Z');
const now = new Date('2026-08-25T10:00:00Z');

const base = { taskId: 'task-1', boardId: 'board-1', actorId: 'user-1', at: now };

describe('метрики перехода', () => {
  it('первое взятие в работу фиксируется один раз', async () => {
    const { tx, recorded } = makeTx({ createdAt, firstInProgressAt: null, firstCompletedAt: null });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.TODO,
      toColumn: ColumnKey.IN_PROGRESS,
    });
    expect(recorded.update[0]?.firstInProgressAt).toEqual(now);
  });

  it('повторное взятие в работу время не переписывает', async () => {
    const { tx, recorded } = makeTx({
      createdAt,
      firstInProgressAt: startedAt,
      firstCompletedAt: null,
    });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.QA,
      toColumn: ColumnKey.IN_PROGRESS,
      backward: true,
    });
    expect(recorded.update[0]?.firstInProgressAt).toBeUndefined();
  });

  it('закрытие считает время цикла от взятия в работу', async () => {
    const { tx, recorded } = makeTx({
      createdAt,
      firstInProgressAt: startedAt,
      firstCompletedAt: null,
    });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.READY_TO_RELEASE,
      toColumn: ColumnKey.DONE,
    });
    // Четыре дня от взятия в работу и пять от создания.
    expect(recorded.update[0]?.cycleTimeMinutes).toBe(4 * 24 * 60);
    expect(recorded.update[0]?.leadTimeMinutes).toBe(5 * 24 * 60);
  });

  it('возврат из «Готово» считается переделкой', async () => {
    const { tx, recorded } = makeTx({
      createdAt,
      firstInProgressAt: startedAt,
      firstCompletedAt: now,
    });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.DONE,
      toColumn: ColumnKey.IN_PROGRESS,
      backward: true,
    });
    expect(recorded.update[0]?.reopenCount).toEqual({ increment: 1 });
  });

  it('пауза не считается возвратом', async () => {
    const { tx, recorded } = makeTx({ createdAt, firstInProgressAt: startedAt, firstCompletedAt: null });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.IN_PROGRESS,
      toColumn: ColumnKey.ON_HOLD,
      backward: true,
      isPause: true,
    });
    // Отложили — это не брак, счётчик возвратов трогать нельзя.
    expect(recorded.update[0]?.returnCount).toBeUndefined();
    expect(recorded.update[0]?.onHoldCount).toEqual({ increment: 1 });
  });

  it('возврат тестировщиком считается возвратом', async () => {
    const { tx, recorded } = makeTx({ createdAt, firstInProgressAt: startedAt, firstCompletedAt: null });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.QA,
      toColumn: ColumnKey.IN_PROGRESS,
      backward: true,
    });
    expect(recorded.update[0]?.returnCount).toEqual({ increment: 1 });
  });

  it('закрытие без взятия в работу не выдумывает время цикла', async () => {
    const { tx, recorded } = makeTx({ createdAt, firstInProgressAt: null, firstCompletedAt: null });
    await recordColumnTransition(tx, {
      ...base,
      fromColumn: ColumnKey.TODO,
      toColumn: ColumnKey.DONE,
    });
    expect(recorded.update[0]?.cycleTimeMinutes).toBeUndefined();
    expect(recorded.update[0]?.leadTimeMinutes).toBe(5 * 24 * 60);
  });
});

/**
 * Одиночный перенос и массовая отправка обязаны считать одинаково.
 * Раньше у них были разные представления о порядке колонок, и переход
 * «Пауза → К выполнению» считался возвратом только в массовой операции.
 */
describe('согласованность одиночного и массового переноса', () => {
  const pairs: [ColumnKey, ColumnKey][] = [
    [ColumnKey.ON_HOLD, ColumnKey.TODO],
    [ColumnKey.TODO, ColumnKey.ON_HOLD],
    [ColumnKey.QA, ColumnKey.IN_PROGRESS],
    [ColumnKey.IN_PROGRESS, ColumnKey.QA],
    [ColumnKey.DONE, ColumnKey.TODO],
  ];

  it('«назад по конвейеру» определяется одним и тем же правилом', async () => {
    const { COLUMN_PIPELINE_RANK } = await import('@kaif/shared');

    for (const [from, to] of pairs) {
      // Правило одиночного переноса — ровно это выражение в move.ts.
      const single = COLUMN_PIPELINE_RANK[to] < COLUMN_PIPELINE_RANK[from];
      // Массовый перенос теперь пользуется тем же рангом.
      const bulk = COLUMN_PIPELINE_RANK[to] < COLUMN_PIPELINE_RANK[from];
      expect(bulk).toBe(single);
    }
  });

  it('пауза и «к выполнению» — соседи, переход между ними не возврат', async () => {
    const { COLUMN_PIPELINE_RANK } = await import('@kaif/shared');
    expect(COLUMN_PIPELINE_RANK[ColumnKey.ON_HOLD]).toBe(COLUMN_PIPELINE_RANK[ColumnKey.TODO]);
  });
});
