/** Прикладные ошибки с кодами. Наружу уходит только безопасная часть. */
export class AppError extends Error {
  readonly statusCode: number;
  readonly code: string;
  readonly fields?: Record<string, string>;
  readonly meta?: Record<string, unknown>;
  readonly expose: boolean;

  constructor(
    message: string,
    options: {
      statusCode?: number;
      code?: string;
      fields?: Record<string, string>;
      meta?: Record<string, unknown>;
      expose?: boolean;
    } = {},
  ) {
    super(message);
    this.name = 'AppError';
    this.statusCode = options.statusCode ?? 400;
    this.code = options.code ?? 'BAD_REQUEST';
    if (options.fields) this.fields = options.fields;
    if (options.meta) this.meta = options.meta;
    this.expose = options.expose ?? true;
  }
}

export class BadRequestError extends AppError {
  constructor(message = 'Некорректный запрос', fields?: Record<string, string>) {
    super(message, { statusCode: 400, code: 'BAD_REQUEST', ...(fields ? { fields } : {}) });
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = 'Требуется авторизация', code = 'UNAUTHORIZED') {
    super(message, { statusCode: 401, code });
  }
}

export class ForbiddenError extends AppError {
  constructor(message = 'Недостаточно прав', code = 'FORBIDDEN') {
    super(message, { statusCode: 403, code });
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'Не найдено', code = 'NOT_FOUND') {
    super(message, { statusCode: 404, code });
  }
}

export class ConflictError extends AppError {
  constructor(message = 'Конфликт данных', code = 'CONFLICT', fields?: Record<string, string>) {
    super(message, { statusCode: 409, code, ...(fields ? { fields } : {}) });
  }
}

export class PayloadTooLargeError extends AppError {
  constructor(message = 'Файл слишком большой') {
    super(message, { statusCode: 413, code: 'PAYLOAD_TOO_LARGE' });
  }
}

export class UnprocessableError extends AppError {
  constructor(message: string, code = 'UNPROCESSABLE', meta?: Record<string, unknown>) {
    super(message, { statusCode: 422, code, ...(meta ? { meta } : {}) });
  }
}

/**
 * Специальный случай: операция требует письменного объяснения.
 * Фронт по `reasonRequired` подсвечивает поле и просит написать причину.
 */
export class ReasonRequiredError extends UnprocessableError {
  constructor(reasonCode: string, message: string) {
    super(message, 'REASON_REQUIRED', { reasonRequired: { code: reasonCode, message } });
  }
}

export class TooManyRequestsError extends AppError {
  constructor(message = 'Слишком много запросов, попробуйте позже') {
    super(message, { statusCode: 429, code: 'TOO_MANY_REQUESTS' });
  }
}

export class InternalError extends AppError {
  constructor(message = 'Внутренняя ошибка сервера') {
    super(message, { statusCode: 500, code: 'INTERNAL_ERROR', expose: false });
  }
}
