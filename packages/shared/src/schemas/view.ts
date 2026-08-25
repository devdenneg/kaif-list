import { z } from 'zod';
import { REACTION_EMOJI } from '../constants.js';
import { idSchema, trimmedString } from './common.js';
import { dueStateFilterSchema } from './task.js';
import { taskPrioritySchema, taskTypeSchema } from './enums.js';

/** Набор фильтров, который можно сохранить и переиспользовать. */
export const savedViewFiltersSchema = z.object({
  search: z.string().trim().max(100).optional(),
  assigneeIds: z.array(idSchema).max(50).optional(),
  labelIds: z.array(idSchema).max(50).optional(),
  priorities: z.array(taskPrioritySchema).max(6).optional(),
  types: z.array(taskTypeSchema).max(5).optional(),
  due: dueStateFilterSchema.optional(),
  unassigned: z.boolean().optional(),
  includeArchived: z.boolean().optional(),
});

export const createSavedViewSchema = z.object({
  name: trimmedString(1, 40, 'Название фильтра'),
  filters: savedViewFiltersSchema,
  /** Показывать фильтр всем участникам доски. */
  isShared: z.boolean().default(false),
});
export type CreateSavedViewInput = z.infer<typeof createSavedViewSchema>;
export type CreateSavedViewPayload = z.input<typeof createSavedViewSchema>;

export const updateSavedViewSchema = z
  .object({
    name: trimmedString(1, 40, 'Название фильтра').optional(),
    filters: savedViewFiltersSchema.optional(),
    isShared: z.boolean().optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Нечего обновлять');

/** Реакция на комментарий: набор эмодзи фиксирован. */
export const toggleReactionSchema = z.object({
  emoji: z.enum(REACTION_EMOJI),
});

/**
 * Дублирование задачи. По умолчанию копируем то, что почти всегда нужно:
 * описание и чек-листы. Вложения и обсуждение — нет, это была бы копия
 * чужой истории, а не новая задача.
 */
export const duplicateTaskSchema = z.object({
  title: trimmedString(3, 200, 'Заголовок').optional(),
  includeDescription: z.boolean().default(true),
  includeChecklists: z.boolean().default(true),
  includeLabels: z.boolean().default(true),
  includeAssignee: z.boolean().default(false),
  includeDueDate: z.boolean().default(false),
  /** Сколько копий создать за один раз (например, чек-лист на каждого). */
  count: z.number().int().min(1).max(20).default(1),
});
export type DuplicateTaskInput = z.infer<typeof duplicateTaskSchema>;
export type DuplicateTaskPayload = z.input<typeof duplicateTaskSchema>;
