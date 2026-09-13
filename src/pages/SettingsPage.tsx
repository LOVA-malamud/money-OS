import { useRef, useState } from 'react';
import { ArrowRight, Download, Upload, LogOut, Plus, Pencil, ShieldCheck, Smartphone } from 'lucide-react';
import type { Backup, CommandAction, Dataset, EntityInput, EntityName, Settings } from '../domain/types';
import { createBackup, parseBackup, validateBackup } from '../domain/backup';
import { dashboard } from '../domain/reports';
import { todayJerusalem } from '../domain/dates';
import { humanError, supabase } from '../lib/supabase';
import { MetricAmount, Modal } from '../components/Primitives';

function downloadBackup(backup: Backup, safety = false) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = `lova-money-${safety ? 'safety-' : ''}${backup.exportedAt.replace(/[:.]/g, '-')}.json`;
  document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

export default function SettingsPage({ data, onBack, onEntity, execute, onSignOut, pending, sessionKey }: {
  data: Dataset; onBack: () => void; onEntity: (kind: EntityName, existing?: EntityInput) => void;
  execute: (action: CommandAction, operationId?: string) => Promise<unknown>; onSignOut: () => Promise<void>; pending: boolean; sessionKey: string;
}) {
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [candidate, setCandidate] = useState<Backup | null>(null);
  const [safetyToken, setSafetyToken] = useState<string | null>(null);
  const safetyDone = safetyToken !== null;
  const [confirmed, setConfirmed] = useState(false);
  const [restoreOperation, setRestoreOperation] = useState(crypto.randomUUID());
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [trackingStart, setTrackingStart] = useState(data.settings.trackingStart);
  const [trackingConfirmed, setTrackingConfirmed] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const exportKey = `${sessionKey}:last-export`;
  const [lastExport, setLastExport] = useState(() => localStorage.getItem(exportKey));
  const coverage: [keyof Settings, string, string][] = [
    ['accountsReviewed', 'חשבונות הכסף', 'הוספתי את החשבונות שלי ובחרתי אילו מהם זמינים לשימוש.'],
    ['debtsReviewed', 'החובות שלי', 'רשמתי את כל החובות שברצוני לעקוב אחריהם, או אישרתי שאין לי חובות.'],
    ['obligationsReviewed', 'התשלומים הצפויים', 'עברתי על התשלומים עד סוף החודש, כולל חובות ותשלומים באיחור.'],
    ['assetsReviewed', 'הנכסים שלי', 'הוספתי את הנכסים הרלוונטיים והשווי הידוע שלהם, או אישרתי שאין נכסים נוספים.'],
  ];
  async function review(key: keyof Settings, checked: boolean) {
    setError(''); setBusy(true);
    try { await execute({ type: 'save_settings', value: { [key]: checked }, expectedRevision: data.settings.revision }); }
    catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }
  async function freshBackup() {
    const result = await supabase!.rpc('get_dataset');
    if (result.error) throw result.error;
    return createBackup(result.data as Dataset);
  }
  async function saveTrackingStart() {
    if (!trackingConfirmed || !trackingStart || trackingStart > todayJerusalem()) return;
    setError(''); setBusy(true);
    try {
      await execute({ type: 'save_settings', value: { trackingStart }, expectedRevision: data.settings.revision });
      setTrackingConfirmed(false); setMessage('תחילת המעקב עודכנה. התנועות הקיימות לא השתנו.');
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }
  async function exportData(safety = false) {
    setError(''); setMessage(''); setBusy(true);
    try {
      if (pending) throw new Error('יש להשלים את בדיקת השמירה הקודמת לפני יצירת גיבוי מלא.');
      const backup = await freshBackup();
      downloadBackup(backup, safety);
      localStorage.setItem(exportKey, backup.exportedAt); setLastExport(backup.exportedAt);
      if (safety) {
        if (!backup.data.snapshotToken) throw new Error('יש לעדכן את מסד הנתונים לפני שחזור בטוח.');
        setSafetyToken(backup.data.snapshotToken); setConfirmed(false);
      }
      setMessage('קובץ הגיבוי הוכן להורדה. שמרו אותו בתיקייה פרטית מחוץ לשירות.');
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }
  async function selectFile(file?: File) {
    if (!file) return;
    setBusy(true); setError(''); setMessage('');
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error('הקובץ גדול ממגבלת השחזור של 50MB. הנתונים הקיימים לא השתנו.');
      const backup = parseBackup(await file.text());
      setCandidate(backup); setSafetyToken(null); setConfirmed(false); setRestoreOperation(crypto.randomUUID());
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); if (fileInput.current) fileInput.current.value = ''; }
  }
  async function restore() {
    if (!candidate || !safetyToken || !confirmed) return;
    setBusy(true); setError('');
    try {
      // Validate again immediately before the atomic server restore.
      const validated = validateBackup(candidate);
      await execute({ type: 'restore', backup: validated, expectedSnapshotToken: safetyToken }, restoreOperation);
      setCandidate(null); setMessage('הגיבוי שוחזר. היתרות והדוחות חושבו מחדש.');
    } catch (cause) { setError(humanError(cause)); }
    finally { setBusy(false); }
  }
  const preview = candidate ? dashboard(candidate.data, todayJerusalem()) : null;
  return <div className="content-narrow"><div className="page-heading"><div><button className="text-button" onClick={onBack}><ArrowRight size={17}/>חזרה לכסף שלי</button><h1>הגדרות וגיבוי</h1></div><ShieldCheck className="mint" size={26}/></div>
    {error&&<p className="notice error-banner error" role="alert">{error}</p>}{message&&<p className="notice" role="status">{message}</p>}
    <section className="section"><h2>השלמת התמונה</h2><p className="muted small" style={{marginBlock:'10px 16px'}}>אישור הסקירה אינו משלים סכומים חסרים. יתרה שלא הוזנה תישאר לא ידועה.</p>
      <div className="coverage-list">{coverage.map(([key,title,description])=><label className="coverage-row" key={key}><input type="checkbox" checked={Boolean(data.settings[key])} disabled={busy||pending} onChange={(event)=>void review(key,event.target.checked)}/><span><strong>{title}</strong><span className="row-description" style={{display:'block'}}>{description}</span></span></label>)}</div>
      <p className="muted small">תחילת מעקב: <bdi dir="ltr">{data.settings.trackingStart}</bdi> · שקל ישראלי · שעון ירושלים</p>
      <details className="details-block"><summary>עדכון תקופת המעקב</summary><div className="form-stack section"><p className="muted small">אם התחלת באמצע החודש, ההכנסות וההוצאות שלו מוצגות כמידע חלקי. אפשר להקדים את תחילת המעקב אחרי השלמת התנועות החסרות. יתרת פתיחה לבדה אינה משלימה היסטוריה.</p><label className="field"><span>כל התנועות שלי הוזנו החל מתאריך</span><input type="date" dir="ltr" value={trackingStart} max={todayJerusalem()} onChange={event=>{setTrackingStart(event.target.value);setTrackingConfirmed(false);}} /></label><label className="checkbox-field"><input type="checkbox" checked={trackingConfirmed} onChange={event=>setTrackingConfirmed(event.target.checked)}/><span>הזנתי את כל התנועות מתאריך זה.</span></label><button className="button button-secondary" disabled={busy||pending||!trackingConfirmed||!trackingStart||trackingStart>todayJerusalem()} onClick={()=>void saveTrackingStart()}>שמירת תחילת המעקב</button></div></details>
    </section>
    <section className="section"><div className="section-header"><h2>קטגוריות</h2><button className="text-button" onClick={()=>onEntity('category')}><Plus size={18}/>קטגוריה</button></div><div>{data.categories.map((category)=><div className="list-row" key={category.id}><div><span>{category.name}</span><p className="row-description">{category.kind==='income'?'הכנסה':'הוצאה'}{category.pinned?' · מוצמדת להוספה מהירה':''}</p></div><button className="icon-button" aria-label={`עריכת קטגוריה ${category.name}`} onClick={()=>onEntity('category',category)}><Pencil size={17}/></button></div>)}</div></section>
    <section className="section"><h2>הגיבוי שלך, בשליטתך</h2><p className="muted" style={{marginBlock:'12px 20px'}}>גיבוי JSON מלא מאפשר לשחזר את הנתונים גם במסד נתונים חדש, ללא שירות גיבוי בתשלום.</p>
      <div className="inline"><button className="button button-primary" disabled={busy||pending} onClick={()=>void exportData()}><Download size={18}/>יצירת גיבוי JSON</button><button className="button button-secondary" disabled={busy||pending} onClick={()=>fileInput.current?.click()}><Upload size={18}/>שחזור מגיבוי</button></div>
      <input ref={fileInput} type="file" accept="application/json,.json" className="sr-only" aria-label="בחירת קובץ גיבוי" onChange={(event)=>void selectFile(event.target.files?.[0])}/>
      <p className="muted small" style={{marginBlockStart:14}}>הקבצים מכילים מידע פיננסי קריא, ללא סיסמאות או מפתחות גישה.</p><p className="muted small">{lastExport?<>גיבוי אחרון שהוכן במכשיר: <bdi>{new Date(lastExport).toLocaleDateString('he-IL')}</bdi></>:'טרם הוכן גיבוי במכשיר הזה.'}</p>
      {(!lastExport||Date.now()-new Date(lastExport).getTime()>7*24*60*60*1000)&&<p className="notice notice-warning section">כדאי לשמור עותק גיבוי פרטי לפחות פעם בשבוע.</p>}
    </section>
    <section className="section"><h2 className="inline"><Smartphone size={21}/>שימוש באייפון</h2><p className="muted" style={{marginBlockStart:12}}>פתחו את כתובת האפליקציה ב־Safari, הקישו על שיתוף ובחרו ״הוסף למסך הבית״. בשלב הזה שמירת פעולות דורשת חיבור לאינטרנט; טיוטה שלא הושלמה נשמרת במכשיר.</p></section>
    <section className="section"><h2>גישה פרטית</h2><p className="muted small" style={{marginBlock:'10px 18px'}}>הגישה מוגבלת לבעל החשבון. אין הרשמה ציבורית או שמירה של סיסמאות בנק.</p><button className="button button-secondary" onClick={()=>setSignOutOpen(true)} disabled={busy||pending}><LogOut size={17}/>יציאה מהחשבון</button></section>
    {candidate&&preview&&<Modal title="בדיקת הגיבוי לפני שחזור" onClose={()=>{if(!busy)setCandidate(null);}}><div className="form-stack"><p>הגיבוי תקין ונוצר ב־<bdi>{new Date(candidate.exportedAt).toLocaleString('he-IL')}</bdi>.</p>
      <div className="summary-row"><span>חשבונות</span><strong>{candidate.data.accounts.length}</strong></div><div className="summary-row"><span>תנועות, כולל מבוטלות</span><strong>{candidate.data.transactions.length}</strong></div><div className="summary-row"><span>התחייבויות</span><strong>{candidate.data.obligations.length}</strong></div><div className="summary-row"><span>כסף זמין לפי הגיבוי</span><MetricAmount metric={preview.available}/></div><div className="summary-row"><span>שווי נקי לפי הגיבוי</span><MetricAmount metric={preview.netWorth}/></div>
      <div className="notice notice-warning">השחזור יחליף את הנתונים הקיימים. קודם יש להוריד עותק בטיחות ולשמור אותו. קובץ הגיבוי אינו משנה את פרטי הכניסה לחשבון.</div>
      <button className="button button-secondary" disabled={busy||pending} onClick={()=>void exportData(true)}><Download size={18}/>{safetyDone?'הורדת עותק הבטיחות שוב':'הורדת עותק בטיחות'}</button>
      <label className="checkbox-field"><input type="checkbox" checked={confirmed} disabled={!safetyDone||busy} onChange={(event)=>setConfirmed(event.target.checked)}/><span>שמרתי את עותק הבטיחות ואני רוצה להחליף את הנתונים.</span></label>
      {error&&<p className="error" role="alert">{error}</p>}<button className="button button-primary" disabled={!safetyDone||!confirmed||busy||pending} onClick={()=>void restore()}>{busy?'משחזרים…':'שחזור הנתונים'}</button>
    </div></Modal>}
    {signOutOpen&&<Modal title="יציאה מהחשבון" onClose={()=>setSignOutOpen(false)}><div className="form-stack"><p>הנתונים שנשמרו בשרת יישארו. טיוטות מקומיות של החשבון יימחקו מהמכשיר הזה.</p><button className="button button-primary" onClick={()=>void onSignOut().catch((cause)=>setError(humanError(cause)))}>יציאה ומחיקת טיוטות מקומיות</button><button className="button button-secondary" onClick={()=>setSignOutOpen(false)}>להישאר בחשבון</button></div></Modal>}
  </div>;
}
