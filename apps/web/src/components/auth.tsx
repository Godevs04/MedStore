'use client';

import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Logo } from './logo';
import { Input, cn } from './ui';

/** Reads a query-string value after mount (avoids a Suspense boundary for useSearchParams). */
export function useQueryParam(name: string): { value: string | null; ready: boolean } {
  const [state, setState] = useState<{ value: string | null; ready: boolean }>({ value: null, ready: false });
  useEffect(() => {
    setState({ value: new URLSearchParams(window.location.search).get(name), ready: true });
  }, [name]);
  return state;
}

/** Only same-origin absolute paths are allowed as post-login destinations. */
export function safeNext(raw: string | null): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\') || raw.startsWith('/login')) return '/';
  return raw;
}

const HIGHLIGHTS = [
  'FEFO allocation with expired-stock blocking (Drugs Rules 65(17))',
  'GST-ready billing — CGST/SGST/IGST split by place of supply',
  'Schedule H/H1 registers, licence tracking and audit trails',
  'Server-enforced tenant isolation, DPDP-aligned data handling',
];

function AuthAside() {
  return (
    <div className="mc-auth-backdrop relative hidden flex-1 flex-col justify-between overflow-hidden p-12 lg:flex">
      <div className="mc-anim-fade-in">
        <Logo inverse size="lg" />
      </div>
      <div className="space-y-6">
        <h2 className="max-w-md text-[30px] font-semibold leading-tight tracking-tight text-white">
          Batch-level inventory.
          <br />
          <span className="text-brand-200">GST-ready billing.</span>
          <br />
          Compliance built in.
        </h2>
        <ul className="space-y-3 text-sm text-white/75">
          {HIGHLIGHTS.map((line) => (
            <li key={line} className="flex items-start gap-2.5">
              <Icon name="checkCircle" size={16} className="mt-0.5 shrink-0 text-brand-200" />
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-white/70">Built for Indian pharmacies — INR, GSTIN, Schedule H1 registers, Asia/Kolkata.</p>
    </div>
  );
}

/** Split-screen auth layout: brand panel on large screens, centred card everywhere. */
export function AuthShell({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen bg-canvas">
      <AuthAside />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className={cn('w-full space-y-5', wide ? 'max-w-md' : 'max-w-sm')}>
          <div className="mc-anim-fade-in flex justify-center lg:hidden">
            <Logo size="lg" />
          </div>
          <section className="mc-anim-fade-in rounded-xl border border-line bg-surface p-6">
            <h1 className="text-[1.375rem] font-semibold tracking-tight text-ink">{title}</h1>
            {subtitle ? <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p> : null}
            <div className="mt-5">{children}</div>
          </section>
          {footer ? <div className="text-center text-xs text-muted">{footer}</div> : null}
        </div>
      </div>
    </div>
  );
}

/** Password field with a show/hide toggle and a Caps Lock warning. */
export const PasswordInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function PasswordInput({ className, onKeyUp, onBlur, ...props }, ref) {
  const [visible, setVisible] = useState(false);
  const [caps, setCaps] = useState(false);
  return (
    <div>
      <div className="relative">
        <Input
          ref={ref}
          type={visible ? 'text' : 'password'}
          className={cn('pr-14', className)}
          onKeyUp={(e) => {
            setCaps(e.getModifierState('CapsLock'));
            onKeyUp?.(e);
          }}
          onBlur={(e) => {
            setCaps(false);
            onBlur?.(e);
          }}
          {...props}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={visible ? 'Hide password' : 'Show password'}
          aria-pressed={visible}
          onClick={() => setVisible((v) => !v)}
          className="absolute right-1.5 top-1/2 flex -translate-y-1/2 rounded-md p-1.5 text-faint transition-colors hover:bg-subtle hover:text-ink"
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={15} />
        </button>
      </div>
      {caps ? (
        <p className="mc-anim-fade-in mt-1 flex items-center gap-1 text-2xs font-medium text-warning">
          <Icon name="warning" size={12} /> Caps Lock is on
        </p>
      ) : null}
    </div>
  );
});

const RULES: Array<{ label: string; test: (v: string) => boolean }> = [
  { label: '10+ characters', test: (v) => v.length >= 10 },
  { label: 'Lower case', test: (v) => /[a-z]/.test(v) },
  { label: 'Upper case', test: (v) => /[A-Z]/.test(v) },
  { label: 'A digit', test: (v) => /\d/.test(v) },
];

/** Live checklist mirroring `passwordSchema`, plus a strength bar. */
export function PasswordChecklist({ value }: { value: string }) {
  const passed = RULES.filter((r) => r.test(value)).length;
  const bonus = value.length >= 14 && /[^A-Za-z0-9]/.test(value) ? 1 : 0;
  const score = value ? passed + bonus : 0;
  const tone = score <= 2 ? 'bg-danger' : score === 3 ? 'bg-warning' : score === 4 ? 'bg-accent' : 'bg-success';
  const label = !value ? '' : score <= 2 ? 'Weak' : score === 3 ? 'Fair' : score === 4 ? 'Good' : 'Strong';
  return (
    <div className="mt-1.5 space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex h-1.5 flex-1 gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cn('h-full flex-1 rounded-full transition-colors duration-300', i < score ? tone : 'bg-neutral-200')} />
          ))}
        </div>
        <span className="w-12 text-right text-2xs font-medium text-muted">{label}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.label} className={cn('flex items-center gap-1.5 text-2xs transition-colors', ok ? 'text-success' : 'text-faint')}>
              <Icon name={ok ? 'checkCircle' : 'circle'} size={12} strokeWidth={ok ? 2.5 : 2} />
              {r.label}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Inline status block used for success / failure end-states. */
export function AuthStatus({ tone, icon, title, children }: { tone: 'green' | 'red' | 'blue'; icon: IconName; title: string; children?: ReactNode }) {
  const tones = { green: 'bg-success/15 text-success', red: 'bg-danger/15 text-danger', blue: 'bg-brand-100 text-teal-ink' };
  return (
    <div className="mc-anim-fade-in space-y-2 py-2 text-center">
      <div className={cn('mx-auto flex h-11 w-11 items-center justify-center rounded-full', tones[tone])}>
        <Icon name={icon} size={20} className={icon === 'loading' ? 'animate-spin' : undefined} />
      </div>
      <p className="text-sm font-semibold text-ink">{title}</p>
      {children ? <div className="space-y-2 text-xs leading-relaxed text-muted">{children}</div> : null}
    </div>
  );
}

export const authLinkClass = 'font-medium text-teal-ink transition-colors hover:text-brand-500 hover:underline';
