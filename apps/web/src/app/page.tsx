import type { Metadata } from 'next';
import Link from 'next/link';
import '@fontsource-variable/fraunces';
import { priceFor, SUBSCRIPTION_GST_PERCENT, type PaidPlanKey } from '@medicore/shared-types';

export const metadata: Metadata = {
  title: 'MediCore: pharmacy software for India',
  description:
    'Billing, batch-level stock, purchasing, accounting and Schedule H1 registers for Indian pharmacies. GST-correct from the first invoice. 14-day free trial.',
  openGraph: {
    title: 'MediCore: pharmacy software for India',
    description: 'GST-correct billing, batch and expiry control, purchasing, books and compliance registers in one cloud workspace.',
    type: 'website',
  },
};

const inr = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;

/* ── Small pieces ─────────────────────────────────────────────────────────── */

function Mark({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden>
      <rect x="3" y="5" width="10" height="30" rx="5" fill="#123B3A" />
      <rect x="27" y="5" width="10" height="30" rx="5" fill="#14B8A6" />
      <path d="M8 10 L20 22" stroke="#123B3A" strokeWidth="10" strokeLinecap="round" />
      <path d="M32 10 L20 22" stroke="#5FD8C4" strokeWidth="10" strokeLinecap="round" />
      <rect x="14" y="15" width="12" height="22" rx="6" fill="#fff" />
      <path d="M16 26 V21 a4 4 0 0 1 8 0 V26 Z" fill="#D9F7EF" />
      <path d="M16 26 H24 V31 a4 4 0 0 1 -8 0 Z" fill="#14B8A6" />
    </svg>
  );
}

function Wordmark() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Mark />
      <span className="text-[18px] font-bold tracking-[-0.03em]">
        <span className="text-brand-deep">Medi</span>
        <span className="text-accent">Core</span>
      </span>
    </span>
  );
}

function Tick({ className = 'text-teal-ink' }: { className?: string }) {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" className={`mt-[3px] shrink-0 ${className}`} aria-hidden>
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Eyebrow({ children, light }: { children: React.ReactNode; light?: boolean }) {
  return <p className={`text-[12px] font-semibold uppercase tracking-[0.18em] ${light ? 'text-brand-300' : 'text-teal-ink'}`}>{children}</p>;
}

function Frame({ title, children, className = '' }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <figure className={`overflow-hidden rounded-xl border border-line bg-surface shadow-xl ${className}`}>
      <figcaption className="flex items-center justify-between border-b border-line bg-subtle px-4 py-2.5 text-[11.5px] text-muted">
        <span className="font-medium text-ink">{title}</span>
        <span>Sample data</span>
      </figcaption>
      {children}
    </figure>
  );
}

/* ── Product visuals (illustrative, styled after the real screens) ───────── */

const INVOICE_LINES = [
  ['Paracetamol 650 mg tab', 'B2209', '08/27', '3', '32.50', '97.50'],
  ['Amoxicillin 500 mg cap', 'AX7731', '03/27', '2', '118.00', '236.00'],
  ['Metformin 500 mg tab', 'MF1048', '11/27', '4', '24.75', '99.00'],
  ['Cetirizine 10 mg tab', 'CT5520', '05/28', '2', '18.00', '36.00'],
];

function InvoiceVisual() {
  return (
    <Frame title="Counter 2 · Invoice INV-2026-004182">
      <div className="px-4 pb-4 pt-3">
        <table className="w-full text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-faint">
              <th className="py-2 font-medium">Item</th>
              <th className="hidden py-2 font-medium sm:table-cell">Batch</th>
              <th className="hidden py-2 font-medium sm:table-cell">Exp</th>
              <th className="py-2 text-right font-medium">Qty</th>
              <th className="py-2 text-right font-medium">Rate</th>
              <th className="py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="num">
            {INVOICE_LINES.map((l) => (
              <tr key={l[0]} className="border-b border-line/70">
                <td className="py-2 pr-2 font-sans text-ink">{l[0]}</td>
                <td className="hidden py-2 text-muted sm:table-cell">{l[1]}</td>
                <td className="hidden py-2 text-muted sm:table-cell">{l[2]}</td>
                <td className="py-2 text-right">{l[3]}</td>
                <td className="py-2 text-right">{l[4]}</td>
                <td className="py-2 text-right text-ink">{l[5]}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <dl className="num ml-auto mt-3 w-full max-w-[15rem] space-y-1 text-[12.5px]">
          <div className="flex justify-between text-muted"><dt>Sub-total</dt><dd>468.50</dd></div>
          <div className="flex justify-between text-muted"><dt>CGST 2.5%</dt><dd>11.71</dd></div>
          <div className="flex justify-between text-muted"><dt>SGST 2.5%</dt><dd>11.71</dd></div>
          <div className="flex justify-between text-muted"><dt>Round off</dt><dd>+0.08</dd></div>
          <div className="flex justify-between border-t border-line pt-2 text-[15px] font-semibold text-ink"><dt>Total</dt><dd>₹492.00</dd></div>
        </dl>
      </div>
    </Frame>
  );
}

const BATCHES = [
  { batch: 'AX6655', exp: '31 Oct 2026', qty: '40', state: 'Expired · blocked', tone: 'bg-danger/10 text-danger' },
  { batch: 'AX7102', exp: '14 Dec 2026', qty: '120', state: 'Sell first · 30 days', tone: 'bg-warning/10 text-warning' },
  { batch: 'AX7731', exp: '18 Mar 2027', qty: '480', state: 'In date', tone: 'bg-success/10 text-success' },
  { batch: 'AX8010', exp: '02 Aug 2027', qty: '960', state: 'In date', tone: 'bg-success/10 text-success' },
];

function StockVisual() {
  return (
    <Frame title="Amoxicillin 500 mg · Batches (FEFO order)">
      <ul className="divide-y divide-line/70 px-4 text-[12.5px]">
        {BATCHES.map((b) => (
          <li key={b.batch} className="num flex items-center justify-between gap-3 py-3">
            <div>
              <p className="font-medium text-ink">{b.batch}</p>
              <p className="text-muted">Expires {b.exp}</p>
            </div>
            <p className="text-muted">{b.qty} on hand</p>
            <span className={`rounded-full px-2.5 py-1 font-sans text-[11px] font-medium ${b.tone}`}>{b.state}</span>
          </li>
        ))}
      </ul>
    </Frame>
  );
}

const CHAIN = [
  ['Purchase order', 'PO-0042', 'Raised to Sri Murugan Distributors'],
  ['Goods receipt', 'GRN-0117', '3 items checked in with batch and expiry'],
  ['Supplier invoice', 'SI-8890', 'Matched to the receipt'],
  ['Payment', '₹48,200', 'Paid · balance ₹0'],
];

function PurchasingVisual() {
  return (
    <Frame title="Purchase trail · one supplier, one chain">
      <ol className="relative space-y-0 px-5 py-4">
        {CHAIN.map((c, i) => (
          <li key={c[0]} className="relative flex gap-4 pb-5 last:pb-0">
            {i < CHAIN.length - 1 ? <span className="absolute left-[7px] top-5 h-full w-px bg-line" /> : null}
            <span className="relative mt-1 h-3.5 w-3.5 shrink-0 rounded-full border-2 border-accent bg-surface" />
            <div className="text-[12.5px]">
              <p className="font-medium text-ink">{c[0]} <span className="num ml-1 font-normal text-teal-ink">{c[1]}</span></p>
              <p className="text-muted">{c[2]}</p>
            </div>
          </li>
        ))}
      </ol>
    </Frame>
  );
}

const H1_ROWS = [
  ['12 Nov', 'R. Meenakshi', 'Dr. S. Anand', 'Alprazolam 0.25 mg', '10', 'INV-004171'],
  ['12 Nov', 'K. Selvam', 'Dr. P. Ravi', 'Tramadol 50 mg', '6', 'INV-004176'],
  ['13 Nov', 'A. Farhana', 'Dr. L. Thomas', 'Zolpidem 5 mg', '10', 'INV-004190'],
];

function RegisterVisual() {
  return (
    <Frame title="Schedule H1 register · November">
      <div className="overflow-x-auto px-4 pb-3 pt-2">
        <table className="w-full min-w-[30rem] text-left text-[12.5px]">
          <thead>
            <tr className="border-b border-line text-[10.5px] uppercase tracking-wider text-faint">
              {['Date', 'Patient', 'Prescriber', 'Drug', 'Qty', 'Bill'].map((h) => (
                <th key={h} className="py-2 pr-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="num">
            {H1_ROWS.map((r) => (
              <tr key={r[5]} className="border-b border-line/70">
                {r.map((c, i) => (
                  <td key={i} className={`py-2.5 pr-3 ${i === 3 ? 'font-sans text-ink' : 'text-muted'}`}>{c}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="pt-2 text-[11.5px] text-faint">Exports to CSV, with the export recorded in the audit log.</p>
      </div>
    </Frame>
  );
}

/* ── Content ─────────────────────────────────────────────────────────────── */

const WORKFLOWS = [
  {
    id: 'billing',
    kicker: 'At the counter',
    title: 'Bills that are right before the customer reaches the door.',
    body: 'Scan or search, pick the batch, print. MediCore applies the correct GST for each HSN, splits it into CGST and SGST or IGST by place of supply, and prints a proper tax invoice. Rates are versioned and effective-dated, so an old invoice never changes when a rate does.',
    points: ['Sales are blocked for any HSN with no effective rate, so nothing goes out untaxed', 'Credit limits enforced for wholesale and credit customers', 'Returns and credit notes tied to the original batch'],
    visual: <InvoiceVisual />,
  },
  {
    id: 'stock',
    kicker: 'On the shelf',
    title: 'Every strip traced to its batch, expiry and shelf.',
    body: 'Stock is tracked by batch, not just by product. The oldest in-date batch is picked first, and an expired, recalled or quarantined batch cannot be sold at all, which is what Rule 65(17) of the Drugs Rules expects of you anyway.',
    points: ['FEFO allocation, with any manual override recorded', 'Expiry, near-expiry and low-stock views for every branch', 'Stock counts, adjustments and transfers between branches'],
    visual: <StockVisual />,
  },
  {
    id: 'buying',
    kicker: 'In the back office',
    title: 'Buy, receive and pay without losing the thread.',
    body: 'Raise a purchase order, check the goods in against it with batch numbers and expiry dates, record the supplier’s invoice, and pay it. Debit notes close out returns. Each step points at the one before it, so a payable always has a paper trail.',
    points: ['Purchase order, goods receipt, invoice, payment and debit note', 'Vendor ledgers and payables at a glance', 'Opening stock and vendors imported from CSV'],
    visual: <PurchasingVisual />,
  },
  {
    id: 'compliance',
    kicker: 'At inspection time',
    title: 'Registers and books that are ready when the inspector is.',
    body: 'Schedule H and H1 sales are captured as they happen, so the register is a report, not a project. Licences are tracked with their expiry. Underneath, a double-entry ledger with period locks keeps your accountant happy.',
    points: ['Schedule H1 register and licence tracking', 'GST summaries with audited CSV exports', 'Journals, statements, reversals and locked periods'],
    visual: <RegisterVisual />,
  },
];

const PRINCIPLES = [
  ['Tenant isolation on the server', 'Every request is scoped to your workspace and checked against your role. Hiding a button is never the only protection.'],
  ['An audit trail you cannot edit', 'Stock movements and sensitive actions are written to append-only logs. Corrections are new entries, never overwrites.'],
  ['Money handled in whole paise', 'No floating-point arithmetic anywhere near a bill. Totals match to the paisa, every time.'],
  ['Plans enforced by the API', 'Users, branches and invoice quotas are limits the server enforces, not a promise in a pricing table.'],
];

const PLANS: Array<{ name: string; key: PaidPlanKey | null; audience: string; featured?: boolean; points: string[] }> = [
  { name: 'Starter', key: 'STARTER', audience: 'One shop, one counter', points: ['1 branch, 5 users', '2,000 invoices a month', 'Catalogue, inventory and POS'] },
  { name: 'Professional', key: 'PROFESSIONAL', audience: 'Growing retail', featured: true, points: ['2 branches, 15 users', '20,000 invoices a month', 'Adds purchasing and returns', 'API access'] },
  { name: 'Business', key: 'BUSINESS', audience: 'Chains and distributors', points: ['10 branches, 50 users', '200,000 invoices a month', 'Adds wholesale and accounting', 'API access'] },
  { name: 'Enterprise', key: null, audience: 'Unlimited scale', points: ['Unlimited branches and users', 'Every module', 'Integrations on request'] },
];

const FAQ = [
  ['How does the free trial work?', 'Every new workspace gets 14 days with all modules and no card. When it ends, your data stays readable and billing pauses until you choose a plan, so nothing is lost.'],
  ['Does MediCore handle GST properly?', 'Yes. Rates are configured per HSN with effective dates, and each invoice splits into CGST and SGST or IGST based on place of supply. Posted documents keep the rates that applied on the day.'],
  ['Do you support e-invoicing and e-way bills?', 'Not yet. Connections to the IRP and the e-way bill portal are not live, and we would rather say so than pretend. Tax invoices, GST summaries and CSV exports are all available today.'],
  ['Can I bring my existing data?', 'Products, vendors and customers import from CSV with a preview step before anything is saved, so you can fix mistakes first.'],
  ['How do I pay?', 'Pay monthly or yearly by UPI, card or net banking through Razorpay. Yearly plans include two months free. Prices are shown before GST, which is added at checkout.'],
  ['Who can see my data?', 'Only people you invite to your workspace, within the permissions of their role. Platform administrators manage plans and tenants, not your prescriptions or invoices.'],
];

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function LandingPage() {
  return (
    <div className="bg-canvas text-ink">
      <header className="sticky top-0 z-header border-b border-line/80 bg-canvas/90 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="MediCore home"><Wordmark /></Link>
          <nav aria-label="Primary" className="hidden items-center gap-8 text-[14px] text-muted md:flex">
            <a href="#product" className="transition-colors hover:text-ink">Product</a>
            <a href="#trust" className="transition-colors hover:text-ink">Security</a>
            <a href="#pricing" className="transition-colors hover:text-ink">Pricing</a>
            <a href="#faq" className="transition-colors hover:text-ink">FAQ</a>
          </nav>
          <div className="flex items-center gap-1.5">
            <Link href="/login" className="rounded-md px-3.5 py-2 text-[14px] font-medium text-ink transition-colors hover:bg-subtle">Sign in</Link>
            <Link href="/register" className="rounded-md bg-primary px-4 py-2 text-[14px] font-medium text-white transition-colors hover:bg-primary-hover">Start free trial</Link>
          </div>
        </div>
      </header>

      <main>
        {/* Hero */}
        <section className="mx-auto grid max-w-6xl items-center gap-14 px-5 pb-20 pt-16 lg:grid-cols-[1.02fr_1fr] lg:pb-28 lg:pt-24">
          <div>
            <Eyebrow>Pharmacy software for India</Eyebrow>
            <h1 className="mt-5 font-display text-[42px] font-medium leading-[1.04] tracking-[-0.02em] text-brand-deep sm:text-[56px] lg:text-[62px]">
              Every batch, bill and register, in order.
            </h1>
            <p className="mt-6 max-w-xl text-[17px] leading-[1.65] text-muted">
              MediCore runs the whole pharmacy from one cloud workspace: GST-correct billing, batch and expiry control, purchasing, accounts and the compliance registers your inspector asks for.
            </p>
            <div className="mt-9 flex flex-wrap items-center gap-3">
              <Link href="/register" className="rounded-md bg-primary px-6 py-3.5 text-[15px] font-medium text-white shadow-md transition-colors hover:bg-primary-hover">Start your 14-day trial</Link>
              <a href="#product" className="rounded-md border border-line bg-surface px-6 py-3.5 text-[15px] font-medium transition-colors hover:bg-subtle">See how it works</a>
            </div>
            <p className="mt-4 text-[13px] text-faint">No card needed. Set up in an afternoon.</p>
            <dl className="mt-12 grid max-w-xl grid-cols-3 gap-6 border-t border-line pt-6">
              {[
                ['FEFO', 'picking by default'],
                ['HSN-wise', 'effective-dated GST'],
                ['Audited', 'append-only stock ledger'],
              ].map(([k, v]) => (
                <div key={k}>
                  <dt className="font-display text-[22px] font-medium tracking-tight text-brand-deep">{k}</dt>
                  <dd className="mt-0.5 text-[12.5px] leading-snug text-muted">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="relative lg:pl-4">
            <div aria-hidden className="absolute -inset-6 -z-10 rounded-[2rem] bg-mint/50" />
            <InvoiceVisual />
            <aside className="relative -mt-6 ml-4 max-w-[17rem] rounded-xl border border-line bg-surface p-4 shadow-lg sm:absolute sm:-bottom-8 sm:-left-8 sm:ml-0 sm:mt-0" aria-label="Expiry alert example">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-warning">Expiry alert</p>
              <p className="mt-1 text-[13px] font-medium text-ink">Amoxicillin 500 mg, batch AX7102</p>
              <p className="num mt-0.5 text-[12.5px] text-muted">120 on hand · expires in 30 days · sell first</p>
            </aside>
          </div>
        </section>

        {/* Workflows */}
        <section id="product" className="border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <div className="max-w-2xl">
              <Eyebrow>The product</Eyebrow>
              <h2 className="mt-4 font-display text-[34px] font-medium leading-[1.1] tracking-[-0.015em] text-brand-deep sm:text-[44px]">
                From the counter to the ledger, one set of numbers.
              </h2>
            </div>
            <div className="mt-20 space-y-28">
              {WORKFLOWS.map((w, i) => (
                <div key={w.id} id={w.id} className="grid items-center gap-12 lg:grid-cols-2 lg:gap-20">
                  <div className={i % 2 ? 'lg:order-2' : ''}>
                    <Eyebrow>{w.kicker}</Eyebrow>
                    <h3 className="mt-4 font-display text-[28px] font-medium leading-[1.15] tracking-[-0.012em] text-brand-deep sm:text-[32px]">{w.title}</h3>
                    <p className="mt-5 text-[16px] leading-[1.7] text-muted">{w.body}</p>
                    <ul className="mt-6 space-y-2.5 text-[15px]">
                      {w.points.map((p) => (
                        <li key={p} className="flex gap-3"><Tick />{p}</li>
                      ))}
                    </ul>
                  </div>
                  <div className={i % 2 ? 'lg:order-1' : ''}>{w.visual}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* Trust */}
        <section id="trust" className="bg-brand-deep text-white">
          <div className="mx-auto max-w-6xl px-5 py-24">
            <div className="max-w-2xl">
              <Eyebrow light>Security and records</Eyebrow>
              <h2 className="mt-4 font-display text-[34px] font-medium leading-[1.1] tracking-[-0.015em] sm:text-[44px]">
                Built like the books it keeps.
              </h2>
              <p className="mt-5 text-[16px] leading-[1.7] text-brand-100/80">
                A pharmacy system is a record system first. These are rules the code follows, not features on a slide.
              </p>
            </div>
            <dl className="mt-14 grid gap-x-16 gap-y-10 md:grid-cols-2">
              {PRINCIPLES.map(([k, v]) => (
                <div key={k} className="border-t border-white/15 pt-5">
                  <dt className="font-display text-[21px] font-medium">{k}</dt>
                  <dd className="mt-2 text-[15px] leading-[1.65] text-brand-100/80">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Pricing */}
        <section id="pricing" className="mx-auto max-w-6xl px-5 py-24">
          <div className="mx-auto max-w-2xl text-center">
            <Eyebrow>Pricing</Eyebrow>
            <h2 className="mt-4 font-display text-[34px] font-medium leading-[1.1] tracking-[-0.015em] text-brand-deep sm:text-[44px]">
              Start free. Pay when it earns its place.
            </h2>
            <p className="mt-5 text-[16px] leading-[1.7] text-muted">
              Every workspace begins with 14 days of everything. Pay yearly and get two months free. Prices exclude {SUBSCRIPTION_GST_PERCENT}% GST.
            </p>
          </div>
          <div className="mt-14 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
            {PLANS.map((p) => (
              <div
                key={p.name}
                className={`flex flex-col rounded-xl border bg-surface p-7 ${p.featured ? 'border-brand-600 shadow-xl ring-1 ring-brand-600' : 'border-line'}`}
              >
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-[22px] font-medium text-brand-deep">{p.name}</h3>
                  {p.featured ? <span className="rounded-full bg-primary px-2.5 py-1 text-[10.5px] font-semibold uppercase tracking-wider text-white">Popular</span> : null}
                </div>
                <p className="mt-1 text-[13.5px] text-muted">{p.audience}</p>
                <div className="mt-6 min-h-[4.5rem]">
                  {p.key ? (
                    <>
                      <p className="flex items-baseline gap-1.5">
                        <span className="num font-display text-[38px] font-medium tracking-tight">{inr(priceFor(p.key, 'MONTHLY').basePaise)}</span>
                        <span className="text-[13px] text-muted">a month</span>
                      </p>
                      <p className="mt-1 text-[12.5px] text-faint">or {inr(priceFor(p.key, 'ANNUAL').basePaise)} a year</p>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-[38px] font-medium tracking-tight">Let’s talk</p>
                      <p className="mt-1 text-[12.5px] text-faint">Priced to your scale</p>
                    </>
                  )}
                </div>
                <ul className="mt-6 flex-1 space-y-3 border-t border-line pt-6 text-[14px]">
                  {p.points.map((x) => (
                    <li key={x} className="flex gap-2.5"><Tick />{x}</li>
                  ))}
                </ul>
                <Link
                  href="/register"
                  className={`mt-8 rounded-md px-4 py-3 text-center text-[14px] font-medium transition-colors ${p.featured ? 'bg-primary text-white hover:bg-primary-hover' : 'border border-line hover:bg-subtle'}`}
                >
                  Start free trial
                </Link>
              </div>
            ))}
          </div>
        </section>

        {/* FAQ */}
        <section id="faq" className="border-t border-line bg-surface">
          <div className="mx-auto grid max-w-6xl gap-12 px-5 py-24 lg:grid-cols-[1fr_1.6fr]">
            <div>
              <Eyebrow>Questions</Eyebrow>
              <h2 className="mt-4 font-display text-[34px] font-medium leading-[1.1] tracking-[-0.015em] text-brand-deep sm:text-[40px]">Straight answers.</h2>
            </div>
            <div className="divide-y divide-line border-y border-line">
              {FAQ.map(([q, a]) => (
                <details key={q} className="group py-5">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-[16.5px] font-medium text-ink [&::-webkit-details-marker]:hidden">
                    {q}
                    <span aria-hidden className="text-[22px] font-light leading-none text-teal-ink transition-transform group-open:rotate-45">+</span>
                  </summary>
                  <p className="mt-3 max-w-2xl text-[15px] leading-[1.7] text-muted">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* Closing */}
        <section className="mx-auto max-w-6xl px-5 py-24 text-center">
          <h2 className="mx-auto max-w-2xl font-display text-[34px] font-medium leading-[1.1] tracking-[-0.015em] text-brand-deep sm:text-[46px]">
            Put your next invoice through MediCore.
          </h2>
          <p className="mx-auto mt-5 max-w-lg text-[16px] leading-[1.7] text-muted">Create a workspace, invite your team and bill your first customer today.</p>
          <div className="mt-9 flex flex-wrap justify-center gap-3">
            <Link href="/register" className="rounded-md bg-primary px-7 py-3.5 text-[15px] font-medium text-white shadow-md transition-colors hover:bg-primary-hover">Start your 14-day trial</Link>
            <Link href="/login" className="rounded-md border border-line bg-surface px-7 py-3.5 text-[15px] font-medium transition-colors hover:bg-subtle">Sign in</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-5 py-10 text-[13px] text-muted md:flex-row md:items-center md:justify-between">
          <div className="space-y-2">
            <Wordmark />
            <p>Pharmacy software for India, by Godevs.</p>
          </div>
          <nav aria-label="Footer" className="flex flex-wrap gap-x-7 gap-y-2">
            <a href="#product" className="hover:text-ink">Product</a>
            <a href="#pricing" className="hover:text-ink">Pricing</a>
            <a href="#faq" className="hover:text-ink">FAQ</a>
            <Link href="/login" className="hover:text-ink">Sign in</Link>
            <Link href="/register" className="hover:text-ink">Register</Link>
          </nav>
          <p>© 2026 Godevs. All rights reserved.</p>
        </div>
      </footer>
    </div>
  );
}
