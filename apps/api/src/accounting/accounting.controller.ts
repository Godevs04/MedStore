import { Body, Controller, Get, Param, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { asOfQuerySchema, dateRangeQuerySchema, financialYearOf, paginationQuerySchema } from '@medicore/validation';
import { sendCsv } from '../common/csv.js';
import { ZodValidationPipe } from '../common/zod-validation.pipe.js';
import { RequirePermissions, TenantContextGuard, type TenantRequest } from '../rbac/tenant-context.guard.js';
import { RequireModule } from '../common/subscription-policy.js';
import { AccountingService } from './accounting.service.js';

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const optionalDate = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : undefined);

const journalSchema = z.object({
  date: isoDate,
  memo: z.string().trim().min(3).max(300),
  lines: z
    .array(
      z.object({
        systemKey: z.string().max(30).optional(),
        accountId: z.string().uuid().optional(),
        debit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
        credit: z.string().regex(/^\d+(\.\d{1,2})?$/).optional(),
      }),
    )
    .min(2)
    .max(50),
});

const reverseSchema = z.object({
  memo: z.string().trim().max(300).optional(),
  date: isoDate.optional(),
});

const periodLockSchema = z.object({
  periodLabel: z.string().regex(/^\d{4}-\d{2}$/),
  locked: z.boolean(),
});

type DateRange = z.infer<typeof dateRangeQuerySchema>;

@ApiTags('accounting')
@UseGuards(TenantContextGuard)
@RequireModule('accounting')
@Controller({ path: 'accounting', version: '1' })
export class AccountingController {
  constructor(private readonly accounting: AccountingService) {}

  @Get('accounts')
  @RequirePermissions('accounting.read')
  listAccounts(@Req() req: TenantRequest) {
    return this.accounting.listAccounts(req);
  }

  @Get('accounts/:accountId/ledger')
  @RequirePermissions('accounting.read')
  accountLedger(@Param('accountId') accountId: string, @Req() req: TenantRequest, @Query('from') from?: string, @Query('to') to?: string) {
    return this.accounting.accountLedger(req, accountId, optionalDate(from), optionalDate(to));
  }

  @Post('journals')
  @RequirePermissions('accounting.post')
  postJournal(@Body(new ZodValidationPipe(journalSchema)) dto: z.infer<typeof journalSchema>, @Req() req: TenantRequest) {
    return this.accounting.postManualJournal(req, dto);
  }

  @Post('journals/:entryId/reverse')
  @RequirePermissions('accounting.post')
  reverseEntry(@Param('entryId') entryId: string, @Body(new ZodValidationPipe(reverseSchema)) dto: z.infer<typeof reverseSchema>, @Req() req: TenantRequest) {
    return this.accounting.reverseEntry(req, entryId, dto.memo ?? '', dto.date);
  }

  @Get('journals')
  @RequirePermissions('accounting.read')
  async listJournals(
    @Req() req: TenantRequest,
    @Query(new ZodValidationPipe(paginationQuerySchema)) pagination: z.infer<typeof paginationQuerySchema>,
    @Query('sourceType') sourceType?: string,
  ) {
    const [total, items] = await this.accounting.listJournalEntries(req, {
      page: pagination.page,
      pageSize: pagination.pageSize,
      sourceType: sourceType || undefined,
    });
    return { items, pageInfo: { page: pagination.page, pageSize: pagination.pageSize, totalItems: total, totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)), hasNextPage: pagination.page * pagination.pageSize < total, hasPreviousPage: pagination.page > 1 } };
  }

  @Get('trial-balance')
  @RequirePermissions('accounting.read')
  trialBalance(@Req() req: TenantRequest, @Query('asOf') asOf?: string) {
    return this.accounting.trialBalance(req, optionalDate(asOf));
  }

  @Get('profit-and-loss')
  @RequirePermissions('accounting.read')
  profitAndLoss(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    return this.accounting.profitAndLoss(req, q.from, q.to);
  }

  @Get('profit-and-loss/trend')
  @RequirePermissions('accounting.read')
  profitAndLossTrend(@Req() req: TenantRequest, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    const fy = financialYearOf(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10));
    return this.accounting.profitAndLossTrend(req, q.from ?? fy.from, q.to ?? fy.to);
  }

  @Get('profit-and-loss/export')
  @RequirePermissions('accounting.read', 'reports.export')
  async profitAndLossExport(@Req() req: TenantRequest, @Res() res: Response, @Query(new ZodValidationPipe(dateRangeQuerySchema)) q: DateRange) {
    const p = await this.accounting.profitAndLoss(req, q.from, q.to);
    sendCsv(res, `profit-and-loss-${q.from ?? 'all'}-${q.to ?? 'today'}.csv`, ['Section', 'Code', 'Account', 'Amount'], [
      ...p.income.map((r) => ['Income', r.code, r.name, r.amount]),
      ['Income', '', 'Total income', p.totalIncome],
      ...p.expenses.map((r) => ['Expenses', r.code, r.name, r.amount]),
      ['Expenses', '', 'Total expenses', p.totalExpenses],
      ['Summary', '', 'Net sales', p.netSales],
      ['Summary', '', 'Gross profit', p.grossProfit],
      ['Summary', '', 'Net profit', p.netProfit],
    ]);
  }

  @Get('balance-sheet')
  @RequirePermissions('accounting.read')
  balanceSheet(@Req() req: TenantRequest, @Query(new ZodValidationPipe(asOfQuerySchema)) q: z.infer<typeof asOfQuerySchema>) {
    return this.accounting.balanceSheet(req, q.asOf);
  }

  @Get('balance-sheet/export')
  @RequirePermissions('accounting.read', 'reports.export')
  async balanceSheetExport(@Req() req: TenantRequest, @Res() res: Response, @Query(new ZodValidationPipe(asOfQuerySchema)) q: z.infer<typeof asOfQuerySchema>) {
    const b = await this.accounting.balanceSheet(req, q.asOf);
    sendCsv(res, `balance-sheet-${q.asOf ?? 'today'}.csv`, ['Section', 'Code', 'Account', 'Amount'], [
      ...b.assets.map((r) => ['Assets', r.code, r.name, r.amount]),
      ['Assets', '', 'Total assets', b.totalAssets],
      ...b.liabilities.map((r) => ['Liabilities', r.code, r.name, r.amount]),
      ['Liabilities', '', 'Total liabilities', b.totalLiabilities],
      ...b.equity.map((r) => ['Equity', r.code, r.name, r.amount]),
      ['Equity', '', 'Retained earnings (current)', b.retainedEarnings],
      ['Equity', '', 'Total equity', b.totalEquity],
    ]);
  }

  @Get('periods')
  @RequirePermissions('accounting.read')
  listPeriods(@Req() req: TenantRequest) {
    return this.accounting.listPeriods(req);
  }

  @Post('periods/lock')
  @RequirePermissions('accounting.post')
  setPeriodLock(@Body(new ZodValidationPipe(periodLockSchema)) dto: z.infer<typeof periodLockSchema>, @Req() req: TenantRequest) {
    return this.accounting.setPeriodLock(req, dto.periodLabel, dto.locked);
  }
}
