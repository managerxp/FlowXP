/*
 * Settings → Business → Document numbers: the letters printed before the running number of each kind of document (INV-0001, CN-0001).
 * Changing a prefix keeps the running number going; documents already made keep the number they were given. Works for every kind of business.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Card, Field, Input, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const KINDS = [
  ['invoice_prefix', T('Invoices and bills'), 'INV'],
  ['credit_note_prefix', T('Credit notes (sale returns)'), 'CN'],
  ['debit_note_prefix', T('Debit notes (purchase returns)'), 'DN'],
  ['po_prefix', T('Purchase orders'), 'PO']
];

export default function DocumentNumbersSettings() {
  const tr = useT();
  const toast = useToast();
  const { refresh } = useAuth();
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => { api('/businesses/current').then((b) => setForm(Object.fromEntries(KINDS.map(([k, , d]) => [k, b[k] || d])))).catch((e) => setError(e.message)); }, []);

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/businesses/current', { method: 'PATCH', body: form }); await refresh(); toast.success(tr('Document numbers saved')); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Document numbers')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('The letters before each number. Changing one keeps the numbering going; documents already made keep their number.')}</p>
      <Alert>{error}</Alert>
      {form && (
        <form onSubmit={save} className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            {KINDS.map(([key, label, fallback]) => (
              <Field key={key} id={`dn_${key}`} label={tr(label)} hint={`${(form[key] || fallback).toUpperCase()}-0001`}>
                <Input id={`dn_${key}`} value={form[key]} maxLength={12} required onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
              </Field>
            ))}
          </div>
          <div className="flex justify-end"><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save')}</Button></div>
        </form>
      )}
    </Card>
  );
}
