import { pino } from 'pino';
import { env } from '../config/env.js';

/** Поля, которые нельзя писать в лог ни при каких условиях. */
const REDACT = [
  'req.headers.authorization',
  'req.headers.cookie',
  'res.headers["set-cookie"]',
  '*.password',
  '*.token',
  '*.accessToken',
  '*.refreshToken',
  '*.hash',
  '*.initData',
  '*.TELEGRAM_BOT_TOKEN',
  '*.JWT_SECRET',
];

export const logger = pino({
  level: env.LOG_LEVEL,
  redact: { paths: REDACT, censor: '[скрыто]' },
  base: { service: 'api' },
  transport: env.isProduction
    ? undefined
    : {
        target: 'pino-pretty',
        options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
      },
});

export type Logger = typeof logger;
