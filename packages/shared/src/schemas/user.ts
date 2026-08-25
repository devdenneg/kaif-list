import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { GlobalRole } from '../enums.js';
import { idSchema, paginationSchema, trimmedString } from './common.js';
import { notificationTypeSchema } from './enums.js';

export const updateProfileSchema = z
  .object({
    displayName: trimmedString(LIMITS.displayName.min, LIMITS.displayName.max, 'Имя').optional(),
    avatarUrl: z.string().max(512).nullable().optional(),
    timezone: z.string().max(64).optional(),
    locale: z.enum(['ru', 'en']).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нечего обновлять');

const hhmm = z.string().regex(/^([01]\d|2[0-3]):([0-5]\d)$/, 'Ожидается время в формате ЧЧ:ММ');

export const notificationPreferencesSchema = z.object({
  telegramEnabled: z.boolean(),
  digestEnabled: z.boolean(),
  digestTime: hhmm,
  dueReminders: z.boolean(),
  quietHoursEnabled: z.boolean(),
  quietHoursStart: hhmm,
  quietHoursEnd: hhmm,
  disabledTypes: z.array(notificationTypeSchema).max(50),
  onlyMine: z.boolean(),
});

export const updateNotificationPreferencesSchema = notificationPreferencesSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Нечего обновлять',
);

export const listUsersSchema = paginationSchema.extend({
  search: z.string().trim().max(100).optional(),
  includeInactive: z.coerce.boolean().default(false),
  /** Ограничить пользователями конкретной доски. */
  boardId: idSchema.optional(),
});

export const setGlobalRoleSchema = z.object({
  role: z.enum([GlobalRole.SUPERADMIN, GlobalRole.USER]),
});

export const setUserActiveSchema = z.object({
  isActive: z.boolean(),
  /** Кому переназначить активные задачи при деактивации. */
  reassignToUserId: idSchema.nullable().optional(),
});
