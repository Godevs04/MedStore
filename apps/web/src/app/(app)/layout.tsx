import type { ReactNode } from 'react';
import { AppShell } from '@/components/shell';
import { RequireAuth } from '@/lib/session';

export default function AppLayout({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <AppShell>{children}</AppShell>
    </RequireAuth>
  );
}
