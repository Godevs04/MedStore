import { Body, Controller, Get, Param, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  paginationQuerySchema,
  productCreateSchema,
  productQuerySchema,
  categoryCreateSchema,
  manufacturerCreateSchema,
  taxRateVersionCreateSchema,
} from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { CatalogService } from './catalog.service.js';

const productUpdateSchema = productCreateSchema.partial();

@ApiTags('catalog')
@UseGuards(TenantContextGuard)
@Controller({ path: 'catalog', version: '1' })
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  // ── Taxonomy ───────────────────────────────────────────────────────────────

  @Get('categories')
  @RequirePermissions('products.read')
  listCategories(@Req() req: TenantRequest) {
    return this.catalog.listCategories(req);
  }

  @Post('categories')
  @RequirePermissions('categories.manage')
  createCategory(
    @Body(new ZodValidationPipe(categoryCreateSchema)) dto: z.infer<typeof categoryCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.createCategory(req, dto);
  }

  @Get('manufacturers')
  @RequirePermissions('products.read')
  listManufacturers(@Req() req: TenantRequest) {
    return this.catalog.listManufacturers(req);
  }

  @Post('manufacturers')
  @RequirePermissions('categories.manage')
  createManufacturer(
    @Body(new ZodValidationPipe(manufacturerCreateSchema)) dto: z.infer<typeof manufacturerCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.createManufacturer(req, dto);
  }

  // ── Tax configuration ──────────────────────────────────────────────────────

  @Get('tax-rates')
  @RequirePermissions('tax.read')
  listTaxRates(@Req() req: TenantRequest) {
    return this.catalog.listTaxRates(req);
  }

  @Post('tax-rates')
  @RequirePermissions('tax.manage')
  createTaxRate(
    @Body(new ZodValidationPipe(taxRateVersionCreateSchema)) dto: z.infer<typeof taxRateVersionCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.createTaxRate(req, dto);
  }

  // ── Products ───────────────────────────────────────────────────────────────

  @Get('products')
  @RequirePermissions('products.read')
  async listProducts(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(productQuerySchema)) filters: z.infer<typeof productQuerySchema>,
  ) {
    const { total, items } = await this.catalog.listProducts(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      search: filters.search,
      categoryId: filters.categoryId,
      status: filters.status,
      sortBy: pagination.sortBy,
      sortDirection: pagination.sortDirection,
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

  @Get('products/barcode/:barcode')
  @RequirePermissions('products.read')
  findByBarcode(@Param('barcode') barcode: string, @Req() req: TenantRequest) {
    return this.catalog.findByBarcode(req, barcode);
  }

  @Post('products/duplicates-check')
  @RequirePermissions('products.read')
  findDuplicates(
    @Body() body: Array<{ name: string; genericName?: string | null; strength?: string | null }>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.findDuplicates(req, body);
  }

  @Get('products/:productId')
  @RequirePermissions('products.read')
  getProduct(@Param('productId') productId: string, @Req() req: TenantRequest) {
    return this.catalog.getProduct(req, productId);
  }

  @Post('products')
  @RequirePermissions('products.create')
  createProduct(
    @Body(new ZodValidationPipe(productCreateSchema)) dto: z.infer<typeof productCreateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.createProduct(req, dto);
  }

  @Put('products/:productId')
  @RequirePermissions('products.update')
  updateProduct(
    @Param('productId') productId: string,
    @Body(new ZodValidationPipe(productUpdateSchema)) dto: z.infer<typeof productUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.updateProduct(req, productId, dto);
  }

  @Put('products/:productId/deactivate')
  @RequirePermissions('products.deactivate')
  deactivateProduct(@Param('productId') productId: string, @Req() req: TenantRequest) {
    return this.catalog.deactivateProduct(req, productId);
  }
}
