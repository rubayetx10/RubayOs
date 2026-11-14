import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import mongoose from 'mongoose';
import { AppError } from '../common/errors';
import { logger } from '../config/logger';
import { isProd } from '../config/env';

export function notFoundHandler(req: Request, _res: Response, next: NextFunction) {
  next(AppError.notFound(`Route ${req.method} ${req.originalUrl} not found`));
}

function isDuplicateKey(err: unknown): err is { code: number; keyPattern?: Record<string, unknown> } {
  return typeof err === 'object' && err !== null && (err as { code?: number }).code === 11000;
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  let status = 500;
  let code = 'INTERNAL_ERROR';
  let message = 'Something went wrong on our side';
  let details: unknown;

  if (err instanceof AppError) {
    status = err.statusCode;
    code = err.code;
    message = err.message;
    details = err.details;
  } else if (err instanceof ZodError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid';
    details = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }));
  } else if (err instanceof mongoose.Error.ValidationError) {
    status = 422;
    code = 'VALIDATION_ERROR';
    message = 'Some fields are invalid';
    details = Object.values(err.errors).map((e) => ({ path: e.path, message: e.message }));
  } else if (isDuplicateKey(err)) {
    status = 409;
    code = 'DUPLICATE';
    message = 'A record with the same unique value already exists';
    details = err.keyPattern;
  } else if (typeof err === 'object' && err !== null && (err as { type?: string }).type === 'entity.parse.failed') {
    status = 400;
    code = 'BAD_JSON';
    message = 'Request body is not valid JSON';
  }

  if (status >= 500) {
    logger.error({ err, reqId: req.id }, 'Unhandled error');
    if (isProd) details = undefined;
  }

  res.status(status).json({
    success: false,
    error: { code, message, ...(details ? { details } : {}), requestId: String(req.id ?? '') },
  });
}
