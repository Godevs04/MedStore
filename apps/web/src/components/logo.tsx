import { cn } from './ui';

const DEEP = '#123B3A';
const TEAL = '#14B8A6';
const TEAL_LIGHT = '#5FD8C4';
const MINT = '#D9F7EF';

/** The MediCore "M" mark: two pillars meeting at a capsule. */
export function LogoMark({ size = 32, className, title }: { size?: number; className?: string; title?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 40 40"
      fill="none"
      className={cn('shrink-0', className)}
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="3" y="5" width="10" height="30" rx="5" fill={DEEP} />
      <rect x="27" y="5" width="10" height="30" rx="5" fill={TEAL} />
      <path d="M8 10 L20 22" stroke={DEEP} strokeWidth="10" strokeLinecap="round" />
      <path d="M32 10 L20 22" stroke={TEAL_LIGHT} strokeWidth="10" strokeLinecap="round" />
      <rect x="14" y="15" width="12" height="22" rx="6" fill="#fff" />
      <path d="M16 26 V21 a4 4 0 0 1 8 0 V26 Z" fill={MINT} />
      <path d="M16 26 H24 V31 a4 4 0 0 1 -8 0 Z" fill={TEAL} />
    </svg>
  );
}

/** Mark plus two-tone wordmark. `inverse` is for the deep evergreen brand panel. */
export function Logo({ collapsed, inverse, size = 'md', className }: { collapsed?: boolean; inverse?: boolean; size?: 'md' | 'lg'; className?: string }) {
  const mark = size === 'lg' ? 40 : 32;
  return (
    <span className={cn('inline-flex items-center gap-2.5', className)}>
      {inverse ? (
        <span className="flex items-center justify-center rounded-xl bg-white p-1.5">
          <LogoMark size={mark - 8} />
        </span>
      ) : (
        <LogoMark size={mark} />
      )}
      {!collapsed ? (
        <span className="min-w-0 leading-none">
          <span className={cn('block font-bold tracking-[-0.03em]', size === 'lg' ? 'text-[22px]' : 'text-[17px]')}>
            <span className={inverse ? 'text-white' : 'text-brand-deep'}>Medi</span>
            <span className={inverse ? 'text-brand-300' : 'text-accent'}>Core</span>
          </span>
          <span className={cn('mt-1 block text-[9px] font-medium uppercase tracking-[0.28em]', inverse ? 'text-white/75' : 'text-muted')}>Pharmacy ERP</span>
        </span>
      ) : null}
    </span>
  );
}
