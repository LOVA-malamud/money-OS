# Lova Money OS

A Hebrew, right-to-left personal finance app for recording money across bank accounts, cash, cards, debts, obligations, and manually valued assets. It is an online-first progressive web app (PWA) with a single-owner Supabase backend. The interface distinguishes a known zero balance from missing or incomplete information.

[Live app](https://lova-money-os.vercel.app) · [Setup guide](docs/setup.md) · [Financial model](docs/financial-model.md)

## What it does

- Quick Add for expenses, plus income, own-account transfers, borrowing, repayments, refunds, openings, and reconciliation.
- Exact integer-agorot money and a balanced double-entry ledger. Principal repayments reduce liabilities; interest and fees count as spending.
- Account and debt balances, manually entered card settlements, monthly recurring obligations, and an explanation of money remaining after known obligations.
- Searchable transaction history with corrections, voids, and undo. Financial writes use operation IDs and revision checks.
- Manual asset valuations and tracked net worth.
- Owner-only access, row-level security, and independently validated JSON backup and atomic restore.
- Installable PWA with a cached app shell. Financial records require an online connection; there is no offline write queue.

The UI follows the Quiet Balance design and is built for Hebrew/RTL and iPhone use. [Phase A scope](docs/phase-a.md) describes the supported financial behavior and deferred features.

## Stack and structure

React 19, TypeScript, Vite 8, Supabase Auth and PostgreSQL power the app. The static frontend is configured for Vercel. Vitest and PGlite cover domain and database behavior; Playwright covers browser and PWA flows.

| Path | Purpose |
| --- | --- |
| `src/domain/` | Bigint money, ledger rules, reports, dates, and backup validation |
| `src/components/`, `src/pages/`, `src/styles/` | Hebrew/RTL interface and design tokens |
| `src/lib/` | Supabase client, data loading, and mobile interaction helpers |
| `supabase/migrations/` | Numbered schema, owner protection, and financial operations |
| `tests/database/`, `tests/e2e/`, `tests/pwa/` | Database, browser, and PWA checks |
| `docs/` | Setup, financial semantics, and quality records |

## Local setup

1. Install Node.js 22.12+ (or 20.19+) and npm, then run `npm ci` using the checked-in lockfile.
2. Create a **new** Supabase project. Apply the two numbered SQL migrations in order, once each, to that new project. Create one Auth user, set its UUID in `private.app_owner`, disable public and anonymous sign-up, and expose only the `public` API schema. Follow [the detailed setup guide](docs/setup.md). **Never replay historical migrations or reset an existing production dataset.**
3. Copy `.env.example` to `.env.local`. Fill in the project's public URL and **publishable** key:

   | Variable | Meaning |
   | --- | --- |
   | `VITE_SUPABASE_URL` | Your Supabase project HTTPS URL |
   | `VITE_SUPABASE_PUBLISHABLE_KEY` | Its browser-safe publishable key |

   These variables are bundled into client code. Never use a service-role/secret key, database password, or access token here.
4. Run `npm run dev` and open the URL Vite prints. Sign in with the owner you provisioned. Missing configuration shows a setup screen, not sample financial records.

For a disposable local environment, run `npm run dev:fixture` and `npm run dev:local` in separate terminals. The latter opens on port 5173 and displays a local-test banner. The fictional fixture account and its credentials are documented in [the setup guide](docs/setup.md). It uses in-memory PostgreSQL via PGlite and never connects to your Supabase project.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start Vite with `.env.local` |
| `npm run dev:fixture` / `npm run dev:local` | Start the disposable test backend and frontend |
| `npm run typecheck` | TypeScript check |
| `npm run lint` | ESLint |
| `npm test` | Unit and database tests |
| `npm run test:database` | Database tests only |
| `npm run test:e2e` | Browser suite against the local fixture |
| `npm run build` | Type-check and build the production PWA into `dist/` |
| `npm run test:pwa` | Build with a fictional public endpoint and run PWA lifecycle/cache/update checks |
| `npm run preview` | Preview `dist/` locally |
| `npm run check` | Typecheck, lint, unit/database tests, and build |

Install the Playwright browsers once with `npx playwright install chromium webkit` before the browser suite. The E2E configuration starts its own disposable servers. The PWA script builds with a fictional endpoint and blocks or supplies all backend requests locally. Neither suite should be pointed at a production financial dataset.

## Deployment and installation

`vercel.json` configures a static Vite build (`npm run build` → `dist/`), single-page routing, and security headers. Configure the same two public `VITE_` variables in Vercel, then set the exact production and local recovery redirect URLs in Supabase Auth. Keep privileged credentials out of the frontend and Vercel build variables. The existing [live app](https://lova-money-os.vercel.app) is reachable; its current deployment remains connected to the project's earlier private GitHub repository. Publishing this source repository alone does not move that Vercel integration.

On iPhone, open the live HTTPS app in Safari and choose **Share → Add to Home Screen**. The service worker caches static assets, not financial API responses. Updates wait while forms or writes are active. Review [mobile touch verification](docs/mobile-touch-investigation.md) before relying on a new installed build.

## Security, status, and limits

This repository contains application code and fictional test data. It does not contain production financial records, exports, environment values, the owner's identity, or privileged keys. `.env.local`, JSON backup downloads, dependencies, builds, test output, and editor artifacts are ignored. Keep personal JSON backups in a private location outside this repository. Supabase enforces one-owner access and row-level security; see [setup](docs/setup.md) and [financial model](docs/financial-model.md).

Phase A is implemented. Card settlements are entered manually; advanced statement and installment automation, bank import, multi-user support, and offline financial writes are outside the current scope. Physical iPhone confirmation of the reported touch-target issue remains pending after the September viewport change. Historical release notes and their limits are summarized in [deployment status](docs/deployment-status.md).

Realistic next steps are to confirm touch targeting on the physical iPhone, keep setup and recovery instructions current, and prioritize further changes from actual usage. Any later database change should use a new additive migration and preserve existing financial data.

## Screenshots

These are real application captures using **fictional local fixture data**:

- [Mobile overview](docs/design/qa/mobile-webkit-overview.png)
- [Mobile Quick Add](docs/design/qa/mobile-webkit-quick-add.png)
- [Accounts and assets](docs/design/qa/mobile-webkit-money.png)
- [Desktop overview](docs/design/qa/desktop-chromium-overview.png)

## License

No open-source license has been selected or added. Contact the maintainer before reusing the code.
