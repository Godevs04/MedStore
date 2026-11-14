import type { PaidPlanKey } from '@medicore/shared-types';

export const PLANS: Array<{ name: string; key: PaidPlanKey | null; audience: string; featured?: boolean; points: string[] }> = [
  { name: 'Starter', key: 'STARTER', audience: 'Single-shop pharmacy', points: ['1 branch · 5 users', '2,000 invoices a month', 'Catalogue, inventory and POS'] },
  { name: 'Professional', key: 'PROFESSIONAL', audience: 'Growing retail', featured: true, points: ['2 branches · 15 users', '20,000 invoices a month', 'Adds purchasing and returns', 'API access'] },
  { name: 'Business', key: 'BUSINESS', audience: 'Chains and distributors', points: ['10 branches · 50 users', '200,000 invoices a month', 'Adds wholesale and accounting', 'API access'] },
  { name: 'Enterprise', key: null, audience: 'Unlimited scale', points: ['Unlimited branches and users', 'Every module', 'Integrations on request'] },
];

export const FAQ: Array<[string, string]> = [
  ['How does the free trial work?', 'Every new workspace gets 14 days with all modules and no card. When it ends your data stays readable and billing pauses until you pick a plan, so nothing is lost.'],
  ['Does it handle GST properly?', 'Yes. Rates are configured per HSN with effective dates, and each invoice splits into CGST and SGST or IGST by place of supply. Posted documents keep the rates that applied on the day.'],
  ['Do you support e-invoicing and e-way bills?', 'Not yet. The IRP and e-way bill integrations are not connected, and we would rather say so. Tax invoices, GST summaries and CSV exports are available today.'],
  ['Can I bring my existing data?', 'Products, vendors and customers import from CSV with a preview step before anything is saved, so you can fix mistakes first.'],
  ['How do I pay?', 'Monthly or yearly by UPI, card or net banking through Razorpay. Yearly plans include two months free. Prices are shown before GST, which is added at checkout.'],
  ['Who can see my data?', 'Only the people you invite, within the permissions of their role. Platform administrators manage plans and tenants, not your prescriptions or invoices.'],
];

