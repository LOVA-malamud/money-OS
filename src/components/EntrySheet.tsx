import { Select, cycleDialogFocus } from './Primitives';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { ArrowLeftRight, ChevronDown, Delete, Heart, House, MoreHorizontal, ShoppingBag, ShoppingCart, CarFront, Banknote, Percent, BriefcaseBusiness, Utensils, WalletCards, X, Fuel, Leaf, Pill } from 'lucide-react';
import type { Dataset, EntryKind, FinancialEntryInput, Transaction } from '../domain/types';
import { absMoney, formatMoney, formatMoneyInput, minor, parseMoney, subtractMoney } from '../domain/money';
import { todayJerusalem } from '../domain/dates';
import { accountBalance } from '../domain/reports';
import '../styles/forms.css';

export const entryLabels: Record<EntryKind, string> = {
  expense: 'הוצאה', income: 'הכנסה', transfer: 'העברה בין חשבונות', borrowing: 'קבלת הלוואה',
  repayment: 'תשלום חוב', refund: 'החזר כספי', opening: 'יתרה התחלתית',
  reconcile: 'התאמת יתרה', valuation: 'עדכון שווי נכס',
};

export function FormDialog({ title, children, onClose, busy = false, className = '' }: {
  title: string; children: ReactNode; onClose: () => void; busy?: boolean; className?: string;
}) {
  const titleId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const busyRef = useRef(busy);
  closeRef.current = onClose;
  busyRef.current = busy;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const oldOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const frame = requestAnimationFrame(() => {
      const target = dialogRef.current?.querySelector<HTMLElement>('[data-initial-focus]') ?? dialogRef.current?.querySelector<HTMLElement>('input, select, textarea') ?? dialogRef.current?.querySelector<HTMLElement>('button');
      target?.focus();
      if (target instanceof HTMLInputElement && target.dataset.initialFocus !== undefined) target.select();
    });
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      cycleDialogFocus(event, dialogRef.current);
    };
    document.addEventListener('keydown', handleKey);
    return () => { cancelAnimationFrame(frame); document.removeEventListener('keydown', handleKey); document.body.style.overflow = oldOverflow; previous?.focus(); };
  }, []);
  return <div className="sheet-overlay" onMouseDown={event => { if (event.target === event.currentTarget && !busy) onClose(); }}>
    <div className={`sheet form-dialog ${className}`} role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialogRef} dir="rtl">
      <div className="sheet-handle" aria-hidden="true" />
      <header className="sheet-header"><h2 id={titleId}>{title}</h2><button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="סגירה"><X size={24} /></button></header>
      {children}
    </div>
  </div>;
}

type Draft = {
  kind: EntryKind; amount: string; date: string; source: string; toAccountId: string;
  categoryId: string; merchant: string; note: string; interest: string; fee: string;
  originalTransactionId: string; obligationId: string; cardBalanceMode: 'debt' | 'credit';
};
function maxAmountCharacters(value: string): number { return Math.max(1, value.length); }
function editableMoney(value?: string): string {
  return value === undefined ? '' : formatMoneyInput(value);
}
function CategoryIcon({ name }: { name: string }) {
  if (/דלק|fuel/i.test(name)) return <Fuel size={23} />;
  if (/וויד|leaf/i.test(name)) return <Leaf size={23} />;
  if (/אטנט|pill/i.test(name)) return <Pill size={23} />;
  if (/תחבורה|רכב|transport|car|bus/i.test(name)) return <CarFront size={23} />;
  if (/סופר|מכולת|grocer|cart|basket/i.test(name)) return <ShoppingCart size={23} />;
  if (/משכורת|salary|banknote/i.test(name)) return <Banknote size={23} />;
  if (/ריבית|עמלות|percent/i.test(name)) return <Percent size={23} />;
  if (/עבודה|עסק|business|briefcase/i.test(name)) return <BriefcaseBusiness size={23} />;
  if (/אוכל|מזון|מסעד|food|utensils/i.test(name)) return <Utensils size={23} />;
  if (/בית|דיור|house|home/i.test(name)) return <House size={23} />;
  if (/קני|shopping/i.test(name)) return <ShoppingBag size={23} />;
  if (/בריאות|heart|health/i.test(name)) return <Heart size={23} />;
  return <MoreHorizontal size={23} />;
}

export interface EntrySheetProps {
  data: Dataset;
  sessionKey: string;
  onClose: () => void;
  onSave: (input: FinancialEntryInput, transactionId?: string, expectedRevision?: number, draftKey?: string) => Promise<void>;
  initialKind?: EntryKind;
  initial?: Partial<FinancialEntryInput>;
  editing?: Transaction;
}

export function EntrySheet({ data, sessionKey, onClose, onSave, initialKind = 'expense', initial, editing }: EntrySheetProps) {
  const provided = editing?.input ?? initial;
  const firstKind = provided?.kind ?? initialKind;
  const draftKey = `lova:${sessionKey}:entry:${editing?.id ?? `${firstKind}:${initial?.obligationId ?? initial?.accountId ?? 'new'}`}`;
  const draftContext = JSON.stringify({ initial: provided ?? null, revision: editing?.revision ?? null });
  const defaultPayment = data.paymentMethods.find(method => method.id === data.settings.lastPaymentMethodId && data.accounts.some(account => account.id === method.accountId && !account.archived && (firstKind === 'expense' || firstKind === 'refund' ? !['loan', 'asset'].includes(account.kind) : ['bank', 'cash', 'savings'].includes(account.kind))));
  const defaultAccount = data.accounts.find(account => !account.archived && ['bank', 'cash', 'savings'].includes(account.kind));
  const recentSourceKey = `lova:${sessionKey}:last-expense-source`;
  // A direct Cash account is a payment source too. Only remember a confirmed
  // expense; keep this device preference separate from financial records.
  const recentSource = (() => {
    if (firstKind !== 'expense') return '';
    try {
      const source = localStorage.getItem(recentSourceKey) ?? '';
      const id = source.startsWith('method:') ? data.paymentMethods.find(method => method.id === source.slice(7))?.accountId : source.startsWith('account:') ? source.slice(8) : '';
      return data.accounts.some(item => item.id === id && !item.archived && ['bank', 'cash', 'savings', 'credit_card'].includes(item.kind)) ? source : '';
    } catch { return ''; }
  })();
  const buildDefault = (): Draft => ({
    kind: firstKind, amount: provided?.amountMinor !== undefined && ['opening', 'reconcile', 'valuation'].includes(firstKind) && data.accounts.some(item => item.id === provided.accountId && ['credit_card', 'loan'].includes(item.kind)) ? formatMoneyInput(absMoney(provided.amountMinor)) : editableMoney(provided?.amountMinor), date: provided?.date ?? todayJerusalem(),
    source: provided?.paymentMethodId ? `method:${provided.paymentMethodId}` : provided?.accountId ? `account:${provided.accountId}` : recentSource || (defaultPayment ? `method:${defaultPayment.id}` : defaultAccount ? `account:${defaultAccount.id}` : ''),
    toAccountId: provided?.toAccountId ?? '', categoryId: provided?.categoryId ?? '',
    merchant: provided?.merchant ?? '', note: provided?.note ?? '', interest: editableMoney(provided?.interestMinor),
    fee: editableMoney(provided?.feeMinor),
    originalTransactionId: provided?.originalTransactionId ?? '', obligationId: provided?.obligationId ?? '',
    cardBalanceMode: provided?.amountMinor !== undefined && minor(provided.amountMinor) > 0n ? 'credit' : 'debt',
  });
  const [draftState] = useState(() => {
    const defaults = buildDefault();
    try {
      const stored = localStorage.getItem(draftKey);
      if (!stored) return { value: defaults, restored: false };
      const parsed: unknown = JSON.parse(stored);
      if (!parsed || typeof parsed !== 'object') return { value: defaults, restored: false };
      const envelope = parsed as Record<string, unknown>;
      if (envelope.context !== draftContext || !envelope.form || typeof envelope.form !== 'object') return { value: defaults, restored: false };
      const candidate = envelope.form as Record<string, unknown>;
      const clean = { ...defaults };
      for (const key of Object.keys(defaults) as (keyof Draft)[]) {
        if (typeof candidate[key] === 'string' && (candidate[key] as string).length < 4000) (clean as Record<string, string>)[key] = candidate[key] as string;
      }
      clean.kind = typeof candidate.kind === 'string' && Object.hasOwn(entryLabels, candidate.kind) ? candidate.kind as EntryKind : firstKind;
      clean.cardBalanceMode = candidate.cardBalanceMode === 'credit' ? 'credit' : 'debt';
      return { value: clean, restored: true };
    } catch { return { value: defaults, restored: false }; }
  });
  const [form, setForm] = useState<Draft>(draftState.value);
  const [more, setMore] = useState(Boolean(editing || provided?.merchant || provided?.note));
  const [allCategories, setAllCategories] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [draftError, setDraftError] = useState(false);
  const amountRef = useRef<HTMLInputElement>(null);
  const change = <K extends keyof Draft>(key: K, value: Draft[K]) => { setError(''); setForm(current => ({ ...current, [key]: value })); };
  useEffect(() => { try { localStorage.setItem(draftKey, JSON.stringify({ form, context: draftContext })); } catch { setDraftError(true); } }, [draftKey, draftContext, form]);
  const paymentMethod = form.source.startsWith('method:') ? data.paymentMethods.find(method => method.id === form.source.slice(7)) : undefined;
  const accountId = paymentMethod?.accountId ?? (form.source.startsWith('account:') ? form.source.slice(8) : '');
  const account = data.accounts.find(item => item.id === accountId);
  const isBalance = ['opening', 'reconcile', 'valuation'].includes(form.kind);
  const isLiability = account?.kind === 'credit_card' || account?.kind === 'loan';
  const isCardCredit = account?.kind === 'credit_card' && form.cardBalanceMode === 'credit';
  const hasPositiveAmount = (value: string) => { try { return parseMoney(value || '0') > 0n; } catch { return false; } };
  const hasFeeCategory = ['repayment', 'transfer'].includes(form.kind) && (hasPositiveAmount(form.fee) || (form.kind === 'repayment' && hasPositiveAmount(form.interest)));
  const requiresCategory = form.kind === 'expense' || form.kind === 'income' || hasFeeCategory;
  const needsDestination = ['transfer', 'borrowing', 'repayment'].includes(form.kind);
  const needsLiability = form.kind === 'borrowing' || form.kind === 'repayment';
  const liveAccounts = data.accounts.filter(item => !item.archived);
  const sourceAccounts = liveAccounts.filter(item => isBalance ? form.kind === 'valuation' ? item.kind === 'asset' : true : form.kind === 'expense' || form.kind === 'refund' ? item.kind !== 'asset' && item.kind !== 'loan' : form.kind === 'transfer' ? ['bank', 'cash', 'savings', 'asset'].includes(item.kind) : ['bank', 'cash', 'savings'].includes(item.kind));
  const sourceMethods = data.paymentMethods.filter(method => sourceAccounts.some(item => item.id === method.accountId));
  const destinationAccounts = liveAccounts.filter(item => item.id !== accountId && (needsLiability ? ['loan', 'credit_card'].includes(item.kind) : ['bank', 'cash', 'savings', 'asset'].includes(item.kind)));
  const categories = data.categories.filter(category => category.kind === (form.kind === 'income' ? 'income' : 'expense')).sort((a, b) => {
    const rank = (id: string, pinned: boolean) => { const recent = data.settings.recentCategoryIds.indexOf(id); return recent >= 0 ? recent : pinned ? 100 : 200; };
    return rank(a.id, a.pinned) - rank(b.id, b.pinned);
  });
  const shownCategories = allCategories ? categories : categories.slice(0, 6);
  const selectedCategory = categories.find(category => category.id === form.categoryId);
  if (!allCategories && selectedCategory && !shownCategories.includes(selectedCategory)) shownCategories.splice(5, 1, selectedCategory);
  const originalExpenses = data.transactions.filter(transaction => !transaction.voided && transaction.input.kind === 'expense');
  const currentBalance = (() => {
    if (!isBalance || !account || !form.date) return null;
    try { return accountBalance(account, data, form.date); } catch { return null; }
  })();
  const title = editing ? `עריכת ${entryLabels[form.kind]}` : form.kind === 'expense' ? 'הוצאה חדשה' : form.kind === 'income' ? 'הכנסה חדשה' : entryLabels[form.kind];
  const saveLabel = editing ? 'שמירת השינויים' : form.kind === 'expense' ? 'שמירת הוצאה' : form.kind === 'income' ? 'שמירת הכנסה' : 'שמירה';

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (saving) return;
    setError('');
    try {
      if (!account || !sourceAccounts.some(item => item.id === accountId)) throw new Error('יש לבחור חשבון מתאים לתנועה.');
      if (!form.date || form.date > todayJerusalem()) throw new Error('יש לבחור את תאריך התנועה, עד היום.');
      let amount = parseMoney(form.amount);
      if (!isBalance && amount <= 0n) throw new Error('הסכום צריך להיות גדול מאפס.');
      if (isBalance && isLiability) { if (amount < 0n) throw new Error('יש להזין את הסכום כמספר חיובי ולבחור אם הוא חוב או יתרת זכות.'); if (!isCardCredit) amount = subtractMoney(0n, amount); }
      if (requiresCategory && !categories.some(category => category.id === form.categoryId)) throw new Error('יש לבחור קטגוריה.');
      if (needsDestination && !destinationAccounts.some(item => item.id === form.toAccountId)) throw new Error(needsLiability ? 'יש לבחור את החוב המתאים.' : 'יש לבחור חשבון יעד שונה.');
      if (form.kind === 'refund' && !originalExpenses.some(transaction => transaction.id === form.originalTransactionId)) throw new Error('יש לבחור את ההוצאה המקורית להחזר.');
      if (form.kind === 'reconcile' && !form.note.trim()) throw new Error('יש להוסיף סיבה להתאמת היתרה.');
      const input: FinancialEntryInput = {
        kind: form.kind, date: form.date, amountMinor: amount.toString(), accountId,
        ...(paymentMethod ? { paymentMethodId: paymentMethod.id } : {}),
        ...(requiresCategory ? { categoryId: form.categoryId } : {}),
        ...(needsDestination ? { toAccountId: form.toAccountId } : {}),
        ...(form.kind === 'refund' ? { originalTransactionId: form.originalTransactionId } : {}),
        ...(form.obligationId ? { obligationId: form.obligationId } : {}),
        ...(form.merchant.trim() ? { merchant: form.merchant.trim() } : {}),
        ...(form.note.trim() ? { note: form.note.trim() } : {}),
      };
      if (form.kind === 'repayment') {
        if (!form.interest.trim() || !form.fee.trim()) throw new Error('יש לציין ריבית ועמלות, גם כשהן אפס.');
        const interest = parseMoney(form.interest);
        const fee = parseMoney(form.fee);
        const principal = subtractMoney(amount, interest, fee);
        if (interest < 0n || fee < 0n || principal < 0n) throw new Error('הריבית והעמלות צריכות להיות חיוביות או אפס, וביחד לא לעלות על התשלום הכולל.');
        input.principalMinor = principal.toString();
        input.interestMinor = interest.toString();
        input.feeMinor = fee.toString();
      }
      if (form.kind === 'transfer' && form.fee.trim()) input.feeMinor = parseMoney(form.fee).toString();
      if (form.kind === 'refund') {
        const original = originalExpenses.find(transaction => transaction.id === form.originalTransactionId)!;
        if (accountId !== original.input.accountId) throw new Error('ההחזר צריך לחזור לחשבון של ההוצאה המקורית.');
        input.categoryId = original.input.categoryId;
      }
      setSaving(true);
      await onSave(input, editing?.id, editing?.revision, draftKey);
      if (input.kind === 'expense') { try { localStorage.setItem(recentSourceKey, form.source); } catch { /* A preference failure cannot undo a confirmed expense. */ } }
      try { localStorage.removeItem(draftKey); } catch { /* A storage failure does not undo a confirmed transaction. */ }
      onClose();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'השמירה לא אושרה. הפרטים נשארו כאן ואפשר לנסות שוב.'); }
    finally { setSaving(false); }
  }

  function keypad(key: string) {
    const selectedAll = amountRef.current?.selectionStart === 0 && amountRef.current?.selectionEnd === form.amount.length;
    const current = selectedAll ? '' : form.amount.replace(/,/g, '');
    if (key === 'delete') change('amount', current.slice(0, -1));
    else if (key === '.') { if (!current.includes('.')) change('amount', `${current === '-' ? '-0' : current || '0'}.`); }
    else if ((current.split('.')[1]?.length ?? 0) < 2 && current.length < 18) change('amount', current === '0' ? key : current === '-0' ? `-${key}` : `${current}${key}`);
  }

  return <FormDialog title={title} onClose={onClose} busy={saving} className="entry-sheet">
    <form onSubmit={submit} className="form-stack" noValidate>
      <fieldset disabled={saving} className="entry-fieldset">
        {draftState.restored && <p className="draft-note" role="status">הטיוטה האחרונה מחכה לך כאן.</p>}
        {draftError && <p className="notice" role="status">לא ניתן לשמור טיוטה במכשיר כרגע. השאירו את החלון פתוח עד לשמירה.</p>}
        {!editing && !isBalance && !initial?.kind && !initial?.obligationId && <label className="field entry-kind"><span className="sr-only">סוג התנועה</span><Select value={form.kind} onChange={event => { change('kind', event.target.value as EntryKind); change('categoryId', ''); }}>
          {(['expense', 'income', 'transfer', 'repayment', 'borrowing', 'refund'] as EntryKind[]).map(kind => <option key={kind} value={kind}>{entryLabels[kind]}</option>)}
        </Select></label>}
        <label className="entry-amount-label"><span className="sr-only">{isBalance ? isCardCredit ? 'סכום יתרת הזכות בשקלים' : isLiability ? 'סכום החוב בשקלים' : 'יתרה מעודכנת בשקלים' : 'סכום בשקלים'}</span><span className="entry-amount" dir="ltr"><span aria-hidden="true">₪</span><input ref={amountRef} data-initial-focus aria-label={isBalance ? isCardCredit ? 'סכום יתרת הזכות בשקלים' : isLiability ? 'סכום החוב בשקלים' : 'יתרה מעודכנת בשקלים' : 'סכום בשקלים'} className="amount-input" style={{ inlineSize: `${maxAmountCharacters(form.amount)}ch` }} type="text" inputMode="none" autoComplete="off" value={form.amount} onChange={event => change('amount', event.target.value)} placeholder="0" aria-describedby={isBalance ? 'balance-explanation' : undefined} /></span></label>
        {isBalance && account?.kind === 'credit_card' && <label className="field"><span>מצב היתרה בכרטיס</span><Select value={form.cardBalanceMode} onChange={event => change('cardBalanceMode', event.target.value as 'debt' | 'credit')}><option value="debt">חוב לתשלום</option><option value="credit">יתרת זכות בכרטיס</option></Select></label>}
        {isBalance && !isLiability && account?.kind !== 'asset' && <button type="button" className="text-button" aria-pressed={form.amount.startsWith('-')} onClick={() => change('amount', form.amount.startsWith('-') ? form.amount.slice(1) : `-${form.amount}`)}>{form.amount.startsWith('-') ? 'יתרה שלילית · שינוי לחיובית' : 'הזנת יתרה שלילית'}</button>}
        {isBalance && <p className="muted" id="balance-explanation">{isCardCredit ? 'הזכות הרשומה בכרטיס, כמספר חיובי. אינה נכללת בכסף הזמין בחשבונות.' : isLiability ? 'הסכום הכולל שנותר להחזיר, כמספר חיובי.' : form.kind === 'valuation' ? 'השווי הכולל של הנכס בתאריך שנבחר.' : 'היתרה הכוללת בחשבון בתאריך שנבחר. אפשר גם יתרה שלילית.'}{currentBalance?.status === 'known' && <> היתרה הרשומה: <bdi dir="ltr">{formatMoney(currentBalance.amountMinor)}</bdi>.</>}{currentBalance && currentBalance.status !== 'known' && ' היתרה הרשומה אינה מלאה.'}</p>}
        <div className="entry-context">
          <label className="field"><span><WalletCards size={15} aria-hidden="true" /> {form.kind === 'borrowing' ? 'חשבון לקבלת הכסף' : 'חשבון / אמצעי תשלום'}</span><Select displayValue={account ? <><span>{paymentMethod?.name ?? account.name}</span>{paymentMethod?.suffix && <bdi dir="ltr">{paymentMethod.suffix}</bdi>}</> : undefined} value={form.source} onChange={event => change('source', event.target.value)} disabled={form.kind === 'refund' && Boolean(form.originalTransactionId)} required>
            <option value="">בחירת חשבון</option>
            {sourceAccounts.map(item => <option key={item.id} value={`account:${item.id}`}>{item.name}{item.kind === 'cash' ? ' · בארנק' : ''}</option>)}
            {!isBalance && sourceMethods.map(method => <option key={method.id} value={`method:${method.id}`}>{method.name}{method.suffix ? ` · ${method.suffix}` : ''}</option>)}
          </Select></label>
          <label className="field"><span>תאריך{form.date === todayJerusalem() ? ' · היום' : ''}</span><input type="date" dir="ltr" value={form.date} max={todayJerusalem()} onChange={event => change('date', event.target.value)} required /></label>
        </div>
        {account?.kind === 'cash' && <p className="small muted">{isBalance ? 'הסכום הפיזי שכבר נמצא בארנק בתאריך שנבחר. יתרת פתיחה אינה הכנסה.' : form.kind === 'income' ? 'הכנסה חדשה שהתקבלה במזומן. משיכת כסף מהבנק נרשמת כהעברה בין חשבונות.' : 'מזומן · הכסף הפיזי בארנק.'}{!isBalance && !account.openingKnown && ' יש להגדיר קודם יתרת פתיחה ב״הכסף שלי״, גם אם היא אפס.'}</p>}
        {sourceAccounts.length === 0 && <p className="notice">יש להוסיף חשבון מתאים דרך ״הכסף שלי״ לפני רישום התנועה. הטיוטה תישמר עד לחזרה.</p>}
        {needsDestination && <label className="field"><span><ArrowLeftRight size={16} aria-hidden="true" /> {needsLiability ? 'החוב' : 'אל חשבון'}</span><Select value={form.toAccountId} onChange={event => change('toAccountId', event.target.value)} required><option value="">{needsLiability ? 'בחירת חוב' : 'בחירת חשבון יעד'}</option>{destinationAccounts.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</Select></label>}
        {form.kind === 'refund' && <label className="field"><span>ההוצאה המקורית</span><Select value={form.originalTransactionId} onChange={event => { const original = originalExpenses.find(transaction => transaction.id === event.target.value); setForm(current => ({ ...current, originalTransactionId: event.target.value, source: original ? original.input.paymentMethodId ? `method:${original.input.paymentMethodId}` : `account:${original.input.accountId}` : current.source, categoryId: original?.input.categoryId ?? '' })); }} required><option value="">בחירת הוצאה</option>{originalExpenses.map(transaction => <option key={transaction.id} value={transaction.id}>{transaction.input.date} · {transaction.input.merchant || data.categories.find(category => category.id === transaction.input.categoryId)?.name || 'הוצאה'} · {formatMoney(transaction.input.amountMinor)}</option>)}</Select></label>}
        {requiresCategory && <div className="category-picker"><div className="category-heading"><p className="section-label">{hasFeeCategory ? 'קטגוריה לריבית ולעמלות' : 'קטגוריה'}</p>{categories.length > 6 && <button className="text-button categories-expand" type="button" onClick={() => setAllCategories(value => !value)}>{allCategories ? 'פחות קטגוריות' : 'כל הקטגוריות'}<ChevronDown size={16} aria-hidden="true" /></button>}</div><div className="category-grid" role="group" aria-label="בחירת קטגוריה">{shownCategories.map(category => <button className={`category-option ${form.categoryId === category.id ? 'selected' : ''}`} type="button" key={category.id} onClick={() => change('categoryId', category.id)} aria-pressed={form.categoryId === category.id}><CategoryIcon name={`${category.name} ${category.icon}`} /><span>{category.name}</span></button>)}</div></div>}
        {form.kind === 'repayment' && <div className="repayment-fields"><p className="muted">הסכום למעלה הוא התשלום הכולל. הריבית והעמלות יופחתו ממנו, והשאר יירשם כהחזר החוב.</p><div className="field-grid"><label className="field"><span>ריבית · יש לציין גם אפס</span><input inputMode="decimal" dir="ltr" placeholder="אם ידועה" value={form.interest} onChange={event => change('interest', event.target.value)} /></label><label className="field"><span>עמלות · יש לציין גם אפס</span><input inputMode="decimal" dir="ltr" placeholder="אם ידועות" value={form.fee} onChange={event => change('fee', event.target.value)} /></label></div><button className="text-button" type="button" onClick={() => { change('interest', '0'); change('fee', '0'); }}>התשלום ללא ריבית ועמלות</button></div>}
        <button className="details-toggle" type="button" onClick={() => setMore(value => !value)} aria-expanded={more}>פרטים נוספים<ChevronDown size={18} aria-hidden="true" /></button>
        {more && <div className="form-stack advanced-fields">{['expense', 'income', 'refund'].includes(form.kind) && <label className="field"><span>{form.kind === 'income' ? 'מקור / משלם' : 'בית עסק'}</span><input value={form.merchant} maxLength={160} onChange={event => change('merchant', event.target.value)} /></label>}{form.kind === 'transfer' && <label className="field"><span>עמלת העברה · אם קיימת</span><input inputMode="decimal" dir="ltr" value={form.fee} onChange={event => change('fee', event.target.value)} placeholder="0" /></label>}<label className="field"><span>{form.kind === 'reconcile' ? 'סיבת ההתאמה · חובה' : 'הערה'}</span><textarea value={form.note} maxLength={2000} rows={2} onChange={event => change('note', event.target.value)} /></label>{form.obligationId && <p className="notice">התנועה תקושר ל״{data.obligations.find(item => item.id === form.obligationId)?.title ?? 'תשלום שנבחר'}״.</p>}</div>}
        {form.kind === 'reconcile' && !more && <label className="field"><span>סיבת ההתאמה · חובה</span><textarea value={form.note} maxLength={2000} rows={2} onChange={event => change('note', event.target.value)} /></label>}
        <div className="entry-keypad" dir="ltr" aria-label="לוח ספרות">{['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', 'delete'].map(key => <button tabIndex={-1} type="button" key={key} aria-label={key === 'delete' ? 'מחיקת ספרה' : key === '.' ? 'נקודה עשרונית' : key} onClick={() => keypad(key)}>{key === 'delete' ? <Delete size={23} /> : key}</button>)}</div>
      </fieldset>
      <div className="sheet-actions">{error && <p className="error" role="alert">{error}</p>}<button type="submit" className="button button-primary entry-save" disabled={saving}>{saving ? 'ממתינים לאישור השמירה…' : saveLabel}</button><p className="save-hint">{saving ? 'הטיוטה נשמרת עד לקבלת אישור.' : 'הטיוטה נשמרת במכשיר עד לשמירה.'}</p></div>
    </form>
  </FormDialog>;
}
