import { z } from 'zod';
import { HEX_COLOR_REGEX, LIMITS } from '../constants.js';

/** Идентификаторы Prisma (cuid). Не завязываемся на конкретную реализацию — только форма. */
export const idSchema = z
  .string()
  .min(8, 'Некорректный идентификатор')
  .max(40, 'Некорректный идентификатор')
  .regex(/^[A-Za-z0-9_-]+$/, 'Некорректный идентификатор');

export const hexColorSchema = z.string().regex(HEX_COLOR_REGEX, 'Ожидается цвет вида #RRGGBB');

/** Дата в ISO-строке или Date; на выходе всегда Date. */
export const dateSchema = z.union([z.string().datetime({ offset: true }), z.date()]).transform((v) =>
  v instanceof Date ? v : new Date(v),
);

export const nullableDateSchema = z
  .union([z.string().datetime({ offset: true }), z.date(), z.null()])
  .transform((v) => (v === null ? null : v instanceof Date ? v : new Date(v)));

/** Курсорная пагинация — стабильна при активной вставке новых записей. */
export const paginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1)
    .max(LIMITS.pagination.maxLimit)
    .default(LIMITS.pagination.defaultLimit),
});
export type PaginationInput = z.infer<typeof paginationSchema>;

export interface Paginated<T> {
  items: T[];
  nextCursor: string | null;
  total?: number;
}

/**
 * Документ TipTap. Глубокая рекурсивная валидация здесь избыточна —
 * на сервере документ проходит через санитайзер, который нормализует структуру
 * и вырезает всё лишнее. Здесь проверяем только форму верхнего уровня.
 */
export const richTextDocSchema = z
  .object({
    type: z.literal('doc'),
    content: z.array(z.unknown()).max(2000).optional(),
  })
  .passthrough();

export type RichTextDocInput = z.infer<typeof richTextDocSchema>;

export const trimmedString = (min: number, max: number, label = 'Поле') =>
  z
    .string()
    .transform((v) => v.trim())
    .pipe(
      z
        .string()
        .min(min, `${label}: минимум ${min} симв.`)
        .max(max, `${label}: максимум ${max} симв.`),
    );

export const reasonSchema = trimmedString(LIMITS.reason.min, LIMITS.reason.max, 'Причина');
export const optionalReasonSchema = reasonSchema.optional();
