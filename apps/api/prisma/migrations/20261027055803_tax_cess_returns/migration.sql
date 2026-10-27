-- AlterEnum
ALTER TYPE "SalesInvoiceStatus" ADD VALUE 'RETURNED';

-- AlterTable
ALTER TABLE "PurchaseInvoiceLine" ADD COLUMN     "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseReturn" ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PurchaseReturnLine" ADD COLUMN     "taxAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesInvoiceLine" ADD COLUMN     "cessAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "hsnCode" TEXT,
ADD COLUMN     "taxRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "SalesReturn" ADD COLUMN     "creditAdjusted" DECIMAL(18,2) NOT NULL DEFAULT 0,
ADD COLUMN     "refundMethod" "PaymentMethod";

-- Append-only enforcement at the database layer (spec §8, §17, §28):
-- ledger, journal lines and audit rows can never be rewritten or deleted.
CREATE OR REPLACE FUNCTION medicore_forbid_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Table % is append-only (% blocked)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "InventoryMovement_append_only" BEFORE UPDATE OR DELETE ON "InventoryMovement"
  FOR EACH ROW EXECUTE FUNCTION medicore_forbid_mutation();
CREATE TRIGGER "JournalLine_append_only" BEFORE UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION medicore_forbid_mutation();
CREATE TRIGGER "AuditLog_append_only" BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION medicore_forbid_mutation();
