import { Injectable, OnModuleInit } from '@nestjs/common';
import type { Account, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.module.js';
import { AuditService } from '../audit/audit.service.js';
import type { TenantRequest } from '../rbac/tenant-context.guard.js';
import { AppException, Conflict, NotFound } from '../common/app-exception.js';
import { nextDocNumber } from '../common/doc-number.js';
import { major, toPaise } from '../common/money.js';

type Tx = Omit<Prisma.TransactionClient, '$transaction'>;
type AccountType = 'ASSET' | 'LIABILITY' | 'EQUITY' | 'INCOME' | 'EXPENSE';

/** System chart-of-accounts entries seeded per organization (auto-posting targets). */
const SYSTEM_ACCOUNTS: Array<{ code: string; name: string; type: AccountType; key: string }> = [
  { code: '1000', name: 'Cash in Hand', type: 'ASSET', key: 'CASH' },
  { code: '1010', name: 'Bank Account', type: 'ASSET', key: 'BANK' },
  { code: '1100', name: 'Accounts Receivable', type: 'ASSET', key: 'AR' },
  { code: '1200', name: 'Inventory', type: 'ASSET', key: 'INVENTORY' },
  { code: '1300', name: 'GST Input Tax Credit', type: 'ASSET', key: 'GST_INPUT' },
  { code: '2000', name: 'Accounts Payable', type: 'LIABILITY', key: 'AP' },
  { code: '2100', name: 'GST Output Payable', type: 'LIABILITY', key: 'GST_OUTPUT' },
  { code: '3000', name: 'Owner Capital', type: 'EQUITY', key: 'EQUITY' },
  { code: '3100', name: 'Opening Balance Equity', type: 'EQUITY', key: 'OPENING_BALANCE' },
  { code: '4000', name: 'Sales Revenue', type: 'INCOME', key: 'SALES' },
  { code: '4100', name: 'Sales Returns (contra)', type: 'INCOME', key: 'SALES_RETURNS' },
  { code: '4200', name: 'Inventory Gain', type: 'INCOME', key: 'INVENTORY_GAIN' },
  { code: '5000', name: 'Cost of Goods Sold', type: 'EXPENSE', key: 'COGS' },
  { code: '5100', name: 'Inventory Loss / Write-off', type: 'EXPENSE', key: 'INVENTORY_LOSS' },
  { code: '6000', name: 'Operating Expenses', type: 'EXPENSE', key: 'OPEX' },
];

const debitNormal = (type: string) => type === 'ASSET' || type === 'EXPENSE';

/**
 * Double-entry accounting core (spec §17): balanced immutable journals,
 * system-account auto-posting targets, period locking, financial statements.
 * All arithmetic is on integer paise.
 */
@Injectable()
export class AccountingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  /** Seeds/extends the system COA for existing organizations (idempotent). */
  async onModuleInit(): Promise<void> {
    try {
      const orgs = await this.prisma.organization.findMany({ select: { id: true } });
      for (const org of orgs) await this.ensureChartOfAccounts(org.id);
    } catch (error) {
      console.warn('[accounting] chart-of-accounts bootstrap skipped:', (error as Error).message);
    }
  }

  async ensureChartOfAccounts(organizationId: string, db: Tx = this.prisma): Promise<void> {
    const existing = await db.account.findMany({ where: { organizationId, isSystem: true }, select: { systemKey: true } });
    const have = new Set(existing.map((a) => a.systemKey));
    const missing = SYSTEM_ACCOUNTS.filter((a) => !have.has(a.key));
    if (missing.length === 0) return;
    await db.account.createMany({
      data: missing.map((a) => ({ organizationId, code: a.code, name: a.name, type: a.type, isSystem: true, systemKey: a.key })),
      skipDuplicates: true,
    });
  }

  async getSystemAccount(tx: Tx, organizationId: string, key: string): Promise<Account | null> {
    return tx.account.findUnique({ where: { organizationId_systemKey: { organizationId, systemKey: key } } });
  }

  private periodLabel(date: Date): string {
    const ist = new Date(date.getTime() + 330 * 60 * 1000);
    return `${ist.getUTCFullYear()}-${String(ist.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  /** Period locking (spec §17): reject entries dated inside a locked period. */
  private async assertPeriodOpen(tx: Tx, organizationId: string, date: Date): Promise<void> {
    const label = this.periodLabel(date);
    const period = await tx.accountingPeriod.findUnique({
      where: { organizationId_periodLabel: { organizationId, periodLabel: label } },
    });
    if (period?.status === 'LOCKED') {
      throw new AppException('PERIOD_LOCKED', `Accounting period ${label} is locked`, 422);
    }
  }

  /**
   * Creates and posts a balanced journal entry. Debits MUST equal credits.
   * Amounts are decimal strings in major units; zero lines are dropped.
   */
  async postJournalEntry(
    request: { principal: { userId: string } },
    organizationId: string,
    data: {
      date: Date;
      memo: string;
      sourceType?: string;
      sourceId?: string;
      lines: Array<{ systemKey?: string; accountId?: string; debit?: string; credit?: string }>;
    },
    tx?: Tx,
  ): Promise<{ id: string; entryNumber: string }> {
    const run = async (db: Tx) => {
      await this.ensureChartOfAccounts(organizationId, db);
      await this.assertPeriodOpen(db, organizationId, data.date);

      const resolved: Array<{ accountId: string; debit: bigint; credit: bigint }> = [];
      for (const line of data.lines) {
        const debit = toPaise(line.debit ?? '0');
        const credit = toPaise(line.credit ?? '0');
        if (debit < 0n || credit < 0n) throw new AppException('VALIDATION_ERROR', 'Journal amounts cannot be negative', 400);
        if (debit === 0n && credit === 0n) continue;
        let accountId = line.accountId;
        if (accountId) {
          const acc = await db.account.findFirst({ where: { id: accountId, organizationId } });
          if (!acc) throw NotFound('Account not found');
        } else if (line.systemKey) {
          const acc = await this.getSystemAccount(db, organizationId, line.systemKey);
          if (!acc) throw NotFound(`System account ${line.systemKey} not found`);
          accountId = acc.id;
        }
        if (!accountId) throw new AppException('VALIDATION_ERROR', 'Journal line needs accountId or systemKey', 400);
        resolved.push({ accountId, debit, credit });
      }
      if (resolved.length < 2) {
        throw new AppException('VALIDATION_ERROR', 'Journal entry needs at least two non-zero lines', 400);
      }
      const totalDebits = resolved.reduce((s, l) => s + l.debit, 0n);
      const totalCredits = resolved.reduce((s, l) => s + l.credit, 0n);
      if (totalDebits !== totalCredits) {
        throw new AppException('VALIDATION_ERROR', `Unbalanced journal: debits ${major(totalDebits)} ≠ credits ${major(totalCredits)}`, 422);
      }

      const entryNumber = await nextDocNumber(db, organizationId, 'JV', data.date);
      const entry = await db.journalEntry.create({
        data: {
          organizationId,
          entryNumber,
          entryDate: data.date,
          memo: data.memo,
          sourceType: data.sourceType,
          sourceId: data.sourceId,
          createdById: request.principal.userId,
          lines: { create: resolved.map((l) => ({ accountId: l.accountId, debit: major(l.debit), credit: major(l.credit) })) },
        },
      });
      return { id: entry.id, entryNumber: entry.entryNumber };
    };
    return tx ? run(tx) : this.prisma.$transaction(run);
  }

  /** Manual journal (accountant) with audit. */
  async postManualJournal(
    request: TenantRequest,
    data: { date: string; memo: string; lines: Array<{ systemKey?: string; accountId?: string; debit?: string; credit?: string }> },
  ) {
    const orgId = request.tenantContext.organizationId;
    const entry = await this.postJournalEntry(request, orgId, {
      date: new Date(`${data.date}T12:00:00+05:30`),
      memo: data.memo,
      sourceType: 'MANUAL',
      lines: data.lines,
    });
    await this.audit.record({
      event: 'JOURNAL_POSTED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'JournalEntry',
      entityId: entry.id,
      details: { entryNumber: entry.entryNumber, memo: data.memo },
    });
    return entry;
  }

  /**
   * Reverses a posted entry with an explicit reversing entry (spec §17).
   * The reversal date defaults to today and must fall in an open period.
   */
  async reverseEntry(request: TenantRequest, entryId: string, memo: string, date?: string) {
    const orgId = request.tenantContext.organizationId;
    const reversal = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE id = ${entryId} FOR UPDATE`;
      const entry = await tx.journalEntry.findFirst({ where: { id: entryId, organizationId: orgId }, include: { lines: true } });
      if (!entry) throw NotFound('Journal entry not found');
      if (entry.reversedById) throw Conflict('STATE_TRANSITION_INVALID', 'Entry already reversed');
      if (entry.sourceType === 'JOURNAL_REVERSAL') throw Conflict('STATE_TRANSITION_INVALID', 'A reversal cannot itself be reversed');
      const requested = date ? new Date(`${date}T12:00:00+05:30`) : new Date();
      const istDay = (d: Date) => new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      if (istDay(requested) < istDay(entry.entryDate)) {
        throw new AppException('VALIDATION_ERROR', 'Reversal cannot be dated before the original entry', 400);
      }
      // Same-day reversals sort after the original even when it carries a later timestamp.
      const when = requested < entry.entryDate ? entry.entryDate : requested;
      const created = await this.postJournalEntry(
        request,
        orgId,
        {
          date: when,
          memo: memo || `Reversal of ${entry.entryNumber}: ${entry.memo}`,
          sourceType: 'JOURNAL_REVERSAL',
          sourceId: entry.id,
          lines: entry.lines.map((l) => ({ accountId: l.accountId, debit: l.credit.toFixed(2), credit: l.debit.toFixed(2) })),
        },
        tx,
      );
      await tx.journalEntry.update({ where: { id: entry.id }, data: { reversedById: created.id } });
      return { ...created, originalEntryNumber: entry.entryNumber };
    });
    await this.audit.record({
      event: 'JOURNAL_REVERSED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'JournalEntry',
      entityId: entryId,
      details: { reversal: reversal.entryNumber, original: reversal.originalEntryNumber },
    });
    return reversal;
  }

  // ── Financial statements ───────────────────────────────────────────────────

  private range(from?: string, to?: string): Prisma.DateTimeFilter | undefined {
    if (!from && !to) return undefined;
    return {
      ...(from ? { gte: new Date(`${from}T00:00:00+05:30`) } : {}),
      ...(to ? { lte: new Date(`${to}T23:59:59.999+05:30`) } : {}),
    };
  }

  private async balancesByAccount(orgId: string, entryDate?: Prisma.DateTimeFilter) {
    const accounts = await this.prisma.account.findMany({ where: { organizationId: orgId }, orderBy: { code: 'asc' } });
    const agg = await this.prisma.journalLine.groupBy({
      by: ['accountId'],
      where: { entry: { organizationId: orgId, ...(entryDate ? { entryDate } : {}) } },
      _sum: { debit: true, credit: true },
    });
    const byId = new Map(agg.map((b) => [b.accountId, b]));
    return accounts.map((a) => {
      const s = byId.get(a.id)?._sum;
      const debit = s?.debit ? toPaise(s.debit) : 0n;
      const credit = s?.credit ? toPaise(s.credit) : 0n;
      return { account: a, debit, credit, net: debitNormal(a.type) ? debit - credit : credit - debit };
    });
  }

  async trialBalance(request: TenantRequest, asOf?: string) {
    const orgId = request.tenantContext.organizationId;
    await this.ensureChartOfAccounts(orgId);
    const rows = await this.balancesByAccount(orgId, this.range(undefined, asOf));
    // Present each account's net balance on its natural side.
    const out = rows.map((r) => {
      const net = r.debit - r.credit;
      return {
        accountId: r.account.id,
        code: r.account.code,
        name: r.account.name,
        type: r.account.type,
        debit: major(net > 0n ? net : 0n),
        credit: major(net < 0n ? -net : 0n),
        net: major(r.net),
      };
    });
    const totalDebits = rows.reduce((s, r) => s + (r.debit - r.credit > 0n ? r.debit - r.credit : 0n), 0n);
    const totalCredits = rows.reduce((s, r) => s + (r.credit - r.debit > 0n ? r.credit - r.debit : 0n), 0n);
    return { asOf: asOf ?? null, rows: out, totalDebits: major(totalDebits), totalCredits: major(totalCredits), balanced: totalDebits === totalCredits };
  }

  private async pnlPaise(orgId: string, from?: string, to?: string) {
    const rows = await this.balancesByAccount(orgId, this.range(from, to));
    const income = rows.filter((r) => r.account.type === 'INCOME');
    const expenses = rows.filter((r) => r.account.type === 'EXPENSE');
    const totalIncome = income.reduce((s, r) => s + r.net, 0n);
    const totalExpenses = expenses.reduce((s, r) => s + r.net, 0n);
    return { income, expenses, totalIncome, totalExpenses, net: totalIncome - totalExpenses };
  }

  async profitAndLoss(request: TenantRequest, from?: string, to?: string) {
    const orgId = request.tenantContext.organizationId;
    const p = await this.pnlPaise(orgId, from, to);
    const sales = p.income.find((r) => r.account.systemKey === 'SALES')?.net ?? 0n;
    const returns = p.income.find((r) => r.account.systemKey === 'SALES_RETURNS')?.net ?? 0n;
    const cogs = p.expenses.find((r) => r.account.systemKey === 'COGS')?.net ?? 0n;
    return {
      from: from ?? null,
      to: to ?? null,
      income: p.income.map((r) => ({ accountId: r.account.id, code: r.account.code, name: r.account.name, amount: major(r.net) })),
      expenses: p.expenses.map((r) => ({ accountId: r.account.id, code: r.account.code, name: r.account.name, amount: major(r.net) })),
      netSales: major(sales + returns),
      grossProfit: major(sales + returns - cogs),
      totalIncome: major(p.totalIncome),
      totalExpenses: major(p.totalExpenses),
      netProfit: major(p.net),
    };
  }

  /** Month-by-month income, expenses and net profit (IST months, max 24). */
  async profitAndLossTrend(request: TenantRequest, from: string, to: string) {
    const orgId = request.tenantContext.organizationId;
    const lines = await this.prisma.journalLine.findMany({
      where: { entry: { organizationId: orgId, entryDate: this.range(from, to) }, account: { type: { in: ['INCOME', 'EXPENSE'] } } },
      select: { debit: true, credit: true, account: { select: { type: true } }, entry: { select: { entryDate: true } } },
    });
    const months = new Map<string, { income: bigint; expenses: bigint }>();
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)); d <= end && months.size < 24; d.setUTCMonth(d.getUTCMonth() + 1)) {
      months.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`, { income: 0n, expenses: 0n });
    }
    for (const l of lines) {
      const m = months.get(this.periodLabel(l.entry.entryDate));
      if (!m) continue;
      const d = toPaise(l.debit);
      const c = toPaise(l.credit);
      if (l.account.type === 'INCOME') m.income += c - d;
      else m.expenses += d - c;
    }
    return [...months.entries()].map(([month, v]) => ({ month, income: major(v.income), expenses: major(v.expenses), net: major(v.income - v.expenses) }));
  }

  async balanceSheet(request: TenantRequest, asOf?: string) {
    const orgId = request.tenantContext.organizationId;
    const rows = await this.balancesByAccount(orgId, this.range(undefined, asOf));
    const pick = (type: AccountType) =>
      rows.filter((r) => r.account.type === type).map((r) => ({ accountId: r.account.id, code: r.account.code, name: r.account.name, amount: r.net }));
    const assets = pick('ASSET');
    const liabilities = pick('LIABILITY');
    const equity = pick('EQUITY');
    const pnl = await this.pnlPaise(orgId, undefined, asOf);
    const sum = (xs: Array<{ amount: bigint }>) => xs.reduce((s, r) => s + r.amount, 0n);
    const totalAssets = sum(assets);
    const totalLiabilities = sum(liabilities);
    const totalEquity = sum(equity) + pnl.net;
    const fmt = (xs: Array<{ accountId: string; code: string; name: string; amount: bigint }>) => xs.map((x) => ({ ...x, amount: major(x.amount) }));
    return {
      asOf: asOf ?? null,
      assets: fmt(assets),
      liabilities: fmt(liabilities),
      equity: fmt(equity),
      retainedEarnings: major(pnl.net),
      totalAssets: major(totalAssets),
      totalLiabilities: major(totalLiabilities),
      totalEquity: major(totalEquity),
      balanced: totalAssets === totalLiabilities + totalEquity,
    };
  }

  /** General-ledger drill-down for one account with running balance. */
  async accountLedger(request: TenantRequest, accountId: string, from?: string, to?: string) {
    const orgId = request.tenantContext.organizationId;
    const account = await this.prisma.account.findFirst({ where: { id: accountId, organizationId: orgId } });
    if (!account) throw NotFound('Account not found');
    let opening = 0n;
    if (from) {
      const agg = await this.prisma.journalLine.aggregate({
        where: { accountId, entry: { organizationId: orgId, entryDate: { lt: new Date(`${from}T00:00:00+05:30`) } } },
        _sum: { debit: true, credit: true },
      });
      const d = agg._sum.debit ? toPaise(agg._sum.debit) : 0n;
      const c = agg._sum.credit ? toPaise(agg._sum.credit) : 0n;
      opening = debitNormal(account.type) ? d - c : c - d;
    }
    const lines = await this.prisma.journalLine.findMany({
      where: { accountId, entry: { organizationId: orgId, ...(this.range(from, to) ? { entryDate: this.range(from, to) } : {}) } },
      include: { entry: { select: { id: true, entryNumber: true, entryDate: true, memo: true, sourceType: true, sourceId: true, reversedById: true } } },
      orderBy: [{ entry: { entryDate: 'asc' } }, { entry: { createdAt: 'asc' } }],
      take: 2000,
    });
    let balance = opening;
    const rows = lines.map((l) => {
      const d = toPaise(l.debit);
      const c = toPaise(l.credit);
      balance += debitNormal(account.type) ? d - c : c - d;
      return {
        entryId: l.entry.id,
        entryNumber: l.entry.entryNumber,
        date: l.entry.entryDate,
        memo: l.entry.memo,
        sourceType: l.entry.sourceType,
        sourceId: l.entry.sourceId,
        reversed: Boolean(l.entry.reversedById),
        debit: major(d),
        credit: major(c),
        balance: major(balance),
      };
    });
    return {
      account: { id: account.id, code: account.code, name: account.name, type: account.type },
      opening: major(opening),
      closing: major(balance),
      rows,
    };
  }

  async listJournalEntries(request: TenantRequest, params: { page: number; pageSize: number; sourceType?: string }) {
    const orgId = request.tenantContext.organizationId;
    const where: Prisma.JournalEntryWhereInput = { organizationId: orgId, ...(params.sourceType ? { sourceType: params.sourceType } : {}) };
    return this.prisma.$transaction([
      this.prisma.journalEntry.count({ where }),
      this.prisma.journalEntry.findMany({
        where,
        include: { lines: { include: { account: { select: { code: true, name: true } } } } },
        orderBy: [{ createdAt: 'desc' }, { entryNumber: 'desc' }],
        skip: (params.page - 1) * params.pageSize,
        take: params.pageSize,
      }),
    ]);
  }

  async listAccounts(request: TenantRequest) {
    await this.ensureChartOfAccounts(request.tenantContext.organizationId);
    return this.prisma.account.findMany({ where: { organizationId: request.tenantContext.organizationId }, orderBy: { code: 'asc' } });
  }

  // ── Periods ────────────────────────────────────────────────────────────────

  listPeriods(request: TenantRequest) {
    return this.prisma.accountingPeriod.findMany({
      where: { organizationId: request.tenantContext.organizationId },
      orderBy: { periodLabel: 'desc' },
    });
  }

  async setPeriodLock(request: TenantRequest, periodLabel: string, locked: boolean) {
    const orgId = request.tenantContext.organizationId;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodLabel)) {
      throw new AppException('VALIDATION_ERROR', 'Period label must be YYYY-MM', 400);
    }
    const data = { status: locked ? 'LOCKED' : 'OPEN', lockedAt: locked ? new Date() : null, lockedById: locked ? request.principal.userId : null };
    const period = await this.prisma.accountingPeriod.upsert({
      where: { organizationId_periodLabel: { organizationId: orgId, periodLabel } },
      create: { organizationId: orgId, periodLabel, ...data },
      update: data,
    });
    await this.audit.record({
      event: 'PERIOD_LOCK_CHANGED',
      organizationId: orgId,
      actorUserId: request.principal.userId,
      entityType: 'AccountingPeriod',
      entityId: period.id,
      details: { periodLabel, locked },
    });
    return period;
  }
}
