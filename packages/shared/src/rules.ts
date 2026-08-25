import { COLUMN_PIPELINE_RANK, ColumnKey } from './enums.js';
import { LIMITS } from './constants.js';

/**
 * Настройки доски, влияющие на бизнес-правила.
 * Хранятся в `Board.settings` (JSONB) — можно менять без миграций.
 */
export interface BoardSettings {
  /** Требовать причину при переводе задачи на паузу (ON_HOLD). */
  requireReasonOnHold: boolean;
  /** Требовать причину при движении назад по конвейеру (тестировщик вернул и т. п.). */
  requireReasonOnBackwardMove: boolean;
  /** Требовать причину при изменении уже установленного дедлайна. */
  requireReasonOnDueDateChange: boolean;
  /** Требовать причину при смене исполнителя у задачи, которая уже в работе. */
  requireReasonOnAssigneeChange: boolean;
  /** Не пускать задачу в QA без назначенного тестировщика. */
  requireTesterForQa: boolean;
  /** WIP-лимиты по колонкам: сколько задач допустимо держать одновременно. */
  wipLimits: Partial<Record<ColumnKey, number | null>>;
  /** true — WIP-лимит запрещает перенос, false — только предупреждает. */
  enforceWipLimits: boolean;
  /** Разрешить наблюдателям комментировать. */
  allowViewerComments: boolean;
  /** Не давать закрыть задачу, у которой есть незакрытые блокеры. */
  blockDoneWhenBlocked: boolean;
  /** Автоматически назначать исполнителем того, кто перевёл задачу в «В работе». */
  autoAssignOnStart: boolean;
  /**
   * Через сколько дней задача из «Готово» уезжает в архив. 0 — не убирать.
   * Отсчёт начинается с попадания в «Готово» и обнуляется, если задачу
   * оттуда забрали.
   */
  autoArchiveDoneDays: number;
}

export const DEFAULT_BOARD_SETTINGS: BoardSettings = {
  requireReasonOnHold: true,
  requireReasonOnBackwardMove: true,
  requireReasonOnDueDateChange: true,
  requireReasonOnAssigneeChange: false,
  requireTesterForQa: false,
  wipLimits: {
    IN_PROGRESS: null,
    QA: null,
  },
  enforceWipLimits: false,
  allowViewerComments: true,
  blockDoneWhenBlocked: true,
  autoAssignOnStart: true,
  autoArchiveDoneDays: 3,
};

export function mergeBoardSettings(raw: unknown): BoardSettings {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_BOARD_SETTINGS };
  const input = raw as Partial<BoardSettings>;
  return {
    ...DEFAULT_BOARD_SETTINGS,
    ...input,
    wipLimits: { ...DEFAULT_BOARD_SETTINGS.wipLimits, ...(input.wipLimits ?? {}) },
  };
}

export const REASON_MIN_LENGTH = LIMITS.reason.min;
export const REASON_MAX_LENGTH = LIMITS.reason.max;

export type ReasonCode =
  | 'MOVE_ON_HOLD'
  | 'MOVE_BACKWARD'
  | 'DUE_DATE_CHANGED'
  | 'ASSIGNEE_CHANGED';

export interface ReasonRequirement {
  required: boolean;
  code?: ReasonCode;
  /** Человекочитаемое пояснение — показывается прямо в форме. */
  message?: string;
}

const NOT_REQUIRED: ReasonRequirement = { required: false };

/** Нужно ли объяснение при переносе задачи из колонки `from` в колонку `to`. */
export function moveRequiresReason(
  from: ColumnKey,
  to: ColumnKey,
  settings: BoardSettings,
): ReasonRequirement {
  if (from === to) return NOT_REQUIRED;

  if (to === ColumnKey.ON_HOLD && settings.requireReasonOnHold) {
    return {
      required: true,
      code: 'MOVE_ON_HOLD',
      message: 'Задача уходит на паузу — объясните, что её блокирует.',
    };
  }

  const isBackward = COLUMN_PIPELINE_RANK[to] < COLUMN_PIPELINE_RANK[from];
  if (isBackward && settings.requireReasonOnBackwardMove) {
    return {
      required: true,
      code: 'MOVE_BACKWARD',
      message: 'Задача возвращается назад — напишите, что не так.',
    };
  }

  return NOT_REQUIRED;
}

/** Нужно ли объяснение при изменении дедлайна. */
export function dueDateChangeRequiresReason(
  previous: Date | string | null | undefined,
  next: Date | string | null | undefined,
  settings: BoardSettings,
): ReasonRequirement {
  if (!settings.requireReasonOnDueDateChange) return NOT_REQUIRED;
  const prevTime = previous ? new Date(previous).getTime() : null;
  const nextTime = next ? new Date(next).getTime() : null;
  if (prevTime === nextTime) return NOT_REQUIRED;
  // Первичная установка дедлайна объяснения не требует — требуется только перенос/снятие.
  if (prevTime === null) return NOT_REQUIRED;
  return {
    required: true,
    code: 'DUE_DATE_CHANGED',
    message:
      nextTime === null
        ? 'Дедлайн снимается — объясните почему.'
        : 'Дедлайн переносится — объясните почему.',
  };
}

/** Нужно ли объяснение при смене исполнителя. */
export function assigneeChangeRequiresReason(
  previousAssigneeId: string | null | undefined,
  nextAssigneeId: string | null | undefined,
  column: ColumnKey,
  settings: BoardSettings,
): ReasonRequirement {
  if (!settings.requireReasonOnAssigneeChange) return NOT_REQUIRED;
  if ((previousAssigneeId ?? null) === (nextAssigneeId ?? null)) return NOT_REQUIRED;
  if (!previousAssigneeId) return NOT_REQUIRED;
  if (COLUMN_PIPELINE_RANK[column] < COLUMN_PIPELINE_RANK[ColumnKey.IN_PROGRESS]) {
    return NOT_REQUIRED;
  }
  return {
    required: true,
    code: 'ASSIGNEE_CHANGED',
    message: 'Задача уже в работе — объясните смену исполнителя.',
  };
}

/** Валидна ли причина (после trim). */
export function isValidReason(reason: string | null | undefined): boolean {
  const value = (reason ?? '').trim();
  return value.length >= REASON_MIN_LENGTH && value.length <= REASON_MAX_LENGTH;
}
