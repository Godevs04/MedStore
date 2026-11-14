import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module.js';
import { BillingController, BillingWebhookController } from './billing.controller.js';
import { BillingService } from './billing.service.js';

@Module({
  imports: [AuditModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [BillingService],
})
export class BillingModule {}
