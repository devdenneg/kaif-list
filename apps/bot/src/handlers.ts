import { Bot, GrammyError, InlineKeyboard, type Context } from 'grammy';
import { COLUMN_ORDER, DEFAULT_NOTIFICATION_PREFERENCES } from '@kaif/shared';
import type { BotEnv } from './config.js';
import { ApiError, type InternalApi } from './api.js';
import type { BotState } from './state.js';
import { columnLabel, escapeHtml } from './text.js';
import {
  boardsScreen,
  homeScreen,
  scopeOf,
  statsScreen,
  taskListScreen,
  taskScreen,
  type BoardLine,
  type Screen,
  type ScopeCode,
  type TaskCard,
} from './screens.js';
import { logger } from './logger.js';

/**
 * Обработчики входящих сообщений.
 *
 * Бот умеет: привязать аккаунт, показать задачи, ответить комментарием
 * прямо из чата и быстро сменить статус. Все действия проходят через API,
 * поэтому права и правила (включая обязательную причину) соблюдаются
 * ровно так же, как в вебе.
 */
/** Ключ задачи вида KAIF-7 — по нему бот показывает карточку. */
const TASK_KEY_PATTERN = /^[A-Za-z][A-Za-z0-9]{1,7}-\d{1,7}$/;

export function registerHandlers(
  bot: Bot,
  env: BotEnv,
  api: InternalApi,
  state: BotState,
): void {
  bot.catch((error) => {
    logger.error({ err: error.error, update: error.ctx.update.update_id }, 'Ошибка обработчика');
  });

  /**
   * Показать экран.
   *
   * По нажатию кнопки перерисовываем то же сообщение, а не шлём новое:
   * иначе после трёх нажатий чат превращается в свалку из вариантов
   * одного и того же меню.
   */
  const show = async (ctx: Context, screen: Screen, replace: boolean): Promise<void> => {
    const options = {
      parse_mode: 'HTML' as const,
      reply_markup: screen.keyboard,
      link_preview_options: { is_disabled: true },
    };
    if (replace) {
      try {
        await ctx.editMessageText(screen.text, options);
        return;
      } catch {
        // Сообщение могло устареть или не измениться — тогда просто пришлём новое.
      }
    }
    await ctx.reply(screen.text, options);
  };

  const loadBoards = async (chatId: number): Promise<BoardLine[]> => {
    const { items } = await api.boards(String(chatId));
    return items;
  };

  const openHome = async (ctx: Context, replace: boolean): Promise<void> => {
    if (!ctx.chat) return;
    const [{ user }, boards] = await Promise.all([
      api.me(String(ctx.chat.id)),
      loadBoards(ctx.chat.id).catch(() => [] as BoardLine[]),
    ]);
    const manages = boards.some((board) => board.role === 'OWNER' || board.role === 'ADMIN');
    await show(ctx, homeScreen(user.displayName, manages), replace);
  };

  const openTaskList = async (ctx: Context, code: ScopeCode, replace: boolean): Promise<void> => {
    if (!ctx.chat) return;
    const scope = scopeOf(code);
    if (!scope) return;
    const { items } = await api.tasks(String(ctx.chat.id), scope, 20);
    await show(
      ctx,
      taskListScreen(code, items, items.map((item) => item.id)),
      replace,
    );
  };

  const openTask = async (ctx: Context, taskId: string, replace: boolean): Promise<void> => {
    if (!ctx.chat) return;
    const { task } = await api.task(String(ctx.chat.id), taskId);
    const { user } = await api.me(String(ctx.chat.id));
    await show(ctx, taskScreen(toCard(task, user.id), env.APP_URL, 'm:t:act'), replace);
  };

  const openStats = async (
    ctx: Context,
    boardId: string,
    days: number,
    replace: boolean,
  ): Promise<void> => {
    if (!ctx.chat) return;
    const stats = await api.boardStats(String(ctx.chat.id), boardId, days);
    await show(ctx, statsScreen(stats, boardId), replace);
  };

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
          reply_markup: new InlineKeyboard()
            .text('📋 Мои задачи', 'm:t:act')
            .text('☰ Меню', 'm:home')
            .row()
            .url('Открыть доску', env.APP_URL),
        },
      );
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('menu', async (ctx) => {
    try {
      await openHome(ctx, false);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('boards', async (ctx) => {
    if (!ctx.chat) return;
    try {
      await show(ctx, boardsScreen(await loadBoards(ctx.chat.id), 'open'), false);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('stats', async (ctx) => {
    if (!ctx.chat) return;
    try {
      await show(ctx, boardsScreen(await loadBoards(ctx.chat.id), 'stats'), false);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('new', async (ctx) => {
    if (!ctx.chat) return;
    try {
      await show(ctx, boardsScreen(await loadBoards(ctx.chat.id), 'new'), false);
    } catch (error) {
      await replyWithError(ctx, error);
    }
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '<b>Что я умею</b>',
        '',
        '/menu — меню со всем сразу',
        '',
        '<b>Задачи</b>',
        '/tasks — мои задачи · /today — что горит сегодня',
        '/overdue — просроченное · /testing — на моём тестировании',
        '/new — создать задачу, не открывая браузер',
        '',
        '<b>Доски</b>',
        '/boards — мои доски',
        '/stats — сводка по доске: что горит, что сделано, кто чем занят',
        '<i>Сводку видят владелец доски и администраторы.</i>',
        '',
        '<b>Прочее</b>',
        '/settings — уведомления и тихие часы',
        '/me — мой профиль · /logout — выйти из веба везде',
        '',
        '<b>Без команд</b>',
        '• пришлите ключ задачи — <code>KAIF-7</code> — и получите её карточку',
        '• ответьте на моё уведомление обычным сообщением — станет комментарием',
        '• под уведомлением есть кнопки: перенести, взять себе, ответить',
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

  const taskListCommand = (command: string, code: ScopeCode) => {
    bot.command(command, async (ctx) => {
      try {
        await openTaskList(ctx, code, false);
      } catch (error) {
        await replyWithError(ctx, error);
      }
    });
  };

  taskListCommand('tasks', 'act');
  taskListCommand('today', 'tod');
  taskListCommand('overdue', 'ovd');
  taskListCommand('testing', 'tst');

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

      // Навигация по меню: m:<экран>
      if (data.startsWith('m:')) {
        await ctx.answerCallbackQuery();
        const rest = data.slice(2);

        if (rest === 'home') {
          await openHome(ctx, true);
          return;
        }
        if (rest === 'b') {
          await show(ctx, boardsScreen(await loadBoards(chatId), 'open'), true);
          return;
        }
        if (rest === 'st') {
          await show(ctx, boardsScreen(await loadBoards(chatId), 'stats'), true);
          return;
        }
        if (rest === 'new') {
          await show(ctx, boardsScreen(await loadBoards(chatId), 'new'), true);
          return;
        }
        if (rest === 's') {
          const { preferences } = await api.getPreferences(String(chatId));
          await show(
            ctx,
            { text: settingsText(preferences), keyboard: settingsKeyboard(preferences) },
            true,
          );
          return;
        }
        if (rest.startsWith('t:')) {
          await openTaskList(ctx, rest.slice(2) as ScopeCode, true);
          return;
        }
        return;
      }

      // Карточка задачи: t:<taskId>
      if (data.startsWith('t:')) {
        await ctx.answerCallbackQuery();
        await openTask(ctx, data.slice(2), true);
        return;
      }

      // Сводка по доске: s:<boardId>:<дней>
      if (data.startsWith('s:')) {
        const [, boardId, days] = data.split(':');
        if (!boardId) return;
        await ctx.answerCallbackQuery();
        await openStats(ctx, boardId, Number(days) || 7, true);
        return;
      }

      // Доска выбрана для новой задачи: nb:<boardId>
      if (data.startsWith('nb:')) {
        const boardId = data.slice(3);
        await ctx.answerCallbackQuery();
        const prompt = await ctx.reply('➕ Напишите ответом на это сообщение, что нужно сделать.', {
          reply_markup: { force_reply: true, selective: true },
        });
        await state.setPending(chatId, prompt.message_id, { kind: 'new-task', taskId: boardId });
        return;
      }

      // Взять задачу себе: as:<taskId>
      if (data.startsWith('as:')) {
        const taskId = data.slice(3);
        const result = await api.assignToMe(String(chatId), taskId);
        await ctx.answerCallbackQuery(`${result.task.key} — теперь на вас`);
        await openTask(ctx, taskId, true);
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
          // Перерисовываем карточку: человек видит новое состояние там же,
          // где нажал, а не отдельным сообщением ниже.
          await openTask(ctx, taskId, true).catch(async () => {
            await ctx.reply(
              `✅ <b>${escapeHtml(result.task.key)}</b> → «${escapeHtml(columnLabel(result.task.columnKey))}»`,
              { parse_mode: 'HTML' },
            );
          });
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

    // Прислали ключ задачи — показываем карточку. Разработчику проще
    // скопировать «KAIF-7» из чата коллег, чем искать её в интерфейсе.
    if (!replyTo) {
      const key = TASK_KEY_PATTERN.exec(ctx.message.text.trim());
      if (!key) return;
      try {
        await openTask(ctx, key[0].toUpperCase(), false);
      } catch (error) {
        await replyWithError(ctx, error);
      }
      return;
    }

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

      if (pending.kind === 'new-task') {
        const created = await api.createTask(String(chatId), pending.taskId, text);
        await state.clearPending(chatId, replyTo.message_id);
        await ctx.reply(
          `✅ Создана <b>${escapeHtml(created.task.key)}</b>\n${escapeHtml(created.task.title)}`,
          {
            parse_mode: 'HTML',
            reply_markup: new InlineKeyboard()
              .text('Открыть карточку', `t:${created.task.id}`)
              .row()
              .text('‹ Меню', 'm:home'),
          },
        );
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
    await ctx.reply('Не понял. Откройте меню: /menu');
  });
}

/**
 * Ответ API — подробная задача; в чате нужна её выжимка.
 * Читаем поля мягко: бот не должен падать из-за поля, которое когда-нибудь
 * переименуют на сервере.
 */
function toCard(task: Record<string, unknown>, currentUserId: string): TaskCard {
  const person = (value: unknown): { id: string; displayName: string } | null => {
    if (!value || typeof value !== 'object') return null;
    const row = value as { id?: unknown; displayName?: unknown };
    return typeof row.id === 'string' && typeof row.displayName === 'string'
      ? { id: row.id, displayName: row.displayName }
      : null;
  };

  const assignee = person(task.assignee);
  const tester = person(task.tester);
  const board = task.board as { name?: unknown } | undefined;

  return {
    id: String(task.id ?? ''),
    key: String(task.key ?? ''),
    title: String(task.title ?? ''),
    columnKey: String(task.columnKey ?? 'TODO'),
    priority: String(task.priority ?? 'MEDIUM'),
    dueDate: typeof task.dueDate === 'string' ? task.dueDate : null,
    descriptionPreview:
      typeof task.descriptionText === 'string' && task.descriptionText.length > 0
        ? task.descriptionText
        : null,
    boardName: typeof board?.name === 'string' ? board.name : '',
    assigneeName: assignee?.displayName ?? null,
    testerName: tester?.displayName ?? null,
    commentCount: typeof task.commentCount === 'number' ? task.commentCount : 0,
    blockedByCount: typeof task.blockedByCount === 'number' ? task.blockedByCount : 0,
    isMine: assignee?.id === currentUserId,
  };
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
