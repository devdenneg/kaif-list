import { describe, expect, it } from 'vitest';
import type { ColumnKey, TaskCardDto } from '@kaif/shared';
import { applyOptimisticTaskMove, type BoardColumns } from './tasks';

function task(id: string, columnKey: ColumnKey): TaskCardDto {
  return { id, columnKey } as TaskCardDto;
}

function columns(values: Partial<BoardColumns> = {}): BoardColumns {
  return {
    TODO: [],
    ON_HOLD: [],
    IN_PROGRESS: [],
    QA: [],
    READY_TO_RELEASE: [],
    DONE: [],
    ...values,
  };
}

describe('оптимистичное перемещение задачи', () => {
  it('сразу меняет порядок внутри колонки без дублей', () => {
    const source = columns({ TODO: [task('a', 'TODO'), task('b', 'TODO'), task('c', 'TODO')] });

    const result = applyOptimisticTaskMove(source, {
      taskId: 'c',
      toColumn: 'TODO',
      beforeTaskId: 'a',
      afterTaskId: null,
    });

    expect(result.TODO.map((item) => item.id)).toEqual(['c', 'a', 'b']);
    expect(source.TODO.map((item) => item.id)).toEqual(['a', 'b', 'c']);
  });

  it('переносит задачу между колонками рядом с указанными соседями', () => {
    const source = columns({
      TODO: [task('a', 'TODO'), task('b', 'TODO')],
      QA: [task('q1', 'QA'), task('q2', 'QA')],
    });

    const result = applyOptimisticTaskMove(source, {
      taskId: 'b',
      toColumn: 'QA',
      beforeTaskId: 'q2',
      afterTaskId: 'q1',
    });

    expect(result.TODO.map((item) => item.id)).toEqual(['a']);
    expect(result.QA.map((item) => [item.id, item.columnKey])).toEqual([
      ['q1', 'QA'],
      ['b', 'QA'],
      ['q2', 'QA'],
    ]);
  });

  it('добавляет в конец, если сосед уже исчез из кеша', () => {
    const source = columns({ TODO: [task('a', 'TODO')], DONE: [task('d', 'DONE')] });

    const result = applyOptimisticTaskMove(source, {
      taskId: 'a',
      toColumn: 'DONE',
      beforeTaskId: 'missing',
      afterTaskId: null,
    });

    expect(result.DONE.map((item) => item.id)).toEqual(['d', 'a']);
  });

  it('не меняет кеш фильтра, в котором задачи нет', () => {
    const source = columns({ TODO: [task('a', 'TODO')] });

    expect(
      applyOptimisticTaskMove(source, {
        taskId: 'hidden',
        toColumn: 'DONE',
      }),
    ).toBe(source);
  });
});
