/** Canonical public origin of the marketing site. Override with NEXT_PUBLIC_SITE_URL for other environments. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://medicore.teamgodevs.in').replace(/\/$/, '');
export const SITE_NAME = 'MediCore';
export const SITE_TITLE = 'MediCore — Pharmacy ERP for India';
export const SITE_DESCRIPTION =
  'Pharmacy software for India: batch-level inventory, GST-ready billing, purchasing, accounting and Schedule H1 registers. Start a 14-day free trial.';
