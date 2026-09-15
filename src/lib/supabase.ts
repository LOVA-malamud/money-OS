import { createClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL?.trim() ?? '';
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';
function isPrivileged(value: string): boolean {
  if (value.startsWith('sb_secret_')) return true;
  try { return JSON.parse(atob(value.split('.')[1])).role === 'service_role'; } catch { return false; }
}
export const configurationError = !url || !key ? 'missing' : isPrivileged(key) ? 'privileged-key' : !/^https:\/\//.test(url) && !(import.meta.env.DEV && /^http:\/\/(localhost|127\.0\.0\.1):\d+$/.test(url)) ? 'invalid-url' : null;
export const isLocalTest = import.meta.env.DEV && import.meta.env.VITE_LOCAL_TEST === 'true';
export const supabase = configurationError ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
export const storageNamespace = `lova:${url}`;

export { humanError } from './errors';
