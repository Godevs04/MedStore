import { Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { SessionGuard } from '../auth/session.guard.js';
import { PlatformGuard } from './platform.guard.js';
import { PlatformService } from './platform.service.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';

const tenantStatusSchema = z.object({ suspended: z.boolean() });
const assignSubscriptionSchema = z.object({
  planKey: z.enum(['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']),
  status: z.enum(['TRIALING', 'ACTIVE', 'PAST_DUE', 'GRACE', 'CANCELLED', 'EXPIRED']),
  periodDays: z.number().int().min(1).max(1095),
  notes: z.string().trim().max(300).nullish(),
});
const planLimitsSchema = z.object({
  planKey: z.enum(['TRIAL', 'STARTER', 'PROFESSIONAL', 'BUSINESS', 'ENTERPRISE']),
  limits: z
    .object({
      monthlyInvoiceLimit: z.number().int().min(-1),
      maxUsers: z.number().int().min(-1),
      maxBranches: z.number().int().min(-1),
      maxWarehouses: z.number().int().min(-1),
      storageMb: z.number().int().min(-1).optional(),
      reportRetentionDays: z.number().int().min(-1).optional(),
      modules: z.array(z.enum(['*', 'catalog', 'inventory', 'pos', 'purchases', 'returns', 'wholesale', 'accounting'])),
      apiAccess: z.boolean().optional(),
    })
    .passthrough(),
});

@ApiTags('platform')
@UseGuards(SessionGuard, PlatformGuard)
@Controller({ path: 'platform', version: '1' })
export class PlatformController {
  constructor(private readonly platform: PlatformService) {}

  @Get('overview')
  overview() {
    return this.platform.overview();
  }

  @Get('plans')
  listPlans() {
    return this.platform.listPlans();
  }

  @Post('tenants/:orgId/subscription')
  assignSubscription(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(assignSubscriptionSchema)) dto: z.infer<typeof assignSubscriptionSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.platform.assignSubscription(req, orgId, dto);
  }

  @Get('tenants')
  async listTenants(
    @Req() req: AuthenticatedRequest,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
    @Query('search') search?: string,
  ) {
    const p = Math.max(1, Math.floor(Number(page)) || 1);
    const size = Math.min(100, Math.max(1, Math.floor(Number(pageSize)) || 25));
    return this.platform.listTenants(req, { page: p, pageSize: size, search: search?.trim().slice(0, 100) || undefined });
  }

  @Post('tenants/:orgId/status')
  async setTenantStatus(
    @Param('orgId') orgId: string,
    @Body(new ZodValidationPipe(tenantStatusSchema)) dto: z.infer<typeof tenantStatusSchema>,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.platform.setTenantStatus(req, orgId, dto.suspended);
  }

  @Get('tenants/:orgId/usage')
  async tenantUsage(@Param('orgId') orgId: string, @Req() req: AuthenticatedRequest) {
    return this.platform.tenantUsage(req, orgId);
  }

  @Post('plans/limits')
  async updatePlanLimits(@Body(new ZodValidationPipe(planLimitsSchema)) dto: z.infer<typeof planLimitsSchema>, @Req() req: AuthenticatedRequest) {
    return this.platform.updatePlanLimits(req, dto.planKey, dto.limits);
  }
}
