import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { ComplianceService } from './compliance.service.js';
import { ComplianceController } from './compliance.controller.js';

@Module({
  imports: [AuditModule],
  controllers: [ComplianceController],
  providers: [ComplianceService],
  exports: [ComplianceService],
})
export class ComplianceModule {}
