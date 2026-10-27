/**
 * API client: session-cookie auth with tenant headers (spec §5 — server
 * enforces tenant scope; the web sends x-organization-id / x-branch-id).
 */
export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export interface ApiErrorInfo {
  code: string;
  message: string;
  details?: Array<{ field?: string; message: string }>;
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly status: number;
  readonly details?: Array<{ field?: string; message: string }>;

  constructor(status: number, info: ApiErrorInfo) {
    super(info.message);
    this.status = status;
    this.code = info.code;
    this.details = info.details;
  }
}

export interface ApiOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  body?: unknown;
  /** Context headers override stored selection (used by switcher endpoints). */
  organizationId?: string;
  branchId?: string | null;
}

export function getStoredTenant(): { organizationId: string; branchId: string | null } | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem('medicore.tenant');
  if (!raw) return null;
  try {
    return JSON.parse(raw) as { organizationId: string; branchId: string | null };
  } catch {
    return null;
  }
}

export function storeTenant(tenant: { organizationId: string; branchId: string | null } | null): void {
  if (tenant) window.localStorage.setItem('medicore.tenant', JSON.stringify(tenant));
  else window.localStorage.removeItem('medicore.tenant');
}

function tenantHeaders(): Record<string, string> {
  const tenant = getStoredTenant();
  const headers: Record<string, string> = {};
  if (tenant?.organizationId) headers['x-organization-id'] = tenant.organizationId;
  if (tenant?.branchId) headers['x-branch-id'] = tenant.branchId;
  return headers;
}

/** Authenticated CSV download (server sets filename via Content-Disposition). */
export async function downloadCsv(path: string, fallbackName: string): Promise<void> {
  const res = await fetch(`${API_URL}/api/v1${path}`, { credentials: 'include', headers: tenantHeaders() });
  if (!res.ok) {
    const json = (await res.json().catch(() => null)) as { error?: ApiErrorInfo } | null;
    throw new ApiClientError(res.status, json?.error ?? { code: 'INTERNAL_ERROR', message: `Export failed (${res.status})` });
  }
  const blob = await res.blob();
  const name = res.headers.get('content-disposition')?.match(/filename="?([^";]+)"?/)?.[1] ?? fallbackName;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const tenant = /^\/(auth|platform)\//.test(path) ? null : getStoredTenant();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const organizationId = opts.organizationId ?? tenant?.organizationId;
  if (organizationId) headers['x-organization-id'] = organizationId;
  const branchId = opts.branchId !== undefined ? opts.branchId : (tenant?.branchId ?? undefined);
  if (branchId) headers['x-branch-id'] = branchId;

  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1${path}`, {
      method: opts.method ?? 'GET',
      headers,
      credentials: 'include',
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    throw new ApiClientError(0, { code: 'NETWORK_ERROR', message: 'Cannot reach the MediCore server. Check your connection and try again.' });
  }

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = (json as { error?: ApiErrorInfo } | null)?.error;
    if (res.status === 401 && !path.startsWith('/auth/') && typeof window !== 'undefined') {
      window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
    }
    throw new ApiClientError(res.status, err ?? { code: 'INTERNAL_ERROR', message: `Request failed (${res.status})` });
  }
  return json as T;
}

export const UNAUTHORIZED_EVENT = 'medicore:unauthorized';

const ERROR_TITLES: Record<string, string> = {
  VALIDATION_ERROR: 'Please check the form',
  INVALID_INPUT: 'Please check the form',
  FORBIDDEN: 'You don’t have permission for this',
  NOT_FOUND: 'Not found',
  DUPLICATE_ENTITY: 'Already exists',
  CONFLICT: 'Conflicting change',
  STATE_TRANSITION_INVALID: 'Action not allowed in the current state',
  PERIOD_LOCKED: 'Accounting period is locked',
  TAX_RATE_MISSING: 'GST rate missing',
  INSUFFICIENT_STOCK: 'Not enough stock',
  BATCH_INELIGIBLE: 'Batch cannot be used',
  CREDIT_LIMIT_EXCEEDED: 'Credit limit exceeded',
  PLAN_LIMIT_REACHED: 'Plan limit reached',
  ALLOCATION_EXCEEDS_BALANCE: 'Amount exceeds the balance',
  RETURN_QUANTITY_EXCEEDS_ORIGINAL: 'Return exceeds the sold quantity',
  RECEIPT_QUANTITY_MISMATCH: 'Quantities don’t match the receipt',
  BRANCH_ACCESS_DENIED: 'No access to this branch',
  OVERSELL_BLOCKED: 'Not enough stock',
  NEGATIVE_STOCK_BLOCKED: 'Not enough stock',
  TRANSFER_QUANTITY_INVALID: 'Invalid transfer quantity',
  SUBSCRIPTION_INACTIVE: 'Subscription inactive',
  FEATURE_NOT_ENTITLED: 'Not included in your plan',
  IDEMPOTENCY_CONFLICT: 'Duplicate submission',
  SERVICE_UNAVAILABLE: 'Service unavailable',
  RATE_LIMITED: 'Too many attempts',
  NETWORK_ERROR: 'Connection problem',
};

/** Human title + detail for an error, used by toasts and banners. */
export function describeError(error: unknown, fallback = 'Something went wrong'): { title: string; message: string } {
  if (error instanceof ApiClientError) {
    const field = error.details?.find((d) => d.message);
    const message = field ? `${field.field ? `${field.field}: ` : ''}${field.message}` : error.message;
    return { title: ERROR_TITLES[error.code] ?? (error.status >= 500 ? 'Server error' : fallback), message };
  }
  return { title: fallback, message: error instanceof Error ? error.message : '' };
}
