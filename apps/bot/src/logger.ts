import { pino } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const isProduction = process.env.NODE_ENV === 'production';

export const logger = pino({
  level,
  base: { service: 'bot' },
  redact: {
    paths: ['*.token', '*.INTERNAL_API_SECRET', '*.TELEGRAM_BOT_TOKEN'],
    censor: '[скрыто]',
  },
  transport: isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      },
});
