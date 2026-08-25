import type { CompleteProfileInput, CurrentUser } from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { BadRequestError } from '../../lib/errors.js';
import { sanitizePlainText } from '../../lib/sanitize.js';
import { downloadAndStoreAvatar } from '../../lib/files.js';
import { getCurrentUser } from '../users/service.js';

/**
 * Завершение обязательного онбординга.
 *
 * Требование продукта: после привязки Telegram у человека обязаны быть
 * человекочитаемое имя и аватар. Без этого доска превращается в набор
 * безымянных карточек.
 */
export async function completeProfile(
  userId: string,
  input: CompleteProfileInput,
): Promise<CurrentUser> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, avatarUrl: true, avatarCustom: true, tgUsername: true },
  });
  if (!user) throw new BadRequestError('Пользователь не найден');

  const displayName = sanitizePlainText(input.displayName, 48);
  if (displayName.length < 2) throw new BadRequestError('Имя слишком короткое');

  let avatarUrl = user.avatarUrl;
  let avatarCustom = user.avatarCustom;

  if (input.avatarUrl === null) {
    avatarUrl = null;
  } else if (typeof input.avatarUrl === 'string' && input.avatarUrl.length > 0) {
    if (input.avatarUrl.startsWith('/api/files/avatars/')) {
      // Файл, только что загруженный через /api/users/me/avatar.
      avatarUrl = input.avatarUrl;
      avatarCustom = true;
    } else if (input.avatarUrl.startsWith('https://')) {
      const stored = await downloadAndStoreAvatar(input.avatarUrl);
      if (!stored) throw new BadRequestError('Не удалось загрузить аватар по ссылке');
      avatarUrl = `/api/files/avatars/${stored}`;
      avatarCustom = false;
    } else {
      throw new BadRequestError('Некорректная ссылка на аватар');
    }
  }

  if (!avatarUrl) {
    throw new BadRequestError('Загрузите аватар — он обязателен', {
      avatarUrl: 'Аватар обязателен',
    });
  }

  await prisma.user.update({
    where: { id: userId },
    data: {
      displayName,
      avatarUrl,
      avatarCustom,
      profileCompleted: true,
      ...(input.timezone ? { timezone: input.timezone.slice(0, 64) } : {}),
      ...(input.locale ? { locale: input.locale } : {}),
    },
  });

  return getCurrentUser(userId);
}
