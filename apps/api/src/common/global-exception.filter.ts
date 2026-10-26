import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { ApiErrorEnvelope, ErrorCode } from '@medicore/shared-types';

/**
 * Global error envelope (spec §27): every error leaves as
 * { error: { code, message, details?, correlationId? } } with a correlation ID.
 * Unknown errors become INTERNAL_ERROR without stack traces or SQL (spec §27, §28).
 */
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(GlobalExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const request = ctx.getRequest<Request>();
    const response = ctx.getResponse<Response>();

    const correlationId =
      (request.headers['x-correlation-id'] as string | undefined) ?? request.correlationId ?? randomUUID();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: ErrorCode = 'INTERNAL_ERROR';
    let message = 'An unexpected error occurred';
    let details: Array<{ field?: string; message: string }> | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'object' && body !== null && 'code' in body) {
        const b = body as { code: ErrorCode; message: string; details?: typeof details };
        code = b.code;
        message = b.message;
        details = b.details;
      } else if (typeof body === 'object' && body !== null && 'message' in body) {
        // Nest built-ins (e.g. ValidationPipe, plain Forbidden/NotFound).
        const b = body as { message: string | string[]; error?: string };
        code =
          status === HttpStatus.NOT_FOUND
            ? 'NOT_FOUND'
            : status === HttpStatus.FORBIDDEN
              ? 'FORBIDDEN'
              : status === HttpStatus.UNAUTHORIZED
                ? 'UNAUTHENTICATED'
                : status === HttpStatus.CONFLICT
                  ? 'CONFLICT'
                  : (status as number) === 423
                    ? 'ACCOUNT_LOCKED'
                    : 'VALIDATION_ERROR';
        message = Array.isArray(b.message) ? 'Request validation failed' : b.message;
        details = Array.isArray(b.message) ? b.message.map((m) => ({ message: m })) : undefined;
      }
    } else {
      this.logger.error(
        `Unhandled exception on ${request.method} ${request.url}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const envelope: ApiErrorEnvelope = {
      error: { code, message, ...(details ? { details } : {}), correlationId },
    };
    response.status(status).json(envelope);
  }
}

declare module 'express' {
  interface Request {
    correlationId?: string;
  }
}
