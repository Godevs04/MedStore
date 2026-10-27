'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { Icon, type IconName } from '@/components/icons';

export type ToastTone = 'success' | 'error' | 'info' | 'warning';

interface ToastItem {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
}

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function push(tone: ToastTone, title: string, description?: string): number {
  const id = ++seq;
  // Collapse identical toasts fired in quick succession (e.g. a retried query).
  items = [...items.filter((t) => !(t.title === title && t.description === description)), { id, tone, title, description }].slice(-4);
  emit();
  return id;
}

export const toast = {
  success: (title: string, description?: string) => push('success', title, description),
  error: (title: string, description?: string) => push('error', title, description),
  info: (title: string, description?: string) => push('info', title, description),
  warning: (title: string, description?: string) => push('warning', title, description),
  dismiss: (id: number) => {
    items = items.filter((t) => t.id !== id);
    emit();
  },
};

const TONE: Record<ToastTone, { ring: string; icon: IconName; iconBg: string }> = {
  success: { ring: 'before:bg-success', icon: 'checkCircle', iconBg: 'text-success' },
  error: { ring: 'before:bg-danger', icon: 'danger', iconBg: 'text-danger' },
  warning: { ring: 'before:bg-warning', icon: 'warning', iconBg: 'text-warning' },
  info: { ring: 'before:bg-info', icon: 'info', iconBg: 'text-info' },
};

function ToastCard({ item }: { item: ToastItem }) {
  useEffect(() => {
    const t = setTimeout(() => toast.dismiss(item.id), item.tone === 'error' ? 7000 : 4000);
    return () => clearTimeout(t);
  }, [item.id, item.tone]);
  const tone = TONE[item.tone];
  return (
    <div
      role={item.tone === 'error' ? 'alert' : 'status'}
      className={`mc-anim-toast pointer-events-auto relative flex w-80 max-w-[calc(100vw-2rem)] items-start gap-2.5 overflow-hidden rounded-lg border border-line bg-surface py-2.5 pl-4 pr-3 shadow-pop before:absolute before:inset-y-0 before:left-0 before:w-[3px] ${tone.ring}`}
    >
      <Icon name={tone.icon} size={16} className={`mt-px ${tone.iconBg}`} />
      <div className="min-w-0 flex-1">
        <p className="text-[13px] font-medium text-ink">{item.title}</p>
        {item.description ? <p className="mt-0.5 break-words text-xs text-muted">{item.description}</p> : null}
      </div>
      <button aria-label="Dismiss" className="rounded p-0.5 text-faint transition-colors hover:bg-subtle hover:text-ink" onClick={() => toast.dismiss(item.id)}>
        <Icon name="close" size={14} />
      </button>
    </div>
  );
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};
const snapshot = () => items;
const serverSnapshot: ToastItem[] = [];

export function Toaster() {
  const list = useSyncExternalStore(subscribe, snapshot, () => serverSnapshot);
  return (
    <div aria-live="polite" className="no-print pointer-events-none fixed bottom-4 right-4 z-toast flex flex-col items-end gap-2">
      {list.map((t) => (
        <ToastCard key={t.id} item={t} />
      ))}
    </div>
  );
}
