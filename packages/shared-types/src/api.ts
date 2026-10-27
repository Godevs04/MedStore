/**
 * Shared API contract primitives.
 *
 * These types define the wire format between apps/api and apps/web.
 * Keep them transport-level: domain enums live in ./enums, business
 * entity types are inferred from Zod schemas in @medicore/validation.
 */

/** Stable application error codes surfaced to clients. */
export const ERROR_CODES = [
  // validation
  'VALIDATION_ERROR',
  'INVALID_INPUT',
  // auth
  'UNAUTHENTICATED',
  'INVALID_CREDENTIALS',
  'SESSION_EXPIRED',
  'ACCOUNT_LOCKED',
  'EMAIL_NOT_VERIFIED',
  'MFA_REQUIRED',
  // authorization
  'FORBIDDEN',
  'BRANCH_ACCESS_DENIED',
  // tenancy
  'ORGANIZATION_NOT_FOUND',
  'BRANCH_NOT_FOUND',
  // state
  'NOT_FOUND',
  'CONFLICT',
  'DUPLICATE_ENTITY',
  'STATE_TRANSITION_INVALID',
  'PERIOD_LOCKED',
  // business invariants (spec §26)
  'INSUFFICIENT_STOCK',
  'BATCH_INELIGIBLE',
  'OVERSELL_BLOCKED',
  'ALLOCATION_EXCEEDS_BALANCE',
  'TRANSFER_QUANTITY_INVALID',
  'RETURN_QUANTITY_EXCEEDS_ORIGINAL',
  'NEGATIVE_STOCK_BLOCKED',
  'NUMBERING_SCOPE_EXHAUSTED',
  'TAX_RATE_MISSING',
  'CREDIT_LIMIT_EXCEEDED',
  'RECEIPT_QUANTITY_MISMATCH',
  // platform / subscription
  'PLAN_LIMIT_REACHED',
  'SUBSCRIPTION_INACTIVE',
  'FEATURE_NOT_ENTITLED',
  // rate limits & idempotency
  'RATE_LIMITED',
  'IDEMPOTENCY_CONFLICT',
  // infrastructure
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiError {
  code: ErrorCode;
  message: string;
  /** Field-level validation details, keyed by JSON pointer or field name. */
  details?: Array<{ field?: string; message: string }>;
  /** Correlation ID echoed for support/debugging. */
  correlationId?: string;
}

export interface ApiErrorEnvelope {
  error: ApiError;
}

export interface PageInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

export interface Paginated<T> {
  items: T[];
  pageInfo: PageInfo;
}

export interface PaginationQuery {
  page?: number;
  pageSize?: number;
  sortBy?: string;
  sortDirection?: 'asc' | 'desc';
}

/** Success envelope for mutating endpoints that carry a result. */
export interface ApiResult<T> {
  data: T;
}
