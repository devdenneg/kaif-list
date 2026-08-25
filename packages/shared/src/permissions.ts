import { BOARD_ROLE_WEIGHT, BoardRole, GlobalRole } from './enums.js';

/**
 * Единая матрица прав. Используется и на сервере (жёсткая проверка),
 * и на клиенте (скрытие кнопок). Сервер — источник истины, клиент лишь
 * повторяет решение, чтобы не показывать заведомо недоступное.
 */
export type Action =
  // Доска
  | 'board.view'
  | 'board.update'
  | 'board.settings.manage'
  | 'board.archive'
  | 'board.delete'
  | 'board.transferOwnership'
  | 'board.member.view'
  | 'board.member.invite'
  | 'board.member.remove'
  | 'board.member.changeRole'
  | 'board.label.manage'
  | 'board.column.manage'
  | 'board.analytics.view'
  // Задачи
  | 'task.view'
  | 'task.create'
  | 'task.update'
  | 'task.move'
  | 'task.assign'
  | 'task.archive'
  | 'task.delete'
  | 'task.link.manage'
  | 'task.checklist.manage'
  | 'task.watch'
  // Комментарии
  | 'comment.create'
  | 'comment.update'
  | 'comment.delete'
  // Вложения
  | 'attachment.create'
  | 'attachment.delete'
  // Бэклог
  | 'backlog.view'
  | 'backlog.manage'
  // Лента активности
  | 'activity.view'
  // Глобальная админка
  | 'admin.panel'
  | 'admin.users.manage'
  | 'admin.boards.viewAll'
  | 'admin.audit.view';

export interface AccessContext {
  /** Глобальная роль пользователя. */
  globalRole: GlobalRole;
  /** Роль на конкретной доске. `null` — пользователь не является участником доски. */
  boardRole?: BoardRole | null;
  /** Пользователь — автор задачи (reporter). */
  isTaskAuthor?: boolean;
  /** Пользователь — исполнитель задачи. */
  isTaskAssignee?: boolean;
  /** Пользователь — тестировщик задачи. */
  isTaskTester?: boolean;
  /** Пользователь — автор комментария/вложения. */
  isOwnResource?: boolean;
  /** Доска в архиве — разрешаем только чтение. */
  boardArchived?: boolean;
}

const isSuperAdmin = (ctx: AccessContext): boolean => ctx.globalRole === GlobalRole.SUPERADMIN;

const ADMIN_ACTIONS = [
  'admin.panel',
  'admin.users.manage',
  'admin.boards.viewAll',
  'admin.audit.view',
] as const;

type AdminAction = (typeof ADMIN_ACTIONS)[number];

function isAdminAction(action: Action): action is AdminAction {
  return (ADMIN_ACTIONS as readonly string[]).includes(action);
}

/**
 * Эффективная роль на доске. Суперадмин имеет полномочия владельца на любой доске —
 * это требование «админ видит и может всё».
 */
export function effectiveBoardRole(ctx: AccessContext): BoardRole | null {
  if (isSuperAdmin(ctx)) return BoardRole.OWNER;
  return ctx.boardRole ?? null;
}

function weight(role: BoardRole | null): number {
  return role ? BOARD_ROLE_WEIGHT[role] : -1;
}

/** Действия, недоступные в архивной доске (в архиве доска доступна только на чтение). */
const READ_ONLY_SAFE: readonly Action[] = [
  'board.view',
  'board.member.view',
  'task.view',
  'backlog.view',
  'activity.view',
  'admin.panel',
  'admin.boards.viewAll',
  'admin.audit.view',
  'admin.users.manage',
  // Разархивировать и удалить доску всё-таки можно
  'board.archive',
  'board.delete',
];

export function can(ctx: AccessContext, action: Action): boolean {
  // --- Глобальная админка ---
  if (isAdminAction(action)) {
    return isSuperAdmin(ctx);
  }

  const role = effectiveBoardRole(ctx);
  if (role === null) return false;

  if (ctx.boardArchived && !READ_ONLY_SAFE.includes(action)) return false;

  const w = weight(role);
  const isOwner = role === BoardRole.OWNER;
  const isAdmin = w >= BOARD_ROLE_WEIGHT.ADMIN;
  const isMember = w >= BOARD_ROLE_WEIGHT.MEMBER;
  const isViewer = w >= BOARD_ROLE_WEIGHT.VIEWER;

  switch (action) {
    // --- Доска ---
    case 'board.analytics.view':
      // Наблюдатель смотрит доску, но не разбор работы коллег по именам:
      // это внутренняя кухня команды, а не витрина для заказчика.
      return isMember;

    case 'board.view':
    case 'board.member.view':
    case 'task.view':
    case 'activity.view':
    case 'backlog.view':
    case 'task.watch':
      return isViewer;

    case 'board.update':
    case 'board.settings.manage':
    case 'board.member.invite':
    case 'board.member.remove':
    case 'board.member.changeRole':
    case 'board.label.manage':
    case 'board.column.manage':
    case 'board.archive':
    case 'backlog.manage':
      return isAdmin;

    case 'board.delete':
    case 'board.transferOwnership':
      return isOwner;

    // --- Задачи ---
    case 'task.create':
    case 'task.update':
    case 'task.move':
    case 'task.assign':
    case 'task.link.manage':
    case 'task.checklist.manage':
      return isMember;

    case 'task.archive':
      // Админ архивирует любую задачу, участник — только свою (автор или исполнитель).
      return isAdmin || (isMember && (ctx.isTaskAuthor === true || ctx.isTaskAssignee === true));

    case 'task.delete':
      // Свою задачу автор удаляет сам — иначе за каждой опечаткой при создании
      // приходится идти к администратору. Чужие задачи — только админ доски.
      return isAdmin || (isMember && ctx.isTaskAuthor === true);

    // --- Комментарии ---
    case 'comment.create':
      return isViewer;

    case 'comment.update':
      // Свой комментарий правит только автор. Чужие не правит никто — история должна быть честной.
      return isViewer && ctx.isOwnResource === true;

    case 'comment.delete':
      return (isViewer && ctx.isOwnResource === true) || isAdmin;

    // --- Вложения ---
    case 'attachment.create':
      return isMember;

    case 'attachment.delete':
      return (isMember && ctx.isOwnResource === true) || isAdmin;

    default: {
      const exhaustive: never = action;
      return exhaustive;
    }
  }
}

/** Бросает исключение-подобный `false`, удобно для читаемых проверок цепочкой. */
export function canAll(ctx: AccessContext, actions: Action[]): boolean {
  return actions.every((a) => can(ctx, a));
}

/**
 * Может ли актор назначить участнику роль `newRole`.
 * Правила:
 *  - владельца никто не понижает (передача владения — отдельная операция);
 *  - админ не может выдать роль выше или равную своей и не может трогать других админов;
 *  - владелец может всё, кроме выдачи второй роли OWNER.
 */
export function canAssignBoardRole(
  actorRole: BoardRole | null,
  targetCurrentRole: BoardRole | null,
  newRole: BoardRole,
  opts: { actorIsSuperAdmin?: boolean } = {},
): boolean {
  const effectiveActor = opts.actorIsSuperAdmin ? BoardRole.OWNER : actorRole;
  if (!effectiveActor) return false;
  if (newRole === BoardRole.OWNER) return false; // только через transferOwnership
  if (targetCurrentRole === BoardRole.OWNER) return false; // владельца не понижаем

  const actorW = weight(effectiveActor);
  if (actorW < BOARD_ROLE_WEIGHT.ADMIN) return false;

  if (effectiveActor === BoardRole.OWNER) return true;

  // Админ работает только с ролями строго ниже своей и не трогает равных себе
  const targetW = weight(targetCurrentRole);
  return targetW < BOARD_ROLE_WEIGHT.ADMIN && weight(newRole) < BOARD_ROLE_WEIGHT.ADMIN;
}

/** Может ли актор исключить участника с доски. */
export function canRemoveBoardMember(
  actorRole: BoardRole | null,
  targetRole: BoardRole | null,
  opts: { actorIsSuperAdmin?: boolean; isSelf?: boolean } = {},
): boolean {
  if (targetRole === BoardRole.OWNER) return false; // владельца исключить нельзя
  if (opts.isSelf) return true; // выйти с доски может каждый (кроме владельца)
  const effectiveActor = opts.actorIsSuperAdmin ? BoardRole.OWNER : actorRole;
  if (!effectiveActor) return false;
  const actorW = weight(effectiveActor);
  if (actorW < BOARD_ROLE_WEIGHT.ADMIN) return false;
  if (effectiveActor === BoardRole.OWNER) return true;
  return weight(targetRole) < BOARD_ROLE_WEIGHT.ADMIN;
}
