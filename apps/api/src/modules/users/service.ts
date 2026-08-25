import type { CurrentUser } from '@kaif/shared';
import { mergeNotificationPreferences } from '@kaif/shared';
import { prisma } from '../../lib/prisma.js';
import { NotFoundError } from '../../lib/errors.js';
import { absoluteUrl } from '../../lib/mappers.js';

const currentUserSelect = {
  id: true,
  telegramId: true,
  displayName: true,
  avatarUrl: true,
  tgUsername: true,
  globalRole: true,
  profileCompleted: true,
  isActive: true,
  timezone: true,
  locale: true,
  botChatId: true,
  botBlocked: true,
  notificationPrefs: true,
  createdAt: true,
} as const;

export async function getCurrentUser(userId: string): Promise<CurrentUser> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: currentUserSelect });
  if (!user) throw new NotFoundError('Пользователь не найден');

  return {
    id: user.id,
    telegramId: user.telegramId.toString(),
    displayName: user.displayName,
    avatarUrl: absoluteUrl(user.avatarUrl),
    tgUsername: user.tgUsername,
    isActive: user.isActive,
    globalRole: user.globalRole,
    profileCompleted: user.profileCompleted,
    timezone: user.timezone,
    locale: user.locale,
    botLinked: user.botChatId !== null,
    botBlocked: user.botBlocked,
    notificationPreferences: mergeNotificationPreferences(user.notificationPrefs),
    createdAt: user.createdAt.toISOString(),
  };
}
