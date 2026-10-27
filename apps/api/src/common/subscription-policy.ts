import { SetMetadata } from '@nestjs/common';

export const MODULE_KEY = 'requiredModule';

/** Plan module keys as stored in `SubscriptionPlan.limits.modules`. */
export type PlanModule = 'catalog' | 'inventory' | 'pos' | 'purchases' | 'returns' | 'wholesale' | 'accounting';

export const MODULE_LABELS: Record<PlanModule, string> = {
  catalog: 'Product catalog',
  inventory: 'Batch inventory',
  pos: 'POS billing',
  purchases: 'Purchasing',
  returns: 'Returns',
  wholesale: 'Wholesale',
  accounting: 'Accounting',
};

/** Marks a controller or handler as belonging to a plan-gated module. */
export const RequireModule = (module: PlanModule) => SetMetadata(MODULE_KEY, module);

export interface SubscriptionLike {
  status: string;
  trialEndsAt: Date | null;
  currentPeriodEnd: Date;
  graceEndsAt: Date | null;
}

/**
 * A lapsed subscription keeps the workspace readable (records must stay
 * accessible for statutory retention) but blocks new postings.
 */
export function subscriptionAccess(sub: SubscriptionLike, now = new Date()) {
  const end =
    sub.status === 'TRIALING'
      ? (sub.trialEndsAt ?? sub.currentPeriodEnd)
      : sub.graceEndsAt && sub.graceEndsAt > sub.currentPeriodEnd
        ? sub.graceEndsAt
        : sub.currentPeriodEnd;
  const lapsed = sub.status === 'EXPIRED' || sub.status === 'CANCELLED' || end.getTime() < now.getTime();
  const daysLeft = Math.ceil((end.getTime() - now.getTime()) / 86_400_000);
  return { lapsed, endsAt: end, daysLeft: lapsed ? 0 : Math.max(0, daysLeft) };
}

export function planIncludes(limits: unknown, module: PlanModule): boolean {
  const modules = (limits as { modules?: unknown } | null)?.modules;
  if (!Array.isArray(modules)) return true;
  return modules.includes('*') || modules.includes(module);
}

export function limitOf(limits: unknown, key: string): number | null {
  const v = (limits as Record<string, unknown> | null)?.[key];
  return typeof v === 'number' && v >= 0 ? v : null;
}
