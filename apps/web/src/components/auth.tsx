'use client';

import { forwardRef, useEffect, useState, type InputHTMLAttributes, type ReactNode } from 'react';
import { Icon, type IconName } from './icons';
import { Card, Input, cn } from './ui';

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

function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <div
      className={cn(
        'mc-anim-float flex items-center justify-center rounded-2xl bg-gradient-to-br from-brand-500 to-brand-700 text-white shadow-lg shadow-brand-600/30',
        size === 'lg' ? 'h-14 w-14' : 'h-11 w-11',
      )}
    >
      <Icon name="products" size={size === 'lg' ? 26 : 21} strokeWidth={2} />
    </div>
  );
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
      <div className="mc-anim-fade-up flex items-center gap-3">
        <Logo />
        <div>
          <div className="text-lg font-bold tracking-tight">
            <span className="mc-gradient-text">MediCore</span>
          </div>
          <div className="text-[10px] font-medium uppercase tracking-[0.2em] text-neutral-400">Pharmacy ERP Platform</div>
        </div>
      </div>
      <div className="mc-anim-fade-up space-y-6" style={{ animationDelay: '120ms' }}>
        <h2 className="max-w-md text-3xl font-bold leading-tight tracking-tight text-neutral-800">
          Batch-level inventory.
          <br />
          <span className="mc-gradient-text">GST-ready billing.</span>
          <br />
          Compliance built in.
        </h2>
        <ul className="space-y-3 text-sm text-neutral-600">
          {HIGHLIGHTS.map((line, i) => (
            <li key={line} className="mc-anim-fade-up flex items-start gap-2.5" style={{ animationDelay: `${250 + i * 90}ms` }}>
              <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-700">
                <Icon name="check" size={12} strokeWidth={2.75} />
              </span>
              {line}
            </li>
          ))}
        </ul>
      </div>
      <p className="text-xs text-neutral-400">Built for Indian pharmacies — INR, GSTIN, Schedule H1 registers, Asia/Kolkata.</p>
    </div>
  );
}

/** Split-screen auth layout: brand panel on large screens, centred card everywhere. */
export function AuthShell({ title, subtitle, children, footer, wide }: { title: string; subtitle?: ReactNode; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  return (
    <div className="flex min-h-screen">
      <AuthAside />
      <div className="flex flex-1 items-center justify-center p-6">
        <div className={cn('w-full space-y-5', wide ? 'max-w-md' : 'max-w-sm')}>
          <div className="mc-anim-fade-up flex flex-col items-center text-center lg:hidden">
            <Logo size="lg" />
            <span className="mc-gradient-text mt-2 text-lg font-bold">MediCore</span>
          </div>
          <Card className="mc-anim-fade-up p-1" delay={60}>
            <div className="px-5 pb-5 pt-4">
              <h1 className="text-base font-semibold tracking-tight text-neutral-800">{title}</h1>
              {subtitle ? <p className="mt-0.5 text-xs text-neutral-500">{subtitle}</p> : null}
              <div className="mt-5">{children}</div>
            </div>
          </Card>
          {footer ? <div className="text-center text-xs text-neutral-500">{footer}</div> : null}
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
          className="absolute right-1.5 top-1/2 flex -translate-y-1/2 rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-800"
        >
          <Icon name={visible ? 'eyeOff' : 'eye'} size={15} />
        </button>
      </div>
      {caps ? (
        <p className="mc-anim-fade-in mt-1 flex items-center gap-1 text-[11px] font-medium text-amber-700">
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
  const tone = score <= 2 ? 'bg-red-500' : score === 3 ? 'bg-amber-500' : score === 4 ? 'bg-brand-500' : 'bg-emerald-500';
  const label = !value ? '' : score <= 2 ? 'Weak' : score === 3 ? 'Fair' : score === 4 ? 'Good' : 'Strong';
  return (
    <div className="mt-1.5 space-y-1.5" aria-live="polite">
      <div className="flex items-center gap-2">
        <div className="flex h-1.5 flex-1 gap-1">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} className={cn('h-full flex-1 rounded-full transition-colors duration-300', i < score ? tone : 'bg-neutral-200')} />
          ))}
        </div>
        <span className="w-12 text-right text-[11px] font-medium text-neutral-500">{label}</span>
      </div>
      <ul className="grid grid-cols-2 gap-x-3 gap-y-0.5">
        {RULES.map((r) => {
          const ok = r.test(value);
          return (
            <li key={r.label} className={cn('flex items-center gap-1.5 text-[11px] transition-colors', ok ? 'text-emerald-700' : 'text-neutral-400')}>
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
  const tones = { green: 'bg-emerald-100 text-emerald-700', red: 'bg-red-100 text-red-700', blue: 'bg-brand-100 text-brand-700' };
  return (
    <div className="mc-anim-scale-in space-y-2 py-2 text-center">
      <div className={cn('mx-auto flex h-11 w-11 items-center justify-center rounded-full', tones[tone])}>
        <Icon name={icon} size={20} className={icon === 'loading' ? 'animate-spin' : undefined} />
      </div>
      <p className="text-sm font-semibold text-neutral-800">{title}</p>
      {children ? <div className="space-y-2 text-xs leading-relaxed text-neutral-500">{children}</div> : null}
    </div>
  );
}

export const authLinkClass = 'font-medium text-brand-700 transition-colors hover:text-brand-500 hover:underline';
