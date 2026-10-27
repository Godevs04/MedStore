'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import type { SessionUser } from '@medicore/shared-types';
import { api, ApiClientError, describeError, getStoredTenant, storeTenant, UNAUTHORIZED_EVENT } from './api';
import { toast, Toaster } from './toast';

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

declare module '@tanstack/react-query' {
  interface Register {
    mutationMeta: {
      /** Toast title shown on success; omit for the generic confirmation. */
      success?: string;
      /** Suppress the success toast (background or high-frequency actions). */
      silent?: boolean;
      /** Suppress the error toast (the page renders the error itself). */
      silentError?: boolean;
    };
  }
}

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: (count, error) => !(error instanceof ApiClientError && error.status >= 400 && error.status < 500) && count < 1,
        refetchOnWindowFocus: false,
      },
    },
    queryCache: new QueryCache({
      onError: (error) => {
        if (error instanceof ApiClientError && (error.status === 0 || error.status >= 500)) {
          const { title, message } = describeError(error);
          toast.error(title, message);
        }
      },
    }),
    mutationCache: new MutationCache({
      onSuccess: (_data, _vars, _ctx, mutation) => {
        if (mutation.meta?.silent) return;
        toast.success(mutation.meta?.success ?? 'Saved successfully');
      },
      onError: (error, _vars, _ctx, mutation) => {
        if (mutation.meta?.silentError) return;
        if (error instanceof ApiClientError && error.status === 401) return;
        const { title, message } = describeError(error);
        toast.error(title, message);
      },
    }),
  });
}

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createQueryClient);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [tenant, setTenantState] = useState<{ organizationId: string; branchId: string | null } | null>(null);

  const loadSession = useCallback(() => {
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
          if (stored?.organizationId !== next.organizationId || stored?.branchId !== next.branchId) void queryClient.resetQueries();
        } else {
          setTenantState(null);
          storeTenant(null);
          if (stored) void queryClient.resetQueries();
        }
      })
      .catch(() => setUser(null))
      .finally(() => setIsLoading(false));
  }, [queryClient]);

  useEffect(loadSession, [loadSession]);

  useEffect(() => {
    const onUnauthorized = () => {
      setUser((current) => {
        if (current) toast.warning('Your session has ended', 'Please sign in again to continue.');
        return null;
      });
      queryClient.clear();
    };
    window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
  }, [queryClient]);

  const setTenant = (t: { organizationId: string; branchId: string | null }) => {
    const changed = tenant?.organizationId !== t.organizationId || tenant?.branchId !== t.branchId;
    setTenantState(t);
    storeTenant(t);
    if (changed) void queryClient.resetQueries();
  };

  return (
    <QueryClientProvider client={queryClient}>
      <SessionContext.Provider
        value={{ user, isLoading, refetch: loadSession, tenant, setTenant }}
      >
        {children}
        <Toaster />
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
