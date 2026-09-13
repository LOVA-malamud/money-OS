import { useMemo, useState } from 'react';
import { ChevronLeft, ArrowDownLeft, ArrowUpRight } from 'lucide-react';
import type { Dataset, DashboardSummary, Metric, ObligationSummary } from '../domain/types';
import { dashboard, accountBalance } from '../domain/reports';
import { todayJerusalem } from '../domain/dates';
import { MetricAmount, MetricDetails, Money, Modal, dateLabel } from '../components/Primitives';

const titles: Record<string, string> = {
  available: 'כמה יש לי עכשיו?', remaining: 'יתרה לאחר התחייבויות', spending: 'הוצאות החודש', income: 'הכנסות החודש',
  dueThisMonth: 'סך התשלומים החודש', unpaid: 'עוד נשאר לשלם', fixedMonthly: 'חיובים חודשיים קבועים', debt: 'סך החובות', netWorth: 'שווי נקי', cashMovement: 'תנועת כסף בחשבונות',
};
const descriptions: Record<string, string> = {
  available: 'היתרות הנוכחיות בחשבונות שסימנת כזמינים לשימוש. יתרה שלילית נכללת בחישוב. מסגרת אשראי אינה כסף זמין.',
  spending: 'ההוצאות שנרשמו החודש, לאחר החזרים כספיים. רכישה באשראי נרשמת פעם אחת; החזר קרן של חוב אינו הוצאה חדשה.',
  income: 'הכנסות שהתקבלו ונרשמו בפועל. העברות בין החשבונות שלך, הלוואות והחזרים כספיים אינם הכנסה רגילה.',
  dueThisMonth: 'כל התשלומים הידועים שמועד פירעונם בחודש הנוכחי, כולל תשלומים שכבר שולמו. תשלומים באיחור מחודשים קודמים מוצגים בנפרד ביתרה לתשלום.',
  unpaid: 'מה שעוד נותר לשלם עד סוף החודש, כולל יתרות באיחור. סכומים שכבר שולמו אינם נספרים שוב.',
  fixedMonthly: 'הסכומים בתבניות החודשיות הפעילות: חשבונות קבועים והחזרים קבועים של חובות. אלה כבר נכללים בתשלומים הצפויים, ולא מופחתים שוב.',
  debt: 'יתרות החובות שנרשמו, כולל הלוואות, כרטיסי אשראי ויתרות בנק שליליות. ריבית עתידית שלא חויבה אינה מתווספת אוטומטית.',
  netWorth: 'הנכסים שנרשמו פחות החובות שנרשמו. הערכות שווי ידניות נשארות בערכן האחרון עד לעדכון שלך.',
  cashMovement: 'השינוי מכניסות ויציאות בחשבונות הבנק, המזומן והחיסכון. הוא כולל הלוואות והחזרי קרן; העברות בתוך הקבוצה מתאפסות. יתרות פתיחה והתאמות אינן תזרים.',
};
export function ObligationRow({ item, onPay }: { item: ObligationSummary; onPay: (item: ObligationSummary) => void }) {
  const status = { due: 'לתשלום', paid: 'שולם', partial: 'שולם חלקית', overdue: 'באיחור', unknown: 'חסר סכום', cancelled: 'בוטל' }[item.status];
  return <div className="list-row"><button className="row-button" onClick={() => onPay(item)} aria-label={`פרטי תשלום: ${item.obligation.title}`}>
    <div><div className="row-title">{item.obligation.title}</div><div className="row-description">{dateLabel(item.obligation.dueDate)}{item.status !== 'due' && <> · <span className={item.status === 'overdue' ? 'danger' : 'warning'}>{status}</span></>}</div></div>
    <div className="inline"><strong>{item.remainingMinor === null ? <span className="small warning">חסר מידע</span> : <Money value={item.remainingMinor} compact />}</strong><ChevronLeft size={18} className="muted" /></div>
  </button></div>;
}
export default function Overview({ data, onObligations, onSettings, onPay }: { data: Dataset; onObligations: () => void; onSettings: () => void; onPay: (item: ObligationSummary) => void }) {
  const today = todayJerusalem();
  const summary = useMemo(() => dashboard(data, today), [data, today]);
  const [detail, setDetail] = useState<keyof DashboardSummary | null>(null);
  const selected = detail ? summary[detail] as Metric : null;
  const incomplete = [summary.available, summary.remaining, summary.debt, summary.netWorth].some((metric) => metric.status !== 'known');
  const upcoming = summary.upcoming.filter((item) => item.status !== 'cancelled' && item.status !== 'paid');
  const summaryRow = (key: 'dueThisMonth' | 'unpaid' | 'fixedMonthly' | 'debt' | 'netWorth') => <button className="metric-button summary-row" key={key} onClick={() => setDetail(key)}><span>{titles[key]}</span><span className="metric-value"><MetricAmount metric={summary[key]} /></span></button>;
  return <>
    <div className="overview-grid">
      <div>
        <section className="hero" aria-label="עכשיו"><button className="metric-button" onClick={() => setDetail('available')}>
          <h1 className="hero-label">זמין עכשיו</h1><div className={summary.available.status === 'known' ? 'hero-number' : 'hero-unknown'}><MetricAmount metric={summary.available} /></div>
        </button><button className="after-obligations" onClick={() => setDetail('remaining')} aria-label="איך מחושבת היתרה לאחר התחייבויות">
          <div className="label">יתרה לאחר התחייבויות</div><div className="value"><MetricAmount metric={summary.remaining} /></div>
          <div className="explanation">עד {dateLabel(summary.horizon)} · לפי ההתחייבויות הידועות</div>
        </button><button className="text-button small" onClick={() => setDetail('remaining')}>איך זה מחושב?<ChevronLeft size={16} /></button></section>
        {incomplete && <div className="notice notice-warning"><span>נשלים את התמונה כדי להציג יתרות שאפשר להבין.</span><button className="text-button" onClick={onSettings}>סקירת הנתונים שלי<ChevronLeft size={16} /></button></div>}
        <section className="month-pair" aria-label="החודש">
          <button className="metric-button" onClick={() => setDetail('spending')}><span className="metric-label inline"><ArrowUpRight size={15} />הוצאות החודש</span><div className="metric-value"><MetricAmount metric={summary.spending} /></div>{summary.spending.status !== 'known' && <div className="row-description">נרשם: <Money value={summary.spending.knownSubtotalMinor} compact /></div>}</button>
          <button className="metric-button" onClick={() => setDetail('income')}><span className="metric-label inline"><ArrowDownLeft size={15} />הכנסות החודש</span><div className="metric-value"><MetricAmount metric={summary.income} /></div>{summary.income.status !== 'known' && <div className="row-description">נרשם: <Money value={summary.income.knownSubtotalMinor} compact /></div>}</button>
        </section>
      </div>
      <section className="section" aria-label="התשלומים הקרובים"><div className="section-header"><h2>התשלומים הקרובים</h2></div>
        {upcoming.length ? <div>{upcoming.slice(0, 3).map((item) => <ObligationRow key={item.obligation.id} item={item} onPay={onPay} />)}</div> : <p className="muted">{summary.unpaid.status === 'known' ? 'אין תשלומים ידועים שנותרו עד סוף החודש.' : 'יש תשלומים או מועדים שעדיין צריך להשלים.'}</p>}
        <button className="text-button" onClick={onObligations}>לכל ההתחייבויות<ChevronLeft size={16} /></button>
      </section>
      <div className="overview-position">
        <section className="section"><h2>ההתחייבויות החודש</h2><div className="section">{summaryRow('dueThisMonth')}<div className="summary-row"><span className="muted">כבר שולם מתוך תשלומי החודש</span><MetricAmount metric={summary.paidThisMonth} /></div>{summaryRow('unpaid')}{summaryRow('fixedMonthly')}</div></section>
        <section className="section"><h2>המצב הכלכלי</h2><div className="section">{summaryRow('debt')}{summaryRow('netWorth')}</div><button className="text-button small" onClick={() => setDetail('cashMovement')}>מה השתנה בחשבונות?<ChevronLeft size={16} /></button><p className="muted small">לפי הנתונים שהוזנו. שווי נכסים מבוסס על העדכון הידני האחרון.</p></section>
      </div>
    </div>
    {detail && selected && <Modal title={titles[detail] ?? ''} onClose={() => setDetail(null)}>
      {detail === 'remaining' ? <div className="form-stack"><p className="muted">עד {dateLabel(summary.horizon)}, כולל תשלומים באיחור.</p>
        <div className="summary-row"><span>כסף זמין עכשיו</span><strong><MetricAmount metric={summary.available} /></strong></div>
        {summary.includedAccounts.map((account) => <div className="inline space-between small" key={account.id}><span className="muted">{account.name}</span><MetricAmount metric={accountBalance(account, data)} /></div>)}
        <div className="summary-row"><span>פחות התחייבויות מהחשבונות הזמינים</span><strong className="inline" dir="ltr"><span className="calc-operator" aria-hidden="true">−</span><MetricAmount metric={summary.remainingObligations} /></strong></div>
        {summary.remainingObligationItems.map((item) => <div className="inline space-between small" key={item.obligation.id}><span>{item.obligation.title} · {dateLabel(item.obligation.dueDate)}</span>{item.remainingMinor === null ? <span className="warning">חסר מידע</span> : <Money value={item.remainingMinor} />}</div>)}
        {summary.remainingObligationItems.length === 0 && summary.remainingObligations.status === 'known' && summary.remainingObligations.amountMinor === '0' && <p className="muted small">אין התחייבויות שטרם שולמו מהחשבונות הזמינים עד סוף החודש.</p>}
        <div className="calculation-result"><span>יתרה לאחר התחייבויות</span><div className="money-total inline" dir="ltr"><span className="calc-operator" aria-hidden="true">=</span><MetricAmount metric={summary.remaining} /></div></div>
        <MetricDetails metric={summary.remaining} /><p className="muted small">הכנסות עתידיות והוצאות יומיומיות שעדיין לא נרשמו אינן נכללות. זה אינו סכום מובטח שאפשר להוציא.</p>
      </div> : <div className="form-stack"><p className="muted">{descriptions[detail]}</p><div className="money-total"><MetricAmount metric={selected} /></div><MetricDetails metric={selected} />
        {detail === 'available' && summary.includedAccounts.map((account) => <div className="summary-row" key={account.id}><span>{account.name}</span><MetricAmount metric={accountBalance(account, data)} /></div>)}
        {detail === 'netWorth' && <><div className="summary-row"><span>נכסים שנרשמו</span><MetricAmount metric={summary.assets} /></div><div className="summary-row"><span>פחות חובות שנרשמו</span><MetricAmount metric={summary.debt} /></div></>}
        {selected.status !== 'known' && <button className="button button-secondary" onClick={() => { setDetail(null); onSettings(); }}>השלמת הנתונים</button>}
      </div>}
    </Modal>}
  </>;
}
