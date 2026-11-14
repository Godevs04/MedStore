import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'MediCore — Pharmacy ERP for India',
  description:
    'Batch-level inventory, GST-ready billing, purchasing, accounting and compliance registers for Indian pharmacies, as a multi-tenant SaaS.',
};

const FEATURES = [
  { title: 'GST-ready POS billing', body: 'Fast counter billing with CGST/SGST/IGST split by place of supply and printable tax invoices. Rates are versioned and effective-dated, never hardcoded.', tag: 'Sell' },
  { title: 'Batch-level inventory', body: 'FEFO allocation by default. Expired, recalled or quarantined batches can never be sold, and every movement lands in an append-only ledger.', tag: 'Stock' },
  { title: 'Purchasing to payment', body: 'Purchase order, goods receipt, supplier invoice, payment and debit note in one traceable chain with vendor payables.', tag: 'Buy' },
  { title: 'Double-entry accounting', body: 'Statements, journals, reversals and period locks, posted from your sales and purchases automatically.', tag: 'Books' },
  { title: 'Compliance registers', body: 'Schedule H1 register, GST summaries and licence tracking, with audited CSV exports ready for inspection.', tag: 'Comply' },
  { title: 'Multi-branch control', body: 'Branches, warehouses, stock transfers and role-based permissions, scoped to each tenant on the server.', tag: 'Scale' },
];

const STEPS = [
  { n: '01', title: 'Register your pharmacy', body: 'Create your workspace in a minute and start a 14-day full-feature trial. No card needed.' },
  { n: '02', title: 'Load your catalogue', body: 'Import products, vendors and opening stock by CSV, then load the standard GST rates in one click.' },
  { n: '03', title: 'Start billing', body: 'Bill at the counter, receive stock, and watch expiry, margins and books update live.' },
];

const PLANS = [
  { name: 'Starter', for: 'Single-shop pharmacy', hi: false, rows: ['1 branch · 5 users', '2,000 invoices / month', 'Catalogue, inventory, POS'] },
  { name: 'Professional', for: 'Growing retail', hi: true, rows: ['2 branches · 15 users', '20,000 invoices / month', 'Adds purchasing and returns', 'API access'] },
  { name: 'Business', for: 'Multi-branch and distribution', hi: false, rows: ['10 branches · 50 users', '200,000 invoices / month', 'Adds wholesale and accounting', 'API access'] },
  { name: 'Enterprise', for: 'Unlimited scale', hi: false, rows: ['Unlimited branches and users', 'Every module', 'Integrations on request'] },
];

const TRUST = [
  { k: 'Tenant isolation', v: 'Scoping and permission checks on every endpoint, enforced by the server' },
  { k: 'Audit trail', v: 'Append-only inventory ledger and audit log' },
  { k: 'Money-safe maths', v: 'Integer paise, no floats, HALF_UP rounding' },
  { k: 'Plan enforcement', v: 'Quotas and modules gated by the API, not just the UI' },
];

function Logo() {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg width="32" height="32" viewBox="0 0 40 40" fill="none" aria-hidden>
        <rect x="3" y="5" width="10" height="30" rx="5" fill="#123B3A" />
        <rect x="27" y="5" width="10" height="30" rx="5" fill="#14B8A6" />
        <path d="M8 10 L20 22" stroke="#123B3A" strokeWidth="10" strokeLinecap="round" />
        <path d="M32 10 L20 22" stroke="#5FD8C4" strokeWidth="10" strokeLinecap="round" />
        <rect x="14" y="15" width="12" height="22" rx="6" fill="#fff" />
        <path d="M16 26 V21 a4 4 0 0 1 8 0 V26 Z" fill="#D9F7EF" />
        <path d="M16 26 H24 V31 a4 4 0 0 1 -8 0 Z" fill="#14B8A6" />
      </svg>
      <span className="leading-none">
        <span className="block text-[17px] font-bold tracking-[-0.03em]"><span className="text-brand-deep">Medi</span><span className="text-accent">Core</span></span>
        <span className="mt-1 block text-[9px] font-medium uppercase tracking-[0.28em] text-muted">Pharmacy ERP</span>
      </span>
    </span>
  );
}

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" className="mt-0.5 shrink-0 text-accent" aria-hidden>
      <path d="M3 8.5l3.2 3L13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ProductPreview() {
  const bars = [38, 52, 44, 66, 58, 74, 62, 88, 70, 96];
  return (
    <div className="relative mx-auto mt-16 w-full max-w-5xl">
      <div className="absolute -inset-x-10 -top-10 bottom-0 -z-10 rounded-[40px] bg-gradient-to-b from-brand-100/70 to-transparent blur-2xl" />
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b border-line bg-subtle px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
          <span className="h-2.5 w-2.5 rounded-full bg-neutral-300" />
          <span className="ml-4 rounded-md bg-surface px-3 py-1 text-2xs text-muted">medicore.teamgodevs.in/dashboard</span>
        </div>
        <div className="grid grid-cols-12">
          <aside className="col-span-3 hidden space-y-1 border-r border-line bg-canvas p-4 md:block">
            {['Dashboard', 'POS billing', 'Inventory', 'Purchasing', 'Accounting', 'Compliance'].map((l, i) => (
              <div key={l} className={`rounded-lg px-3 py-2 text-[13px] ${i === 0 ? 'bg-mint font-medium text-brand-800' : 'text-muted'}`}>{l}</div>
            ))}
          </aside>
          <div className="col-span-12 space-y-5 p-5 md:col-span-9 md:p-6">
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              {[['Today’s sales', '₹48,260'], ['Bills', '134'], ['Near expiry', '12 batches'], ['Low stock', '7 items']].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-line p-3.5">
                  <div className="text-2xs uppercase tracking-wider text-faint">{k}</div>
                  <div className="num mt-1 text-metric text-ink">{v}</div>
                </div>
              ))}
            </div>
            <div className="rounded-xl border border-line p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] font-medium">Revenue, last 10 days</span>
                <span className="rounded-full bg-mint px-2 py-0.5 text-2xs font-medium text-teal-ink">Sample data</span>
              </div>
              <div className="flex h-32 items-end gap-2">
                {bars.map((h, i) => (
                  <div key={i} className="flex-1 rounded-t-md bg-gradient-to-t from-brand-600 to-brand-300" style={{ height: `${h}%` }} />
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function LandingPage() {
  return (
    <div className="bg-canvas text-ink">
      <header className="sticky top-0 z-header border-b border-line/70 bg-canvas/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-5">
          <Link href="/" aria-label="MediCore home"><Logo /></Link>
          <nav className="hidden items-center gap-8 text-[13.5px] text-muted md:flex">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#plans" className="hover:text-ink">Plans</a>
            <a href="#trust" className="hover:text-ink">Trust</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="rounded-lg px-3.5 py-2 text-[13.5px] font-medium text-ink hover:bg-subtle">Sign in</Link>
            <Link href="/register" className="rounded-lg bg-primary px-4 py-2 text-[13.5px] font-medium text-white hover:bg-primary-hover">Start free trial</Link>
          </div>
        </div>
      </header>

      <main>
        <section className="relative overflow-hidden px-5 pb-24 pt-20 md:pt-28">
          <div className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(60%_50%_at_50%_0%,rgb(var(--mc-mint))_0%,transparent_70%)]" />
          <div className="mx-auto max-w-3xl text-center">
            <span className="inline-flex items-center gap-2 rounded-full border border-line bg-surface px-3.5 py-1.5 text-[12.5px] text-muted shadow-sm">
              <span className="h-1.5 w-1.5 rounded-full bg-accent" /> Built for Indian pharmacies · GST and Drugs Rules aware
            </span>
            <h1 className="mt-7 text-[44px] font-semibold leading-[1.05] tracking-tight md:text-[68px]">
              Run your pharmacy
              <br />
              <span className="bg-gradient-to-r from-brand-700 to-brand-400 bg-clip-text text-transparent">without the paperwork.</span>
            </h1>
            <p className="mx-auto mt-6 max-w-2xl text-[17px] leading-relaxed text-muted">
              MediCore brings billing, batch-level inventory, purchasing, accounting and compliance registers into one cloud workspace, so every sale is GST-correct and every batch is traceable.
            </p>
            <div className="mt-9 flex flex-col items-center justify-center gap-3 sm:flex-row">
              <Link href="/register" className="rounded-xl bg-primary px-7 py-3.5 text-[15px] font-medium text-white shadow-lg hover:bg-primary-hover">Start your 14-day free trial</Link>
              <a href="#features" className="rounded-xl border border-line bg-surface px-7 py-3.5 text-[15px] font-medium hover:bg-subtle">See what’s inside</a>
            </div>
            <p className="mt-4 text-[12.5px] text-faint">No card required · Full features during trial</p>
          </div>
          <ProductPreview />
        </section>

        <section id="trust" className="border-y border-line bg-surface px-5 py-14">
          <div className="mx-auto grid max-w-6xl gap-8 md:grid-cols-4">
            {TRUST.map((t) => (
              <div key={t.k}>
                <div className="text-[14px] font-semibold text-brand-800">{t.k}</div>
                <p className="mt-1.5 text-[13.5px] leading-relaxed text-muted">{t.v}</p>
              </div>
            ))}
          </div>
        </section>

        <section id="features" className="px-5 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="max-w-2xl">
              <p className="text-[13px] font-semibold uppercase tracking-widest text-teal-ink">Platform</p>
              <h2 className="mt-3 text-[34px] font-semibold leading-tight tracking-tight md:text-[42px]">Everything a pharmacy runs on, in one place.</h2>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((f) => (
                <article key={f.title} className="group rounded-2xl border border-line bg-surface p-7 transition hover:-translate-y-0.5 hover:shadow-lg">
                  <span className="rounded-full bg-mint px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-teal-ink">{f.tag}</span>
                  <h3 className="mt-5 text-[19px] font-semibold tracking-tight">{f.title}</h3>
                  <p className="mt-2.5 text-[14.5px] leading-relaxed text-muted">{f.body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="how" className="bg-brand-deep px-5 py-24 text-white">
          <div className="mx-auto max-w-6xl">
            <p className="text-[13px] font-semibold uppercase tracking-widest text-brand-300">Get started</p>
            <h2 className="mt-3 max-w-xl text-[34px] font-semibold leading-tight tracking-tight md:text-[42px]">From sign-up to first bill in an afternoon.</h2>
            <div className="mt-12 grid gap-6 md:grid-cols-3">
              {STEPS.map((s) => (
                <div key={s.n} className="rounded-2xl border border-white/10 bg-white/5 p-7">
                  <div className="num text-[34px] font-semibold text-brand-300">{s.n}</div>
                  <h3 className="mt-4 text-[18px] font-semibold">{s.title}</h3>
                  <p className="mt-2 text-[14.5px] leading-relaxed text-brand-100/80">{s.body}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="plans" className="px-5 py-24">
          <div className="mx-auto max-w-6xl">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-[13px] font-semibold uppercase tracking-widest text-teal-ink">Plans</p>
              <h2 className="mt-3 text-[34px] font-semibold leading-tight tracking-tight md:text-[42px]">Grow into the plan that fits.</h2>
              <p className="mt-4 text-[15px] text-muted">Every workspace starts on a 14-day full-feature trial. Limits and modules are enforced server-side. Talk to us for pricing.</p>
            </div>
            <div className="mt-12 grid gap-5 md:grid-cols-2 lg:grid-cols-4">
              {PLANS.map((p) => (
                <div key={p.name} className={`flex flex-col rounded-2xl border p-7 ${p.hi ? 'border-brand-500 bg-surface shadow-xl ring-1 ring-brand-500' : 'border-line bg-surface'}`}>
                  {p.hi ? <span className="mb-3 w-fit rounded-full bg-primary px-2.5 py-1 text-2xs font-semibold uppercase tracking-wider text-white">Most popular</span> : <span className="mb-3 h-[26px]" />}
                  <h3 className="text-[20px] font-semibold">{p.name}</h3>
                  <p className="mt-1 text-[13.5px] text-muted">{p.for}</p>
                  <ul className="mt-6 flex-1 space-y-3 text-[14px]">
                    {p.rows.map((r) => (
                      <li key={r} className="flex gap-2.5"><Check />{r}</li>
                    ))}
                  </ul>
                  <Link href="/register" className={`mt-8 rounded-xl px-4 py-3 text-center text-[14px] font-medium ${p.hi ? 'bg-primary text-white hover:bg-primary-hover' : 'border border-line hover:bg-subtle'}`}>Start free trial</Link>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-5 pb-24">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-gradient-to-br from-brand-800 to-brand-600 px-8 py-16 text-center text-white shadow-2xl">
            <h2 className="mx-auto max-w-2xl text-[32px] font-semibold leading-tight tracking-tight md:text-[40px]">Bring your pharmacy onto MediCore today.</h2>
            <p className="mx-auto mt-4 max-w-xl text-[15.5px] text-brand-100/85">Create your workspace, invite your team, and issue your first GST invoice within the hour.</p>
            <Link href="/register" className="mt-8 inline-block rounded-xl bg-white px-8 py-3.5 text-[15px] font-semibold text-brand-800 hover:bg-mint">Start free trial</Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface px-5 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-4 text-[13px] text-muted md:flex-row">
          <Logo />
          <p>© {new Date().getFullYear()} MediCore by Godevs. All rights reserved.</p>
          <div className="flex gap-5">
            <Link href="/login" className="hover:text-ink">Sign in</Link>
            <Link href="/register" className="hover:text-ink">Register</Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
