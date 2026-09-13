import { minor, sumMoney, toMinor } from './money';
import { monthEnd, monthStart, requireDate, todayJerusalem } from './dates';
import { signedBalance } from './ledger';
import { SYSTEM_ACCOUNTS, type Account, type Dataset, type DashboardSummary, type Metric, type Obligation, type ObligationSummary } from './types';

const isCash = (account: Account) => ['bank', 'cash', 'savings'].includes(account.kind);
export function metric(amount: bigint, reasons: string[] = [], unknown = false): Metric {
  const unique = [...new Set(reasons)];
  return unique.length ? { status: unknown ? 'unknown' : 'incomplete', amountMinor: null, knownSubtotalMinor: toMinor(amount), reasons: unique }
    : { status: 'known', amountMinor: toMinor(amount), reasons: [] };
}
export function metricSubtotal(value: Metric): bigint { return minor(value.status === 'known' ? value.amountMinor : value.knownSubtotalMinor); }

export function accountBalance(accountOrId: Account | string, dataset: Dataset, asOf = todayJerusalem()): Metric {
  requireDate(asOf);
  const account = typeof accountOrId === 'string' ? dataset.accounts.find((item) => item.id === accountOrId) : accountOrId;
  if (!account) return metric(0n, ['החשבון אינו זמין'], true);
  const total = signedBalance(dataset, account.id, asOf);
  const opened = account.openingKnown && account.openingDate !== null && account.openingDate <= asOf;
  return metric(total, opened ? [] : [`טרם הושלמה יתרת הפתיחה של ${account.name}`], !opened);
}

/** A signed account balance is not itself a debt amount: card credits are assets, and overdrafts are debts. */
export function debtBalance(accountOrId: Account | string, dataset: Dataset, asOf = todayJerusalem()): Metric {
  const balance = accountBalance(accountOrId, dataset, asOf);
  if (balance.status !== 'known') return metric(0n, balance.reasons, balance.status === 'unknown');
  const signed = minor(balance.amountMinor);
  return metric(signed < 0n ? -signed : 0n);
}

export function obligationStatus(obligation: Obligation, dataset: Dataset, asOf = todayJerusalem()): ObligationSummary {
  requireDate(asOf);
  const validTransactions = new Set(dataset.transactions.filter((tx) => !tx.voided && tx.input.date <= asOf).map((tx) => tx.id));
  const paid = sumMoney(dataset.allocations.filter((allocation) => allocation.obligationId === obligation.id && validTransactions.has(allocation.transactionId)).map((allocation) => allocation.amountMinor));
  const remaining = obligation.expectedMinor === null ? null : minor(obligation.expectedMinor) - paid;
  return {
    obligation, paidMinor: toMinor(paid), remainingMinor: remaining === null ? null : toMinor(remaining > 0n ? remaining : 0n),
    status: obligation.cancelled ? 'cancelled' : remaining === null ? 'unknown' : remaining <= 0n ? 'paid' : obligation.dueDate < asOf ? 'overdue' : paid > 0n ? 'partial' : 'due',
  };
}

/** Exact as-of reports. Templates forecast; only actual postings change balances. */
export function dashboard(dataset: Dataset, asOf = todayJerusalem()): DashboardSummary {
  requireDate(asOf);
  const start = monthStart(asOf);
  const horizon = monthEnd(asOf);
  // An archived account still owns its balance and must not disappear from totals.
  const balances = new Map(dataset.accounts.map((account) => [account.id, accountBalance(account, dataset, asOf)]));
  const includedAccounts = dataset.accounts.filter((account) => account.spendable && isCash(account));
  const cashReasons = dataset.settings.accountsReviewed ? [] : ['רשימת חשבונות הכסף טרם אושרה'];
  let availableTotal = 0n;
  for (const account of includedAccounts) {
    const balance = balances.get(account.id)!;
    if (balance.status === 'known') availableTotal += minor(balance.amountMinor);
    cashReasons.push(...balance.reasons);
  }
  // Unknown nonspendable accounts do not affect spendable cash, but unknown membership does.
  const available = metric(availableTotal, cashReasons, includedAccounts.length === 0 && !dataset.settings.accountsReviewed);
  const statements = dataset.obligations.map((item) => obligationStatus(item, dataset, asOf));
  const current = statements.filter((item) => item.obligation.dueDate >= start && item.obligation.dueDate <= horizon && item.status !== 'cancelled');
  const throughEnd = statements.filter((item) => item.obligation.dueDate <= horizon && !['cancelled', 'paid'].includes(item.status));

  function cashObligation(item: ObligationSummary): boolean {
    const funding = dataset.accounts.find((account) => account.id === item.obligation.accountId);
    // A charge to a card is spending, not a cash payment. Reserve its separate card settlement only.
    return funding?.kind !== 'credit_card';
  }
  function obligationReasons(items: ObligationSummary[], requireCoverage = true): string[] {
    const reasons = requireCoverage && !dataset.settings.obligationsReviewed ? ['יש להשלים סקירה של התשלומים הצפויים'] : [];
    for (const item of items) {
      if (item.remainingMinor === null) reasons.push(`חסר סכום לתשלום: ${item.obligation.title}`);
      if (!item.obligation.accountId) reasons.push(`חסר חשבון לתשלום: ${item.obligation.title}`);
      else if (!dataset.accounts.some((account) => account.id === item.obligation.accountId)) reasons.push('חשבון של תשלום צפוי אינו זמין');
    }
    return reasons;
  }
  const currentCash = current.filter(cashObligation);
  const pendingCash = throughEnd.filter(cashObligation);
  const dueTotal = sumMoney(currentCash.map((item) => item.obligation.expectedMinor ?? '0'));
  const unpaidTotal = sumMoney(pendingCash.map((item) => item.remainingMinor ?? '0'));
  const spendableIds = new Set(includedAccounts.map((account) => account.id));
  const deducted = pendingCash.filter((item) => !item.obligation.accountId || spendableIds.has(item.obligation.accountId));
  const cardReasons: string[] = [];
  // Card debts with no dated upcoming settlement are a known forecasting gap, not zero obligations.
  for (const account of dataset.accounts.filter((item) => item.kind === 'credit_card')) {
    const balance = balances.get(account.id)!;
    const pendingCardCharge = statements.some((item) => !['cancelled', 'paid'].includes(item.status) && item.obligation.accountId === account.id && item.obligation.dueDate <= horizon);
    if (balance.status !== 'known' || metricSubtotal(balance) < 0n || pendingCardCharge) {
      const datedSettlement = statements.some((item) => item.status !== 'cancelled' && item.obligation.liabilityAccountId === account.id && (item.obligation.dueDate >= asOf || item.status !== 'paid'));
      if (!datedSettlement) cardReasons.push(`יש לבדוק את מועד וסכום התשלום בכרטיס ${account.name}`);
    }
  }
  const dueThisMonth = metric(dueTotal, [...obligationReasons(currentCash), ...cardReasons]);
  const unpaid = metric(unpaidTotal, [...obligationReasons(pendingCash), ...cardReasons]);
  const deductionTotal = sumMoney(deducted.map((item) => item.remainingMinor ?? '0'));
  const remainingObligations = metric(deductionTotal, [...obligationReasons(deducted), ...cardReasons, ...(dataset.settings.accountsReviewed ? [] : ['רשימת חשבונות הכסף טרם אושרה'])]);
  const remaining = metric(availableTotal - deductionTotal, [...available.reasons, ...remainingObligations.reasons]);

  const monthTransactions = dataset.transactions.filter((tx) => !tx.voided && tx.input.date >= start && tx.input.date <= asOf);
  const trackingReasons = dataset.settings.trackingStart > start ? [`המעקב בחודש זה מתחיל ב־${dataset.settings.trackingStart}`] : [];
  const expenseTotal = sumMoney(monthTransactions.flatMap((tx) => tx.postings.filter((line) => line.accountId === SYSTEM_ACCOUNTS.expense).map((line) => line.amountMinor)));
  const incomeTotal = -sumMoney(monthTransactions.flatMap((tx) => tx.postings.filter((line) => line.accountId === SYSTEM_ACCOUNTS.income).map((line) => line.amountMinor)));
  const cashIds = new Set(dataset.accounts.filter(isCash).map((account) => account.id));
  const cashMovementTotal = sumMoney(monthTransactions.filter((tx) => !['opening', 'reconcile', 'valuation'].includes(tx.input.kind)).flatMap((tx) => tx.postings.filter((line) => cashIds.has(line.accountId)).map((line) => line.amountMinor)));

  let assetTotal = 0n;
  let debtTotal = 0n;
  const assetReasons = [...(dataset.settings.accountsReviewed ? [] : ['רשימת חשבונות הכסף טרם אושרה']), ...(dataset.settings.assetsReviewed ? [] : ['רשימת הנכסים ושוויים טרם אושרו'])];
  const debtReasons = [...(dataset.settings.debtsReviewed ? [] : ['רשימת החובות טרם אושרה']), ...(dataset.settings.accountsReviewed ? [] : ['רשימת חשבונות הכסף טרם אושרה'])];
  for (const account of dataset.accounts) {
    const balance = balances.get(account.id)!;
    const value = balance.status === 'known' ? minor(balance.amountMinor) : 0n;
    if (value >= 0n) assetTotal += value;
    else debtTotal -= value;
    if (balance.status !== 'known') {
      // A credit account can hold an asset credit; an unknown bank balance can be an overdraft.
      if (account.kind !== 'loan') assetReasons.push(...balance.reasons);
      if (account.kind !== 'asset') debtReasons.push(...balance.reasons);
    }
  }

  const fixed = dataset.recurrences.filter((item) => item.active && item.startDate <= horizon && (!item.endDate || item.endDate >= start));
  const fixedReasons = dataset.settings.obligationsReviewed ? [] : ['יש להשלים סקירה של התשלומים הקבועים'];
  let fixedTotal = 0n;
  for (const item of fixed) {
    const funding = dataset.accounts.find((account) => account.id === item.accountId);
    if (funding?.kind === 'credit_card') continue;
    if (item.amountMinor === null) fixedReasons.push(`חסר סכום חודשי: ${item.title}`);
    else fixedTotal += minor(item.amountMinor);
    if (!funding) fixedReasons.push(`חסר חשבון לתשלום: ${item.title}`);
  }

  // This is the paid portion of this month's due obligations, even if prepaid in an earlier month.
  const paidThisMonthTotal = sumMoney(currentCash.map((item) => item.paidMinor));
  const paidThisMonth = metric(paidThisMonthTotal, [...obligationReasons(currentCash), ...cardReasons]);

  return {
    available, remaining, remainingObligations, spending: metric(expenseTotal, trackingReasons), income: metric(incomeTotal, trackingReasons),
    debt: metric(debtTotal, debtReasons), dueThisMonth, unpaid, fixedMonthly: metric(fixedTotal, fixedReasons),
    assets: metric(assetTotal, assetReasons), netWorth: metric(assetTotal - debtTotal, [...assetReasons, ...debtReasons]),
    cashMovement: metric(cashMovementTotal, trackingReasons), paidThisMonth, paidThisMonthMinor: toMinor(paidThisMonthTotal), monthStart: start, horizon,
    includedAccounts, upcoming: throughEnd.sort((a, b) => a.obligation.dueDate.localeCompare(b.obligation.dueDate) || a.obligation.id.localeCompare(b.obligation.id)),
    remainingObligationItems: deducted.sort((a, b) => a.obligation.dueDate.localeCompare(b.obligation.dueDate) || a.obligation.id.localeCompare(b.obligation.id)),
  };
}
export const dashboardSummary = dashboard;
