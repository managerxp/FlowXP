/* Trade: parts held for customers, trade price lists, garage and fleet accounts (class, price list, credit limit), supplier claims and the returns log. */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { CUSTOMER_CLASSES, DISPOSITIONS, RETURN_REASONS, n3, qs, rsPaise, useDebounced, useLoad } from '../../lib/autoparts.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, useAction } from '../salon/parts.jsx';
import { T, useT } from '../../i18n/useT.js';

const label = (list, v) => (list.find(([k]) => k === v) || [v, v])[1];

const Holds = ({ canEdit }) => {
  const tr = useT();
  const h = useLoad('/autoparts/reservations');
  const [adding, setAdding] = useState(false);
  const [busy, run] = useAction();
  const release = (r) => run(async () => { await api(`/autoparts/reservations/${r.reservation_id}/release`, { method: 'POST' }); h.reload(); }, 'Released');
  return (
    <Panel title={tr('Held for customers')} lead={tr('Held parts cannot be sold to anyone else. They are used up when that customer is billed.')} action={canEdit && <Button onClick={() => setAdding(true)}>{tr('Hold a part')}</Button>}>
      <ListState loading={h.loading && !h.data} error={h.error} empty={h.data && h.data.length === 0} emptyLabel={tr('Nothing is being held.')} />
      {h.data?.length > 0 && (
        <Table>
          <Thead><Th>{tr('Part')}</Th><Th>{tr('For')}</Th><Th className="text-right">{tr('Held')}</Th><Th>{tr('Until')}</Th><Th /></Thead>
          <tbody>{h.data.map((r) => (<Tr key={r.reservation_id}><Td>{r.part}<span className="block text-caption text-ink-500">{r.sku}{r.note ? ` · ${r.note}` : ''}</span></Td><Td>{r.customer || 'Anyone (set aside)'}</Td><Td className="tabular text-right">{n3(r.open_qty)}</Td><Td>{r.expires_on ? String(r.expires_on).slice(0, 10) : '-'}</Td><Td className="text-right">{canEdit && <Button size="sm" variant="ghost" onClick={() => release(r)} loading={busy}>{tr('Release')}</Button>}</Td></Tr>))}</tbody>
        </Table>
      )}
      {adding && <NewHold onClose={() => setAdding(false)} onSaved={() => { setAdding(false); h.reload(); }} />}
    </Panel>
  );
};

const NewHold = ({ onClose, onSaved }) => {
  const tr = useT();
  const [term, setTerm] = useState(''); const q = useDebounced(term, 250);
  const found = useLoad(q.trim().length >= 2 ? `/autoparts/parts/lookup${qs({ q, limit: 6 })}` : null);
  const [part, setPart] = useState(null); const [qty, setQty] = useState('1'); const [customer, setCustomer] = useState(''); const [until, setUntil] = useState(''); const [note, setNote] = useState('');
  const [customers, setCustomers] = useState([]); const [error, setError] = useState('');
  const [busy, run] = useAction();
  useEffect(() => { api('/customers').then(setCustomers).catch(() => {}); }, []);
  const save = () => run(async () => { setError(''); try { await api('/autoparts/reservations', { method: 'POST', body: { product_id: part.product_id, qty: Number(qty), customer_id: customer ? Number(customer) : undefined, expires_on: until || undefined, note: note || undefined } }); onSaved(); } catch (e) { setError(e.message); } }, null);
  return (
    <Modal title={tr('Hold a part')} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button onClick={save} loading={busy} disabled={!part || !(Number(qty) > 0)}>{tr('Hold')}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="hd-part" label={tr('Part')}><Input id="hd-part" value={term} onChange={(e) => { setTerm(e.target.value); setPart(null); }} /></Field>
        {!part && found.data?.length > 0 && <ul className="rounded-lg border border-line">{found.data.map((p) => <li key={p.product_id}><button type="button" className="block w-full px-4 py-2 text-left text-small hover:bg-surface-2" onClick={() => { setPart(p); setTerm(p.name); }}>{p.name} <span className="text-ink-400">{tr('{{sku}} · {{n3}} in stock', { sku: p.sku, n3: n3(p.stock) })}</span></button></li>)}</ul>}
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="hd-qty" label={tr('How many')} value={qty} onChange={setQty} />
          <Field id="hd-cust" label={tr('Customer')}><Select id="hd-cust" value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="">{tr('No customer')}</option>{customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}</Select></Field>
          <Field id="hd-until" label={tr('Hold until')}><Input id="hd-until" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
          <Field id="hd-note" label={tr('Note')}><Input id="hd-note" value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} /></Field>
        </div>
      </div>
    </Modal>
  );
};

const PriceLists = ({ canEdit }) => {
  const tr = useT();
  const l = useLoad('/autoparts/price-lists');
  const [name, setName] = useState(''); const [pct, setPct] = useState('10');
  const [busy, run] = useAction();
  const add = () => run(async () => { await api('/autoparts/price-lists', { method: 'POST', body: { name, discount_pct: Number(pct) } }); setName(''); l.reload(); }, 'Price list added');
  return (
    <Panel title={tr('Trade price lists')} lead={tr('A percentage off the selling price for the customers on the list. Prices set for single parts (on the list) win over the percentage.')}>
      <ListState loading={l.loading && !l.data} error={l.error} empty={l.data && l.data.length === 0} emptyLabel={tr('No price lists yet.')} />
      {l.data?.length > 0 && (
        <Table>
          <Thead><Th>{tr('List')}</Th><Th className="text-right">{tr('Off selling price')}</Th><Th className="text-right">{tr('Own prices')}</Th><Th className="text-right">{tr('Customers')}</Th></Thead>
          <tbody>{l.data.map((x) => (<Tr key={x.price_list_id}><Td className="font-medium">{x.name}</Td><Td className="tabular text-right">{x.discount_pct}%</Td><Td className="tabular text-right">{x.items}</Td><Td className="tabular text-right">{x.customers}</Td></Tr>))}</tbody>
        </Table>
      )}
      {canEdit && (
        <form className="mt-4 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) add(); }}>
          <Field id="pl-name" label={tr('New list')}><Input id="pl-name" value={name} onChange={(e) => setName(e.target.value)} placeholder={tr('Garage')} /></Field>
          <div className="w-28"><NumberField id="pl-pct" label={tr('Percent off')} suffix="%" value={pct} onChange={setPct} /></div>
          <Button type="submit" loading={busy} disabled={!name.trim()}>{tr('Add list')}</Button>
        </form>
      )}
    </Panel>
  );
};

const Terms = ({ canEdit }) => {
  const tr = useT();
  const [customers, setCustomers] = useState([]); const [id, setId] = useState('');
  const lists = useLoad('/autoparts/price-lists');
  const t = useLoad(id ? `/autoparts/customers/${id}/terms` : null);
  const [f, setF] = useState(null);
  const [busy, run] = useAction();
  useEffect(() => { api('/customers').then(setCustomers).catch(() => {}); }, []);
  useEffect(() => { if (t.data) setF({ customer_class: t.data.customer_class, price_list_id: t.data.price_list_id ? String(t.data.price_list_id) : '', credit_limit: String((t.data.credit_limit_paise || 0) / 100), credit_policy: t.data.credit_policy, terms_days: String(t.data.terms_days) }); }, [t.data]);
  const save = () => run(async () => { await api(`/autoparts/customers/${id}/terms`, { method: 'PUT', body: { ...f, price_list_id: f.price_list_id ? Number(f.price_list_id) : null, credit_limit: Number(f.credit_limit || 0), terms_days: Number(f.terms_days || 0) } }); t.reload(); }, 'Saved');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Panel title={tr('Garage and fleet accounts')} lead={tr('Class, price list and credit limit for a customer. A bill left unpaid is credit, and the limit applies.')}>
      <div className="max-w-xl space-y-4">
        <Field id="tm-cust" label={tr('Customer')}><Select id="tm-cust" value={id} onChange={(e) => { setId(e.target.value); setF(null); }}><option value="">{tr('Choose')}</option>{customers.map((c) => <option key={c.customer_id} value={c.customer_id}>{c.name}</option>)}</Select></Field>
        {t.data && f && (
          <>
            <p className="text-small text-ink-700">Owes {rsPaise(t.data.owes_paise)}{t.data.available_paise != null ? `, ${rsPaise(t.data.available_paise)} left of the limit` : tr(', no limit set')}.</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field id="tm-class" label={tr('Class')}><Select id="tm-class" value={f.customer_class} onChange={set('customer_class')} disabled={!canEdit}>{CUSTOMER_CLASSES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
              <Field id="tm-list" label={tr('Price list')}><Select id="tm-list" value={f.price_list_id} onChange={set('price_list_id')} disabled={!canEdit}><option value="">{tr('Normal prices')}</option>{(lists.data || []).map((x) => <option key={x.price_list_id} value={x.price_list_id}>{x.name} ({x.discount_pct}%)</option>)}</Select></Field>
              <NumberField id="tm-limit" label={tr('Credit limit')} prefix="₹" hint={tr('0 means no limit')} value={f.credit_limit} onChange={(v) => setF((x) => ({ ...x, credit_limit: v }))} disabled={!canEdit} />
              <Field id="tm-pol" label={tr('At the limit')}><Select id="tm-pol" value={f.credit_policy} onChange={set('credit_policy')} disabled={!canEdit}><option value="OFF">{tr('Ignore the limit')}</option><option value="WARN">{tr('Warn, allow the bill')}</option><option value="BLOCK">{tr('Refuse the bill')}</option></Select></Field>
              <NumberField id="tm-days" label={tr('Payment terms (days)')} value={f.terms_days} step={1} onChange={(v) => setF((x) => ({ ...x, terms_days: v }))} disabled={!canEdit} />
            </div>
            {canEdit && <Button onClick={save} loading={busy}>{tr('Save')}</Button>}
          </>
        )}
      </div>
    </Panel>
  );
};

const Claims = ({ canEdit }) => {
  const tr = useT();
  const [status, setStatus] = useState('OPEN');
  const c = useLoad(`/autoparts/claims${qs({ status })}`);
  const [busy, run] = useAction();
  const resolve = (x, outcome) => { const amount = outcome === 'CREDITED' ? window.prompt('Credit received (₹)', String(x.amount || 0)) : undefined; if (outcome === 'CREDITED' && amount === null) return; run(async () => { await api(`/autoparts/claims/${x.claim_id}/resolve`, { method: 'POST', body: { status: outcome, amount: amount === undefined ? undefined : Number(amount) } }); c.reload(); }, 'Claim closed'); };
  return (
    <Panel title={tr('Supplier claims')} lead={tr('Damaged, rejected or warranty parts the supplier owes a credit or replacement for. Record the money with a debit note.')}>
      <div className="mb-3 w-44"><Select aria-label={tr('Status')} value={status} onChange={(e) => setStatus(e.target.value)}>{['OPEN', 'CREDITED', 'REPLACED', 'DECLINED', 'WRITTEN_OFF'].map((s) => <option key={s} value={s}>{s.charAt(0) + s.slice(1).toLowerCase().replace('_', ' ')}</option>)}</Select></div>
      <ListState loading={c.loading && !c.data} error={c.error} empty={c.data && c.data.length === 0} emptyLabel={tr('No claims here.')} />
      {c.data?.length > 0 && (
        <Table>
          <Thead><Th>{tr('Part')}</Th><Th>{tr('Supplier')}</Th><Th className="text-right">{tr('Qty')}</Th><Th>{tr('Why')}</Th><Th className="text-right">{tr('Amount')}</Th><Th /></Thead>
          <tbody>{c.data.map((x) => (<Tr key={x.claim_id}><Td>{x.part}<span className="block text-caption text-ink-500">{x.sku}</span></Td><Td>{x.supplier || '-'}</Td><Td className="tabular text-right">{n3(x.qty)}</Td><Td><Badge>{x.reason.toLowerCase().replace('_', ' ')}</Badge></Td><Td className="tabular text-right">{x.amount ? rsPaise(x.amount_paise) : ''}</Td>
            <Td className="text-right">{canEdit && x.status === 'OPEN' && <span className="inline-flex gap-1"><Button size="sm" variant="secondary" loading={busy} onClick={() => resolve(x, 'CREDITED')}>{tr('Credited')}</Button><Button size="sm" variant="ghost" onClick={() => resolve(x, 'REPLACED')}>{tr('Replaced')}</Button><Button size="sm" variant="ghost" onClick={() => resolve(x, 'DECLINED')}>{tr('Declined')}</Button></span>}</Td></Tr>))}</tbody>
        </Table>
      )}
    </Panel>
  );
};

const Returns = () => {
  const tr = useT();
  const r = useLoad('/autoparts/returns');
  return (
    <Panel title={tr('Returned parts')} lead={tr('Every part that came back on a credit note, why, and what became of it. Issue the credit note from the bill.')}>
      <ListState loading={r.loading && !r.data} error={r.error} empty={r.data && r.data.length === 0} emptyLabel={tr('No returns yet.')} />
      {r.data?.length > 0 && (
        <Table>
          <Thead><Th>{tr('When')}</Th><Th>{tr('Part')}</Th><Th className="text-right">{tr('Qty')}</Th><Th>{tr('Why')}</Th><Th>{tr('Became')}</Th><Th>{tr('Credit note')}</Th></Thead>
          <tbody>{r.data.map((x) => (<Tr key={x.return_id}><Td className="whitespace-nowrap">{String(x.created_at).slice(0, 10)}</Td><Td>{x.part}</Td><Td className="tabular text-right">{n3(x.qty)}</Td><Td>{label(RETURN_REASONS, x.reason)}</Td><Td>{label(DISPOSITIONS, x.disposition)}</Td><Td>{x.cn_number}</Td></Tr>))}</tbody>
        </Table>
      )}
    </Panel>
  );
};

export default function PartsTrade() {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'holds';
  return (
    <div>
      <PageHeader title={tr('Trade and accounts')} lead={tr('Hold parts, set trade prices and credit for garages, and follow up with suppliers.')} />
      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={[{ key: 'holds', label: T('Holds') }, { key: 'prices', label: T('Price lists') }, { key: 'accounts', label: T('Garage accounts') }, { key: 'claims', label: T('Supplier claims') }, { key: 'returns', label: T('Returns') }]} />
      {tab === 'holds' && <Holds canEdit={can('billing') || can('warehouse')} />}
      {tab === 'prices' && <PriceLists canEdit={can('price_change')} />}
      {tab === 'accounts' && <Terms canEdit={can('price_change')} />}
      {tab === 'claims' && <Claims canEdit={can('returns_process') || can('stock_approve')} />}
      {tab === 'returns' && <Returns />}
    </div>
  );
}
