# Phase A setup and recovery

The production application is a static Vite PWA on Vercel Hobby, using Supabase Free for password authentication and PostgreSQL. It is online-first. The local fixture is explicitly test-only and does not provide cloud synchronization or durable storage.

## Supabase Free

1. Create a private Supabase project in your own organization. A Free project is sufficient for Phase A. Save the database password in your password manager; the browser application never uses it.
2. In the SQL Editor, execute `supabase/migrations/202609130001_phase_a.sql` once on the fresh project. The migration creates the ledger, exact `bigint` money columns, owner-only RLS, idempotency receipts, audit history, and the two public RPCs. Future changes belong in additional numbered migrations; do not rerun the initial migration against a populated database.
3. In Authentication → Users, create your sole application user with an email address and a strong unique password; confirm that user through the administrator controls. Use the email address that owns the Supabase organization so the built-in sender can deliver recovery mail to it. Copy the user's UUID.
4. Run this administrator-only SQL, replacing the example with that UUID:

   ```sql
   insert into private.app_owner(user_id)
   values ('REPLACE-WITH-YOUR-AUTH-USER-UUID'::uuid);
   ```

5. Disable **Allow new users to sign up** and anonymous sign-in in Authentication settings. Keep password sign-in enabled. There is no public registration flow. Optional authenticator/TOTP enrollment can follow later; it does not block Phase A.
6. Expose only the `public` schema through the Data API. Never add `private` to exposed schemas. `money_*` tables permit owner-scoped reads only; application writes go through `execute_command`. Do not grant direct table-write access or remove RLS to solve an error.
7. Copy the project URL and **publishable** key from the project settings. A legacy `anon` key also works. Never use a secret/service-role key, database password, or personal access token as a `VITE_` variable.

Create `.env.local` locally (not in version control):

```dotenv
VITE_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-KEY
```

Run `npm install` and `npm run dev`. Sign in with the application user created above. The first load creates an empty financial dataset and Hebrew categories; it does not invent account balances, debts or known-zero completeness.

## Vercel Hobby

Create a Vercel project from this repository using the Vite preset: build command `npm run build`, output directory `dist`. Configure the same two `VITE_` environment variables and redeploy after changing them. Keep `VITE_LOCAL_TEST` unset in hosted builds. No Vercel Functions or privileged credentials are required.

Configure Supabase Authentication's Site URL to the final HTTPS production URL. Add that exact URL and the local development URL as allowed recovery redirects. Do not use a broad production redirect wildcard. Test a real owner login and password-reset link from the final URL, then install the application from Safari's Add to Home Screen menu.

Hobby is intended for personal, non-commercial use. This private personal application fits that assumption; reassess the hosting plan if its purpose changes. Supabase Free projects can pause after low activity; resume a paused project from the Supabase dashboard. A network or paused-project error must remain an error, never become a zero balance. No artificial keep-alive job is required.

## Password recovery without a paid SMTP dependency

Ordinary email/password login does not send email. Supabase's default sender only delivers to organization-team email addresses, currently permits two messages per hour, and provides best-effort delivery. Phase A's owner-only recovery page can use it, but verify delivery once during setup. Do not promise reliable production email delivery from this default service.

If a recovery message cannot be delivered, retain access to the Supabase organization account and use Supabase's administrator recovery capability to update the existing application's user password. The official JavaScript administrator method is `auth.admin.updateUserById(ownerUserId, { password: newPassword })`. Run it only from a trusted local/server administrator context; supply the secret key and new password privately, never in browser code, command arguments, screenshots, logs or committed files. This fallback updates the existing auth user; do not delete and recreate the user, which would change the owner UUID. A private administrator recovery script can be prepared when needed rather than exposing a permanent recovery endpoint.

## Independent JSON backup and restore

- Export a full validated JSON backup after the weekly financial review and before any restore, import or schema migration. Keep dated files outside Supabase and outside the browser cache, for example in a personally controlled backup folder. The application reminds you when the last export is more than seven days old; a download being triggered is not proof that an off-device copy was retained.
- Supabase Free does not provide the paid-tier daily backup recovery guarantee. Data entered since the latest retained independent export can be lost if the project becomes unrecoverable. Paid backup upgrades are optional.
- JSON contains schema version, exact decimal-string minor units, settings, all financial entities, postings, allocations, audit records and operation receipts. It excludes authentication tokens and privileged credentials. CSV is a report, not a complete restore format.
- Restore only while online. Validate the file, review the preview, export the current state as a safety copy, and explicitly confirm replacement. Each server snapshot includes a fingerprint; restore must present the safety copy's fingerprint. Under the same lock used for all writes, the server rejects replacement if any data changed after that export, including a change from another device. Download a new safety copy and confirm again in that case. The server validates the restored ledger again and replaces the dataset atomically. A rejected file leaves the previous data unchanged. A successful restore creates a new dataset generation so stale devices cannot apply new writes against the replaced data. Existing command receipts remain reserved, including the restore's own retry receipt. Older backup files without a fingerprint remain valid restore candidates.
- Financial records and settings come from the restored file. Audit events and reserved operation receipts from both timelines remain available. Editing an individual monthly bill changes only that occurrence and survives refresh and backup/restore; this supports filling in a variable bill whose template amount is unknown. Explicitly editing its recurrence template applies the new template to future unpaid occurrences, including earlier individual overrides. Past or paid occurrences retain their history. Automatic recurrence cancellations can be reversed when a rule is reactivated; a bill explicitly cancelled by the user stays cancelled, including after backup/restore.
- Rehearse recovery before relying on real data: export a small representative ledger, change it, restore the file, and compare account balances, spending, debts, obligations and net worth. To recover to a fresh Supabase project, apply the migrations, provision the owner there, then import the JSON through the application.
- Historical corrections preserve the original reconciliation/valuation postings and audit history. Editing an earlier transaction can change the balance later observed at a reconciliation date; the application does not silently rewrite that historical adjustment.

## Local PostgreSQL fixture for development and browser tests

Run `npx tsx tests/local-server.ts`. It binds only to `127.0.0.1:54321`, applies the actual migration in PostgreSQL through PGlite, and uses an in-memory dataset. It refuses to run with `NODE_ENV=production`. The authentication stub is for testing the UI, not a security substitute for Supabase Auth.

Start Vite with:

```sh
VITE_SUPABASE_URL=http://127.0.0.1:54321 VITE_SUPABASE_PUBLISHABLE_KEY=local-test-public-key VITE_LOCAL_TEST=true npm run dev
```

The fixture login is `owner@lova.test` / `local-only-passphrase`. The interface must display its local-test banner. Restarting the fixture loses its test data. Recovery emails are deliberately unavailable there.

`GET /health` reports readiness. Automated tests can reset it with `POST /__test/reset`, header `x-lova-test-key: local-fixture-only`, and JSON `{}`. Use `{"seed":true}` to create a clearly fictional representative dataset through the same financial RPCs. No production requests are sent.

Run `npx vitest run tests/database` for real PostgreSQL migration/permission/integrity tests. Financial-domain tests, type checking, production build, and browser tests are separate checks; a local fixture pass does not establish that a remote Supabase project has been provisioned correctly.

## References

- [Supabase Auth configuration](https://supabase.com/docs/guides/auth/general-configuration)
- [Supabase default email restrictions](https://supabase.com/docs/guides/auth/auth-smtp)
- [Administrator password recovery](https://supabase.com/docs/reference/javascript/auth-admin-updateuserbyid)
- [Supabase backup coverage](https://supabase.com/docs/guides/platform/backups)
- [Supabase Free project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)
- [Vercel plans](https://vercel.com/docs/plans)
