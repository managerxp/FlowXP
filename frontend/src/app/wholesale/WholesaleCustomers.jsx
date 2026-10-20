/*
 * Wholesale customers: search and filter by type, salesperson, balance and overdue; import a CSV; export; bulk edits
 * (assign a salesperson, set terms or type, archive). Click a customer for their profile, ledger and prices.
 */
import { useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Download, Plus, Upload, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { CUSTOMER_TYPES, fetchAll, money, qs, saveCsv, useDebounced, useLoad } from '../../lib/wholesale.js';
import { Badge, Button, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr, Field, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, CsvImportModal, Pager, Toolbar } from './parts.jsx';
import { CustomerForm } from './CustomerForms.jsx';
import { useT, T } from '../../i18n/useT.js';

const BulkModal = ({ ids, onClose, onDone }) => {
  const tr = useT();
  const toast = useToast();
  const people = useLoad('/wholesale/salespeople');
  const lists = useLoad('/wholesale/price-lists');
  const [action, setAction] = useState('ASSIGN_SALESPERSON');
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true); setError('');
    try { const r = await api('/wholesale/customers/bulk', { method: 'POST', body: { ids, action, value: value === '' ? null : (['SET_TERMS'].includes(action) ? Number(value) : action === 'SET_TYPE' ? value : Number(value)) } }); toast.success(`${r.updated} customer${r.updated === 1 ? '' : 's'} updated`); onDone(); }
    catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return (
    <Modal title={`Change ${ids.length} customer${ids.length === 1 ? '' : 's'}`} onClose={onClose}>
      <div className="space-y-4">
        {error && <p role="alert" className="rounded-lg bg-danger/5 px-3 py-2 text-small text-danger">{error}</p>}
        <Field id="b-act" label={tr('What to change')}><Select id="b-act" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}>
          <option value="ASSIGN_SALESPERSON">{tr('Assign a salesperson')}</option><option value="SET_PRICE_LIST">{tr('Put on a price list')}</option><option value="SET_TERMS">{tr('Set payment terms')}</option><option value="SET_TYPE">{tr('Set the customer type')}</option><option value="ARCHIVE">{tr('Archive')}</option></Select></Field>
        {action === 'ASSIGN_SALESPERSON' && <Field id="b-v" label={tr('Salesperson')}><Select id="b-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">{tr('No salesperson')}</option>{(people.data || []).map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></Field>}
        {action === 'SET_PRICE_LIST' && <Field id="b-v" label={tr('Price list')}><Select id="b-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">{tr('Default')}</option>{(lists.data || []).filter((l) => l.kind === 'STANDARD').map((l) => <option key={l.list_id} value={l.list_id}>{l.name}</option>)}</Select></Field>}
        {action === 'SET_TERMS' && <Field id="b-v" label={tr('Payment terms (days)')}><Input id="b-v" type="number" min="0" max="365" value={value} onChange={(e) => setValue(e.target.value)} /></Field>}
        {action === 'SET_TYPE' && <Field id="b-v" label={tr('Type')}><Select id="b-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">{tr('Choose…')}</option>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={go} loading={busy} variant={action === 'ARCHIVE' ? 'danger' : 'primary'} disabled={(action === 'SET_TERMS' || action === 'SET_TYPE') && value === ''}>{tr('Apply')}</Button></div>
      </div>
    </Modal>
  );
};

const WholesaleCustomers = () => {
  const tr = useT();
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const [view, setView] = useState(params.get('credit') === 'over' ? 'overdue' : '');   // '' | balance | overdue | archived
  const [offset, setOffset] = useState(0);
  const [adding, setAdding] = useState(false);
  const [importing, setImporting] = useState(false);
  const [picked, setPicked] = useState(new Set());
  const [bulk, setBulk] = useState(false);
  const [stamp, setStamp] = useState(0);
  const term = useDebounced(q.trim(), 250);
  const people = useLoad('/wholesale/salespeople');
  const query = useMemo(() => qs({ q: term, type, salesperson_id: salesperson, status: view === 'archived' ? 'ARCHIVED' : undefined, has_balance: view === 'balance' ? 1 : undefined, overdue: view === 'overdue' ? 1 : undefined, sort: view === 'overdue' ? 'overdue' : view === 'balance' ? 'balance' : undefined, limit: 50, offset, k: stamp }), [term, type, salesperson, view, offset, stamp]);
  const { data, meta, loading, error } = useLoad(`/wholesale/customers${query}`, { paged: true });
  const canEdit = can('customers');

  const toggle = (id) => setPicked((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const exportCsv = async () => {
    try {
      const rows = await fetchAll(`/wholesale/customers${qs({ q: term, type, salesperson_id: salesperson, status: view === 'archived' ? 'ARCHIVED' : undefined })}`);
      saveCsv(`customers-${new Date().toISOString().slice(0, 10)}.csv`, [
        { key: 'name', label: T('Name') }, { key: 'customer_type', label: T('Type') }, { key: 'contact_person', label: T('Contact') }, { key: 'phone', label: T('Phone') }, { key: 'email', label: T('Email') }, { key: 'gstin', label: T('GSTIN') }, { key: 'pan', label: T('PAN') },
        { key: 'billing_address', label: T('Address') }, { key: 'city', label: T('City') }, { key: 'state', label: T('State') }, { key: 'pincode', label: T('Pincode') }, { key: 'payment_terms_days', label: T('Terms (days)') }, { key: 'credit_limit', label: T('Credit limit') },
        { key: 'outstanding', label: T('Outstanding') }, { key: 'overdue', label: T('Overdue') }, { key: 'salesperson', label: T('Salesperson') }, { key: 'price_list', label: T('Price list') }
      ], rows);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title={tr('Customers')} lead={tr('Retailers, dealers and businesses you sell to, with their terms, credit and balances.')}
                  action={<>
                    {can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />{tr('Export')}</Button>}
                    {canEdit && <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" />{tr('Import')}</Button>}
                    {canEdit && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add customer')}</Button>}
                  </>} />
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder={tr('Name, phone, GSTIN or contact')} aria-label={tr('Search customers')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <div className="w-40"><Select aria-label={tr('Customer type')} value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }}><option value="">{tr('All types')}</option>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        {(people.data || []).length > 0 && <div className="w-44"><Select aria-label={tr('Salesperson')} value={salesperson} onChange={(e) => { setSalesperson(e.target.value); setOffset(0); }}><option value="">{tr('All salespeople')}</option>{people.data.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></div>}
      </Toolbar>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips label={tr('View')} value={view} onChange={(v) => { setView(v); setOffset(0); setPicked(new Set()); }} options={[{ value: '', label: T('Active') }, { value: 'balance', label: T('Owing money') }, { value: 'overdue', label: T('Overdue') }, { value: 'archived', label: T('Archived') }]} />
        {picked.size > 0 && canEdit && <span className="flex items-center gap-2 text-small"><span className="text-ink-500">{tr('{{picked_size}} selected', { picked_size: picked.size })}</span><Button size="sm" variant="secondary" onClick={() => setBulk(true)}>{tr('Change…')}</Button><Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>{tr('Clear')}</Button></span>}
      </div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={UserRound} emptyLabel={tr('No customers here')} emptyBody={term || type || view ? 'Nothing matches those filters.' : 'Add your first customer, or import a list.'} emptyAction={canEdit && !term && !view ? <Button onClick={() => setAdding(true)}>{tr('Add customer')}</Button> : undefined} />
      {data?.length > 0 && (
        <>
          <Table>
            <Thead>{canEdit && <Th className="w-8"><span className="sr-only">{tr('Select')}</span></Th>}<Th>{tr('Customer')}</Th><Th>{tr('Type')}</Th><Th>{tr('Salesperson')}</Th><Th className="text-right">{tr('Terms')}</Th><Th className="text-right">{tr('Credit limit')}</Th><Th className="text-right">{tr('Owes')}</Th><Th className="text-right">{tr('Overdue')}</Th></Thead>
            <tbody>
              {data.map((c) => (
                <Tr key={c.customer_id} onClick={() => navigate(`/app/wholesale/customers/${c.customer_id}`)}>
                  {canEdit && <Td><input type="checkbox" aria-label={tr('Select {{c_name}}', { c_name: c.name })} checked={picked.has(c.customer_id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.customer_id)} className="h-4 w-4 accent-(--color-brand-500)" /></Td>}
                  <Td><span className="font-medium text-ink-900">{c.name}</span><span className="block text-caption text-ink-500">{[c.phone, c.city || c.state].filter(Boolean).join(' · ')}</span></Td>
                  <Td><Badge tone="neutral">{CUSTOMER_TYPES[c.customer_type] || c.customer_type}</Badge></Td><Td className="text-ink-500">{c.salesperson || '—'}</Td>
                  <Td className="text-right tabular">{c.payment_terms_days != null ? `${c.payment_terms_days} d` : '—'}</Td><Td className="text-right tabular">{c.credit_limit ? money(c.credit_limit) : '—'}</Td>
                  <Td className={`text-right tabular ${c.credit_limit && c.outstanding > c.credit_limit ? 'font-semibold text-danger' : ''}`}>{c.outstanding ? money(c.outstanding) : '—'}</Td>
                  <Td className={`text-right tabular ${c.overdue > 0 ? 'font-semibold text-warning' : 'text-ink-400'}`}>{c.overdue > 0 ? money(c.overdue) : '—'}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
          <Pager meta={meta} onPage={setOffset} />
        </>
      )}
      {adding && <CustomerForm onClose={() => setAdding(false)} onSaved={(c) => navigate(`/app/wholesale/customers/${c.customer_id}`)} />}
      {importing && <CsvImportModal kind="customers" title={tr('Import customers')} allowUpdate={false} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStamp((n) => n + 1); }} />}
      {bulk && <BulkModal ids={[...picked]} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setPicked(new Set()); setStamp((n) => n + 1); }} />}
    </div>
  );
};

export default WholesaleCustomers;
