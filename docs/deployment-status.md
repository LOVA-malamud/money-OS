# Public release status

Lova Money OS Phase A is implemented as a static Vite PWA backed by a private Supabase project. The [live app](https://lova-money-os.vercel.app) is reachable. It currently deploys from the project's earlier private GitHub repository; this public source release does not change the Vercel Git integration, production Supabase configuration, or financial data.

The current application supports the financial model described in [financial-model.md](financial-model.md). Public-release validation on 2026-10-06 covered a fresh `npm ci`, 94 unit/database tests, 108 browser cases across mobile Chromium, mobile WebKit and desktop Chromium, TypeScript, ESLint, a production build, two PWA lifecycle tests, and an npm advisory audit with zero reported vulnerabilities. All 26 live static files matched the previously tested application build. See [mobile-touch-investigation.md](mobile-touch-investigation.md) for the reported physical iPhone touch-target defect, the coordinate change, automated evidence, and the remaining device check. Automated WebKit tests do not establish that the physical defect is resolved.

This public document intentionally omits production identifiers, owner details, private deployment URLs, financial records, and operational verification artifacts. The private project retains its original detailed deployment history.
