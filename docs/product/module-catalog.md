# Module Catalog — MediCore

Per-module purpose, data contract, permission model, and UI states. Statuses live in the [feature verification matrix](../testing/feature-verification-matrix.md).

## Modules

| Module | Purpose | Key permissions | Screens | States covered |
|---|---|---|---|---|
| Auth | Registration, login, sessions, invitations, password flows | public / session | Login, Register, Forgot/Reset password, Accept invitation | field errors, non-revealing credential failure, lockout (423) |
| Dashboard | Live KPIs, setup checklist, alerts, recent invoices, module tiles | organization.read | `/` | loading, error+retry, checklist progress, 60 s refresh |
| Users / Roles | Invite, assign roles, custom roles | users.*, roles.* | Users, Roles | owner protection, in-use role protection |
| Branches / Settings | Branches, warehouses, business profile, GST identity | branches.*, organization.settings.manage | Branches, Settings | plan-limit errors, GSTIN/state validation |
| Configuration | Tax rate versions, standard GST loader | tax.manage | Configuration | Active / Scheduled / Ended rates, end-date action |
| Products | Catalog CRUD, barcodes, GST resolution | products.* | Products (+ edit drawer) | duplicate SKU, "No rate" badge |
| Vendors | Supplier master, ledger, open invoices | vendors.* | Vendors (+ drawer) | GSTIN mismatch, overdue badges |
| Customers | Customer master, statement, receipts | customers.*, sales.read | Customers (+ drawer) | credit limit / no limit, outstanding |
| Import | CSV import with server validation | *.import | Import | per-row VALID/ERROR/DUPLICATE |
| Batch inventory | Opening stock, batches, adjustments, transfers, counts, recalls, ledger, expiry | inventory.* | Batches, Adjustments, Transfers, Counts, Ledger, Expiry | expired/recalled blocking, reconciliation |
| Purchasing | PO → GRN → supplier invoice → payment → debit note | purchases.* | Purchasing (tabs + GRN/invoice drawers) | partial receipt, three-way mismatch, over-allocation |
| POS | Counter billing | sales.create | POS | stock/MRP/GST line issues, H1 form, split tender, change due, idempotent retry |
| Sales & returns | Invoice history, printable invoice, credit notes | sales.read, returns.* | Sales history, Invoice `/sales-history/[id]` | A4 / thermal print, returnable qty |
| Accounting | Books, statements, journals, expenses, periods | accounting.read/post | Accounting (tabs + GL drawer) | balanced badges, reversal once, locked periods |
| Compliance | H1 register, GST summaries, licences, integrations | compliance.* | Compliance | date ranges, CSV exports, licence expiry banner |
| Reports | Sales, stock valuation, aging, alerts | reports.read/export | Reports | CSV exports (audited), alert scan |
| Audit | Append-only event viewer | audit.read | Audit | permission-denied |
| Plan & billing | Current plan, trial/renewal dates, usage meters, plan comparison | organization.read | `/billing` | suspended / ended / trial banners, no-workspace state |
| Platform console | Tenants, subscriptions, suspension, plan limits | platform superadmin | `/platform` | restricted state, search, validated limit editor, suspend confirm |

## API surface

`/api/v1/auth/*`, `/organizations*`, `/audit`, `/catalog/*` (products, barcodes, categories, manufacturers, tax-rates{,/load-standard,/:id/end}), `/partners/*`, `/imports/*`, `/inventory/*`, `/purchasing/*` (purchase-orders, goods-receipts, invoices, payments, purchase-returns, vendors/:id/ledger), `/sales/*` (invoices, returns, receipts, customers/:id/{outstanding,statement}), `/accounting/*` (accounts{,/:id/ledger}, journals{,/:id/reverse}, trial-balance, profit-and-loss, balance-sheet, periods{,/lock}, expenses), `/compliance/*` (h1-register{,/export}, gst/*, licences, integrations), `/reports/*` (dashboard, sales-summary, stock-valuation, aging, export/:report, notifications), `/organizations/subscription`, `/platform/*` (overview, plans, plans/limits, tenants{,/:id/status,/:id/subscription,/:id/usage}), `/health`.

Full OpenAPI: `http://localhost:3001/api/docs`.

## Not yet built

Live external integrations (IRP e-invoice, e-way bill, payment gateways, messaging), online subscription payment collection (plans are assigned by a platform administrator), and background job infrastructure (Redis/BullMQ) — see `DECISIONS.md`.
