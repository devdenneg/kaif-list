import { z } from 'zod';
import { LIMITS } from '../constants.js';
import { idSchema, paginationSchema, richTextDocSchema } from './common.js';

export const createCommentSchema = z.object({
  body: richTextDocSchema,
  /** Ответ в треде. */
  parentId: idSchema.nullable().optional(),
  /** Уже загруженные вложения, которые нужно привязать к комментарию. */
  attachmentIds: z.array(idSchema).max(LIMITS.attachment.maxPerRequest).optional(),
});
export type CreateCommentInput = z.infer<typeof createCommentSchema>;

export const updateCommentSchema = z.object({
  body: richTextDocSchema,
});

export const listCommentsSchema = paginationSchema.extend({
  order: z.enum(['asc', 'desc']).default('asc'),
  /** Показывать системные записи вместе с обычными комментариями. */
  includeSystem: z.coerce.boolean().default(true),
});
