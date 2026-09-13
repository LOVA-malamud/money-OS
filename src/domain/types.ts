/** Money at every JSON boundary is an integer-agorot decimal string. */
export type Minor = string;
export type DateOnly = string;
export type AccountKind = 'bank' | 'cash' | 'savings' | 'credit_card' | 'loan' | 'asset';
export type EntryKind = 'income' | 'expense' | 'transfer' | 'borrowing' | 'repayment' | 'refund' | 'opening' | 'reconcile' | 'valuation';
export interface Account {
  id: string; name: string; kind: AccountKind; spendable: boolean; openingKnown: boolean;
  openingDate: DateOnly | null; archived: boolean; revision: number;
}
export interface PaymentMethod { id: string; name: string; accountId: string; suffix: string; revision: number }
export interface Category { id: string; name: string; kind: 'expense' | 'income'; pinned: boolean; icon: string; revision: number }
export interface Debt { id: string; accountId: string; creditor: string; originalMinor: Minor | null; note: string; revision: number }
export interface FinancialEntryInput {
  kind: EntryKind; date: DateOnly; amountMinor: Minor; accountId: string;
  toAccountId?: string; categoryId?: string; paymentMethodId?: string;
  principalMinor?: Minor; interestMinor?: Minor; feeMinor?: Minor;
  originalTransactionId?: string; obligationId?: string;
  merchant?: string; note?: string;
}
/** Positive amounts are debit postings; negative amounts are credits. Internal UI never exposes these terms. */
export interface Posting { accountId: string; amountMinor: Minor }
export const SYSTEM_ACCOUNTS = { expense: '@expense', income: '@income', equity: '@equity' } as const;
export interface Transaction {
  id: string; input: FinancialEntryInput; postings: Posting[]; voided: boolean;
  revision: number; createdAt: string; updatedAt: string;
}
export interface Obligation {
  id: string; title: string; dueDate: DateOnly; expectedMinor: Minor | null;
  accountId: string | null; liabilityAccountId: string | null; categoryId: string | null;
  recurrenceId: string | null; cancelled: boolean; revision: number;
}
export interface Recurrence {
  id: string; title: string; amountMinor: Minor | null; day: number;
  startDate: DateOnly; endDate: DateOnly | null; accountId: string | null;
  liabilityAccountId: string | null; categoryId: string | null; active: boolean; revision: number;
}
export interface PaymentAllocation { id: string; transactionId: string; obligationId: string; amountMinor: Minor }
export interface Settings {
  currency: 'ILS'; timezone: 'Asia/Jerusalem'; trackingStart: DateOnly;
  accountsReviewed: boolean; debtsReviewed: boolean; obligationsReviewed: boolean; assetsReviewed: boolean;
  lastPaymentMethodId: string | null; recentCategoryIds: string[]; revision: number;
}
export interface AuditEvent { id: string; entityType: string; entityId: string; action: string; before: unknown; createdAt: string }
export interface OperationReceipt { id: string; requestHash: string; result: unknown }
export interface Dataset {
  schemaVersion: 1; generation: string; snapshotToken?: string; settings: Settings;
  accounts: Account[]; paymentMethods: PaymentMethod[]; categories: Category[];
  debts: Debt[]; transactions: Transaction[]; obligations: Obligation[]; recurrences: Recurrence[];
  allocations: PaymentAllocation[]; audit: AuditEvent[]; operations: OperationReceipt[];
}
export interface Backup { format: 'lova-money-os'; schemaVersion: 1; exportedAt: string; data: Dataset }
export type Metric =
  | { status: 'known'; amountMinor: Minor; reasons: string[] }
  | { status: 'unknown' | 'incomplete'; amountMinor: null; knownSubtotalMinor: Minor; reasons: string[] };
export interface ObligationSummary { obligation: Obligation; paidMinor: Minor; remainingMinor: Minor | null; status: 'unknown' | 'due' | 'paid' | 'partial' | 'overdue' | 'cancelled' }
export interface DashboardSummary {
  available: Metric; remaining: Metric; remainingObligations: Metric; spending: Metric; income: Metric; debt: Metric;
  dueThisMonth: Metric; unpaid: Metric; fixedMonthly: Metric; netWorth: Metric;
  assets: Metric; cashMovement: Metric; paidThisMonth: Metric; paidThisMonthMinor: Minor; monthStart: DateOnly; horizon: DateOnly;
  includedAccounts: Account[]; upcoming: ObligationSummary[]; remainingObligationItems: ObligationSummary[];
}
export type EntityName = 'account' | 'paymentMethod' | 'category' | 'debt' | 'obligation' | 'recurrence';
export type EntityInput = Account | PaymentMethod | Category | Debt | Obligation | Recurrence;
export type CommandAction =
  | { type: 'save_entity'; entity: EntityName; value: EntityInput; expectedRevision?: number }
  | { type: 'save_settings'; value: Partial<Settings>; expectedRevision: number }
  | { type: 'record'; id: string; input: FinancialEntryInput }
  | { type: 'edit'; id: string; input: FinancialEntryInput; expectedRevision: number }
  | { type: 'void'; id: string; expectedRevision: number }
  | { type: 'unvoid'; id: string; expectedRevision: number }
  | { type: 'restore'; backup: Backup; expectedSnapshotToken: string };
export type Command = CommandAction & { operationId: string; generation: string };
export interface MutationResult { entityId: string | null; revision: number | null; generation: string }
