import { io, type Socket } from 'socket.io-client';
import { SOCKET_EVENTS } from '@kaif/shared';
import { getAccessToken } from './api';

/**
 * Одно соединение на всё приложение.
 *
 * Токен передаётся в handshake; при переподключении берётся свежий,
 * поэтому ротация access-токена не рвёт реалтайм.
 */

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (socket) return socket;

  socket = io(import.meta.env.VITE_API_URL ?? '/', {
    path: '/socket.io',
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionDelay: 800,
    reconnectionDelayMax: 8000,
    auth: (callback) => callback({ token: getAccessToken() ?? '' }),
  });

  return socket;
}

export function connectSocket(): void {
  const instance = getSocket();
  if (!instance.connected) instance.connect();
}

export function disconnectSocket(): void {
  if (socket?.connected) socket.disconnect();
}

export function subscribeToBoard(boardId: string): void {
  getSocket().emit(SOCKET_EVENTS.BOARD_SUBSCRIBE, { boardId });
}

export function unsubscribeFromBoard(boardId: string): void {
  getSocket().emit(SOCKET_EVENTS.BOARD_UNSUBSCRIBE, { boardId });
}

export function subscribeToTask(taskId: string, boardId: string): void {
  getSocket().emit(SOCKET_EVENTS.TASK_SUBSCRIBE, { taskId, boardId });
}

export function unsubscribeFromTask(taskId: string, boardId: string): void {
  getSocket().emit(SOCKET_EVENTS.TASK_UNSUBSCRIBE, { taskId, boardId });
}

export function emitTyping(taskId: string, typing: boolean): void {
  getSocket().emit(typing ? SOCKET_EVENTS.TYPING_START : SOCKET_EVENTS.TYPING_STOP, { taskId });
}
