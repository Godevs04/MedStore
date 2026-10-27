import type { Metadata } from 'next';
import '@fontsource-variable/inter';
import './globals.css';
import { Providers } from '@/lib/session';

export const metadata: Metadata = {
  title: 'MediCore — Pharmacy ERP',
  description: 'Pharmacy management, billing, distribution and SaaS platform',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
