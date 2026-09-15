# Phase A Cash and categories — 2026-09-15

Cash uses the existing `account.kind = 'cash'` ledger model. No balance column, parallel wallet ledger, money representation, public RPC or financial posting rule was introduced.

- **הכסף שלי → מזומן** identifies physical money in the wallet. **הוספת כסף** distinguishes the opening amount already held, a withdrawal from a bank, and new cash income. **הפקדה לבנק** uses an ordinary transfer back to a bank.
- Cash is available in expense/income source selection and transfer destinations. Quick Add remembers the last confirmed expense source on the device, including a direct Cash account. Invalid/archived sources are ignored; explicit transaction context and unfinished drafts retain priority.
- דלק, וויד and אטנט are ordinary expense categories, available under **כל הקטגוריות** and promoted by existing recent-category behavior after use.

## Additive database migration

`202609150001_cash_categories.sql` follows the original migration without modifying or rerunning it. It creates two private helpers and an insert trigger for first-time dataset creation, with no client EXECUTE grants. Existing installations are upgraded once inside the migration transaction under the normal dataset lock.

The migration reuses any existing Cash account, even if renamed or archived, and preserves its opening, spendability and history. Only an absent wallet is created; its opening remains **unknown**, never an invented zero. Categories are matched by default ID or trimmed Hebrew expense name, preserving custom records and avoiding duplicate defaults. ID conflicts with other entity types fail and roll back rather than overwriting data.

The migration checks preservation of existing settings, generation, transactions/postings, allocations, accounts, payment methods, categories, debt/obligation/recurrence records, audit entries and operation receipts inside the transaction. It adds only missing entities and their creation audit entries. It does not run defaults on every read or after restore, so older backups still reconstruct their original financial dataset exactly.

Production preflight found an active, spendable Cash account with a known opening; it was reused unchanged. Validated private JSON exports before and after migration confirm existing accounts, payment methods, transactions/postings, allocations, settings, generation, debts, obligations, recurrences and operation receipts are identical. All existing categories and audit entries remain identical; exactly three categories were added. Both exports have file mode `600` in ignored `.local/deployment/`. Production data was not used as test fixtures.

The migration committed once. During the first follow-up verification, the SQL Editor retained the prior buffer; an additional create attempt was rejected immediately because the helper already existed. The editor was cleared, exact query text verified, and read-only verification completed. The original Phase A migration was never rerun; post-upgrade comparison confirms no existing data changed.

## Validation and release

Disposable PostgreSQL tests cover both transfer directions, unchanged total available money/net worth on transfers, opening vs income, cash spending, income, duplicate prevention, preserved existing records, exact older-backup restore, denied non-owner/private-helper access, and whole-migration rollback on an ID conflict. Browser regressions cover wallet setup, withdrawal, all three cash expense categories, remembered Cash, deposit and cash income in Chromium/WebKit.

Release verification is recorded in [deployment-status.md](deployment-status.md).
