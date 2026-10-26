import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module.js';
import { AuthModule } from './auth/auth.module.js';
import { AuditModule } from './audit/audit.module.js';
import { OrganizationsModule } from './organizations/organizations.module.js';
import { CorrelationIdMiddleware } from './common/correlation-id.middleware.js';
import { SessionGuard } from './auth/session.guard.js';
import { TenantContextGuard } from './rbac/tenant-context.guard.js';
import { HealthController } from './health/health.controller.js';

/**
 * Guard order matters: SessionGuard authenticates, TenantContextGuard then
 * resolves org/branch + permissions for org-scoped endpoints.
 */
@Module({
  imports: [PrismaModule, AuthModule, AuditModule, OrganizationsModule],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: SessionGuard },
    { provide: APP_GUARD, useClass: TenantContextGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}
