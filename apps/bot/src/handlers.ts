import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { COLUMN_ORDER, DEFAULT_NOTIFICATION_PREFERENCES } from '@kaif/shared';
import type { BotEnv } from './config.js';
import { ApiError, type InternalApi } from './api.js';
import type { BotState } from './state.js';
import { columnLabel, escapeHtml, formatTaskList } from './text.js';
import { logger } from './logger.js';

/**
 * Обработчики входящих сообщений.
 *
 * Бот умеет: привязать аккаунт, показать задачи, ответить комментарием
 * прямо из чата и быстро сменить статус. Все действия проходят через API,
 * поэтому права и правила (включая обязательную причину) соблюдаются
 * ровно так же, как в вебе.
 */
export function registerHandlers(
  bot: Bot,
  env: BotEnv,
  api: InternalApi,
  state: BotState,
): void {
  bot.catch((error) => {
    logger.error({ err: error.error, update: error.ctx.update.update_id }, 'Ошибка обработчика');
  });

  // ── /start ────────────────────────────────────────────────────────────────

  bot.command('start', async (ctx) => {
    const payload = ctx.match?.trim();
    const from = ctx.from;
    if (!from || !ctx.chat) return;

    try {
      const result = await api.link({
        telegramId: String(from.id),
        firstName: from.first_name ?? null,
        lastName: from.last_name ?? null,
        username: from.username ?? null,
        languageCode: from.language_code ?? null,
        chatId: String(ctx.chat.id),
        ...(payload ? { code: payload } : {}),
      });

      if (payload && result.pendingLogin) {
        const pending = result.pendingLogin;
        await ctx.reply(
          [
            '🔐 <b>Запрос на вход</b>',
            '',
            `Устройство: <b>${escapeHtml(pending.deviceLabel ?? 'неизвестно')}</b>`,
            `Адрес: <code>${escapeHtml(pending.ip ?? 'неизвестен')}</code>`,
            '',
            `Код на экране: <code>${escapeHtml(pending.verificationCode)}</code>`,
            '',
            '<i>Сверьте код с тем, что показывает браузер. Если вы сейчас никуда'
              + ' не входили или код не совпадает — нажмите «Это не я».</i>',
          ].join('\n'),
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard()
              .text('✅ Это я, войти', `lg:ok:${payload}`)
              .row()
              .text('🚫 Это не я', `lg:no:${payload}`),
          },
        );
        return;
      }

      if (payload && result.loginError) {
        const reason =
          result.loginError === 'EXPIRED'
            ? 'Код входа истёк — обновите страницу и попробуйте снова.'
            : result.loginError === 'ALREADY_USED'
              ? 'Этот код уже использован. Обновите страницу входа.'
              : 'Не удалось найти запрос на вход. Обновите страницу входа.';
        await ctx.reply(`⚠️ ${reason}`);
        return;
      }

      await ctx.reply(
        [
          `👋 Привет, ${escapeHtml(result.user.displayName)}!`,
          '',
          'Я присылаю уведомления по вашим задачам: назначения, комментарии, возвраты из тестирования и приближающиеся дедлайны.',
          '',
          '<b>Что умею:</b>',
          '/tasks — мои активные задачи',
          '/today — что горит сегодня',
          '/testing — задачи на моём тестировании',
          '/settings — настройка уведомлений',
          '/help — все команды',
          '',
          'Чтобы войти в веб-интерфейс, нажмите «Войти через Telegram» на странице входа.',
        ].join('\n'),
        {
          parse_mode: 'HTML',
          reply_markup: new InlineKeyboard().url('Открыть доску', env.APP_URL),
        },
      );
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '<b>Команды</b>',
        '',
        '/tasks — мои активные задачи',
        '/today — задачи с дедлайном сегодня и просроченные',
        '/testing — задачи, где я тестировщик',
        '/me — мой профиль',
        '/settings — уведомления: включить, выключить, тихие часы',
        '/mute — временно отключить уведомления',
        '/unmute — включить обратно',
        '/logout — выйти из веба на всех устройствах',
        '',
        '<i>Совет: ответьте на любое моё уведомление обычным сообщением — оно станет комментарием к задаче.</i>',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('me', async (ctx) => {
    if (!ctx.chat) return;
    try {
      const { user } = await api.me(String(ctx.chat.id));
      await ctx.reply(
        [
          `👤 <b>${escapeHtml(user.displayName)}</b>`,
          `Роль: ${user.globalRole === 'SUPERADMIN' ? 'администратор' : 'сотрудник'}`,
          `Часовой пояс: ${escapeHtml(user.timezone)}`,
          user.profileCompleted ? '' : '⚠️ Профиль не заполнен — укажите имя и аватар в веб-интерфейсе.',
        ]
          .filter(Boolean)
          .join('\n'),
        { parse_mode: 'HTML' },
      );
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  // ── Списки задач ──────────────────────────────────────────────────────────

  const taskListCommand = (
    command: string,
    scope: 'active' | 'today' | 'overdue' | 'testing',
    title: string,
    empty: string,
  ) => {
    bot.command(command, async (ctx) => {
      if (!ctx.chat) return;
      try {
        const { items } = await api.tasks(String(ctx.chat.id), scope, 10);
        await ctx.reply(`<b>${title}</b>\n\n${formatTaskList(items, env.APP_URL, empty)}`, {
          parse_mode: 'HTML',
          link_preview_options: { is_disabled: true },
        });
      } catch (error) {
        await replyWithError(ctx, error);
      }
    });
  };

  taskListCommand('tasks', 'active', '📋 Мои активные задачи', 'Активных задач нет — чисто.');
  taskListCommand('today', 'today', '📅 На сегодня', 'На сегодня ничего не горит.');
  taskListCommand('testing', 'testing', '🔍 На моём тестировании', 'Задач на тестировании нет.');

  // ── Настройки уведомлений ─────────────────────────────────────────────────

  bot.command('mute', async (ctx) => {
    if (!ctx.chat) return;
    try {
      await api.setPreferences(String(ctx.chat.id), { telegramEnabled: false });
      await ctx.reply(
        '🔕 Уведомления отключены. Упоминания и назначения на вас всё равно будут приходить — включить всё обратно: /unmute',
      );
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('unmute', async (ctx) => {
    if (!ctx.chat) return;
    try {
      await api.setPreferences(String(ctx.chat.id), { telegramEnabled: true });
      await ctx.reply('🔔 Уведомления включены.');
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('settings', async (ctx) => {
    if (!ctx.chat) return;
    try {
      const { preferences } = await api.getPreferences(String(ctx.chat.id));
      await ctx.reply(settingsText(preferences), {
        parse_mode: 'HTML',
        reply_markup: settingsKeyboard(preferences),
      });
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('logout', async (ctx) => {
    if (!ctx.chat) return;
    try {
      await api.logout(String(ctx.chat.id));
      await ctx.reply('🚪 Вы вышли из веб-интерфейса на всех устройствах.');
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  // ── Кнопки под уведомлениями ──────────────────────────────────────────────

  bot.on('callback_query:data', async (ctx) => {
    const data = ctx.callbackQuery.data;
    const chatId = ctx.chat?.id;
    if (!chatId) return;

    try {
      // Подтверждение входа: lg:ok:<код> или lg:no:<код>
      if (data.startsWith('lg:')) {
        const [, action, code] = data.split(':');
        const from = ctx.from;
        if (!code || !from) {
          await ctx.answerCallbackQuery('Запрос устарел');
          return;
        }

        const approve = action === 'ok';
        const result = await api.confirmLogin({
          telegramId: String(from.id),
          firstName: from.first_name ?? null,
          lastName: from.last_name ?? null,
          username: from.username ?? null,
          languageCode: from.language_code ?? null,
          chatId: String(chatId),
          code,
          approve,
        });

        await ctx.answerCallbackQuery(
          result.approved ? 'Вход подтверждён' : approve ? 'Не получилось' : 'Вход отклонён',
        );

        // Убираем кнопки: повторно нажать на устаревший запрос нельзя.
        await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => undefined);

        if (result.approved) {
          await ctx.reply(
            '✅ <b>Вход подтверждён</b>\n\nВозвращайтесь во вкладку браузера — она уже открывает доску.',
            { parse_mode: 'HTML' },
          );
        } else if (!approve) {
          await ctx.reply(
            '🚫 Вход отклонён, код погашен.\n\nЕсли это были не вы — вход в ваш аккаунт никто не получил.',
          );
        } else {
          const reason =
            result.reason === 'EXPIRED'
              ? 'Код истёк — запросите вход заново.'
              : 'Этот запрос уже недействителен.';
          await ctx.reply(`⚠️ ${reason}`);
        }
        return;
      }

      // Быстрый перенос задачи: mv:<taskId>:<COLUMN>
      if (data.startsWith('mv:')) {
        const [, taskId, column] = data.split(':');
        if (!taskId || !column || !COLUMN_ORDER.includes(column as never)) {
          await ctx.answerCallbackQuery('Действие устарело');
          return;
        }

        try {
          const result = await api.move(String(chatId), taskId, column);
          await ctx.answerCallbackQuery(`${result.task.key} → ${columnLabel(result.task.columnKey)}`);
          await ctx.reply(
            `✅ <b>${escapeHtml(result.task.key)}</b> переведена в «${escapeHtml(columnLabel(result.task.columnKey))}»`,
            { parse_mode: 'HTML' },
          );
        } catch (error) {
          // Перенос назад или на паузу требует объяснения — спрашиваем его.
          if (error instanceof ApiError && error.code === 'REASON_REQUIRED') {
            await ctx.answerCallbackQuery('Нужна причина');
            const prompt = await ctx.reply(
              `✍️ Напишите ответом на это сообщение, почему задача переводится в «${escapeHtml(columnLabel(column))}».`,
              { parse_mode: 'HTML', reply_markup: { force_reply: true, selective: true } },
            );
            await state.setPending(chatId, prompt.message_id, {
              kind: 'move-reason',
              taskId,
              toColumn: column,
            });
            return;
          }
          throw error;
        }
        return;
      }

      // Ответ комментарием: rp:<taskId>
      if (data.startsWith('rp:')) {
        const [, taskId] = data.split(':');
        if (!taskId) {
          await ctx.answerCallbackQuery('Действие устарело');
          return;
        }
        await ctx.answerCallbackQuery();
        const prompt = await ctx.reply('💬 Напишите комментарий ответом на это сообщение.', {
          reply_markup: { force_reply: true, selective: true },
        });
        await state.setPending(chatId, prompt.message_id, { kind: 'comment', taskId });
        return;
      }

      // Переключатели настроек: st:<field>
      if (data.startsWith('st:')) {
        const [, field] = data.split(':');
        if (!field) return;
        const { preferences } = await api.getPreferences(String(chatId));
        const current = preferences[field];
        const next = { [field]: !(current === true) };
        const updated = await api.setPreferences(String(chatId), next);
        await ctx.answerCallbackQuery('Сохранено');
        await ctx.editMessageText(settingsText(updated.preferences), {
          parse_mode: 'HTML',
          reply_markup: settingsKeyboard(updated.preferences),
        });
        return;
      }

      await ctx.answerCallbackQuery();
    } catch (error) {
      logger.warn({ err: error }, 'Ошибка обработки нажатия');
      const message = error instanceof ApiError ? error.message : 'Не удалось выполнить действие';
      try {
        await ctx.answerCallbackQuery({ text: message.slice(0, 190), show_alert: true });
      } catch {
        // Кнопка могла устареть — это не повод падать.
      }
    }
  });

  // ── Ответы на сообщения бота ──────────────────────────────────────────────

  bot.on('message:text', async (ctx) => {
    const chatId = ctx.chat.id;
    const replyTo = ctx.message.reply_to_message;
    if (!replyTo) return;

    const pending = await state.getPending(chatId, replyTo.message_id);
    if (!pending) return;

    const text = ctx.message.text.trim();
    if (text.length === 0) return;

    try {
      if (pending.kind === 'comment') {
        const result = await api.comment(String(chatId), pending.taskId, text);
        await state.clearPending(chatId, replyTo.message_id);
        await ctx.reply(`💬 Комментарий добавлен в <b>${escapeHtml(result.taskKey)}</b>`, {
          parse_mode: 'HTML',
        });
        return;
      }

      if (pending.kind === 'move-reason' && pending.toColumn) {
        const result = await api.move(String(chatId), pending.taskId, pending.toColumn, text);
        await state.clearPending(chatId, replyTo.message_id);
        await ctx.reply(
          `✅ <b>${escapeHtml(result.task.key)}</b> → «${escapeHtml(columnLabel(result.task.columnKey))}»\nПричина сохранена в задаче.`,
          { parse_mode: 'HTML' },
        );
      }
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  // Любое другое сообщение — мягкая подсказка.
  bot.on('message', async (ctx) => {
    if (ctx.message.reply_to_message) return;
    await ctx.reply('Не понял. Список команд: /help');
  });
}

function settingsText(preferences: Record<string, unknown>): string {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...preferences };
  return [
    '<b>⚙️ Настройки уведомлений</b>',
    '',
    `Уведомления в Telegram: ${prefs.telegramEnabled ? '🔔 включены' : '🔕 выключены'}`,
    `Утренняя сводка: ${prefs.digestEnabled ? `✅ в ${prefs.digestTime}` : '—'}`,
    `Напоминания о дедлайнах: ${prefs.dueReminders ? '✅' : '—'}`,
    `Тихие часы: ${prefs.quietHoursEnabled ? `🌙 ${prefs.quietHoursStart}–${prefs.quietHoursEnd}` : '—'}`,
    `Только то, что касается меня: ${prefs.onlyMine ? '✅' : '—'}`,
    '',
    '<i>Упоминания и назначения на вас приходят всегда — их нельзя пропустить.</i>',
  ].join('\n');
}

function settingsKeyboard(preferences: Record<string, unknown>): InlineKeyboard {
  const prefs = { ...DEFAULT_NOTIFICATION_PREFERENCES, ...preferences };
  return new InlineKeyboard()
    .text(prefs.telegramEnabled ? '🔕 Выключить' : '🔔 Включить', 'st:telegramEnabled')
    .row()
    .text(prefs.digestEnabled ? 'Сводка: выкл' : 'Сводка: вкл', 'st:digestEnabled')
    .text(prefs.dueReminders ? 'Дедлайны: выкл' : 'Дедлайны: вкл', 'st:dueReminders')
    .row()
    .text(prefs.quietHoursEnabled ? 'Тихие часы: выкл' : 'Тихие часы: вкл', 'st:quietHoursEnabled')
    .text(prefs.onlyMine ? 'Все события' : 'Только моё', 'st:onlyMine');
}

async function replyWithError(ctx: Context, error: unknown): Promise<void> {
  if (error instanceof ApiError) {
    if (error.code === 'TELEGRAM_NOT_LINKED') {
      await ctx.reply('Аккаунт не привязан. Отправьте /start, чтобы связать Telegram с доской.');
      return;
    }
    await ctx.reply(`⚠️ ${error.message}`);
    return;
  }
  if (error instanceof GrammyError) {
    logger.warn({ err: error }, 'Ошибка Telegram API');
    return;
  }
  logger.error({ err: error }, 'Непредвиденная ошибка');
  await ctx.reply('⚠️ Что-то пошло не так. Попробуйте позже.');
}
