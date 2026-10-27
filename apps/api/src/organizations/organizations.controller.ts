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
  branchCreateSchema,
  paginationQuerySchema,
  warehouseCreateSchema,
} from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { ValidationFailed } from '../common/app-exception.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { UseGuards } from '@nestjs/common';
import { OrganizationsService } from './organizations.service.js';

const inviteMemberSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  fullName: z.string().trim().min(2).max(120),
  roleId: z.string().uuid().nullable(),
  branchIds: z.array(z.string().uuid()).max(50).default([]),
});

const createRoleSchema = z.object({
  name: z.string().trim().min(2).max(80),
  description: z.string().trim().max(300).nullish(),
  permissionKeys: z.array(z.string().max(64)).min(0).max(200),
});

const updateRolePermissionsSchema = z.object({
  permissionKeys: z.array(z.string().max(64)).min(0).max(200),
});

const setMemberRoleSchema = z.object({
  roleId: z.string().uuid().nullable(),
});

const setMemberStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
});

const updateOrgSchema = z.object({
  name: z.string().trim().min(2).max(160).optional(),
  legalEntityName: z.string().trim().max(160).nullish(),
  gstRegistrationStatus: z.enum(['REGULAR', 'COMPOSITION', 'UNREGISTERED', 'CONSUMER']).optional(),
  gstin: z.string().trim().toUpperCase().max(15).nullish(),
  pan: z.string().trim().toUpperCase().max(10).nullish(),
  addressLine1: z.string().trim().max(200).nullish(),
  addressLine2: z.string().trim().max(200).nullish(),
  city: z.string().trim().max(100).nullish(),
  stateCode: z.string().trim().max(2).nullish(),
  pinCode: z.string().trim().max(6).nullish(),
  contactPhone: z.string().trim().max(20).nullish(),
  contactEmail: z.string().trim().toLowerCase().email().nullish(),
  financialYearStartMonth: z.number().int().min(1).max(12).optional(),
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

  @Get()
  @RequirePermissions('organization.read')
  getOrganization(@Req() req: TenantRequest) {
    return this.orgs.getOrganization(req);
  }

  @Patch()
  @RequirePermissions('organization.settings.manage')
  async updateOrganization(
    @Body(new ZodValidationPipe(updateOrgSchema)) dto: z.infer<typeof updateOrgSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateOrganization(req, dto);
  }

  @Patch('settings')
  @RequirePermissions('organization.settings.manage')
  async updateSettings(@Body() body: unknown, @Req() req: TenantRequest) {
    // Settings is schema-flexible JSON validated at the service boundary;
    // enforce object shape here.
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      throw ValidationFailed([{ message: 'Settings must be a JSON object' }]);
    }
    return this.orgs.updateSettings(req, body as Record<string, unknown>);
  }

  // ── Branches & warehouses ──────────────────────────────────────────────────

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
    @Body(new ZodValidationPipe(branchCreateSchema.partial())) dto: Partial<z.infer<typeof branchCreateSchema>>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.updateBranch(req, branchId, dto);
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
  async listMembers(@Req() req: TenantRequest, @Query(new ZodValidationPipe(paginationQuerySchema)) query: z.infer<typeof paginationQuerySchema>) {
    const result = await this.orgs.listMembers(req, { page: query.page, pageSize: query.pageSize });
    return {
      items: result.items,
      pageInfo: {
        page: query.page,
        pageSize: query.pageSize,
        totalItems: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / query.pageSize)),
        hasNextPage: query.page * query.pageSize < result.total,
        hasPreviousPage: query.page > 1,
      },
    };
  }

  @Post('members/invite')
  @RequirePermissions('users.manage')
  async inviteMember(
    @Body(new ZodValidationPipe(inviteMemberSchema)) dto: z.infer<typeof inviteMemberSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.inviteMember(req, dto);
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
    @Body(new ZodValidationPipe(createRoleSchema)) dto: z.infer<typeof createRoleSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.orgs.createRole(req, dto);
  }

  @Patch('roles/:roleId/permissions')
  @RequirePermissions('roles.manage')
  async updateRolePermissions(
    @Param('roleId') roleId: string,
    @Body(new ZodValidationPipe(updateRolePermissionsSchema)) dto: z.infer<typeof updateRolePermissionsSchema>,
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
