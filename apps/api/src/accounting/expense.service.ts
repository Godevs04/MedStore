import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from './accounting.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException } from '../common/app-exception.js';
import { nextDocNumber } from '../common/doc-number.js';
import { major, toPaise } from '../common/money.js';
import { tenderAccount } from '../common/tender.js';

/** Expense management (spec §18): vouchers with accounting posting. */
@Injectable()
export class ExpenseService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly accounting: AccountingService,
  ) {}

  async createExpense(
    request: TenantRequest,
    data: { category: string; payee: string; amount: string; method: 'CASH' | 'BANK' | 'UPI'; expenseDate: string; notes?: string | null },
  ) {
    const orgId = request.tenantContext.organizationId;
    if (toPaise(data.amount) <= 0n) throw new AppException('VALIDATION_ERROR', 'Expense amount must be positive', 400);
    const expenseDate = new Date(`${data.expenseDate}T12:00:00+05:30`);

    const created = await this.prisma.$transaction(async (tx) => {
      const expenseNumber = await nextDocNumber(tx, orgId, 'EXP', expenseDate);
      const expense = await tx.expense.create({
        data: {
          organizationId: orgId,
          expenseNumber,
          category: data.category,
          payee: data.payee,
          amount: data.amount,
          method: data.method,
          expenseDate,
          notes: data.notes ?? null,
          createdById: request.principal.userId,
        },
      });
      const journal = await this.accounting.postJournalEntry(
        request,
        orgId,
        {
          date: expense.expenseDate,
          memo: `Expense ${expenseNumber}: ${data.category} — ${data.payee}`,
          sourceType: 'EXPENSE',
          sourceId: expense.id,
          lines: [
            { systemKey: 'OPEX', debit: data.amount },
            { systemKey: tenderAccount(data.method), credit: data.amount },
          ],
        },
        tx,
      );
      return tx.expense.update({ where: { id: expense.id }, data: { journalEntryId: journal.id } });
    });
    await this.audit.record({
      event: 'EXPENSE_RECORDED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'Expense',
      entityId: created.id,
      details: { expenseNumber: created.expenseNumber, amount: data.amount, category: data.category },
    });
    return created;
  }

  private where(orgId: string, params: { category?: string; method?: string; search?: string; from?: string; to?: string }): Prisma.ExpenseWhereInput {
    return {
      organizationId: orgId,
      ...(params.category ? { category: { equals: params.category, mode: 'insensitive' } } : {}),
      ...(params.method ? { method: params.method as Prisma.ExpenseWhereInput['method'] } : {}),
      ...(params.search
        ? { OR: [{ payee: { contains: params.search, mode: 'insensitive' } }, { expenseNumber: { contains: params.search, mode: 'insensitive' } }, { notes: { contains: params.search, mode: 'insensitive' } }] }
        : {}),
      ...(params.from || params.to
        ? { expenseDate: { ...(params.from ? { gte: new Date(`${params.from}T00:00:00+05:30`) } : {}), ...(params.to ? { lte: new Date(`${params.to}T23:59:59.999+05:30`) } : {}) } }
        : {}),
    };
  }

  async listExpenses(request: TenantRequest, params: { page: number; pageSize: number; category?: string; method?: string; search?: string; from?: string; to?: string }) {
    const where = this.where(request.tenantContext.organizationId, params);
    const [total, items, sum] = await this.prisma.$transaction([
      this.prisma.expense.count({ where }),
      this.prisma.expense.findMany({
        where,
        orderBy: [{ expenseDate: 'desc' }, { createdAt: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
      this.prisma.expense.aggregate({ where, _sum: { amount: true } }),
    ]);
    return {
      items,
      total: major(sum._sum.amount ? toPaise(sum._sum.amount) : 0n),
      pageInfo: {
        page: params.page,
        pageSize: params.pageSize,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / params.pageSize)),
        hasNextPage: params.page * params.pageSize < total,
        hasPreviousPage: params.page > 1,
      },
    };
  }

  /** Spend by category, payment method and month for the expense charts. */
  async summary(request: TenantRequest, params: { from?: string; to?: string }) {
    const rows = await this.prisma.expense.findMany({
      where: this.where(request.tenantContext.organizationId, params),
      select: { category: true, method: true, amount: true, expenseDate: true },
    });
    const add = (m: Map<string, { amount: bigint; count: number }>, key: string, v: bigint) => {
      const e = m.get(key) ?? { amount: 0n, count: 0 };
      e.amount += v;
      e.count += 1;
      m.set(key, e);
    };
    const byCategory = new Map<string, { amount: bigint; count: number }>();
    const byMethod = new Map<string, { amount: bigint; count: number }>();
    const byMonth = new Map<string, { amount: bigint; count: number }>();
    let total = 0n;
    for (const r of rows) {
      const v = toPaise(r.amount);
      total += v;
      add(byCategory, r.category, v);
      add(byMethod, r.method, v);
      const ist = new Date(r.expenseDate.getTime() + 330 * 60_000);
      add(byMonth, `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`, v);
    }
    const out = (m: Map<string, { amount: bigint; count: number }>, key: string) =>
      [...m.entries()].map(([k, e]) => ({ [key]: k, amount: major(e.amount), count: e.count }));
    return {
      total: major(total),
      count: rows.length,
      byCategory: out(byCategory, 'category').sort((a, b) => Number(b.amount) - Number(a.amount)),
      byMethod: out(byMethod, 'method'),
      byMonth: out(byMonth, 'month').sort((a, b) => String(a.month).localeCompare(String(b.month))),
    };
  }
}
