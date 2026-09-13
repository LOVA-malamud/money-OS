# Phase A — First Usable Milestone

This document records the approved implementation boundary. Financial correctness, daily speed, clear understanding, data integrity and mobile usability take priority over polish and feature count.

## Visual and interaction foundation

Quiet Balance is the sole visual foundation: graphite background, warm off-white Heebo typography, restrained mint emphasis, tabular isolated numbers, generous vertical spacing and aligned rows. Use the tokens in `src/styles/tokens.css`. No decorative charts, gradients, card grids, gold styling or serif numerals.

The Overview first viewport prioritizes **כמה יש לי עכשיו?** and **יתרה לאחר התחייבויות**. Below it: this month's spending and income, upcoming payments, monthly due/unpaid/fixed amounts, total debt and tracked net worth. These are separate concepts, not nine equal cards. Cash movement is available in transaction history and must not masquerade as spending or income. Trends require enough real history; no synthetic trends are shown.

The remaining calculation opens on demand, borrowing only Clear Horizon's explanatory clarity:

```text
current signed balances of selected spendable accounts
− unpaid known cash obligations through month-end, including overdue
= remaining after known obligations
```

Show the horizon, included accounts and obligations. Exclude expected income and hypothetical discretionary spending. Do not call the result guaranteed safe to spend. Card-funded purchases are spending, while their later cash settlements are obligations; never count both as cash leaving selected spendable accounts.

Normal Quick Add is **amount → category → save**, with focused large amount entry and an accessible keypad. Recent/pinned categories are close at hand. Date and payment method are secondary editable controls. Remember the last successful payment method, preserve unfinished local drafts, keep save reachable, return to the previous context, and show success only after acknowledgment. Additional fields stay under **פרטים נוספים**. No mandatory Next step.

## Included functionality

- Bank, cash, savings, basic card and loan accounts; opening balances and spendable selection; debit/payment methods.
- Income, expenses, own-account transfers, borrowing, principal/interest/fee repayments, linked refunds and explicit reconciliation.
- Basic card liabilities with manually recorded settlement obligations. Purchases create expense once; repayment reduces liability without repeating spending.
- Debts with remaining balance; monthly recurring commitments and individual due/paid/partial/overdue obligations; payment allocation.
- Manual asset values, dated valuation adjustments, and tracked net worth.
- Searchable history with type, date, account and category filters; revision-checked editing, recoverable voids and safe undo.
- Full JSON export and validated atomic restore, preview, required safety export, concurrency guard and independent recovery to a fresh project.
- Private owner authentication, no public registration, RLS, restrictive writes, online-first PWA and responsive desktop layout.
- Hebrew and RTL throughout, readable mixed-direction account suffixes/currency/dates, logical CSS, keyboard access and mobile touch targets.

## Financial invariants

Money is integer agorot only: PostgreSQL `bigint`, TypeScript `bigint`, canonical integer decimal strings at JSON boundaries. Domain modules centralize parsing, display, aggregation and calculations. PostgreSQL authoritatively constructs and validates balanced postings atomically. See [financial model](financial-model.md).

Transfers are neither income nor spending. Borrowing increases money and liability without income. Principal repayments reduce debt; interest/fees count as spending. Refunds reduce related spending. Openings establish position; reconciliation and asset valuation are explicit adjustments, never ordinary income/spending. Corrections retain audit history and recalculate reports from active postings.

Every summary carries completeness metadata. **₪0** means known zero; **חסר מידע / טרם הוגדר** means unknown; **מידע חלקי** means the recorded subtotal is incomplete. Missing amounts, unreviewed areas and failed loads must never become zero. A user review confirms coverage but does not fabricate missing balances. Incomplete metrics expose reasons and known subtotals in their details.

## Reliability and security

One application and repository. Versioned SQL migrations. Atomic typed operations with UUID idempotency receipts and entity revisions. Only the exact uncertain request can be retried; no offline mutation queue. Owner-scoped RLS plus an explicit owner allowlist; no privileged browser key, financial logs or bank credentials. Environment variables supply the public project endpoint/key. TOTP can remain optional during Phase A.

Static app-shell resources may be cached by the PWA; financial API responses are not cached by the service worker. Authentication and unfinished local drafts are private browser storage and are cleared on sign-out. JSON exports contain readable private financial data and belong in a personally controlled backup location.

## Verification and remaining release gate

Build financial tests alongside features. Cover income, expense, transfers, borrowing, principal/interest, refunds, openings, edits/voids, partial payments, completeness, retries, month boundaries, recurrence and backup/restore. Exercise actual UI workflows at iPhone and desktop widths, plus relevant WebKit checks. Fix failures without weakening invariants.

Local PostgreSQL tests do not replace real Supabase provisioning checks. Before daily use with real financial data, verify owner access/RLS in the configured project, HTTPS deployment, recovery and backup round-trip, and Safari home-screen installation on the actual iPhone.

## Deferred

Phase B/C work is not authorized here: advanced credit-card cycles, installment edge cases, offline synchronization/conflict resolution, advanced analytics, investment feeds, automatic bank import, multi-user features, Realtime infrastructure and paid backup dependencies.
