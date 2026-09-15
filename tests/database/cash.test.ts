import { afterEach, expect, test } from 'vitest';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import type { FinancialEntryInput } from '../../src/domain/types';
import { createBackup, validateDataset } from '../../src/domain/backup';
import { buildPostings } from '../../src/domain/ledger';
import { accountBalance, dashboard } from '../../src/domain/reports';
import { asUser, createDatabase, dataset, execute, OWNER_ID, OTHER_ID } from './harness';

let db: PGlite;
afterEach(async () => { await db?.close(); });
const date = '2026-09-01';
const migration = () => readFile(new URL('../../supabase/migrations/202609150001_cash_categories.sql', import.meta.url), 'utf8');
async function record(input: FinancialEntryInput) {
  const expected = buildPostings(input, await dataset(db));
  const id = randomUUID();
  await execute(db, { type: 'record', id, input });
  const actual = (await dataset(db)).transactions.find(tx => tx.id === id)!.postings;
  const normalize = (postings: typeof actual) => postings.map(p => `${p.accountId}:${p.amountMinor}`).sort();
  expect(normalize(actual)).toEqual(normalize(expected));
}

test('Cash opening, both transfer directions, income and expense use the existing exact ledger', async () => {
  db = await createDatabase(); await asUser(db);
  let data = await dataset(db);
  const cash = data.accounts.find(account => account.kind === 'cash')!;
  expect(accountBalance(cash, data).status).toBe('unknown');
  expect(cash.spendable).toBe(true);
  const bank = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'account', value: { id: bank, name: 'Bank fixture', kind: 'bank', spendable: true, openingKnown: false, openingDate: null, archived: false, revision: 1 } });
  await record({ kind: 'opening', date, accountId: bank, amountMinor: '100000' });
  await record({ kind: 'opening', date, accountId: cash.id, amountMinor: '20000' });
  data = await dataset(db);
  await execute(db, { type: 'save_settings', expectedRevision: data.settings.revision, value: { trackingStart: date, accountsReviewed: true, debtsReviewed: true, obligationsReviewed: true, assetsReviewed: true } });
  const report = async () => dashboard(await dataset(db), date);
  expect((await report()).available.amountMinor).toBe('120000');
  expect((await report()).netWorth.amountMinor).toBe('120000');
  expect((await report()).income.amountMinor).toBe('0');
  expect((await report()).spending.amountMinor).toBe('0');
  await record({ kind: 'transfer', date, accountId: bank, toAccountId: cash.id, amountMinor: '1290' });
  expect(accountBalance(cash.id, await dataset(db), date).amountMinor).toBe('21290');
  expect((await report()).available.amountMinor).toBe('120000');
  await record({ kind: 'transfer', date, accountId: cash.id, toAccountId: bank, amountMinor: '290' });
  expect(accountBalance(cash.id, await dataset(db), date).amountMinor).toBe('21000');
  expect((await report()).available.amountMinor).toBe('120000');
  expect((await report()).netWorth.amountMinor).toBe('120000');
  expect((await report()).income.amountMinor).toBe('0');
  expect((await report()).spending.amountMinor).toBe('0');
  expect((await report()).cashMovement.amountMinor).toBe('0');
  const fuel = data.categories.find(category => category.name === 'דלק')!;
  await record({ kind: 'expense', date, accountId: cash.id, amountMinor: '1290', categoryId: fuel.id });
  expect(accountBalance(cash.id, await dataset(db), date).amountMinor).toBe('19710');
  expect((await report()).available.amountMinor).toBe('118710');
  expect((await report()).netWorth.amountMinor).toBe('118710');
  expect((await report()).spending.amountMinor).toBe('1290');
  const salary = data.categories.find(category => category.kind === 'income')!;
  await record({ kind: 'income', date, accountId: cash.id, amountMinor: '5000', categoryId: salary.id });
  expect(accountBalance(cash.id, await dataset(db), date).amountMinor).toBe('24710');
  expect((await report()).income.amountMinor).toBe('5000');
  validateDataset(await dataset(db));
});

test('additive upgrade preserves existing financial records, settings, categories and receipts; old backups stay exact', async () => {
  db = await createDatabase({ originalOnly: true }); await asUser(db);
  const bank = randomUUID(); const fuel = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'account', value: { id: bank, name: 'Existing fixture bank', kind: 'bank', spendable: true, openingKnown: false, openingDate: null, archived: false, revision: 1 } });
  await execute(db, { type: 'save_entity', entity: 'category', value: { id: fuel, name: 'דלק', kind: 'expense', pinned: true, icon: 'car', revision: 1 } });
  await record({ kind: 'opening', date, accountId: bank, amountMinor: '9007199254740993' });
  await record({ kind: 'expense', date, accountId: bank, amountMinor: '1290', categoryId: fuel });
  const before = await dataset(db); const backup = createBackup(before);
  await db.exec('reset role'); await db.exec(await migration()); await asUser(db);
  const after = await dataset(db);
  for (const key of ['generation', 'settings', 'transactions', 'allocations', 'debts', 'obligations', 'recurrences', 'operations', 'paymentMethods'] as const) expect(after[key]).toEqual(before[key]);
  for (const key of ['accounts', 'categories', 'audit'] as const) expect(after[key]).toEqual(expect.arrayContaining(before[key]));
  expect(after.accounts.filter(account => account.kind === 'cash')).toHaveLength(1);
  expect(after.transactions).toHaveLength(2); // No invented Cash opening.
  expect(after.categories).toHaveLength(before.categories.length + 2);
  for (const name of ['דלק', 'וויד', 'אטנט']) expect(after.categories.filter(category => category.name === name && category.kind === 'expense')).toHaveLength(1);
  await expect(db.query('select private.add_cash_categories($1)', [OWNER_ID])).rejects.toThrow(/permission denied/);
  await db.exec('reset role');
  await db.query('select private.add_cash_categories($1)', [OWNER_ID]);
  await db.query('select private.add_cash_categories($1)', [OWNER_ID]);
  await asUser(db); expect(await dataset(db)).toEqual(after);
  await execute(db, { type: 'restore', backup, expectedSnapshotToken: after.snapshotToken! });
  const restored = await dataset(db);
  expect(restored.accounts).toEqual(before.accounts);
  expect(restored.categories).toEqual(before.categories);
  expect(restored.transactions).toEqual(before.transactions);
  expect((await dataset(db)).accounts).toEqual(before.accounts); // Reads don't add defaults after a restore.
  validateDataset(restored);
});

test('an existing renamed/archived Cash wallet and customized categories are never replaced or duplicated', async () => {
  db = await createDatabase({ originalOnly: true }); await asUser(db);
  const id = randomUUID();
  await execute(db, { type: 'save_entity', entity: 'account', value: { id, name: 'My old wallet', kind: 'cash', spendable: false, openingKnown: false, openingDate: null, archived: true, revision: 1 } });
  const before = await dataset(db);
  await db.exec('reset role'); await db.exec(await migration()); await asUser(db);
  expect((await dataset(db)).accounts).toEqual(before.accounts);
  await asUser(db, OTHER_ID); await expect(dataset(db)).rejects.toThrow(/OWNER_REQUIRED/);
  expect((await db.query('select * from public.money_entities')).rows).toEqual([]);
});

test('a conflicting reserved ID rolls the whole additive migration back without changing the old dataset', async () => {
  db = await createDatabase({ originalOnly: true }); await asUser(db);
  await execute(db, { type: 'save_entity', entity: 'account', value: { id: '10000000-0000-4000-8000-000000000013', name: 'Existing fixture account', kind: 'bank', spendable: true, openingKnown: false, openingDate: null, archived: false, revision: 1 } });
  const before = await dataset(db);
  await db.exec('reset role');
  await expect(db.exec(await migration())).rejects.toThrow(/ENTITY_KIND_IMMUTABLE/);
  await db.exec('rollback'); await asUser(db);
  expect(await dataset(db)).toEqual(before);
});
