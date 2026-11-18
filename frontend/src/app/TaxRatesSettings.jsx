/*
 * Settings → Business → GST rates: the business's own named rates ("GST 5%", "Exempt", "Nil rated", "Non-GST" ...). Products pick from this list;
 * the bill shows the name, and the GST returns report nil rated, exempt and non-GST sales apart. Changing a rate's number moves the products on it.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Card, Field, Input, Select, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const KINDS = { TAXABLE: T('GST rate'), NIL: T('Nil rated'), EXEMPT: T('Exempt'), NON_GST: T('Non-GST') };
const blank = { name: '', rate: '', kind: 'TAXABLE' };

export default function TaxRatesSettings() {
  const tr = useT();
  const toast = useToast();
  const { business, can } = useAuth();
  const [rows, setRows] = useState(null);
  const [form, setForm] = useState(blank);
  const [editing, setEditing] = useState(null);   // tax_rate_id being changed
  const [error, setError] = useState('');
  const load = () => api('/tax-rates?all=true').then(setRows).catch((e) => setError(e.message));
  useEffect(() => { if (business?.gst_enabled) load(); }, [business?.gst_enabled]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!business?.gst_enabled || !can('settings')) return null;

  const save = async (e) => {
    e.preventDefault(); setError('');
    const body = { name: form.name, kind: form.kind, rate: form.kind === 'TAXABLE' ? Number(form.rate) : 0 };
    try {
      if (editing) await api(`/tax-rates/${editing}`, { method: 'PATCH', body }); else await api('/tax-rates', { method: 'POST', body });
      toast.success(tr('Saved')); setForm(blank); setEditing(null); load();
    } catch (caught) { setError(caught.message); }
  };
  const toggle = async (r) => {
    try { await api(`/tax-rates/${r.tax_rate_id}`, { method: 'PATCH', body: { is_active: !r.is_active } }); load(); } catch (caught) { setError(caught.message); }
  };

  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('GST rates')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('The rates your products pick from. Nil rated, exempt and non-GST sales are reported apart in your GST returns. Changing a rate changes it on every product that uses it, not on bills already made.')}</p>
      <Alert>{error}</Alert>
      {rows && (
        <ul className="mt-4 divide-y divide-line rounded-lg border border-line">
          {rows.map((r) => (
            <li key={r.tax_rate_id} className={`flex flex-wrap items-center gap-3 px-3 py-2 ${r.is_active ? '' : 'opacity-60'}`}>
              <span className="min-w-0 flex-1 text-sm font-medium text-ink-900">{r.name}</span>
              <span className="tabular text-sm text-ink-500">{r.kind === 'TAXABLE' ? `${r.rate}%` : tr(KINDS[r.kind])}</span>
              <Button size="sm" variant="secondary" onClick={() => { setEditing(r.tax_rate_id); setForm({ name: r.name, rate: String(r.rate), kind: r.kind }); }}>{tr('Change')}</Button>
              <Button size="sm" variant="secondary" onClick={() => toggle(r)}>{r.is_active ? tr('Hide') : tr('Show')}</Button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-[1fr_10rem_7rem_auto] sm:items-end">
        <Field id="tr_name" label={editing ? tr('Name') : tr('New rate name')}><Input id="tr_name" value={form.name} maxLength={60} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field>
        <Field id="tr_kind" label={tr('Kind')}>
          <Select id="tr_kind" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            {Object.entries(KINDS).map(([k, label]) => <option key={k} value={k}>{tr(label)}</option>)}
          </Select>
        </Field>
        <Field id="tr_rate" label={tr('Rate (%)')}>
          <Input id="tr_rate" type="number" min="0" max="100" step="0.01" value={form.kind === 'TAXABLE' ? form.rate : '0'} disabled={form.kind !== 'TAXABLE'} onChange={(e) => setForm({ ...form, rate: e.target.value })} required />
        </Field>
        <div className="flex gap-2">
          <Button type="submit">{editing ? tr('Save') : tr('Add rate')}</Button>
          {editing && <Button type="button" variant="secondary" onClick={() => { setEditing(null); setForm(blank); }}>{tr('Cancel')}</Button>}
        </div>
      </form>
    </Card>
  );
}
