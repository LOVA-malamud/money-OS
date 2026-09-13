import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import type { AccountKind, Dataset, EntityInput, EntityName, FinancialEntryInput, ObligationSummary } from '../domain/types';
import { debtBalance, dashboard, obligationStatus } from '../domain/reports';
import { minor } from '../domain/money';
import { MetricAmount, Money, Empty, dateLabel } from '../components/Primitives';
import { ObligationRow } from './Overview';

export default function ObligationsPage({ data, onEntity, onEntry, onPay }: {
  data: Dataset; onEntity: (kind: EntityName, existing?: EntityInput, accountKind?: AccountKind) => void;
  onEntry: (initial: Partial<FinancialEntryInput>) => void; onPay: (item: ObligationSummary) => void;
}) {
  const [tab, setTab] = useState<'upcoming'|'recurring'|'debts'>('upcoming');
  const summary = dashboard(data);
  const obligations = data.obligations.map((item) => obligationStatus(item, data)).sort((a,b) => a.obligation.dueDate.localeCompare(b.obligation.dueDate));
  const debts = data.accounts.filter((account) => ['loan','credit_card'].includes(account.kind));
  const overdrafts = data.accounts.filter((account) => ['bank', 'cash', 'savings'].includes(account.kind)).map((account) => ({ account, debt: debtBalance(account, data) })).filter((item) => item.debt.status === 'known' && minor(item.debt.amountMinor) > 0n);
  return <div className="content-narrow"><div className="page-heading"><div><h1>התחייבויות</h1><p className="page-subtitle">מה צריך לשלם, ומה כבר מאחוריך</p></div></div>
    <div className="tabs" role="tablist" aria-label="סוג התחייבויות">{([['upcoming','תשלומים'],['recurring','קבועים'],['debts','חובות']] as const).map(([value,label]) => <button key={value} role="tab" aria-selected={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label}</button>)}</div>
    {tab === 'upcoming' && <><div className="section-header"><div><div className="section-label">עוד נשאר לשלם עד סוף החודש</div><div className="money-total"><MetricAmount metric={summary.unpaid}/></div></div><button className="text-button" onClick={()=>onEntity('obligation')}><Plus size={18}/>תשלום</button></div>
      {obligations.length ? obligations.map((item)=><div key={item.obligation.id} className="inline" style={{flexWrap:'nowrap',gap:4}}><div style={{flex:1,minWidth:0}}><ObligationRow item={item} onPay={onPay}/></div><button className="icon-button" onClick={()=>onEntity('obligation',item.obligation)} aria-label={`עריכת ${item.obligation.title}`}><Pencil size={16}/></button></div>) : <Empty title="מה צפוי לרדת החודש?" action={<button className="button button-primary" onClick={()=>onEntity('obligation')}>הוספת תשלום</button>}>נוסיף תשלומים צפויים או נגדיר התחייבות חודשית קבועה. התאריך לבדו לעולם לא מסמן תשלום כשולם.</Empty>}
    </>}
    {tab==='recurring' && <><div className="section-header"><div><div className="section-label">חיובים חודשיים קבועים</div><div className="money-total"><MetricAmount metric={summary.fixedMonthly}/></div></div><button className="text-button" onClick={()=>onEntity('recurrence')}><Plus size={18}/>התחייבות</button></div>
      {data.recurrences.map((recurrence)=><div className="list-row" key={recurrence.id}><div><h3>{recurrence.title}</h3><p className="row-description">ב־{recurrence.day} בכל חודש · {recurrence.active?'פעילה':'לא פעילה'}</p><p className="row-description">{data.accounts.find((account)=>account.id===recurrence.accountId)?.name??'חשבון טרם הוגדר'}</p></div><div className="inline"><strong>{recurrence.amountMinor===null?<span className="warning small">חסר סכום</span>:<Money value={recurrence.amountMinor} compact/>}</strong><button className="icon-button" onClick={()=>onEntity('recurrence',recurrence)} aria-label={`עריכת ${recurrence.title}`}><Pencil size={17}/></button></div></div>)}
      {!data.recurrences.length && <Empty title="הדברים הקבועים שלך" action={<button className="button button-primary" onClick={()=>onEntity('recurrence')}>התחייבות חודשית חדשה</button>}>טלפון, ביטוח או החזר חוב קבוע. אפשר להשאיר סכום לא ידוע ולהשלים אותו בהמשך.</Empty>}
    </>}
    {tab==='debts' && <><div className="section-header"><div><div className="section-label">סך החובות שנרשמו</div><div className="money-total"><MetricAmount metric={summary.debt}/></div></div><button className="text-button" onClick={()=>onEntity('account',undefined,'loan')}><Plus size={18}/>חוב</button></div>
      {debts.map((account)=>{const metadata=data.debts.find((debt)=>debt.accountId===account.id); const amount=debtBalance(account,data); return <section key={account.id} className="section details-block"><div className="section-header"><div><h2>{account.name}</h2><p className="row-description">{metadata?.creditor??'אפשר להוסיף פרטי מלווה'} · {account.kind==='credit_card'?'יתרת חוב בכרטיס':'הלוואה / חוב אישי'}</p></div><div className="money-total"><MetricAmount metric={amount}/></div></div>
        {metadata?.originalMinor && <p className="small muted">סכום מקורי: <Money value={metadata.originalMinor}/></p>}{metadata?.note && <p className="small muted">{metadata.note}</p>}
        <div className="inline"><button className="button button-secondary" onClick={()=>onEntry({kind:account.openingKnown?'repayment':'opening',...(account.openingKnown?{toAccountId:account.id}:{accountId:account.id})})}>{account.openingKnown?'רישום החזר':'הגדרת יתרת חוב'}</button><button className="text-button" onClick={()=>onEntry({kind:'borrowing',toAccountId:account.id})}>קבלת הלוואה</button><button className="text-button" onClick={()=>onEntity('debt',metadata)}>פרטי החוב</button><button className="icon-button" aria-label={`עריכת ${account.name}`} onClick={()=>onEntity('account',account)}><Pencil size={16}/></button></div>
        <div className="section-label section">החזרים אחרונים</div>{data.transactions.filter((tx)=>!tx.voided&&tx.input.kind==='repayment'&&tx.input.toAccountId===account.id).sort((a,b)=>b.input.date.localeCompare(a.input.date)).slice(0,3).map((tx)=><div className="summary-row small" key={tx.id}><span>{dateLabel(tx.input.date)}</span><Money value={tx.input.amountMinor}/></div>)}
      </section>;})}
      {overdrafts.length > 0 && <section className="section"><h2>יתרות חשבון שליליות</h2><p className="row-description">נכללות בסך החובות פעם אחת, מתוך יתרת החשבון.</p>{overdrafts.map(({ account, debt }) => <div className="summary-row" key={account.id}><span>{account.name}{account.archived ? ' · בארכיון' : ''}</span><MetricAmount metric={debt}/></div>)}</section>}
      {!debts.length&&!overdrafts.length&&<Empty title="נרשום למי וכמה חייבים" action={<button className="button button-primary" onClick={()=>onEntity('account',undefined,'loan')}>הוספת חוב</button>}>יתרת החוב והחזר הקרן יישמרו בנפרד מההוצאות הרגילות שלך.</Empty>}
    </>}
  </div>;
}
