import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import { AccountingService } from './accounting.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException } from '../common/app-exception.js';
import { nextDocNumber } from '../common/doc-number.js';
import { toPaise } from '../common/money.js';
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

  async listExpenses(request: TenantRequest, params: { page: number; pageSize: number }) {
    const orgId = request.tenantContext.organizationId;
    const [total, items] = await this.prisma.$transaction([
      this.prisma.expense.count({ where: { organizationId: orgId } }),
      this.prisma.expense.findMany({
        where: { organizationId: orgId },
        orderBy: { expenseDate: 'desc' },
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
    return {
      items,
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
}
