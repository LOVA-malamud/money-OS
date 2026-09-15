import { useState } from 'react';
import { ArrowLeft, LockKeyhole, RefreshCw } from 'lucide-react';
import { configurationError, humanError, isLocalTest, supabase } from '../lib/supabase';

export function ConfigurationScreen() {
  return <main className="auth-page" dir="rtl"><div className="auth-brand">Lova</div><h1>לפני שמתחילים</h1>
    <p>נחבר את החשבון הפרטי שלך כדי שהמידע יישמר בבטחה ויהיה זמין גם באייפון וגם במחשב.</p>
    {configurationError === 'privileged-key' ? <div className="notice error-banner">נמצא מפתח בעל הרשאות ניהול. יש להסיר אותו ולהשתמש רק במפתח publishable או anon.</div> : <div className="notice"><p>החיבור לנתונים טרם הוגדר. אין כרגע נתונים פיננסיים להצגה.</p></div>}
    <div className="section"><h2>הגדרה חד־פעמית</h2><p className="muted small">יש למלא בקובץ .env.local את כתובת הפרויקט והמפתח הציבורי, ולהחיל את הוראות ההתקנה שבפרויקט.</p><code className="setup-code">VITE_SUPABASE_URL<br />VITE_SUPABASE_PUBLISHABLE_KEY</code>
      <button className="button button-secondary full-width" onClick={() => window.location.reload()}><RefreshCw size={18} />בדיקת החיבור מחדש</button></div>
    <p className="auth-footer">החשבון מיועד לשימוש אישי. לא נשמרים כאן סיסמאות בנק או פרטי כניסה לבנק.</p>
  </main>;
}
export function AuthScreen({ recovery = false, onRecovered, notice }: { recovery?: boolean; onRecovered?: () => void; notice?: string }) {
  const [email, setEmail] = useState(isLocalTest ? 'owner@lova.test' : '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!supabase) return;
    setBusy(true); setError(''); setMessage('');
    try {
      const result = recovery ? await supabase.auth.updateUser({ password }) : await supabase.auth.signInWithPassword({ email, password });
      if (result.error) throw result.error;
      if (recovery) { setPassword(''); onRecovered?.(); }
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }
  async function reset() {
    if (!email.trim()) { setError('יש להזין את כתובת הדוא״ל של החשבון.'); return; }
    setBusy(true); setError(''); setMessage('');
    try {
      const result = await supabase!.auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
      if (result.error) throw result.error;
      setMessage('אם הכתובת מורשית, יישלח אליה קישור לעדכון הסיסמה. פתחו את המייל המלא ולחצו על הטקסט ״Reset password״ — זהו הקישור, גם אם אינו נראה כמו כפתור.');
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }
  return <main className="auth-page" data-update-blocked={busy || recovery || password.length > 0}><div className="auth-brand">Lova</div><h1>{recovery ? 'סיסמה חדשה' : 'התמונה הכלכלית שלך'}</h1>
    <p>{recovery ? 'בחרו סיסמה חזקה לחשבון הפרטי.' : 'הכסף, ההתחייבויות ומה שנשאר — במקום אחד, ברור ושקט.'}</p>
    {notice && <p className="notice notice-warning" role="alert">{notice}</p>}
    <form className="form-stack" onSubmit={submit}>
      {!recovery && <label className="field"><span>דוא״ל</span><input type="email" dir="ltr" autoComplete="username" required value={email} onChange={(event) => setEmail(event.target.value)} /></label>}
      <label className="field"><span>{recovery ? 'סיסמה חדשה' : 'סיסמה'}</span><input type="password" dir="ltr" minLength={recovery ? 12 : 1} autoComplete={recovery ? 'new-password' : 'current-password'} required value={password} onChange={(event) => setPassword(event.target.value)} /></label>
      {error && <p className="error" role="alert">{error}</p>}{message && <p className="notice" role="status">{message}</p>}
      <button className="button button-primary full-width" disabled={busy}>{busy ? recovery ? 'מעדכנים את הסיסמה…' : 'מתחברים…' : recovery ? 'עדכון הסיסמה' : 'כניסה לחשבון'}<ArrowLeft size={18} /></button>
      {!recovery && <button className="text-button" type="button" disabled={busy} onClick={() => void reset()}>שכחתי סיסמה</button>}
    </form>
    <div className="auth-footer inline"><LockKeyhole size={16} /><span>חשבון פרטי · גישה לבעלים בלבד</span></div>
    {isLocalTest && <p className="notice notice-warning section">סביבת בדיקה מקומית בלבד. פרטי הכניסה נמצאים בהוראות הפיתוח.</p>}
  </main>;
}
