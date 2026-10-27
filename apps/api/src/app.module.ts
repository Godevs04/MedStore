import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
import { RateLimitMiddleware } from './common/rate-limit.middleware.js';
import { SessionGuard } from './auth/session.guard.js';
import { TenantContextGuard } from './rbac/tenant-context.guard.js';
import { PermissionSyncService } from './rbac/permission-sync.service.js';
import { HealthController } from './health/health.controller.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { PartnersModule } from './partners/partners.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { AccountingModule } from './accounting/accounting.module.js';
import { PurchasingModule } from './purchasing/purchasing.module.js';
import { SalesModule } from './sales/sales.module.js';
import { ComplianceModule } from './compliance/compliance.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { PlatformModule } from './platform/platform.module.js';

/**
 * Guard order matters: SessionGuard authenticates, TenantContextGuard then
 * resolves org/branch + permissions for org-scoped endpoints.
 */
@Module({
  imports: [
    PrismaModule,
    AuthModule,
    AuditModule,
    OrganizationsModule,
    CatalogModule,
    PartnersModule,
    InventoryModule,
    AccountingModule,
    PurchasingModule,
    SalesModule,
    ComplianceModule,
    ReportsModule,
    PlatformModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
    PermissionSyncService,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
    // Phase 12: rate limiting on authentication endpoints (see middleware for
    // the multi-instance Redis note).
    consumer
      .apply(RateLimitMiddleware)
      .forRoutes('api/v1/auth/login', 'api/v1/auth/register', 'api/v1/auth/password/forgot');
  }
}
