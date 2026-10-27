import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  paginationQuerySchema,
  customerCreateSchema,
  customerQuerySchema,
  customerUpdateSchema,
  partnerTopProductsQuerySchema,
  vendorCreateSchema,
  vendorQuerySchema,
  vendorUpdateSchema,
} from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { PartnersService } from './partners.service.js';

@ApiTags('partners')
@UseGuards(TenantContextGuard)
@Controller({ path: 'partners', version: '1' })
export class PartnersController {
  constructor(private readonly partners: PartnersService) {}

  // ── Vendors ────────────────────────────────────────────────────────────────

  @Get('vendors')
  @RequirePermissions('vendors.read')
  async listVendors(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(vendorQuerySchema)) filters: z.infer<typeof vendorQuerySchema>,
  ) {
    const { total, items } = await this.partners.listVendors(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: filters.search,
      status: filters.status,
      stateCode: filters.stateCode,
      withBalances: filters.withBalances,
    });
    return {
      items,
      pageInfo: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
        hasNextPage: pagination.page * pagination.pageSize < total,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  @Get('vendors/:vendorId/products')
  @RequirePermissions('vendors.read', 'purchases.read')
  vendorProducts(
    @Param('vendorId') vendorId: string,
    @Query(new ZodValidationPipe(partnerTopProductsQuerySchema)) query: z.infer<typeof partnerTopProductsQuerySchema>,
    @Req() req: TenantRequest,
  ) {
    return this.partners.vendorProducts(req, vendorId, query.limit);
  }

  @Get('vendors/:vendorId')
  @RequirePermissions('vendors.read')
  getVendor(@Param('vendorId') vendorId: string, @Req() req: TenantRequest) {
    return this.partners.getVendor(req, vendorId);
  }

  @Post('vendors')
  @RequirePermissions('vendors.manage')
  createVendor(
    @Body(new ZodValidationPipe(vendorCreateSchema)) dto: z.infer<typeof vendorCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.partners.createVendor(req, dto);
  }

  @Put('vendors/:vendorId')
  @RequirePermissions('vendors.manage')
  updateVendor(
    @Param('vendorId') vendorId: string,
    @Body(new ZodValidationPipe(vendorUpdateSchema)) dto: z.infer<typeof vendorUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.partners.updateVendor(req, vendorId, dto);
  }

  // ── Customers ──────────────────────────────────────────────────────────────

  @Get('customers')
  @RequirePermissions('customers.read')
  async listCustomers(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(customerQuerySchema)) filters: z.infer<typeof customerQuerySchema>,
  ) {
    const { total, items } = await this.partners.listCustomers(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: filters.search,
      status: filters.status,
      isWholesale: filters.isWholesale,
      withBalances: filters.withBalances,
    });
    return {
      items,
      pageInfo: {
        page: pagination.page,
        pageSize: pagination.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
        hasNextPage: pagination.page * pagination.pageSize < total,
        hasPreviousPage: pagination.page > 1,
      },
    };
  }

  @Get('customers/:customerId/top-products')
  @RequirePermissions('customers.read', 'sales.read')
  customerTopProducts(
    @Param('customerId') customerId: string,
    @Query(new ZodValidationPipe(partnerTopProductsQuerySchema)) query: z.infer<typeof partnerTopProductsQuerySchema>,
    @Req() req: TenantRequest,
  ) {
    return this.partners.customerTopProducts(req, customerId, query.limit);
  }

  @Get('customers/:customerId')
  @RequirePermissions('customers.read')
  getCustomer(@Param('customerId') customerId: string, @Req() req: TenantRequest) {
    return this.partners.getCustomer(req, customerId);
  }

  @Post('customers')
  @RequirePermissions('customers.manage')
  createCustomer(
    @Body(new ZodValidationPipe(customerCreateSchema)) dto: z.infer<typeof customerCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.partners.createCustomer(req, dto);
  }

  @Put('customers/:customerId')
  @RequirePermissions('customers.manage')
  updateCustomer(
    @Param('customerId') customerId: string,
    @Body(new ZodValidationPipe(customerUpdateSchema)) dto: z.infer<typeof customerUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.partners.updateCustomer(req, customerId, dto);
  }
}
