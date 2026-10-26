import { HttpException, HttpStatus } from '@nestjs/common';
import type { ErrorCode } from '@medicore/shared-types';

export interface FieldIssue {
  field?: string;
  message: string;
}

/**
 * Application exception carrying a stable machine-readable code (spec §27).
 * Never leaks internals: messages are written for API consumers.
 */
export class AppException extends HttpException {
  readonly code: ErrorCode;
  readonly details?: FieldIssue[];

  constructor(code: ErrorCode, message: string, status: HttpStatus | number, details?: FieldIssue[]) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}

export const ValidationFailed = (details: FieldIssue[]) =>
  new AppException('VALIDATION_ERROR', 'Request validation failed', HttpStatus.BAD_REQUEST, details);

export const NotFound = (message = 'Resource not found') =>
  new AppException('NOT_FOUND', message, HttpStatus.NOT_FOUND);

export const Forbidden = (message = 'You do not have permission to perform this action') =>
  new AppException('FORBIDDEN', message, HttpStatus.FORBIDDEN);

export const Conflict = (code: ErrorCode, message: string) =>
  new AppException(code, message, HttpStatus.CONFLICT);

export const Unauthenticated = (message = 'Authentication required') =>
  new AppException('UNAUTHENTICATED', message, HttpStatus.UNAUTHORIZED);

export const InvalidCredentials = () =>
  new AppException('INVALID_CREDENTIALS', 'Invalid email or password', HttpStatus.UNAUTHORIZED);

export const AccountLocked = (until: Date) =>
  new AppException(
    'ACCOUNT_LOCKED',
    `Account temporarily locked due to failed sign-in attempts until ${until.toISOString()}`,
    423, // 423 Locked — not present in Nest's HttpStatus enum
  );
