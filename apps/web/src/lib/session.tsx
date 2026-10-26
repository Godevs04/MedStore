'use client';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@medicore/shared-types';
import { api, getStoredTenant, storeTenant } from './api';

const SessionContext = createContext<{
  user: SessionUser | null;
  isLoading: boolean;
  refetch: () => void;
  tenant: { organizationId: string; branchId: string | null } | null;
  setTenant: (t: { organizationId: string; branchId: string | null }) => void;
}>({ user: null, isLoading: true, refetch: () => {}, tenant: null, setTenant: () => {} });

export function useSession() {
  return useContext(SessionContext);
}

/** Current organization's membership info (role, owner flag, branches). */
export function useCurrentMembership() {
  const { user, tenant } = useSession();
  return useMemo(
    () =>
      user && tenant
        ? user.memberships.find((m) => m.organizationId === tenant.organizationId) ?? null
        : null,
    [user, tenant],
  );
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
      }),
  );
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tenant, setTenantState] = useState<{ organizationId: string; branchId: string | null } | null>(null);

  const loadSession = () => {
    setIsLoading(true);
    api<SessionUser>('/auth/me')
      .then((u) => {
        setUser(u);
        // Restore or initialize tenant selection.
        const stored = getStoredTenant();
        const membership =
          (stored && u.memberships.find((m) => m.organizationId === stored.organizationId)) ??
          u.memberships[0] ??
          null;
        if (membership) {
          const next = {
            organizationId: membership.organizationId,
            branchId:
              stored?.branchId && membership.branches.some((b) => b.id === stored.branchId)
                ? stored.branchId
                : (membership.branches[0]?.id ?? null),
          };
          setTenantState(next);
          storeTenant(next);
        } else {
          setTenantState(null);
        }
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  };

  useEffect(loadSession, []);

  const setTenant = (t: { organizationId: string; branchId: string | null }) => {
    setTenantState(t);
    storeTenant(t);
  };

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider
        value={{ user, isLoading, refetch: loadSession, tenant, setTenant }}
      >
        {children}
      </SessionContext.Provider>
    </QueryClientProvider>
  );
}

/** Redirects unauthenticated users to /login; renders children otherwise. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { user, isLoading } = useSession();
  const router = useRouter();
  useEffect(() => {
    if (!isLoading && !user) router.replace('/login');
  }, [isLoading, user, router]);
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center text-sm text-neutral-500">
        Loading session…
      </div>
    );
  }
  if (!user) return null;
  return <>{children}</>;
}
