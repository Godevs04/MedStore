/**
 * Permission catalog (spec §4): the complete set of resource.action keys.
 * Seeded into the permissions table; roles reference these by key.
 * A role grants ONLY its explicitly assigned permissions — names grant nothing.
 */

export interface PermissionDef {
  key: string;
  description: string;
}

const P = (key: string, description: string): PermissionDef => ({ key, description });

export const PERMISSIONS: readonly PermissionDef[] = [
  // organizations & branches
  P('organization.read', 'View organization profile and settings'),
  P('organization.settings.manage', 'Update organization settings and onboarding'),
  P('organization.settings.onboard', 'Complete onboarding steps'),
  P('branches.read', 'View branches and warehouses'),
  P('branches.manage', 'Create and update branches, warehouses, counters'),
  P('users.read', 'View users and memberships'),
  P('users.manage', 'Invite, suspend, and assign roles to users'),
  P('roles.read', 'View roles and their permissions'),
  P('roles.manage', 'Create and update custom roles'),
  P('audit.read', 'View the organization audit trail'),

  // subscriptions (org-side view)
  P('subscription.read', 'View subscription plan, status, and usage'),

  // master data
  P('products.read', 'View product catalog'),
  P('products.create', 'Create products'),
  P('products.update', 'Update products'),
  P('products.deactivate', 'Deactivate products'),
  P('products.import', 'Bulk import products'),
  P('vendors.read', 'View vendors'),
  P('vendors.manage', 'Create and update vendors'),
  P('vendors.import', 'Bulk import vendors'),
  P('customers.read', 'View customers'),
  P('customers.manage', 'Create and update customers'),
  P('customers.import', 'Bulk import customers'),
  P('tax.read', 'View tax configuration'),
  P('tax.manage', 'Manage versioned tax configuration'),
  P('categories.manage', 'Manage product categories and manufacturers'),

  // inventory
  P('inventory.read', 'View batches, stock levels, and the stock ledger'),
  P('inventory.opening', 'Record opening stock'),
  P('inventory.adjust', 'Post stock adjustments'),
  P('inventory.count', 'Perform and post stock counts'),
  P('inventory.transfer', 'Create and receive stock transfers'),
  P('inventory.recall', 'Create and resolve recalls; change batch status'),
  P('inventory.override.batch', 'Override FEFO batch selection (audited)'),

  // reporting
  P('reports.read', 'Run reports'),
  P('reports.export', 'Export reports and data'),
] as const;

/** Roles and their explicit permission sets. Owner implicitly gets everything. */
export const SYSTEM_ROLE_PERMISSIONS: Record<string, readonly string[]> = {
  // Organization administrator: every organization-scope permission.
  ORGANIZATION_ADMIN: PERMISSIONS.map((p) => p.key),
  PHARMACIST: [
    'products.read', 'products.create', 'products.update', 'products.deactivate',
    'inventory.read', 'inventory.opening', 'inventory.adjust', 'inventory.count',
    'inventory.transfer', 'inventory.recall', 'inventory.override.batch',
    'customers.read', 'customers.manage', 'vendors.read', 'tax.read', 'reports.read',
    'branches.read', 'users.read', 'roles.read', 'organization.read',
  ],
  STORE_MANAGER: [
    'products.read', 'products.update', 'inventory.read', 'inventory.opening',
    'inventory.adjust', 'inventory.count', 'inventory.transfer',
    'customers.read', 'customers.manage', 'vendors.read', 'reports.read', 'reports.export',
    'branches.read', 'users.read', 'roles.read', 'organization.read', 'categories.manage',
  ],
  CASHIER: [
    'products.read', 'inventory.read', 'customers.read', 'customers.manage',
    'branches.read', 'organization.read',
  ],
  INVENTORY_MANAGER: [
    'products.read', 'products.create', 'products.update', 'products.deactivate',
    'inventory.read', 'inventory.opening', 'inventory.adjust', 'inventory.count',
    'inventory.transfer', 'inventory.recall', 'vendors.read', 'tax.read',
    'reports.read', 'reports.export', 'branches.read', 'users.read', 'roles.read',
    'organization.read', 'categories.manage', 'products.import',
  ],
  PURCHASE_MANAGER: [
    'products.read', 'inventory.read', 'vendors.read', 'vendors.manage', 'vendors.import',
    'reports.read', 'reports.export', 'branches.read', 'users.read', 'roles.read', 'organization.read',
  ],
  ACCOUNTANT: [
    'products.read', 'inventory.read', 'customers.read', 'vendors.read', 'tax.read', 'tax.manage',
    'reports.read', 'reports.export', 'branches.read', 'users.read', 'roles.read', 'organization.read',
    'subscription.read',
  ],
  AUDITOR: [
    'audit.read', 'products.read', 'inventory.read', 'customers.read', 'vendors.read',
    'tax.read', 'reports.read', 'reports.export', 'branches.read', 'users.read', 'roles.read',
    'organization.read', 'subscription.read',
  ],
  ANALYST: [
    'products.read', 'inventory.read', 'customers.read', 'vendors.read', 'tax.read',
    'reports.read', 'branches.read', 'organization.read',
  ],
  PLATFORM_SUPERADMIN: [], // platform admin works via dedicated platform guard, not org permissions
};
