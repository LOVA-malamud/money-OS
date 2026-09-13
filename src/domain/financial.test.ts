import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { absMoney, addMoney, formatMoney, formatMoneyInput, MAX_MINOR, MIN_MINOR, minor, parseMoney, subtractMoney, sumMoney, toMinor } from './money';
import { anchoredMonthlyDate, isValidDate, monthEnd, monthStart, todayJerusalem } from './dates';
import { buildPostings, signedBalance } from './ledger';
import { accountBalance, dashboard, debtBalance, obligationStatus } from './reports';
import { createBackup, parseBackup, serializeBackup, validateBackup } from './backup';
import type { Account, Dataset, FinancialEntryInput, Obligation, Transaction } from './types';

const uuid = (value: number) => `10000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;
const ids = { bank: uuid(1), savings: uuid(2), card: uuid(3), loan: uuid(4), asset: uuid(5), food: uuid(6), income: uuid(7), fees: uuid(8), obligation: uuid(9) };
const stamp = '2026-09-13T09:00:00.000Z';
beforeAll(() => { vi.useFakeTimers(); vi.setSystemTime(new Date(stamp)); });
afterAll(() => { vi.useRealTimers(); });

function record(data: Dataset, input: FinancialEntryInput, id?: string): Transaction {
  let candidate = 100;
  while (!id && data.transactions.some((tx) => tx.id === uuid(candidate))) candidate++;
  id ??= uuid(candidate);
  const tx = { id, input, postings: buildPostings(input, data), voided: false, revision: 1, createdAt: stamp, updatedAt: stamp };
  data.transactions.push(tx);
  if (input.kind === 'opening') {
    const account = data.accounts.find((item) => item.id === input.accountId)!;
    account.openingKnown = true; account.openingDate = input.date;
  }
  if (input.obligationId) data.allocations.push({ id: uuid(500 + data.allocations.length), transactionId: id, obligationId: input.obligationId, amountMinor: input.amountMinor });
  return tx;
}
function fixture(): Dataset {
  const account = (id: string, name: string, kind: Account['kind'], spendable = false): Account => ({ id, name, kind, spendable, openingKnown: false, openingDate: null, archived: false, revision: 1 });
  const data: Dataset = {
    schemaVersion: 1, generation: uuid(999), settings: { currency: 'ILS', timezone: 'Asia/Jerusalem', trackingStart: '2026-09-01', accountsReviewed: true, debtsReviewed: true, obligationsReviewed: true, assetsReviewed: true, lastPaymentMethodId: null, recentCategoryIds: [], revision: 1 },
    accounts: [account(ids.bank, 'בנק', 'bank', true), account(ids.savings, 'חיסכון', 'savings'), account(ids.card, 'כרטיס', 'credit_card'), account(ids.loan, 'הלוואה', 'loan'), account(ids.asset, 'נכס', 'asset')],
    categories: [{ id: ids.food, name: 'מזון', kind: 'expense', pinned: true, icon: 'food', revision: 1 }, { id: ids.income, name: 'משכורת', kind: 'income', pinned: true, icon: 'income', revision: 1 }, { id: ids.fees, name: 'מימון', kind: 'expense', pinned: false, icon: 'fee', revision: 1 }],
    paymentMethods: [], debts: [{ id: uuid(20), accountId: ids.loan, creditor: 'משפחה', originalMinor: '30000', note: '', revision: 1 }], transactions: [], obligations: [], recurrences: [], allocations: [], audit: [], operations: [],
  };
  for (const [accountId, amountMinor] of [[ids.bank, '100000'], [ids.savings, '50000'], [ids.card, '0'], [ids.loan, '-30000'], [ids.asset, '200000']]) record(data, { kind: 'opening', accountId, amountMinor, date: '2026-09-01' });
  return data;
}
function bill(data: Dataset, changes: Partial<Obligation> = {}): Obligation {
  const result: Obligation = { id: ids.obligation, title: 'אינטרנט', dueDate: '2026-09-20', expectedMinor: '10000', accountId: ids.bank, liabilityAccountId: null, categoryId: ids.food, recurrenceId: null, cancelled: false, revision: 1, ...changes };
  data.obligations.push(result); return result;
}
const expense = (amountMinor = '1290'): FinancialEntryInput => ({ kind: 'expense', amountMinor, accountId: ids.bank, categoryId: ids.food, date: '2026-09-10' });

describe('integer money boundary', () => {
  it('parses exact agorot without floating point, including large supported values', () => {
    expect(parseMoney('₪12.90')).toBe(1290n);
    expect(parseMoney('1,234,567.89')).toBe(123456789n);
    expect(parseMoney('-0.01')).toBe(-1n);
    expect(parseMoney('92233720368547758.07')).toBe(MAX_MINOR);
    expect(parseMoney('-92233720368547758.08')).toBe(MIN_MINOR);
  });
  it.each(['1.001', '1e3', '1,23', '', '.5', 'NaN', '₪', '12.9.0', '92233720368547758.08'])('rejects malformed or overflowing user value %s', (value) => expect(() => parseMoney(value)).toThrow());
  it('validates serialized integers and arithmetic overflow', () => {
    for (const value of ['01', '-0', '1.0', ' 1', '+1', 'Infinity']) expect(() => minor(value)).toThrow();
    expect(() => addMoney(MAX_MINOR, 1n)).toThrow();
    expect(() => subtractMoney(MIN_MINOR, 1n)).toThrow();
    expect(sumMoney([MAX_MINOR, -MAX_MINOR, '1290'])).toBe(1290n);
    expect(subtractMoney('500', '100', 200n)).toBe(200n);
  });
  it('formats huge integers exactly, independently of Number precision', () => {
    expect(formatMoney(MAX_MINOR)).toBe('₪92,233,720,368,547,758.07');
    expect(formatMoney(MIN_MINOR)).toBe('−₪92,233,720,368,547,758.08');
    expect(formatMoneyInput(-1290n)).toBe('-12.90');
    expect(toMinor(parseMoney(formatMoneyInput(MAX_MINOR)))).toBe(MAX_MINOR.toString());
    expect(absMoney('-1290')).toBe(1290n);
  });
});

describe('civil calendar dates', () => {
  it('retains the monthly anchor through short months and leap years', () => {
    expect(anchoredMonthlyDate('2026-01-31', '2026-02')).toBe('2026-02-28');
    expect(anchoredMonthlyDate('2026-01-31', '2026-03')).toBe('2026-03-31');
    expect(anchoredMonthlyDate('2024-01-31', '2024-02')).toBe('2024-02-29');
    expect(monthStart('2026-12-31')).toBe('2026-12-01');
    expect(monthEnd('2100-02-10')).toBe('2100-02-28');
    expect(isValidDate('2026-02-29')).toBe(false);
    expect(isValidDate('2024-02-29')).toBe(true);
  });
  it('uses the Jerusalem date across a UTC day boundary', () => {
    expect(todayJerusalem(new Date('2026-09-12T22:00:00Z'))).toBe('2026-09-13');
  });
});

describe('balanced financial semantics', () => {
  it('records purchases and income while excluding openings from reporting', () => {
    const data = fixture();
    record(data, expense());
    record(data, { kind: 'income', amountMinor: '50000', accountId: ids.bank, categoryId: ids.income, date: '2026-09-10' });
    const summary = dashboard(data);
    expect(summary.spending.amountMinor).toBe('1290');
    expect(summary.income.amountMinor).toBe('50000');
    expect(summary.available.amountMinor).toBe('148710');
    expect(summary.netWorth.amountMinor).toBe('368710');
  });
  it('treats borrowing as liability and principal repayments as cash movement, only financing costs as spending', () => {
    const data = fixture();
    record(data, { kind: 'borrowing', amountMinor: '50000', accountId: ids.bank, toAccountId: ids.loan, date: '2026-09-10' });
    const before = dashboard(data);
    expect(before.income.amountMinor).toBe('0');
    expect(before.netWorth.amountMinor).toBe('320000');
    record(data, { kind: 'repayment', amountMinor: '10000', principalMinor: '9000', interestMinor: '800', feeMinor: '200', accountId: ids.bank, toAccountId: ids.loan, categoryId: ids.fees, date: '2026-09-11' });
    const after = dashboard(data);
    expect(after.debt.amountMinor).toBe('71000');
    expect(after.spending.amountMinor).toBe('1000');
    expect(after.netWorth.amountMinor).toBe('319000');
    expect(after.cashMovement.amountMinor).toBe('40000');
  });
  it('does not count an internal transfer as income or spending, including a transfer to excluded savings', () => {
    const data = fixture();
    record(data, { kind: 'transfer', accountId: ids.bank, toAccountId: ids.savings, amountMinor: '50000', date: '2026-09-10' });
    const summary = dashboard(data);
    expect(summary.available.amountMinor).toBe('50000');
    expect(summary.income.amountMinor).toBe('0');
    expect(summary.spending.amountMinor).toBe('0');
    expect(summary.cashMovement.amountMinor).toBe('0');
    expect(summary.netWorth.amountMinor).toBe('320000');
  });
  it('recognizes full credit purchases once and excludes their subsequent settlement from spending', () => {
    const data = fixture();
    record(data, { ...expense('12000'), accountId: ids.card });
    expect(dashboard(data).available.amountMinor).toBe('100000');
    expect(dashboard(data).debt.amountMinor).toBe('42000');
    record(data, { kind: 'repayment', accountId: ids.bank, toAccountId: ids.card, amountMinor: '3000', principalMinor: '3000', date: '2026-09-11' });
    expect(dashboard(data).spending.amountMinor).toBe('12000');
    expect(dashboard(data).debt.amountMinor).toBe('39000');
  });
  it('enforces repayment splits and caps known loan principal without treating card credits as impossible', () => {
    const data = fixture();
    const input: FinancialEntryInput = { kind: 'repayment', amountMinor: '40000', accountId: ids.bank, toAccountId: ids.loan, date: '2026-09-10' };
    expect(() => buildPostings(input, data)).toThrow();
    expect(() => buildPostings({ ...input, principalMinor: '39000' }, data)).toThrow();
    expect(() => buildPostings({ ...input, principalMinor: '40000' }, data)).toThrow();
    expect(() => buildPostings({ ...input, toAccountId: ids.card, principalMinor: '40000' }, data)).not.toThrow();
  });
  it('reverses original expenses for refunds and prevents unrelated or excessive cumulative refunds', () => {
    const data = fixture();
    const original = record(data, expense('1000'));
    const refund: FinancialEntryInput = { kind: 'refund', accountId: ids.bank, categoryId: ids.food, originalTransactionId: original.id, amountMinor: '400', date: '2026-09-11' };
    record(data, refund);
    expect(dashboard(data).spending.amountMinor).toBe('600');
    expect(dashboard(data).income.amountMinor).toBe('0');
    expect(() => buildPostings({ ...refund, amountMinor: '601' }, data)).toThrow();
    expect(() => buildPostings({ ...refund, accountId: ids.savings }, data)).toThrow();
    expect(() => buildPostings({ ...refund, categoryId: ids.fees }, data)).toThrow();
    expect(() => buildPostings({ ...refund, date: '2026-09-09' }, data)).toThrow();
  });
  it('keeps valuations and reconciliation out of ordinary spending and cash movement', () => {
    const data = fixture();
    record(data, { kind: 'valuation', accountId: ids.asset, amountMinor: '250000', date: '2026-09-10' });
    record(data, { kind: 'reconcile', accountId: ids.bank, amountMinor: '110000', date: '2026-09-10' });
    const summary = dashboard(data);
    expect(summary.netWorth.amountMinor).toBe('380000');
    expect(summary.spending.amountMinor).toBe('0');
    expect(summary.income.amountMinor).toBe('0');
    expect(summary.cashMovement.amountMinor).toBe('0');
  });
  it('allows purchases of tracked assets but never a negative known asset value', () => {
    const data = fixture();
    record(data, { kind: 'transfer', accountId: ids.bank, toAccountId: ids.asset, amountMinor: '10000', date: '2026-09-10' });
    expect(accountBalance(ids.asset, data).amountMinor).toBe('210000');
    expect(dashboard(data).spending.amountMinor).toBe('0');
    expect(dashboard(data).netWorth.amountMinor).toBe('320000');
    expect(() => buildPostings({ kind: 'transfer', accountId: ids.asset, toAccountId: ids.bank, amountMinor: '210001', date: '2026-09-11' }, data)).toThrow();
    expect(() => buildPostings({ kind: 'valuation', accountId: ids.asset, amountMinor: '-1', date: '2026-09-11' }, data)).toThrow();
  });
  it('rejects a backdated asset change that makes a later fixed adjustment produce a negative value', () => {
    const data = fixture();
    record(data, { kind: 'valuation', accountId: ids.asset, amountMinor: '100000', date: '2026-09-12' });
    expect(() => buildPostings({ kind: 'transfer', accountId: ids.asset, toAccountId: ids.bank, amountMinor: '150000', date: '2026-09-11' }, data)).toThrow();
  });
  it('rejects future actual entries, same-account transfers and misplaced payment methods', () => {
    const data = fixture();
    expect(() => buildPostings({ ...expense(), date: '2026-09-14' }, data)).toThrow();
    expect(() => buildPostings({ kind: 'transfer', date: '2026-09-10', accountId: ids.bank, toAccountId: ids.bank, amountMinor: '500' }, data)).toThrow();
    data.paymentMethods.push({ id: uuid(80), name: 'דביט', accountId: ids.savings, suffix: '1234', revision: 1 });
    expect(() => buildPostings({ ...expense(), paymentMethodId: uuid(80) }, data)).toThrow();
  });
  it('edits an opening target with the original excluded while retaining known-opening metadata', () => {
    const data = fixture(); record(data, { ...expense('1000'), date: '2026-09-01' });
    const opening = data.transactions.find((tx) => tx.input.kind === 'opening' && tx.input.accountId === ids.bank)!;
    const input = { ...opening.input, amountMinor: '120000' };
    const base = { ...data, transactions: data.transactions.filter((tx) => tx.id !== opening.id) };
    opening.postings = buildPostings(input, base); opening.input = input;
    expect(data.accounts[0].openingKnown).toBe(true);
    expect(accountBalance(ids.bank, data).amountMinor).toBe('120000');
    expect(dashboard(data).spending.amountMinor).toBe('1000');
    expect(() => createBackup(data)).not.toThrow();
  });
  it('edits a reconciliation target without counting the original adjustment twice', () => {
    const data = fixture(); record(data, { ...expense('1000'), date: '2026-09-02' });
    const reconcile = record(data, { kind: 'reconcile', accountId: ids.bank, amountMinor: '100000', date: '2026-09-03' });
    const input = { ...reconcile.input, amountMinor: '90000' };
    reconcile.postings = buildPostings(input, { ...data, transactions: data.transactions.filter((tx) => tx.id !== reconcile.id) }); reconcile.input = input;
    expect(accountBalance(ids.bank, data).amountMinor).toBe('90000');
    expect(dashboard(data).spending.amountMinor).toBe('1000');
    expect(dashboard(data).cashMovement.amountMinor).toBe('-1000');
  });
});

describe('obligations and completeness', () => {
  it('exposes the exact spendable-account deductions separately from all unpaid cash obligations', () => {
    const data = fixture(); const included = bill(data, { expectedMinor: '10000' });
    record(data, { ...expense('3000'), obligationId: included.id });
    bill(data, { id: uuid(10), accountId: ids.savings, expectedMinor: '5000' });
    bill(data, { id: uuid(11), accountId: ids.card, expectedMinor: '2000' });
    const settlement = bill(data, { id: uuid(12), liabilityAccountId: ids.card, categoryId: null, expectedMinor: '2000' });
    bill(data, { id: uuid(13), dueDate: '2026-10-01', expectedMinor: '90000' });
    const summary = dashboard(data);
    expect(summary.unpaid.amountMinor).toBe('14000');
    expect(summary.remainingObligations.amountMinor).toBe('9000');
    expect(summary.remainingObligationItems.map((item) => item.obligation.id)).toEqual([included.id, settlement.id]);
    expect(summary.available.amountMinor).toBe('97000');
    expect(summary.remaining.amountMinor).toBe('88000');
  });
  it('propagates unknown deduction amounts, funding and coverage while retaining genuine zero', () => {
    const data = fixture();
    expect(dashboard(data).remainingObligations.amountMinor).toBe('0');
    expect(dashboard(data).remainingObligationItems).toEqual([]);
    const obligation = bill(data, { expectedMinor: null });
    expect(dashboard(data).remainingObligations.amountMinor).toBeNull();
    obligation.expectedMinor = '1000'; obligation.accountId = null;
    expect(dashboard(data).remainingObligations.status).toBe('incomplete');
    expect(dashboard(data).remainingObligationItems).toHaveLength(1);
    obligation.accountId = ids.bank; data.settings.accountsReviewed = false;
    expect(dashboard(data).remainingObligations.status).toBe('incomplete');
    data.settings.accountsReviewed = true; data.settings.obligationsReviewed = false;
    expect(dashboard(data).remainingObligations.status).toBe('incomplete');
    data.settings.obligationsReviewed = true;
    expect(dashboard(data).remainingObligations.amountMinor).toBe('1000');
  });
  it('preserves a known deduction subtotal when only the cash opening is unknown, while the result remains incomplete', () => {
    const data = fixture(); bill(data);
    data.accounts[0].openingKnown = false; data.accounts[0].openingDate = null;
    data.transactions = data.transactions.filter((tx) => tx.input.accountId !== ids.bank);
    const summary = dashboard(data);
    expect(summary.available.amountMinor).toBeNull();
    expect(summary.remainingObligations.amountMinor).toBe('10000');
    expect(summary.remaining.amountMinor).toBeNull();
  });
  it('reserves only the unpaid remainder, and undoing a payment restores the obligation', () => {
    const data = fixture(); const obligation = bill(data);
    const payment = record(data, { ...expense('3000'), obligationId: obligation.id });
    expect(obligationStatus(obligation, data).remainingMinor).toBe('7000');
    expect(dashboard(data).remaining.amountMinor).toBe('90000');
    expect(dashboard(data).paidThisMonthMinor).toBe('3000');
    payment.voided = true; data.allocations = [];
    expect(obligationStatus(obligation, data).remainingMinor).toBe('10000');
    expect(dashboard(data).available.amountMinor).toBe('100000');
    expect(dashboard(data).remaining.amountMinor).toBe('90000');
  });
  it('includes overdue obligations and excludes future months from this horizon', () => {
    const data = fixture(); bill(data, { dueDate: '2026-08-20' });
    bill(data, { id: uuid(10), dueDate: '2026-10-01', expectedMinor: '90000' });
    expect(dashboard(data).unpaid.amountMinor).toBe('10000');
    expect(dashboard(data).dueThisMonth.amountMinor).toBe('0');
    expect(dashboard(data).upcoming[0].status).toBe('overdue');
  });
  it('reports the paid portion of this month’s bills, excluding payments of overdue and future bills', () => {
    const data = fixture();
    for (const account of data.accounts) account.openingDate = '2026-08-01';
    for (const tx of data.transactions) tx.input.date = '2026-08-01';
    const current = bill(data);
    const overdue = bill(data, { id: uuid(10), dueDate: '2026-08-15', expectedMinor: '5000' });
    const future = bill(data, { id: uuid(11), dueDate: '2026-10-01' });
    record(data, { ...expense('2000'), date: '2026-08-20', obligationId: current.id });
    record(data, { ...expense('4000'), obligationId: overdue.id });
    record(data, { ...expense('5000'), date: '2026-09-11', obligationId: future.id });
    const summary = dashboard(data);
    expect(summary.dueThisMonth.amountMinor).toBe('10000');
    expect(summary.paidThisMonth.amountMinor).toBe('2000');
    expect(summary.paidThisMonthMinor).toBe('2000');
    expect(summary.unpaid.amountMinor).toBe('9000');
    data.settings.obligationsReviewed = false;
    expect(dashboard(data).paidThisMonth.amountMinor).toBeNull();
    expect(dashboard(data).paidThisMonth.status).toBe('incomplete');
  });
  it('does not reserve card subscriptions and their cash settlement twice', () => {
    const data = fixture(); bill(data, { accountId: ids.card, title: 'מנוי' });
    bill(data, { id: uuid(10), title: 'חיוב כרטיס', expectedMinor: '10000', liabilityAccountId: ids.card, categoryId: null });
    expect(dashboard(data).unpaid.amountMinor).toBe('10000');
    expect(dashboard(data).remaining.amountMinor).toBe('90000');
  });
  it('never transforms an unknown opening into an account balance or complete net worth', () => {
    const data = fixture(); data.accounts[0].openingKnown = false; data.accounts[0].openingDate = null;
    data.transactions = data.transactions.filter((tx) => tx.input.accountId !== ids.bank);
    record(data, expense('1000'));
    expect(accountBalance(ids.bank, data).status).toBe('unknown');
    expect(dashboard(data).available.amountMinor).toBeNull();
    expect(dashboard(data).netWorth.status).toBe('incomplete');
    expect(dashboard(data).debt.status).toBe('incomplete');
  });
  it('distinguishes unknown expected payments from explicitly confirmed zero', () => {
    const data = fixture(); const obligation = bill(data, { expectedMinor: null });
    expect(dashboard(data).remaining.amountMinor).toBeNull();
    expect(dashboard(data).unpaid.status).toBe('incomplete');
    obligation.expectedMinor = '0';
    expect(dashboard(data).remaining.amountMinor).toBe('100000');
    expect(dashboard(data).unpaid.amountMinor).toBe('0');
  });
  it('propagates missing payment funding, incomplete coverage, and partial-month reporting', () => {
    const data = fixture(); bill(data, { accountId: null });
    expect(dashboard(data).remaining.status).toBe('incomplete');
    data.obligations = []; data.settings.obligationsReviewed = false;
    expect(dashboard(data).unpaid.status).toBe('incomplete');
    data.settings.trackingStart = '2026-09-05';
    expect(dashboard(data).income.status).toBe('incomplete');
    expect(dashboard(data).spending.status).toBe('incomplete');
    expect(dashboard(data).cashMovement.status).toBe('incomplete');
  });
  it('requires card settlement timing without reserving all future card debt', () => {
    const data = fixture(); record(data, { ...expense('12000'), accountId: ids.card });
    expect(dashboard(data).remaining.status).toBe('incomplete');
    expect(dashboard(data).dueThisMonth.status).toBe('incomplete');
    expect(dashboard(data).unpaid.status).toBe('incomplete');
    expect(dashboard(data).remainingObligations.status).toBe('incomplete');
    bill(data, { dueDate: '2026-10-01', expectedMinor: '1000', liabilityAccountId: ids.card, categoryId: null });
    expect(dashboard(data).remaining.amountMinor).toBe('100000');
  });
  it('keeps an explicitly dated overdue card payment reserved without inventing another missing bill', () => {
    const data = fixture(); record(data, { ...expense('12000'), accountId: ids.card });
    bill(data, { dueDate: '2026-09-12', expectedMinor: '12000', liabilityAccountId: ids.card, categoryId: null });
    expect(dashboard(data).remaining.amountMinor).toBe('88000');
    expect(dashboard(data).unpaid.amountMinor).toBe('12000');
    expect(dashboard(data).upcoming[0].status).toBe('overdue');
  });
  it('classifies an overdraft as liability exactly once and retains archived account values', () => {
    const data = fixture(); record(data, { kind: 'reconcile', accountId: ids.bank, amountMinor: '-30000', date: '2026-09-10' });
    data.accounts[1].archived = true;
    expect(dashboard(data).assets.amountMinor).toBe('250000');
    expect(dashboard(data).debt.amountMinor).toBe('60000');
    expect(dashboard(data).netWorth.amountMinor).toBe('190000');
  });
  it('treats a positive card credit as an asset rather than negative debt', () => {
    const data = fixture(); record(data, { kind: 'reconcile', accountId: ids.card, amountMinor: '5000', date: '2026-09-10' });
    expect(dashboard(data).assets.amountMinor).toBe('355000');
    expect(dashboard(data).debt.amountMinor).toBe('30000');
    expect(dashboard(data).available.amountMinor).toBe('100000');
  });
  it('centralizes displayed debt for loans, card credits, overdrafts, and unknown openings', () => {
    const data = fixture();
    expect(debtBalance(ids.loan, data).amountMinor).toBe('30000');
    record(data, { kind: 'reconcile', accountId: ids.card, amountMinor: '5000', date: '2026-09-10' });
    expect(debtBalance(ids.card, data).amountMinor).toBe('0');
    record(data, { kind: 'reconcile', accountId: ids.bank, amountMinor: '-500', date: '2026-09-10' });
    expect(debtBalance(ids.bank, data).amountMinor).toBe('500');
    data.accounts.find((account) => account.id === ids.loan)!.openingKnown = false;
    expect(debtBalance(ids.loan, data).amountMinor).toBeNull();
  });
});

describe('independent backup validation', () => {
  it('preserves a server snapshot token and accepts older backups that lack one', () => {
    const original = createBackup(fixture());
    expect(() => validateBackup(original)).not.toThrow();
    const guarded = { ...original, data: { ...original.data, snapshotToken: 'a'.repeat(64) } };
    const restored = validateBackup(guarded);
    expect((restored.data as Dataset & { snapshotToken?: string }).snapshotToken).toBe('a'.repeat(64));
    expect(JSON.parse(serializeBackup(restored.data)).data.snapshotToken).toBe('a'.repeat(64));
    for (const token of ['A'.repeat(64), 'a'.repeat(63), 'g'.repeat(64)]) {
      expect(() => validateBackup({ ...guarded, data: { ...guarded.data, snapshotToken: token } })).toThrow();
    }
  });
  it('round-trips exact balances, zero, coverage flags and complete ledger', () => {
    const data = fixture(); data.settings.obligationsReviewed = false; record(data, expense());
    const result = parseBackup(serializeBackup(data));
    expect(result.data).toEqual(data);
    expect(result.data.settings.obligationsReviewed).toBe(false);
    expect(signedBalance(result.data, ids.bank)).toBe(98710n);
  });
  it('rejects wrong schema, duplicate ids, broken references and unsafe monetary representations', () => {
    const data = fixture();
    expect(() => validateBackup({ ...createBackup(data), schemaVersion: 2 })).toThrow();
    data.accounts.push({ ...data.accounts[0] });
    expect(() => createBackup(data)).toThrow();
    const broken = fixture(); record(broken, expense()); broken.transactions.at(-1)!.input.accountId = uuid(987);
    expect(() => createBackup(broken)).toThrow();
    const unsafe = fixture(); unsafe.transactions[0].postings[0].amountMinor = '1.1';
    expect(() => createBackup(unsafe)).toThrow();
  });
  it('rejects balanced-but-false postings rather than checking only the zero sum', () => {
    const data = fixture(); const tx = record(data, expense('1000'));
    tx.postings = [{ accountId: ids.bank, amountMinor: '-1000' }, { accountId: '@income', amountMinor: '1000' }];
    expect(() => createBackup(data)).toThrow();
  });
  it('rejects fabricated opening metadata and invalid payment allocations', () => {
    const data = fixture(); data.accounts[0].openingDate = '2026-09-02';
    expect(() => createBackup(data)).toThrow();
    const linked = fixture(); const obligation = bill(linked); record(linked, { ...expense('3000'), obligationId: obligation.id });
    expect(() => createBackup(linked)).not.toThrow();
    linked.allocations[0].amountMinor = '2999';
    expect(() => createBackup(linked)).toThrow();
    linked.allocations[0].amountMinor = '3000'; linked.transactions.at(-1)!.voided = true;
    expect(() => createBackup(linked)).toThrow();
  });
  it('allows unknown openings with unanchored movements but preserves their incompleteness', () => {
    const data = fixture(); data.accounts[0].openingKnown = false; data.accounts[0].openingDate = null;
    data.transactions = data.transactions.filter((tx) => tx.input.accountId !== ids.bank); record(data, expense());
    expect(parseBackup(serializeBackup(data)).data.accounts[0].openingKnown).toBe(false);
  });
  it('preserves historical adjustment postings after a backdated expense edit', () => {
    const data = fixture(); const tx = record(data, { ...expense('1000'), date: '2026-09-02' });
    record(data, { kind: 'reconcile', accountId: ids.bank, amountMinor: '100000', date: '2026-09-03' });
    tx.input.amountMinor = '2000'; tx.postings = buildPostings(tx.input, { ...data, transactions: data.transactions.filter((item) => item.id !== tx.id) }); tx.revision++;
    expect(signedBalance(data, ids.bank)).toBe(99000n);
    expect(() => createBackup(data)).not.toThrow();
  });
  it('rejects cumulative refund excess and unsupported financial transaction revisions', () => {
    const data = fixture(); const original = record(data, expense('1000'));
    record(data, { kind: 'refund', accountId: ids.bank, categoryId: ids.food, originalTransactionId: original.id, amountMinor: '600', date: '2026-09-11' });
    const copy = structuredClone(data.transactions.at(-1)!); copy.id = uuid(800); data.transactions.push(copy);
    expect(() => createBackup(data)).toThrow();
    const badRevision = fixture(); badRevision.transactions[0].revision = 0;
    expect(() => createBackup(badRevision)).toThrow();
  });
  it('retains voided linked history when an unpaid obligation is subsequently changed', () => {
    const data = fixture(); const obligation = bill(data); const payment = record(data, { ...expense(), obligationId: obligation.id });
    payment.voided = true; data.allocations = []; obligation.accountId = ids.savings; obligation.categoryId = ids.fees;
    expect(() => createBackup(data)).not.toThrow();
  });
  it('rejects balanced transfers that create impossible asset history in an imported backup', () => {
    const data = fixture(); const tx = record(data, { kind: 'transfer', accountId: ids.asset, toAccountId: ids.bank, amountMinor: '1000', date: '2026-09-10' });
    tx.input.amountMinor = '200001'; tx.postings = [{ accountId: ids.asset, amountMinor: '-200001' }, { accountId: ids.bank, amountMinor: '200001' }];
    expect(() => createBackup(data)).toThrow();
  });
});
