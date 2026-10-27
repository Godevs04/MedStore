import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  billingCounterCreateSchema,
  billingCounterUpdateSchema,
  branchCreateSchema,
  branchUpdateSchema,
  memberBranchesSchema,
  memberInviteSchema,
  memberListQuerySchema,
  organizationSettingsSchema,
  organizationUpdateSchema,
  paginationQuerySchema,
  roleCreateSchema,
  rolePermissionsSchema,
  warehouseCreateSchema,
} from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { pageInfo } from '../common/query.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';

const setMemberRoleSchema = z.object({
  roleId: z.string().uuid().nullable(),
});

const setMemberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

@ApiTags('organizations')
@UseGuards(TenantContextGuard)
@Controller({ path: 'organizations', version: '1' })
export class OrganizationsController {
  constructor(private readonly orgs: OrganizationsService) {}

  @Get('permissions')
  @RequirePermissions('roles.read')
  permissionCatalog() {
    return this.orgs.listPermissionCatalog();
  }

  @Get('setup-checklist')
  @RequirePermissions('organization.read')
  setupChecklist(@Req() req: TenantRequest) {
    return this.orgs.getSetupChecklist(req);
  }

  @Post('setup-complete')
  @RequirePermissions('organization.settings.onboard')
  @HttpCode(HttpStatus.OK)
  async completeSetup(@Req() req: TenantRequest) {
    return this.orgs.completeSetup(req);
  }

  @Get('subscription')
  @RequirePermissions('organization.read')
  getSubscription(@Req() req: TenantRequest) {
    return this.orgs.getSubscription(req);
  }

  @Get('subscription/events')
  @RequirePermissions('organization.read')
  subscriptionEvents(@Req() req: TenantRequest) {
    return this.orgs.subscriptionEvents(req);
  }

  @Get()
  @RequirePermissions('organization.read')
  getOrganization(@Req() req: TenantRequest) {
    return this.orgs.getOrganization(req);
  }

  @Patch()
  @RequirePermissions('organization.settings.manage')
  async updateOrganization(
    @Body(new ZodValidationPipe(organizationUpdateSchema)) dto: z.infer<typeof organizationUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateOrganization(req, dto);
  }

  @Patch('settings')
  @RequirePermissions('organization.settings.manage')
  async updateSettings(
    @Body(new ZodValidationPipe(organizationSettingsSchema)) dto: z.infer<typeof organizationSettingsSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateSettings(req, dto);
  }

  // ── Branches, counters & warehouses ────────────────────────────────────────

  @Get('branches')
  @RequirePermissions('branches.read')
  listBranches(@Req() req: TenantRequest) {
    return this.orgs.listBranches(req);
  }

  @Post('branches')
  @RequirePermissions('branches.manage')
  async createBranch(
    @Body(new ZodValidationPipe(branchCreateSchema)) dto: z.infer<typeof branchCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.createBranch(req, dto);
  }

  @Patch('branches/:branchId')
  @RequirePermissions('branches.manage')
  async updateBranch(
    @Param('branchId') branchId: string,
    @Body(new ZodValidationPipe(branchUpdateSchema)) dto: z.infer<typeof branchUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateBranch(req, branchId, dto);
  }

  @Post('branches/:branchId/counters')
  @RequirePermissions('branches.manage')
  async createCounter(
    @Param('branchId') branchId: string,
    @Body(new ZodValidationPipe(billingCounterCreateSchema)) dto: z.infer<typeof billingCounterCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.createCounter(req, branchId, dto.name);
  }

  @Patch('counters/:counterId')
  @RequirePermissions('branches.manage')
  async updateCounter(
    @Param('counterId') counterId: string,
    @Body(new ZodValidationPipe(billingCounterUpdateSchema)) dto: z.infer<typeof billingCounterUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateCounter(req, counterId, dto);
  }

  @Post('branches/:branchId/warehouses')
  @RequirePermissions('branches.manage')
  async createWarehouse(
    @Param('branchId') branchId: string,
    @Body(new ZodValidationPipe(warehouseCreateSchema)) dto: z.infer<typeof warehouseCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.createWarehouse(req, branchId, dto);
  }

  // ── Members ────────────────────────────────────────────────────────────────

  @Get('members')
  @RequirePermissions('users.read')
  async listMembers(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) query: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(memberListQuerySchema)) filters: z.infer<typeof memberListQuerySchema>,
  ) {
    const result = await this.orgs.listMembers(req, { page: query.page, pageSize: query.pageSize, ...filters });
    return { items: result.items, counts: result.counts, pageInfo: pageInfo(query, result.total) };
  }

  @Post('members/invite')
  @RequirePermissions('users.manage')
  async inviteMember(
    @Body(new ZodValidationPipe(memberInviteSchema)) dto: z.infer<typeof memberInviteSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.inviteMember(req, dto);
  }

  @Post('members/:membershipId/invite/resend')
  @RequirePermissions('users.manage')
  @HttpCode(HttpStatus.OK)
  async resendInvite(@Param('membershipId') membershipId: string, @Req() req: TenantRequest) {
    return this.orgs.resendInvite(req, membershipId);
  }

  @Delete('members/:membershipId/invite')
  @RequirePermissions('users.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeInvite(@Param('membershipId') membershipId: string, @Req() req: TenantRequest) {
    await this.orgs.revokeInvite(req, membershipId);
  }

  @Patch('members/:membershipId/role')
  @RequirePermissions('users.manage')
  async setMemberRole(
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(setMemberRoleSchema)) dto: z.infer<typeof setMemberRoleSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.setMemberRole(req, membershipId, dto.roleId);
  }

  @Patch('members/:membershipId/branches')
  @RequirePermissions('users.manage')
  async setMemberBranches(
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(memberBranchesSchema)) dto: z.infer<typeof memberBranchesSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.setMemberBranches(req, membershipId, dto.branchIds);
  }

  @Patch('members/:membershipId/status')
  @RequirePermissions('users.manage')
  async setMemberStatus(
    @Param('membershipId') membershipId: string,
    @Body(new ZodValidationPipe(setMemberStatusSchema)) dto: z.infer<typeof setMemberStatusSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.setMemberStatus(req, membershipId, dto.status);
  }

  // ── Roles ──────────────────────────────────────────────────────────────────

  @Get('roles')
  @RequirePermissions('roles.read')
  listRoles(@Req() req: TenantRequest) {
    return this.orgs.listRoles(req);
  }

  @Get('roles/templates')
  @RequirePermissions('roles.read')
  roleTemplates() {
    return this.orgs.systemRoleTemplates();
  }

  @Post('roles')
  @RequirePermissions('roles.manage')
  async createRole(
    @Body(new ZodValidationPipe(roleCreateSchema)) dto: z.infer<typeof roleCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.createRole(req, dto);
  }

  @Patch('roles/:roleId/permissions')
  @RequirePermissions('roles.manage')
  async updateRolePermissions(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(rolePermissionsSchema)) dto: z.infer<typeof rolePermissionsSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateRolePermissions(req, roleId, dto.permissionKeys);
  }

  @Delete('roles/:roleId')
  @RequirePermissions('roles.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteRole(@Param('roleId') roleId: string, @Req() req: TenantRequest) {
    // Custom roles only; deletion re-checks membership references.
    await this.orgs.deleteRole(req, roleId);
  }
}
