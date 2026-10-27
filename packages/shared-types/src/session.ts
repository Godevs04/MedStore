/**
 * Session/user principal shape shared by api guards and web session hooks.
 * Contains only what the client may see — no password hashes or secrets.
 */
export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  isPlatformSuperadmin: boolean;
  memberships: Array<{
    organizationId: string;
    organizationName: string;
    status: string;
    roleName: string;
    isOwner: boolean;
    /** Effective permission keys (owner = all). Server remains authoritative. */
    permissions: string[];
    branches: Array<{ id: string; name: string; code: string | null }>;
  }>;
}

export interface BranchContext {
  organizationId: string;
  branchId: string;
  /** Warehouse resolution is branch-scoped; multiple warehouses allowed. */
}

export const SESSION_COOKIE_NAME = 'medicore_session';
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days; sliding refresh in api
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_MINUTES = 15;
