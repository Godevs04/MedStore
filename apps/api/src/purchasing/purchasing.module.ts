import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PurchasingService } from './purchasing.service.js';
import { PurchasingController } from './purchasing.controller.js';

@Module({
  imports: [AuditModule, AccountingModule, InventoryModule],
  controllers: [PurchasingController],
  providers: [PurchasingService],
  exports: [PurchasingService],
})
export class PurchasingModule {}
