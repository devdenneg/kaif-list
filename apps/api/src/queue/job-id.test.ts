import { beforeAll, describe, expect, it } from 'vitest';

let taskNotificationJobId: (userId: string, taskId: string, window: number) => string;
let singleNotificationJobId: (notificationId: string, window: number) => string;

beforeAll(async () => {
  Object.assign(process.env, {
    NODE_ENV: 'test',
    LOG_LEVEL: 'fatal',
    APP_URL: 'http://localhost:5173',
    API_URL: 'http://localhost:4998',
    DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/kaif_test?schema=public',
    REDIS_URL: 'redis://127.0.0.1:6379',
    JWT_SECRET: 'test-secret-test-secret-test-secret-1234',
    INTERNAL_API_SECRET: 'internal-secret-internal-secret-1234',
    TELEGRAM_BOT_TOKEN: '123456789:AAHfaketokenfaketokenfaketokenfaketoken',
    TELEGRAM_BOT_USERNAME: 'kaif_test_bot',
    STORAGE_DIR: './.tmp-test-storage',
    ENABLE_WORKERS: 'false',
    ENABLE_REALTIME: 'false',
  });
  ({ taskNotificationJobId, singleNotificationJobId } = await import('./index.js'));
});

/**
 * BullMQ разрешает двоеточие в идентификаторе джобы только если частей
 * ровно три — иначе бросает «Custom Id cannot contain :» и уведомление
 * не уходит вообще. Ошибка тихая: в вебе всё появляется, в Telegram — нет,
 * и заметно это только по логам сервера. Поэтому проверяем форму явно.
 */
function bullmqAccepts(jobId: string): boolean {
  return !jobId.includes(':') || jobId.split(':').length === 3;
}

describe('идентификаторы джоб доставки', () => {
  it('идентификатор по паре «человек + задача» принимается BullMQ', () => {
    expect(bullmqAccepts(taskNotificationJobId('user-1', 'task-1', 42))).toBe(true);
  });

  it('идентификатор одиночного уведомления принимается BullMQ', () => {
    expect(bullmqAccepts(singleNotificationJobId('notification-1', 42))).toBe(true);
  });

  it('окно склейки входит в идентификатор', () => {
    const first = taskNotificationJobId('user-1', 'task-1', 41);
    const second = taskNotificationJobId('user-1', 'task-1', 42);
    // Иначе второе уведомление по той же задаче не поставится в очередь,
    // пока выполненная джоба лежит в Redis — а лежит она час.
    expect(first).not.toBe(second);
  });

  it('в одном окне идентификатор один — события склеиваются в одно сообщение', () => {
    expect(taskNotificationJobId('user-1', 'task-1', 42)).toBe(
      taskNotificationJobId('user-1', 'task-1', 42),
    );
  });
});
