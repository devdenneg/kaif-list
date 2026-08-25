import { ColumnKey } from '@kaif/shared';
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
