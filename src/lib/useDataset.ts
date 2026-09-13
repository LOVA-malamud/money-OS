import { useCallback, useEffect, useRef, useState } from 'react';
import type { Command, CommandAction, Dataset, MutationResult } from '../domain/types';
import { humanError, storageNamespace, supabase } from './supabase';

type PendingEnvelope = { command: Command; draftKey?: string };

/** Online-first: a single uncertain request is retained for explicit retry, never an offline queue. */
export function useDataset(userId: string) {
  const [data, setData] = useState<Dataset | null>(null);
  const current = useRef<Dataset | null>(null);
  const refreshSequence = useRef(0);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [lastLoaded, setLastLoaded] = useState<string | null>(null);
  const pendingKey = `${storageNamespace}:pending:${userId}`;
  const [pending, setPending] = useState<Command | null>(() => {
    try { const raw = localStorage.getItem(pendingKey); return raw ? (JSON.parse(raw) as PendingEnvelope).command : null; } catch { return null; }
  });
  const refresh = useCallback(async () => {
    if (!supabase) return false;
    const sequence = ++refreshSequence.current;
    try {
      const result = await supabase.rpc('get_dataset');
      if (sequence !== refreshSequence.current) return false;
      if (result.error) throw result.error;
      const snapshot = result.data as Dataset;
      if (!snapshot || snapshot.schemaVersion !== 1 || !snapshot.settings || !Array.isArray(snapshot.transactions)) throw new Error('Invalid dataset');
      current.current = snapshot;
      setData(snapshot); setLastLoaded(new Date().toISOString()); setError(null);
      const saved = localStorage.getItem(pendingKey);
      if (saved) {
        const envelope = JSON.parse(saved) as PendingEnvelope;
        if (snapshot.operations.some((operation) => operation.id === envelope.command.operationId)) {
          if (envelope.draftKey) localStorage.removeItem(envelope.draftKey);
          localStorage.removeItem(pendingKey); setPending(null);
        }
      }
      return true;
    } catch (cause) { if (sequence === refreshSequence.current) setError(humanError(cause)); return false; }
    finally { if (sequence === refreshSequence.current) setLoading(false); }
  }, [pendingKey]);
  useEffect(() => {
    void refresh();
    const reload = () => { if (document.visibilityState === 'visible' && !busyRef.current) void refresh(); };
    window.addEventListener('online', reload); window.addEventListener('focus', reload); document.addEventListener('visibilitychange', reload);
    return () => { ++refreshSequence.current; window.removeEventListener('online', reload); window.removeEventListener('focus', reload); document.removeEventListener('visibilitychange', reload); };
  }, [refresh]);
  const send = useCallback(async (envelope: PendingEnvelope): Promise<MutationResult> => {
    const { command } = envelope;
    if (!supabase || !current.current) throw new Error('יש להתחבר לפני שמירה.');
    if (!navigator.onLine) throw new Error('אין חיבור כרגע. הטיוטה נשמרה במכשיר; השמירה תתאפשר עם חזרת החיבור.');
    if (busyRef.current) throw new Error('הפעולה הקודמת עדיין נשמרת.');
    const existingRaw = localStorage.getItem(pendingKey);
    if (existingRaw && JSON.stringify((JSON.parse(existingRaw) as PendingEnvelope).command) !== JSON.stringify(command)) throw new Error('תוצאת השמירה הקודמת אינה ודאית. יש לסגור את הטופס ולבחור בבדיקת השמירה לפני שינוי הפעולה.');
    try { localStorage.setItem(pendingKey, JSON.stringify(envelope)); }
    catch { throw new Error('אין מספיק מקום לשמירת פרטי הניסיון במכשיר. לא נשלחה פעולה לשרת.'); }
    ++refreshSequence.current;
    setPending(command); busyRef.current = true; setBusy(true);
    try {
      const result = await supabase.rpc('execute_command', { p_command: command });
      if (result.error) {
        // A structured PostgreSQL/PostgREST rejection proves the transaction was not committed.
        if (result.error.code && !/^5|^08/.test(result.error.code)) { localStorage.removeItem(pendingKey); setPending(null); }
        throw result.error;
      }
      if (envelope.draftKey) localStorage.removeItem(envelope.draftKey);
      localStorage.removeItem(pendingKey); setPending(null);
      await refresh();
      return result.data as MutationResult;
    } catch (cause) { throw new Error(humanError(cause), { cause }); }
    finally { busyRef.current = false; setBusy(false); }
  }, [pendingKey, refresh]);
  const execute = useCallback(async (action: CommandAction, operationId: string = crypto.randomUUID(), draftKey?: string) => {
    if (!current.current) throw new Error('הנתונים עדיין לא נטענו.');
    return send({ command: { ...action, operationId, generation: current.current.generation } as Command, draftKey });
  }, [send]);
  const retryPending = useCallback(async () => {
    const raw = localStorage.getItem(pendingKey);
    if (!raw) return;
    return send(JSON.parse(raw) as PendingEnvelope);
  }, [pendingKey, send]);
  return { data, loading, busy, error, lastLoaded, pending, refresh, execute, retryPending };
}
