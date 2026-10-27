import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AccountingModule } from '../accounting/accounting.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';

@Module({
  imports: [AuditModule, AccountingModule, InventoryModule],
  controllers: [SalesController],
  providers: [SalesService],
  exports: [SalesService],
})
export class SalesModule {}
