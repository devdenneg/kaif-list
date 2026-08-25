import { z } from 'zod';
import { idSchema, paginationSchema } from './common.js';
import { notificationTypeSchema } from './enums.js';

export const listNotificationsSchema = paginationSchema.extend({
  onlyUnread: z.coerce.boolean().default(false),
  types: z.array(notificationTypeSchema).max(30).optional(),
  boardId: idSchema.optional(),
});

export const markNotificationsReadSchema = z.object({
  /** Пусто — отметить все прочитанными. */
  ids: z.array(idSchema).max(500).optional(),
  boardId: idSchema.optional(),
});
