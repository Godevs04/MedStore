/**
 * Public list prices for self-serve plans, in paise, excluding GST.
 * The API computes every charge from this table; the client never sends an amount.
 */
export const PAID_PLAN_KEYS = ['STARTER', 'PROFESSIONAL', 'BUSINESS'] as const;
export type PaidPlanKey = (typeof PAID_PLAN_KEYS)[number];

export const BILLING_INTERVALS = ['MONTHLY', 'ANNUAL'] as const;
export type BillingInterval = (typeof BILLING_INTERVALS)[number];

/** GST charged on SaaS subscriptions in India. */
export const SUBSCRIPTION_GST_PERCENT = 18;

/** Annual price is about two months free. */
export const PLAN_PRICING: Record<PaidPlanKey, Record<BillingInterval, number>> = {
  STARTER: { MONTHLY: 79_900, ANNUAL: 799_900 },
  PROFESSIONAL: { MONTHLY: 199_900, ANNUAL: 1_999_900 },
  BUSINESS: { MONTHLY: 499_900, ANNUAL: 4_999_900 },
};

export interface PriceBreakdown {
  /** Price before tax, in paise. */
  basePaise: number;
  gstPaise: number;
  /** What the customer pays, in paise. */
  totalPaise: number;
}

export function priceFor(plan: PaidPlanKey, interval: BillingInterval): PriceBreakdown {
  const basePaise = PLAN_PRICING[plan][interval];
  const gstPaise = Math.round((basePaise * SUBSCRIPTION_GST_PERCENT) / 100);
  return { basePaise, gstPaise, totalPaise: basePaise + gstPaise };
}

export function isPaidPlanKey(key: string): key is PaidPlanKey {
  return (PAID_PLAN_KEYS as readonly string[]).includes(key);
}
