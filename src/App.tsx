import { useEffect, useState } from 'react';
import type { Session } from '@supabase/supabase-js';
import { AuthScreen, ConfigurationScreen } from './components/Auth';
import { isLocalTest, supabase } from './lib/supabase';
import Workspace from './components/Workspace';

export default function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(Boolean(supabase));
  const [recovery, setRecovery] = useState(false);
  useEffect(() => {
    if (!supabase) return;
    void supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); }).catch(()=>setLoading(false));
    const { data } = supabase.auth.onAuthStateChange((event, next) => { setSession(next); setLoading(false); if (event === 'PASSWORD_RECOVERY') setRecovery(true); });
    return () => data.subscription.unsubscribe();
  }, []);
  if (!supabase) return <ConfigurationScreen />;
  return <>{isLocalTest && <div className="local-test-banner">סביבת בדיקה מקומית · הנתונים אינם נשמרים בענן</div>}
    {loading ? <main className="auth-page" aria-live="polite">טוענים את החשבון הפרטי…</main> : !session || recovery ? <AuthScreen recovery={recovery} onRecovered={() => setRecovery(false)} /> : <Workspace key={session.user.id} userId={session.user.id}/>}
  </>;
}
