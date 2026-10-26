# Module Catalog — MediCore

Per-module purpose, data contract, permission model, and UI states. Statuses live in the [feature verification matrix](../testing/feature-verification-matrix.md).

## Implemented (Phases 0–3)

| Module | Purpose | Key permissions | Screens | States covered |
|---|---|---|---|---|
| Auth | Registration, login, sessions, invitations, password flows | public / session | Login, Register | field errors, credential failure (non-revealing), lockout (423) |
| Dashboard | Org overview: subscription, identity, setup checklist | organization.read | Dashboard | loading, error+retry, empty checklist states |
| Users | Invite, role assignment, suspend/reactivate | users.read, users.manage | Users | loading, error, owner-protection, duplicate-invite conflict |
| Roles | System + custom roles with explicit permissions | roles.read, roles.manage | Roles | permission matrix, delete-protection (in-use), system-role lock |
| Branches | Branches, warehouses | branches.read, branches.manage | Branches | plan-limit errors surfaced, empty warehouses |
| Settings | Business profile, GST identity, FY | organization.settings.manage | Settings | server-side GSTIN/state validation errors |
| Audit | Append-only event viewer | audit.read | Audit | empty state, permission-denied |
| Products | Catalog CRUD, barcodes, change history | products.*, categories.manage | Products | loading/empty/error, duplicate SKU, validation errors |
| Vendors | Supplier master with credit terms | vendors.read/manage | Vendors | GSTIN format+state mismatch errors |
| Customers | Customer master with credit policy | customers.read/manage | Customers | empty state |
| Import | CSV import with server validation | products/vendors/customers.import | Import | per-row VALID/ERROR/DUPLICATE, commit summary |
| Batch inventory | Opening stock, batch list | inventory.opening, inventory.read | Batches | warehouse filter, expiry badges, lot merge |
| Expiry dashboard | EXPIRED/30/60/90/custom buckets | inventory.read | Expiry | zero-stock excluded, bucket counts |
| Stock ledger | Append-only movement viewer | inventory.read | Ledger | signed quantities, source documents |

## API surface (implemented)

`/api/v1/auth/*`, `/organizations*` (profile, settings, checklist, branches, warehouses, members, roles, permissions), `/audit`, `/catalog/*` (products, barcodes, categories, manufacturers, tax-rates, duplicates-check), `/partners/*` (vendors, customers), `/imports/:type/{preview,commit}`, `/inventory/*` (batches, allocate, expiry-dashboard, ledger, adjustments, transfers{,/receive,/cancel}, counts{,/post}, recalls{,/resolve}, reconcile), `/health`.

Full OpenAPI: `http://localhost:3001/api/docs` (generated from Nest decorators).

## Planned modules (Phases 4–12)

Purchasing & vendor ERP → POS & billing → returns & customer credit → accounting → GST & pharmacy compliance → multi-branch/wholesale → reporting & integrations → SaaS platform admin → hardening. Requirements and acceptance criteria accumulate in `docs/product/` as each phase lands.
