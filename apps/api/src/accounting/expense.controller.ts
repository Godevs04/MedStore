import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { RequireModule } from '../common/subscription-policy.js';
import { ExpenseService } from './expense.service.js';

const expenseSchema = z.object({
  category: z.string().trim().min(2).max(80),
  payee: z.string().trim().min(2).max(160),
  amount: z.string().regex(/^\d+(\.\d{1,2})?$/),
  method: z.enum(['CASH', 'BANK', 'UPI']),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  notes: z.string().max(300).nullish(),
});

@ApiTags('accounting')
@UseGuards(TenantContextGuard)
@RequireModule('accounting')
@Controller({ path: 'accounting/expenses', version: '1' })
export class ExpenseController {
  constructor(private readonly expenses: ExpenseService) {}

  @Post()
  @RequirePermissions('accounting.post')
  createExpense(@Body(new ZodValidationPipe(expenseSchema)) dto: z.infer<typeof expenseSchema>, @Req() req: TenantRequest) {
    return this.expenses.createExpense(req, dto);
  }

  @Get()
  @RequirePermissions('accounting.read')
  async listExpenses(
    @Req() req: TenantRequest,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '50',
  ) {
    return this.expenses.listExpenses(req, { page: Number(page), pageSize: Number(pageSize) });
  }
}
