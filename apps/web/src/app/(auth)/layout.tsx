import type { ReactNode } from 'react';
import { Providers } from '@/lib/session';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return <Providers probe="hint">{children}</Providers>;
}
