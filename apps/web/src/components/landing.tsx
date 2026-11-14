'use client';

import Link from 'next/link';
import { priceFor, SUBSCRIPTION_GST_PERCENT } from '@medicore/shared-types';
import { Icon, type IconName } from './icons';
import { ExpiryPill, BarChart } from './kit';
import { FAQ, PLANS } from './landing-data';
import { Logo } from './logo';
import { Badge, Card, MetricGroup, Stat, StatusBadge, cn } from './ui';

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

const BTN = 'inline-flex h-control items-center justify-center gap-1.5 rounded-md px-4 text-[13.5px] font-medium transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2';
const BTN_PRIMARY = `${BTN} bg-primary text-white hover:bg-primary-hover`;
const BTN_LIGHT = `${BTN} bg-white text-brand-deep hover:bg-mint`;
const BTN_OUTLINE = `${BTN} border border-line bg-surface text-ink hover:bg-subtle`;
const BTN_GHOST_DARK = `${BTN} border border-white/25 text-white hover:bg-white/10`;

const HIGHLIGHTS = [
  'FEFO allocation with expired-stock blocking (Drugs Rules 65(17))',
  'CGST / SGST / IGST split by place of supply, rates effective-dated by HSN',
  'Schedule H / H1 registers, licence tracking and audit trails',
  'Server-enforced tenant isolation and role-based permissions',
];

const MODULES: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'pos', title: 'POS billing', body: 'Fast counter billing with printable GST tax invoices, credit customers and returns.' },
  { icon: 'batches', title: 'Batch inventory', body: 'Stock by batch, MRP and expiry. Oldest in-date batch is picked first.' },
  { icon: 'expiry', title: 'Expiry control', body: 'Near-expiry and low-stock views. Expired or recalled batches can never be sold.' },
  { icon: 'purchasing', title: 'Purchasing', body: 'Purchase order, goods receipt, supplier invoice, payment and debit note.' },
  { icon: 'accounting', title: 'Accounting', body: 'Double-entry books, statements, journals, reversals and period locks.' },
  { icon: 'compliance', title: 'Compliance', body: 'Schedule H1 register, GST summaries and licences, with audited CSV exports.' },
  { icon: 'branches', title: 'Multi-branch', body: 'Branches, warehouses and stock transfers, each user scoped to where they work.' },
  { icon: 'audit', title: 'Audit trail', body: 'Append-only stock ledger and audit log. Corrections are entries, never overwrites.' },
];

const TREND = [19, 26, 22, 33, 29, 37, 31, 44, 35, 48].map((v, i) => ({ label: `${i + 5}`, value: v * 1000, hint: `${i + 5} Nov` }));

const EXPIRING: Array<[string, string, number]> = [
  ['Amoxicillin', 'AX7102', 30],
  ['Azithromycin', 'AZ2291', 58],
  ['Metformin', 'MF0987', 84],
];

const BATCHES: Array<[string, string, string, number, 'AVAILABLE' | 'QUARANTINED' | 'EXPIRED']> = [
  ['AX6655', '40', '31 Oct 2026', -14, 'EXPIRED'],
  ['AX7102', '120', '14 Dec 2026', 30, 'AVAILABLE'],
  ['AX7731', '480', '18 Mar 2027', 124, 'AVAILABLE'],
  ['AX8010', '960', '02 Aug 2027', 261, 'AVAILABLE'],
];

const TRAIL: Array<[string, string, string]> = [
  ['PO-0042', 'Purchase order', 'APPROVED'],
  ['GRN-0117', 'Goods receipt', 'RECEIVED'],
  ['SI-8890', 'Supplier invoice', 'POSTED'],
  ['PAY-0311', 'Payment · ₹48,200', 'PAID'],
];

const H1: Array<[string, string, string, string]> = [
  ['12 Nov', 'Alprazolam 0.25 mg', '10', 'INV-4171'],
  ['12 Nov', 'Tramadol 50 mg', '6', 'INV-4176'],
  ['13 Nov', 'Zolpidem 5 mg', '10', 'INV-4190'],
];

const TRUST: Array<{ icon: IconName; title: string; body: string }> = [
  { icon: 'lock', title: 'Tenant isolation', body: 'Every request is scoped to your workspace and checked against your role on the server.' },
  { icon: 'audit', title: 'Append-only records', body: 'Stock movements and sensitive actions are logged and cannot be edited after the fact.' },
  { icon: 'rupee', title: 'Money in whole paise', body: 'No floating-point maths near a bill. Totals match to the paisa, every time.' },
  { icon: 'verified', title: 'Plans enforced by the API', body: 'User, branch and invoice quotas are server limits, not a promise in a pricing table.' },
];

function Wordmark({ inverse }: { inverse?: boolean }) {
  return <Logo inverse={inverse} />;
}

function SectionHead({ eyebrow, title, children, className }: { eyebrow: string; title: string; children?: React.ReactNode; className?: string }) {
  return (
    <div className={cn('max-w-2xl', className)}>
      <p className="text-xs font-semibold uppercase tracking-widest text-teal-ink">{eyebrow}</p>
      <h2 className="mt-2 text-[1.75rem] font-semibold leading-tight tracking-tight text-ink sm:text-display">{title}</h2>
      {children ? <p className="mt-3 text-[15px] leading-relaxed text-muted">{children}</p> : null}
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={cn('pb-2 text-2xs font-medium uppercase tracking-wide text-faint', right && 'text-right')}>{children}</th>;
}

/** The dashboard, rendered with the same components the signed-in app uses. */
function DashboardPreview() {
  return (
    <div className="rounded-2xl bg-canvas p-3 shadow-2xl ring-1 ring-white/15 sm:p-4" role="img" aria-label="MediCore dashboard preview with sample data">
      <MetricGroup columns={2}>
        <Stat label="Today’s sales" value="₹48,260" hint="134 invoices" icon="sales" trend={{ value: 12.4, label: 'vs last week' }} />
        <Stat label="Near expiry" value="12 batches" hint="3 within 30 days" icon="expiry" tone="amber" />
      </MetricGroup>
      <div className="mt-3 grid gap-3 sm:grid-cols-5">
        <Card title="Sales, last 10 days" className="sm:col-span-3">
          <BarChart data={TREND} height={120} format={(n) => `₹${Math.round(n / 1000)}k`} detailFormat={(n) => `₹${n.toLocaleString('en-IN')}`} />
        </Card>
        <Card title="Expiring soon" className="sm:col-span-2">
          <ul className="divide-y divide-line">
            {EXPIRING.map(([drug, batch, days]) => (
              <li key={batch} className="flex items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-[13px] font-medium text-ink">{drug}</p>
                  <p className="num text-2xs text-muted">{batch}</p>
                </div>
                <ExpiryPill days={days} />
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <p className="mt-2.5 text-center text-2xs text-faint">Sample data</p>
    </div>
  );
}

export function Landing() {
  return (
    <div className="bg-canvas text-ink">
      {/* Hero: the same evergreen panel as the sign-in screen */}
      <div className="mc-auth-backdrop text-white">
        <header className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="MediCore home"><Wordmark inverse /></Link>
          <nav aria-label="Primary" className="hidden items-center gap-7 text-[13.5px] text-white/75 md:flex">
            <a href="#platform" className="transition-colors hover:text-white">Platform</a>
            <a href="#inside" className="transition-colors hover:text-white">Inside the app</a>
            <a href="#pricing" className="transition-colors hover:text-white">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-white">FAQ</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className={cn(BTN_GHOST_DARK, 'hidden sm:inline-flex')}>Sign in</Link>
            <Link href="/register" className={BTN_LIGHT}>Start free trial</Link>
          </div>
        </header>

        <section className="mx-auto grid max-w-6xl items-center gap-12 px-5 pb-20 pt-12 lg:grid-cols-[1fr_1.08fr] lg:pb-24 lg:pt-16">
          <div>
            <h1 className="text-[2.25rem] font-semibold leading-[1.12] tracking-tight sm:text-[2.75rem]">
              Batch-level inventory.
              <br />
              <span className="text-brand-200">GST-ready billing.</span>
              <br />
              Compliance built in.
            </h1>
            <p className="mt-5 max-w-lg text-[15px] leading-relaxed text-white/75">
              MediCore is the pharmacy ERP for Indian retail and distribution. Bill at the counter, track every batch, buy from suppliers and keep your registers and books in one cloud workspace.
            </p>
            <ul className="mt-6 space-y-3 text-sm text-white/75">
              {HIGHLIGHTS.map((line) => (
                <li key={line} className="flex items-start gap-2.5">
                  <Icon name="checkCircle" size={16} className="mt-0.5 shrink-0 text-brand-200" />
                  {line}
                </li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link href="/register" className={cn(BTN_LIGHT, 'h-11 px-5 text-sm')}>Start your 14-day free trial</Link>
              <a href="#inside" className={cn(BTN_GHOST_DARK, 'h-11 px-5 text-sm')}>See inside the app</a>
            </div>
            <p className="mt-4 text-xs text-white/70">No card needed. Built for Indian pharmacies: INR, GSTIN, Schedule H1 registers, Asia/Kolkata.</p>
          </div>
          <DashboardPreview />
        </section>
      </div>

      <main>
        {/* Platform */}
        <section id="platform" className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead eyebrow="Platform" title="Everything a pharmacy runs on, in one workspace.">
            From the first bill of the morning to the month-end books, each module reads from the same batches and the same ledger.
          </SectionHead>
          <div className="mc-metric-grid mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {MODULES.map((m) => (
              <div key={m.title} className="mc-card relative isolate flex min-w-0 flex-col overflow-hidden rounded-2xl p-5 pb-12">
                <span aria-hidden className="mc-card-chip flex h-10 w-10 items-center justify-center rounded-full">
                  <Icon name={m.icon} size={18} strokeWidth={2} />
                </span>
                <h3 className="mt-4 text-[15px] font-semibold tracking-tight text-ink">{m.title}</h3>
                <p className="mt-1.5 text-[13px] leading-relaxed text-muted">{m.body}</p>
                <svg aria-hidden viewBox="0 0 200 40" preserveAspectRatio="none" className="mc-card-wave pointer-events-none absolute inset-x-0 bottom-0 -z-10 h-10 w-full">
                  <path d="M0 30 C 30 22, 55 34, 85 26 S 140 12, 170 18 S 195 10, 200 8 V40 H0 Z" />
                </svg>
              </div>
            ))}
          </div>
        </section>

        {/* Inside the app */}
        <section id="inside" className="border-y border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-20">
            <SectionHead eyebrow="Inside the app" title="The screens your team will actually use.">
              Real MediCore components with sample data: stock by batch, a purchase trail from order to payment, and the Schedule H1 register.
            </SectionHead>
            <div className="mt-10 grid gap-4 lg:grid-cols-3">
              <Card title="Batches" description="Amoxicillin 500 mg, in FEFO order">
                <table className="num w-full text-left text-[13px]">
                  <thead>
                    <tr><Th>Batch</Th><Th right>On hand</Th><Th right>Expiry</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {BATCHES.map(([batch, qty, exp, days, status]) => (
                      <tr key={batch}>
                        <td className="py-2.5">
                          <p className="font-medium text-ink">{batch}</p>
                          {status === 'EXPIRED' ? <StatusBadge status="EXPIRED" label="Blocked from sale" tone="red" /> : null}
                        </td>
                        <td className="py-2.5 text-right text-muted">{qty}</td>
                        <td className="py-2.5 text-right">
                          <p className="text-2xs text-muted">{exp}</p>
                          <ExpiryPill days={days} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>

              <Card title="Purchase trail" description="One supplier, one chain">
                <ul className="divide-y divide-line">
                  {TRAIL.map(([ref, label, status]) => (
                    <li key={ref} className="flex items-center justify-between gap-3 py-3">
                      <div>
                        <p className="num text-[13px] font-medium text-ink">{ref}</p>
                        <p className="text-xs text-muted">{label}</p>
                      </div>
                      <StatusBadge status={status} />
                    </li>
                  ))}
                </ul>
              </Card>

              <Card title="Schedule H1 register" description="Captured as the sale happens">
                <table className="num w-full text-left text-[13px]">
                  <thead>
                    <tr><Th>Date</Th><Th>Drug</Th><Th right>Qty</Th><Th right>Bill</Th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {H1.map(([date, drug, qty, bill]) => (
                      <tr key={bill}>
                        <td className="py-2.5 pr-2 text-muted">{date}</td>
                        <td className="py-2.5 pr-2 font-sans text-ink">{drug}</td>
                        <td className="py-2.5 text-right text-muted">{qty}</td>
                        <td className="py-2.5 text-right text-muted">{bill}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-3 text-xs text-muted">Exports to CSV; every export is recorded in the audit log.</p>
              </Card>
            </div>
          </div>
        </section>

        {/* Trust */}
        <section className="mc-auth-backdrop text-white">
          <div className="mx-auto max-w-6xl px-5 py-16">
            <h2 className="max-w-xl text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-display">
              Built like the books it keeps.
            </h2>
            <div className="mt-10 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
              {TRUST.map((t) => (
                <div key={t.title}>
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white/10 text-brand-200">
                    <Icon name={t.icon} size={17} />
                  </span>
                  <h3 className="mt-3 text-sm font-semibold">{t.title}</h3>
                  <p className="mt-1.5 text-[13px] leading-relaxed text-white/75">{t.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-5 py-20">
          <SectionHead eyebrow="Pricing" title="Start free. Choose a plan when you’re ready.">
            Every workspace begins with a 14-day full-feature trial. Pay yearly and get two months free. Prices exclude {SUBSCRIPTION_GST_PERCENT}% GST.
          </SectionHead>
          <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div key={p.name} className={cn('flex flex-col rounded-xl border bg-surface p-5', p.featured ? 'border-accent ring-1 ring-accent shadow-lg' : 'border-line')}>
                <div className="flex items-center justify-between">
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">{p.name}</h3>
                  {p.featured ? <Badge tone="green">Most popular</Badge> : null}
                </div>
                <p className="mt-0.5 text-xs text-muted">{p.audience}</p>
                <div className="mt-5 min-h-[4rem]">
                  {p.key ? (
                    <>
                      <p className="flex items-baseline gap-1.5">
                        <span className="num text-metric-lg font-semibold text-ink">{inr(priceFor(p.key, 'MONTHLY').basePaise)}</span>
                        <span className="text-xs text-muted">/ month</span>
                      </p>
                      <p className="mt-1 text-xs text-muted">or {inr(priceFor(p.key, 'ANNUAL').basePaise)} a year · + GST</p>
                    </>
                  ) : (
                    <>
                      <p className="text-metric-lg font-semibold text-ink">Custom</p>
                      <p className="mt-1 text-xs text-muted">Priced to your scale</p>
                    </>
                  )}
                </div>
                <ul className="mt-5 flex-1 space-y-2.5 border-t border-line pt-5 text-[13px] text-neutral-700">
                  {p.points.map((x) => (
                    <li key={x} className="flex items-start gap-2"><Icon name="check" size={14} strokeWidth={2.5} className="mt-0.5 shrink-0 text-teal-ink" />{x}</li>
                  ))}
                </ul>
                <Link href="/register" className={cn(p.featured ? BTN_PRIMARY : BTN_OUTLINE, 'mt-6 w-full')}>Start free trial</Link>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-10 px-5 py-20 lg:grid-cols-[1fr_1.7fr]">
            <SectionHead eyebrow="FAQ" title="Straight answers." />
            <div className="divide-y divide-line rounded-xl border border-line bg-canvas px-5">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-4">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[14px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <Icon name="chevronDown" size={16} className="shrink-0 text-faint transition-transform group-open:rotate-180" />
                  </summary>
                  <p className="mt-2.5 max-w-2xl text-[13.5px] leading-relaxed text-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="mc-auth-backdrop text-white">
          <div className="mx-auto max-w-6xl px-5 py-16 text-center">
            <h2 className="mx-auto max-w-xl text-[1.75rem] font-semibold leading-tight tracking-tight sm:text-display">Put your next invoice through MediCore.</h2>
            <p className="mx-auto mt-3 max-w-md text-[15px] text-white/75">Create a workspace, invite your team and bill your first customer today.</p>
            <div className="mt-7 flex flex-wrap justify-center gap-3">
              <Link href="/register" className={cn(BTN_LIGHT, 'h-11 px-5 text-sm')}>Start your 14-day free trial</Link>
              <Link href="/login" className={cn(BTN_GHOST_DARK, 'h-11 px-5 text-sm')}>Sign in</Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-5 px-5 py-8 text-xs text-muted md:flex-row md:items-center md:justify-between">
          <Wordmark />
          <nav aria-label="Footer" className="flex flex-wrap gap-x-6 gap-y-2">
            <a href="#platform" className="hover:text-ink">Platform</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
            <Link href="/login" className="hover:text-ink">Sign in</Link>
            <Link href="/register" className="hover:text-ink">Register</Link>
          </nav>
          <p>
            MediCore is built by{' '}
            <a href="https://teamgodevs.in" className="font-medium text-teal-ink underline underline-offset-2" rel="noopener">Godevs</a>. © 2026 Godevs. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
