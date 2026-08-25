import { describe, expect, it } from 'vitest';
import {
  BoardRole,
  GlobalRole,
  can,
  canAssignBoardRole,
  canRemoveBoardMember,
  effectiveBoardRole,
} from './index.js';

const ctx = (
  boardRole: BoardRole | null,
  extras: Partial<Parameters<typeof can>[0]> = {},
): Parameters<typeof can>[0] => ({
  globalRole: GlobalRole.USER,
  boardRole,
  ...extras,
});

describe('матрица прав', () => {
  it('не участник доски не может ничего', () => {
    expect(can(ctx(null), 'board.view')).toBe(false);
    expect(can(ctx(null), 'task.create')).toBe(false);
    expect(can(ctx(null), 'comment.create')).toBe(false);
  });

  it('наблюдатель только читает и комментирует', () => {
    expect(can(ctx(BoardRole.VIEWER), 'board.view')).toBe(true);
    expect(can(ctx(BoardRole.VIEWER), 'task.view')).toBe(true);
    expect(can(ctx(BoardRole.VIEWER), 'comment.create')).toBe(true);
    expect(can(ctx(BoardRole.VIEWER), 'task.create')).toBe(false);
    expect(can(ctx(BoardRole.VIEWER), 'task.move')).toBe(false);
  });

  it('участник работает с задачами, но не управляет доской', () => {
    expect(can(ctx(BoardRole.MEMBER), 'task.create')).toBe(true);
    expect(can(ctx(BoardRole.MEMBER), 'task.move')).toBe(true);
    expect(can(ctx(BoardRole.MEMBER), 'task.update')).toBe(true);
    expect(can(ctx(BoardRole.MEMBER), 'board.member.invite')).toBe(false);
    expect(can(ctx(BoardRole.MEMBER), 'board.label.manage')).toBe(false);
    expect(can(ctx(BoardRole.MEMBER), 'task.delete')).toBe(false);
  });

  it('участник архивирует только свои задачи', () => {
    expect(can(ctx(BoardRole.MEMBER), 'task.archive')).toBe(false);
    expect(can(ctx(BoardRole.MEMBER, { isTaskAuthor: true }), 'task.archive')).toBe(true);
    expect(can(ctx(BoardRole.MEMBER, { isTaskAssignee: true }), 'task.archive')).toBe(true);
  });

  it('чужой комментарий не редактируется никем, включая владельца', () => {
    expect(can(ctx(BoardRole.OWNER), 'comment.update')).toBe(false);
    expect(can(ctx(BoardRole.MEMBER, { isOwnResource: true }), 'comment.update')).toBe(true);
    // Удалить чужой комментарий администратор всё-таки может.
    expect(can(ctx(BoardRole.ADMIN), 'comment.delete')).toBe(true);
  });

  it('удалить доску и передать владение может только владелец', () => {
    expect(can(ctx(BoardRole.ADMIN), 'board.delete')).toBe(false);
    expect(can(ctx(BoardRole.ADMIN), 'board.transferOwnership')).toBe(false);
    expect(can(ctx(BoardRole.OWNER), 'board.delete')).toBe(true);
    expect(can(ctx(BoardRole.OWNER), 'board.transferOwnership')).toBe(true);
  });

  it('архивная доска доступна только на чтение', () => {
    const archived = ctx(BoardRole.OWNER, { boardArchived: true });
    expect(can(archived, 'board.view')).toBe(true);
    expect(can(archived, 'task.view')).toBe(true);
    expect(can(archived, 'task.create')).toBe(false);
    expect(can(archived, 'task.move')).toBe(false);
    // Разархивировать и удалить всё ещё можно.
    expect(can(archived, 'board.archive')).toBe(true);
    expect(can(archived, 'board.delete')).toBe(true);
  });

  it('суперадмин имеет права владельца на любой доске', () => {
    const admin = { globalRole: GlobalRole.SUPERADMIN, boardRole: null };
    expect(effectiveBoardRole(admin)).toBe(BoardRole.OWNER);
    expect(can(admin, 'task.create')).toBe(true);
    expect(can(admin, 'board.delete')).toBe(true);
    expect(can(admin, 'admin.panel')).toBe(true);
  });

  it('обычный пользователь не попадает в админку', () => {
    expect(can(ctx(BoardRole.OWNER), 'admin.panel')).toBe(false);
    expect(can(ctx(BoardRole.OWNER), 'admin.users.manage')).toBe(false);
  });
});

describe('назначение ролей', () => {
  it('владельца нельзя понизить и нельзя назначить второго', () => {
    expect(canAssignBoardRole(BoardRole.OWNER, BoardRole.OWNER, BoardRole.ADMIN)).toBe(false);
    expect(canAssignBoardRole(BoardRole.OWNER, BoardRole.MEMBER, BoardRole.OWNER)).toBe(false);
  });

  it('админ не трогает других админов и не выдаёт роль админа', () => {
    expect(canAssignBoardRole(BoardRole.ADMIN, BoardRole.ADMIN, BoardRole.MEMBER)).toBe(false);
    expect(canAssignBoardRole(BoardRole.ADMIN, BoardRole.MEMBER, BoardRole.ADMIN)).toBe(false);
    expect(canAssignBoardRole(BoardRole.ADMIN, BoardRole.MEMBER, BoardRole.VIEWER)).toBe(true);
  });

  it('владелец может назначить админа', () => {
    expect(canAssignBoardRole(BoardRole.OWNER, BoardRole.MEMBER, BoardRole.ADMIN)).toBe(true);
  });

  it('участник не управляет ролями', () => {
    expect(canAssignBoardRole(BoardRole.MEMBER, BoardRole.VIEWER, BoardRole.MEMBER)).toBe(false);
  });
});

describe('исключение участников', () => {
  it('владельца исключить нельзя', () => {
    expect(canRemoveBoardMember(BoardRole.OWNER, BoardRole.OWNER)).toBe(false);
    expect(canRemoveBoardMember(BoardRole.OWNER, BoardRole.OWNER, { isSelf: true })).toBe(false);
  });

  it('любой участник может выйти сам', () => {
    expect(canRemoveBoardMember(BoardRole.VIEWER, BoardRole.VIEWER, { isSelf: true })).toBe(true);
  });

  it('админ исключает только тех, кто ниже', () => {
    expect(canRemoveBoardMember(BoardRole.ADMIN, BoardRole.MEMBER)).toBe(true);
    expect(canRemoveBoardMember(BoardRole.ADMIN, BoardRole.ADMIN)).toBe(false);
  });
});
