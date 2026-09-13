# Lova Money OS

A private Hebrew-first personal finance PWA. React, TypeScript and Vite provide the interface; Supabase Auth and PostgreSQL provide owner-only access and an atomic double-entry ledger. The first release uses Supabase Free and a static frontend; no paid backup service is required.

## Run with your Supabase project

1. Follow [setup and recovery](docs/setup.md) to apply the migration, provision the one owner, and disable public and anonymous registration.
2. Copy `.env.example` to `.env.local` and provide the project URL and publishable key. Never put a secret/service-role key in the frontend.
3. Run `npm ci`, then `npm run dev`.

Without configuration the application displays setup instructions. It does not show synthetic financial balances.

## Run the disposable local test environment

In separate terminals:

```sh
npm run dev:fixture
```

```sh
npm run dev:local
```

Open `http://localhost:5173`. Test login: `owner@lova.test` / `local-only-passphrase`. The clearly labeled fixture runs the actual SQL migration in PostgreSQL via PGlite, with an in-memory dataset. Restarting the fixture discards this test data. It is not a production storage or authentication option.

## Verify

```sh
npm run check
npx playwright install chromium webkit
npm run test:e2e
```

`check` runs TypeScript, ESLint, financial/domain and PostgreSQL integration tests, then builds the production PWA. Browser tests use the local fixture, reset its disposable dataset, and cover mobile and desktop flows. Run them only against that test environment. See `playwright.config.ts` for server startup.

## Project guide

- [Phase A scope and interaction rules](docs/phase-a.md)
- [Financial model and completeness rules](docs/financial-model.md)
- [Supabase, Vercel, installation and recovery](docs/setup.md)
- [Visual and functional QA status](design-qa.md)
- `src/domain/`: centralized bigint money, postings, dates, summaries and backup validation.
- `supabase/migrations/`: versioned PostgreSQL schema, owner access and atomic operations.
- `src/components/`, `src/pages/`, `src/styles/`: Hebrew RTL application and Quiet Balance tokens.
- `tests/`: real PostgreSQL integration and browser workflow tests.

The browser sends decimal strings for money and operation UUIDs for duplicate protection. Financial mutations are checked independently by PostgreSQL. An uncertain request remains pending until its original operation is checked; it is never converted into another transaction. JSON restore validates both sides, requires a safety export and rejects a changed safety snapshot.

## Release boundary

Phase A covers accounts, cash activity, debts, basic cards, monthly obligations, manual assets, understandable summaries, correction history and independent JSON recovery. Advanced card cycles, installment rules, offline synchronization and advanced analytics are deferred. A real Supabase owner login, final HTTPS deployment, password recovery and installation on a physical iPhone must be verified against the user's provisioned environment before relying on it for daily financial records.
