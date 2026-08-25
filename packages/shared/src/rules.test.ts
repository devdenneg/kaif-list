import { describe, expect, it } from 'vitest';
import {
  ColumnKey,
  DEFAULT_BOARD_SETTINGS,
  assigneeChangeRequiresReason,
  dueDateChangeRequiresReason,
  isValidReason,
  mergeBoardSettings,
  moveRequiresReason,
} from './index.js';

const settings = DEFAULT_BOARD_SETTINGS;

describe('обязательное объяснение при переносе', () => {
  it('пауза всегда требует причины', () => {
    const result = moveRequiresReason(ColumnKey.IN_PROGRESS, ColumnKey.ON_HOLD, settings);
    expect(result.required).toBe(true);
    expect(result.code).toBe('MOVE_ON_HOLD');
  });

  it('возврат из тестирования требует причины', () => {
    const result = moveRequiresReason(ColumnKey.QA, ColumnKey.IN_PROGRESS, settings);
    expect(result.required).toBe(true);
    expect(result.code).toBe('MOVE_BACKWARD');
  });

  it('движение вперёд причины не требует', () => {
    expect(moveRequiresReason(ColumnKey.TODO, ColumnKey.IN_PROGRESS, settings).required).toBe(false);
    expect(moveRequiresReason(ColumnKey.QA, ColumnKey.READY_TO_RELEASE, settings).required).toBe(
      false,
    );
    expect(moveRequiresReason(ColumnKey.READY_TO_RELEASE, ColumnKey.DONE, settings).required).toBe(
      false,
    );
  });

  it('возврат из паузы в работу не считается движением назад', () => {
    expect(moveRequiresReason(ColumnKey.ON_HOLD, ColumnKey.IN_PROGRESS, settings).required).toBe(
      false,
    );
  });

  it('перенос в ту же колонку ничего не требует', () => {
    expect(moveRequiresReason(ColumnKey.QA, ColumnKey.QA, settings).required).toBe(false);
  });

  it('правило можно отключить в настройках доски', () => {
    const relaxed = mergeBoardSettings({ requireReasonOnBackwardMove: false });
    expect(moveRequiresReason(ColumnKey.QA, ColumnKey.IN_PROGRESS, relaxed).required).toBe(false);
    // Пауза при этом всё ещё требует объяснения.
    expect(moveRequiresReason(ColumnKey.QA, ColumnKey.ON_HOLD, relaxed).required).toBe(true);
  });
});

describe('изменение дедлайна', () => {
  const past = new Date('2026-01-01T10:00:00Z');
  const future = new Date('2026-02-01T10:00:00Z');

  it('первичная установка срока не требует причины', () => {
    expect(dueDateChangeRequiresReason(null, future, settings).required).toBe(false);
  });

  it('перенос существующего срока требует причины', () => {
    const result = dueDateChangeRequiresReason(past, future, settings);
    expect(result.required).toBe(true);
    expect(result.code).toBe('DUE_DATE_CHANGED');
  });

  it('снятие срока тоже требует причины', () => {
    expect(dueDateChangeRequiresReason(past, null, settings).required).toBe(true);
  });

  it('тот же срок — изменения нет', () => {
    expect(dueDateChangeRequiresReason(past, new Date(past), settings).required).toBe(false);
  });
});

describe('смена исполнителя', () => {
  const strict = mergeBoardSettings({ requireReasonOnAssigneeChange: true });

  it('по умолчанию правило выключено', () => {
    expect(
      assigneeChangeRequiresReason('user-1', 'user-2', ColumnKey.IN_PROGRESS, settings).required,
    ).toBe(false);
  });

  it('в работе смена исполнителя требует причины', () => {
    expect(
      assigneeChangeRequiresReason('user-1', 'user-2', ColumnKey.IN_PROGRESS, strict).required,
    ).toBe(true);
  });

  it('в Todo причина не нужна', () => {
    expect(assigneeChangeRequiresReason('user-1', 'user-2', ColumnKey.TODO, strict).required).toBe(
      false,
    );
  });

  it('первое назначение причины не требует', () => {
    expect(
      assigneeChangeRequiresReason(null, 'user-2', ColumnKey.IN_PROGRESS, strict).required,
    ).toBe(false);
  });
});

describe('валидация причины', () => {
  it('слишком короткая причина не проходит', () => {
    expect(isValidReason('не ок')).toBe(false);
    expect(isValidReason('   ')).toBe(false);
    expect(isValidReason(null)).toBe(false);
  });

  it('нормальное объяснение проходит', () => {
    expect(isValidReason('Не экспортируется кириллица в CSV')).toBe(true);
  });

  it('пробелы по краям не считаются', () => {
    expect(isValidReason('   короткая  ')).toBe(false);
  });
});
