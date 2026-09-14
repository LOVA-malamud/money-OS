import { useEffect, useRef } from 'react';
import type { CSSProperties, ReactNode, SelectHTMLAttributes } from 'react';
import { X, CircleHelp, ChevronDown } from 'lucide-react';
import { formatMoney } from '../domain/money';
import type { Metric, Minor } from '../domain/types';

export function Money({ value, className = '', compact = false }: { value: Minor | bigint; className?: string; compact?: boolean }) {
  const text = formatMoney(value);
  const display = compact && text.endsWith('.00') ? text.slice(0, -3) : text;
  return <bdi dir="ltr" className={`numeric ${className}`} style={{ '--money-length': display.length } as CSSProperties}>{display.split(',').map((group, index, groups) => <span key={index}>{group}{index < groups.length - 1 ? ',' : ''}</span>)}</bdi>;
}
export function Select({ displayValue, ...props }: SelectHTMLAttributes<HTMLSelectElement> & { displayValue?: ReactNode }) {
  return <span className={`select-control ${displayValue ? 'has-display-value' : ''}`}><select {...props}/>{displayValue&&<span className="select-display" aria-hidden="true">{displayValue}</span>}<ChevronDown size={16} aria-hidden="true"/></span>;
}
export function MetricAmount({ metric, compact = true, className = '' }: { metric: Metric; compact?: boolean; className?: string }) {
  return metric.status === 'known'
    ? <Money value={metric.amountMinor} compact={compact} className={className} />
    : <span className={`metric-state ${className}`} title={metric.reasons.join(' · ')}>{metric.status === 'unknown' ? 'חסר מידע' : 'מידע חלקי'}</span>;
}
export function MetricDetails({ metric }: { metric: Metric }) {
  if (metric.status === 'known') return null;
  return <div className="notice notice-warning"><p>הסכום אינו מלא ולכן לא מוצג כיתרה סופית.</p>
    <ul>{metric.reasons.map((reason) => <li key={reason}>{reason}</li>)}</ul>
    <p>סכום שנרשם עד כה: <Money value={metric.knownSubtotalMinor} /></p>
  </div>;
}
export function cycleDialogFocus(event: KeyboardEvent, root: HTMLElement | null) {
  if (event.key !== 'Tab' || !root) return;
  const elements = [...root.querySelectorAll<HTMLElement>('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex="0"]')].filter(element => element.getClientRects().length > 0);
  event.preventDefault();
  if (!elements.length) { root.focus(); return; }
  const index = elements.findIndex(element => element === document.activeElement);
  const next = index < 0 ? (event.shiftKey ? elements.length - 1 : 0) : (index + (event.shiftKey ? -1 : 1) + elements.length) % elements.length;
  // Cycle explicitly: Safari may omit buttons from its native Tab sequence.
  elements[next].focus();
}
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    ref.current?.focus();
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') closeRef.current();
      cycleDialogFocus(event, ref.current);
    };
    document.addEventListener('keydown', key);
    return () => { document.body.style.overflow = bodyOverflow; document.removeEventListener('keydown', key); previous?.focus(); };
  }, []);
  return <div className="sheet-overlay" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <div className="sheet" style={wide ? { maxWidth: 720 } : undefined} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} ref={ref}>
      <header className="sheet-header"><h2>{title}</h2><button className="icon-button" aria-label="סגירה" onClick={onClose}><X size={24} /></button></header>
      {children}
    </div>
  </div>;
}
export function Empty({ title, children, action }: { title: string; children: ReactNode; action?: ReactNode }) {
  return <div className="empty-state"><CircleHelp size={32} /><h2>{title}</h2><p>{children}</p>{action}</div>;
}
export function dateLabel(value: string): string {
  const [year, month, day] = value.split('-').map(Number);
  return new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' }).format(new Date(year, month - 1, day, 12));
}
