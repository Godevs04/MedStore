# PROJECT: MEDICORE ERP
## Complete Indian Pharmacy Management, Billing, Distribution and SaaS Platform

Act as a principal software architect, senior full-stack engineer, pharmacy ERP domain specialist, database architect, QA engineer, security engineer, and SaaS product designer.

Your task is to design and implement a production-oriented, comprehensive Pharmacy ERP SaaS platform for the Indian market.

This is NOT a simple billing application, a static dashboard, a UI prototype, or a CRUD-only project.

Build an integrated business management platform covering pharmacy billing, inventory, purchasing, supplier management, distribution, taxation, accounting, regulatory recordkeeping, multi-branch operations, reporting, and SaaS administration.

The application must be modern, reliable, secure, maintainable, accessible, and suitable for commercial deployment.

Do not sacrifice business correctness for visual appearance.

Do not claim that the application is production-ready, legally compliant, or fully tested unless the relevant implementation and verification have actually been completed.

---

# 1. NON-NEGOTIABLE ENGINEERING RULES

1. Inspect the existing repository before modifying it.
2. Preserve useful existing implementations and conventions where possible.
3. Establish the complete system architecture before implementing interconnected business workflows.
4. Use TypeScript throughout the application wherever practical.
5. Implement real backend functionality for every feature presented as functional.
6. Do not use mock data in production business workflows.
7. Do not leave buttons, forms, navigation items, filters, or actions that appear functional but do nothing.
8. Do not create placeholder API endpoints and describe them as completed features.
9. Do not silently skip failed operations.
10. Never invent regulatory requirements, GST rules, medicine classifications, or compliance deadlines.
11. Research current official documentation before implementing regulatory behavior.
12. Treat regulatory requirements as versioned, configurable business rules where appropriate.
13. Never hardcode tax rates, prescription classifications, subscription entitlements, or financial thresholds throughout the codebase.
14. Avoid giant components, duplicated business logic, circular dependencies, and unstructured utility files.
15. Follow strict TypeScript rules and consistent naming conventions.
16. Validate all external inputs on the server.
17. Enforce tenant and branch authorization on the server, not just in the frontend.
18. Use database transactions for operations that modify interdependent financial or inventory records.
19. Use immutable transaction history and controlled correction workflows for posted business documents.
20. Maintain audit logs for sensitive actions.
21. Use database migrations and reproducible development environments.
22. Implement meaningful loading, empty, error, permission-denied, and success states.
23. Add automated tests for important business rules.
24. Run linting, type checking, tests, and production builds regularly.
25. Never claim a test passed without actually running it.
26. Do not suppress lint rules or TypeScript errors merely to make the build pass.
27. Do not use unsafe casts, blanket error suppression, or broad catch blocks to conceal defects.
28. Never expose secrets, credentials, prescription information, or sensitive business records in logs.
29. Do not store financial values using floating-point arithmetic.
30. Do not delete or rewrite production business data through destructive migration shortcuts.
31. Do not automatically retry non-idempotent financial operations.
32. Do not represent an external integration as operational until it has been connected and tested.
33. Record incomplete features and blockers explicitly.

When requirements are ambiguous, document the assumptions, research the relevant official documentation, and choose a conservative implementation.

When a regulatory interpretation requires a qualified professional, implement configurable controls and clearly identify the outstanding review requirement.

---

# 2. PRODUCT SCOPE

Build a multi-tenant SaaS application supporting the following operating models:

A. Independent retail medical shop.
B. Pharmacy with multiple billing counters.
C. Multi-branch retail pharmacy.
D. Medical wholesaler or distributor.
E. Hospital or institutional pharmacy.
F. Pharmacy business with central purchasing and branch-level inventory.
G. Pharmaceutical business with vendor and customer credit management.

Not every tenant will need every feature.

Implement feature entitlements and organization settings so customers can activate suitable modules without compromising the underlying data model.

Support Indian business terminology, INR, Indian numbering formats, GSTIN, HSN, Indian addresses, PIN codes, state codes, financial years, and Asia/Kolkata timezone defaults.

Provide a localization foundation for additional Indian languages, while initially shipping a complete English interface.

---

# 3. TECHNICAL ARCHITECTURE

Use the following default stack unless repository constraints justify a documented alternative.

Frontend:
- Next.js with App Router.
- React and strict TypeScript.
- Tailwind CSS.
- shadcn/ui and Radix UI.
- TanStack Query.
- TanStack Table.
- React Hook Form.
- Zod.
- Accessible keyboard interactions.

Backend:
- Node.js.
- NestJS.
- TypeScript.
- REST APIs.
- OpenAPI documentation.
- Explicit application-service and domain-service boundaries.

Database:
- PostgreSQL.
- Prisma ORM.
- Version-controlled database migrations.
- Foreign keys and database constraints.
- Explicit transaction boundaries.

Infrastructure:
- Redis for caching and distributed coordination.
- BullMQ for asynchronous jobs.
- S3-compatible object storage for attachments and documents.
- Docker for local development and deployment.
- GitHub Actions for continuous integration.
- Sentry and OpenTelemetry for observability.

Testing:
- Unit tests for calculations and business rules.
- Integration tests for database operations.
- API tests for authorization and validation.
- Playwright tests for critical user journeys.

Keep frontend, backend, database access, business logic, integrations, and background jobs logically separated.

Prefer a modular monolith with independently testable modules.

Suggested repository structure:

apps/
  web/
  api/
  worker/

packages/
  ui/
  shared-types/
  validation/
  configuration/
  business-rules/
  testing/

infrastructure/
  docker/
  deployment/
  monitoring/

docs/
  architecture/
  product/
  api/
  database/
  compliance/
  operations/

Adapt this structure to the repository when necessary.

Do not create packages or abstractions without a concrete purpose.

---

# 4. COMPLETE AUTHENTICATION AND ACCESS CONTROL

Implement:

- User registration and invitation.
- Login and logout.
- Secure password reset.
- Email verification.
- Session management.
- Optional multifactor authentication.
- Organization membership.
- Branch assignments.
- Role-based access control.
- Fine-grained permission checks.
- User activation and suspension.
- Session revocation.
- Login history.
- Failed-login protection.
- Device/session visibility where supported.
- Secure account recovery.
- Superadministrator access controls.

Create a permission system based on resources and actions.

Example permissions:

sales.read
sales.create
sales.post
sales.cancel
sales.return
purchases.read
purchases.create
purchases.approve
inventory.adjust
inventory.transfer
accounting.read
accounting.post
reports.export
users.manage
organization.settings.manage

Implement roles such as:

- Platform Superadministrator.
- Organization Owner.
- Organization Administrator.
- Pharmacist or Authorized Pharmacy Personnel.
- Store Manager.
- Cashier.
- Inventory Manager.
- Purchase Manager.
- Accountant.
- Auditor.
- Distributor Salesperson.
- Read-only Analyst.

Allow custom roles.

A role name must not automatically grant permissions beyond its explicitly assigned capabilities.

Enforce authorization in every relevant backend endpoint and business service.

---

# 5. MULTI-TENANT SAAS FOUNDATION

Implement a genuine multi-tenant architecture.

Required entities:

- Organization.
- Organization membership.
- Branch.
- Warehouse.
- Billing counter.
- Business profile.
- Subscription.
- Subscription plan.
- Feature entitlement.
- Usage record.
- Invoice series.
- Organization settings.
- Branch settings.

Every tenant-owned business record must have a clearly defined ownership scope.

Use organization and branch authorization consistently.

Prevent cross-tenant data access through:

- Server-side authorization.
- Tenant-scoped database queries.
- Appropriate composite database constraints.
- Referential integrity.
- Negative authorization tests.
- PostgreSQL row-level security where appropriate and compatible with the connection-pooling model.

Do not rely on frontend filters to isolate tenant data.

Support configurable subscription plans:

- Free trial.
- Starter.
- Professional.
- Business.
- Enterprise.

Plan limits may include:

- Number of branches.
- Number of users.
- Number of warehouses.
- Monthly transaction volume.
- Storage.
- Available modules.
- API access.
- Report retention.
- Integration access.

Make all limits configurable by platform administrators.

Implement subscription lifecycle management, renewal dates, grace periods, plan upgrades, downgrades, cancellation, payment status, and subscription audit history.

A subscription restriction must never corrupt historical invoices or prevent authorized access to required historical records.

---

# 6. ORGANIZATION SETUP AND ONBOARDING

Create a guided onboarding process.

Collect:

- Business name.
- Legal entity name.
- Organization type.
- GST registration status.
- GSTIN, when applicable.
- PAN and other required business identifiers, where appropriate.
- Registered address.
- Business address.
- State and state code.
- PIN code.
- Contact details.
- Financial year settings.
- Tax configuration.
- Invoice numbering configuration.
- Currency.
- Logo.
- Branch details.
- Pharmacy licence information and expiry dates, where applicable.
- Authorized personnel information.
- Receipt printer configuration.
- Opening inventory.
- Supplier import.
- Customer import.
- User invitations.

Validate GSTIN format and applicable state-code consistency.

Do not represent a format check as government verification.

Provide a checklist showing which setup steps remain incomplete.

The organization should not start posting real transactions until essential business settings have been configured.

---

# 7. PRODUCT AND MEDICINE MASTER

Build a comprehensive product catalog.

Each product should support:

- Product ID.
- Internal SKU.
- Product name.
- Generic or salt name.
- Brand.
- Manufacturer.
- Distributor or preferred supplier.
- Category.
- Subcategory.
- Dosage form.
- Strength.
- Pack size.
- Units per pack.
- Purchase unit.
- Sale unit.
- Conversion factors.
- Barcode and alternate barcodes.
- HSN code.
- Applicable tax classification.
- MRP.
- Purchase price.
- Selling price.
- Trade price.
- Wholesale price.
- Minimum selling price rules where legally and commercially appropriate.
- Prescription classification.
- Applicable drug schedule.
- Storage instructions.
- Refrigeration requirement.
- Rack and shelf location.
- Reorder level.
- Maximum stock level.
- Minimum order quantity.
- Manufacturer details.
- Product image.
- Active or inactive status.

Allow multiple barcodes and supplier-specific product codes.

Distinguish the product master from individual inventory batches.

A medicine may have many batches with different expiry dates, purchase rates, MRP values, suppliers, and remaining quantities.

Implement generic search and clinically relevant product attributes without automatically recommending therapeutic substitutions.

Substitution should be governed by authorized staff and applicable rules.

Provide:

- Product import.
- Bulk editing.
- Duplicate detection.
- Import validation.
- Export.
- Category management.
- Brand management.
- Manufacturer management.
- Unit management.
- Tax classification management.
- Product change history.

Never merge potentially different strengths, dosage forms, or formulations merely because their names are similar.

---

# 8. BATCH-LEVEL INVENTORY ENGINE

Inventory must be batch-aware throughout the application.

Each batch should include:

- Product.
- Batch number.
- Manufacturer.
- Supplier.
- Manufacturing date, when available.
- Expiry date.
- Received quantity.
- Free quantity.
- Purchase rate.
- MRP.
- Tax information.
- Landed cost.
- Warehouse.
- Branch.
- Stock status.
- Quarantine status.
- Source purchase document.
- Traceability references.

Support:

- Opening stock.
- Goods receipt.
- Purchase receipt.
- Stock transfers.
- Sales deductions.
- Sales returns.
- Purchase returns.
- Expiry returns.
- Damage and breakage.
- Quarantine.
- Recall.
- Stock adjustments.
- Physical stock counts.
- Cycle counts.
- Stock reconciliation.
- Stock reservations where appropriate.
- Stock ledger.
- Inventory valuation.
- Negative-stock prevention.

Implement FEFO: First Expired, First Out.

When several batches are available, propose the earliest suitable expiry batch first.

Authorized users may select another eligible batch, subject to policy and audit requirements.

Never permit a sale from an expired, recalled, quarantined, or otherwise ineligible batch.

Implement configurable expiry alerts:

- Expired.
- Expiring within 30 days.
- Expiring within 60 days.
- Expiring within 90 days.
- Other configurable periods.

Calculate stock availability from reliable inventory movements and reservation rules.

Use an append-only inventory movement ledger as the source of truth, with transactionally maintained balance records where needed for performance.

Record the actor, source document, timestamp, batch, quantity, location, and reason for every movement.

Use compensating transactions for correcting posted stock movements.

Never silently rewrite historical inventory movements.

---

# 9. PURCHASE MANAGEMENT

Implement the entire purchasing lifecycle.

Purchase workflow:

1. Review low-stock and reorder suggestions.
2. Create a purchase requisition.
3. Select supplier.
4. Compare supplier prices.
5. Create purchase order.
6. Submit for approval if required.
7. Send or print the purchase order.
8. Record supplier confirmation.
9. Receive goods.
10. Inspect received products.
11. Capture batch and expiry details.
12. Reconcile ordered and received quantities.
13. Record free goods and promotional schemes.
14. Record shortages, damages, and rejected goods.
15. Create or import the supplier invoice.
16. Validate taxes and totals.
17. Post inventory and supplier liability.
18. Record payments.
19. Reconcile the supplier statement.
20. Complete the purchasing workflow.

Support partial deliveries and multiple receipts against one purchase order.

Support purchase invoice import through structured files and carefully validated document extraction.

Never post extracted OCR values without appropriate validation and authorization.

Handle supplier invoices that arrive before or after goods receipt.

Prevent duplicate invoice posting using supplier identity, invoice number, date, and other relevant matching attributes.

Create supplier-specific purchase histories and price comparisons.

Support purchase schemes such as:

- Buy X, get Y free.
- Quantity discounts.
- Percentage discounts.
- Invoice-level discounts.
- Product-specific discounts.
- Supplier-specific negotiated rates.

Clearly distinguish free stock, taxable values, discounts, purchase cost, and accounting treatment.

Do not assume every scheme has the same tax or accounting treatment.

---

# 10. VENDOR AND DISTRIBUTOR ERP

Implement a vendor management system suitable for pharmacy retailers, wholesalers, and distributors.

Vendor profiles:

- Legal name.
- Trade name.
- GSTIN.
- PAN where applicable.
- Address.
- State.
- Contact persons.
- Phone and email.
- Bank details with restricted access.
- Payment terms.
- Credit period.
- Credit limit.
- Opening balance.
- Supplier category.
- Product catalog.
- Vendor-specific product codes.
- Price lists.
- Agreements and attachments.
- Licence details where relevant.
- Active status.
- Compliance documents.
- Performance metrics.

Vendor financial management:

- Supplier ledger.
- Purchase bills.
- Debit notes.
- Credit notes.
- Outstanding invoices.
- Due dates.
- Aging analysis.
- Payment allocation.
- Partial payments.
- Advance payments.
- Payment receipts.
- Bank reconciliation.
- Supplier statement imports.
- Statement reconciliation.
- Payment reminders.
- Dispute tracking.

Vendor procurement features:

- Purchase quotations.
- Comparative quotations.
- Purchase orders.
- Supplier order confirmations.
- Delivery tracking.
- Goods receipts.
- Shortage and damage claims.
- Return-to-vendor requests.
- Expiry-return tracking.
- Scheme comparison.
- Supplier performance reports.

Support an optional distributor portal with restricted access to its own data.

If distributor-to-retailer ordering is enabled, support product availability, agreed price lists, order submission, order confirmation, fulfillment status, invoices, and account statements.

Do not allow a vendor to access another vendor's information or a retailer's private customer records.

---

# 11. FAST PHARMACY BILLING AND POS

The POS must be optimized for real-world medical shop counters.

Design for keyboard-first operation and barcode scanners that emulate keyboard input.

The billing screen should provide:

- Product search.
- Barcode scanning.
- Generic-name search.
- Brand-name search.
- Strength and dosage-form identification.
- Batch selection.
- Expiry visibility.
- Available stock.
- MRP visibility.
- Selling price.
- Quantity entry.
- Unit conversion.
- Discounts subject to authorization.
- Tax calculation.
- Line-item editing.
- Item removal.
- Customer selection.
- Prescription capture when required.
- Payment collection.
- Bill hold and resume.
- Draft management.
- Invoice preview.
- Thermal receipt printing.
- A4 invoice printing.
- Invoice PDF.
- Reprint history.
- Cash, UPI, card and other configured payment methods.
- Split tender.
- Credit sale.
- Customer advance adjustment.
- Change due.
- Payment reference capture.

Support both retail and wholesale sales.

Allow organization-configured pricing policies for eligible customer categories.

Implement configurable approval limits for discounts, price overrides, and credit sales.

The POS should clearly show:

- Gross amount.
- Item discounts.
- Invoice discount.
- Taxable amount.
- Tax breakdown.
- Round-off.
- Net payable.
- Amount paid.
- Outstanding amount.
- Change due.

Prevent accidental duplicate billing from repeated clicks, retries, and network interruptions.

Use idempotency keys for appropriate transaction-creation endpoints.

Do not deduct stock twice when a request is retried.

Do not finalize a bill before required validation and transactional operations have succeeded.

Provide clear recovery behavior when printing fails after a sale has been committed.

Printing failure must not create a second invoice.

---

# 12. INVOICING AND DOCUMENT MANAGEMENT

Support:

- Retail tax invoices.
- Wholesale tax invoices.
- Bills of supply where applicable.
- Quotations.
- Sales orders.
- Delivery challans.
- Purchase orders.
- Goods receipt notes.
- Purchase invoices.
- Credit notes.
- Debit notes.
- Payment receipts.
- Refund receipts.
- Supplier statements.
- Customer statements.
- Stock transfer documents.

Implement configurable invoice templates.

Support:

- Business logo.
- Business identity.
- GSTIN where applicable.
- Invoice series.
- Financial-year numbering.
- Customer details.
- HSN.
- Quantity and unit.
- Taxable value.
- Tax breakdown.
- Discounts.
- Total amount.
- Payment details.
- Required statutory declarations where applicable.

Use server-controlled invoice numbering.

Enforce uniqueness at the database level.

Never reuse an issued invoice number.

Posted documents should not be silently edited or deleted.

Implement cancellation, credit notes, debit notes, refunds, and corrections according to the applicable document type and rules.

Retain a clear relationship between original documents and subsequent corrections.

---

# 13. GST AND TAXATION ENGINE

Build a centralized, testable taxation module.

Support:

- GST registration profiles.
- CGST.
- SGST.
- IGST.
- Applicable cess.
- HSN-based product classification.
- Tax-inclusive pricing.
- Tax-exclusive pricing.
- Applicable exemptions.
- Taxable and non-taxable lines.
- Intra-state and inter-state transactions.
- Purchase input-tax reporting.
- Sales tax reporting.
- Credit notes.
- Debit notes.
- Tax adjustments.
- Tax summaries.
- Invoice-level and line-level discounts.
- Rounding policies.
- Financial-year reports.

Determine the appropriate tax treatment using the relevant business registration, place-of-supply rules, product classification, transaction details, and applicable law.

Do not assume every medicine has the same GST rate.

Do not hardcode tax rates in frontend components.

Use a versioned tax configuration and retain the tax information applied to each posted transaction.

Build a rule-based integration layer for:

- GST e-invoicing.
- Invoice Reference Number generation.
- IRP responses.
- Signed invoice artifacts.
- QR code data when applicable.
- E-way bill generation.
- E-way bill status.
- Cancellation workflows.
- GST report exports.
- Purchase and sales reconciliation.

Check the current official eligibility thresholds, exclusions, timing requirements, and applicable rules before enabling these integrations.

Support the applicable e-invoice reporting time limits and restrictions as configurable, versioned compliance rules rather than universal assumptions.

Use authorized GST Suvidha Provider or other permitted integration channels where appropriate.

Never fabricate an IRN, acknowledgement number, digitally signed invoice, or e-way bill number.

Clearly distinguish locally generated documents from government-registered documents.

Implement sandbox and production integration modes.

Record request identifiers, responses, errors, retries, and reconciliation status without logging credentials or unnecessary personal data.

---

# 14. PHARMACY REGULATORY COMPLIANCE

Build a configurable pharmacy compliance module based on verified applicable Indian requirements.

Support:

- Pharmacy licence information.
- Licence expiry alerts.
- Authorized personnel records.
- Product classification.
- Prescription requirements.
- Prescription attachments.
- Prescriber details where required.
- Patient details where required.
- Restricted-sale warnings.
- Applicable drug schedule registers.
- Schedule H1 register.
- Schedule X workflows where applicable.
- Required purchase and sale records.
- Batch traceability.
- Recall handling.
- Expired-product blocking.
- Regulatory inspection exports.
- Record retention policies.
- Audit trails.

For Schedule H1 sales, capture the required patient name, prescriber name and address, medicine, quantity, and other information required by the current applicable rules.

Enforce the legally applicable retention period, including the three-year Schedule H1 requirement verified in the official regulatory material.

Evaluate and implement other relevant requirements independently.

Do not assume the same fields or restrictions apply to every schedule.

Prescription validation must not be reduced to a generic checkbox.

Design configurable workflows for prescription review and authorized dispensing.

Do not automatically diagnose patients, prescribe medicines, or recommend treatment.

Support medicine recalls with affected-batch identification, stock blocking, transaction traceability, and documented corrective actions.

Provide reports for authorized inspection.

Clearly distinguish software assistance from legal or professional certification.

---

# 15. SALES RETURNS AND PURCHASE RETURNS

Sales returns:

- Search original invoice.
- Select returned products.
- Identify original batch.
- Validate eligible return quantity.
- Capture return reason.
- Inspect product condition.
- Determine whether stock can be restored.
- Calculate applicable tax adjustments.
- Create the appropriate credit document.
- Record refund or customer credit.
- Update customer balances.
- Update inventory where appropriate.
- Preserve the original sale relationship.

Purchase returns:

- Select supplier invoice or receipt.
- Identify original batch.
- Capture quantity and reason.
- Calculate relevant financial adjustments.
- Generate the appropriate supplier debit or return document.
- Update stock.
- Adjust supplier payable.
- Track goods dispatch and supplier acknowledgement.

Support:

- Damaged goods.
- Incorrect goods.
- Near-expiry returns.
- Expired goods.
- Recall returns.
- Wrong-batch receipts.
- Supplier shortages.

Never restore returned goods to saleable inventory automatically without the required eligibility and condition checks.

Never allow return quantities to exceed eligible original quantities without an explicitly authorized exception process.

---

# 16. CUSTOMER MANAGEMENT AND CREDIT CONTROL

Implement:

- Customer profiles.
- Customer categories.
- Contact details.
- GSTIN where applicable.
- Purchase history.
- Customer-specific pricing where permitted.
- Credit limits.
- Credit periods.
- Outstanding invoices.
- Receipts.
- Partial payments.
- Advances.
- Refunds.
- Statements.
- Aging reports.
- Loyalty programs.
- Discounts.
- Purchase history exports.
- Optional refill reminders with appropriate consent.

Support walk-in customers without forcing the cashier to create a full customer account for every sale.

For credit sales, check the customer's credit policy before posting.

Provide configurable warnings and approval requirements when limits are exceeded.

Record credit notes, refunds, and receipt allocations accurately.

Keep patient information separate from ordinary marketing preferences and apply appropriate access controls.

---

# 17. ACCOUNTING AND FINANCIAL MANAGEMENT

Implement a structured accounting foundation.

Modules:

- Chart of accounts.
- Journal entries.
- General ledger.
- Accounts receivable.
- Accounts payable.
- Cashbook.
- Bankbook.
- Payment vouchers.
- Receipt vouchers.
- Contra vouchers.
- Journal vouchers.
- Expense management.
- Supplier advances.
- Customer advances.
- Bank reconciliation.
- Outstanding reports.
- Trial balance.
- Profit and loss.
- Balance sheet.
- Cash-flow reporting.
- Tax summaries.
- Financial-year closing.
- Opening balances.
- Period locking.

Define an accounting mapping for each posted business transaction.

Examples:

- Cash sale.
- Credit sale.
- Sales return.
- Customer receipt.
- Supplier purchase.
- Supplier payment.
- Purchase return.
- Operating expense.
- Stock adjustment.
- Write-off.
- Tax liability.
- Input tax credit.

Use double-entry bookkeeping with balanced journal entries.

A posted journal entry must satisfy:

Total debits = Total credits.

Represent money with suitable decimal types and explicit precision.

Use integer minor units where appropriate for supported currencies, or database decimal types for values requiring additional precision.

Do not use JavaScript floating-point arithmetic for financial calculations.

Use deterministic rounding rules.

Never use binary floating-point calculations as the source of financial truth.

Posted accounting entries must be immutable.

Correct errors using authorized reversal and adjustment entries.

Implement period locks and permissions for backdated transactions.

Support inventory valuation using an explicitly selected and consistently implemented method, such as weighted average or FIFO.

Keep MRP, selling price, purchase price, and accounting inventory cost distinct.

Ensure sales, returns, purchases, taxes, payments, and inventory movements reconcile.

---

# 18. EXPENSE MANAGEMENT

Implement:

- Expense categories.
- Expense vouchers.
- Payees.
- Payment methods.
- Expense dates.
- Supporting documents.
- Tax details where applicable.
- Approval workflows.
- Recurring expenses.
- Branch allocation.
- Department allocation.
- Cash and bank payment references.
- Expense reports.
- Period summaries.

Provide approval rules based on role and amount.

Do not automatically treat every expense as an input-tax-credit-eligible expense.

Require appropriate supporting information and applicable tax treatment.

---

# 19. STOCK TRANSFERS AND MULTI-BRANCH MANAGEMENT

Support centralized administration with branch-specific operations.

Features:

- Branch creation.
- Warehouse creation.
- Branch-specific stock.
- Central purchase orders.
- Inter-branch transfers.
- Transfer requests.
- Approval.
- Dispatch.
- In-transit stock.
- Goods receipt.
- Partial receipt.
- Damaged-in-transit reporting.
- Transfer reconciliation.
- Inter-branch movement history.
- Consolidated inventory.
- Consolidated sales.
- Branch-wise profitability.
- Branch-wise purchasing.
- Branch-wise cash reconciliation.

Represent transfers as linked source and destination movements.

Do not duplicate stock merely because a transfer document is created.

Track stock while it is in transit.

Prevent the destination from receiving more eligible stock than was dispatched unless an authorized discrepancy workflow applies.

Support different counters and warehouses within a branch.

---

# 20. DISTRIBUTION AND WHOLESALE MANAGEMENT

For customers operating as wholesalers or distributors, provide optional modules for:

- Retailer accounts.
- Distributor customer groups.
- Wholesale price lists.
- Retailer-specific discounts.
- Credit limits.
- Sales orders.
- Order approval.
- Picking and packing.
- Batch allocation.
- Delivery challans.
- Dispatch management.
- Transport details.
- Applicable e-way bills.
- Delivery confirmation.
- Sales returns.
- Credit notes.
- Receivables.
- Salesperson assignments.
- Salesperson commissions where configured.
- Territory management.
- Outstanding collection tracking.
- Retailer statements.
- Sales targets.
- Order fulfillment reports.

Support different workflows for retail sales and wholesale fulfillment without duplicating core inventory and accounting logic.

---

# 21. REPORTING AND ANALYTICS

Create an interactive reporting center.

Sales reports:

- Daily sales.
- Monthly sales.
- Sales by branch.
- Sales by cashier.
- Sales by product.
- Sales by category.
- Sales by manufacturer.
- Sales by batch.
- Sales by customer.
- Sales by payment method.
- Sales returns.
- Discount analysis.
- Gross margin.
- Tax summaries.

Inventory reports:

- Current stock.
- Batch-wise stock.
- Near-expiry stock.
- Expired stock.
- Dead stock.
- Slow-moving stock.
- Fast-moving stock.
- Stock valuation.
- Stock adjustments.
- Stock transfers.
- Negative-stock exceptions.
- Reorder suggestions.
- Batch traceability.

Purchasing reports:

- Supplier purchases.
- Purchase returns.
- Purchase price history.
- Purchase order status.
- Supplier performance.
- Purchase schemes.
- Goods received.
- Supplier outstanding balances.

Financial reports:

- Cashbook.
- Bankbook.
- General ledger.
- Trial balance.
- Profit and loss.
- Balance sheet.
- Cash flow.
- Receivables.
- Payables.
- Outstanding aging.
- Expenses.
- Payment history.
- Tax summaries.

SaaS analytics:

- Active organizations.
- Active branches.
- Subscription status.
- Usage.
- Failed integrations.
- Background-job failures.
- Storage consumption.
- Operational health.

Reports must use real database data and respect tenant and branch permissions.

Implement server-side filtering, sorting, pagination, and aggregation.

Provide CSV and Excel exports where appropriate, plus PDF reports.

Large exports should run asynchronously.

Display applied filters, reporting periods, generation timestamps, and relevant business scope.

---

# 22. NOTIFICATIONS AND AUTOMATION

Create an extensible notification system.

Channels may include:

- In-app notifications.
- Email.
- WhatsApp through an authorized provider.
- Optional SMS provider.

Notification events:

- Low stock.
- Near expiry.
- Expired stock.
- Licence expiry.
- Purchase approval.
- Goods receipt discrepancy.
- Supplier payment due.
- Customer payment overdue.
- Credit limit exceeded.
- Subscription expiry.
- Payment failure.
- Failed government integration.
- Recall alert.
- Import failure.
- Background-job failure.

Allow users to configure suitable notification preferences.

Implement notification templates, delivery attempts, retry policies, delivery status, and deduplication.

Use an outbox pattern or equivalent reliable event-delivery mechanism where appropriate.

Avoid duplicate notifications caused by transaction retries.

Provide a reminder history.

Do not send messages without appropriate authorization and consent.

---

# 23. PLATFORM SUPERADMINISTRATION

Create a separate platform administration area.

Modules:

- Tenant management.
- Subscription management.
- Feature entitlements.
- Plan configuration.
- Organization usage.
- Payment status.
- Account suspension.
- Tenant support.
- Integration health.
- Background-job monitoring.
- Error monitoring.
- Storage usage.
- System configuration.
- Audit events.
- Support cases.
- Security events.

Platform administrators must not automatically gain unrestricted access to sensitive pharmacy or patient records.

Implement a controlled support-access process with explicit authorization, time limits, audit logging, and minimum necessary access.

Support organization-level export and account offboarding workflows.

Apply retention and deletion rules appropriate to business records and applicable law.

---

# 24. MODERN UI/UX DESIGN SYSTEM

Create a polished, premium B2B SaaS interface.

The design should feel appropriate for serious business software rather than a generic admin template.

Visual direction:

- Clean, professional layouts.
- Neutral backgrounds.
- Clear typography.
- Restrained green or teal accent colors.
- High information density without clutter.
- Consistent spacing.
- Well-designed data tables.
- Clear status indicators.
- Accessible contrast.
- Consistent icons.
- Responsive layouts.
- Subtle motion only where useful.

Provide:

- Collapsible sidebar.
- Global search.
- Organization switcher.
- Branch switcher.
- Breadcrumb navigation.
- Notification center.
- User menu.
- Context-sensitive page actions.
- Persistent filter controls where appropriate.
- Table column visibility.
- Saved report filters.
- Keyboard shortcuts for POS.
- Light and dark themes.
- Responsive tablet and mobile layouts.

Important screens:

1. Login.
2. Onboarding.
3. Dashboard.
4. POS billing.
5. Invoice details.
6. Sales history.
7. Sales returns.
8. Product catalog.
9. Product details.
10. Batch inventory.
11. Stock ledger.
12. Expiry dashboard.
13. Purchase orders.
14. Goods receipt.
15. Purchase invoices.
16. Vendor directory.
17. Vendor ledger.
18. Customer directory.
19. Customer ledger.
20. Accounting dashboard.
21. Financial reports.
22. Compliance registers.
23. Branch management.
24. Warehouse management.
25. Reports center.
26. Notifications.
27. Organization settings.
28. Subscription and usage.
29. User and permission management.
30. Platform administration.

Each screen must have a defined purpose, data contract, permission model, loading state, empty state, error state, and supported actions.

Use realistic responsive table designs and functional filters.

Avoid excessive gradients, giant dashboard cards, unnecessary whitespace, and decorative charts that do not help users make decisions.

Make the POS screen exceptionally fast and keyboard-friendly.

---

# 25. DATABASE DESIGN

Design and document the relational schema before implementing the complete workflows.

Expected entity groups include:

Identity:
- users
- sessions
- organizations
- organization_memberships
- roles
- permissions
- role_permissions
- branches
- warehouses
- billing_counters

SaaS:
- subscription_plans
- subscriptions
- feature_entitlements
- usage_records
- payment_events

Catalog:
- products
- product_barcodes
- product_categories
- manufacturers
- product_units
- product_tax_profiles
- product_supplier_mappings

Inventory:
- inventory_batches
- inventory_balances
- inventory_movements
- stock_reservations
- stock_counts
- stock_count_lines
- stock_transfers
- stock_transfer_lines
- stock_adjustments
- recall_records

Purchasing:
- vendors
- purchase_requisitions
- purchase_orders
- purchase_order_lines
- goods_receipts
- goods_receipt_lines
- purchase_invoices
- purchase_invoice_lines
- purchase_returns
- purchase_return_lines

Sales:
- customers
- sales_orders
- sales_order_lines
- sales_invoices
- sales_invoice_lines
- sales_returns
- sales_return_lines
- prescriptions
- payment_transactions
- payment_allocations
- credit_notes
- debit_notes

Finance:
- accounts
- journal_entries
- journal_lines
- cash_transactions
- bank_transactions
- expenses
- bank_reconciliations
- accounting_periods

Compliance:
- pharmacy_licences
- prescription_records
- schedule_register_entries
- compliance_events
- regulatory_rule_versions

Platform:
- audit_logs
- notifications
- notification_deliveries
- integration_connections
- integration_events
- import_jobs
- export_jobs
- support_cases

This list is a starting point, not permission to create an indiscriminate or badly normalized schema.

Define:

- Primary keys.
- Foreign keys.
- Unique constraints.
- Composite tenant constraints.
- Required indexes.
- Appropriate decimal precision.
- Document numbering constraints.
- Lifecycle statuses.
- Created and updated timestamps.
- Actor references.
- Soft deletion rules where appropriate.
- Immutable ledger behavior.
- Retention requirements.

Use explicit relationships for invoice lines, batch allocations, payments, and accounting entries.

Prevent duplicate invoice numbers within their defined numbering scope.

Use database constraints to prevent invalid references and unsupported state transitions wherever feasible.

Document the ER model and critical transaction boundaries.

---

# 26. CRITICAL TRANSACTION INVARIANTS

These rules must be enforced by the backend and database where possible.

A. Posted sales invoice:
- Must have a unique document number.
- Must have validated invoice lines.
- Must use eligible batches.
- Must not oversell available stock.
- Must calculate taxes deterministically.
- Must reconcile invoice totals.
- Must create correct payment and receivable records.
- Must create applicable inventory movements.
- Must create balanced accounting entries when accounting posting is enabled.
- Must be idempotent against duplicate requests.

B. Purchase receipt:
- Must reference an appropriate supplier and source document.
- Must validate received quantities.
- Must record batches and expiry dates as required.
- Must not silently duplicate received inventory.
- Must reconcile receipt quantities and discrepancies.

C. Financial postings:
- Debits must equal credits.
- Posted journal entries must not be silently modified.
- Reversals must reference the original entries.
- Payment allocations must not exceed the eligible unapplied amount.
- Refunds must follow authorization and available-balance rules.

D. Inventory:
- Stock movements must be traceable.
- Posted movements must not be silently deleted.
- Ineligible batches must not be sold.
- Transfers must reconcile dispatch and receipt.
- Inventory balances must reconcile with the movement ledger.

E. Returns:
- Returns must reference valid original transactions when required.
- Quantities must respect returnable limits.
- Tax and financial corrections must be consistent.
- Returned goods must not automatically become saleable.

F. Tenant security:
- Every operation must enforce the applicable organization and branch scope.
- Unauthorized users must not be able to read or mutate another tenant's records.
- Export endpoints must apply the same authorization as interactive views.

G. Reliability:
- External calls must not hold database transactions open unnecessarily.
- Integration failures must not fabricate successful outcomes.
- Retries must be safe for the operation being retried.
- Background jobs must be observable and recoverable.

Write automated tests for these invariants.

---

# 27. API DESIGN

Create versioned REST APIs.

Suggested route groups:

/api/v1/auth
/api/v1/organizations
/api/v1/branches
/api/v1/products
/api/v1/inventory
/api/v1/sales
/api/v1/sales-returns
/api/v1/purchases
/api/v1/vendors
/api/v1/customers
/api/v1/payments
/api/v1/accounting
/api/v1/tax
/api/v1/compliance
/api/v1/reports
/api/v1/notifications
/api/v1/integrations
/api/v1/subscriptions
/api/v1/admin

Follow consistent conventions for:

- HTTP status codes.
- Error responses.
- Pagination.
- Filtering.
- Sorting.
- Validation.
- Authentication.
- Authorization.
- Idempotency.
- API versioning.
- Request correlation IDs.

Publish an OpenAPI specification.

Implement consistent error handling with stable application error codes.

Do not expose raw SQL, stack traces, secrets, or internal infrastructure details to clients.

Use optimistic concurrency or other appropriate concurrency controls when simultaneous updates could otherwise overwrite valid data.

---

# 28. SECURITY AND PRIVACY

Implement:

- Secure session handling.
- Password hashing using a modern password-hashing algorithm.
- Appropriate CSRF protection.
- XSS prevention.
- SQL injection prevention.
- Strict server-side validation.
- Rate limiting.
- Secure HTTP headers.
- Secrets management.
- Least-privilege database access.
- Tenant isolation.
- Audit logging.
- File-upload validation.
- Private attachment storage.
- Short-lived signed download links where appropriate.
- Secure backup policies.
- Dependency vulnerability scanning.
- Access revocation.
- Data export controls.

Apply data minimization to patient and prescription records.

Define access, retention, deletion, and export policies based on the relevant legal requirements.

Do not place sensitive health information in ordinary application logs or analytics events.

Do not claim compliance with a security certification or privacy law merely because security features have been implemented.

Document the applicable obligations and outstanding review requirements.

---

# 29. IMPORTS, EXPORTS AND MIGRATION

Support validated imports from CSV and Excel for:

- Products.
- Batches and opening stock.
- Vendors.
- Customers.
- Opening balances.
- Supplier price lists.

Import workflow:

1. Upload.
2. Validate file type and size.
3. Preview data.
4. Map columns.
5. Validate records.
6. Identify duplicates.
7. Display row-level errors.
8. Allow corrections.
9. Confirm import.
10. Process safely.
11. Report created, updated, skipped, and rejected records.

Large imports should run as background jobs.

Provide downloadable error reports.

Do not silently discard invalid rows.

Ensure imports are retryable without duplicating financial or inventory records.

For exports, support CSV, Excel, and PDF where appropriate.

Apply access control and audit logging to exports containing sensitive data.

---

# 30. HARDWARE AND EXTERNAL INTEGRATIONS

Create integration interfaces for:

- Barcode scanners.
- Thermal receipt printers.
- A4 printers.
- Cash drawers where supported.
- Payment gateways.
- UPI payment workflows.
- Email providers.
- WhatsApp messaging providers.
- SMS providers.
- GST e-invoice services.
- E-way bill services.
- Accounting exports.
- Supplier catalog imports.

Do not assume every printer or payment device has a compatible browser API.

For direct hardware access, evaluate browser-supported printing, a local print bridge, or a suitable device-specific integration.

Document supported hardware and deployment requirements.

Never claim an integration works on all devices without testing.

External integrations must support:

- Configuration.
- Credential management.
- Connection testing.
- Error handling.
- Timeouts.
- Retry rules.
- Idempotency where supported.
- Status tracking.
- Audit logs.
- Sandbox mode where available.

---

# 31. PERFORMANCE AND SCALABILITY

Establish measurable performance targets.

Suggested initial targets under a defined representative workload:

- Product-search API: p95 under 300 ms.
- Common operational reads: p95 under 500 ms.
- Typical billing API operations: p95 under 800 ms, excluding external services.
- Initial interactive page responsiveness: optimize for common pharmacy hardware and network conditions.
- Large exports: asynchronous.
- Imports: asynchronous when large.
- Background jobs: observable and retryable.

These are engineering targets, not guarantees.

Measure performance under representative concurrent users and realistic data volumes.

Optimize using:

- Database indexes.
- Query analysis.
- Pagination.
- Appropriate caching.
- Efficient joins.
- Background processing.
- Connection pooling.
- Avoidance of N+1 queries.
- Bounded job concurrency.

Do not cache financial or inventory data in a way that permits stale values to bypass authoritative transaction checks.

Test concurrency for stock deductions, invoice numbering, payment allocation, and stock transfers.

---

# 32. BACKUP, RECOVERY AND OPERATIONS

Implement operational documentation covering:

- Database backups.
- Point-in-time recovery where supported.
- Object-storage backups or versioning.
- Backup retention.
- Recovery testing.
- Migration rollback strategy.
- Health checks.
- Readiness checks.
- Error monitoring.
- Queue monitoring.
- Database connection monitoring.
- Integration status.
- Incident response.
- Deployment rollback.
- Data export.
- Tenant offboarding.

Define and document recovery point and recovery time objectives.

Do not claim successful disaster recovery until restoration has been tested.

Provide development, staging, and production environment configurations.

Do not commit secrets or production database credentials.

---

# 33. REQUIRED AUTOMATED TESTS

Unit tests:
- Tax calculations.
- Discount calculations.
- Rounding.
- Unit conversion.
- Batch eligibility.
- FEFO selection.
- Stock availability.
- Invoice totals.
- Credit limits.
- Payment allocation.
- Accounting balancing.
- Return eligibility.
- Subscription entitlements.

Integration tests:
- Sale posting.
- Purchase posting.
- Goods receipt.
- Stock transfer.
- Sales return.
- Purchase return.
- Supplier payment.
- Customer receipt.
- Journal posting.
- Tenant authorization.
- Document numbering.
- Duplicate request handling.

End-to-end tests:
- Organization onboarding.
- Product creation.
- Supplier creation.
- Purchase order.
- Goods receipt.
- Purchase invoice.
- Retail sale.
- Split payment.
- Credit sale.
- Sales return.
- Supplier payment.
- Stock transfer.
- Near-expiry reporting.
- User permission changes.
- Unauthorized cross-tenant access.
- Subscription restrictions.

Failure tests:
- Database failure.
- Duplicate requests.
- Concurrent billing.
- Insufficient stock.
- Expired batch.
- Failed printing.
- Failed email.
- Failed GST integration.
- Failed background job.
- Invalid import.
- Partial transfer receipt.

Do not merely test the happy path.

Use deterministic fixtures and isolated test data.

---

# 34. DEFINITION OF DONE

A module is not complete merely because its screen exists.

For every module, verify:

1. The interface is implemented.
2. The database model and migrations exist.
3. The backend APIs exist.
4. Input validation is implemented.
5. Permissions are enforced.
6. Business rules are implemented.
7. Loading, error, empty, and success states exist.
8. Automated tests cover critical behavior.
9. Relevant audit events are recorded.
10. Documentation is updated.
11. Linting passes.
12. Type checking passes.
13. Relevant tests pass.
14. The production build succeeds.
15. Manual end-to-end verification has been performed where necessary.

Maintain a feature matrix containing:

- Feature.
- Backend status.
- Frontend status.
- Database status.
- Tests.
- Documentation.
- Integration status.
- Known limitations.
- Acceptance criteria.
- Verification evidence.

Use the following statuses:

NOT STARTED
IN PROGRESS
IMPLEMENTED
TESTED
VERIFIED
BLOCKED

Do not mark an external integration VERIFIED without successful integration testing.

Do not mark a regulatory workflow VERIFIED without appropriate requirement validation.

---

# 35. REQUIRED PROJECT DOCUMENTATION

Create:

docs/architecture/system-architecture.md
docs/architecture/database-design.md
docs/architecture/security-model.md
docs/architecture/transaction-boundaries.md
docs/product/module-catalog.md
docs/product/user-workflows.md
docs/product/acceptance-criteria.md
docs/compliance/india-regulatory-research.md
docs/compliance/gst-requirements.md
docs/compliance/pharmacy-requirements.md
docs/api/openapi.yaml
docs/operations/deployment.md
docs/operations/backup-and-recovery.md
docs/operations/incident-response.md
docs/testing/test-strategy.md
docs/testing/feature-verification-matrix.md

Include architecture diagrams and transaction-flow diagrams where useful.

Maintain a decision log for important architectural choices.

Document assumptions and unresolved questions.

---

# 36. IMPLEMENTATION PHASES

Do not attempt to build the entire platform in one enormous code-generation operation.

Work in verifiable phases.

PHASE 0 — REPOSITORY AND REQUIREMENTS AUDIT

Inspect the repository.

Identify the framework, dependencies, existing features, configuration, tests, and architectural constraints.

Research current official Indian pharmacy and GST requirements.

Prepare the module catalog, requirements matrix, data model, architecture, and acceptance criteria.

Identify regulatory questions requiring professional review.

Do not modify working functionality unnecessarily.

PHASE 1 — FOUNDATION

Implement the project structure, environment configuration, database connection, migrations, logging, error handling, validation, authentication, authorization, tenant isolation, branch management, and audit logging.

PHASE 2 — MASTER DATA

Implement products, manufacturers, categories, suppliers, customers, units, tax profiles, warehouses, and business settings.

PHASE 3 — INVENTORY ENGINE

Implement batches, stock movements, balances, FEFO, opening stock, stock adjustments, stock counts, transfers, expiry alerts, and traceability.

PHASE 4 — PURCHASING AND VENDOR MANAGEMENT

Implement requisitions, quotations, purchase orders, goods receipts, supplier invoices, supplier ledgers, purchase returns, payment allocation, and reconciliation.

PHASE 5 — SALES AND POS

Implement product search, barcode scanning, batch selection, billing, payment collection, credit sales, receipts, invoice printing, and sales history.

PHASE 6 — RETURNS AND CUSTOMER MANAGEMENT

Implement sales returns, customer credits, refunds, customer accounts, outstanding balances, and statements.

PHASE 7 — ACCOUNTING

Implement the chart of accounts, double-entry ledger, journals, cashbook, bankbook, expenses, financial statements, period locking, and reconciliation.

PHASE 8 — TAX AND PHARMACY COMPLIANCE

Implement the verified applicable GST workflows, regulatory registers, prescription controls, licence tracking, recall workflows, and authorized inspection reports.

PHASE 9 — MULTI-BRANCH AND WHOLESALE ERP

Implement consolidated operations, distributor workflows, branch transfers, wholesale pricing, fulfillment, and multi-branch reporting.

PHASE 10 — REPORTING AND INTEGRATIONS

Implement analytics, imports, exports, notifications, hardware support, payment integrations, and applicable government integrations.

PHASE 11 — SAAS PLATFORM ADMINISTRATION

Implement subscriptions, entitlements, usage metering, plan management, tenant administration, support workflows, and platform monitoring.

PHASE 12 — HARDENING AND RELEASE

Run security checks, migration tests, automated tests, load tests, accessibility checks, backup restoration tests, and end-to-end business scenarios.

Resolve critical defects before release.

Do not proceed blindly when an earlier phase has unresolved transaction-integrity or tenant-isolation defects.

---

# 37. FIRST RESPONSE AND CONTINUOUS EXECUTION RULES

Begin by inspecting the actual repository.

Then produce:

1. Repository findings.
2. Architecture proposal.
3. Complete module breakdown.
4. Database and transaction design.
5. Official regulatory research findings.
6. Security risks.
7. Implementation roadmap.
8. Acceptance criteria.
9. Identified assumptions.
10. Highest-priority implementation tasks.

After presenting this plan, begin implementing the highest-priority phase if the execution environment permits.

Do not stop after generating documentation or a list of suggested files.

Create the actual files, run the application, execute migrations, test endpoints, and verify workflows.

At the end of each phase, report:

- Features implemented.
- Files and modules changed.
- Database changes.
- Tests executed.
- Actual test results.
- Build and lint results.
- Outstanding defects.
- Incomplete integrations.
- Compliance questions requiring review.
- Next implementation phase.

If a task exceeds the current execution budget, finish a coherent, tested unit of work and provide a precise continuation point.

Do not repeatedly regenerate the entire project.

Do not overwrite working modules without a documented reason.

Maintain a persistent implementation checklist and update it after every phase.

---

# 38. FINAL PRODUCT ACCEPTANCE SCENARIO

Before describing the product as release-ready, demonstrate the following complete business journey using a test organization.

1. Create an organization and configure its branch.
2. Configure business and applicable tax information.
3. Create a supplier.
4. Create medicine products with appropriate tax classifications.
5. Create a purchase order.
6. Receive medicines in multiple batches with different expiry dates.
7. Reconcile the supplier invoice.
8. Verify inventory and accounting balances.
9. Create a customer.
10. Sell a medicine using the correct eligible batch.
11. Verify invoice totals and tax calculations.
12. Record a split payment or credit sale.
13. Verify inventory deductions and financial postings.
14. Print or generate the invoice.
15. Return an eligible item and verify the corresponding correction.
16. Process a supplier payment.
17. Verify the supplier's outstanding balance.
18. Verify customer receivables.
19. Verify inventory valuation.
20. Verify profit and loss and trial balance consistency.
21. Verify relevant compliance-register entries.
22. Verify that another tenant cannot access the organization's data.
23. Verify that unauthorized staff cannot perform restricted operations.
24. Verify that retries do not duplicate sales or stock deductions.
25. Verify that audit trails preserve the transaction history.

Run additional scenarios for expiry blocking, recalls, partial receipts, partial returns, branch transfers, failed integrations, and accounting reversals.

The final product must be judged on business correctness, data integrity, security, usability, and verified functionality—not on the number of pages or components generated.

Start with Phase 0 and proceed systematically.