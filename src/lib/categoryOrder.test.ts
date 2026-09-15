import { expect, it } from 'vitest';
import { orderedCategories } from './categoryOrder';
import type { Category, Dataset, Transaction } from '../domain/types';

it('keeps recent, pinned and frequent categories reachable without changing or duplicating saved data', () => {
  const categories: Category[] = ['דלק','וויד','אטנט','אוכל','משכורת'].map((name, index) => ({ id: String(index), name, kind: index === 4 ? 'income' : 'expense', pinned: index === 3, icon: '', revision: 1 }));
  const entry = (id: string, kind: 'expense' | 'income', voided = false): Transaction => ({ id: crypto.randomUUID(), input: { kind, categoryId: id, accountId: 'cash', amountMinor: '1290', date: '2026-09-01' }, postings: [], voided, revision: 1, createdAt: '', updatedAt: '' });
  const data: Dataset = { schemaVersion: 1, generation: 'local', settings: { currency: 'ILS', timezone: 'Asia/Jerusalem', trackingStart: '2026-09-01', accountsReviewed: false, debtsReviewed: false, obligationsReviewed: false, assetsReviewed: false, lastPaymentMethodId: null, recentCategoryIds: ['1','1','missing'], revision: 1 }, categories, accounts: [], paymentMethods: [], debts: [], obligations: [], recurrences: [], allocations: [], audit: [], operations: [], transactions: [entry('0','expense'), entry('0','expense'), entry('2','expense',true), entry('2','expense',true), entry('2','expense',true), entry('4','income')] };
  const before = structuredClone(data);
  expect(orderedCategories(data,'expense').map(category => category.name)).toEqual(['וויד','אוכל','דלק','אטנט']);
  expect(orderedCategories(data,'income').map(category => category.name)).toEqual(['משכורת']);
  expect(data).toEqual(before);
});
