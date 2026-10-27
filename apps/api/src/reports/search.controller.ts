import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { globalSearchQuerySchema } from '@medicore/validation';
import type { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { SearchService } from './search.service.js';

@ApiTags('reports')
@UseGuards(TenantContextGuard)
@Controller({ path: 'search', version: '1' })
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Get()
  @RequirePermissions()
  search(@Req() req: TenantRequest, @Query(new ZodValidationPipe(globalSearchQuerySchema)) query: z.infer<typeof globalSearchQuerySchema>) {
    return this.searchService.search(req, query.q, query.limit);
  }
}
