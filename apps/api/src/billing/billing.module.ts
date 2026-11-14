import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BillingController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [AuditModule],
  controllers: [BillingController],
  providers: [BillingService],
})
export class BillingModule {}
