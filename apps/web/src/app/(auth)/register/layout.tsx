import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Start your free trial',
  description: 'Create your MediCore pharmacy workspace and start a 14-day free trial with every module. No card needed.',
  alternates: { canonical: '/register' },
  robots: { index: true, follow: true },
};

export default function RegisterLayout({ children }: { children: ReactNode }) {
  return children;
}
