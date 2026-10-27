import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  NotFoundException,
  SetMetadata,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.module.js';
import type { AuthenticatedRequest } from '../auth/session.guard.js';
import { AppException } from '../common/app-exception.js';
import { MODULE_KEY, MODULE_LABELS, planIncludes, subscriptionAccess, type PlanModule } from '../common/subscription-policy.js';

export const PERMISSIONS_KEY = 'requiredPermissions';

/**
 * Decorates an endpoint with the permissions required. ALL listed must be held.
 * Pass one permission key or several (AND semantics).
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);

/**
 * Request context established by TenantContextGuard for org-scoped endpoints.
 * branchId is null when the client did not send x-branch-id (branch-agnostic
 * endpoints such as org settings or branch listings).
 */
export interface TenantContext {
  organizationId: string;
  membershipId: string;
  branchId: string | null;
  permissions: Set<string>;
  isOwner: boolean;
}

export interface TenantRequest extends AuthenticatedRequest {
  tenantContext: TenantContext;
}

export const TENANT_HEADER_ORG = 'x-organization-id';
export const TENANT_HEADER_BRANCH = 'x-branch-id';

/**
 * Enforces organization + branch scoping on the server (spec §1.17, §5):
 *  1. Resolves the requested organization (and optional branch) from headers.
 *  2. Verifies the user has an ACTIVE membership in that organization.
 *  3. Verifies the user is assigned to that branch when provided (or
 *     manages all branches / is owner).
 *  4. Loads effective permissions (role permissions + owner override).
 *  5. If @RequirePermissions(...) is present, enforces it.
 */
@Injectable()
export class TenantContextGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<string[] | undefined>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    const request = context.switchToHttp().getRequest<Request>();

    // Platform-scope / public endpoints: no tenant headers and no permission
    // requirement means the endpoint is not org-scoped (e.g. /auth/*).
    // Auth and platform routes ignore stale tenant headers, so a different
    // user signing in on a shared browser is never rejected by a foreign org.
    if (requiredPermissions === undefined && (!request.headers[TENANT_HEADER_ORG] || /\/(auth|platform)\//.test(request.path))) {
      return true;
    }

    const principal = (request as AuthenticatedRequest).principal;
    if (!principal) throw new ForbiddenException('Authentication required');

    const orgId = request.headers[TENANT_HEADER_ORG];
    if (typeof orgId !== 'string' || orgId.length === 0) {
      throw new UnprocessableEntityException('x-organization-id header is required');
    }
    const branchHeader = request.headers[TENANT_HEADER_BRANCH];

    const membership = await this.prisma.organizationMembership.findFirst({
      where: { organizationId: orgId, userId: principal.userId, status: 'ACTIVE' },
      include: {
        role: { include: { permissions: { include: { permission: true } } } },
        branchAssignments: true,
      },
    });

    // Negative-path: no membership → not found, to avoid org existence leaks.
    if (!membership) throw new NotFoundException('Organization not found');
    if (!membership.isOwner && !membership.role) {
      throw new ForbiddenException('Membership has no role assigned');
    }

    const isOwner = membership.isOwner;
    const permissions = new Set<string>(
      membership.role?.permissions.map((rp) => rp.permission.key) ?? [],
    );
    if (isOwner) {
      // Owner holds every organization permission by definition.
      const all = await this.prisma.permission.findMany({ select: { key: true } });
      for (const p of all) permissions.add(p.key);
    }

    let branchId: string | null = null;
    if (typeof branchHeader === 'string' && branchHeader.length > 0) {
      const branch = await this.prisma.branch.findFirst({
        where: { id: branchHeader, organizationId: orgId, isActive: true },
      });
      if (!branch) throw new NotFoundException('Branch not found');
      const assignedBranchIds = new Set(membership.branchAssignments.map((a) => a.branchId));
      // Owners and users with branches.manage can operate across all branches.
      if (!isOwner && !permissions.has('branches.manage') && !assignedBranchIds.has(branchHeader)) {
        throw new ForbiddenException('You are not assigned to this branch');
      }
      branchId = branchHeader;
    }

    await this.enforceSubscription(context, request, orgId);

    if (requiredPermissions && requiredPermissions.length > 0) {
      const missing = requiredPermissions.filter((p) => !permissions.has(p));
      if (missing.length > 0) {
        throw new ForbiddenException(`Missing required permission(s): ${missing.join(', ')}`);
      }
    }

    (request as TenantRequest).tenantContext = {
      organizationId: orgId,
      membershipId: membership.id,
      branchId,
      permissions,
      isOwner,
    };
    return true;
  }

  /**
   * SaaS access policy: platform suspension locks the tenant out (except the
   * subscription screen), a lapsed subscription makes it read-only, and
   * plan-gated modules require entitlement.
   */
  private async enforceSubscription(context: ExecutionContext, request: Request, orgId: string): Promise<void> {
    // Platform and auth routes are not tenant business actions.
    if (/\/(platform|auth)\//.test(request.path)) return;
    const [subscription, settingsRow] = await Promise.all([
      this.prisma.subscription.findUnique({ where: { organizationId: orgId }, include: { plan: true } }),
      this.prisma.organizationSettings.findUnique({ where: { organizationId: orgId }, select: { settings: true } }),
    ]);
    const isRead = ['GET', 'HEAD', 'OPTIONS'].includes(request.method);
    const isAccountScreen = /\/organizations(\/subscription)?\/?$/.test(request.path);
    const suspended = (settingsRow?.settings as Record<string, unknown> | null)?.suspended === true;
    if (suspended && !(isRead && isAccountScreen)) {
      throw new AppException('SUBSCRIPTION_INACTIVE', 'This workspace has been suspended by the platform administrator. Contact MediCore support.', 403);
    }
    if (!subscription) return;
    if (!isRead && subscriptionAccess(subscription).lapsed) {
      throw new AppException(
        'SUBSCRIPTION_INACTIVE',
        `Your ${subscription.plan.name} subscription has ended. Records remain readable; renew to resume billing and postings.`,
        402,
      );
    }
    const module = this.reflector.getAllAndOverride<PlanModule | undefined>(MODULE_KEY, [context.getHandler(), context.getClass()]);
    if (module && !planIncludes(subscription.plan.limits, module)) {
      throw new AppException('FEATURE_NOT_ENTITLED', `${MODULE_LABELS[module]} is not included in the ${subscription.plan.name} plan. Upgrade to enable it.`, 403);
    }
  }
}
