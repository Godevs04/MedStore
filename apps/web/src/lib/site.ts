/** Canonical public origin of the marketing site. Override with NEXT_PUBLIC_SITE_URL for other environments. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'https://medicore.teamgodevs.in').replace(/\/$/, '');
export const SITE_NAME = 'MediCore';
export const PARENT_NAME = 'Godevs';
export const PARENT_URL = 'https://teamgodevs.in';
export const SITE_TITLE = 'MediCore by Godevs: Pharmacy ERP & GST Billing for India';
export const SITE_DESCRIPTION =
  'MediCore by Godevs (teamgodevs.in) is pharmacy software for India: batch-level inventory, GST-ready billing, purchasing, accounting and Schedule H1 registers. 14-day free trial.';
