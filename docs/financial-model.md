# Phase A financial model

All money is integer agorot: PostgreSQL `bigint`, TypeScript `bigint` for arithmetic, and canonical decimal strings in JSON. `money.ts` owns parsing, formatting, bounds, sums, and arithmetic. No money operation converts through `Number`; number operations in date utilities concern calendar components only.

## One balanced journal

Every actual transaction contains a complete set of signed postings summing to zero. Positive postings increase assets or expenses; negative postings increase liabilities or income. Account totals derive from active postings through the reporting date. There are three internal counterpart accounts: `@expense`, `@income`, and `@equity`.

| Action | Financial effect |
| --- | --- |
| Income | Cash increases; income increases. |
| Expense | Cash decreases or card debt increases; spending increases. |
| Internal transfer | One asset decreases; another increases. Only an explicitly entered fee is spending. |
| Borrowing | Cash and debt both increase; income does not change. |
| Repayment | Cash falls by principal + interest + fees. Principal reduces debt; interest/fees are spending. |
| Refund | Returns value to the original account and reverses its original expense category. Cumulative active refunds cannot exceed the original expense. |
| Opening, reconciliation, valuation | An explicit delta against `@equity`; never income or spending. |

Opening/reconciliation/valuation inputs contain the target signed account balance. New postings record its difference from the active as-of balance. Liability targets are negative, except a card may hold a positive credit. Manual assets cannot have negative values. When editing, the original transaction is excluded before computing the replacement. Earlier edits do not rewrite later historical adjustment postings silently; the adjustment remains auditable and may require a new reconciliation.

Transfers to and from tracked manual assets remain supported. Initialized loan balances must never become positive, and initialized manual asset balances must never become negative, at any effective date. Validation considers later stored adjustments too, so a backdated transfer cannot make a later valuation delta create an impossible balance. Card accounts can legitimately hold positive credits; bank accounts can legitimately be overdrawn.

Phase A records a card purchase in full, including purchases paid in installments. It does not build a statement or amortization engine. The total existing card opening debt includes unpaid future installments once. Dated card payment obligations are entered manually. A debit card is a payment method attached to its bank account, not a second balance.

## Obligations and cash forecasting

A recurring template is a plan; its dated occurrences are expected obligations. Neither changes actual balances. Actual expense or repayment transactions link to occurrences via payment allocations. Each active linked payment is allocated in full once; voiding removes that allocation. Partial payments reduce the remaining amount. Known obligations cannot be overpaid. Unknown amounts remain unknown after a partial payment until the expected amount is supplied.

Monthly recurrences retain their original day: January 31 → February 28/29 → March 31. Reports read materialized occurrences, not invented payments. Cancelled occurrences contribute no future obligation. Unpaid overdue obligations remain included through the selected month's end.

The dashboard's paid-this-month metric means the portion already settled against obligations **due in the displayed month**, including prepayments made earlier. It excludes payments of older or future-month obligations. Actual cash movement continues to use the transaction date. The paid metric propagates obligation completeness; its legacy raw subtotal must not be used to turn an unreviewed month into an apparent known zero.

A subscription paid by credit card is a card charge, not an immediate cash withdrawal. Cash obligation totals include the separate bank-funded card settlement and exclude the card charge, preventing double counting. An outstanding card balance without a dated settlement is a forecasting gap. A future settlement date does not mean all future installment principal is due this month.

Available money sums initialized, selected spendable bank/cash/savings balances, including negative balances. Available after obligations subtracts only unpaid cash obligations funded by those included accounts, through month-end including overdue amounts. Unknown funding or amount and incomplete coverage prevent a definitive headline. Expected income is not silently added. Fixed monthly cash obligations sum relevant active templates once and exclude card-funded charges whose eventual settlement is represented separately.

## Summary completeness

`Metric` is either `known` with an exact `amountMinor`, or `unknown`/`incomplete` with `amountMinor: null`, a `knownSubtotalMinor`, and reasons. Missing openings, unreviewed account/debt/asset/obligation coverage, missing payment amounts or funding accounts, and unresolved card timing propagate into dependent summaries. Explicitly confirmed zero differs from missing data. A failed request is not an empty dataset and must be handled by the data/UI layer without displaying zero totals.

An unknown account may expose its recorded movement subtotal, but that is not its actual balance and is excluded from aggregate known balance subtotals. Unknown bank/card balances affect both asset and liability completeness because they may be positive or negative. Archived accounts retain their financial values; archiving cannot erase money or debt.

Spending equals expense postings net of refunds; income equals the inverse of income postings. Cash movement totals active movements on all bank/cash/savings accounts, excluding openings, reconciliation, and valuation. Internal cash transfers cancel. A tracking start after the beginning of the month makes monthly flows incomplete. Net worth is the estimated value of tracked assets minus tracked liabilities; account overdrafts are classified as liabilities once. Manual valuation freshness must remain visible in the asset interface.

## Independent backup

`backup.ts` validates the versioned envelope, exact money strings, UUIDs, dates, positive revisions, opening metadata, references, schedule consistency, posting semantics, cumulative refunds, and payment allocations. Balanced but semantically false transactions are rejected. Historical adjustment postings are validated as balanced account/equity pairs without recomputing them against subsequently edited history. Unknown and coverage states are preserved. Audit/receipt payloads must be plain JSON. Errors do not contain raw financial values.

Only the authenticated server applies a validated restore atomically under an owner scope and generation check. JSON validation is independently usable before that write. CSV is a readable export, not a complete restore format.
