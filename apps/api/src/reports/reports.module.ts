import { Module } from '@nestjs/common';
import { AccountingModule } from '../accounting/accounting.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { ReportsService } from './reports.service.js';
import { ReportsController } from './reports.controller.js';
import { SearchController } from './search.controller.js';
import { SearchService } from './search.service.js';

@Module({
  imports: [AuditModule, AccountingModule],
  controllers: [ReportsController, SearchController],
  providers: [ReportsService, SearchService],
  exports: [ReportsService],
})
export class ReportsModule {}
