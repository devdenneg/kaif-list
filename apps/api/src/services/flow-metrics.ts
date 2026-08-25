import { COLUMN_PIPELINE_RANK, ColumnKey } from '@kaif/shared';
import type { Prisma } from '@prisma/client';

/**
 * Метрики потока задачи.
 *
 * Каждый переход между колонками закрывает предыдущий отрезок и открывает
 * новый. Одновременно обновляются денормализованные поля задачи, чтобы отчёты
 * владельца были обычным SQL по колонкам, а не проигрыванием ленты событий:
 * на одном ядре разворачивать историю на каждый показ дашборда нельзя.
 *
 * Всё пишется в той же транзакции, что и сам перенос, — иначе после сбоя
 * появились бы задачи без открытого отрезка, и время в колонке поехало бы.
 */

export interface TransitionInput {
  taskId: string;
  boardId: string;
  fromColumn: ColumnKey | null;
  toColumn: ColumnKey;
  actorId: string | null;
  /** Движение назад по конвейеру. */
  backward?: boolean;
  /** Уход в ON_HOLD: формально назад, но по смыслу пауза. */
  isPause?: boolean;
  reasonCode?: string | null;
  at: Date;
}

type Tx = Prisma.TransactionClient;

export async function recordColumnTransition(tx: Tx, input: TransitionInput): Promise<void> {
  const { taskId, boardId, fromColumn, toColumn, actorId, at } = input;
  const backward = input.backward ?? false;
  const isPause = input.isPause ?? false;

  // Закрываем всё, что осталось открытым. В норме строка одна; больше одной
  // означает сбой в прошлом — тогда закрываем каждую по её собственному началу.
  const open = await tx.taskColumnTransition.findMany({
    where: { taskId, leftAt: null },
    select: { id: true, enteredAt: true, toColumn: true },
  });

  let leftOnHoldMinutes = 0;
  for (const row of open) {
    const minutes = minutesBetween(row.enteredAt, at);
    await tx.taskColumnTransition.update({
      where: { id: row.id },
      data: { leftAt: at, durationMinutes: minutes },
    });
    if (row.toColumn === ColumnKey.ON_HOLD) leftOnHoldMinutes += minutes;
  }

  await tx.taskColumnTransition.create({
    data: {
      taskId,
      boardId,
      fromColumn,
      toColumn,
      actorId,
      backward,
      isPause,
      reasonCode: input.reasonCode ?? null,
      enteredAt: at,
    },
  });

  const task = await tx.task.findUnique({
    where: { id: taskId },
    select: { createdAt: true, firstInProgressAt: true, firstCompletedAt: true },
  });
  if (!task) return;

  const data: Prisma.TaskUpdateInput = {};

  if (toColumn === ColumnKey.IN_PROGRESS && !task.firstInProgressAt) {
    data.firstInProgressAt = at;
  }

  if (toColumn === ColumnKey.DONE && !task.firstCompletedAt) {
    data.firstCompletedAt = at;
    // Цикл — от взятия в работу; если задачу закрыли, минуя IN_PROGRESS,
    // считать нечего, и поле честно остаётся пустым.
    const startedAt = task.firstInProgressAt ?? (data.firstInProgressAt as Date | undefined);
    if (startedAt) data.cycleTimeMinutes = minutesBetween(startedAt, at);
    data.leadTimeMinutes = minutesBetween(task.createdAt, at);
  }

  // Задачу достали обратно из «Готово» — это переделка, а не новая работа.
  if (fromColumn === ColumnKey.DONE && toColumn !== ColumnKey.DONE) {
    data.reopenCount = { increment: 1 };
  }

  // Возврат назад по конвейеру: тестировщик вернул в работу и подобное.
  // Пауза сюда не считается — иначе «отложили» выглядело бы как брак.
  if (backward && !isPause) {
    data.returnCount = { increment: 1 };
  }

  if (isPause) {
    data.onHoldCount = { increment: 1 };
  }

  if (leftOnHoldMinutes > 0) {
    data.onHoldTotalMinutes = { increment: leftOnHoldMinutes };
  }

  if (Object.keys(data).length > 0) {
    await tx.task.update({ where: { id: taskId }, data });
  }
}

/**
 * То же самое, но сразу для пачки задач.
 *
 * Массовая отправка из бэклога умеет двигать до двухсот задач разом. Вызов
 * `recordColumnTransition` в цикле дал бы под тысячу запросов внутри одной
 * транзакции — на сервере с одним ядром это гарантированный таймаут.
 * Поэтому здесь всё делается запросами по множеству: закрытие отрезков одним
 * оператором, вставка одним `createMany`, метрики — точечными `updateMany`.
 *
 * Все задачи переезжают в одну и ту же колонку — это свойство массовой
 * операции, и на нём держится вся экономия.
 */
export async function recordBulkColumnTransition(
  tx: Tx,
  input: {
    boardId: string;
    toColumn: ColumnKey;
    actorId: string | null;
    at: Date;
    tasks: { id: string; fromColumn: ColumnKey }[];
  },
): Promise<void> {
  const { boardId, toColumn, actorId, at, tasks } = input;
  if (tasks.length === 0) return;

  const ids = tasks.map((task) => task.id);

  // Закрываем открытые отрезки одним оператором: длительность считает сама
  // база, иначе пришлось бы вычитывать каждую строку по отдельности.
  await tx.$executeRaw`
    UPDATE "TaskColumnTransition"
    SET "leftAt" = ${at},
        "durationMinutes" = GREATEST(
          0,
          ROUND(EXTRACT(EPOCH FROM (${at}::timestamp - "enteredAt")) / 60)
        )::int
    WHERE "taskId" = ANY(${ids}) AND "leftAt" IS NULL
  `;

  await tx.taskColumnTransition.createMany({
    data: tasks.map((task) => ({
      taskId: task.id,
      boardId,
      fromColumn: task.fromColumn,
      toColumn,
      actorId,
      backward: isBackward(task.fromColumn, toColumn),
      isPause: toColumn === ColumnKey.ON_HOLD && task.fromColumn !== ColumnKey.ON_HOLD,
      enteredAt: at,
    })),
  });

  if (toColumn === ColumnKey.IN_PROGRESS) {
    await tx.task.updateMany({
      where: { id: { in: ids }, firstInProgressAt: null },
      data: { firstInProgressAt: at },
    });
  }

  if (toColumn === ColumnKey.DONE) {
    await tx.task.updateMany({
      where: { id: { in: ids }, firstCompletedAt: null },
      data: { firstCompletedAt: at },
    });
    // Время цикла и время до закрытия считаем только тем, кто закрылся
    // впервые именно сейчас.
    await tx.$executeRaw`
      UPDATE "Task"
      SET "leadTimeMinutes" = GREATEST(
            0, ROUND(EXTRACT(EPOCH FROM (${at}::timestamp - "createdAt")) / 60)
          )::int,
          "cycleTimeMinutes" = CASE
            WHEN "firstInProgressAt" IS NOT NULL THEN GREATEST(
              0, ROUND(EXTRACT(EPOCH FROM (${at}::timestamp - "firstInProgressAt")) / 60)
            )::int
            ELSE NULL
          END
      WHERE id = ANY(${ids}) AND "firstCompletedAt" = ${at}
    `;
  }

  const reopened = tasks.filter((task) => task.fromColumn === ColumnKey.DONE).map((t) => t.id);
  if (reopened.length > 0) {
    await tx.task.updateMany({
      where: { id: { in: reopened } },
      data: { reopenCount: { increment: 1 } },
    });
  }

  const returned = tasks
    .filter(
      (task) => isBackward(task.fromColumn, toColumn) && toColumn !== ColumnKey.ON_HOLD,
    )
    .map((task) => task.id);
  if (returned.length > 0) {
    await tx.task.updateMany({
      where: { id: { in: returned } },
      data: { returnCount: { increment: 1 } },
    });
  }

  if (toColumn === ColumnKey.ON_HOLD) {
    const paused = tasks.filter((task) => task.fromColumn !== ColumnKey.ON_HOLD).map((t) => t.id);
    if (paused.length > 0) {
      await tx.task.updateMany({
        where: { id: { in: paused } },
        data: { onHoldCount: { increment: 1 } },
      });
    }
  }
}

/**
 * Движение назад по конвейеру.
 *
 * Порядок берём из общего COLUMN_PIPELINE_RANK, а не из своего списка:
 * у «Пауза» там тот же ранг, что у «К выполнению», поэтому переход между
 * ними возвратом не считается. Своя нумерация здесь расходилась
 * с одиночным переносом — одно и то же движение считалось возвратом
 * в массовой операции и не считалось в обычной.
 */
function isBackward(from: ColumnKey, to: ColumnKey): boolean {
  return COLUMN_PIPELINE_RANK[to] < COLUMN_PIPELINE_RANK[from];
}

/** Первый отрезок жизни задачи: она появилась в колонке, откуда её ещё не двигали. */
export async function openInitialTransition(
  tx: Tx,
  input: { taskId: string; boardId: string; columnKey: ColumnKey; actorId: string | null; at: Date },
): Promise<void> {
  await tx.taskColumnTransition.create({
    data: {
      taskId: input.taskId,
      boardId: input.boardId,
      fromColumn: null,
      toColumn: input.columnKey,
      actorId: input.actorId,
      enteredAt: input.at,
    },
  });

  if (input.columnKey === ColumnKey.IN_PROGRESS) {
    await tx.task.update({
      where: { id: input.taskId },
      data: { firstInProgressAt: input.at },
    });
  }
}

function minutesBetween(from: Date, to: Date): number {
  return Math.max(0, Math.round((to.getTime() - from.getTime()) / 60_000));
}
