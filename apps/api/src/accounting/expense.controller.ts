import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { dateRangeQuerySchema, expenseCreateSchema, expenseListQuerySchema, paginationQuerySchema } from '@medicore/validation';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { RequireModule } from '../common/subscription-policy.js';
import { ExpenseService } from './expense.service.js';

@ApiTags('accounting')
@UseGuards(TenantContextGuard)
@RequireModule('accounting')
@Controller({ path: 'accounting/expenses', version: '1' })
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Post()
  @RequirePermissions('accounting.post')
  createExpense(@Body(new ZodValidationPipe(expenseCreateSchema)) dto: z.infer<typeof expenseCreateSchema>, @Req() req: TenantRequest) {
    return this.expenses.createExpense(req, dto);
  }

  @Get('summary')
  @RequirePermissions('accounting.read')
  summary(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: z.infer<typeof dateRangeQuerySchema>) {
    return this.expenses.summary(req, q);
  }

  @Get()
  @RequirePermissions('accounting.read')
  listExpenses(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query(new ZodValidationPipe(expenseListQuerySchema)) filters: z.infer<typeof expenseListQuerySchema>,
  ) {
    return this.expenses.listExpenses(req, { ...pagination, ...filters });
  }
}
