import type { NextFunction, Request, Response } from 'express';
// `multer` is CommonJS. A default import always works under NodeNext ESM;
// a named `{ MulterError }` import relies on cjs-module-lexer detecting it.
import multer from 'multer';
import { ZodError } from 'zod';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * One error shape for the whole API:
 *   { "error": { "code": "TOO_MANY_ROWS", "message": "…", "details"?: … } }
 *
 * The frontend switches on `code`; the human reads `message`.
 */

export class ApiError extends Error {
  override readonly name = 'ApiError';

  constructor(
    readonly status: number,
    readonly code: string,
    override readonly message: string,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({
    error: { code: 'NOT_FOUND', message: `No route matches ${req.method} ${req.path}` },
  });
}

/** Express identifies error middleware by arity — `next` must stay in the signature. */
export function errorHandler(
  error: unknown,
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (res.headersSent) {
    // An SSE stream already started. Let Express tear the socket down.
    next(error);
    return;
  }

  const { status, code, message, details } = classify(error);

  const log = status >= 500 ? logger.error : logger.warn;
  log('Request failed', {
    status,
    code,
    message,
    ...(status >= 500 && error instanceof Error ? { stack: error.stack } : {}),
  });

  res.status(status).json({
    error: {
      code,
      message,
      ...(details !== undefined ? { details } : {}),
    },
  });
}

function classify(error: unknown): {
  status: number;
  code: string;
  message: string;
  details?: unknown;
} {
  if (error instanceof ApiError) {
    return { status: error.status, code: error.code, message: error.message, details: error.details };
  }

  if (error instanceof ZodError) {
    return {
      status: 400,
      code: 'VALIDATION_ERROR',
      message: 'The request body failed validation.',
      details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    };
  }

  if (error instanceof multer.MulterError) {
    if (error.code === 'LIMIT_FILE_SIZE') {
      const mb = (env.MAX_FILE_SIZE_BYTES / 1024 / 1024).toFixed(0);
      return {
        status: 413,
        code: 'FILE_TOO_LARGE',
        message: `That file is larger than the ${mb}MB limit.`,
      };
    }
    if (error.code === 'LIMIT_UNEXPECTED_FILE') {
      return {
        status: 400,
        code: 'UNEXPECTED_FIELD',
        message: 'Upload the CSV under the form field name "file".',
      };
    }
    return { status: 400, code: `UPLOAD_${error.code}`, message: error.message };
  }

  // Never leak an internal message or a stack trace to a client in production.
  const message =
    env.NODE_ENV === 'production'
      ? 'Something went wrong on our end. Please try again.'
      : error instanceof Error
        ? error.message
        : String(error);

  return { status: 500, code: 'INTERNAL_ERROR', message };
}
