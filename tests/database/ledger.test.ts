import { beforeAll, afterAll, beforeEach, expect, test } from 'vitest';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { Account, FinancialEntryInput } from '../../src/domain/types';
import { createBackup, validateDataset } from '../../src/domain/backup';
import { buildPostings } from '../../src/domain/ledger';
import { createDatabase, asUser, dataset, execute, resetDataset, OTHER_ID } from './harness';

let db: PGlite;
beforeAll(async () => { db = await createDatabase(); }, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await resetDataset(db); });
const date = '2026-09-01';
async function account(kind: Account['kind'] = 'bank', opening?: string) {
  const id = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'account', value: { id, name: kind, kind, spendable: kind === 'bank' || kind === 'cash', openingKnown: false, openingDate: null, archived: false, revision: 1 } });
  if (opening !== undefined) await record({ kind: 'opening', accountId: id, amountMinor: opening, date });
  return id;
}
async function category(kind: 'income' | 'expense' = 'expense') {
  const id = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'category', value: { id, name: kind, kind, pinned: true, icon: 'circle', revision: 1 } });
  return id;
}
async function record(input: FinancialEntryInput) {
  const id = randomUUID(); const before = await dataset(db); const expected = buildPostings(input, before);
  await execute(db, { type: 'record', id, input });
  const actual = (await dataset(db)).transactions.find(t => t.id === id)!.postings;
  const normalize = (p: typeof actual) => p.map(x => `${x.accountId}:${x.amountMinor}`).sort();
  expect(normalize(actual)).toEqual(normalize(expected)); return id;
}
function balance(d: Awaited<ReturnType<typeof dataset>>, id: string) {
  return d.transactions.filter(t => !t.voided).flatMap(t => t.postings).filter(p => p.accountId === id).reduce((sum, p) => sum + BigInt(p.amountMinor), 0n);
}

test('actual PostgreSQL migration creates private owner-scoped atomic RPCs', async () => {
  expect((await dataset(db)).accounts).toEqual([expect.objectContaining({ kind: 'cash', openingKnown: false })]);
  await expect(db.query("insert into public.money_entities(owner_id,id,kind,body,revision) values ('11111111-1111-4111-8111-111111111111',gen_random_uuid(),'account','{}',1)")).rejects.toThrow(/permission denied/);
  await asUser(db, OTHER_ID);
  await expect(dataset(db)).rejects.toThrow(/OWNER_REQUIRED/);
  expect((await db.query('select * from public.money_datasets')).rows).toEqual([]);
  await asUser(db, '', 'anon');
  await expect(dataset(db)).rejects.toThrow(/permission denied/);
});
test('opening, expense, transfer, borrowing and principal/interest are balanced and exact', async () => {
  const cash = await account('bank', '100000'); const savings = await account('savings', '0'); const debt = await account('loan', '0'); const food = await category();
  await record({ kind: 'expense', accountId: cash, amountMinor: '1290', categoryId: food, date });
  await record({ kind: 'transfer', accountId: cash, toAccountId: savings, amountMinor: '5000', date });
  await record({ kind: 'borrowing', accountId: cash, toAccountId: debt, amountMinor: '10000', date });
  await record({ kind: 'repayment', accountId: cash, toAccountId: debt, amountMinor: '2300', principalMinor: '2000', interestMinor: '250', feeMinor: '50', categoryId: food, date });
  const d = await dataset(db);
  expect(validateDataset(d)).toEqual(d);
  expect(balance(d, cash)).toBe(101410n); expect(balance(d, savings)).toBe(5000n); expect(balance(d, debt)).toBe(-8000n);
  expect(balance(d, '@expense')).toBe(1590n); expect(balance(d, '@income')).toBe(0n);
  for (const t of d.transactions) expect(t.postings.reduce((sum, p) => sum + BigInt(p.amountMinor), 0n)).toBe(0n);
});

test('idempotent retry returns the same receipt, payload reuse is rejected, revisions reject stale edits', async () => {
  const bank = await account('bank', '10000'); const food = await category(); const id = randomUUID(); const operationId = randomUUID(); const generation = (await dataset(db)).generation;
  const action = { type: 'record' as const, id, input: { kind: 'expense' as const, accountId: bank, amountMinor: '100', categoryId: food, date } };
  const first = await execute(db, action, { operationId, generation });
  const beforeRetry = await dataset(db);
  expect(await execute(db, action, { operationId, generation })).toEqual(first);
  expect(await dataset(db)).toEqual(beforeRetry);
  await expect(execute(db, { ...action, input: { ...action.input, amountMinor: '200' } }, { operationId, generation })).rejects.toThrow(/OPERATION_ID_REUSED/);
  await execute(db, { type: 'edit', id, input: { ...action.input, amountMinor: '200' }, expectedRevision: 1 });
  await expect(execute(db, { type: 'edit', id, input: action.input, expectedRevision: 1 })).rejects.toThrow(/REVISION_CONFLICT/);
  expect(balance(await dataset(db), bank)).toBe(9800n);
});

test('money stays exact beyond JavaScript number precision; float and malformed integer wire values fail atomically', async () => {
  const bank = await account('bank', '9007199254740993'); const cat = await category();
  await record({ kind: 'expense', accountId: bank, amountMinor: '1290', categoryId: cat, date });
  expect(balance(await dataset(db), bank)).toBe(9007199254739703n);
  for (const amountMinor of ['12.90', '01', '1e4', '9223372036854775808', 1290]) {
    const before = await dataset(db);
    await expect(execute(db, { type: 'record', id: randomUUID(), input: { kind: 'expense', accountId: bank, amountMinor: amountMinor as string, categoryId: cat, date } })).rejects.toThrow();
    expect(await dataset(db)).toEqual(before);
  }
});

test('refunds cap the original expense and protect edits and voids with dependent refunds', async () => {
  const bank = await account('bank', '10000'); const cat = await category();
  const original = await record({ kind: 'expense', accountId: bank, amountMinor: '1000', categoryId: cat, date });
  const refund = await record({ kind: 'refund', accountId: bank, amountMinor: '400', categoryId: cat, originalTransactionId: original, date });
  const before = await dataset(db);
  await expect(execute(db, { type: 'record', id: randomUUID(), input: { kind: 'refund', accountId: bank, amountMinor: '601', categoryId: cat, originalTransactionId: original, date } })).rejects.toThrow(/REFUND_EXCEEDS/);
  await expect(execute(db, { type: 'void', id: original, expectedRevision: 1 })).rejects.toThrow(/ORIGINAL_EXPENSE/);
  await expect(execute(db, { type: 'edit', id: original, expectedRevision: 1, input: { kind: 'expense', accountId: bank, amountMinor: '300', categoryId: cat, date } })).rejects.toThrow(/REFUND_EXCEEDS/);
  expect(await dataset(db)).toEqual(before);
  await execute(db, { type: 'void', id: refund, expectedRevision: 1 });
  await execute(db, { type: 'void', id: original, expectedRevision: 1 });
  expect(balance(await dataset(db), bank)).toBe(10000n);
  validateDataset(await dataset(db));
});

test('partial obligation payments allocate once, cap remaining amount and undo/redo atomically', async () => {
  const bank = await account('bank', '10000'); const cat = await category(); const obligation = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { id: obligation, title: 'Bill', dueDate: date, expectedMinor: '1000', accountId: bank, liabilityAccountId: null, categoryId: cat, recurrenceId: null, cancelled: false, revision: 1 } });
  const first = await record({ kind: 'expense', accountId: bank, categoryId: cat, amountMinor: '400', obligationId: obligation, date });
  await expect(execute(db, { type: 'record', id: randomUUID(), input: { kind: 'expense', accountId: bank, categoryId: cat, amountMinor: '601', obligationId: obligation, date } })).rejects.toThrow(/OBLIGATION_OVERPAYMENT/);
  await record({ kind: 'expense', accountId: bank, categoryId: cat, amountMinor: '600', obligationId: obligation, date });
  expect((await dataset(db)).allocations.reduce((s, a) => s + BigInt(a.amountMinor), 0n)).toBe(1000n);
  await execute(db, { type: 'void', id: first, expectedRevision: 1 });
  expect((await dataset(db)).allocations).toHaveLength(1);
  await execute(db, { type: 'unvoid', id: first, expectedRevision: 2 });
  validateDataset(await dataset(db));
  expect((await dataset(db)).allocations).toHaveLength(2);
});

test('opening metadata cannot be forged and an opening in use cannot be voided', async () => {
  await expect(execute(db, { type: 'save_entity', entity: 'account', value: { id: randomUUID(), name: 'Wrong', kind: 'bank', spendable: true, openingKnown: true, openingDate: date, archived: false, revision: 1 } })).rejects.toThrow(/OPENING_REQUIRES/);
  const bank = await account('bank', '10000'); const cat = await category(); const opening = (await dataset(db)).transactions[0]!;
  await record({ kind: 'expense', accountId: bank, amountMinor: '1000', categoryId: cat, date });
  await expect(execute(db, { type: 'void', id: opening.id, expectedRevision: 1 })).rejects.toThrow(/OPENING_IN_USE/);
});

test('a backdated edit preserves the existing reconciliation posting and its audit history', async () => {
  const bank = await account('bank', '10000'); const cat = await category();
  const expense = await record({ kind: 'expense', accountId: bank, amountMinor: '1000', categoryId: cat, date });
  const reconcile = await record({ kind: 'reconcile', accountId: bank, amountMinor: '8000', date: '2026-09-02' });
  const previous = (await dataset(db)).transactions.find(t => t.id === reconcile)!.postings;
  await execute(db, { type: 'edit', id: expense, expectedRevision: 1, input: { kind: 'expense', accountId: bank, amountMinor: '500', categoryId: cat, date } });
  const after = await dataset(db);
  expect(after.transactions.find(t => t.id === reconcile)!.postings).toEqual(previous);
  expect(balance(after, bank)).toBe(8500n);
  const audit = after.audit.find(a => a.entityId === expense && a.action === 'edit')!.before as { postings: { accountId: string; amountMinor: string }[] };
  expect(audit.postings.find(p => p.accountId === bank)!.amountMinor).toBe('-1000');
  validateDataset(after);
});

test('validated JSON restore round-trips the ledger, changes generation and rejects damaged backup atomically', async () => {
  const bank = await account('bank', '10000'); const cat = await category();
  await record({ kind: 'expense', accountId: bank, amountMinor: '1290', categoryId: cat, date });
  const backup = createBackup(await dataset(db));
  await record({ kind: 'expense', accountId: bank, amountMinor: '2000', categoryId: cat, date });
  const op = randomUUID(); const safety = await dataset(db); const oldGeneration = safety.generation;
  const restore = { type: 'restore' as const, backup, expectedSnapshotToken: safety.snapshotToken! };
  const result = await execute(db, restore, { operationId: op, generation: oldGeneration });
  const restored = await dataset(db);
  validateDataset(restored);
  expect(restored.transactions).toEqual(backup.data.transactions);
  expect(restored.accounts).toEqual(backup.data.accounts);
  expect(restored.generation).not.toBe(oldGeneration);
  expect(await execute(db, restore, { operationId: op, generation: oldGeneration })).toEqual(result);
  await expect(execute(db, { type: 'save_settings', expectedRevision: restored.settings.revision, value: { accountsReviewed: true } }, { generation: oldGeneration })).rejects.toThrow(/DATASET_CHANGED/);
  const corrupt = structuredClone(backup); const tx = corrupt.data.transactions.find(t => t.input.kind === 'expense')!;
  tx.postings[0]!.amountMinor = '-1'; tx.postings[1]!.amountMinor = '1';
  const before = await dataset(db);
  await expect(execute(db, { type: 'restore', backup: corrupt, expectedSnapshotToken: before.snapshotToken! })).rejects.toThrow(/POSTING_SEMANTICS/);
  expect(await dataset(db)).toEqual(before);
});

test('recurrence generation clamps month-end, repeats idempotently and preserves paid/history amounts', async () => {
  const bank = await account('bank', '10000'); const cat = await category(); const rec = randomUUID();
  const months = (await db.query<{ start: string; current: string }>("select (date_trunc('month',now() at time zone 'Asia/Jerusalem')-interval '2 months')::date::text start, date_trunc('month',now() at time zone 'Asia/Jerusalem')::date::text current")).rows[0]!;
  const value = { id: rec, title: 'Monthly', amountMinor: '1000', day: 31, startDate: months.start, endDate: null, accountId: bank, liabilityAccountId: null, categoryId: cat, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value });
  const before = await dataset(db);
  expect(before.obligations).toHaveLength(3);
  expect((await dataset(db)).obligations).toEqual(before.obligations);
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, amountMinor: '2000' }, expectedRevision: 1 });
  const after = await dataset(db);
  expect(after.obligations.filter(o => o.dueDate < months.current).every(o => o.expectedMinor === '1000')).toBe(true);
  expect(after.obligations.filter(o => o.dueDate >= months.current).every(o => o.expectedMinor === '2000')).toBe(true);
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, amountMinor: '2000', day: 1 }, expectedRevision: 2 });
  expect((await dataset(db)).obligations.filter(o => o.dueDate < months.current)).toEqual(after.obligations.filter(o => o.dueDate < months.current));
  validateDataset(await dataset(db));
});

test('cross-owner references cannot be written even with a second allowlisted user', async () => {
  const bank = await account('bank', '10000');
  await db.exec('reset role');
  await db.query('insert into private.app_owner(user_id) values ($1) on conflict do nothing', [OTHER_ID]);
  await asUser(db, OTHER_ID);
  await dataset(db);
  await expect(execute(db, { type: 'record', id: randomUUID(), input: { kind: 'opening', accountId: bank, amountMinor: '100', date } })).rejects.toThrow(/INVALID_REFERENCE/);
  expect((await db.query<{ id: string }>('select * from public.money_entities')).rows.some(row => row.id === bank)).toBe(false);
});

test('transfer fees and credit principal repayment affect spending correctly and remember valid Quick Add defaults', async () => {
  const bank = await account('bank', '10000'); const savings = await account('savings', '0'); const card = await account('credit_card', '-1000'); const fees = await category(); const method = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'paymentMethod', value: { id: method, name: 'Debit', accountId: bank, suffix: '1234', revision: 1 } });
  await record({ kind: 'transfer', accountId: bank, toAccountId: savings, amountMinor: '1000', feeMinor: '25', categoryId: fees, date });
  await record({ kind: 'repayment', accountId: bank, toAccountId: card, amountMinor: '1500', principalMinor: '1500', date });
  await record({ kind: 'expense', accountId: bank, amountMinor: '100', categoryId: fees, paymentMethodId: method, date });
  const d = await dataset(db);
  expect(balance(d, '@expense')).toBe(125n);
  expect(balance(d, card)).toBe(500n);
  expect(d.settings.lastPaymentMethodId).toBe(method);
  expect(d.settings.recentCategoryIds[0]).toBe(fees);
  validateDataset(d);
});

test('known asset and loan timeline signs survive backdated edits; unknown debt remains explicitly unknown', async () => {
  const bank = await account('bank', '10000'); const asset = await account('asset', '1000'); const loan = await account('loan', '-1000');
  await expect(execute(db, { type: 'record', id: randomUUID(), input: { kind: 'transfer', accountId: asset, toAccountId: bank, amountMinor: '1001', date } })).rejects.toThrow(/NEGATIVE_ASSET/);
  await expect(execute(db, { type: 'record', id: randomUUID(), input: { kind: 'repayment', accountId: bank, toAccountId: loan, principalMinor: '1001', amountMinor: '1001', date } })).rejects.toThrow(/LOAN_PRINCIPAL/);
  const unknownLoan = await account('loan');
  await record({ kind: 'repayment', accountId: bank, toAccountId: unknownLoan, principalMinor: '100', amountMinor: '100', date });
  expect((await dataset(db)).accounts.find(a => a.id === unknownLoan)!.openingKnown).toBe(false);
  validateDataset(await dataset(db));
});

test('new card activity invalidates reviewed schedules, linked debt payments preserve reviewed coverage', async () => {
  const bank = await account('bank', '10000'); const card = await account('credit_card', '-1000'); const cat = await category();
  let current = await dataset(db);
  await execute(db, { type: 'save_settings', expectedRevision: current.settings.revision, value: { obligationsReviewed: true } });
  await record({ kind: 'expense', accountId: card, amountMinor: '100', categoryId: cat, date });
  expect((await dataset(db)).settings.obligationsReviewed).toBe(false);
  const bill = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { id: bill, title: 'Card bill', dueDate: date, expectedMinor: '1100', accountId: bank, liabilityAccountId: card, categoryId: null, recurrenceId: null, cancelled: false, revision: 1 } });
  current = await dataset(db);
  await execute(db, { type: 'save_settings', expectedRevision: current.settings.revision, value: { obligationsReviewed: true } });
  const payment = await record({ kind: 'repayment', accountId: bank, toAccountId: card, principalMinor: '1100', amountMinor: '1100', obligationId: bill, date });
  expect((await dataset(db)).settings.obligationsReviewed).toBe(true);
  await execute(db, { type: 'void', id: payment, expectedRevision: 1 });
  expect((await dataset(db)).settings.obligationsReviewed).toBe(true);
});

test('an already-paid recurrence occurrence is preserved when its rule changes amount or day', async () => {
  const bank = await account('bank', '10000'); const cat = await category(); const rec = randomUUID();
  const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today")).rows[0]!.today;
  const value = { id: rec, title: 'Monthly', amountMinor: '1000', day: 31, startDate: `${today.slice(0, 7)}-01`, endDate: null, accountId: bank, liabilityAccountId: null, categoryId: cat, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value });
  const bill = (await dataset(db)).obligations[0]!;
  await record({ kind: 'expense', accountId: bank, amountMinor: '1000', categoryId: cat, obligationId: bill.id, date: today });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, amountMinor: '3000', day: 28 }, expectedRevision: 1 });
  const after = await dataset(db);
  expect(after.obligations).toEqual([bill]);
  validateDataset(after);
});

test('backup cannot omit required settings or smuggle extra fields into persisted records', async () => {
  await account('bank', '10000');
  const backup = createBackup(await dataset(db)); const malformed = structuredClone(backup);
  delete (malformed.data.settings as unknown as Record<string, unknown>).lastPaymentMethodId;
  await expect(execute(db, { type: 'restore', backup: malformed, expectedSnapshotToken: backup.data.snapshotToken! })).rejects.toThrow(/INCOMPLETE_SETTINGS/);
  const acc = backup.data.accounts[0]!;
  await expect(execute(db, { type: 'save_entity', entity: 'account', value: { ...acc, privateSecret: 'do-not-accept' } as Account, expectedRevision: acc.revision })).rejects.toThrow(/INVALID_ENTITY_FIELDS/);
  expect((await dataset(db)).accounts).toEqual(backup.data.accounts);
});

test('UUID references normalize consistently at every JSON boundary', async () => {
  const bank = await account('bank', '10000'); const cat = await category();
  await execute(db, { type: 'record', id: randomUUID().toUpperCase(), input: { kind: 'expense', accountId: bank.toUpperCase(), categoryId: cat.toUpperCase(), amountMinor: '100', date } });
  const data = await dataset(db);
  expect(data.settings.recentCategoryIds[0]).toBe(cat);
  expect(data.transactions.find(t => t.input.kind === 'expense')!.input.accountId).toBe(bank);
  validateDataset(data);
});

test('reactivating a recurrence restores its automatically cancelled future bill but preserves manual cancellation', async () => {
  const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today")).rows[0]!.today;
  const id = randomUUID();
  const value = { id, title: 'Recurring', amountMinor: '1000', day: 31, startDate: `${today.slice(0, 7)}-01`, endDate: null, accountId: null, liabilityAccountId: null, categoryId: null, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, active: false }, expectedRevision: 1 });
  expect((await dataset(db)).obligations[0]!.cancelled).toBe(true);
  await execute(db, { type: 'save_entity', entity: 'recurrence', value, expectedRevision: 2 });
  expect((await dataset(db)).obligations[0]!.cancelled).toBe(false);
  const bill = (await dataset(db)).obligations[0]!;
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { ...bill, cancelled: true }, expectedRevision: bill.revision });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, active: false }, expectedRevision: 3 });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value, expectedRevision: 4 });
  expect((await dataset(db)).obligations[0]!.cancelled).toBe(true);
});

test('moving a recurrence day A to B to A revives its original occurrence', async () => {
  const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today")).rows[0]!.today;
  const id = randomUUID(); const value = { id, title: 'Recurring', amountMinor: '1000', day: 31, startDate: `${today.slice(0, 7)}-01`, endDate: null, accountId: null, liabilityAccountId: null, categoryId: null, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value });
  const original = (await dataset(db)).obligations[0]!.id;
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, day: 28 }, expectedRevision: 1 });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value, expectedRevision: 2 });
  expect((await dataset(db)).obligations.filter(o => !o.cancelled).map(o => o.id)).toEqual([original]);
});

test('restoring an automatically cancelled bill restores its cancellation provenance despite later manual audit events', async () => {
  const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today")).rows[0]!.today;
  const id = randomUUID(); const value = { id, title: 'Recurring', amountMinor: '1000', day: 31, startDate: `${today.slice(0, 7)}-01`, endDate: null, accountId: null, liabilityAccountId: null, categoryId: null, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...value, active: false }, expectedRevision: 1 });
  const backup = createBackup(await dataset(db)); const bill = backup.data.obligations[0]!;
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { ...bill, title: 'Manual cancellation' }, expectedRevision: bill.revision });
  await execute(db, { type: 'restore', backup, expectedSnapshotToken: (await dataset(db)).snapshotToken! });
  // A second exported/restored copy includes both audit timelines and must retain the same behavior.
  const safety = await dataset(db);
  await execute(db, { type: 'restore', backup: createBackup(safety), expectedSnapshotToken: safety.snapshotToken! });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value, expectedRevision: 2 });
  expect((await dataset(db)).obligations.find(o => o.id === bill.id)!.cancelled).toBe(false);
});

test('server restore rejects invalid static semantics in balanced voided history', async () => {
  const bank = await account('bank', '0'); const cat = await category();
  const id = await record({ kind: 'expense', accountId: bank, categoryId: cat, amountMinor: '100', date });
  await execute(db, { type: 'void', id, expectedRevision: 1 });
  const backup = createBackup(await dataset(db));
  const malformed = structuredClone(backup);
  const malformedBank = malformed.data.accounts.find(account => account.id === bank)!;
  malformedBank.kind = 'loan'; malformedBank.spendable = false;
  const before = await dataset(db);
  await expect(execute(db, { type: 'restore', backup: malformed, expectedSnapshotToken: before.snapshotToken! })).rejects.toThrow(/INVALID_CASH_ACCOUNT/);
  expect(await dataset(db)).toEqual(before);
});

test('restore requires the exact safety export snapshot even when another device keeps the same generation', async () => {
  const bank = await account('bank', '10000'); const cat = await category();
  const backup = createBackup(await dataset(db));
  const safety = await dataset(db);
  expect(safety.snapshotToken).toMatch(/^[0-9a-f]{64}$/);
  expect((await dataset(db)).snapshotToken).toBe(safety.snapshotToken);
  await record({ kind: 'expense', accountId: bank, categoryId: cat, amountMinor: '100', date });
  const newer = await dataset(db);
  expect(newer.generation).toBe(safety.generation);
  expect(newer.snapshotToken).not.toBe(safety.snapshotToken);
  await expect(execute(db, { type: 'restore', backup, expectedSnapshotToken: safety.snapshotToken! })).rejects.toThrow(/RESTORE_SNAPSHOT_CHANGED/);
  await expect(execute(db, { type: 'restore', backup, expectedSnapshotToken: '' })).rejects.toThrow(/RESTORE_SNAPSHOT_CHANGED/);
  expect(await dataset(db)).toEqual(newer);
  // The newly exported safety snapshot is now the proof; the candidate's older
  // token never acts as authorization to replace the current dataset.
  const freshSafety = createBackup(newer);
  await execute(db, { type: 'restore', backup, expectedSnapshotToken: freshSafety.data.snapshotToken! });
  const restored = await dataset(db);
  expect(restored.transactions).toEqual(backup.data.transactions);
  validateDataset(restored);
});

test('a variable monthly bill override survives reads and restore until an explicit future rule edit', async () => {
  const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today")).rows[0]!.today;
  const id = randomUUID();
  const rule = { id, title: 'Variable utility', amountMinor: null, day: 31, startDate: `${today.slice(0, 7)}-01`, endDate: null, accountId: null, liabilityAccountId: null, categoryId: null, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: rule });
  const bill = (await dataset(db)).obligations[0]!;
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { ...bill, title: 'This month actual bill', expectedMinor: '5000', dueDate: today }, expectedRevision: bill.revision });
  const overridden = await dataset(db);
  expect(overridden.obligations).toHaveLength(1);
  expect(overridden.obligations[0]).toMatchObject({ id: bill.id, title: 'This month actual bill', expectedMinor: '5000', dueDate: today, revision: 2 });
  expect(await dataset(db)).toEqual(overridden);
  const backup = createBackup(overridden);
  await execute(db, { type: 'restore', backup, expectedSnapshotToken: overridden.snapshotToken! });
  expect((await dataset(db)).obligations).toEqual(overridden.obligations);
  // This deliberate template edit applies to future unpaid bills, including
  // their previous per-occurrence overrides. Past and paid cases are tested above.
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...rule, amountMinor: '7000' }, expectedRevision: 1 });
  const changed = await dataset(db);
  expect(changed.obligations.filter(o => !o.cancelled)).toHaveLength(1);
  expect(changed.obligations.find(o => !o.cancelled)).toMatchObject({ id: bill.id, title: 'Variable utility', expectedMinor: '7000', dueDate: bill.dueDate });
  validateDataset(changed);
});

test('template edits preserve a manually cancelled month and an occurrence moved into the past', async () => {
  const dates = (await db.query<{ today: string; yesterday: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today, ((now() at time zone 'Asia/Jerusalem')::date-1)::text yesterday")).rows[0]!;
  const id = randomUUID();
  const rule = { id, title: 'Monthly', amountMinor: null, day: 31, startDate: `${dates.today.slice(0, 7)}-01`, endDate: null, accountId: null, liabilityAccountId: null, categoryId: null, active: true, revision: 1 };
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: rule });
  const bill = (await dataset(db)).obligations[0]!;
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { ...bill, cancelled: true }, expectedRevision: 1 });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...rule, day: 28 }, expectedRevision: 1 });
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: rule, expectedRevision: 2 });
  expect((await dataset(db)).obligations.filter(o => !o.cancelled)).toHaveLength(0);
  const cancelled = (await dataset(db)).obligations.find(o => o.id === bill.id)!;
  await execute(db, { type: 'save_entity', entity: 'obligation', value: { ...cancelled, cancelled: false, dueDate: dates.yesterday, expectedMinor: '5000' }, expectedRevision: cancelled.revision });
  const historical = (await dataset(db)).obligations.find(o => o.id === bill.id)!;
  await execute(db, { type: 'save_entity', entity: 'recurrence', value: { ...rule, amountMinor: '7000' }, expectedRevision: 3 });
  const after = await dataset(db);
  expect(after.obligations.find(o => o.id === bill.id)).toEqual(historical);
  validateDataset(after);
});
