-- AlterEnum
ALTER TYPE "MovementType" ADD VALUE 'SALE_CANCELLED_IN';

-- AlterTable
ALTER TABLE "PrescriptionRecord" ADD COLUMN     "patientPhone" TEXT,
ADD COLUMN     "prescriberRegNo" TEXT;

-- AlterTable
ALTER TABLE "SalesInvoice" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ(6),
ADD COLUMN     "cancelledById" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "bankAccount" TEXT,
ADD COLUMN     "drugLicenceExpiry" DATE,
ADD COLUMN     "drugLicenceNumber" TEXT,
ADD COLUMN     "ifsc" TEXT;

-- CreateTable
CREATE TABLE "HeldBill" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "label" TEXT NOT NULL,
    "customerId" TEXT,
    "payload" JSONB NOT NULL,
    "itemCount" INTEGER NOT NULL,
    "total" DECIMAL(18,2) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HeldBill_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "HeldBill_organizationId_createdAt_idx" ON "HeldBill"("organizationId", "createdAt");
