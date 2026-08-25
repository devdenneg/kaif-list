import { z } from 'zod';
import { LIMITS } from '../constants.js';
import {
  idSchema,
  nullableDateSchema,
  paginationSchema,
  reasonSchema,
  richTextDocSchema,
  trimmedString,
} from './common.js';
import {
  columnKeySchema,
  taskLinkTypeSchema,
  taskPrioritySchema,
  taskTypeSchema,
} from './enums.js';

export const checklistItemInputSchema = z.object({
  text: trimmedString(LIMITS.checklistItem.min, LIMITS.checklistItem.max, 'Пункт'),
  done: z.boolean().default(false),
  assigneeId: idSchema.nullable().optional(),
  dueDate: nullableDateSchema.optional(),
});

export const checklistInputSchema = z.object({
  title: trimmedString(LIMITS.checklistTitle.min, LIMITS.checklistTitle.max, 'Название чек-листа'),
  items: z.array(checklistItemInputSchema).max(100).default([]),
});

export const createTaskSchema = z.object({
  title: trimmedString(LIMITS.taskTitle.min, LIMITS.taskTitle.max, 'Заголовок'),
  description: richTextDocSchema.nullable().optional(),
  type: taskTypeSchema.default('TASK'),
  priority: taskPrioritySchema.default('MEDIUM'),
  columnKey: columnKeySchema.default('TODO'),
  /** Задача создаётся сразу в бэклоге (банк задач), а не на доске. */
  isBacklog: z.boolean().default(false),
  assigneeId: idSchema.nullable().optional(),
  testerId: idSchema.nullable().optional(),
  labelIds: z.array(idSchema).max(20).optional(),
  watcherIds: z.array(idSchema).max(50).optional(),
  startDate: nullableDateSchema.optional(),
  dueDate: nullableDateSchema.optional(),
  storyPoints: z.number().int().min(LIMITS.storyPoints.min).max(LIMITS.storyPoints.max).nullable().optional(),
  estimateMinutes: z
    .number()
    .int()
    .min(LIMITS.estimateMinutes.min)
    .max(LIMITS.estimateMinutes.max)
    .nullable()
    .optional(),
  checklists: z.array(checklistInputSchema).max(10).optional(),
  /** Идентификаторы уже загруженных вложений, которые нужно привязать к задаче. */
  attachmentIds: z.array(idSchema).max(LIMITS.attachment.maxPerTask).optional(),
  /** Позиция вставки: до какой задачи поставить. */
  beforeTaskId: idSchema.nullable().optional(),
});
export type CreateTaskInput = z.infer<typeof createTaskSchema>;
/**
 * Тип «до разбора»: со стороны клиента даты — строки, а поля со значениями
 * по умолчанию можно не передавать. `z.infer` для этого не годится —
 * он описывает результат разбора, где значения уже подставлены.
 */
export type CreateTaskPayload = z.input<typeof createTaskSchema>;

export const updateTaskSchema = z
  .object({
    title: trimmedString(LIMITS.taskTitle.min, LIMITS.taskTitle.max, 'Заголовок').optional(),
    description: richTextDocSchema.nullable().optional(),
    type: taskTypeSchema.optional(),
    priority: taskPrioritySchema.optional(),
    assigneeId: idSchema.nullable().optional(),
    testerId: idSchema.nullable().optional(),
    labelIds: z.array(idSchema).max(20).optional(),
    startDate: nullableDateSchema.optional(),
    dueDate: nullableDateSchema.optional(),
    storyPoints: z
      .number()
      .int()
      .min(LIMITS.storyPoints.min)
      .max(LIMITS.storyPoints.max)
      .nullable()
      .optional(),
    estimateMinutes: z
      .number()
      .int()
      .min(LIMITS.estimateMinutes.min)
      .max(LIMITS.estimateMinutes.max)
      .nullable()
      .optional(),
    spentMinutes: z
      .number()
      .int()
      .min(0)
      .max(LIMITS.estimateMinutes.max)
      .nullable()
      .optional(),
    /**
     * Объяснение изменения. Обязательно при переносе дедлайна (и, если включено
     * в настройках доски, при смене исполнителя у задачи в работе).
     * Сервер проверяет необходимость сам и возвращает 422 с кодом причины.
     */
    reason: reasonSchema.optional(),
  })
  .refine(
    (v) => Object.keys(v).filter((k) => k !== 'reason').length > 0,
    'Нечего обновлять',
  );
export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;
export type UpdateTaskPayload = z.input<typeof updateTaskSchema>;

/**
 * Перенос задачи. Клиент передаёт соседей в целевой колонке —
 * сервер вычисляет дробный ранг между ними.
 */
export const moveTaskSchema = z.object({
  toColumn: columnKeySchema,
  beforeTaskId: idSchema.nullable().optional(),
  afterTaskId: idSchema.nullable().optional(),
  /** Вернуть задачу из бэклога на доску (или наоборот). */
  toBacklog: z.boolean().optional(),
  reason: reasonSchema.optional(),
});
export type MoveTaskInput = z.infer<typeof moveTaskSchema>;
export type MoveTaskPayload = z.input<typeof moveTaskSchema>;

export const archiveTaskSchema = z.object({
  reason: z.string().trim().max(LIMITS.reason.max).optional(),
});

export const deleteTaskSchema = z.object({
  /** Пользователь вводит ключ задачи — защита от случайного удаления. */
  confirm: z.string().min(1),
});

export const dueStateFilterSchema = z.enum([
  'any',
  'overdue',
  'today',
  'week',
  'none',
  'has',
]);

export const taskSortSchema = z.enum([
  'rank',
  'priority',
  'dueDate',
  'createdAt',
  'updatedAt',
  'title',
]);

/**
 * Query-параметры могут прийти как `?ids=a&ids=b`, так и `?ids=a,b`.
 * Приводим оба варианта к массиву — фронту не приходится думать о формате.
 */
const listParam = <T extends z.ZodTypeAny>(item: T) =>
  z.preprocess((value) => {
    if (value === undefined || value === null) return undefined;
    if (Array.isArray(value)) return value;
    if (typeof value === 'string') {
      return value
        .split(',')
        .map((part) => part.trim())
        .filter(Boolean);
    }
    return [value];
  }, z.array(item));

export const taskFiltersSchema = z
  .object({
    search: z.string().trim().max(LIMITS.search.max).optional(),
    assigneeIds: listParam(idSchema).optional(),
    /** Специальное значение для «без исполнителя». */
    unassigned: z.coerce.boolean().optional(),
    reporterIds: listParam(idSchema).optional(),
    testerIds: listParam(idSchema).optional(),
    labelIds: listParam(idSchema).optional(),
    priorities: listParam(taskPrioritySchema).optional(),
    types: listParam(taskTypeSchema).optional(),
    columns: listParam(columnKeySchema).optional(),
    due: dueStateFilterSchema.optional(),
    includeArchived: z.coerce.boolean().default(false),
    includeBacklog: z.coerce.boolean().default(false),
    onlyBacklog: z.coerce.boolean().default(false),
    sort: taskSortSchema.default('rank'),
    order: z.enum(['asc', 'desc']).default('asc'),
  })
  .merge(paginationSchema);
export type TaskFiltersInput = z.infer<typeof taskFiltersSchema>;

// --- Чек-листы ---

export const createChecklistSchema = z.object({
  title: trimmedString(LIMITS.checklistTitle.min, LIMITS.checklistTitle.max, 'Название чек-листа'),
});

export const createChecklistItemSchema = checklistItemInputSchema;

export const updateChecklistItemSchema = z
  .object({
    text: trimmedString(LIMITS.checklistItem.min, LIMITS.checklistItem.max, 'Пункт').optional(),
    done: z.boolean().optional(),
    assigneeId: idSchema.nullable().optional(),
    dueDate: nullableDateSchema.optional(),
    /** Перестановка внутри чек-листа. */
    beforeItemId: idSchema.nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нечего обновлять');

// --- Связи между задачами ---

export const createTaskLinkSchema = z.object({
  type: taskLinkTypeSchema,
  /** Целевая задача по id или по ключу вида OPS-12. */
  targetTaskId: idSchema.optional(),
  targetTaskKey: z.string().trim().max(20).optional(),
}).refine((v) => Boolean(v.targetTaskId || v.targetTaskKey), 'Укажите задачу');

// --- Наблюдение и участники ---

export const watchTaskSchema = z.object({
  watch: z.boolean(),
});

export const addParticipantSchema = z.object({
  userId: idSchema,
});

// --- Массовые операции (бэклог, админка) ---

export const bulkTaskActionSchema = z.object({
  taskIds: z.array(idSchema).min(1).max(200),
  action: z.enum(['assign', 'setPriority', 'addLabel', 'removeLabel', 'moveToBoard', 'moveToBacklog', 'archive']),
  assigneeId: idSchema.nullable().optional(),
  priority: taskPrioritySchema.optional(),
  labelId: idSchema.optional(),
  columnKey: columnKeySchema.optional(),
  reason: z.string().trim().max(LIMITS.reason.max).optional(),
});
export type BulkTaskActionInput = z.infer<typeof bulkTaskActionSchema>;
export type BulkTaskActionPayload = z.input<typeof bulkTaskActionSchema>;
