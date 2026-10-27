import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, Patch, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import {
  paginationQuerySchema,
  productCreateSchema,
  productQuerySchema,
  substitutesQuerySchema,
  categoryCreateSchema,
  categoryUpdateSchema,
  manufacturerCreateSchema,
  manufacturerUpdateSchema,
  taxRateVersionCreateSchema,
} from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { CatalogService } from './catalog.service.js';

const productUpdateSchema = productCreateSchema.partial();
const endTaxRateSchema = z.object({ effectiveTo: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD') });
const duplicatesCheckSchema = z
  .array(
    z.object({
      name: z.string().trim().min(1).max(200),
      genericName: z.string().trim().max(200).nullish(),
      strength: z.string().trim().max(100).nullish(),
    }),
  )
  .max(1000);

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

  @Patch('categories/:id')
  @RequirePermissions('categories.manage')
  updateCategory(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(categoryUpdateSchema)) dto: z.infer<typeof categoryUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.updateCategory(req, id, dto);
  }

  @Delete('categories/:id')
  @RequirePermissions('categories.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteCategory(@Param('id') id: string, @Req() req: TenantRequest) {
    await this.catalog.deleteCategory(req, id);
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

  @Patch('manufacturers/:id')
  @RequirePermissions('categories.manage')
  updateManufacturer(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(manufacturerUpdateSchema)) dto: z.infer<typeof manufacturerUpdateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.updateManufacturer(req, id, dto);
  }

  @Delete('manufacturers/:id')
  @RequirePermissions('categories.manage')
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteManufacturer(@Param('id') id: string, @Req() req: TenantRequest) {
    await this.catalog.deleteManufacturer(req, id);
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

  @Patch('tax-rates/:id/end')
  @RequirePermissions('tax.manage')
  endTaxRate(
    @Param('id') id: string,
    @Body(new ZodValidationPipe(endTaxRateSchema)) body: z.infer<typeof endTaxRateSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.endTaxRate(req, id, body.effectiveTo);
  }

  @Post('tax-rates/load-standard')
  @RequirePermissions('tax.manage')
  loadStandardTaxRates(@Req() req: TenantRequest) {
    return this.catalog.loadStandardTaxRates(req);
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
      prescriptionClass: filters.prescriptionClass,
      manufacturerId: filters.manufacturerId,
      stockWarehouseId: filters.stockWarehouseId,
      withStock: filters.withStock,
      ids: filters.ids,
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
    @Body(new ZodValidationPipe(duplicatesCheckSchema)) body: z.infer<typeof duplicatesCheckSchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.findDuplicates(req, body);
  }

  @Get('products/:productId/substitutes')
  @RequirePermissions('products.read')
  substitutes(
    @Param('productId') productId: string,
    @Query(new ZodValidationPipe(substitutesQuerySchema)) query: z.infer<typeof substitutesQuerySchema>,
    @Req() req: TenantRequest,
  ) {
    return this.catalog.substitutes(req, productId, query.warehouseId);
  }

  @Get('products/:productId/history')
  @RequirePermissions('products.read')
  productHistory(@Param('productId') productId: string, @Req() req: TenantRequest) {
    return this.catalog.productHistory(req, productId);
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

  @Put('products/:productId/reactivate')
  @RequirePermissions('products.deactivate')
  reactivateProduct(@Param('productId') productId: string, @Req() req: TenantRequest) {
    return this.catalog.reactivateProduct(req, productId);
  }
}
