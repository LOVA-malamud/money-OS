import { Select } from './Primitives';
import { useState, type FormEvent } from 'react';
import type { Account, AccountKind, Category, Dataset, Debt, EntityInput, EntityName, Obligation, PaymentMethod, Recurrence } from '../domain/types';
import { formatMoneyInput, parseMoney } from '../domain/money';
import { todayJerusalem } from '../domain/dates';
import { FormDialog } from './EntrySheet';

export const accountKindLabels: Record<AccountKind, string> = {
  bank: 'חשבון בנק', cash: 'מזומן', savings: 'חיסכון', credit_card: 'כרטיס אשראי', loan: 'הלוואה / חוב', asset: 'נכס',
};
const entityLabels: Record<EntityName, string> = {
  account: 'חשבון', paymentMethod: 'אמצעי תשלום', category: 'קטגוריה', debt: 'פרטי חוב', obligation: 'תשלום צפוי', recurrence: 'תשלום קבוע',
};

export interface EntityEditorProps {
  kind: EntityName;
  data: Dataset;
  existing?: EntityInput;
  initialAccountKind?: AccountKind;
  onSave: (entity: EntityName, value: EntityInput, expectedRevision?: number) => Promise<void>;
  onClose: () => void;
}

export function EntityEditor({ kind, data, existing, initialAccountKind = 'bank', onSave, onClose }: EntityEditorProps) {
  const [id] = useState(() => existing?.id ?? crypto.randomUUID());
  const account = kind === 'account' ? existing as Account | undefined : undefined;
  const method = kind === 'paymentMethod' ? existing as PaymentMethod | undefined : undefined;
  const category = kind === 'category' ? existing as Category | undefined : undefined;
  const debt = kind === 'debt' ? existing as Debt | undefined : undefined;
  const obligation = kind === 'obligation' ? existing as Obligation | undefined : undefined;
  const recurrence = kind === 'recurrence' ? existing as Recurrence | undefined : undefined;
  const expected = obligation?.expectedMinor ?? recurrence?.amountMinor;
  const [name, setName] = useState(account?.name ?? method?.name ?? category?.name ?? debt?.creditor ?? obligation?.title ?? recurrence?.title ?? '');
  const [accountKind, setAccountKind] = useState<AccountKind>(account?.kind ?? initialAccountKind);
  const [spendable, setSpendable] = useState(account?.spendable ?? ['bank', 'cash'].includes(initialAccountKind));
  const [archived, setArchived] = useState(account?.archived ?? false);
  const [accountId, setAccountId] = useState(method?.accountId ?? debt?.accountId ?? obligation?.accountId ?? recurrence?.accountId ?? '');
  const [liabilityAccountId, setLiabilityAccountId] = useState(obligation?.liabilityAccountId ?? recurrence?.liabilityAccountId ?? '');
  const [categoryId, setCategoryId] = useState(obligation?.categoryId ?? recurrence?.categoryId ?? '');
  const [amount, setAmount] = useState(expected !== undefined && expected !== null ? formatMoneyInput(expected) : '');
  const [unknownAmount, setUnknownAmount] = useState(Boolean(existing && (kind === 'obligation' ? obligation?.expectedMinor === null : recurrence?.amountMinor === null)));
  const [date, setDate] = useState(obligation?.dueDate ?? recurrence?.startDate ?? todayJerusalem());
  const [endDate, setEndDate] = useState(recurrence?.endDate ?? '');
  const [day, setDay] = useState(String(recurrence?.day ?? Number(todayJerusalem().slice(-2))));
  const [active, setActive] = useState(recurrence?.active ?? !obligation?.cancelled);
  const [suffix, setSuffix] = useState(method?.suffix ?? '');
  const [categoryKind, setCategoryKind] = useState<'expense' | 'income'>(category?.kind ?? 'expense');
  const [pinned, setPinned] = useState(category?.pinned ?? false);
  const [icon, setIcon] = useState(category?.icon ?? 'more-horizontal');
  const [originalAmount, setOriginalAmount] = useState(debt?.originalMinor != null ? formatMoneyInput(debt.originalMinor) : '');
  const [note, setNote] = useState(debt?.note ?? '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const liveAccounts = data.accounts.filter(item => !item.archived || item.id === accountId);
  const paymentAccounts = liveAccounts.filter(item => ['bank', 'cash', 'savings', 'credit_card'].includes(item.kind));
  const liabilityAccounts = liveAccounts.filter(item => ['loan', 'credit_card'].includes(item.kind));
  const hasTransactions = Boolean(account && data.transactions.some(transaction => transaction.postings.some(posting => posting.accountId === account.id)));
  const isSchedule = kind === 'obligation' || kind === 'recurrence';
  const revision = existing?.revision ?? 0;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    try {
      if (!name.trim()) throw new Error(kind === 'debt' ? 'יש לציין למי החוב.' : 'יש להזין שם.');
      let value: EntityInput;
      if (kind === 'account') {
        value = { id, name: name.trim(), kind: accountKind, spendable: ['bank', 'cash', 'savings'].includes(accountKind) && spendable, archived, openingKnown: account?.openingKnown ?? false, openingDate: account?.openingDate ?? null, revision };
      } else if (kind === 'paymentMethod') {
        if (!paymentAccounts.some(item => item.id === accountId)) throw new Error('יש לבחור חשבון שאליו אמצעי התשלום משויך.');
        if (suffix && !/^\d{4}$/.test(suffix)) throw new Error('יש להזין ארבע ספרות אחרונות, או להשאיר ריק.');
        value = { id, name: name.trim(), accountId, suffix, revision };
      } else if (kind === 'category') {
        value = { id, name: name.trim(), kind: categoryKind, pinned, icon, revision };
      } else if (kind === 'debt') {
        if (!liabilityAccounts.some(item => item.id === accountId)) throw new Error('יש לבחור חשבון חוב. ניתן להוסיף אותו דרך ״הכסף שלי״.');
        const originalMinor = originalAmount.trim() ? parseMoney(originalAmount) : null;
        if (originalMinor !== null && originalMinor < 0n) throw new Error('סכום החוב המקורי לא יכול להיות שלילי.');
        value = { id, creditor: name.trim(), accountId, originalMinor: originalMinor?.toString() ?? null, note: note.trim(), revision };
      } else {
        const amountMinor = unknownAmount ? null : parseMoney(amount);
        if (amountMinor !== null && amountMinor < 0n) throw new Error('סכום התשלום לא יכול להיות שלילי.');
        if (!date) throw new Error('יש לבחור תאריך.');
        if (accountId && !paymentAccounts.some(item => item.id === accountId)) throw new Error('יש לבחור חשבון תשלום פעיל.');
        if (liabilityAccountId && !liabilityAccounts.some(item => item.id === liabilityAccountId)) throw new Error('יש לבחור חוב פעיל.');
        if (accountId && accountId === liabilityAccountId) throw new Error('חשבון התשלום והחוב צריכים להיות שונים.');
        if (kind === 'obligation') value = { id, title: name.trim(), dueDate: date, expectedMinor: amountMinor?.toString() ?? null, accountId: accountId || null, liabilityAccountId: liabilityAccountId || null, categoryId: categoryId || null, recurrenceId: obligation?.recurrenceId ?? null, cancelled: !active, revision };
        else {
          const paymentDay = Number(day);
          if (!Number.isInteger(paymentDay) || paymentDay < 1 || paymentDay > 31) throw new Error('יום החיוב צריך להיות בין 1 ל־31.');
          if (endDate && endDate < date) throw new Error('תאריך הסיום צריך להיות אחרי תאריך ההתחלה.');
          value = { id, title: name.trim(), amountMinor: amountMinor?.toString() ?? null, day: paymentDay, startDate: date, endDate: endDate || null, accountId: accountId || null, liabilityAccountId: liabilityAccountId || null, categoryId: categoryId || null, active, revision };
        }
      }
      setSaving(true);
      await onSave(kind, value, existing?.revision);
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'השמירה לא אושרה. אפשר לנסות שוב.'); }
    finally { setSaving(false); }
  }

  return <FormDialog title={`${existing ? 'עריכת' : 'הוספת'} ${entityLabels[kind]}`} onClose={onClose} busy={saving}>
    <form className="form-stack entity-form" onSubmit={submit} noValidate>
      <fieldset disabled={saving} className="entry-fieldset form-stack">
        <label className="field"><span>{kind === 'debt' ? 'למי החוב?' : 'שם'}</span><input data-initial-focus value={name} onChange={event => setName(event.target.value)} required maxLength={120} placeholder={kind === 'obligation' || kind === 'recurrence' ? 'למשל, חשבון הטלפון' : kind === 'debt' ? 'שם הבנק או האדם' : undefined} /></label>
        {kind === 'account' && <>
          <label className="field"><span>סוג החשבון</span><Select value={accountKind} disabled={hasTransactions} onChange={event => { const next = event.target.value as AccountKind; setAccountKind(next); setSpendable(['bank', 'cash'].includes(next)); }}>{Object.entries(accountKindLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
          {hasTransactions && <p className="muted">סוג החשבון נשמר לאחר שנרשמו בו תנועות.</p>}
          {['bank', 'cash', 'savings'].includes(accountKind) && <label className="checkbox-field"><input type="checkbox" checked={spendable} onChange={event => setSpendable(event.target.checked)} /><span>לכלול בכסף הזמין לשימוש</span></label>}
          {!existing && <p className="notice">לאחר יצירת החשבון אפשר להזין יתרה התחלתית. עד אז היתרה תוצג כלא ידועה.</p>}
          {existing && <label className="checkbox-field"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)} /><span>החשבון אינו פעיל</span></label>}
        </>}
        {kind === 'paymentMethod' && <>
          <p className="muted">אמצעי התשלום משתמש ביתרה של החשבון המשויך אליו.</p>
          <label className="field"><span>חשבון משויך</span><Select value={accountId} onChange={event => setAccountId(event.target.value)} required><option value="">בחירת חשבון</option>{paymentAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label className="field"><span>ארבע ספרות אחרונות · לא חובה</span><input inputMode="numeric" dir="ltr" autoComplete="off" value={suffix} maxLength={4} onChange={event => setSuffix(event.target.value.replace(/\D/g, ''))} /></label>
        </>}
        {kind === 'category' && <>
          <label className="field"><span>סוג</span><Select value={categoryKind} onChange={event => setCategoryKind(event.target.value as 'expense' | 'income')}><option value="expense">הוצאה</option><option value="income">הכנסה</option></Select></label>
          <label className="field"><span>סמל</span><Select value={icon} onChange={event => setIcon(event.target.value)}><option value="more-horizontal">כללי</option><option value="utensils">אוכל</option><option value="shopping-bag">קניות</option><option value="house">בית</option><option value="heart">בריאות</option><option value="wallet">כסף</option></Select></label>
          <label className="checkbox-field"><input type="checkbox" checked={pinned} onChange={event => setPinned(event.target.checked)} /><span>להציג בראש רשימת הקטגוריות</span></label>
        </>}
        {kind === 'debt' && <>
          <label className="field"><span>חשבון החוב</span><Select value={accountId} onChange={event => setAccountId(event.target.value)} required><option value="">בחירת חוב</option>{liabilityAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          {liabilityAccounts.length === 0 && <p className="notice">לפני הוספת פרטי החוב, יש ליצור חשבון מסוג ״הלוואה / חוב״ דרך ״הכסף שלי״.</p>}
          <label className="field"><span>סכום מקורי בשקלים · אם ידוע</span><input inputMode="decimal" dir="ltr" value={originalAmount} onChange={event => setOriginalAmount(event.target.value)} /></label>
          <p className="muted">יתרת החוב מחושבת מתוך החשבון. הסכום המקורי הוא מידע נוסף.</p>
          <label className="field"><span>הערות</span><textarea value={note} onChange={event => setNote(event.target.value)} rows={3} maxLength={2000} /></label>
        </>}
        {isSchedule && <>
          <label className="field"><span>סכום צפוי בשקלים</span><input inputMode="decimal" dir="ltr" value={amount} onChange={event => setAmount(event.target.value)} disabled={unknownAmount} placeholder={unknownAmount ? 'עדיין לא ידוע' : '0.00'} /></label>
          <label className="checkbox-field"><input type="checkbox" checked={unknownAmount} onChange={event => setUnknownAmount(event.target.checked)} /><span>הסכום עדיין לא ידוע</span></label>
          <label className="field"><span>{kind === 'recurrence' ? 'תאריך התחלה' : 'מועד התשלום'}</span><input type="date" dir="ltr" value={date} onChange={event => setDate(event.target.value)} required /></label>
          {kind === 'recurrence' && <><div className="field-grid"><label className="field"><span>יום בחודש</span><input type="number" inputMode="numeric" dir="ltr" min="1" max="31" value={day} onChange={event => setDay(event.target.value)} /></label><label className="field"><span>תאריך סיום · לא חובה</span><input type="date" dir="ltr" value={endDate} min={date} onChange={event => setEndDate(event.target.value)} /></label></div><p className="muted">בחודש קצר החיוב ייקבע ליום האחרון בחודש. רישום תשלום בפועל נעשה בנפרד.</p></>}
          <label className="field"><span>חשבון לתשלום · אם ידוע</span><Select value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">עדיין לא ידוע</option>{paymentAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          <label className="field"><span>האם זה תשלום על חוב?</span><Select value={liabilityAccountId} onChange={event => setLiabilityAccountId(event.target.value)}><option value="">לא, זה חשבון או הוצאה</option>{liabilityAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>
          {!liabilityAccountId && <label className="field"><span>קטגוריה</span><Select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">לבחור בעת התשלום</option>{data.categories.filter(item => item.kind === 'expense').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
          {existing && <label className="checkbox-field"><input type="checkbox" checked={active} onChange={event => setActive(event.target.checked)} /><span>{kind === 'recurrence' ? 'התשלום הקבוע פעיל' : 'התשלום עדיין צפוי'}</span></label>}
          {existing && kind === 'recurrence' && <p className="notice">שינוי התבנית מעדכן תשלומים עתידיים שטרם שולמו, כולל התאמות ידניות. תשלומים שכבר שולמו או שמועדם עבר נשמרים.</p>}
        </>}
      </fieldset>
      <div className="sheet-actions">{error && <p className="error" role="alert">{error}</p>}<button className="button button-primary" type="submit" disabled={saving}>{saving ? 'ממתינים לאישור השמירה…' : existing ? 'שמירת שינויים' : 'הוספה'}</button></div>
    </form>
  </FormDialog>;
}
