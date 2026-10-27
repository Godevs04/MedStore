import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { AccountingService } from './accounting.service.js';
import { ExpenseService } from './expense.service.js';
import { TaxCalculator } from './tax-calculator.js';
import { AccountingController } from './accounting.controller.js';
import { ExpenseController } from './expense.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [AccountingController, ExpenseController],
  providers: [AccountingService, ExpenseService, TaxCalculator],
  exports: [AccountingService, ExpenseService, TaxCalculator],
})
export class AccountingModule {}
