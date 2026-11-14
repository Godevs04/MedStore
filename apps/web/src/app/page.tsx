import type { Metadata } from 'next';
import { Landing } from '@/components/landing';

export const metadata: Metadata = {
  title: 'MediCore — Pharmacy ERP for India',
  description:
    'Batch-level inventory, GST-ready billing, purchasing, accounting and Schedule H1 registers for Indian pharmacies. 14-day free trial.',
  openGraph: {
    title: 'MediCore — Pharmacy ERP for India',
    description: 'Batch-level inventory. GST-ready billing. Compliance built in.',
    type: 'website',
  },
};

export default function Page() {
  return <Landing />;
}
