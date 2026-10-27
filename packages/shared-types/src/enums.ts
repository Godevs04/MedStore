/**
 * Domain enumerations shared across api, web, and validation packages.
 *
 * Values here are persisted string values in the database — do not rename
 * existing values; add new ones via migration + Prisma enum update together.
 */

// ── Identity & access ────────────────────────────────────────────────────────

export const USER_STATUS = ['INVITED', 'ACTIVE', 'SUSPENDED', 'DISABLED'] as const;
export type UserStatus = (typeof USER_STATUS)[number];

export const MEMBERSHIP_STATUS = ['INVITED', 'ACTIVE', 'SUSPENDED'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUS)[number];

/** System roles that cannot be deleted. Custom roles are plain rows. */
export const SYSTEM_ROLES = [
  'ORGANIZATION_OWNER',
  'ORGANIZATION_ADMIN',
  'PHARMACIST',
  'STORE_MANAGER',
  'CASHIER',
  'INVENTORY_MANAGER',
  'PURCHASE_MANAGER',
  'ACCOUNTANT',
  'AUDITOR',
  'ANALYST',
  'PLATFORM_SUPERADMIN',
] as const;
export type SystemRoleKey = (typeof SYSTEM_ROLES)[number];

// ── SaaS ─────────────────────────────────────────────────────────────────────

export const SUBSCRIPTION_PLANS = ['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE'] as const;
export type SubscriptionPlanKey = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELLED', 'EXPIRED'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

// ── Master data ──────────────────────────────────────────────────────────────

export const GST_REGISTRATION_TYPES = ['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'CONSUMER'] as const;
export type GstRegistrationType = (typeof GST_REGISTRATION_TYPES)[number];

export const PRESCRIPTION_CLASSES = ['OTC', 'PRESCRIPTION_ONLY', 'SCHEDULE_H1', 'SCHEDULE_X', 'NARCOTIC'] as const;
export type PrescriptionClass = (typeof PRESCRIPTION_CLASSES)[number];

export const DOSAGE_FORMS = [
  'TABLET',
  'CAPSULE',
  'SYRUP',
  'SUSPENSION',
  'INJECTION',
  'DROPS',
  'OINTMENT',
  'CREAM',
  'GEL',
  'LOTION',
  'INHALER',
  'SPRAY',
  'POWDER',
  'SUPPOSITORY',
  'PATCH',
  'OTHER',
] as const;
export type DosageForm = (typeof DOSAGE_FORMS)[number];

export const PRODUCT_STATUSES = ['DRAFT', 'ACTIVE', 'INACTIVE'] as const;
export type ProductStatus = (typeof PRODUCT_STATUSES)[number];

// ── Inventory ────────────────────────────────────────────────────────────────

/** Lifecycle status of a batch. Expired is derived-but-persisted for query speed. */
export const BATCH_STATUSES = ['SALEABLE', 'QUARANTINED', 'RECALLED', 'DAMAGED', 'EXPIRED_BLOCKED'] as const;
export type BatchStatus = (typeof BATCH_STATUSES)[number];

/** Reason codes for append-only inventory movements. */
export const MOVEMENT_TYPES = [
  'OPENING_STOCK',
  'PURCHASE_RECEIPT',
  'SALE',
  'SALES_RETURN_IN',
  'PURCHASE_RETURN_OUT',
  'EXPIRY_RETURN_OUT',
  'DAMAGE_OUT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'TRANSFER_OUT',
  'TRANSFER_IN',
  'COUNT_VARIANCE_IN',
  'COUNT_VARIANCE_OUT',
  'RECALL_OUT',
  'QUARANTINE_IN',
  'QUARANTINE_RELEASE',
  'SALE_CANCELLED_IN',
] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

/** Logical direction used by balance maintenance; sign of quantity on the ledger. */
export const MOVEMENT_DIRECTIONS = ['IN', 'OUT'] as const;
export type MovementDirection = (typeof MOVEMENT_DIRECTIONS)[number];

export const ADJUSTMENT_REASONS = [
  'DAMAGE',
  'BREAKAGE',
  'EXPIRY_WRITEOFF',
  'THEFT_LOSS',
  'COUNT_CORRECTION',
  'DATA_ENTRY_CORRECTION',
  'TEMPERATURE_EXCURSION',
  'CONTAMINATION',
  'OTHER',
] as const;
export type AdjustmentReason = (typeof ADJUSTMENT_REASONS)[number];

export const TRANSFER_STATUSES = ['DRAFT', 'DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'] as const;
export type TransferStatus = (typeof TRANSFER_STATUSES)[number];

export const COUNT_STATUSES = ['DRAFT', 'IN_PROGRESS', 'COMPLETED', 'POSTED', 'CANCELLED'] as const;
export type CountStatus = (typeof COUNT_STATUSES)[number];

export const EXPIRY_BUCKETS = ['EXPIRED', 'DAYS_30', 'DAYS_60', 'DAYS_90', 'CUSTOM', 'OK'] as const;
export type ExpiryBucket = (typeof EXPIRY_BUCKETS)[number];

// ── Vendors & customers ──────────────────────────────────────────────────────

export const VENDOR_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type VendorStatus = (typeof VENDOR_STATUSES)[number];

export const CUSTOMER_STATUSES = ['ACTIVE', 'INACTIVE', 'BLOCKED'] as const;
export type CustomerStatus = (typeof CUSTOMER_STATUSES)[number];

// ── Audit ────────────────────────────────────────────────────────────────────

export const AUDIT_EVENTS = [
  'USER_LOGIN_SUCCESS',
  'USER_LOGIN_FAILURE',
  'USER_LOGOUT',
  'USER_CREATED',
  'USER_UPDATED',
  'USER_SUSPENDED',
  'USER_REACTIVATED',
  'PASSWORD_CHANGED',
  'PASSWORD_RESET_REQUESTED',
  'PASSWORD_RESET_COMPLETED',
  'EMAIL_VERIFIED',
  'SESSION_REVOKED',
  'ORGANIZATION_CREATED',
  'ORGANIZATION_UPDATED',
  'BRANCH_CREATED',
  'BRANCH_UPDATED',
  'ROLE_CREATED',
  'ROLE_UPDATED',
  'ROLE_DELETED',
  'PERMISSIONS_UPDATED',
  'SETTINGS_UPDATED',
  'PRODUCT_CREATED',
  'PRODUCT_UPDATED',
  'PRODUCT_DEACTIVATED',
  'TAX_CONFIG_UPDATED',
  'VENDOR_CREATED',
  'VENDOR_UPDATED',
  'CUSTOMER_CREATED',
  'CUSTOMER_UPDATED',
  'BATCH_CREATED',
  'BATCH_STATUS_CHANGED',
  'STOCK_ADJUSTED',
  'STOCK_COUNT_POSTED',
  'STOCK_TRANSFER_DISPATCHED',
  'STOCK_TRANSFER_RECEIVED',
  'STOCK_TRANSFER_CANCELLED',
  'RECALL_CREATED',
  'RECALL_RESOLVED',
  'EXPORT_GENERATED',
  'IMPORT_COMPLETED',
  'INVENTORY_LEDGER_OVERRIDE',
  'PURCHASE_ORDER_CREATED',
  'PURCHASE_ORDER_STATUS_CHANGED',
  'GOODS_RECEIPT_POSTED',
  'PURCHASE_INVOICE_POSTED',
  'SUPPLIER_PAYMENT_RECORDED',
  'PURCHASE_RETURN_POSTED',
  'SALES_INVOICE_POSTED',
  'SALES_RETURN_POSTED',
  'CUSTOMER_RECEIPT_RECORDED',
  'JOURNAL_POSTED',
  'JOURNAL_REVERSED',
  'EXPENSE_RECORDED',
  'PERIOD_LOCK_CHANGED',
  'LICENCE_CREATED',
  'LICENCE_UPDATED',
  'SALES_INVOICE_CANCELLED',
  'PRODUCT_REACTIVATED',
  'STOCK_COUNT_CANCELLED',
  'EXPIRY_WRITTEN_OFF',
  'CATEGORY_UPDATED',
  'CATEGORY_DELETED',
  'MANUFACTURER_UPDATED',
  'MANUFACTURER_DELETED',
  'INVITATION_RESENT',
  'INVITATION_REVOKED',
  'MEMBER_BRANCHES_UPDATED',
  'BILLING_COUNTER_CREATED',
  'BILLING_COUNTER_UPDATED',
] as const;
export type AuditEvent = (typeof AUDIT_EVENTS)[number];
