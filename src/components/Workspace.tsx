import { useEffect, useRef, useState } from 'react';
import { ChartNoAxesColumnIncreasing, List, CalendarDays, Wallet, Plus, RefreshCw, Check, X, ArrowDownLeft, ArrowLeftRight, CornerDownLeft } from 'lucide-react';
import { useRegisterSW } from 'virtual:pwa-register/react';
import type { Account, AccountKind, CommandAction, Dataset, EntityInput, EntityName, FinancialEntryInput, ObligationSummary, Transaction } from '../domain/types';
import { todayJerusalem } from '../domain/dates';
import { buildPostings } from '../domain/ledger';
import { useDataset } from '../lib/useDataset';
import { humanError, storageNamespace, supabase } from '../lib/supabase';
import { EntrySheet } from './EntrySheet';
import { EntityEditor } from './EntityForms';
import { TransactionHistory } from './TransactionHistory';
import { Empty, Modal, Money, dateLabel } from './Primitives';
import Overview from '../pages/Overview';
import MoneyPage from '../pages/MoneyPage';
import ObligationsPage from '../pages/ObligationsPage';
import SettingsPage from '../pages/SettingsPage';

type Page = 'overview'|'history'|'obligations'|'money'|'settings';
type Editor = { kind: 'entry'; key: string; operationId: string; transactionId: string; initial: Partial<FinancialEntryInput>; editing?: Transaction }
  | { kind: 'entity'; key: string; operationId: string; entity: EntityName; existing?: EntityInput; accountKind?: AccountKind } | null;
type Toast = { message: string; undo?: CommandAction };
function initialPage():Page { const page=window.location.hash.slice(1); return ['overview','history','obligations','money','settings'].includes(page)?page as Page:'overview'; }

export default function Workspace({ userId }: { userId: string }) {
  const store = useDataset(userId);
  const { data } = store;
  const [page,setPage] = useState<Page>(initialPage);
  const [editor,setEditor] = useState<Editor>(null);
  const [payDetail,setPayDetail] = useState<ObligationSummary|null>(null);
  const [toast,setToast] = useState<Toast|null>(null);
  const [actionError,setActionError] = useState('');
  const [undoing,setUndoing] = useState(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const [entryCoolingDown,setEntryCoolingDown] = useState(false);
  const cooldownTimer = useRef<ReturnType<typeof setTimeout>|null>(null);
  const { needRefresh:[updateAvailable], updateServiceWorker } = useRegisterSW({ immediate:true });
  const sessionKey = `${storageNamespace}:${userId}`;
  useEffect(()=>{const handle=()=>setPage(initialPage()); window.addEventListener('hashchange',handle); return()=>window.removeEventListener('hashchange',handle);},[]);
  useEffect(()=>()=>{if(toastTimer.current)clearTimeout(toastTimer.current);if(cooldownTimer.current)clearTimeout(cooldownTimer.current);},[]);
  function navigate(next:Page){setPage(next); window.location.hash=next;window.scrollTo({top:0});setActionError('');}
  function showToast(message:string,undo?:CommandAction){setToast({message,undo});if(toastTimer.current)clearTimeout(toastTimer.current);toastTimer.current=setTimeout(()=>setToast(null),12000);}
  function openEntry(initial:Partial<FinancialEntryInput>={}, editing?:Transaction){setPayDetail(null);setEditor({kind:'entry',key:crypto.randomUUID(),operationId:crypto.randomUUID(),transactionId:editing?.id??crypto.randomUUID(),initial:{kind:'expense',...initial},editing});}
  function openEntity(entity:EntityName,existing?:EntityInput,accountKind?:AccountKind){setPayDetail(null);setEditor({kind:'entity',key:crypto.randomUUID(),operationId:crypto.randomUUID(),entity,existing,accountKind});}
  async function saveEntry(input:FinancialEntryInput,transactionId?:string,expectedRevision?:number,providedDraftKey?:string){
    if(!data||editor?.kind!=='entry')return;
    // Fast client validation; PostgreSQL independently constructs and validates the authoritative postings.
    const base:Dataset=transactionId?{...data,transactions:data.transactions.filter((tx)=>tx.id!==transactionId),allocations:data.allocations.filter((allocation)=>allocation.transactionId!==transactionId)}:data;
    buildPostings(input,base);
    const action:CommandAction=transactionId?{type:'edit',id:transactionId,input,expectedRevision:expectedRevision!}:{type:'record',id:editor.transactionId,input};
    const firstKind=editor.editing?.input.kind??editor.initial.kind??'expense';
    const draftKey=providedDraftKey??`lova:${sessionKey}:entry:${editor.editing?.id??`${firstKind}:${editor.initial.obligationId??editor.initial.accountId??'new'}`}`;
    const result=await store.execute(action,editor.operationId,draftKey);
    const undo:CommandAction|undefined=editor.editing?{type:'edit',id:editor.editing.id,input:editor.editing.input,expectedRevision:result.revision!}:['opening','reconcile','valuation'].includes(input.kind)?undefined:{type:'void',id:result.entityId??editor.transactionId,expectedRevision:result.revision!};
    // Absorb a second tap landing on the underlying + after a very fast acknowledgment.
    setEntryCoolingDown(true);
    if(cooldownTimer.current)clearTimeout(cooldownTimer.current);
    cooldownTimer.current=setTimeout(()=>setEntryCoolingDown(false),400);
    setEditor(null);showToast(transactionId?'התנועה עודכנה':'נשמר בהצלחה',undo);
  }
  async function saveEntity(entity:EntityName,value:EntityInput,expectedRevision?:number){
    if(editor?.kind!=='entity')return;
    const isNew=!editor.existing;
    await store.execute({type:'save_entity',entity,value,expectedRevision},editor.operationId);
    setEditor(null);showToast('הפרטים נשמרו');
    if(entity==='account'&&isNew){const account=value as Account;openEntry({kind:'opening',accountId:account.id,date:todayJerusalem()});}
  }
  async function voidTransaction(transaction:Transaction){const result=await store.execute({type:'void',id:transaction.id,expectedRevision:transaction.revision});showToast('התנועה בוטלה והיתרות עודכנו',{type:'unvoid',id:transaction.id,expectedRevision:result.revision!});}
  async function undo(){if(!toast?.undo)return;setUndoing(true);setActionError('');try{await store.execute(toast.undo);showToast('הפעולה בוטלה');}catch(cause){setActionError(humanError(cause));}finally{setUndoing(false);}}
  async function signOut(){if(store.pending)throw new Error('יש להשלים את בדיקת השמירה לפני יציאה.');const result=await supabase!.auth.signOut();if(result.error)throw result.error;for(const key of Object.keys(localStorage)){if(key.startsWith('lova:')&&key.includes(userId))localStorage.removeItem(key);}}
  function startPayment(item:ObligationSummary){
    if(!data)return;
    const obligation=item.obligation;
    if(item.remainingMinor===null||!obligation.accountId){openEntity('obligation',obligation);return;}
    openEntry({kind:obligation.liabilityAccountId?'repayment':'expense',accountId:obligation.accountId,toAccountId:obligation.liabilityAccountId??undefined,categoryId:obligation.categoryId??undefined,amountMinor:item.remainingMinor,obligationId:obligation.id,note:obligation.title});
  }
  if(store.loading&&!data)return <main className="auth-page" aria-live="polite"><div className="auth-brand">Lova</div><p>טוענים את הנתונים שלך…</p></main>;
  if(!data)return <main className="auth-page"><div className="auth-brand">Lova</div><Empty title="הנתונים עדיין לא זמינים" action={<button className="button button-primary" onClick={()=>void store.refresh()}>ניסיון נוסף</button>}>{store.error??'יש לבדוק את החיבור ואת הרשאות החשבון.'}</Empty><button className="text-button" onClick={()=>void signOut().catch((cause)=>setActionError(humanError(cause)))}>יציאה מהחשבון</button>{actionError&&<p role="alert" className="error">{actionError}</p>}</main>;
  const month=new Intl.DateTimeFormat('he-IL',{month:'long',year:'numeric',timeZone:'Asia/Jerusalem'}).format(new Date());
  return <div className="app"><header className="app-header"><div className="header-meta"><span>{month}</span><button className="icon-button" aria-label="רענון נתונים" disabled={store.busy} onClick={()=>void store.refresh()}><RefreshCw size={16}/></button></div><div className="brand">Lova<span className="brand-subtitle">Money OS</span></div></header>
    <main className="page">
      {store.error&&<div className="notice error-banner" role="alert"><p>{store.error}</p><p className="small">מוצגים הנתונים האחרונים שנטענו, לא יתרה עדכנית מאומתת.</p><button className="text-button" onClick={()=>void store.refresh()}>רענון הנתונים</button></div>}
      {actionError&&<div className="notice error-banner" role="alert">{actionError}<button className="icon-button" aria-label="סגירת הודעה" onClick={()=>setActionError('')}><X size={16}/></button></div>}
      {store.pending&&!store.busy&&<div className="notice notice-warning" role="alert"><p>תוצאת השמירה הקודמת לא אושרה. לא תיווצר פעולה נוספת.</p><button className="text-button" onClick={()=>void store.retryPending().then(()=>{setEditor(null);showToast('השמירה נבדקה והושלמה פעם אחת');}).catch((cause)=>setActionError(humanError(cause)))}>בדיקת השמירה וניסיון חוזר</button></div>}
      {page==='overview'&&<Overview data={data} onObligations={()=>navigate('obligations')} onSettings={()=>navigate('settings')} onPay={setPayDetail}/>}
      {page==='history'&&<><div className="page-heading"><div><h1>תנועות</h1><p className="page-subtitle">כל מה שנכנס, יצא והשתנה</p></div><button className="text-button" onClick={()=>openEntry()}><Plus size={18}/>תנועה</button></div><div className="inline" style={{marginBlockEnd:20}}><button className="button button-secondary" onClick={()=>openEntry({kind:'income'})}><ArrowDownLeft size={17}/>הכנסה</button><button className="button button-secondary" onClick={()=>openEntry({kind:'transfer'})}><ArrowLeftRight size={17}/>העברה</button><button className="button button-secondary" onClick={()=>openEntry({kind:'repayment'})}><CornerDownLeft size={17}/>החזר חוב</button></div><TransactionHistory data={data} onEdit={(tx)=>openEntry(tx.input,tx)} onVoid={voidTransaction} onRefund={(tx)=>openEntry({kind:'refund',originalTransactionId:tx.id,accountId:tx.input.accountId,categoryId:tx.input.categoryId})}/></>}
      {page==='obligations'&&<ObligationsPage data={data} onEntity={openEntity} onEntry={openEntry} onPay={setPayDetail}/>}
      {page==='money'&&<MoneyPage data={data} onEntity={openEntity} onEntry={openEntry} onSettings={()=>navigate('settings')}/>}
      {page==='settings'&&<SettingsPage data={data} sessionKey={sessionKey} onBack={()=>navigate('money')} onEntity={openEntity} execute={store.execute} onSignOut={signOut} pending={Boolean(store.pending)}/>}
      <p className="muted small" style={{marginBlockStart:32}}>{store.busy?'שומרים…':store.lastLoaded?<>נטען לאחרונה ב־<bdi>{new Date(store.lastLoaded).toLocaleTimeString('he-IL',{hour:'2-digit',minute:'2-digit'})}</bdi></>:'המידע טרם נטען'}</p>
      {updateAvailable&&!editor&&!store.pending&&<div className="notice section"><p>עדכון חדש לאפליקציה מוכן.</p><button className="text-button" onClick={()=>void updateServiceWorker(true)}>רענון והתקנת העדכון</button></div>}
    </main>
    <nav className="bottom-nav" aria-label="ניווט ראשי"><span className="desktop-nav-title">Lova</span><button className={`nav-item ${page==='overview'?'active':''}`} onClick={()=>navigate('overview')} aria-current={page==='overview'?'page':undefined}><ChartNoAxesColumnIncreasing size={23}/><span>סקירה</span></button><button className={`nav-item ${page==='history'?'active':''}`} onClick={()=>navigate('history')} aria-current={page==='history'?'page':undefined}><List size={23}/><span>תנועות</span></button><button className="nav-add" disabled={entryCoolingDown||store.busy} aria-label="הוספת הוצאה" onClick={()=>openEntry()}><Plus size={28}/></button><button className={`nav-item ${page==='obligations'?'active':''}`} onClick={()=>navigate('obligations')} aria-current={page==='obligations'?'page':undefined}><CalendarDays size={23}/><span>התחייבויות</span></button><button className={`nav-item ${['money','settings'].includes(page)?'active':''}`} onClick={()=>navigate('money')} aria-current={['money','settings'].includes(page)?'page':undefined}><Wallet size={23}/><span>הכסף שלי</span></button></nav>
    {editor?.kind==='entry'&&<EntrySheet key={editor.key} data={data} sessionKey={sessionKey} initial={editor.initial} editing={editor.editing} onClose={()=>{if(!store.busy)setEditor((current)=>current?.key===editor.key?null:current);}} onSave={saveEntry}/>}
    {editor?.kind==='entity'&&<EntityEditor key={editor.key} data={data} kind={editor.entity} existing={editor.existing} initialAccountKind={editor.accountKind} onClose={()=>{if(!store.busy)setEditor((current)=>current?.key===editor.key?null:current);}} onSave={saveEntity}/>}
    {payDetail&&<Modal title={payDetail.obligation.title} onClose={()=>setPayDetail(null)}><div className="form-stack"><p className="muted">מועד תשלום: {dateLabel(payDetail.obligation.dueDate)}</p><div className="summary-row"><span>סכום ההתחייבות</span>{payDetail.obligation.expectedMinor===null?<span className="warning">חסר מידע</span>:<Money value={payDetail.obligation.expectedMinor}/>}</div><div className="summary-row"><span>כבר שולם</span><Money value={payDetail.paidMinor}/></div><div className="summary-row"><span>עוד נשאר לשלם</span>{payDetail.remainingMinor===null?<span className="warning">חסר מידע</span>:<Money value={payDetail.remainingMinor}/>}</div>
      <p className="small muted">חשבון משלם: {data.accounts.find((account)=>account.id===payDetail.obligation.accountId)?.name??'טרם הוגדר'}</p>
      {!['paid','cancelled'].includes(payDetail.status)&&<button className="button button-primary" onClick={()=>startPayment(payDetail)}>{payDetail.remainingMinor===null||!payDetail.obligation.accountId?'השלמת פרטי התשלום':'רישום תשלום'}</button>}<button className="button button-secondary" onClick={()=>openEntity('obligation',payDetail.obligation)}>עריכת ההתחייבות</button></div></Modal>}
    {toast&&<div className="toast" role="status"><span className="inline"><Check size={18}/>{toast.message}</span>{toast.undo&&<button disabled={undoing||store.busy} onClick={()=>void undo()}>ביטול</button>}<button aria-label="סגירת אישור" onClick={()=>setToast(null)}><X size={17}/></button></div>}
  </div>;
}
