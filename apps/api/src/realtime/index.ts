import type { Server as HttpServer } from 'node:http';
import { Server as SocketServer, type Socket } from 'socket.io';
import { createAdapter } from '@socket.io/redis-adapter';
import { GlobalRole, SOCKET_EVENTS, rooms, type PresenceUser } from '@kaif/shared';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { prisma } from '../lib/prisma.js';
import { createRedisConnection, isSessionRevoked, redis } from '../lib/redis.js';
import { verifyAccessToken } from '../lib/tokens.js';
import { subscribeRealtime } from './bridge.js';

/**
 * Реалтайм-слой.
 *
 * Комнаты:
 *  - `user:<id>`  — личные уведомления;
 *  - `board:<id>` — изменения задач и присутствие;
 *  - `task:<id>`  — комментарии и «печатает…».
 *
 * Подписка на доску проверяет членство: подключение к чужой доске невозможно.
 */

interface SocketUser {
  id: string;
  displayName: string;
  avatarUrl: string | null;
  globalRole: GlobalRole;
  sessionId: string;
}

declare module 'socket.io' {
  interface Socket {
    user?: SocketUser;
  }
}

const PRESENCE_TTL_MS = 60_000;

let io: SocketServer | null = null;
let unsubscribeBridge: (() => Promise<void>) | null = null;

export function getIo(): SocketServer | null {
  return io;
}

export async function setupRealtime(httpServer: HttpServer): Promise<void> {
  io = new SocketServer(httpServer, {
    path: '/socket.io',
    serveClient: false,
    cors: { origin: env.CORS_ORIGINS, credentials: true },
    pingInterval: 25_000,
    pingTimeout: 20_000,
    maxHttpBufferSize: 1e6,
  });

  // Адаптер нужен, чтобы события доходили до клиентов при нескольких инстансах API.
  const pubClient = createRedisConnection('socket-pub');
  const subClient = createRedisConnection('socket-sub');
  io.adapter(createAdapter(pubClient, subClient));

  io.use(async (socket, next) => {
    try {
      const token =
        (socket.handshake.auth as { token?: string } | undefined)?.token ??
        (typeof socket.handshake.query.token === 'string' ? socket.handshake.query.token : null);
      if (!token) return next(new Error('UNAUTHORIZED'));

      const payload = await verifyAccessToken(token);
      if (await isSessionRevoked(payload.sid)) return next(new Error('SESSION_REVOKED'));

      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: {
          id: true,
          displayName: true,
          avatarUrl: true,
          globalRole: true,
          isActive: true,
          tokenVersion: true,
        },
      });
      if (!user || !user.isActive || user.tokenVersion !== payload.ver) {
        return next(new Error('UNAUTHORIZED'));
      }

      socket.user = {
        id: user.id,
        displayName: user.displayName,
        avatarUrl: user.avatarUrl,
        globalRole: user.globalRole,
        sessionId: payload.sid,
      };
      return next();
    } catch {
      return next(new Error('UNAUTHORIZED'));
    }
  });

  io.on('connection', (socket) => {
    const user = socket.user;
    if (!user) {
      socket.disconnect(true);
      return;
    }

    void socket.join(rooms.user(user.id));
    const joinedBoards = new Set<string>();

    socket.on(SOCKET_EVENTS.BOARD_SUBSCRIBE, async (raw: unknown) => {
      const boardId = typeof raw === 'string' ? raw : (raw as { boardId?: string })?.boardId;
      if (!boardId || typeof boardId !== 'string') return;
      const allowed = await canAccessBoard(user, boardId);
      if (!allowed) return;

      await socket.join(rooms.board(boardId));
      joinedBoards.add(boardId);
      await touchPresence(boardId, user, null);
      await broadcastPresence(boardId);
    });

    socket.on(SOCKET_EVENTS.BOARD_UNSUBSCRIBE, async (raw: unknown) => {
      const boardId = typeof raw === 'string' ? raw : (raw as { boardId?: string })?.boardId;
      if (!boardId || typeof boardId !== 'string') return;
      await socket.leave(rooms.board(boardId));
      joinedBoards.delete(boardId);
      await removePresence(boardId, user.id);
      await broadcastPresence(boardId);
    });

    socket.on(SOCKET_EVENTS.TASK_SUBSCRIBE, async (raw: unknown) => {
      const payload = normalizeTaskPayload(raw);
      if (!payload) return;
      const allowed = await canAccessBoard(user, payload.boardId);
      if (!allowed) return;
      await socket.join(rooms.task(payload.taskId));
      await touchPresence(payload.boardId, user, payload.taskId);
      await broadcastPresence(payload.boardId);
    });

    socket.on(SOCKET_EVENTS.TASK_UNSUBSCRIBE, async (raw: unknown) => {
      const payload = normalizeTaskPayload(raw);
      if (!payload) return;
      await socket.leave(rooms.task(payload.taskId));
      await touchPresence(payload.boardId, user, null);
      await broadcastPresence(payload.boardId);
    });

    socket.on(SOCKET_EVENTS.TYPING_START, (raw: unknown) => handleTyping(socket, raw, true));
    socket.on(SOCKET_EVENTS.TYPING_STOP, (raw: unknown) => handleTyping(socket, raw, false));

    socket.on('disconnect', async () => {
      for (const boardId of joinedBoards) {
        await removePresence(boardId, user.id);
        await broadcastPresence(boardId);
      }
    });
  });

  // События из бизнес-логики (в том числе из воркеров) прилетают через Redis.
  unsubscribeBridge = subscribeRealtime((event) => {
    io?.to(event.room).emit(event.event, event.data);
  });

  logger.info('Реалтайм запущен');
}

function normalizeTaskPayload(raw: unknown): { taskId: string; boardId: string } | null {
  if (!raw || typeof raw !== 'object') return null;
  const { taskId, boardId } = raw as { taskId?: unknown; boardId?: unknown };
  if (typeof taskId !== 'string' || typeof boardId !== 'string') return null;
  return { taskId, boardId };
}

function handleTyping(socket: Socket, raw: unknown, typing: boolean): void {
  const user = socket.user;
  if (!user) return;
  const payload = raw && typeof raw === 'object' ? (raw as { taskId?: unknown }) : null;
  const taskId = typeof payload?.taskId === 'string' ? payload.taskId : null;
  if (!taskId) return;
  socket.to(rooms.task(taskId)).emit(SOCKET_EVENTS.TYPING, {
    taskId,
    userId: user.id,
    displayName: user.displayName,
    typing,
  });
}

async function canAccessBoard(user: SocketUser, boardId: string): Promise<boolean> {
  if (user.globalRole === GlobalRole.SUPERADMIN) {
    const board = await prisma.board.findUnique({ where: { id: boardId }, select: { id: true } });
    return board !== null;
  }
  const membership = await prisma.boardMember.findUnique({
    where: { boardId_userId: { boardId, userId: user.id } },
    select: { userId: true },
  });
  return membership !== null;
}

// ─────────────────────────────── Присутствие ────────────────────────────────

const presenceKey = (boardId: string) => `presence:board:${boardId}`;

interface PresenceRecord extends PresenceUser {
  ts: number;
}

async function touchPresence(
  boardId: string,
  user: SocketUser,
  taskId: string | null,
): Promise<void> {
  const record: PresenceRecord = {
    userId: user.id,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    taskId,
    ts: Date.now(),
  };
  await redis.hset(presenceKey(boardId), user.id, JSON.stringify(record));
  await redis.expire(presenceKey(boardId), 3600);
}

async function removePresence(boardId: string, userId: string): Promise<void> {
  await redis.hdel(presenceKey(boardId), userId);
}

async function broadcastPresence(boardId: string): Promise<void> {
  const raw = await redis.hgetall(presenceKey(boardId));
  const now = Date.now();
  const users: PresenceUser[] = [];
  const stale: string[] = [];

  for (const [userId, value] of Object.entries(raw)) {
    try {
      const record = JSON.parse(value) as PresenceRecord;
      if (now - record.ts > PRESENCE_TTL_MS * 10) {
        stale.push(userId);
        continue;
      }
      users.push({
        userId: record.userId,
        displayName: record.displayName,
        avatarUrl: record.avatarUrl,
        taskId: record.taskId ?? null,
      });
    } catch {
      stale.push(userId);
    }
  }

  if (stale.length > 0) await redis.hdel(presenceKey(boardId), ...stale);

  io?.to(rooms.board(boardId)).emit(SOCKET_EVENTS.PRESENCE_SYNC, { boardId, users });
}

export async function shutdownRealtime(): Promise<void> {
  if (unsubscribeBridge) await unsubscribeBridge();
  await new Promise<void>((resolve) => {
    if (!io) return resolve();
    io.close(() => resolve());
  });
  io = null;
}
