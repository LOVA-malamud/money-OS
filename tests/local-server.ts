/** Local development/test fixture only. Real PostgreSQL (PGlite), no cloud or production auth claims. */
import { createServer, type IncomingMessage } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { asUser, createDatabase, dataset, execute, OWNER_ID, resetDataset } from './database/harness';
import type { Command, FinancialEntryInput } from '../src/domain/types';

if (process.env.NODE_ENV === 'production') throw new Error('The local test fixture cannot run in production.');
const port = Number(process.env.LOVA_TEST_PORT ?? 54321);
const testKey = 'local-fixture-only';
const email = 'owner@lova.test';
let password = 'local-only-passphrase';
const signingSecret = randomUUID();
const refreshTokens = new Set<string>();
const db = await createDatabase();
await asUser(db);
const user = { id: OWNER_ID, aud: 'authenticated', role: 'authenticated', email, email_confirmed_at: new Date().toISOString(), phone: '', app_metadata: { provider: 'email', providers: ['email'] }, user_metadata: {}, identities: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), is_anonymous: false };
function sign(payload: object) {
  const head = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${head}.${body}.${createHmac('sha256', signingSecret).update(`${head}.${body}`).digest('base64url')}`;
}
function session() {
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const refresh = randomUUID(); refreshTokens.add(refresh);
  return { access_token: sign({ sub: OWNER_ID, aud: 'authenticated', role: 'authenticated', email, exp: expiresAt, iat: expiresAt - 3600, iss: `http://127.0.0.1:${port}/auth/v1` }), token_type: 'bearer', expires_in: 3600, expires_at: expiresAt, refresh_token: refresh, user };
}
function authorized(req: IncomingMessage) {
  const token = req.headers.authorization?.replace(/^Bearer /, '') ?? '';
  const [head, body, signature] = token.split('.');
  if (!head || !body || !signature) return false;
  const expected = createHmac('sha256', signingSecret).update(`${head}.${body}`).digest();
  const received = Buffer.from(signature, 'base64url');
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) return false;
  try { const payload = JSON.parse(Buffer.from(body, 'base64url').toString()); return payload.sub === OWNER_ID && payload.exp > Date.now() / 1000; } catch { return false; }
}
async function readBody(req: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { const buffer = Buffer.from(chunk); size += buffer.length; if (size > 50_000_000) throw new Error('REQUEST_TOO_LARGE'); chunks.push(buffer); }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
}
async function seed() {
  const today = (await db.query<{ today: string }>("select (now() at time zone 'Asia/Jerusalem')::date::text today")).rows[0]!.today;
  const first = `${today.slice(0, 7)}-01`;
  const ids = { bank: '20000000-0000-4000-8000-000000000001', savings: '20000000-0000-4000-8000-000000000002', card: '20000000-0000-4000-8000-000000000003', loan: '20000000-0000-4000-8000-000000000004', asset: '20000000-0000-4000-8000-000000000005' };
  const record = (input: FinancialEntryInput) => execute(db, { type: 'record', id: randomUUID(), input });
  // Explicitly known zero only in this disposable populated fixture.
  const wallet = (await dataset(db)).accounts.find(account => account.kind === 'cash')!;
  await record({ kind: 'opening', accountId: wallet.id, amountMinor: '0', date: first });
  for (const [key, name, kind, amount] of [
    ['bank', 'החשבון שלי', 'bank', '1842050'], ['savings', 'חיסכון', 'savings', '1250000'],
    ['card', 'כרטיס אשראי', 'credit_card', '-187500'], ['loan', 'הלוואה משפחתית', 'loan', '-450000'], ['asset', 'רכב', 'asset', '3800000'],
  ] as const) {
    await execute(db, { type: 'save_entity', entity: 'account', value: { id: ids[key], name, kind, spendable: kind === 'bank', openingKnown: false, openingDate: null, archived: false, revision: 1 } });
    await record({ kind: 'opening', accountId: ids[key], amountMinor: amount, date: first });
  }
  await execute(db, { type: 'save_entity', entity: 'paymentMethod', value: { id: '30000000-0000-4000-8000-000000000001', name: 'כרטיס חיוב מיידי', accountId: ids.bank, suffix: '1042', revision: 1 } });
  await execute(db, { type: 'save_entity', entity: 'debt', value: { id: randomUUID(), accountId: ids.loan, creditor: 'משפחה', originalMinor: '600000', note: '', revision: 1 } });
  await record({ kind: 'income', accountId: ids.bank, amountMinor: '1450000', categoryId: '10000000-0000-4000-8000-000000000009', merchant: 'משכורת', date: first });
  await record({ kind: 'expense', accountId: ids.bank, amountMinor: '36580', categoryId: '10000000-0000-4000-8000-000000000002', merchant: 'סופרמרקט', date: today });
  await record({ kind: 'expense', accountId: ids.bank, amountMinor: '4200', categoryId: '10000000-0000-4000-8000-000000000001', merchant: 'קפה בשכונה', date: today });
  await record({ kind: 'expense', accountId: ids.card, amountMinor: '12990', categoryId: '10000000-0000-4000-8000-000000000004', merchant: 'קניות', date: today });
  for (const [title, amount, liability] of [['חשבון אשראי', '200490', ids.card], ['החזר למשפחה', '50000', ids.loan], ['טלפון ואינטרנט', '16900', null]] as const) {
    await execute(db, { type: 'save_entity', entity: 'obligation', value: { id: randomUUID(), title, dueDate: `${today.slice(0, 7)}-28`, expectedMinor: amount, accountId: ids.bank, liabilityAccountId: liability, categoryId: liability ? null : '10000000-0000-4000-8000-000000000005', recurrenceId: null, cancelled: false, revision: 1 } });
  }
  const current = await dataset(db);
  await execute(db, { type: 'save_settings', expectedRevision: current.settings.revision, value: { trackingStart: first, accountsReviewed: true, debtsReviewed: true, obligationsReviewed: true, assetsReviewed: true, lastPaymentMethodId: '30000000-0000-4000-8000-000000000001' } });
}
let chain = Promise.resolve();
const server = createServer((req, res) => {
  const run = async () => {
    const origin = req.headers.origin;
    if (origin && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(origin)) res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Headers', 'authorization, apikey, content-type, content-profile, accept-profile, prefer, x-client-info, x-lova-test-key, x-supabase-api-version');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    const reply = (status: number, data: unknown) => { res.writeHead(status); res.end(JSON.stringify(data)); };
    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return; }
    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      if (url.pathname === '/health') { reply(200, { testOnly: true, database: 'PostgreSQL via PGlite' }); return; }
      const body = await readBody(req);
      if (url.pathname === '/__test/reset') {
        if (req.headers['x-lova-test-key'] !== testKey) { reply(403, { message: 'TEST_KEY_REQUIRED' }); return; }
        await resetDataset(db); if (body.seed === true) await seed(); reply(200, { ok: true }); return;
      }
      if (url.pathname === '/auth/v1/token') {
        if (url.searchParams.get('grant_type') === 'password' && body.email === email && body.password === password) { reply(200, session()); return; }
        if (url.searchParams.get('grant_type') === 'refresh_token' && refreshTokens.has(body.refresh_token)) { refreshTokens.delete(body.refresh_token); reply(200, session()); return; }
        reply(400, { error: 'invalid_grant', error_description: 'Invalid login credentials', msg: 'Invalid login credentials' }); return;
      }
      if (url.pathname === '/auth/v1/recover') { reply(503, { msg: 'Email recovery is unavailable in the local test fixture.' }); return; }
      if (!authorized(req)) { reply(401, { message: 'Unauthorized', code: '42501' }); return; }
      await asUser(db);
      if (url.pathname === '/auth/v1/user') {
        if (req.method === 'PUT') { if (typeof body.password !== 'string' || body.password.length < 12) { reply(422, { msg: 'Password must have at least 12 characters.' }); return; } password = body.password; }
        reply(200, user); return;
      }
      if (url.pathname === '/auth/v1/logout') { refreshTokens.clear(); reply(200, {}); return; }
      if (url.pathname === '/rest/v1/rpc/get_dataset') { reply(200, await dataset(db)); return; }
      if (url.pathname === '/rest/v1/rpc/execute_command') {
        const command = body.p_command as Command;
        const result = await db.query<{ result: unknown }>('select public.execute_command($1::jsonb) result', [JSON.stringify(command)]);
        reply(200, result.rows[0]!.result); return;
      }
      reply(404, { message: 'Not found' });
    } catch (cause) {
      const error = cause as { message?: string; code?: string };
      // Never print request bodies, SQL arguments or PostgreSQL detail/context (which may contain financial data).
      const message = error.message && /^[A-Z_]+$/.test(error.message) ? error.message : 'INVALID_REQUEST';
      reply(400, { message, code: error.code ?? 'P0001', details: null, hint: null });
    }
  };
  chain = chain.then(run, run);
});
server.listen(port, '127.0.0.1', () => process.stdout.write(`Local TEST fixture ready at http://127.0.0.1:${port}; PostgreSQL in memory, no cloud sync.\n`));
process.on('SIGTERM', () => { server.close(); void db.close(); });
process.on('SIGINT', () => { server.close(); void db.close(); });
