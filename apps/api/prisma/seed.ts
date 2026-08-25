import '../src/bootstrap.js';

import {
  ColumnKey,
  COLUMN_LABELS,
  COLUMN_ORDER,
  DEFAULT_BOARD_SETTINGS,
  DEFAULT_NOTIFICATION_PREFERENCES,
  GlobalRole,
  BoardRole,
  ParticipantRole,
  TaskPriority,
  TaskType,
  docFromText,
  extractPlainText,
  ranksBetween,
} from '@kaif/shared';
import { PrismaClient } from '@prisma/client';

/**
 * Демонстрационные данные для разработки.
 *
 * Скрипт идемпотентен: повторный запуск не плодит дубли.
 * В продакшене запускать не нужно — там первая доска создаётся руками.
 */
const prisma = new PrismaClient();

const DEMO_USERS = [
  { telegramId: 900000001n, displayName: 'Ирина Смирнова', tgUsername: 'irina_pm', role: GlobalRole.SUPERADMIN },
  { telegramId: 900000002n, displayName: 'Павел Кузнецов', tgUsername: 'pavel_dev', role: GlobalRole.USER },
  { telegramId: 900000003n, displayName: 'Марина Лебедева', tgUsername: 'marina_qa', role: GlobalRole.USER },
  { telegramId: 900000004n, displayName: 'Артём Волков', tgUsername: 'artem_dev', role: GlobalRole.USER },
  { telegramId: 900000005n, displayName: 'Ольга Титова', tgUsername: 'olga_design', role: GlobalRole.USER },
];

const LABELS = [
  { name: 'Баг', color: '#ef4444' },
  { name: 'Фича', color: '#22c55e' },
  { name: 'Срочно', color: '#f97316' },
  { name: 'Документация', color: '#0ea5e9' },
  { name: 'Техдолг', color: '#64748b' },
];

interface SeedTask {
  title: string;
  description: string;
  column: ColumnKey;
  priority: TaskPriority;
  type: TaskType;
  assignee?: number;
  tester?: number;
  labels?: string[];
  dueInDays?: number | null;
  backlog?: boolean;
  points?: number;
}

const TASKS: SeedTask[] = [
  {
    title: 'Не экспортируются строки с кириллицей в CSV',
    description:
      'При выгрузке отчёта строки с кириллицей превращаются в вопросительные знаки. Воспроизводится в Excel на Windows.\n\nОжидаемо: файл открывается корректно. Фактически: кракозябры.',
    column: ColumnKey.QA,
    priority: TaskPriority.HIGH,
    type: TaskType.BUG,
    assignee: 1,
    tester: 2,
    labels: ['Баг', 'Срочно'],
    dueInDays: 1,
    points: 3,
  },
  {
    title: 'Мобильная версия доски: перетаскивание карточек',
    description:
      'Нужен долгий тап для захвата карточки, автопрокрутка у краёв экрана и виброотклик. Плюс альтернатива без перетаскивания — кнопка «Переместить».',
    column: ColumnKey.IN_PROGRESS,
    priority: TaskPriority.URGENT,
    type: TaskType.STORY,
    assignee: 3,
    labels: ['Фича'],
    dueInDays: 3,
    points: 8,
  },
  {
    title: 'Настроить резервное копирование базы',
    description: 'Ежедневный pg_dump по cron, шифрование, хранение 14 дней, проверка восстановления.',
    column: ColumnKey.TODO,
    priority: TaskPriority.MEDIUM,
    type: TaskType.CHORE,
    labels: ['Техдолг'],
    dueInDays: 7,
    points: 5,
  },
  {
    title: 'Обновить документацию по деплою',
    description: 'После перехода на Caddy инструкция устарела: убрать nginx, добавить автоматический TLS.',
    column: ColumnKey.ON_HOLD,
    priority: TaskPriority.LOW,
    type: TaskType.TASK,
    assignee: 4,
    labels: ['Документация'],
    dueInDays: -2,
    points: 2,
  },
  {
    title: 'Уведомления в Telegram о смене статуса',
    description: 'Уведомление должно приходить участникам задачи и содержать причину возврата.',
    column: ColumnKey.READY_TO_RELEASE,
    priority: TaskPriority.HIGH,
    type: TaskType.STORY,
    assignee: 1,
    tester: 2,
    labels: ['Фича'],
    dueInDays: 5,
    points: 5,
  },
  {
    title: 'Тёмная тема интерфейса',
    description: 'Токены цветов через CSS-переменные, переключатель в настройках, уважение системной темы.',
    column: ColumnKey.DONE,
    priority: TaskPriority.MEDIUM,
    type: TaskType.STORY,
    assignee: 4,
    labels: ['Фича'],
    dueInDays: null,
    points: 5,
  },
  {
    title: 'Импорт задач из таблицы',
    description: 'Загрузка CSV с колонками: заголовок, исполнитель, приоритет, срок.',
    column: ColumnKey.TODO,
    priority: TaskPriority.LOW,
    type: TaskType.TASK,
    backlog: true,
    labels: ['Фича'],
  },
  {
    title: 'Двухфакторная защита для админов',
    description: 'Подтверждение опасных операций отдельным кодом в Telegram.',
    column: ColumnKey.TODO,
    priority: TaskPriority.MEDIUM,
    type: TaskType.STORY,
    backlog: true,
  },
  {
    title: 'Метрики времени цикла по колонкам',
    description: 'Понимать, где именно задачи стоят дольше всего.',
    column: ColumnKey.TODO,
    priority: TaskPriority.LOW,
    type: TaskType.STORY,
    backlog: true,
    labels: ['Техдолг'],
  },
];

async function main(): Promise<void> {
  console.log('Наполняем базу демонстрационными данными…');

  const users = [];
  for (const demo of DEMO_USERS) {
    const user = await prisma.user.upsert({
      where: { telegramId: demo.telegramId },
      update: {},
      create: {
        telegramId: demo.telegramId,
        tgUsername: demo.tgUsername,
        displayName: demo.displayName,
        globalRole: demo.role,
        profileCompleted: true,
        avatarUrl: null,
        notificationPrefs: DEFAULT_NOTIFICATION_PREFERENCES as object,
      },
    });
    users.push(user);
  }
  console.log(`Пользователей: ${users.length}`);

  const owner = users[0];
  if (!owner) throw new Error('Не удалось создать пользователей');

  const existing = await prisma.board.findUnique({ where: { key: 'OPS' } });
  if (existing) {
    console.log('Демо-доска OPS уже существует — пропускаем.');
    return;
  }

  const board = await prisma.board.create({
    data: {
      key: 'OPS',
      name: 'Операционная работа',
      description: 'Демонстрационная доска: показывает все возможности системы.',
      color: '#6366f1',
      ownerId: owner.id,
      settings: DEFAULT_BOARD_SETTINGS as object,
      members: {
        create: users.map((user, index) => ({
          userId: user.id,
          role:
            index === 0
              ? BoardRole.OWNER
              : index === 1
                ? BoardRole.ADMIN
                : BoardRole.MEMBER,
          addedById: owner.id,
        })),
      },
      columns: {
        create: COLUMN_ORDER.map((key, index) => ({
          key,
          name: COLUMN_LABELS[key],
          order: index,
        })),
      },
      labels: { create: LABELS },
    },
    select: { id: true, key: true },
  });

  const labels = await prisma.label.findMany({ where: { boardId: board.id } });
  const labelByName = new Map(labels.map((label) => [label.name, label.id]));

  const ranks = ranksBetween(null, null, TASKS.length);

  for (const [index, seed] of TASKS.entries()) {
    const doc = docFromText(seed.description);
    const number = index + 1;
    const key = `${board.key}-${number}`;
    const assignee = seed.assignee !== undefined ? users[seed.assignee] : undefined;
    const tester = seed.tester !== undefined ? users[seed.tester] : undefined;

    const dueDate =
      seed.dueInDays === undefined || seed.dueInDays === null
        ? null
        : new Date(Date.now() + seed.dueInDays * 86_400_000);

    const task = await prisma.task.create({
      data: {
        boardId: board.id,
        number,
        key,
        title: seed.title,
        descriptionJson: doc as object,
        descriptionText: extractPlainText(doc),
        searchText: `${key} ${seed.title} ${seed.description}`.toLowerCase(),
        type: seed.type,
        priority: seed.priority,
        columnKey: seed.column,
        rank: ranks[index] ?? 'a0',
        isBacklog: seed.backlog ?? false,
        reporterId: owner.id,
        assigneeId: assignee?.id ?? null,
        testerId: tester?.id ?? null,
        storyPoints: seed.points ?? null,
        dueDate,
        completedAt: seed.column === ColumnKey.DONE ? new Date() : null,
        labels: {
          create: (seed.labels ?? [])
            .map((name) => labelByName.get(name))
            .filter((id): id is string => Boolean(id))
            .map((labelId) => ({ labelId })),
        },
        participants: {
          create: [
            { userId: owner.id, role: ParticipantRole.REPORTER },
            ...(assignee ? [{ userId: assignee.id, role: ParticipantRole.ASSIGNEE }] : []),
            ...(tester ? [{ userId: tester.id, role: ParticipantRole.TESTER }] : []),
          ],
        },
      },
      select: { id: true, key: true },
    });

    // Пара комментариев, чтобы обсуждение выглядело живым.
    if (index === 0) {
      const reason = 'Возвращаю: не экспортируются строки с кириллицей, проверял на Windows + Excel 2019.';
      await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId: users[2]?.id ?? owner.id,
          kind: 'SYSTEM',
          bodyJson: docFromText(reason) as object,
          bodyText: reason,
          systemMeta: {
            kind: 'MOVE',
            from: ColumnKey.QA,
            to: ColumnKey.IN_PROGRESS,
            reasonCode: 'MOVE_BACKWARD',
          } as object,
        },
      });
      const followUp = 'Понял, посмотрю кодировку при формировании файла. Похоже, не хватает BOM.';
      await prisma.comment.create({
        data: {
          taskId: task.id,
          authorId: users[1]?.id ?? owner.id,
          bodyJson: docFromText(followUp) as object,
          bodyText: followUp,
        },
      });
      await prisma.task.update({ where: { id: task.id }, data: { commentCount: 2 } });
    }
  }

  await prisma.board.update({
    where: { id: board.id },
    data: { taskCounter: TASKS.length },
  });

  console.log(`Доска ${board.key} создана, задач: ${TASKS.length}`);
  console.log('Готово.');
}

main()
  .catch((error) => {
    console.error('Ошибка наполнения базы:', error);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });
