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

const BulkModal = ({ ids, onClose, onDone }) => {
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
        <Field id="b-act" label="What to change"><Select id="b-act" value={action} onChange={(e) => { setAction(e.target.value); setValue(''); }}>
          <option value="ASSIGN_SALESPERSON">Assign a salesperson</option><option value="SET_PRICE_LIST">Put on a price list</option><option value="SET_TERMS">Set payment terms</option><option value="SET_TYPE">Set the customer type</option><option value="ARCHIVE">Archive</option></Select></Field>
        {action === 'ASSIGN_SALESPERSON' && <Field id="b-v" label="Salesperson"><Select id="b-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">No salesperson</option>{(people.data || []).map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></Field>}
        {action === 'SET_PRICE_LIST' && <Field id="b-v" label="Price list"><Select id="b-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Default</option>{(lists.data || []).filter((l) => l.kind === 'STANDARD').map((l) => <option key={l.list_id} value={l.list_id}>{l.name}</option>)}</Select></Field>}
        {action === 'SET_TERMS' && <Field id="b-v" label="Payment terms (days)"><Input id="b-v" type="number" min="0" max="365" value={value} onChange={(e) => setValue(e.target.value)} /></Field>}
        {action === 'SET_TYPE' && <Field id="b-v" label="Type"><Select id="b-v" value={value} onChange={(e) => setValue(e.target.value)}><option value="">Choose…</option>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={go} loading={busy} variant={action === 'ARCHIVE' ? 'danger' : 'primary'} disabled={(action === 'SET_TERMS' || action === 'SET_TYPE') && value === ''}>Apply</Button></div>
      </div>
    </Modal>
  );
};

const WholesaleCustomers = () => {
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
        { key: 'name', label: 'Name' }, { key: 'customer_type', label: 'Type' }, { key: 'contact_person', label: 'Contact' }, { key: 'phone', label: 'Phone' }, { key: 'email', label: 'Email' }, { key: 'gstin', label: 'GSTIN' }, { key: 'pan', label: 'PAN' },
        { key: 'billing_address', label: 'Address' }, { key: 'city', label: 'City' }, { key: 'state', label: 'State' }, { key: 'pincode', label: 'Pincode' }, { key: 'payment_terms_days', label: 'Terms (days)' }, { key: 'credit_limit', label: 'Credit limit' },
        { key: 'outstanding', label: 'Outstanding' }, { key: 'overdue', label: 'Overdue' }, { key: 'salesperson', label: 'Salesperson' }, { key: 'price_list', label: 'Price list' }
      ], rows);
    } catch (e) { toast.error(e.message); }
  };

  return (
    <div>
      <PageHeader title="Customers" lead="Retailers, dealers and businesses you sell to, with their terms, credit and balances."
                  action={<>
                    {can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />Export</Button>}
                    {canEdit && <Button variant="secondary" onClick={() => setImporting(true)}><Upload aria-hidden="true" className="h-4 w-4" />Import</Button>}
                    {canEdit && <Button onClick={() => setAdding(true)}><Plus aria-hidden="true" className="h-4 w-4" />Add customer</Button>}
                  </>} />
      <Toolbar>
        <div className="w-full sm:w-72"><Input type="search" placeholder="Name, phone, GSTIN or contact" aria-label="Search customers" value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <div className="w-40"><Select aria-label="Customer type" value={type} onChange={(e) => { setType(e.target.value); setOffset(0); }}><option value="">All types</option>{Object.entries(CUSTOMER_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></div>
        {(people.data || []).length > 0 && <div className="w-44"><Select aria-label="Salesperson" value={salesperson} onChange={(e) => { setSalesperson(e.target.value); setOffset(0); }}><option value="">All salespeople</option>{people.data.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></div>}
      </Toolbar>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Chips label="View" value={view} onChange={(v) => { setView(v); setOffset(0); setPicked(new Set()); }} options={[{ value: '', label: 'Active' }, { value: 'balance', label: 'Owing money' }, { value: 'overdue', label: 'Overdue' }, { value: 'archived', label: 'Archived' }]} />
        {picked.size > 0 && canEdit && <span className="flex items-center gap-2 text-small"><span className="text-ink-500">{picked.size} selected</span><Button size="sm" variant="secondary" onClick={() => setBulk(true)}>Change…</Button><Button size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button></span>}
      </div>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={UserRound} emptyLabel="No customers here" emptyBody={term || type || view ? 'Nothing matches those filters.' : 'Add your first customer, or import a list.'} emptyAction={canEdit && !term && !view ? <Button onClick={() => setAdding(true)}>Add customer</Button> : undefined} />
      {data?.length > 0 && (
        <>
          <Table>
            <Thead>{canEdit && <Th className="w-8"><span className="sr-only">Select</span></Th>}<Th>Customer</Th><Th>Type</Th><Th>Salesperson</Th><Th className="text-right">Terms</Th><Th className="text-right">Credit limit</Th><Th className="text-right">Owes</Th><Th className="text-right">Overdue</Th></Thead>
            <tbody>
              {data.map((c) => (
                <Tr key={c.customer_id} onClick={() => navigate(`/app/wholesale/customers/${c.customer_id}`)}>
                  {canEdit && <Td><input type="checkbox" aria-label={`Select ${c.name}`} checked={picked.has(c.customer_id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(c.customer_id)} className="h-4 w-4 accent-(--color-brand-500)" /></Td>}
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
      {importing && <CsvImportModal kind="customers" title="Import customers" allowUpdate={false} onClose={() => setImporting(false)} onDone={() => { setImporting(false); setStamp((n) => n + 1); }} />}
      {bulk && <BulkModal ids={[...picked]} onClose={() => setBulk(false)} onDone={() => { setBulk(false); setPicked(new Set()); setStamp((n) => n + 1); }} />}
    </div>
  );
};

export default WholesaleCustomers;
