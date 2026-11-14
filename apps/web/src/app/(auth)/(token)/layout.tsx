import type { Metadata } from 'next';
import type { ReactNode } from 'react';

// One-time-link pages (reset, invitation, verification) are never search landing pages.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function TokenLayout({ children }: { children: ReactNode }) {
  return children;
}
