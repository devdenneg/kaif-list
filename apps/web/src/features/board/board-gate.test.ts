import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { isBoardMissing } from './board-gate';

/**
 * «Доска не найдена, возможно её удалили» — тяжёлая фраза: человек идёт
 * выяснять, за что у него отобрали доступ. Говорить её можно, только
 * когда сервер прямо это ответил, а не когда не долетел запрос.
 */
const error = (status: number, code = 'UNKNOWN'): ApiError =>
  new ApiError(status, { code, message: 'Ошибка' });

describe('когда доска действительно недоступна', () => {
  it('404 — доски нет', () => {
    expect(isBoardMissing(error(404, 'BOARD_NOT_FOUND'))).toBe(true);
  });

  it('403 — доступа нет', () => {
    expect(isBoardMissing(error(403, 'FORBIDDEN'))).toBe(true);
  });

  it('архивная доска не считается недоступной — она открывается на чтение', () => {
    expect(isBoardMissing(error(403, 'BOARD_ARCHIVED'))).toBe(false);
  });

  it('обрыв связи — не повод говорить, что доску удалили', () => {
    expect(isBoardMissing(error(0, 'NETWORK'))).toBe(false);
  });

  it('сервер перезапускается при выкатке — тоже не повод', () => {
    expect(isBoardMissing(error(502))).toBe(false);
    expect(isBoardMissing(error(500))).toBe(false);
  });

  it('истёкший токен и лимит частоты — временные', () => {
    expect(isBoardMissing(error(401, 'TOKEN_EXPIRED'))).toBe(false);
    expect(isBoardMissing(error(429, 'RATE_LIMITED'))).toBe(false);
  });

  it('ошибка не от API — не приговор доске', () => {
    expect(isBoardMissing(new Error('что угодно'))).toBe(false);
    expect(isBoardMissing(undefined)).toBe(false);
  });
});
