import type { DateOnly } from './types';

export function isValidDate(value: unknown): value is DateOnly {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T12:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value && value >= '0001-01-01';
}
export function requireDate(value: unknown): DateOnly {
  if (!isValidDate(value)) throw new Error('תאריך לא תקין');
  return value;
}
export function todayJerusalem(now = new Date()): DateOnly {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Jerusalem', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function monthStart(date: DateOnly): DateOnly { return `${requireDate(date).slice(0, 7)}-01`; }
export function monthEnd(date: DateOnly): DateOnly {
  requireDate(date);
  const year = Number(date.slice(0, 4));
  const month = Number(date.slice(5, 7));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  return `${date.slice(0, 7)}-${days}`;
}
/** Use the template's original day every month; February never changes the anchor. */
export function monthlyDate(yearMonth: string, day: number): DateOnly {
  if (!/^\d{4}-\d{2}$/.test(yearMonth) || !Number.isInteger(day) || day < 1 || day > 31) throw new Error('מועד חודשי לא תקין');
  const end = monthEnd(`${yearMonth}-01`);
  return `${yearMonth}-${Math.min(day, Number(end.slice(8))).toString().padStart(2, '0')}`;
}
export function anchoredMonthlyDate(anchor: DateOnly, yearMonth: string): DateOnly {
  return monthlyDate(yearMonth, Number(requireDate(anchor).slice(8)));
}
