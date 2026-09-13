import type { Minor } from './types';

export const MIN_MINOR = -9223372036854775808n;
export const MAX_MINOR = 9223372036854775807n;

/** The only conversion from serialized money to an arithmetic value. */
export function minor(value: string | bigint): bigint {
  if (typeof value !== 'bigint' && (typeof value !== 'string' || !/^(0|-?[1-9]\d*)$/.test(value))) {
    throw new Error('סכום כספי חייב להיות מספר שלם של אגורות');
  }
  const result = typeof value === 'bigint' ? value : BigInt(value);
  if (result < MIN_MINOR || result > MAX_MINOR) throw new Error('הסכום מחוץ לטווח הנתמך');
  return result;
}

export function toMinor(value: bigint): Minor { return minor(value).toString(); }

/** Parse user-entered shekels without ever passing through a floating-point value. */
export function parseMoney(display: string): bigint {
  if (typeof display !== 'string') throw new Error('יש להזין סכום תקין');
  const clean = display.trim().replace(/[\u200e\u200f\u061c\u2066-\u2069]/g, '').replace(/^₪\s*|\s*₪$/g, '').trim();
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(clean)) {
    throw new Error('יש להזין סכום בשקלים עם עד שתי ספרות אחרי הנקודה');
  }
  const normalized = clean.replaceAll(',', '');
  const negative = normalized.startsWith('-');
  const [whole, fraction = ''] = normalized.replace(/^[+-]/, '').split('.');
  return minor((negative ? -1n : 1n) * (BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'))));
}

export function moneyToMinor(display: string): Minor { return toMinor(parseMoney(display)); }

/** Exact fixed-point display; callers isolate this string with <bdi dir="ltr">. */
export function formatMoney(value: Minor | bigint): string {
  const amount = minor(value);
  const absolute = amount < 0n ? -amount : amount;
  const whole = (absolute / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${amount < 0n ? '−' : ''}₪${whole}.${(absolute % 100n).toString().padStart(2, '0')}`;
}

export function moneyInput(value: Minor | bigint): string {
  const amount = minor(value);
  const absolute = amount < 0n ? -amount : amount;
  return `${amount < 0n ? '-' : ''}${absolute / 100n}.${(absolute % 100n).toString().padStart(2, '0')}`;
}
export const formatMoneyInput = moneyInput;

export function sumMoney(values: Iterable<Minor | bigint>): bigint {
  let result = 0n;
  for (const value of values) result += minor(value);
  return minor(result);
}
export function addMoney(a: Minor | bigint, b: Minor | bigint): bigint { return minor(minor(a) + minor(b)); }
export function subtractMoney(a: Minor | bigint, ...deductions: (Minor | bigint)[]): bigint { return minor(minor(a) - sumMoney(deductions)); }
export function absMoney(value: Minor | bigint): bigint { const result = minor(value); return minor(result < 0n ? -result : result); }
