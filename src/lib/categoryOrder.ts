import type { Category, Dataset } from '../domain/types';

/** Device-independent shortcuts; never mutate the saved category list/history. */
export function orderedCategories(data: Dataset, kind: Category['kind']): Category[] {
  const frequency = new Map<string, number>();
  for (const transaction of data.transactions) {
    const id = transaction.input.categoryId;
    if (!transaction.voided && transaction.input.kind === kind && id) frequency.set(id, (frequency.get(id) ?? 0) + 1);
  }
  const rank = (category: Category) => {
    const recent = data.settings.recentCategoryIds.indexOf(category.id);
    return recent >= 0 ? recent : category.pinned ? 100 : 200;
  };
  return data.categories.filter(category => category.kind === kind).sort((a, b) => rank(a) - rank(b) || (frequency.get(b.id) ?? 0) - (frequency.get(a.id) ?? 0));
}
