import { Banknote, CreditCard, Landmark, Plus, Settings, Pencil, SlidersHorizontal } from 'lucide-react';
import type { Account, AccountKind, Dataset, EntityInput, EntityName, FinancialEntryInput } from '../domain/types';
import { accountBalance } from '../domain/reports';
import { MetricAmount, Money, Empty } from '../components/Primitives';

export const accountKindNames: Record<AccountKind, string> = { bank: 'חשבון בנק', cash: 'מזומן', savings: 'חיסכון', credit_card: 'כרטיס אשראי', loan: 'הלוואה / חוב', asset: 'נכס' };
interface Props {
  data: Dataset;
  onEntity: (kind: EntityName, existing?: EntityInput, accountKind?: AccountKind) => void;
  onEntry: (initial: Partial<FinancialEntryInput>) => void;
  onSettings: () => void;
}
export default function MoneyPage({ data, onEntity, onEntry, onSettings }: Props) {
  function accountRow(account: Account) {
    const balance = accountBalance(account, data);
    const icon = account.kind === 'cash' ? <Banknote size={22} /> : account.kind === 'credit_card' ? <CreditCard size={22} /> : <Landmark size={22} />;
    const valuation = data.transactions.filter((tx) => !tx.voided && ['valuation', 'opening', 'reconcile'].includes(tx.input.kind) && tx.input.accountId === account.id).sort((a,b) => b.input.date.localeCompare(a.input.date))[0];
    return <div key={account.id} className="list-row"><div className="stack" style={{ flex: 1, gap: 10 }}>
      <div className="inline space-between"><div className="inline"><span className="muted">{icon}</span><div><h3>{account.name}</h3><p className="row-description">{accountKindNames[account.kind]}{account.spendable ? ' · זמין לשימוש' : ''}{account.archived ? ' · בארכיון' : ''}</p></div></div><strong><MetricAmount metric={balance} /></strong></div>
      <div className="inline space-between"><p className="small muted">{account.kind === 'asset' && valuation ? <>שווי אושר לאחרונה ב־<bdi dir="ltr">{valuation.input.date}</bdi></> : !account.openingKnown ? 'יתרת הפתיחה טרם הוגדרה' : <>מעקב מ־<bdi dir="ltr">{account.openingDate}</bdi></>}</p><div className="row-actions"><button className="icon-button" onClick={() => onEntity('account', account)} aria-label={`עריכת ${account.name}`}><Pencil size={17} /></button><button className="text-button small" disabled={account.archived} onClick={() => onEntry({ kind: !account.openingKnown ? 'opening' : account.kind === 'asset' ? 'valuation' : 'reconcile', accountId: account.id })}><SlidersHorizontal size={16} />{!account.openingKnown ? 'יתרת פתיחה' : account.kind === 'asset' ? 'עדכון שווי' : 'התאמת יתרה'}</button></div></div>
    </div></div>;
  }
  const cash = data.accounts.filter((account) => ['bank','cash','savings'].includes(account.kind));
  const cards = data.accounts.filter((account) => account.kind === 'credit_card');
  const assets = data.accounts.filter((account) => account.kind === 'asset');
  return <div className="content-narrow"><div className="page-heading"><div><h1>הכסף שלי</h1><p className="page-subtitle">חשבונות, אמצעי תשלום ונכסים</p></div><button className="icon-button" aria-label="הגדרות וגיבוי" onClick={onSettings}><Settings size={23} /></button></div>
    <section><div className="section-header"><h2>החשבונות שלי</h2><button className="text-button" onClick={() => onEntity('account', undefined, 'bank')}><Plus size={18} />חשבון</button></div>
      {cash.length ? cash.map(accountRow) : <Empty title="נוסיף את החשבון הראשון" action={<button className="button button-primary" onClick={() => onEntity('account', undefined, 'bank')}>הוספת חשבון</button>}>יתרת פתיחה תיתן נקודת התחלה ברורה. אפשר להוסיף גם מזומן וחיסכון.</Empty>}
    </section>
    <section className="section"><div className="section-header"><h2>כרטיסי אשראי</h2><button className="text-button" onClick={() => onEntity('account', undefined, 'credit_card')}><Plus size={18} />כרטיס</button></div>{cards.map(accountRow)}{!cards.length && <p className="small muted">אין כרטיסי אשראי שהוגדרו. חיוב דביט מקושר לחשבון הבנק באמצעי התשלום.</p>}</section>
    <section className="section"><div className="section-header"><h2>אמצעי תשלום</h2><button className="text-button" onClick={() => onEntity('paymentMethod')}><Plus size={18} />אמצעי תשלום</button></div>{data.paymentMethods.map((method) => <div className="list-row" key={method.id}><div><h3>{method.name}{method.suffix && <> · <bdi dir="ltr">{method.suffix}</bdi></>}</h3><p className="row-description">מקושר ל־{data.accounts.find((account) => account.id === method.accountId)?.name}</p></div><button className="icon-button" aria-label={`עריכת ${method.name}`} onClick={() => onEntity('paymentMethod', method)}><Pencil size={17} /></button></div>)}{!data.paymentMethods.length && <p className="small muted">אפשר להוסיף כרטיס דביט או שם נוח לאמצעי שבו משתמשים ביום־יום. הוא לא ייצור יתרה נוספת.</p>}</section>
    <section className="section"><div className="section-header"><h2>הנכסים שלי</h2><button className="text-button" onClick={() => onEntity('account', undefined, 'asset')}><Plus size={18} />נכס</button></div>{assets.map(accountRow)}{!assets.length && <p className="small muted">השקעות, פנסיה או נכס אחר — לפי שווי ידני עם תאריך עדכון.</p>}</section>
    <div className="section notice"><p>יתרה לא ידועה אינה <Money value="0" compact />. אפשר להשלים את הסקירה ולאשר גם שאין נכסים או חובות נוספים.</p><button className="text-button" onClick={onSettings}>הגדרות, סקירה וגיבוי</button></div>
  </div>;
}
