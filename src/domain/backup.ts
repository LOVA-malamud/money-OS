import { z } from 'zod';
import { isValidDate, todayJerusalem } from './dates';
import { minor, sumMoney } from './money';
import { validateBalanceHistory, validateTransactionSemantics } from './ledger';
import { SYSTEM_ACCOUNTS, type Backup, type Dataset } from './types';

const id = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
const date = z.string().refine(isValidDate, 'תאריך לא תקין');
const timestamp = z.string().refine((value) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) && !Number.isNaN(Date.parse(value)), 'זמן לא תקין');
const money = z.string().refine((value) => { try { minor(value); return true; } catch { return false; } }, 'סכום כספי לא תקין');
const nonnegative = money.refine((value) => minor(value) >= 0n, 'הסכום אינו יכול להיות שלילי');
const positive = money.refine((value) => minor(value) > 0n, 'הסכום חייב להיות חיובי');
const revision = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const text = z.string().max(10000);
const name = z.string().trim().min(1).max(200);
const account = z.object({ id, name, kind: z.enum(['bank', 'cash', 'savings', 'credit_card', 'loan', 'asset']), spendable: z.boolean(), openingKnown: z.boolean(), openingDate: date.nullable(), archived: z.boolean(), revision }).strict();
const paymentMethod = z.object({ id, name, accountId: id, suffix: z.string().max(4), revision }).strict();
const category = z.object({ id, name, kind: z.enum(['expense', 'income']), pinned: z.boolean(), icon: z.string().max(100), revision }).strict();
const debt = z.object({ id, accountId: id, creditor: name, originalMinor: nonnegative.nullable(), note: text, revision }).strict();
const input = z.object({
  kind: z.enum(['income', 'expense', 'transfer', 'borrowing', 'repayment', 'refund', 'opening', 'reconcile', 'valuation']),
  date, amountMinor: money, accountId: id, toAccountId: id.optional(), categoryId: id.optional(), paymentMethodId: id.optional(),
  principalMinor: nonnegative.optional(), interestMinor: nonnegative.optional(), feeMinor: nonnegative.optional(),
  originalTransactionId: id.optional(), obligationId: id.optional(), merchant: z.string().max(500).optional(), note: text.optional(),
}).strict();
const transaction = z.object({ id, input, postings: z.array(z.object({ accountId: z.union([id, z.enum(['@expense', '@income', '@equity'])]), amountMinor: money }).strict()).min(2).max(10), voided: z.boolean(), revision, createdAt: timestamp, updatedAt: timestamp }).strict();
const obligation = z.object({ id, title: name, dueDate: date, expectedMinor: nonnegative.nullable(), accountId: id.nullable(), liabilityAccountId: id.nullable(), categoryId: id.nullable(), recurrenceId: id.nullable(), cancelled: z.boolean(), revision }).strict();
const recurrence = z.object({ id, title: name, amountMinor: nonnegative.nullable(), day: z.number().int().min(1).max(31), startDate: date, endDate: date.nullable(), accountId: id.nullable(), liabilityAccountId: id.nullable(), categoryId: id.nullable(), active: z.boolean(), revision }).strict();
const allocation = z.object({ id, transactionId: id, obligationId: id, amountMinor: positive }).strict();
const settings = z.object({ currency: z.literal('ILS'), timezone: z.literal('Asia/Jerusalem'), trackingStart: date, accountsReviewed: z.boolean(), debtsReviewed: z.boolean(), obligationsReviewed: z.boolean(), assetsReviewed: z.boolean(), lastPaymentMethodId: id.nullable(), recentCategoryIds: z.array(id).max(50), revision }).strict();
const datasetSchema = z.object({
  schemaVersion: z.literal(1), generation: id, snapshotToken: z.string().regex(/^[0-9a-f]{64}$/).optional(), settings,
  accounts: z.array(account), paymentMethods: z.array(paymentMethod), categories: z.array(category), debts: z.array(debt),
  transactions: z.array(transaction), obligations: z.array(obligation), recurrences: z.array(recurrence), allocations: z.array(allocation),
  audit: z.array(z.object({ id, entityType: z.string().min(1).max(100), entityId: z.string().min(1).max(200), action: z.string().min(1).max(100), before: z.unknown(), createdAt: timestamp }).strict()),
  operations: z.array(z.object({ id, requestHash: z.string().min(1).max(256), result: z.unknown() }).strict()),
}).strict();
const backupSchema = z.object({ format: z.literal('lova-money-os'), schemaVersion: z.literal(1), exportedAt: timestamp, data: datasetSchema }).strict();

function invariant(condition: unknown, message: string): asserts condition { if (!condition) throw new Error(message); }
function unique(items: { id: string }[], label: string): void {
  invariant(new Set(items.map((item) => item.id.toLowerCase())).size === items.length, `מזהה כפול ברשימת ${label}`);
}
/** Unknown audit/receipt payloads still must be plain JSON, never executable/prototyped objects. */
function jsonValue(value: unknown, depth = 0): void {
  invariant(depth < 100, 'הגיבוי מקונן מעבר למותר');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { invariant(Number.isFinite(value), 'ערך מספרי לא תקין בגיבוי'); return; }
  if (Array.isArray(value)) { for (const item of value) jsonValue(item, depth + 1); return; }
  invariant(typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'הגיבוי מכיל ערך שאינו JSON');
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    invariant(!['__proto__', 'prototype', 'constructor'].includes(key), 'מפתח לא תקין בגיבוי');
    jsonValue(item, depth + 1);
  }
}

export function validateDataset(value: unknown): Dataset {
  jsonValue(value);
  const parsed = datasetSchema.safeParse(value);
  if (!parsed.success) {
    // Never echo raw values or Zod's full financial payload into errors or logs.
    const path = parsed.error.issues[0]?.path.join('.') ?? '';
    throw new Error(`מבנה הגיבוי אינו תקין${path ? ` (${path})` : ''}`);
  }
  const data = parsed.data as Dataset;
  for (const [label, items] of Object.entries({ accounts: data.accounts, paymentMethods: data.paymentMethods, categories: data.categories, debts: data.debts, transactions: data.transactions, obligations: data.obligations, recurrences: data.recurrences, allocations: data.allocations, audit: data.audit, operations: data.operations })) unique(items, label);
  const accounts = new Map(data.accounts.map((item) => [item.id, item]));
  const categories = new Map(data.categories.map((item) => [item.id, item]));
  const transactions = new Map(data.transactions.map((item) => [item.id, item]));
  const obligations = new Map(data.obligations.map((item) => [item.id, item]));
  const recurrences = new Map(data.recurrences.map((item) => [item.id, item]));
  const methods = new Map(data.paymentMethods.map((item) => [item.id, item]));
  const systemIds = new Set<string>(Object.values(SYSTEM_ACCOUNTS));
  invariant(data.settings.trackingStart <= todayJerusalem(), 'תאריך תחילת המעקב אינו יכול להיות עתידי');
  invariant(!data.settings.lastPaymentMethodId || methods.has(data.settings.lastPaymentMethodId), 'אמצעי התשלום האחרון חסר');
  invariant(data.settings.recentCategoryIds.every((item) => categories.has(item)) && new Set(data.settings.recentCategoryIds).size === data.settings.recentCategoryIds.length, 'רשימת הקטגוריות האחרונות אינה תקינה');
  for (const item of data.accounts) {
    invariant(!item.spendable || ['bank', 'cash', 'savings'].includes(item.kind), 'רק חשבון כסף יכול להיכלל בכסף הזמין');
    const openings = data.transactions.filter((tx) => !tx.voided && tx.input.kind === 'opening' && tx.input.accountId === item.id);
    invariant(item.openingKnown ? openings.length === 1 && item.openingDate === openings[0].input.date : openings.length === 0 && item.openingDate === null, 'יתרת הפתיחה אינה תואמת לרישומים');
  }
  for (const item of data.paymentMethods) invariant(accounts.has(item.accountId) && ['bank', 'cash', 'savings', 'credit_card'].includes(accounts.get(item.accountId)!.kind), 'חשבון אמצעי התשלום אינו תקין');
  invariant(new Set(data.debts.map((item) => item.accountId)).size === data.debts.length, 'לחוב יש יותר מרשומת פרטים אחת');
  for (const item of data.debts) invariant(accounts.has(item.accountId) && ['loan', 'credit_card'].includes(accounts.get(item.accountId)!.kind), 'פרטי חוב חייבים להשתייך לחשבון התחייבות');
  function checkSchedule(item: { accountId: string | null; liabilityAccountId: string | null; categoryId: string | null }): void {
    invariant(!item.accountId || accounts.has(item.accountId), 'חשבון התשלום הצפוי חסר');
    if (item.accountId) invariant(accounts.get(item.accountId)!.kind !== 'asset' && accounts.get(item.accountId)!.kind !== 'loan', 'חשבון מימון תשלום אינו תקין');
    invariant(!item.liabilityAccountId || (accounts.has(item.liabilityAccountId) && ['loan', 'credit_card'].includes(accounts.get(item.liabilityAccountId)!.kind)), 'חשבון החוב של התשלום חסר');
    invariant(!item.liabilityAccountId || !item.accountId || ['bank', 'cash', 'savings'].includes(accounts.get(item.accountId)!.kind), 'תשלום חוב דורש חשבון כסף');
    invariant(!item.categoryId || categories.get(item.categoryId)?.kind === 'expense', 'קטגוריית תשלום צפוי אינה תקינה');
  }
  for (const item of data.recurrences) {
    checkSchedule(item);
    invariant(!item.endDate || item.endDate >= item.startDate, 'מועד סיום התשלום הקבוע קודם להתחלה');
  }
  const occurrences = new Set<string>();
  for (const item of data.obligations) {
    checkSchedule(item);
    invariant(!item.recurrenceId || recurrences.has(item.recurrenceId), 'התשלום הקבוע של המופע חסר');
    if (item.recurrenceId) {
      const key = `${item.recurrenceId}:${item.dueDate}`;
      invariant(!occurrences.has(key), 'מופע חודשי כפול');
      occurrences.add(key);
    }
  }
  for (const tx of data.transactions) {
    invariant(accounts.has(tx.input.accountId), 'חשבון התנועה חסר');
    invariant(!tx.input.toAccountId || accounts.has(tx.input.toAccountId), 'חשבון היעד חסר');
    invariant(!tx.input.categoryId || categories.has(tx.input.categoryId), 'קטגוריית התנועה חסרה');
    invariant(!tx.input.paymentMethodId || methods.get(tx.input.paymentMethodId)?.accountId === tx.input.accountId, 'אמצעי תשלום התנועה חסר או שייך לחשבון אחר');
    invariant(!tx.input.obligationId || obligations.has(tx.input.obligationId), 'ההתחייבות של התנועה חסרה');
    invariant(!tx.input.originalTransactionId || transactions.has(tx.input.originalTransactionId), 'תנועת המקור חסרה');
    invariant(Date.parse(tx.updatedAt) >= Date.parse(tx.createdAt), 'סדר זמני התנועה אינו תקין');
    for (const line of tx.postings) invariant(accounts.has(line.accountId) || systemIds.has(line.accountId), 'חשבון רישום חסר');
    validateTransactionSemantics(tx, data);
  }
  const byTransaction = new Map<string, typeof data.allocations>();
  const byObligation = new Map<string, typeof data.allocations>();
  for (const allocation of data.allocations) {
    const tx = transactions.get(allocation.transactionId);
    invariant(tx && !tx.voided && ['expense', 'repayment'].includes(tx.input.kind), 'שיוך תשלום מצביע על תנועה שאינה פעילה');
    invariant(obligations.has(allocation.obligationId) && tx.input.obligationId === allocation.obligationId, 'שיוך התשלום אינו תואם לתנועה');
    byTransaction.set(tx.id, [...(byTransaction.get(tx.id) ?? []), allocation]);
    byObligation.set(allocation.obligationId, [...(byObligation.get(allocation.obligationId) ?? []), allocation]);
  }
  for (const tx of data.transactions) {
    const allocations = byTransaction.get(tx.id) ?? [];
    if (!tx.voided && tx.input.obligationId) invariant(allocations.length === 1 && allocations[0].amountMinor === tx.input.amountMinor, 'התשלום חייב להיות משויך במלואו להתחייבות');
    else invariant(allocations.length === 0, 'שיוך תשלום אינו צפוי');
  }
  for (const obligation of data.obligations) {
    const paid = sumMoney((byObligation.get(obligation.id) ?? []).map((allocation) => allocation.amountMinor));
    invariant(obligation.expectedMinor === null || paid <= minor(obligation.expectedMinor), 'סך התשלומים גבוה מסכום ההתחייבות');
  }
  validateBalanceHistory(data);
  return data;
}

export function validateBackup(value: unknown): Backup {
  jsonValue(value);
  const parsed = backupSchema.safeParse(value);
  invariant(parsed.success, 'קובץ הגיבוי או גרסתו אינם נתמכים');
  return { ...parsed.data, data: validateDataset(parsed.data.data) } as Backup;
}
export function parseBackup(serialized: string): Backup {
  invariant(typeof serialized === 'string' && serialized.length <= 50_000_000, 'קובץ הגיבוי גדול מדי או אינו תקין');
  let parsed: unknown;
  try { parsed = JSON.parse(serialized); } catch { throw new Error('קובץ הגיבוי אינו JSON תקין'); }
  return validateBackup(parsed);
}
export function createBackup(dataset: Dataset): Backup {
  return validateBackup({ format: 'lova-money-os', schemaVersion: 1, exportedAt: new Date().toISOString(), data: dataset });
}
export function serializeBackup(dataset: Dataset): string { return JSON.stringify(createBackup(dataset), null, 2); }
