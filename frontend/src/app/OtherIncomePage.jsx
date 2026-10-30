/*
 * Other income: money received that is not a sale (interest, rent received, commission, a scrap sale). It is added in Profit & Loss
 * and shown in the Day Book as money in. Plain list for a chosen month, newest first; a wrong entry is deleted and entered again.
 */
import { useCallback, useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { localISO } from '../lib/dates.js';
import { formatDate } from '../lib/display.js';
import { Alert, Button, Field, Input, Modal, Select, useDialog, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const CATEGORIES = ['Interest', 'Rent received', 'Commission', 'Scrap sale', 'Refund received', 'Other'];
const METHODS = [['CASH', T('Cash')], ['UPI', 'UPI'], ['BANK_TRANSFER', T('Bank')], ['CARD', T('Card')], ['OTHER', T('Other')]];

const monthRange = (offset) => {
  const now = new Date(); const first = new Date(now.getFullYear(), now.getMonth() + offset, 1);
  return { from: localISO(first), to: localISO(new Date(first.getFullYear(), first.getMonth() + 1, 0)), label: first.toLocaleDateString([], { month: 'long', year: 'numeric' }) };
};

const OtherIncomePage = () => {
  const { t: tr } = useT();
  const toast = useToast();
  const dialog = useDialog();
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ category: CATEGORIES[0], amount: '', payment_method: 'CASH', income_date: localISO(new Date()), description: '' });
  const [saving, setSaving] = useState(false);
  const period = monthRange(offset);

  const load = useCallback(() => {
    api(`/other-income?from=${period.from}&to=${period.to}`).then(setData).catch((e) => setError(e.message));
  }, [period.from, period.to]);
  useEffect(() => { setData(null); load(); }, [load]);

  const save = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      await api('/other-income', { method: 'POST', body: form, idempotencyKey: crypto.randomUUID() });
      setAdding(false); setForm({ ...form, amount: '', description: '' }); toast.success(tr('Saved')); load();
    } catch (caught) { setError(caught.message); } finally { setSaving(false); }
  };

  const remove = async (row) => {
    if (!(await dialog.confirm({ title: tr('Delete this entry?'), body: `${row.category} · ${formatCurrency(row.amount)}`, confirmLabel: tr('Delete'), danger: true }))) return;
    try { await api(`/other-income/${row.income_id}`, { method: 'DELETE' }); load(); } catch (caught) { setError(caught.message); }
  };

  const set = (k) => (e) => setForm({ ...form, [k]: e.target.value });

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-h3 font-semibold text-ink-900">{tr('Other income')}</h1>
          <p className="text-small text-ink-500">{tr('Money received that is not a sale. It is added in Profit & Loss.')}</p>
        </div>
        <Button onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden="true" /> {tr('Add income')}</Button>
      </div>

      <div className="flex items-center gap-2">
        <Button variant="secondary" size="sm" onClick={() => setOffset(offset - 1)}>‹</Button>
        <span className="min-w-36 text-center text-small font-medium text-ink-900">{period.label}</span>
        <Button variant="secondary" size="sm" disabled={offset >= 0} onClick={() => setOffset(offset + 1)}>›</Button>
      </div>

      <Alert>{error}</Alert>
      {data && (
        <>
          <p className="tabular text-h4 font-semibold text-ink-900">{formatCurrency(data.total)}</p>
          {data.rows.length === 0
            ? <p className="rounded-(--radius-card) border border-dashed border-line-strong p-8 text-center text-small text-ink-500">{tr('Nothing recorded in this month.')}</p>
            : (
              <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
                {data.rows.map((r) => (
                  <li key={r.income_id} className="flex items-center gap-3 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-small font-medium text-ink-900">{r.category}</p>
                      <p className="truncate text-caption text-ink-500">{formatDate(String(r.income_date).slice(0, 10))} · {METHODS.find(([k]) => k === r.payment_method)?.[1] ? tr(METHODS.find(([k]) => k === r.payment_method)[1]) : r.payment_method}{r.description ? ` · ${r.description}` : ''}</p>
                    </div>
                    <span className="tabular text-small font-semibold text-success">{formatCurrency(r.amount)}</span>
                    <button type="button" className="rounded p-1.5 text-ink-400 hover:text-danger" aria-label={tr('Delete')} onClick={() => remove(r)}><Trash2 className="size-4" aria-hidden="true" /></button>
                  </li>
                ))}
              </ul>
            )}
        </>
      )}

      {adding && (
        <Modal title={tr('Add income')} onClose={() => setAdding(false)}>
          <form onSubmit={save} className="space-y-3">
            <Field id="oi_cat" label={tr('What it was for')}>
              <Input id="oi_cat" list="oi_cats" value={form.category} onChange={set('category')} required maxLength={60} />
              <datalist id="oi_cats">{CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
            </Field>
            <Field id="oi_amt" label={tr('Amount')}><Input id="oi_amt" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.amount} onChange={set('amount')} required /></Field>
            <Field id="oi_how" label={tr('Received by')}>
              <Select id="oi_how" value={form.payment_method} onChange={set('payment_method')}>{METHODS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select>
            </Field>
            <Field id="oi_date" label={tr('Date')}><Input id="oi_date" type="date" value={form.income_date} onChange={set('income_date')} required /></Field>
            <Field id="oi_note" label={tr('Note (optional)')}><Input id="oi_note" value={form.description} onChange={set('description')} maxLength={200} /></Field>
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="secondary" onClick={() => setAdding(false)}>{tr('Cancel')}</Button>
              <Button type="submit" disabled={saving}>{saving ? tr('Saving…') : tr('Save')}</Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
};

export default OtherIncomePage;
