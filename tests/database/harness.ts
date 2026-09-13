import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { Command, CommandAction, Dataset, MutationResult } from '../../src/domain/types';

export const OWNER_ID = '11111111-1111-4111-8111-111111111111';
export const OTHER_ID = '22222222-2222-4222-8222-222222222222';
export async function createDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
  `);
  const migration = await readFile(new URL('../../supabase/migrations/202609130001_phase_a.sql', import.meta.url), 'utf8');
  await db.exec(migration);
  await db.query('insert into private.app_owner(user_id) values ($1)', [OWNER_ID]);
  return db;
}
export async function asUser(db: PGlite, userId = OWNER_ID, role: 'authenticated' | 'anon' = 'authenticated') {
  await db.exec('reset role');
  await db.query("select set_config('request.jwt.claim.sub', $1, false)", [userId]);
  await db.exec(`set role ${role}`);
}
export async function dataset(db: PGlite): Promise<Dataset> {
  const r = await db.query<{ data: Dataset }>('select public.get_dataset() as data');
  return r.rows[0]!.data;
}
export async function execute(db: PGlite, action: CommandAction, options: { operationId?: string; generation?: string } = {}): Promise<MutationResult> {
  const generation = options.generation ?? (await dataset(db)).generation;
  const command = { ...action, operationId: options.operationId ?? randomUUID(), generation } as Command;
  const r = await db.query<{ result: MutationResult }>('select public.execute_command($1::jsonb) as result', [JSON.stringify(command)]);
  return r.rows[0]!.result;
}
export async function resetDataset(db: PGlite) {
  await db.exec('reset role');
  await db.exec('truncate table public.money_datasets cascade');
  await asUser(db);
}
