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
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
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

export function storeTenant(tenant: { organizationId: string; branchId: string | null }): void {
  window.localStorage.setItem('medicore.tenant', JSON.stringify(tenant));
}

export async function api<T>(path: string, opts: ApiOptions = {}): Promise<T> {
  const tenant = getStoredTenant();
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const organizationId = opts.organizationId ?? tenant?.organizationId;
  if (organizationId) headers['x-organization-id'] = organizationId;
  const branchId = opts.branchId !== undefined ? opts.branchId : (tenant?.branchId ?? undefined);
  if (branchId) headers['x-branch-id'] = branchId;

  const res = await fetch(`${API_URL}/api/v1${path}`, {
    method: opts.method ?? 'GET',
    headers,
    credentials: 'include',
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });

  if (res.status === 204) return undefined as T;
  const text = await res.text();
  const json = text ? (JSON.parse(text) as unknown) : null;
  if (!res.ok) {
    const err = (json as { error?: ApiErrorInfo } | null)?.error;
    throw new ApiClientError(res.status, err ?? { code: 'INTERNAL_ERROR', message: `Request failed (${res.status})` });
  }
  return json as T;
}
