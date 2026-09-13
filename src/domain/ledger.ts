import { minor, sumMoney, toMinor } from './money';
import { requireDate, todayJerusalem } from './dates';
import { SYSTEM_ACCOUNTS, type Account, type Dataset, type FinancialEntryInput, type Posting, type Transaction } from './types';

const liability = (account: Account) => account.kind === 'loan' || account.kind === 'credit_card';
const liquid = (account: Account) => ['bank', 'cash', 'savings'].includes(account.kind);
const ADJUSTMENTS = ['opening', 'reconcile', 'valuation'];
export function signedBalance(dataset: Dataset, accountId: string, asOf = todayJerusalem()): bigint {
  return sumMoney(dataset.transactions.filter((tx) => !tx.voided && tx.input.date <= asOf).flatMap((tx) => tx.postings.filter((posting) => posting.accountId === accountId).map((posting) => posting.amountMinor)));
}

/** Account values must remain possible at every recorded effective date, including after backdated edits. */
export function validateBalanceHistory(dataset: Dataset, addition?: { date: string; postings: Posting[]; openingAccountId?: string }): void {
  const touched = addition ? new Set(addition.postings.map((line) => line.accountId)) : null;
  for (const account of dataset.accounts) {
    if (!['loan', 'asset'].includes(account.kind) || (!account.openingKnown && addition?.openingAccountId !== account.id) || (touched && !touched.has(account.id))) continue;
    const days = new Map<string, bigint>();
    for (const tx of dataset.transactions) {
      if (tx.voided) continue;
      for (const line of tx.postings) if (line.accountId === account.id) days.set(tx.input.date, (days.get(tx.input.date) ?? 0n) + minor(line.amountMinor));
    }
    if (addition) for (const line of addition.postings) if (line.accountId === account.id) days.set(addition.date, (days.get(addition.date) ?? 0n) + minor(line.amountMinor));
    let balance = 0n;
    for (const [, delta] of [...days].sort(([a], [b]) => a.localeCompare(b))) {
      balance = minor(balance + delta);
      if (account.kind === 'loan' && balance > 0n) throw new Error('התנועה תיצור יתרת הלוואה חיובית; יש לבדוק את החזרי הקרן');
      if (account.kind === 'asset' && balance < 0n) throw new Error('התנועה תיצור שווי נכס שלילי; יש לעדכן את השווי לפני ההעברה');
    }
  }
}

function getAccount(dataset: Dataset, id: string, allowArchived = false): Account {
  const account = dataset.accounts.find((item) => item.id === id);
  if (!account || (!allowArchived && account.archived)) throw new Error('החשבון אינו זמין');
  return account;
}
function posting(accountId: string, value: bigint): Posting { return { accountId, amountMinor: toMinor(value) }; }
function requiredCategory(dataset: Dataset, id: string | undefined, kind: 'income' | 'expense'): void {
  if (!id || !dataset.categories.some((category) => category.id === id && category.kind === kind)) throw new Error('יש לבחור קטגוריה מתאימה');
}
function validateInput(input: FinancialEntryInput, dataset: Dataset, allowArchived: boolean, historical = false): { account: Account; amount: bigint } {
  requireDate(input.date);
  if (input.date > todayJerusalem()) throw new Error('תנועה בפועל אינה יכולה להיות עתידית; יש להוסיף התחייבות צפויה');
  const account = getAccount(dataset, input.accountId, allowArchived);
  if (!historical && input.kind !== 'opening' && account.openingDate && input.date < account.openingDate) throw new Error('תנועה אינה יכולה להקדים את יתרת הפתיחה');
  if (!historical && ['reconcile', 'valuation'].includes(input.kind) && !account.openingKnown) throw new Error('יש להשלים יתרת פתיחה לפני התאמה או שערוך');
  const amount = minor(input.amountMinor);
  if (!ADJUSTMENTS.includes(input.kind) && amount <= 0n) throw new Error('סכום התנועה חייב להיות חיובי');
  if (input.kind !== 'repayment' && (input.principalMinor !== undefined || input.interestMinor !== undefined)) throw new Error('פירוט קרן וריבית מיועד להחזר חוב בלבד');
  if (!['repayment', 'transfer'].includes(input.kind) && input.feeMinor !== undefined) throw new Error('עמלה נפרדת אינה מתאימה לסוג תנועה זה');
  if (!['transfer', 'borrowing', 'repayment'].includes(input.kind) && input.toAccountId !== undefined) throw new Error('חשבון יעד אינו מתאים לסוג תנועה זה');
  if (input.kind !== 'refund' && input.originalTransactionId !== undefined) throw new Error('קישור להוצאה מקורית מיועד לזיכוי בלבד');
  if (input.categoryId) {
    if (['opening', 'reconcile', 'valuation', 'borrowing'].includes(input.kind)) throw new Error('התאמה או קבלת הלוואה אינן משויכות לקטגוריית הכנסה או הוצאה');
    requiredCategory(dataset, input.categoryId, input.kind === 'income' ? 'income' : 'expense');
  }
  if ((input.merchant?.length ?? 0) > 500 || (input.note?.length ?? 0) > 10000) throw new Error('הטקסט ארוך מדי');
  if (input.toAccountId) {
    const target = getAccount(dataset, input.toAccountId, allowArchived);
    if (!historical && target.openingDate && input.date < target.openingDate) throw new Error('תנועה אינה יכולה להקדים את יתרת הפתיחה של חשבון היעד');
  }
  if (input.paymentMethodId && !dataset.paymentMethods.some((method) => method.id === input.paymentMethodId && method.accountId === account.id)) throw new Error('אמצעי התשלום אינו שייך לחשבון');
  if (input.obligationId) {
    const obligation = dataset.obligations.find((item) => item.id === input.obligationId);
    if (!obligation || obligation.cancelled) throw new Error('ההתחייבות אינה זמינה');
    if (obligation.accountId && obligation.accountId !== account.id) throw new Error('חשבון התשלום אינו תואם להתחייבות');
    if (!['expense', 'repayment'].includes(input.kind)) throw new Error('ניתן לקשר להתחייבות רק הוצאה או החזר חוב');
    if (input.kind === 'repayment' && !obligation.liabilityAccountId) throw new Error('להתחייבות להחזר חוב חייב להיות חשבון חוב');
    if (input.kind === 'expense' && obligation.liabilityAccountId) throw new Error('התחייבות להחזר חוב דורשת תנועת החזר חוב');
    if (obligation.liabilityAccountId && input.toAccountId !== obligation.liabilityAccountId) throw new Error('החוב אינו תואם להתחייבות');
    if (input.kind === 'expense' && obligation.categoryId && input.categoryId !== obligation.categoryId) throw new Error('הקטגוריה אינה תואמת להתחייבות');
  }
  return { account, amount };
}

/** Build a complete, balanced journal before any write. For edits pass a dataset without the original transaction. */
export function buildPostings(input: FinancialEntryInput, dataset: Dataset, options: { allowArchived?: boolean; historical?: boolean; skipHistoryValidation?: boolean } = {}): Posting[] {
  const { account, amount } = validateInput(input, dataset, !!options.allowArchived, !!options.historical);
  let result: Posting[];
  switch (input.kind) {
    case 'income':
      if (!liquid(account)) throw new Error('הכנסה נרשמת לחשבון כסף');
      requiredCategory(dataset, input.categoryId, 'income');
      result = [posting(account.id, amount), posting(SYSTEM_ACCOUNTS.income, -amount)];
      break;
    case 'expense':
      if (account.kind === 'loan' || account.kind === 'asset') throw new Error('לא ניתן לשלם הוצאה מחשבון זה');
      requiredCategory(dataset, input.categoryId, 'expense');
      result = [posting(SYSTEM_ACCOUNTS.expense, amount), posting(account.id, -amount)];
      break;
    case 'transfer': {
      const target = getAccount(dataset, input.toAccountId ?? '', !!options.allowArchived);
      if (target.id === account.id || liability(account) || liability(target)) throw new Error('העברה דורשת שני חשבונות נכסים שונים');
      const fee = minor(input.feeMinor ?? '0');
      if (fee < 0n) throw new Error('עמלה אינה יכולה להיות שלילית');
      if (fee > 0n) requiredCategory(dataset, input.categoryId, 'expense');
      result = [posting(account.id, -(amount + fee)), posting(target.id, amount)];
      if (fee > 0n) result.push(posting(SYSTEM_ACCOUNTS.expense, fee));
      break;
    }
    case 'borrowing': {
      const target = getAccount(dataset, input.toAccountId ?? '', !!options.allowArchived);
      if (!liquid(account) || !liability(target)) throw new Error('קבלת הלוואה דורשת חשבון כסף וחשבון חוב');
      result = [posting(account.id, amount), posting(target.id, -amount)];
      break;
    }
    case 'repayment': {
      const target = getAccount(dataset, input.toAccountId ?? '', !!options.allowArchived);
      if (!liquid(account) || !liability(target)) throw new Error('החזר חוב דורש חשבון כסף וחשבון חוב');
      if (input.principalMinor === undefined) throw new Error('יש לציין את סכום הקרן; אין להניח שריבית היא אפס');
      const principal = minor(input.principalMinor);
      const interest = minor(input.interestMinor ?? '0');
      const fee = minor(input.feeMinor ?? '0');
      if (principal < 0n || interest < 0n || fee < 0n || principal + interest + fee !== amount) throw new Error('קרן, ריבית ועמלות חייבות להסתכם לסכום התשלום');
      if (!options.historical && target.kind === 'loan' && target.openingKnown && target.openingDate && target.openingDate <= input.date && principal > -signedBalance(dataset, target.id, input.date)) throw new Error('החזר הקרן גבוה מיתרת ההלוואה');
      if (interest + fee > 0n) requiredCategory(dataset, input.categoryId, 'expense');
      result = [posting(account.id, -amount)];
      if (principal > 0n) result.push(posting(target.id, principal));
      if (interest + fee > 0n) result.push(posting(SYSTEM_ACCOUNTS.expense, interest + fee));
      break;
    }
    case 'refund': {
      const original = dataset.transactions.find((tx) => tx.id === input.originalTransactionId && !tx.voided);
      if (!original || original.input.kind !== 'expense') throw new Error('זיכוי חייב להיות מקושר להוצאה פעילה');
      if (original.input.accountId !== account.id || original.input.categoryId !== input.categoryId) throw new Error('זיכוי חייב לחזור לחשבון ולקטגוריה של ההוצאה');
      if (input.date < original.input.date) throw new Error('זיכוי אינו יכול להקדים את ההוצאה');
      const alreadyRefunded = sumMoney(dataset.transactions.filter((tx) => !tx.voided && tx.input.kind === 'refund' && tx.input.originalTransactionId === original.id).map((tx) => tx.input.amountMinor));
      if (alreadyRefunded + amount > minor(original.input.amountMinor)) throw new Error('סך הזיכויים גבוה מסכום ההוצאה המקורית');
      result = [posting(account.id, amount), posting(SYSTEM_ACCOUNTS.expense, -amount)];
      break;
    }
    case 'opening':
    case 'reconcile':
    case 'valuation': {
      if (input.kind === 'valuation' && account.kind !== 'asset') throw new Error('שערוך מיועד לנכס ידני בלבד');
      if (account.kind === 'asset' && amount < 0n) throw new Error('שווי נכס אינו יכול להיות שלילי');
      if (account.kind === 'loan' && amount > 0n) throw new Error('יתרת חוב מוזנת בסימן שלילי');
      if (input.kind === 'opening' && dataset.transactions.some((tx) => !tx.voided && tx.input.kind === 'opening' && tx.input.accountId === account.id)) throw new Error('לחשבון כבר קיימת יתרת פתיחה');
      if (input.kind === 'opening' && dataset.transactions.some((tx) => !tx.voided && tx.input.date < input.date && tx.postings.some((line) => line.accountId === account.id))) throw new Error('יתרת פתיחה חייבת להקדים את התנועות בחשבון');
      const delta = amount - signedBalance(dataset, account.id, input.date);
      result = [posting(account.id, delta), posting(SYSTEM_ACCOUNTS.equity, -delta)];
      break;
    }
    default: throw new Error('סוג תנועה לא נתמך');
  }
  if (sumMoney(result.map((line) => line.amountMinor)) !== 0n) throw new Error('תנועה אינה מאוזנת');
  if (!options.historical && !options.skipHistoryValidation) validateBalanceHistory(dataset, { date: input.date, postings: result, openingAccountId: input.kind === 'opening' ? input.accountId : undefined });
  return result;
}

export function validateTransactionSemantics(transaction: Transaction, dataset: Dataset): void {
  const withoutOriginal = { ...dataset, transactions: dataset.transactions.filter((tx) => tx.id !== transaction.id) };
  // Archived accounts are valid historical references. Voided records are retained for audit.
  const validationDataset = {
    ...withoutOriginal,
    obligations: withoutOriginal.obligations.map((item) => transaction.voided && item.id === transaction.input.obligationId
      ? { ...item, cancelled: false, accountId: transaction.input.accountId, liabilityAccountId: transaction.input.kind === 'repayment' ? transaction.input.toAccountId ?? null : null, categoryId: transaction.input.categoryId ?? null }
      : { ...item, cancelled: false }),
  };
  const actual = transaction.postings;
  if (actual.length < 2 || sumMoney(actual.map((line) => line.amountMinor)) !== 0n) throw new Error('תנועה חייבת לכלול רישום מאוזן');
  if (transaction.voided && transaction.input.kind === 'refund') {
    validateInput(transaction.input, validationDataset, true, true);
    if (!dataset.transactions.some((tx) => tx.id === transaction.input.originalTransactionId)) throw new Error('תנועת המקור לזיכוי חסרה');
    const amount = minor(transaction.input.amountMinor);
    const expected = [posting(transaction.input.accountId, amount), posting(SYSTEM_ACCOUNTS.expense, -amount)];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('רישום הזיכוי אינו תקין');
    return;
  }
  if (ADJUSTMENTS.includes(transaction.input.kind)) {
    validateInput(transaction.input, validationDataset, true, transaction.voided);
    if (actual.length !== 2 || actual[0].accountId !== transaction.input.accountId || actual[1].accountId !== SYSTEM_ACCOUNTS.equity) throw new Error('רישום התאמה אינו תקין');
    const account = getAccount(dataset, transaction.input.accountId, true);
    if (transaction.input.kind === 'valuation' && account.kind !== 'asset') throw new Error('שערוך מיועד לנכס ידני בלבד');
    if (account.kind === 'asset' && minor(transaction.input.amountMinor) < 0n) throw new Error('שווי נכס שלילי');
    if (account.kind === 'loan' && minor(transaction.input.amountMinor) > 0n) throw new Error('יתרת הלוואה חיובית');
    return;
  }
  const expected = buildPostings(transaction.input, validationDataset, { allowArchived: true, historical: transaction.voided, skipHistoryValidation: true });
  const canonical = (lines: Posting[]) => lines.map((line) => `${line.accountId}:${line.amountMinor}`).sort().join('|');
  if (canonical(expected) !== canonical(actual)) throw new Error('רישום התנועה אינו תואם לסוג ולסכום שלה');
}
