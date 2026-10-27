import type { IconName } from './icons';

export interface NavItem {
  href: string;
  label: string;
  icon: IconName;
  permission?: string;
  /** Plan module key; the item shows a lock when the plan excludes it. */
  module?: string;
  /** Extra words the command palette matches on. */
  keywords?: string;
}

export const NAV: Array<{ section: string; items: NavItem[] }> = [
  { section: 'Overview', items: [{ href: '/', label: 'Dashboard', icon: 'dashboard', keywords: 'home kpi overview' }] },
  {
    section: 'Sell',
    items: [
      { href: '/pos', label: 'POS billing', icon: 'pos', permission: 'sales.create', module: 'pos', keywords: 'bill invoice counter sale' },
      { href: '/sales-history', label: 'Sales & returns', icon: 'sales', permission: 'sales.read', keywords: 'invoices returns credit note' },
      { href: '/customers', label: 'Customers', icon: 'customers', permission: 'customers.read', keywords: 'patients receivable' },
    ],
  },
  {
    section: 'Buy',
    items: [
      { href: '/purchasing', label: 'Purchasing', icon: 'purchasing', permission: 'purchases.read', module: 'purchases', keywords: 'po grn purchase order invoice' },
      { href: '/vendors', label: 'Vendors', icon: 'vendors', permission: 'vendors.read', keywords: 'suppliers distributors payable' },
    ],
  },
  {
    section: 'Stock',
    items: [
      { href: '/products', label: 'Products', icon: 'products', permission: 'products.read', keywords: 'medicines catalog sku hsn' },
      { href: '/batches', label: 'Batch inventory', icon: 'batches', permission: 'inventory.read', keywords: 'stock lots' },
      { href: '/expiry', label: 'Expiry dashboard', icon: 'expiry', permission: 'inventory.read', keywords: 'near expiry expired' },
      { href: '/ledger', label: 'Stock ledger', icon: 'ledger', permission: 'inventory.read', keywords: 'movements history' },
      { href: '/adjustments', label: 'Adjustments', icon: 'adjustments', permission: 'inventory.adjust', keywords: 'damage breakage write off' },
      { href: '/transfers', label: 'Transfers', icon: 'transfers', permission: 'inventory.transfer', keywords: 'warehouse move' },
      { href: '/counts', label: 'Stock counts', icon: 'counts', permission: 'inventory.count', keywords: 'physical audit stocktake' },
    ],
  },
  {
    section: 'Finance & compliance',
    items: [
      { href: '/accounting', label: 'Accounting', icon: 'accounting', permission: 'accounting.read', module: 'accounting', keywords: 'journal ledger trial balance p&l expenses' },
      { href: '/compliance', label: 'Compliance', icon: 'compliance', permission: 'compliance.read', keywords: 'gst gstr schedule h1 drug licence' },
      { href: '/reports', label: 'Reports', icon: 'reports', permission: 'reports.read', keywords: 'analytics export aging valuation' },
    ],
  },
  {
    section: 'Admin',
    items: [
      { href: '/configuration', label: 'Configuration', icon: 'configuration', permission: 'tax.read', keywords: 'tax rates categories manufacturers' },
      { href: '/import', label: 'Import', icon: 'import', permission: 'products.import', keywords: 'csv bulk upload' },
      { href: '/users', label: 'Users', icon: 'users', permission: 'users.read', keywords: 'staff team invite' },
      { href: '/roles', label: 'Roles', icon: 'roles', permission: 'roles.read', keywords: 'permissions access' },
      { href: '/branches', label: 'Branches', icon: 'branches', permission: 'branches.read', keywords: 'stores warehouses locations' },
      { href: '/settings', label: 'Settings', icon: 'settings', permission: 'organization.read', keywords: 'profile gstin invoice print' },
      { href: '/billing', label: 'Plan & billing', icon: 'billing', permission: 'organization.read', keywords: 'subscription plan upgrade' },
      { href: '/audit', label: 'Audit log', icon: 'audit', permission: 'audit.read', keywords: 'activity history events' },
    ],
  },
  { section: 'Platform', items: [{ href: '/platform', label: 'Platform console', icon: 'platform', permission: 'platform', keywords: 'tenants saas admin' }] },
];

/** The nav entry that owns a pathname (longest matching prefix). */
export function findNav(pathname: string): { section: string; item: NavItem } | null {
  let best: { section: string; item: NavItem } | null = null;
  for (const group of NAV) {
    for (const item of group.items) {
      const match = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`);
      if (match && (!best || item.href.length > best.item.href.length)) best = { section: group.section, item };
    }
  }
  return best;
}
