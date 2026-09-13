import { Select } from './Primitives';
import { useMemo, useState } from 'react';
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, ChevronLeft, Filter, Pencil, RotateCcw, Search, Trash2, X } from 'lucide-react';
import type { Dataset, EntryKind, Transaction } from '../domain/types';
import { absMoney, formatMoney, parseMoney } from '../domain/money';
import { FormDialog, entryLabels } from './EntrySheet';

export interface TransactionHistoryProps {
  data: Dataset;
  onEdit: (transaction: Transaction) => void;
  onVoid: (transaction: Transaction) => Promise<void>;
  onRefund: (transaction: Transaction) => void;
}
const dateFormatter = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
function displayDate(date: string): string { return dateFormatter.format(new Date(`${date}T12:00:00`)); }
function transactionTitle(transaction: Transaction, data: Dataset): string {
  return transaction.input.merchant || data.categories.find(category => category.id === transaction.input.categoryId)?.name || entryLabels[transaction.input.kind];
}
function TransactionIcon({ kind }: { kind: EntryKind }) {
  if (kind === 'income' || kind === 'refund') return <ArrowDownLeft size={20} />;
  if (kind === 'transfer') return <ArrowLeftRight size={20} />;
  return <ArrowUpRight size={20} />;
}

export function TransactionHistory({ data, onEdit, onVoid, onRefund }: TransactionHistoryProps) {
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [accountId, setAccountId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [kind, setKind] = useState<EntryKind | ''>('');
  const [minimum, setMinimum] = useState('');
  const [maximum, setMaximum] = useState('');
  const [includeVoided, setIncludeVoided] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [confirmVoid, setConfirmVoid] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const selected = data.transactions.find(transaction => transaction.id === selectedId);
  const activeFilterCount = [from, to, accountId, categoryId, kind, minimum, maximum, includeVoided].filter(Boolean).length;
  let filterError = '';
  let minAmount: bigint | null = null;
  let maxAmount: bigint | null = null;
  try {
    minAmount = minimum.trim() ? parseMoney(minimum) : null;
    maxAmount = maximum.trim() ? parseMoney(maximum) : null;
    if ((minAmount !== null && minAmount < 0n) || (maxAmount !== null && maxAmount < 0n)) throw new Error('סינון סכומים נעשה לפי גודל הסכום, ללא מינוס.');
    if (minAmount !== null && maxAmount !== null && minAmount > maxAmount) throw new Error('הסכום המינימלי צריך להיות קטן מהסכום המקסימלי.');
    if (from && to && from > to) throw new Error('תאריך ההתחלה צריך להיות לפני תאריך הסיום.');
  } catch (cause) { filterError = cause instanceof Error ? cause.message : 'יש לבדוק את טווח הסכומים.'; }

  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('he');
    if (filterError) return [];
    return data.transactions.filter(transaction => {
      const input = transaction.input;
      if (!includeVoided && transaction.voided) return false;
      if (from && input.date < from) return false;
      if (to && input.date > to) return false;
      if (accountId && !transaction.postings.some(posting => posting.accountId === accountId)) return false;
      if (categoryId && input.categoryId !== categoryId) return false;
      if (kind && input.kind !== kind) return false;
      const amount = absMoney(input.amountMinor);
      if (minAmount !== null && amount < minAmount) return false;
      if (maxAmount !== null && amount > maxAmount) return false;
      if (query) {
        const names = transaction.postings.map(posting => data.accounts.find(account => account.id === posting.accountId)?.name ?? '');
        const text = [transactionTitle(transaction, data), entryLabels[input.kind], input.note, input.merchant, data.categories.find(category => category.id === input.categoryId)?.name, ...names].filter(Boolean).join(' ').toLocaleLowerCase('he');
        if (!text.includes(query)) return false;
      }
      return true;
    }).sort((a, b) => b.input.date.localeCompare(a.input.date) || b.createdAt.localeCompare(a.createdAt));
  }, [data, search, includeVoided, from, to, accountId, categoryId, kind, minAmount, maxAmount, filterError]);
  const groups = new Map<string, Transaction[]>();
  for (const transaction of filtered) { const items = groups.get(transaction.input.date) ?? []; items.push(transaction); groups.set(transaction.input.date, items); }

  function resetFilters() { setSearch(''); setFrom(''); setTo(''); setAccountId(''); setCategoryId(''); setKind(''); setMinimum(''); setMaximum(''); setIncludeVoided(false); }
  function closeDetails() { setSelectedId(null); setConfirmVoid(false); setError(''); }
  async function voidSelected() {
    if (!selected || saving) return;
    setSaving(true); setError('');
    try { await onVoid(selected); closeDetails(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'ביטול התנועה לא אושר. אפשר לנסות שוב.'); }
    finally { setSaving(false); }
  }

  return <section className="transaction-history" aria-label="היסטוריית תנועות">
    <div className="history-toolbar"><label className="history-search"><Search size={20} aria-hidden="true" /><span className="sr-only">חיפוש לפי בית עסק, קטגוריה, חשבון או הערה</span><input type="search" placeholder="חיפוש בתנועות" value={search} onChange={event => setSearch(event.target.value)} /></label><button className={`button button-secondary filter-button ${expanded ? 'selected' : ''}`} type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}><Filter size={18} aria-hidden="true" /><span>סינון{activeFilterCount ? ` (${activeFilterCount})` : ''}</span></button></div>
    {expanded && <div className="history-filters form-stack">
      <div className="field-grid"><label className="field"><span>מתאריך</span><input type="date" dir="ltr" value={from} onChange={event => setFrom(event.target.value)} /></label><label className="field"><span>עד תאריך</span><input type="date" dir="ltr" value={to} onChange={event => setTo(event.target.value)} /></label></div>
      <div className="field-grid"><label className="field"><span>חשבון</span><Select value={accountId} onChange={event => setAccountId(event.target.value)}><option value="">כל החשבונות</option>{data.accounts.map(account => <option key={account.id} value={account.id}>{account.name}</option>)}</Select></label><label className="field"><span>קטגוריה</span><Select value={categoryId} onChange={event => setCategoryId(event.target.value)}><option value="">כל הקטגוריות</option>{data.categories.map(category => <option key={category.id} value={category.id}>{category.name}</option>)}</Select></label></div>
      <label className="field"><span>סוג תנועה</span><Select value={kind} onChange={event => setKind(event.target.value as EntryKind | '')}><option value="">כל הסוגים</option>{Object.entries(entryLabels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</Select></label>
      <div className="field-grid"><label className="field"><span>מסכום בשקלים</span><input inputMode="decimal" dir="ltr" value={minimum} onChange={event => setMinimum(event.target.value)} placeholder="ללא מינימום" /></label><label className="field"><span>עד סכום בשקלים</span><input inputMode="decimal" dir="ltr" value={maximum} onChange={event => setMaximum(event.target.value)} placeholder="ללא מקסימום" /></label></div>
      <div className="filter-bottom"><label className="checkbox-field"><input type="checkbox" checked={includeVoided} onChange={event => setIncludeVoided(event.target.checked)} /><span>להציג גם תנועות שבוטלו</span></label><button type="button" className="text-button" onClick={resetFilters}><X size={16} aria-hidden="true" />ניקוי הסינון</button></div>
    </div>}
    {filterError ? <p className="error" role="alert">{filterError}</p> : <p className="history-count muted" role="status">{filtered.length === 1 ? 'תנועה אחת' : `${filtered.length} תנועות`}{activeFilterCount || search ? ' בתוצאות' : ''}</p>}
    {!filterError && filtered.length === 0 && <div className="empty-state history-empty"><Search size={28} aria-hidden="true" /><h3>{activeFilterCount || search ? 'לא נמצאו תנועות מתאימות' : 'התנועות שלך יופיעו כאן'}</h3><p className="muted">{activeFilterCount || search ? 'אפשר לשנות את החיפוש או לנקות את הסינון.' : 'כל הכנסה, הוצאה והעברה שתירשם תישמר בהיסטוריה.'}</p>{Boolean(activeFilterCount || search) && <button type="button" className="button button-secondary" onClick={resetFilters}>ניקוי הסינון</button>}</div>}
    {[...groups].map(([date, transactions]) => <section className="transaction-day" key={date} aria-label={displayDate(date)}><h3 className="transaction-date">{displayDate(date)}</h3><div className="transaction-list">{transactions.map(transaction => <button className={`transaction-row ${transaction.voided ? 'voided' : ''}`} key={transaction.id} type="button" onClick={() => { setSelectedId(transaction.id); setConfirmVoid(false); setError(''); }}>
      <span className={`transaction-symbol ${['income', 'refund'].includes(transaction.input.kind) ? 'incoming' : ''}`} aria-hidden="true"><TransactionIcon kind={transaction.input.kind} /></span>
      <span className="transaction-copy"><span className="transaction-title"><bdi>{transactionTitle(transaction, data)}</bdi>{transaction.voided && <span className="status-pill">בוטלה</span>}</span><span className="transaction-subtitle">{entryLabels[transaction.input.kind]} · <bdi>{data.accounts.find(account => account.id === transaction.input.accountId)?.name ?? 'חשבון לא זמין'}</bdi>{transaction.input.toAccountId && <> ← <bdi>{data.accounts.find(account => account.id === transaction.input.toAccountId)?.name ?? 'חשבון לא זמין'}</bdi></>}</span></span>
      <span className={`transaction-amount numeric ${['income', 'refund'].includes(transaction.input.kind) ? 'incoming' : ''}`}><bdi dir="ltr">{formatMoney(transaction.input.amountMinor)}</bdi></span><ChevronLeft size={18} className="transaction-chevron" aria-hidden="true" />
    </button>)}</div></section>)}
    {selected && <FormDialog title={confirmVoid ? 'ביטול תנועה' : 'פרטי התנועה'} onClose={closeDetails} busy={saving} className="transaction-detail">
      {confirmVoid ? <div className="form-stack"><p>לבטל את התנועה ״{transactionTitle(selected, data)}״ בסך <bdi dir="ltr">{formatMoney(selected.input.amountMinor)}</bdi>?</p><p className="muted">היתרות והסיכומים יעודכנו. התנועה תישאר בהיסטוריית התנועות שבוטלו.</p>{error && <p className="error" role="alert">{error}</p>}<button className="button button-danger" type="button" onClick={voidSelected} disabled={saving}>{saving ? 'ממתינים לאישור…' : 'ביטול התנועה'}</button><button className="button button-secondary" type="button" onClick={() => setConfirmVoid(false)} disabled={saving}>חזרה לפרטי התנועה</button></div> : <div className="form-stack">
        <div className="detail-hero"><p className="muted">{entryLabels[selected.input.kind]}{selected.voided ? ' · בוטלה' : ''}</p><p className="detail-amount"><bdi dir="ltr">{formatMoney(selected.input.amountMinor)}</bdi></p><h3><bdi>{transactionTitle(selected, data)}</bdi></h3></div>
        <dl className="detail-list"><div><dt>תאריך</dt><dd>{displayDate(selected.input.date)}</dd></div><div><dt>חשבון</dt><dd><bdi>{data.accounts.find(account => account.id === selected.input.accountId)?.name ?? 'לא זמין'}</bdi></dd></div>{selected.input.toAccountId && <div><dt>{selected.input.kind === 'transfer' ? 'חשבון יעד' : 'חוב'}</dt><dd><bdi>{data.accounts.find(account => account.id === selected.input.toAccountId)?.name ?? 'לא זמין'}</bdi></dd></div>}{selected.input.categoryId && <div><dt>קטגוריה</dt><dd>{data.categories.find(category => category.id === selected.input.categoryId)?.name ?? 'לא זמינה'}</dd></div>}{selected.input.paymentMethodId && <div><dt>אמצעי תשלום</dt><dd><bdi>{data.paymentMethods.find(method => method.id === selected.input.paymentMethodId)?.name ?? 'לא זמין'}</bdi></dd></div>}{selected.input.kind === 'repayment' && <><div><dt>החזר קרן</dt><dd><bdi dir="ltr">{formatMoney(selected.input.principalMinor ?? '0')}</bdi></dd></div><div><dt>ריבית</dt><dd><bdi dir="ltr">{formatMoney(selected.input.interestMinor ?? '0')}</bdi></dd></div><div><dt>עמלות</dt><dd><bdi dir="ltr">{formatMoney(selected.input.feeMinor ?? '0')}</bdi></dd></div></>}{selected.input.obligationId && <div><dt>תשלום צפוי מקושר</dt><dd>{data.obligations.find(item => item.id === selected.input.obligationId)?.title ?? 'לא זמין'}</dd></div>}{selected.input.originalTransactionId && <div><dt>הוצאה מקורית</dt><dd>{(() => { const original = data.transactions.find(item => item.id === selected.input.originalTransactionId); return original ? `${transactionTitle(original, data)} · ${displayDate(original.input.date)}` : 'לא זמינה'; })()}</dd></div>}</dl>
        {selected.input.note && <div className="detail-note"><p className="section-label">הערה</p><p><bdi>{selected.input.note}</bdi></p></div>}
        {!selected.voided && <div className="detail-actions"><button className="button button-secondary" type="button" onClick={() => { closeDetails(); onEdit(selected); }}><Pencil size={18} aria-hidden="true" />עריכת התנועה</button>{selected.input.kind === 'expense' && <button className="button button-secondary" type="button" onClick={() => { closeDetails(); onRefund(selected); }}><RotateCcw size={18} aria-hidden="true" />רישום החזר כספי</button>}<button className="text-button danger" type="button" onClick={() => setConfirmVoid(true)}><Trash2 size={18} aria-hidden="true" />ביטול התנועה</button></div>}
      </div>}
    </FormDialog>}
  </section>;
}
