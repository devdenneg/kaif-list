import { z } from 'zod';
import { BOARD_KEY_REGEX, LIMITS } from '../constants.js';
import { BoardRole } from '../enums.js';
import { hexColorSchema, idSchema, trimmedString } from './common.js';

const wipLimitSchema = z.number().int().min(1).max(999).nullable();

/** WIP-лимиты задаются по каждой колонке отдельно, все поля необязательны. */
export const wipLimitsSchema = z
  .object({
    TODO: wipLimitSchema,
    ON_HOLD: wipLimitSchema,
    IN_PROGRESS: wipLimitSchema,
    QA: wipLimitSchema,
    READY_TO_RELEASE: wipLimitSchema,
    DONE: wipLimitSchema,
  })
  .partial();

export const boardSettingsSchema = z.object({
  requireReasonOnHold: z.boolean().default(true),
  requireReasonOnBackwardMove: z.boolean().default(true),
  requireReasonOnDueDateChange: z.boolean().default(true),
  requireReasonOnAssigneeChange: z.boolean().default(false),
  requireTesterForQa: z.boolean().default(false),
  wipLimits: wipLimitsSchema.default({}),
  enforceWipLimits: z.boolean().default(false),
  allowViewerComments: z.boolean().default(true),
  blockDoneWhenBlocked: z.boolean().default(true),
  autoAssignOnStart: z.boolean().default(true),
});

export const createBoardSchema = z.object({
  name: trimmedString(LIMITS.boardName.min, LIMITS.boardName.max, 'Название доски'),
  /** Если не передан — сервер сгенерирует из названия. */
  key: z
    .string()
    .transform((v) => v.trim().toUpperCase())
    .pipe(z.string().regex(BOARD_KEY_REGEX, 'Ключ: 2–8 латинских букв/цифр, начиная с буквы'))
    .optional(),
  description: z.string().trim().max(LIMITS.boardDescription.max).optional(),
  color: hexColorSchema.optional(),
  icon: z.string().max(32).optional(),
  /** Сразу пригласить участников. */
  memberIds: z.array(idSchema).max(100).optional(),
});
export type CreateBoardInput = z.infer<typeof createBoardSchema>;

export const updateBoardSchema = z
  .object({
    name: trimmedString(LIMITS.boardName.min, LIMITS.boardName.max, 'Название доски').optional(),
    description: z.string().trim().max(LIMITS.boardDescription.max).nullable().optional(),
    color: hexColorSchema.optional(),
    icon: z.string().max(32).nullable().optional(),
    settings: boardSettingsSchema.partial().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нечего обновлять');
export type UpdateBoardInput = z.infer<typeof updateBoardSchema>;

export const boardRoleSchema = z.enum([
  BoardRole.OWNER,
  BoardRole.ADMIN,
  BoardRole.MEMBER,
  BoardRole.VIEWER,
]);

export const addBoardMemberSchema = z.object({
  userId: idSchema,
  role: z.enum([BoardRole.ADMIN, BoardRole.MEMBER, BoardRole.VIEWER]).default(BoardRole.MEMBER),
});

export const changeBoardMemberRoleSchema = z.object({
  role: z.enum([BoardRole.ADMIN, BoardRole.MEMBER, BoardRole.VIEWER]),
});

export const transferOwnershipSchema = z.object({
  newOwnerId: idSchema,
  /** Подтверждение: пользователь вводит ключ доски. */
  confirm: z.string().min(1),
});

export const createLabelSchema = z.object({
  name: trimmedString(LIMITS.labelName.min, LIMITS.labelName.max, 'Название метки'),
  color: hexColorSchema,
  description: z.string().trim().max(200).optional(),
});

export const updateLabelSchema = createLabelSchema.partial().refine(
  (v) => Object.keys(v).length > 0,
  'Нечего обновлять',
);

export const updateColumnSchema = z
  .object({
    name: z.string().trim().min(1).max(40).optional(),
    wipLimit: z.number().int().min(1).max(999).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Нечего обновлять');

export const deleteBoardSchema = z.object({
  /** Пользователь вводит ключ доски — защита от случайного удаления. */
  confirm: z.string().min(1),
});
