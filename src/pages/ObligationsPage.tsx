import { useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import type { AccountKind, Dataset, EntityInput, EntityName, FinancialEntryInput, ObligationSummary } from '../domain/types';
import { debtBalance, dashboard, obligationStatus } from '../domain/reports';
import { minor } from '../domain/money';
import { MetricAmount, Money, Empty, dateLabel } from '../components/Primitives';
import { ObligationRow } from './Overview';

export default function ObligationsPage({ data, onEntity, onEntry, onPay, onSettings }: {
  data: Dataset; onSettings: () => void; onEntity: (kind: EntityName, existing?: EntityInput, accountKind?: AccountKind) => void;
  onEntry: (initial: Partial<FinancialEntryInput>) => void; onPay: (item: ObligationSummary) => void;
}) {
  const [tab, setTab] = useState<'upcoming'|'recurring'|'debts'>('upcoming');
  const summary = dashboard(data);
  const obligations = data.obligations.map((item) => obligationStatus(item, data)).sort((a,b) => Number(['paid','cancelled'].includes(a.status)) - Number(['paid','cancelled'].includes(b.status)) || a.obligation.dueDate.localeCompare(b.obligation.dueDate));
  const debts = data.accounts.filter((account) => ['loan','credit_card'].includes(account.kind));
  const overdrafts = data.accounts.filter((account) => ['bank', 'cash', 'savings'].includes(account.kind)).map((account) => ({ account, debt: debtBalance(account, data) })).filter((item) => item.debt.status === 'known' && minor(item.debt.amountMinor) > 0n);
  return <div className="content-narrow"><div className="page-heading"><div><h1>התחייבויות</h1><p className="page-subtitle">מה צריך לשלם, ומה כבר מאחוריך</p></div></div>
    <div className="tabs" role="tablist" aria-label="סוג התחייבויות">{([['upcoming','תשלומים'],['recurring','קבועים'],['debts','חובות']] as const).map(([value,label]) => <button key={value} role="tab" id={`tab-${value}`} aria-controls={`panel-${value}`} tabIndex={tab===value?0:-1} onKeyDown={event=>{
        const values = ['upcoming','recurring','debts'] as const;
        const index = values.indexOf(value);
        const next = event.key === 'ArrowLeft' ? values[(index+1)%3] : event.key === 'ArrowRight' ? values[(index+2)%3] : event.key === 'Home' ? values[0] : event.key === 'End' ? values[2] : null;
        if(next){event.preventDefault();setTab(next);document.getElementById(`tab-${next}`)?.focus();}
      }} aria-selected={tab===value} className={tab===value?'active':''} onClick={()=>setTab(value)}>{label}</button>)}</div>
    <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`}>
    {tab === 'upcoming' && <><div className="section-header"><div><div className="section-label">עוד נשאר לשלם עד סוף החודש</div><div className="money-total">{(obligations.length > 0 || summary.unpaid.status === 'known') && <MetricAmount metric={summary.unpaid}/>}</div></div><button className="text-button" onClick={()=>onEntity('obligation')}><Plus size={18}/>תשלום</button></div>
      {obligations.length ? obligations.map((item)=><div key={item.obligation.id} className="inline" style={{flexWrap:'nowrap',gap:4}}><div style={{flex:1,minWidth:0}}><ObligationRow item={item} onPay={onPay}/></div><button className="icon-button" onClick={()=>onEntity('obligation',item.obligation)} aria-label={`עריכת ${item.obligation.title}`}><Pencil size={16}/></button></div>) : <Empty title="עדיין לא הוספת תשלומים" action={<button className="button button-primary" onClick={()=>onEntity('obligation')}>הוספת תשלום</button>}>הוסף חשבונות שצריך לשלם ומתי הם יורדים. אחרי התשלום תוכל לסמן כמה שילמת.</Empty>}
    </>}
    {tab==='recurring' && <><div className="section-header"><div><div className="section-label">חיובים חודשיים קבועים</div><div className="money-total">{(data.recurrences.length > 0 || summary.fixedMonthly.status === 'known') && <MetricAmount metric={summary.fixedMonthly}/>}</div></div><button className="text-button" onClick={()=>onEntity('recurrence')}><Plus size={18}/>התחייבות</button></div>
      {data.recurrences.map((recurrence)=><div className="list-row" key={recurrence.id}><div><h3>{recurrence.title}</h3><p className="row-description">ב־{recurrence.day} בכל חודש · {recurrence.active?'פעילה':'לא פעילה'}</p><p className="row-description">{data.accounts.find((account)=>account.id===recurrence.accountId)?.name??'חשבון טרם הוגדר'}</p></div><div className="inline"><strong>{recurrence.amountMinor===null?<span className="warning small">חסר סכום</span>:<Money value={recurrence.amountMinor} compact/>}</strong><button className="icon-button" onClick={()=>onEntity('recurrence',recurrence)} aria-label={`עריכת ${recurrence.title}`}><Pencil size={17}/></button></div></div>)}
      {!data.recurrences.length && <Empty title="עדיין לא הוספת תשלומים קבועים" action={<button className="button button-primary" onClick={()=>onEntity('recurrence')}>התחייבות חודשית חדשה</button>}>טלפון, ביטוח או החזר חוב קבוע. אפשר להשאיר סכום לא ידוע ולהשלים אותו בהמשך.</Empty>}
    </>}
    {tab==='debts' && <><div className="section-header"><div><div className="section-label">סך החובות שנרשמו</div><div className="money-total">{(debts.length > 0 || overdrafts.length > 0 || summary.debt.status === 'known') && <MetricAmount metric={summary.debt}/>}</div></div><button className="text-button" onClick={()=>onEntity('account',undefined,'loan')}><Plus size={18}/>חוב</button></div>
      {debts.map((account)=>{const metadata=data.debts.find((debt)=>debt.accountId===account.id); const amount=debtBalance(account,data); return <section key={account.id} className="section details-block"><div className="section-header"><div><h2>{account.name}</h2><p className="row-description">{metadata?.creditor??'אפשר להוסיף פרטי מלווה'} · {account.kind==='credit_card'?'יתרת חוב בכרטיס':'הלוואה / חוב אישי'}</p></div><div className="money-total"><MetricAmount metric={amount}/></div></div>
        {metadata?.originalMinor && <p className="small muted">סכום מקורי: <Money value={metadata.originalMinor}/></p>}{metadata?.note && <p className="small muted">{metadata.note}</p>}
        <div className="inline"><button className="button button-secondary" onClick={()=>onEntry({kind:account.openingKnown?'repayment':'opening',...(account.openingKnown?{toAccountId:account.id}:{accountId:account.id})})}>{account.openingKnown?'רישום החזר':'הגדרת יתרת חוב'}</button><button className="text-button" onClick={()=>onEntry({kind:'borrowing',toAccountId:account.id})}>קבלת הלוואה</button><button className="text-button" onClick={()=>onEntity('debt',metadata)}>פרטי החוב</button><button className="icon-button" aria-label={`עריכת ${account.name}`} onClick={()=>onEntity('account',account)}><Pencil size={16}/></button></div>
        <div className="section-label section">החזרים אחרונים</div>{data.transactions.filter((tx)=>!tx.voided&&tx.input.kind==='repayment'&&tx.input.toAccountId===account.id).sort((a,b)=>b.input.date.localeCompare(a.input.date)).slice(0,3).map((tx)=><div className="summary-row small" key={tx.id}><span>{dateLabel(tx.input.date)}</span><Money value={tx.input.amountMinor}/></div>)}
      </section>;})}
      {overdrafts.length > 0 && <section className="section"><h2>יתרות חשבון שליליות</h2><p className="row-description">נכללות בסך החובות פעם אחת, מתוך יתרת החשבון.</p>{overdrafts.map(({ account, debt }) => <div className="summary-row" key={account.id}><span>{account.name}{account.archived ? ' · בארכיון' : ''}</span><MetricAmount metric={debt}/></div>)}</section>}
      {!debts.length&&!overdrafts.length&&<Empty title="עדיין לא הוספת חובות" action={<button className="button button-primary" onClick={()=>onEntity('account',undefined,'loan')}>הוספת חוב</button>}>הוסף למי אתה חייב וכמה נשאר להחזיר. תשלום החוב יקטין את היתרה בלי לספור שוב את ההוצאה.</Empty>}
    </>}
    </div>
    {((tab==='debts'&&!data.settings.debtsReviewed)||(tab!=='debts'&&!data.settings.obligationsReviewed))&&<div className="notice"><p>הרשימה עדיין לא אושרה כמלאה. אם אין פריטים נוספים, אפשר לאשר זאת בהגדרות. עד אז הסכום הכולל אינו ידוע.</p><button className="text-button" onClick={onSettings}>סקירה ואישור הרשימה</button></div>}
  </div>;
}
