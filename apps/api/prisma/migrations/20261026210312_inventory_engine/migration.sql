-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('SALEABLE', 'QUARANTINED', 'RECALLED', 'DAMAGED', 'EXPIRED_BLOCKED');

-- CreateEnum
CREATE TYPE "MovementType" AS ENUM ('OPENING_STOCK', 'PURCHASE_RECEIPT', 'SALE', 'SALES_RETURN_IN', 'PURCHASE_RETURN_OUT', 'EXPIRY_RETURN_OUT', 'DAMAGE_OUT', 'ADJUSTMENT_IN', 'ADJUSTMENT_OUT', 'TRANSFER_OUT', 'TRANSFER_IN', 'COUNT_VARIANCE_IN', 'COUNT_VARIANCE_OUT', 'RECALL_OUT', 'QUARANTINE_IN', 'QUARANTINE_RELEASE');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('DRAFT', 'DISPATCHED', 'IN_TRANSIT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "CountStatus" AS ENUM ('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'POSTED', 'CANCELLED');

-- CreateTable
CREATE TABLE "InventoryBatch" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "expiryDate" TIMESTAMPTZ(6) NOT NULL,
    "manufacturingDate" TIMESTAMPTZ(6),
    "supplierId" TEXT,
    "purchaseRate" DECIMAL(18,4) NOT NULL,
    "mrp" DECIMAL(18,4) NOT NULL,
    "landedCost" DECIMAL(18,4),
    "status" "BatchStatus" NOT NULL DEFAULT 'SALEABLE',
    "sourceDocument" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryBalance" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "reservedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "InventoryBalance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryMovement" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "movementType" "MovementType" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" TEXT,
    "sourceDocument" TEXT,
    "sourceDocumentId" TEXT,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InventoryMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockReservation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "referenceType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMPTZ(6),

    CONSTRAINT "StockReservation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockAdjustment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "movementId" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "status" "CountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "postedAt" TIMESTAMPTZ(6),
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" TEXT NOT NULL,
    "countId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "countedQty" DECIMAL(14,3) NOT NULL,
    "systemQty" DECIMAL(14,3) NOT NULL,
    "variance" DECIMAL(14,3) NOT NULL,

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransfer" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sourceWarehouseId" TEXT NOT NULL,
    "destinationWarehouseId" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "dispatchedAt" TIMESTAMPTZ(6),
    "receivedAt" TIMESTAMPTZ(6),
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockTransferLine" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "StockTransferLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecallRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolutionNotes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(6),

    CONSTRAINT "RecallRecord_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryBatch_organizationId_productId_expiryDate_idx" ON "InventoryBatch"("organizationId", "productId", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryBatch_organizationId_expiryDate_idx" ON "InventoryBatch"("organizationId", "expiryDate");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBatch_organizationId_productId_warehouseId_batchNu_key" ON "InventoryBatch"("organizationId", "productId", "warehouseId", "batchNumber", "expiryDate");

-- CreateIndex
CREATE INDEX "InventoryBalance_organizationId_warehouseId_idx" ON "InventoryBalance"("organizationId", "warehouseId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryBalance_batchId_warehouseId_key" ON "InventoryBalance"("batchId", "warehouseId");

-- CreateIndex
CREATE INDEX "InventoryMovement_batchId_createdAt_idx" ON "InventoryMovement"("batchId", "createdAt");

-- CreateIndex
CREATE INDEX "InventoryMovement_organizationId_warehouseId_createdAt_idx" ON "InventoryMovement"("organizationId", "warehouseId", "createdAt");

-- CreateIndex
CREATE INDEX "StockReservation_batchId_releasedAt_idx" ON "StockReservation"("batchId", "releasedAt");

-- CreateIndex
CREATE INDEX "StockAdjustment_organizationId_createdAt_idx" ON "StockAdjustment"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "StockCount_organizationId_status_idx" ON "StockCount"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_batchId_key" ON "StockCountLine"("countId", "batchId");

-- CreateIndex
CREATE INDEX "StockTransfer_organizationId_status_idx" ON "StockTransfer"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "StockTransferLine_transferId_batchId_key" ON "StockTransferLine"("transferId", "batchId");

-- CreateIndex
CREATE INDEX "RecallRecord_organizationId_status_idx" ON "RecallRecord"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "InventoryBatch" ADD CONSTRAINT "InventoryBatch_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBalance" ADD CONSTRAINT "InventoryBalance_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "StockTransfer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockTransferLine" ADD CONSTRAINT "StockTransferLine_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InventoryBatch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
