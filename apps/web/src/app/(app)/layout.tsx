import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell';
import { Providers, RequireAuth } from '@/lib/session';

// The signed-in application must never be indexed.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <Providers>
      <RequireAuth>
        <AppShell>{children}</AppShell>
      </RequireAuth>
    </Providers>
  );
}
