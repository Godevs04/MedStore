import { Body, Controller, HttpCode, HttpStatus, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { BILLING_INTERVALS, PAID_PLAN_KEYS } from '@medicore/shared-types';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { BillingService } from './billing.service.js';

const checkoutSchema = z.object({
  planKey: z.enum(PAID_PLAN_KEYS),
  interval: z.enum(BILLING_INTERVALS),
});

const verifySchema = z.object({
  razorpay_order_id: z.string().trim().min(1).max(100),
  razorpay_payment_id: z.string().trim().min(1).max(100),
  razorpay_signature: z.string().trim().min(1).max(200),
});

@ApiTags('organizations')
@UseGuards(TenantContextGuard)
@Controller({ path: 'organizations/subscription', version: '1' })
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Post('checkout')
  @RequirePermissions('organization.settings.manage')
  @HttpCode(HttpStatus.CREATED)
  checkout(@Req() req: TenantRequest, @Body(new ZodValidationPipe(checkoutSchema)) dto: z.infer<typeof checkoutSchema>) {
    return this.billing.createOrder(req, dto);
  }

  @Post('verify')
  @RequirePermissions('organization.settings.manage')
  @HttpCode(HttpStatus.OK)
  verify(@Req() req: TenantRequest, @Body(new ZodValidationPipe(verifySchema)) dto: z.infer<typeof verifySchema>) {
    return this.billing.verifyPayment(req, dto);
  }
}
