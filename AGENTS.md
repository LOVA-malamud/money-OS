# Lova Money OS

- Implement Phase A only. Prefer usability, reliability, and a small maintainable application over feature count or infrastructure.
- Money is integer agorot: PostgreSQL bigint, TypeScript bigint, decimal strings in JSON. Centralize all money and reporting math.
- Preserve the balanced internal ledger. Transfers are not income/expenses; borrowing is not income; principal repayments are not spending; interest/fees are spending.
- Openings, explicit reconciliation, and asset valuations must not become ordinary income/spending. Refunds reverse expenses.
- Financial writes are atomic, idempotent, owner-scoped, and revision-checked. Never weaken invariants to pass a test.
- Keep unknown, incomplete, failed requests, and known zero distinct. Propagate completeness through financial summaries.
- Hebrew/RTL and iPhone usability come first. Use logical CSS, isolated numeric text, large touch targets, and Quiet Balance design tokens.
- Normal expense entry is amount → category → save. Preserve drafts and never claim an unconfirmed write is saved.
- Run financial tests after financial changes; verify meaningful user flows and mobile layout. Fix failures before handing off.
- Never log financial data or ship privileged credentials. Maintain independent validated JSON backup/restore.
- Detailed scope and operational instructions belong in docs/, not this file.
