import type { ErrorCode } from '@medicore/shared-types';

export interface OperationDoc {
  summary: string;
  /** Markdown; access, permissions and plan module are appended automatically. */
  description: string;
  /** What a successful response contains. */
  returns: string;
  /** Business error codes worth handling beyond the generic 4xx set. */
  errors?: ErrorCode[];
  /** Responds with a CSV download instead of JSON. */
  csv?: boolean;
  /** Request body description for endpoints without a Zod body schema. */
  bodyDescription?: string;
  /** Example request body shown in the reference. */
  example?: unknown;
}

export const API_INTRO = `REST API for **MediCore**, a multi-tenant pharmacy ERP: product catalog, batch inventory (FEFO), purchasing, POS billing, accounting and statutory compliance.

## Base URL and versioning
All endpoints live under \`/api/v1\`. Breaking changes ship under a new version prefix.

## Authentication
1. Call \`POST /api/v1/auth/login\` (or \`/auth/register\` to create a workspace).
2. The API sets an HttpOnly \`medicore_session\` cookie. Browsers send it automatically.
3. Scripts and integrations can send the same token as \`Authorization: Bearer <token>\`.

Sessions expire after inactivity; repeated failed sign-ins lock the account temporarily.

## Workspaces (tenants)
Business endpoints act on one workspace. Send:
- \`x-organization-id\` — required; the user needs an active membership.
- \`x-branch-id\` — optional; required for branch-scoped work such as stock, POS and purchasing.

Every request is checked server-side for membership, branch assignment, role permissions and the plan's modules.

## Subscriptions
A lapsed subscription keeps data readable but blocks writes with \`402 SUBSCRIPTION_INACTIVE\`. Endpoints outside the plan return \`403 FEATURE_NOT_ENTITLED\`. A suspended workspace returns \`403\`.

## Money, quantities and dates
- Money and quantities are **decimal strings** (\`"120.50"\`, \`"2.000"\`) to avoid floating-point rounding. Amounts are in INR.
- Dates are ISO 8601 (\`2026-04-01\`); timestamps are UTC.

## Errors
Every error uses one envelope:

\`\`\`json
{ "error": { "code": "VALIDATION_ERROR", "message": "Request validation failed", "details": [{ "field": "lines.0.quantity", "message": "Required" }], "correlationId": "…" } }
\`\`\`

Branch on \`code\`, which is stable; \`message\` is for display. Send \`x-correlation-id\` to trace a request in server logs.

## Pagination
List endpoints accept \`page\` (from 1), \`pageSize\` (max 200), \`sortBy\` and \`sortDirection\`, and return \`{ items, pageInfo }\`.

## Idempotency
\`POST /sales/invoices\` accepts an \`idempotencyKey\`: retrying with the same key returns the original invoice instead of billing twice.`;

/** Tag key (as used in `@ApiTags`) → display name and description. */
export const TAGS: Record<string, { name: string; description: string }> = {
  auth: {
    name: 'Authentication',
    description: 'Sign up, sign in and out, password recovery, email verification, invitations and session management.',
  },
  organizations: {
    name: 'Organizations',
    description: 'Workspace profile and settings, branches and warehouses, members, roles and permissions, onboarding checklist and subscription.',
  },
  audit: { name: 'Audit log', description: 'Immutable record of security-relevant and business events in the workspace.' },
  catalog: {
    name: 'Catalog',
    description: 'Products, barcodes, categories, manufacturers and GST tax rates (HSN-based, effective-dated).',
  },
  imports: { name: 'Bulk import', description: 'Two-step CSV import (preview, then commit) for products, vendors and customers.' },
  partners: { name: 'Partners', description: 'Vendors (suppliers) and customers, including GST registration and credit terms.' },
  inventory: {
    name: 'Inventory',
    description: 'Batches with expiry, FEFO allocation, stock ledger, adjustments, transfers, stock counts, recalls and expiry tracking.',
  },
  purchasing: {
    name: 'Purchasing',
    description: 'Purchase orders, goods receipts (GRN), purchase invoices, vendor payments, purchase returns and vendor ledgers.',
  },
  sales: {
    name: 'Sales & POS',
    description: 'POS and wholesale invoices with FEFO batch picking, sales returns, customer receipts, outstanding balances and statements.',
  },
  accounting: {
    name: 'Accounting',
    description: 'Double-entry chart of accounts, journals and reversals, ledgers, trial balance, P&L, balance sheet, expenses and period locks.',
  },
  compliance: {
    name: 'Compliance',
    description: 'Schedule H1 register, drug licences and expiry alerts, GST sales/purchase summaries and integration settings.',
  },
  reports: { name: 'Reports', description: 'Dashboard KPIs, sales summary, stock valuation, receivable/payable aging, CSV exports and notifications.' },
  platform: {
    name: 'Platform admin',
    description: 'SaaS operator console for platform superadmins: tenants, plans and limits, subscriptions and usage.',
  },
  health: { name: 'Health', description: 'Liveness and readiness probe.' },
};

export const TAG_GROUPS: Array<{ name: string; tags: string[] }> = [
  { name: 'Getting started', tags: ['auth', 'health'] },
  { name: 'Workspace', tags: ['organizations', 'audit'] },
  { name: 'Master data', tags: ['catalog', 'partners', 'imports'] },
  { name: 'Operations', tags: ['inventory', 'purchasing', 'sales'] },
  { name: 'Finance & compliance', tags: ['accounting', 'compliance', 'reports'] },
  { name: 'SaaS administration', tags: ['platform'] },
];

/** Descriptions for path and query parameters that have no Zod description. */
export const PARAMETER_DOCS: Record<string, string> = {
  page: 'Page number, starting at 1.',
  pageSize: 'Items per page (1–200).',
  sortBy: 'Field to sort by.',
  sortDirection: 'Sort direction.',
  search: 'Case-insensitive text search.',
  from: 'Start date, inclusive (YYYY-MM-DD).',
  to: 'End date, inclusive (YYYY-MM-DD).',
  status: 'Filter by status.',
  warehouseId: 'Warehouse UUID.',
  productId: 'Product UUID.',
  batchId: 'Batch UUID.',
  vendorId: 'Vendor UUID.',
  customerId: 'Customer UUID.',
  branchId: 'Branch UUID.',
  invoiceId: 'Invoice UUID.',
  accountId: 'Ledger account UUID.',
  entryId: 'Journal entry UUID.',
  poId: 'Purchase order UUID.',
  transferId: 'Stock transfer UUID.',
  countId: 'Stock count UUID.',
  recallId: 'Recall UUID.',
  licenceId: 'Licence UUID.',
  membershipId: 'Membership UUID.',
  roleId: 'Role UUID.',
  orgId: 'Organization (tenant) UUID.',
  productIdOrBarcode: 'Product UUID or barcode.',
  id: 'Resource UUID.',
  barcode: 'Barcode value (EAN/UPC or internal code).',
  type: 'Import type: `products`, `vendors` or `customers`.',
  report: 'Report key to export.',
  asOf: 'Balance date (YYYY-MM-DD); defaults to today.',
  days: 'Look-ahead window in days.',
  sourceType: 'Filter journals by origin, e.g. `SALE`, `PURCHASE`, `MANUAL`, `EXPENSE`.',
  uninvoiced: 'When `true`, only goods receipts not yet linked to a purchase invoice.',
  unreadOnly: 'When `true`, only unread notifications.',
};

/** Keyed by operationId: `<Controller without suffix>.<handler>`. */
export const OPERATION_DOCS: Record<string, OperationDoc> = {
  // ── Health ────────────────────────────────────────────────────────────────
  'Health.health': {
    summary: 'Health check',
    description: 'Liveness and readiness probe for load balancers and uptime monitors. Verifies the database connection.',
    returns: 'Service status and database reachability.',
  },

  // ── Authentication ────────────────────────────────────────────────────────
  'Auth.register': {
    summary: 'Register a workspace',
    description:
      'Creates a new organization with its first branch and default warehouse, makes the caller its owner, starts the free trial and signs them in (sets the session cookie).',
    returns: 'The new user, organization and branch identifiers.',
    errors: ['DUPLICATE_ENTITY'],
    example: {
      organizationName: 'Sunrise Pharmacy',
      fullName: 'Asha Rao',
      email: 'asha@sunrise.example',
      password: 'CorrectHorse42',
    },
  },
  'Auth.login': {
    summary: 'Sign in',
    description:
      'Verifies email and password and starts a session. The session token is returned only as the HttpOnly `medicore_session` cookie. Repeated failures lock the account temporarily.',
    returns: 'The signed-in user ID; the session cookie is set on the response.',
    errors: ['INVALID_CREDENTIALS', 'ACCOUNT_LOCKED'],
    example: { email: 'asha@sunrise.example', password: 'CorrectHorse42' },
  },
  'Auth.logout': {
    summary: 'Sign out',
    description: 'Revokes the current session and clears the session cookie.',
    returns: 'No content.',
  },
  'Auth.me': {
    summary: 'Current user',
    description: 'Returns the signed-in user with every workspace membership, its role, permissions and accessible branches. Clients use this to build navigation and pick the active tenant.',
    returns: 'The session user with memberships.',
  },
  'Auth.forgotPassword': {
    summary: 'Request a password reset',
    description: 'Sends a single-use reset link if the email belongs to an account. Always responds the same way so account existence is never revealed.',
    returns: 'Accepted; no body.',
  },
  'Auth.resetPassword': {
    summary: 'Reset password',
    description: 'Sets a new password using the token from the reset email and revokes all existing sessions.',
    returns: 'No content.',
  },
  'Auth.verifyEmail': {
    summary: 'Verify email address',
    description: 'Confirms the account email using the token from the verification email.',
    returns: 'No content.',
  },
  'Auth.changePassword': {
    summary: 'Change password',
    description: 'Changes the password of the signed-in user after verifying the current one. Other sessions are revoked.',
    returns: 'No content.',
    errors: ['INVALID_CREDENTIALS'],
  },
  'Auth.acceptInvitation': {
    summary: 'Accept an invitation',
    description: 'Joins a workspace using an invitation token. Creates the account when the invitee is new (a password is then required).',
    returns: 'The joined organization and the user ID.',
  },
  'Auth.listSessions': {
    summary: 'List my sessions',
    description: 'Active sessions of the signed-in user with device, IP and last-seen time, so suspicious sessions can be revoked.',
    returns: 'Array of sessions; the current one is flagged.',
  },
  'Auth.revokeSession': {
    summary: 'Revoke a session',
    description: 'Signs out one of the caller’s sessions, for example a lost device.',
    returns: 'No content.',
  },

  // ── Audit ─────────────────────────────────────────────────────────────────
  'Audit.list': {
    summary: 'List audit events',
    description: 'Newest-first audit trail of the workspace: sign-ins, member and role changes, settings, postings and other sensitive actions, with the actor’s email.',
    returns: 'Paginated audit events.',
  },

  // ── Organizations ─────────────────────────────────────────────────────────
  'Organizations.permissionCatalog': {
    summary: 'Permission catalog',
    description: 'Every permission key with its description and group, used to build role editors.',
    returns: 'Array of permissions.',
  },
  'Organizations.setupChecklist': {
    summary: 'Onboarding checklist',
    description: 'Progress of the guided setup: business profile, GST, branch, warehouse, tax rates, first product and so on. `allComplete` ignores optional steps.',
    returns: 'Checklist steps with completion flags.',
  },
  'Organizations.completeSetup': {
    summary: 'Mark setup complete',
    description: 'Dismisses the onboarding checklist once all required steps are done.',
    returns: 'The updated organization.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Organizations.getSubscription': {
    summary: 'Current subscription',
    description: 'Plan, status, period end, days left, limits and current usage (branches, users, warehouses, monthly invoices) of the workspace.',
    returns: 'Subscription with limits and usage.',
  },
  'Organizations.getOrganization': {
    summary: 'Get organization profile',
    description: 'Legal and trade name, GSTIN, drug licence numbers, address, state code and settings of the active workspace.',
    returns: 'The organization.',
  },
  'Organizations.updateOrganization': {
    summary: 'Update organization profile',
    description: 'Updates business identity used on invoices and returns. The GSTIN state prefix must match the state code.',
    returns: 'The updated organization.',
  },
  'Organizations.updateSettings': {
    summary: 'Update workspace settings',
    description: 'Merges preferences such as invoice footer, rounding and default payment method into the workspace settings.',
    returns: 'The updated settings.',
    bodyDescription: 'A JSON object of settings to merge. Unknown keys are stored as-is.',
    example: { invoiceFooter: 'Thank you. Get well soon!', roundOff: true },
  },
  'Organizations.listBranches': {
    summary: 'List branches',
    description: 'Branches of the workspace with their warehouses. Users only see branches they are assigned to unless they manage all branches.',
    returns: 'Array of branches with warehouses.',
  },
  'Organizations.createBranch': {
    summary: 'Create a branch',
    description: 'Adds a shop or depot with its address and a default warehouse. Counts against the plan’s branch limit.',
    returns: 'The new branch.',
    errors: ['PLAN_LIMIT_REACHED'],
  },
  'Organizations.updateBranch': {
    summary: 'Update a branch',
    description: 'Changes name, code, address, contact or active status of a branch.',
    returns: 'The updated branch.',
  },
  'Organizations.createWarehouse': {
    summary: 'Add a warehouse to a branch',
    description: 'Creates a stock location under the branch. Setting `isDefault` makes it the branch default and unsets the previous one.',
    returns: 'The new warehouse.',
    errors: ['PLAN_LIMIT_REACHED'],
  },
  'Organizations.listMembers': {
    summary: 'List members',
    description: 'Users of the workspace with role, status and branch assignments, plus pending invitations.',
    returns: 'Array of memberships.',
  },
  'Organizations.inviteMember': {
    summary: 'Invite a member',
    description: 'Emails an invitation with a role and branch assignments. Counts against the plan’s user limit when accepted.',
    returns: 'The invitation.',
    errors: ['PLAN_LIMIT_REACHED'],
  },
  'Organizations.setMemberRole': {
    summary: 'Change a member’s role',
    description: 'Assigns a role (or none) to a member. The owner’s role cannot be changed.',
    returns: 'The updated membership.',
  },
  'Organizations.setMemberStatus': {
    summary: 'Suspend or reactivate a member',
    description: 'Suspending revokes access to this workspace immediately; their audit history is kept.',
    returns: 'The updated membership.',
  },
  'Organizations.listRoles': {
    summary: 'List roles',
    description: 'System and custom roles with their permission keys and member counts.',
    returns: 'Array of roles.',
  },
  'Organizations.createRole': {
    summary: 'Create a custom role',
    description: 'Creates a role from a set of permission keys, for example “Counter staff” or “Accountant”.',
    returns: 'The new role.',
  },
  'Organizations.roleTemplates': {
    summary: 'Role templates',
    description: 'Recommended permission sets for common pharmacy roles, to start a custom role from.',
    returns: 'Array of templates.',
  },
  'Organizations.updateRolePermissions': {
    summary: 'Update role permissions',
    description: 'Replaces the permission set of a custom role. System roles are read-only.',
    returns: 'The updated role.',
  },
  'Organizations.deleteRole': {
    summary: 'Delete a custom role',
    description: 'Deletes a custom role that no member uses.',
    returns: 'No content.',
    errors: ['STATE_TRANSITION_INVALID'],
  },

  // ── Catalog ───────────────────────────────────────────────────────────────
  'Catalog.listCategories': { summary: 'List categories', description: 'Product categories used for grouping and reports.', returns: 'Array of categories.' },
  'Catalog.createCategory': { summary: 'Create a category', description: 'Adds a product category.', returns: 'The new category.', errors: ['DUPLICATE_ENTITY'] },
  'Catalog.listManufacturers': { summary: 'List manufacturers', description: 'Drug manufacturers / marketers.', returns: 'Array of manufacturers.' },
  'Catalog.createManufacturer': { summary: 'Create a manufacturer', description: 'Adds a manufacturer.', returns: 'The new manufacturer.', errors: ['DUPLICATE_ENTITY'] },
  'Catalog.listTaxRates': {
    summary: 'List GST rates',
    description: 'HSN-wise GST rates with effective dates. Sales and purchase invoices use the rate in force on the document date.',
    returns: 'Array of tax rates.',
  },
  'Catalog.createTaxRate': {
    summary: 'Create a GST rate',
    description: 'Adds a rate for an HSN code from a start date. CGST and SGST are half the rate each; IGST equals the rate.',
    returns: 'The new tax rate.',
    errors: ['DUPLICATE_ENTITY'],
  },
  'Catalog.endTaxRate': {
    summary: 'End a GST rate',
    description: 'Closes a rate on a date, typically before adding its replacement after a GST Council change.',
    returns: 'The updated tax rate.',
  },
  'Catalog.loadStandardTaxRates': {
    summary: 'Load standard GST rates',
    description: 'Seeds the common pharmaceutical HSN rates (medicines, devices, cosmetics). Existing rates are left untouched.',
    returns: 'How many rates were created.',
  },
  'Catalog.listProducts': {
    summary: 'List products',
    description: 'Searchable product master with barcodes, prices, HSN and stock status.',
    returns: 'Paginated products.',
  },
  'Catalog.createProduct': {
    summary: 'Create a product',
    description: 'Adds a product with SKU, HSN, MRP, prices, schedule (e.g. H1), pack details and barcodes.',
    returns: 'The new product.',
    errors: ['DUPLICATE_ENTITY'],
    example: {
      sku: 'AZI-500',
      name: 'Azithromycin 500mg Tablet',
      genericName: 'Azithromycin',
      hsnCode: '30042019',
      mrp: '120.00',
      sellingPrice: '110.00',
      prescriptionClass: 'SCHEDULE_H1',
      packSize: '3 tablets',
      barcodes: ['8901234567890'],
    },
  },
  'Catalog.findByBarcode': {
    summary: 'Find product by barcode',
    description: 'Exact barcode lookup used by POS scanners.',
    returns: 'The matching product.',
  },
  'Catalog.findDuplicates': {
    summary: 'Check for duplicate products',
    description: 'Finds existing products with a similar name, the same SKU or a shared barcode, before creating a new one.',
    returns: 'Possible duplicates with the reason for each match.',
  },
  'Catalog.getProduct': { summary: 'Get a product', description: 'Full product record with barcodes and change history.', returns: 'The product.' },
  'Catalog.updateProduct': {
    summary: 'Update a product',
    description: 'Updates product fields; sending `barcodes` replaces the full barcode list. Every change is recorded in product history.',
    returns: 'The updated product.',
    errors: ['DUPLICATE_ENTITY'],
  },
  'Catalog.deactivateProduct': {
    summary: 'Deactivate a product',
    description: 'Hides the product from POS and purchasing while keeping its history and existing stock records.',
    returns: 'The updated product.',
  },

  // ── Bulk import ───────────────────────────────────────────────────────────
  'Import.preview': {
    summary: 'Preview an import',
    description: 'Validates up to the batch limit of rows without saving anything. Each row is reported as `VALID`, `ERROR` (with field messages) or `DUPLICATE` (in the file or already in the workspace).',
    returns: 'Row-by-row results and the validated rows to send to commit.',
  },
  'Import.commit': {
    summary: 'Commit an import',
    description: 'Creates the validated rows from a preview. Rows are re-validated; concurrent duplicates are skipped rather than failing the batch.',
    returns: 'Counts of created, skipped and rejected rows.',
  },

  // ── Partners ──────────────────────────────────────────────────────────────
  'Partners.listVendors': { summary: 'List vendors', description: 'Suppliers with GST registration, credit terms and status.', returns: 'Paginated vendors.' },
  'Partners.createVendor': {
    summary: 'Create a vendor',
    description: 'Adds a supplier. Registered vendors need a GSTIN whose state prefix matches the state code; input tax credit is only claimable from registered vendors.',
    returns: 'The new vendor.',
    errors: ['DUPLICATE_ENTITY'],
  },
  'Partners.getVendor': { summary: 'Get a vendor', description: 'Vendor details.', returns: 'The vendor.' },
  'Partners.updateVendor': { summary: 'Update a vendor', description: 'Updates vendor details, credit terms or status.', returns: 'The updated vendor.' },
  'Partners.listCustomers': { summary: 'List customers', description: 'Retail and wholesale customers with credit terms.', returns: 'Paginated customers.' },
  'Partners.createCustomer': {
    summary: 'Create a customer',
    description: 'Adds a customer. Wholesale customers with a GSTIN get B2B tax invoices; credit limits are enforced at billing.',
    returns: 'The new customer.',
  },
  'Partners.getCustomer': { summary: 'Get a customer', description: 'Customer details.', returns: 'The customer.' },
  'Partners.updateCustomer': { summary: 'Update a customer', description: 'Updates customer details, credit terms or status.', returns: 'The updated customer.' },

  // ── Inventory ─────────────────────────────────────────────────────────────
  'Inventory.listBatches': {
    summary: 'List batches',
    description: 'Batches with expiry, MRP, cost, status and on-hand quantity per warehouse. Filter by product, warehouse, status or expiry.',
    returns: 'Paginated batches.',
  },
  'Inventory.createBatch': {
    summary: 'Create a batch (opening stock)',
    description: 'Registers a batch with expiry and an opening quantity in a warehouse. Purchases normally create batches through goods receipts instead.',
    returns: 'The new batch.',
    errors: ['DUPLICATE_ENTITY', 'BATCH_INELIGIBLE'],
  },
  'Inventory.setBatchStatus': {
    summary: 'Change batch status',
    description: 'Moves a batch between `SALEABLE`, `QUARANTINED`, `DAMAGED` and `EXPIRED_BLOCKED`. Only saleable, unexpired batches can be billed.',
    returns: 'The updated batch.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Inventory.allocate': {
    summary: 'Preview FEFO allocation',
    description: 'Shows which batches would fulfil a quantity, earliest expiry first, skipping expired and blocked batches. Nothing is reserved.',
    returns: 'Batch allocations with quantities.',
    errors: ['INSUFFICIENT_STOCK', 'OVERSELL_BLOCKED'],
  },
  'Inventory.listTransfers': { summary: 'List stock transfers', description: 'Inter-warehouse transfers with their status.', returns: 'Paginated transfers.' },
  'Inventory.createTransfer': {
    summary: 'Create a stock transfer',
    description: 'Dispatches batches from one warehouse to another. Stock leaves the source immediately and is in transit until received.',
    returns: 'The new transfer.',
    errors: ['INSUFFICIENT_STOCK', 'TRANSFER_QUANTITY_INVALID'],
  },
  'Inventory.receiveTransfer': {
    summary: 'Receive a transfer',
    description: 'Books the in-transit stock into the destination warehouse.',
    returns: 'The updated transfer.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Inventory.cancelTransfer': {
    summary: 'Cancel a transfer',
    description: 'Cancels an in-transit transfer and returns the stock to the source warehouse.',
    returns: 'The updated transfer.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Inventory.listCounts': { summary: 'List stock counts', description: 'Physical stock counts (cycle counts and stock-takes).', returns: 'Paginated counts.' },
  'Inventory.createCount': {
    summary: 'Create a stock count',
    description: 'Records counted quantities per batch for a warehouse. Variances against system stock are calculated but not posted yet.',
    returns: 'The new count with variances.',
  },
  'Inventory.postCount': {
    summary: 'Post a stock count',
    description: 'Applies the count’s variances to stock as count-variance movements. A posted count is final.',
    returns: 'The posted count.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Inventory.listAdjustments': { summary: 'List stock adjustments', description: 'Manual stock corrections with reasons.', returns: 'Paginated adjustments.' },
  'Inventory.adjustStock': {
    summary: 'Adjust stock',
    description: 'Increases or decreases a batch’s quantity with a reason (damage, breakage, correction). Decreases cannot take stock below zero.',
    returns: 'The adjustment and resulting balance.',
    errors: ['INSUFFICIENT_STOCK'],
  },
  'Inventory.listRecalls': { summary: 'List recalls', description: 'Manufacturer or regulator batch recalls.', returns: 'Paginated recalls.' },
  'Inventory.createRecall': {
    summary: 'Create a recall',
    description: 'Flags batches under recall and quarantines their stock so they cannot be sold.',
    returns: 'The new recall.',
  },
  'Inventory.resolveRecall': {
    summary: 'Resolve a recall',
    description: 'Closes a recall after the stock has been returned or destroyed.',
    returns: 'The resolved recall.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Inventory.expiryDashboard': {
    summary: 'Expiry dashboard',
    description: 'Stock grouped into expired, expiring within 30/60/90 days and later, with quantities and cost value.',
    returns: 'Expiry buckets with batches.',
  },
  'Inventory.stockLedger': {
    summary: 'Stock ledger',
    description: 'Every stock movement (receipt, sale, return, transfer, adjustment, count) with running balance. Filter by product, batch or warehouse.',
    returns: 'Paginated movements.',
  },
  'Inventory.reconcile': {
    summary: 'Reconcile stock',
    description: 'Checks that each balance equals the sum of its movements. Use it to detect drift after migrations or incidents.',
    returns: 'Number checked, mismatches and a consistency flag.',
  },

  // ── Purchasing ────────────────────────────────────────────────────────────
  'Purchasing.listPOs': { summary: 'List purchase orders', description: 'Purchase orders with vendor, totals and status.', returns: 'Paginated purchase orders.' },
  'Purchasing.createPO': {
    summary: 'Create a purchase order',
    description: 'Drafts an order to a vendor with products, quantities and expected rates.',
    returns: 'The new purchase order.',
  },
  'Purchasing.setPOStatus': {
    summary: 'Send, confirm or cancel a PO',
    description: 'Moves a purchase order through its lifecycle: `send` (to the vendor), `confirm` (vendor accepted) or `cancel`. Received orders cannot be cancelled.',
    returns: 'The updated purchase order.',
    errors: ['STATE_TRANSITION_INVALID'],
  },
  'Purchasing.listGRNs': { summary: 'List goods receipts', description: 'Goods receipt notes (GRNs). Use `uninvoiced=true` to find receipts awaiting a vendor bill.', returns: 'Paginated goods receipts.' },
  'Purchasing.createGRN': {
    summary: 'Receive goods (GRN)',
    description: 'Books received stock into a warehouse, creating batches with expiry, MRP and cost. Updates the linked PO to partially received or received.',
    returns: 'The goods receipt with created batches.',
    errors: ['RECEIPT_QUANTITY_MISMATCH', 'BATCH_INELIGIBLE', 'DUPLICATE_ENTITY'],
  },
  'Purchasing.listInvoices': { summary: 'List purchase invoices', description: 'Vendor bills with tax breakup, paid and outstanding amounts.', returns: 'Paginated purchase invoices.' },
  'Purchasing.createPurchaseInvoice': {
    summary: 'Record a purchase invoice',
    description: 'Records a vendor bill against goods receipts and posts it to the books (inventory, input GST, vendor payable). CGST+SGST or IGST is chosen from the vendor’s state.',
    returns: 'The purchase invoice.',
    errors: ['TAX_RATE_MISSING', 'DUPLICATE_ENTITY', 'PERIOD_LOCKED'],
  },
  'Purchasing.listPayments': { summary: 'List vendor payments', description: 'Payments made to vendors with their invoice allocations.', returns: 'Paginated payments.' },
  'Purchasing.recordPayment': {
    summary: 'Pay a vendor',
    description: 'Records a cash, bank or UPI payment and allocates it to outstanding purchase invoices.',
    returns: 'The payment with allocations.',
    errors: ['ALLOCATION_EXCEEDS_BALANCE', 'PERIOD_LOCKED'],
  },
  'Purchasing.vendorLedger': {
    summary: 'Vendor ledger',
    description: 'Opening balance, invoices, payments and returns for a vendor with running balance.',
    returns: 'Ledger entries and closing balance.',
  },
  'Purchasing.listReturns': { summary: 'List purchase returns', description: 'Debit notes for stock returned to vendors.', returns: 'Paginated purchase returns.' },
  'Purchasing.createPurchaseReturn': {
    summary: 'Return goods to a vendor',
    description: 'Removes stock (e.g. expired or damaged batches) and raises a debit note that reduces the vendor payable and reverses input GST.',
    returns: 'The purchase return.',
    errors: ['RETURN_QUANTITY_EXCEEDS_ORIGINAL', 'INSUFFICIENT_STOCK', 'PERIOD_LOCKED'],
  },

  // ── Sales & POS ───────────────────────────────────────────────────────────
  'Sales.listInvoices': { summary: 'List sales invoices', description: 'Invoices with customer, totals, payments and return status.', returns: 'Paginated invoices.' },
  'Sales.createInvoice': {
    summary: 'Create a sales invoice (POS bill)',
    description:
      'Bills products to a walk-in or registered customer. Batches are picked earliest-expiry-first (or the given `explicitBatchId`), GST is computed per line, payments are recorded and the sale is posted to the books.\n\n' +
      'Schedule H1 drugs need `prescription` details and are written to the H1 register. Credit sales respect the customer’s credit limit. Retrying with the same `idempotencyKey` returns the original invoice.',
    returns: 'The invoice with lines, batch allocations, tax breakup and payments.',
    errors: ['INSUFFICIENT_STOCK', 'BATCH_INELIGIBLE', 'CREDIT_LIMIT_EXCEEDED', 'TAX_RATE_MISSING', 'PLAN_LIMIT_REACHED', 'PERIOD_LOCKED'],
    example: {
      warehouseId: '0b7f6a7e-2b1c-4d5e-8f90-1a2b3c4d5e6f',
      walkInName: 'Walk-in',
      lines: [{ productId: '4e1d2c3b-5a69-4788-9a0b-c1d2e3f4a5b6', quantity: '2', unitPrice: '110.00' }],
      payments: [{ method: 'UPI', amount: '220.00', reference: 'UPI-REF-1234' }],
      idempotencyKey: 'pos-7f3a9c21',
    },
  },
  'Sales.getInvoice': {
    summary: 'Get a sales invoice',
    description: 'Full invoice for viewing or printing: lines, batches, tax, payments, returns and the organization’s print details.',
    returns: 'The invoice.',
  },
  'Sales.listReturns': { summary: 'List sales returns', description: 'Credit notes for goods returned by customers.', returns: 'Paginated sales returns.' },
  'Sales.createReturn': {
    summary: 'Create a sales return',
    description: 'Takes back invoice lines, optionally restocking the original batches, refunds or credits the customer and reverses revenue, GST and cost of goods.',
    returns: 'The sales return (credit note).',
    errors: ['RETURN_QUANTITY_EXCEEDS_ORIGINAL', 'STATE_TRANSITION_INVALID', 'PERIOD_LOCKED'],
  },
  'Sales.recordReceipt': {
    summary: 'Record a customer receipt',
    description: 'Records money received from a credit customer and allocates it to their oldest outstanding invoices.',
    returns: 'The receipt with allocations.',
    errors: ['ALLOCATION_EXCEEDS_BALANCE', 'PERIOD_LOCKED'],
  },
  'Sales.customerOutstanding': {
    summary: 'Customer outstanding',
    description: 'Unpaid invoices of a customer with amounts due, against their credit limit.',
    returns: 'Outstanding invoices and totals.',
  },
  'Sales.customerStatement': {
    summary: 'Customer statement',
    description: 'Invoices, receipts and returns for a period with opening and closing balance.',
    returns: 'Statement entries and balances.',
  },

  // ── Accounting ────────────────────────────────────────────────────────────
  'Accounting.listAccounts': { summary: 'Chart of accounts', description: 'Ledger accounts (assets, liabilities, income, expenses, equity) with current balances.', returns: 'Array of accounts.' },
  'Accounting.accountLedger': {
    summary: 'Account ledger',
    description: 'Journal lines posted to an account in a date range, with opening and running balance.',
    returns: 'Ledger entries and balances.',
  },
  'Accounting.listJournals': { summary: 'List journal entries', description: 'Posted journals newest first, with lines and source document.', returns: 'Paginated journal entries.' },
  'Accounting.postJournal': {
    summary: 'Post a manual journal',
    description: 'Posts a balanced double-entry journal (total debits = total credits) for adjustments not covered by documents.',
    returns: 'The posted journal entry.',
    errors: ['PERIOD_LOCKED'],
  },
  'Accounting.reverseEntry': {
    summary: 'Reverse a journal entry',
    description: 'Posts a mirror-image entry to cancel a journal. Entries are never edited or deleted.',
    returns: 'The reversing journal entry.',
    errors: ['STATE_TRANSITION_INVALID', 'PERIOD_LOCKED'],
  },
  'Accounting.trialBalance': { summary: 'Trial balance', description: 'Debit and credit totals per account as of a date; `balanced` confirms the books tie.', returns: 'Trial balance rows and totals.' },
  'Accounting.profitAndLoss': {
    summary: 'Profit and loss',
    description: 'Net sales (after returns), cost of goods sold, gross profit, expenses and net profit for a period.',
    returns: 'P&L sections and totals.',
  },
  'Accounting.balanceSheet': { summary: 'Balance sheet', description: 'Assets, liabilities and equity (including current-year profit) as of a date.', returns: 'Balance sheet sections and totals.' },
  'Accounting.listPeriods': { summary: 'Accounting periods', description: 'Monthly periods and their lock status.', returns: 'Array of periods.' },
  'Accounting.setPeriodLock': {
    summary: 'Lock or unlock a period',
    description: 'Locking a month blocks any posting dated in it, for example after GST returns are filed.',
    returns: 'The updated period.',
  },
  'Expense.listExpenses': { summary: 'List expenses', description: 'Operating expenses such as rent, salaries and utilities.', returns: 'Paginated expenses.' },
  'Expense.createExpense': {
    summary: 'Record an expense',
    description: 'Records an expense paid by cash, bank or UPI and posts it to the selected expense account.',
    returns: 'The expense with its journal entry.',
    errors: ['PERIOD_LOCKED'],
  },

  // ── Compliance ────────────────────────────────────────────────────────────
  'Compliance.h1Register': {
    summary: 'Schedule H1 register',
    description: 'Statutory register of Schedule H1 sales: date, invoice, patient, prescriber, drug, batch and quantity, as required under the Drugs and Cosmetics Rules.',
    returns: 'Paginated register entries.',
  },
  'Compliance.h1RegisterExport': {
    summary: 'Export H1 register (CSV)',
    description: 'Downloads the H1 register for a period as CSV for inspection or archiving.',
    returns: 'CSV file.',
    csv: true,
  },
  'Compliance.listLicences': { summary: 'List licences', description: 'Drug licences, GST and other registrations with validity dates.', returns: 'Array of licences.' },
  'Compliance.createLicence': { summary: 'Add a licence', description: 'Records a licence number, issuing authority and validity.', returns: 'The new licence.' },
  'Compliance.updateLicence': { summary: 'Update a licence', description: 'Updates licence details, for example after renewal.', returns: 'The updated licence.' },
  'Compliance.licenceAlerts': { summary: 'Licence alerts', description: 'Licences expired or expiring within 60 days.', returns: 'Array of alerts.' },
  'Compliance.gstSalesSummary': {
    summary: 'GST sales summary',
    description: 'Outward supplies for a period split by B2B/B2C and rate, with taxable value and CGST/SGST/IGST, net of returns. Used to prepare GSTR-1 and GSTR-3B.',
    returns: 'Summary by rate and supply type.',
  },
  'Compliance.gstSalesExport': { summary: 'Export GST sales (CSV)', description: 'Downloads the invoice-level GST sales register as CSV.', returns: 'CSV file.', csv: true },
  'Compliance.gstPurchaseSummary': {
    summary: 'GST purchase summary',
    description: 'Inward supplies with input tax per vendor. Only vendors with a GSTIN are ITC-eligible; ineligible tax is reported separately.',
    returns: 'Summary with eligible and ineligible input tax.',
  },
  'Compliance.listIntegrations': {
    summary: 'List integrations',
    description: 'E-invoice, e-way bill, messaging, email and payment-gateway settings. Unconnected integrations are reported as such, never as working.',
    returns: 'Array of integration settings.',
  },
  'Compliance.upsertIntegration': { summary: 'Configure an integration', description: 'Creates or updates the settings of one integration provider.', returns: 'The integration settings.' },

  // ── Reports ───────────────────────────────────────────────────────────────
  'Reports.dashboard': {
    summary: 'Dashboard KPIs',
    description: 'Today and month-to-date sales (net of returns), receivables, payables, low stock, near-expiry stock and licence alerts.',
    returns: 'Dashboard figures.',
  },
  'Reports.salesSummary': {
    summary: 'Sales summary',
    description: 'Net sales, cost of goods and gross margin (matching the P&L), tender mix and top products for a period.',
    returns: 'Sales summary.',
  },
  'Reports.stockValuation': { summary: 'Stock valuation', description: 'On-hand quantity and value at cost per product and warehouse.', returns: 'Valuation rows and total.' },
  'Reports.aging': { summary: 'Receivable and payable aging', description: 'Outstanding customer and vendor balances bucketed by age (0–30, 31–60, 61–90, 90+ days).', returns: 'Aging buckets per party.' },
  'Reports.export': {
    summary: 'Export a report (CSV)',
    description: 'Downloads a report as CSV. `report` is one of `sales-by-product`, `sales-by-day`, `stock-valuation`, `receivables` or `payables`.',
    returns: 'CSV file.',
    csv: true,
  },
  'Reports.generateNotifications': {
    summary: 'Generate notifications',
    description: 'Creates low-stock, near-expiry and licence-expiry notifications. Safe to call repeatedly; at most one per item per day.',
    returns: 'How many notifications were created.',
  },
  'Reports.listNotifications': { summary: 'List notifications', description: 'In-app notifications for the workspace, newest first.', returns: 'Paginated notifications.' },
  'Reports.markRead': { summary: 'Mark notification read', description: 'Marks one notification as read.', returns: 'The updated notification.' },

  // ── Platform admin ────────────────────────────────────────────────────────
  'Platform.overview': {
    summary: 'Platform overview',
    description: 'Tenant counts by status and plan, trials ending soon and recent sign-ups.',
    returns: 'Platform statistics.',
  },
  'Platform.listPlans': { summary: 'List plans', description: 'Subscription plans with limits and modules.', returns: 'Array of plans.' },
  'Platform.updatePlanLimits': {
    summary: 'Update plan limits',
    description: 'Changes a plan’s limits (−1 means unlimited), included modules and API access. Applies to every tenant on the plan.',
    returns: 'The updated plan.',
  },
  'Platform.listTenants': { summary: 'List tenants', description: 'Workspaces with plan, subscription status, owner and usage. Search by name or slug.', returns: 'Paginated tenants.' },
  'Platform.assignSubscription': {
    summary: 'Assign a subscription',
    description: 'Sets a tenant’s plan, status and period length (1–1095 days), with an audit note.',
    returns: 'The updated subscription.',
  },
  'Platform.setTenantStatus': {
    summary: 'Suspend or reactivate a tenant',
    description: 'Suspending blocks every member’s access to the workspace; data is retained.',
    returns: 'The updated organization.',
  },
  'Platform.tenantUsage': { summary: 'Tenant usage', description: 'A tenant’s usage against its plan limits.', returns: 'Usage and limits.' },
};
