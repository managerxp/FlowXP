/*
 * Suppliers: who you buy from, with terms, GSTIN and what you owe each. Import a CSV, export, add or edit.
 */
import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, Plus, Truck, Upload } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { fetchAll, money, qs, saveCsv, useDebounced, useLoad } from '../../lib/wholesale.js';
import { Alert, Button, Field, Input, ListState, Modal, PageHeader, Table, Td, Textarea, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { Chips, CsvImportModal, NumberField, Pager, Toolbar } from './parts.jsx';
import { useT, T } from '../../i18n/useT.js';

export const SupplierForm = ({ supplier, onClose, onSaved }) => {
  const tr = useT();
  const toast = useToast();
  const editing = Boolean(supplier?.supplier_id);
  const [f, setF] = useState(() => ({ name: '', contact_person: '', phone: '', email: '', gstin: '', pan: '', address: '', city: '', state: '', pincode: '', payment_terms_days: '', opening_balance: '', bank_details: '', notes: '', ...Object.fromEntries(Object.entries(supplier || {}).filter(([k]) => ['name', 'contact_person', 'phone', 'email', 'gstin', 'pan', 'address', 'city', 'state', 'pincode', 'payment_terms_days', 'bank_details', 'notes'].includes(k)).map(([k, v]) => [k, v ?? ''])), ...(supplier ? { opening_balance: supplier.opening_balance || '' } : {}) }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const num = (v) => (v === '' ? null : Number(v));
    try {
      const saved = await api(editing ? `/wholesale/suppliers/${supplier.supplier_id}` : '/wholesale/suppliers', { method: editing ? 'PUT' : 'POST', body: { ...f, payment_terms_days: num(f.payment_terms_days), opening_balance: num(f.opening_balance) ?? 0 } });
      toast.success(editing ? tr('Supplier updated') : `${saved.name} added`); onSaved(saved);
    } catch (err) { setError(err.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={editing ? tr('Edit supplier') : tr('Add a supplier')} onClose={onClose} wide>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2"><Field id="sf-name" label={tr('Supplier name')}><Input id="sf-name" value={f.name} onChange={set('name')} required autoFocus maxLength={160} /></Field></div>
          <Field id="sf-contact" label={tr('Contact person')}><Input id="sf-contact" value={f.contact_person} onChange={set('contact_person')} /></Field>
          <Field id="sf-phone" label={tr('Phone')}><Input id="sf-phone" type="tel" value={f.phone} onChange={set('phone')} /></Field>
          <Field id="sf-email" label={tr('Email')} hint={tr('Purchase orders can be emailed')}><Input id="sf-email" type="email" value={f.email} onChange={set('email')} /></Field>
          <Field id="sf-gstin" label={tr('GSTIN')}><Input id="sf-gstin" value={f.gstin} onChange={(e) => setF((x) => ({ ...x, gstin: e.target.value.toUpperCase() }))} maxLength={15} /></Field>
          <Field id="sf-pan" label={tr('PAN')}><Input id="sf-pan" value={f.pan} onChange={(e) => setF((x) => ({ ...x, pan: e.target.value.toUpperCase() }))} maxLength={10} /></Field>
          <NumberField id="sf-terms" label={tr('Payment terms')} suffix="days" step={1} value={f.payment_terms_days} onChange={set('payment_terms_days')} />
          <div className="sm:col-span-2"><Field id="sf-addr" label={tr('Address')}><Textarea id="sf-addr" rows={2} value={f.address} onChange={set('address')} /></Field></div>
          <Field id="sf-city" label={tr('City')}><Input id="sf-city" value={f.city} onChange={set('city')} /></Field>
          <Field id="sf-state" label={tr('State')}><Input id="sf-state" value={f.state} onChange={set('state')} /></Field>
          <Field id="sf-pin" label={tr('Pincode')}><Input id="sf-pin" inputMode="numeric" value={f.pincode} onChange={set('pincode')} maxLength={6} /></Field>
          <NumberField id="sf-open" label={tr('Opening balance')} prefix="₹" hint={tr('What you owed them when you started')} min={-100000000} value={f.opening_balance} onChange={set('opening_balance')} />
          <div className="sm:col-span-2"><Field id="sf-bank" label={tr('Bank details')}><Input id="sf-bank" value={f.bank_details} onChange={set('bank_details')} maxLength={300} /></Field></div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button type="button" variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" loading={busy}>{editing ? tr('Save changes') : tr('Add supplier')}</Button></div>
      </form>
    </Modal>
  );
};

const WholesaleSuppliers = () => {
  const tr = useT();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [view, setView] = useState('');
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [stamp, setStamp] = useState(0);
  const term = useDebounced(q.trim(), 250);
  const query = useMemo(() => qs({ q: term, status: view === 'archived' ? 'ARCHIVED' : undefined, limit: 50, offset, k: stamp }), [term, view, offset, stamp]);
  const { data, meta, loading, error } = useLoad(`/wholesale/suppliers${query}`, { paged: true });
  const canEdit = can('suppliers');
  const exportCsv = async () => {
    try { const rows = await fetchAll(`/wholesale/suppliers${qs({ q: term })}`); saveCsv('suppliers.csv', [{ key: 'name', label: T('Name') }, { key: 'contact_person', label: T('Contact') }, { key: 'phone', label: T('Phone') }, { key: 'email', label: T('Email') }, { key: 'gstin', label: T('GSTIN') }, { key: 'payment_terms_days', label: T('Terms (days)') }, { key: 'outstanding', label: T('We owe') }], rows); }
    catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <PageHeader title={tr('Suppliers')} lead={tr('Who you buy from, their terms, and what you owe them.')}
                  action={<>{can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />{tr('Export')}</Button>}{canEdit && <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" />{tr('Import')}</Button>}{canEdit && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add supplier')}</Button>}</>} />
      <Toolbar><div className="w-full sm:w-72"><Input type="search" placeholder={tr('Name, phone, GSTIN or contact')} aria-label={tr('Search suppliers')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div><Chips label={tr('View')} value={view} onChange={(v) => { setView(v); setOffset(0); }} options={[{ value: '', label: T('Active') }, { value: 'archived', label: T('Archived') }]} /></Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={Truck} emptyLabel={tr('No suppliers here')} emptyBody={term ? 'Nothing matches that search.' : 'Add the people you buy from.'} emptyAction={canEdit && !term ? <Button onClick={() => setAdding(true)}>{tr('Add supplier')}</Button> : undefined} />
      {data?.length > 0 && <><Table><Thead><Th>{tr('Supplier')}</Th><Th>{tr('Contact')}</Th><Th>{tr('GSTIN')}</Th><Th className="text-right">{tr('Terms')}</Th><Th className="text-right">{tr('Purchased')}</Th><Th className="text-right">{tr('We owe')}</Th></Thead>
        <tbody>{data.map((s) => <Tr key={s.supplier_id} onClick={() => navigate(`/app/wholesale/suppliers/${s.supplier_id}`)}><Td><span className="font-medium">{s.name}</span><span className="block text-caption text-ink-500">{[s.city, s.state].filter(Boolean).join(', ')}</span></Td><Td className="text-ink-500">{[s.contact_person, s.phone].filter(Boolean).join(' · ') || '—'}</Td><Td className="text-ink-500">{s.gstin || '—'}</Td><Td className="text-right tabular">{s.payment_terms_days != null ? `${s.payment_terms_days} d` : '—'}</Td><Td className="text-right tabular">{money(s.total_purchased)}</Td><Td className={`text-right tabular ${s.outstanding > 0 ? 'font-semibold text-warning' : ''}`}>{s.outstanding ? money(s.outstanding) : '—'}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {adding && <SupplierForm onClose={() => setAdding(false)} onSaved={(s) => navigate(`/app/wholesale/suppliers/${s.supplier_id}`)} />}
      {importing && <CsvImportModal kind="suppliers" title={tr('Import suppliers')} allowUpdate={false} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStamp((n) => n + 1); }} />}
    </div>
  );
};

export default WholesaleSuppliers;
