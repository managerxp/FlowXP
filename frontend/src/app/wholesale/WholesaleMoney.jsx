/*
 * Receivables and payables: what customers owe (ageing: current, 1–30, 31–60, 61–90, 90+ days), receipts (payments with
 * allocation to invoices, advances, reversals, refunds), credit control, and what you owe suppliers.
 */
import { useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Download, HandCoins } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { BUCKETS, BUCKET_TONES } from './constants.js';
import { PAYMENT_METHODS, dateText, money, pct, qs, saveCsv, useDebounced, useLoad } from '../../lib/wholesale.js';
import { Badge, Button, EmptyState, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { Chips, CustomerPicker, NumberField, Pager, Panel, StackStrip, Tabs, Toolbar, useAction } from './parts.jsx';
import ReceiptModal from './ReceiptModal.jsx';
import { SupplierPayModal } from './SupplierPayModal.jsx';
import { useT, T } from '../../i18n/useT.js';

const bucketCols = BUCKETS;

/* ── receivables ──────────────────────────────────────────────────────────────────────────────── */

const Receivables = ({ onPay }) => {
  const tr = useT();
  const navigate = useNavigate();
  const people = useLoad('/wholesale/salespeople');
  const [sp, setSp] = useState('');
  const { data, loading, error } = useLoad(`/wholesale/reports/receivables_ageing${qs({ salesperson_id: sp })}`);
  const credit = useLoad('/wholesale/reports/customer_outstanding');
  const t = data?.totals;
  const watch = (credit.data?.rows || []).filter((r) => r.over_limit || r.overdue > 0).slice(0, 8);
  const csv = () => saveCsv('receivables-ageing.csv', [{ key: 'customer', label: T('Customer') }, ...bucketCols.map(([k, label]) => ({ key: k, label })), { key: 'total', label: T('Total due') }], data.rows);
  return (
    <div className="space-y-6">
      {t && <section aria-label={tr('Totals')} className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard size="lg" label={tr('Customers owe')} value={money(t.total)} note={`${t.invoices} open invoice${t.invoices === 1 ? '' : 's'}`} />
        <StatCard size="lg" label={tr('Overdue')} value={money(t.d1_30 + t.d31_60 + t.d61_90 + t.d90_plus)} tone={t.d1_30 + t.d31_60 + t.d61_90 + t.d90_plus > 0 ? 'warning' : undefined} note={t.d90_plus ? `${money(t.d90_plus)} over 90 days` : 'Nothing over 90 days'} />
        <StatCard size="lg" label={tr('Current')} value={money(t.current)} note="Not yet due" />
        <StatCard size="lg" label={tr('Over credit limit')} value={(credit.data?.rows || []).filter((r) => r.over_limit).length} tone={(credit.data?.rows || []).some((r) => r.over_limit) ? 'danger' : undefined} note="Customers" />
      </section>}
      {t && <Panel title={tr('Ageing')} lead={tr('Days past the due date')}><StackStrip parts={bucketCols.map(([k, label]) => ({ label, value: t[k], tone: BUCKET_TONES[k] }))} /></Panel>}
      <div>
        <Toolbar>
          {(people.data || []).length > 0 && <div className="w-48"><Select aria-label={tr('Salesperson')} value={sp} onChange={(e) => setSp(e.target.value)}><option value="">{tr('All salespeople')}</option>{people.data.map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></div>}
          <div className="ml-auto flex gap-2">{data && <Button variant="secondary" onClick={csv}><Download aria-hidden="true" className="h-4 w-4" />{tr('CSV')}</Button>}<Button onClick={() => onPay(null)}>{tr('Record payment')}</Button></div>
        </Toolbar>
        <ListState loading={loading && !data} error={error} empty={data?.rows.length === 0} emptyIcon={HandCoins} emptyLabel={tr('Nothing is owed')} emptyBody="Every invoice is paid." />
        {data?.rows.length > 0 && <Table><Thead><Th>{tr('Customer')}</Th>{bucketCols.map(([k, label]) => <Th key={k} className="text-right">{tr(label)}</Th>)}<Th className="text-right">{tr('Total')}</Th><Th><span className="sr-only">{tr('Action')}</span></Th></Thead>
          <tbody>{data.rows.map((r) => <Tr key={r.customer} onClick={() => undefined}><Td className="font-medium">{r.customer}</Td>{bucketCols.map(([k]) => <Td key={k} className={`text-right tabular ${r[k] > 0 && k !== 'current' ? (k === 'd90_plus' || k === 'd61_90' ? 'font-semibold text-danger' : 'text-warning') : r[k] ? '' : 'text-ink-300'}`}>{r[k] ? money(r[k]) : '—'}</Td>)}<Td className="text-right tabular font-semibold">{money(r.total)}</Td><Td className="text-right"><Button size="sm" variant="ghost" onClick={() => onPay(r.customer)}>{tr('Collect')}</Button></Td></Tr>)}
            <Tr><Td className="font-semibold">{tr('Total')}</Td>{bucketCols.map(([k]) => <Td key={k} className="text-right tabular font-semibold">{money(t[k])}</Td>)}<Td className="text-right tabular font-semibold">{money(t.total)}</Td><Td /></Tr></tbody></Table>}
      </div>
      {watch.length > 0 && (
        <Panel title={tr('Credit watch')} lead={tr('Customers over their limit or with overdue invoices')} action={<Button to="/app/wholesale/reports?r=customer_outstanding" variant="ghost" size="sm">{tr('Full report')}</Button>}>
          <Table><Thead><Th>{tr('Customer')}</Th><Th className="text-right">{tr('Limit')}</Th><Th className="text-right">{tr('Owes')}</Th><Th className="text-right">{tr('Overdue')}</Th><Th className="text-right">{tr('Used')}</Th></Thead>
            <tbody>{watch.map((r) => <Tr key={r.customer}><Td className="font-medium">{r.customer}{r.over_limit && <span className="ml-2"><Badge tone="danger">{tr('over limit')}</Badge></span>}</Td><Td className="text-right tabular">{r.limit ? money(r.limit) : '—'}</Td><Td className="text-right tabular">{money(r.outstanding)}</Td><Td className={`text-right tabular ${r.overdue ? 'text-warning' : ''}`}>{r.overdue ? money(r.overdue) : '—'}</Td><Td className="text-right tabular">{r.utilization != null ? pct(r.utilization) : '—'}</Td></Tr>)}</tbody></Table>
        </Panel>
      )}
    </div>
  );
};

/* ── receipts ─────────────────────────────────────────────────────────────────────────────────── */

const AllocateModal = ({ receipt, onClose, onDone }) => {
  const tr = useT();
  const open = useLoad(`/wholesale/customers/${receipt.customer_id}/open-invoices`);
  const [busy, run] = useAction();
  return (
    <Modal title={tr('Apply {{receipt_number}}', { receipt_number: receipt.receipt_number })} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-small text-ink-500">{tr('{{money}} of this payment has not been applied to an invoice. It will be put against {{customer}}’s oldest open invoices.', { money: money(receipt.advance), customer: receipt.customer })}</p>
        <ListState loading={open.loading && !open.data} error={open.error} empty={open.data?.invoices.length === 0} emptyLabel={tr('No open invoices')} emptyBody="There is nothing to apply it to yet." />
        {open.data?.invoices.length > 0 && <ul className="divide-y divide-line rounded-(--radius-card) border border-line text-small">{open.data.invoices.slice(0, 8).map((i) => <li key={i.invoice_id} className="flex justify-between px-4 py-2"><span>{i.invoice_number} <span className="text-caption text-ink-500">{tr('due {{dateText}}', { dateText: dateText(i.due_date) })}</span></span><span className="tabular">{money(i.balance)}</span></li>)}</ul>}
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!open.data?.invoices.length} onClick={async () => { const r = await run(() => api(`/wholesale/receipts/${receipt.receipt_id}/allocate`, { method: 'POST', body: {} }), 'Applied'); if (r) onDone(); }}>{tr('Apply to invoices')}</Button></div>
      </div>
    </Modal>
  );
};

const RefundModal = ({ onClose, onDone }) => {
  const tr = useT();
  const [customer, setCustomer] = useState(null);
  const [f, setF] = useState({ amount: '', method: 'BANK_TRANSFER', reference: '' });
  const full = useLoad(customer ? `/wholesale/customers/${customer.customer_id}` : null);
  const [busy, run] = useAction();
  const owed = full.data ? Math.max(0, -full.data.outstanding) : 0;
  return (
    <Modal title={tr('Pay money back to a customer')} onClose={onClose}>
      <div className="space-y-4">
        <CustomerPicker value={customer} onChange={setCustomer} id="rf-customer" />
        {full.data && <p className={`rounded-lg px-3 py-2 text-small ${owed > 0 ? 'bg-brand-50 text-brand-700' : 'bg-warning/10 text-warning'}`}>{owed > 0 ? `You hold ${money(owed)} for this customer (advance or credit).` : tr('This customer has no credit or advance to pay back.')}</p>}
        <div className="grid gap-4 sm:grid-cols-2"><NumberField id="rf-amt" label={tr('Amount')} prefix="₹" min={0.01} value={f.amount} onChange={(v) => setF({ ...f, amount: v })} /><Field id="rf-m" label={tr('Method')}><Select id="rf-m" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(PAYMENT_METHODS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field></div>
        <Field id="rf-ref" label={tr('Reference')}><Input id="rf-ref" value={f.reference} onChange={(e) => setF({ ...f, reference: e.target.value })} maxLength={80} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4"><Button variant="ghost" onClick={onClose}>{tr('Cancel')}</Button><Button loading={busy} disabled={!customer || !(Number(f.amount) > 0) || Number(f.amount) > owed} onClick={async () => { const r = await run(() => api('/wholesale/refunds', { method: 'POST', body: { customer_id: customer.customer_id, amount: Number(f.amount), method: f.method, reference: f.reference || undefined } }), 'Refund recorded'); if (r) onDone(); }}>{tr('Record refund')}</Button></div>
      </div>
    </Modal>
  );
};

const Receipts = ({ reloadKey, onChanged }) => {
  const tr = useT();
  const { can } = useAuth();
  const dialog = useDialog();
  const toast = useToast();
  const [q, setQ] = useState('');
  const [view, setView] = useState('');
  const [offset, setOffset] = useState(0);
  const [allocating, setAllocating] = useState(null);
  const [refunding, setRefunding] = useState(false);
  const term = useDebounced(q.trim(), 250);
  const { data, meta, loading, error } = useLoad(`/wholesale/receipts${qs({ q: term, advance: view === 'advance' ? 1 : undefined, status: view === 'reversed' ? 'REVERSED' : undefined, limit: 50, offset, k: reloadKey })}`, { paged: true });
  const reverse = async (r) => {
    const reason = await dialog.prompt({ title: `Reverse ${r.receipt_number}?`, body: tr('Use this for a bounced cheque or a mistake. The invoices it paid go back to unpaid.'), label: tr('Reason'), confirmLabel: tr('Reverse it'), danger: true });
    if (!reason) return;
    try { await api(`/wholesale/receipts/${r.receipt_id}/reverse`, { method: 'POST', body: { reason } }); toast.success(tr('Receipt reversed')); onChanged(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <Toolbar><div className="w-full sm:w-72"><Input type="search" placeholder={tr('Receipt, customer or reference')} aria-label={tr('Search receipts')} value={q} onChange={(e) => { setQ(e.target.value); setOffset(0); }} /></div>
        <Chips label={tr('View')} value={view} onChange={(v) => { setView(v); setOffset(0); }} options={[{ value: '', label: T('All') }, { value: 'advance', label: T('With advance') }, { value: 'reversed', label: T('Reversed') }]} />
        {can('refunds') && <Button variant="secondary" className="ml-auto" onClick={() => setRefunding(true)}>{tr('Refund a customer')}</Button>}</Toolbar>
      <ListState loading={loading && !data} error={error} empty={data?.length === 0} emptyIcon={HandCoins} emptyLabel={tr('No receipts yet')} emptyBody="Record a payment when a customer pays." />
      {data?.length > 0 && <><Table><Thead><Th>{tr('Receipt')}</Th><Th>{tr('Date')}</Th><Th>{tr('Customer')}</Th><Th>{tr('Method')}</Th><Th className="text-right">{tr('Amount')}</Th><Th className="text-right">{tr('Applied')}</Th><Th className="text-right">{tr('Advance')}</Th><Th><span className="sr-only">{tr('Actions')}</span></Th></Thead>
        <tbody>{data.map((r) => <Tr key={r.receipt_id}><Td className="font-medium">{r.receipt_number}{r.status === 'REVERSED' && <span className="ml-2"><Badge tone="danger">{tr('reversed')}</Badge></span>}{r.kind === 'REFUND' && <span className="ml-2"><Badge tone="warning">{tr('refund')}</Badge></span>}</Td><Td>{dateText(r.receipt_date)}</Td><Td><Link to={`/app/wholesale/customers/${r.customer_id}`} className="text-brand-700">{r.customer}</Link></Td>
          <Td className="text-ink-500">{PAYMENT_METHODS[r.method] || r.method}{r.reference ? ` · ${r.reference}` : ''}</Td><Td className="text-right tabular font-medium">{money(r.amount)}</Td><Td className="text-right tabular">{r.kind === 'REFUND' ? '—' : money(r.allocated)}</Td><Td className={`text-right tabular ${r.advance > 0 && r.status === 'POSTED' && r.kind === 'RECEIPT' ? 'font-semibold text-brand-700' : 'text-ink-400'}`}>{r.kind === 'RECEIPT' && r.advance > 0 ? money(r.advance) : '—'}</Td>
          <Td className="text-right whitespace-nowrap">{r.status === 'POSTED' && r.kind === 'RECEIPT' && r.advance > 0 && can('payments') && <Button size="sm" variant="ghost" onClick={() => setAllocating(r)}>{tr('Apply')}</Button>}{r.status === 'POSTED' && can('refunds') && <Button size="sm" variant="ghost" onClick={() => reverse(r)}>{tr('Reverse')}</Button>}</Td></Tr>)}</tbody></Table><Pager meta={meta} onPage={setOffset} /></>}
      {allocating && <AllocateModal receipt={allocating} onClose={() => setAllocating(null)} onDone={() => { setAllocating(null); onChanged(); }} />}
      {refunding && <RefundModal onClose={() => setRefunding(false)} onDone={() => { setRefunding(false); onChanged(); }} />}
    </div>
  );
};

/* ── payables ─────────────────────────────────────────────────────────────────────────────────── */

const Payables = ({ reloadKey, onChanged }) => {
  const tr = useT();
  const { can } = useAuth();
  const navigate = useNavigate();
  const ageing = useLoad(`/wholesale/reports/payables_ageing?k=${reloadKey}`);
  const bills = useLoad(`/wholesale/purchase-orders${qs({ unpaid: 1, limit: 100, k: reloadKey })}`, { paged: true });
  const [paying, setPaying] = useState(null);
  const t = ageing.data?.totals;
  return (
    <div className="space-y-6">
      {t && <section aria-label={tr('Totals')} className="grid grid-cols-2 gap-3 lg:grid-cols-4"><StatCard size="lg" label={tr('You owe suppliers')} value={money(t.total)} note={`${t.bills} bill${t.bills === 1 ? '' : 's'}`} /><StatCard size="lg" label={tr('Overdue')} value={money(t.d1_30 + t.d31_60 + t.d61_90 + t.d90_plus)} tone={t.d1_30 + t.d31_60 + t.d61_90 + t.d90_plus > 0 ? 'warning' : undefined} /><StatCard size="lg" label={tr('Not yet due')} value={money(t.current)} /></section>}
      {t && <Panel title={tr('Ageing')} lead={tr('Days past the supplier’s due date')}><StackStrip parts={bucketCols.map(([k, label]) => ({ label, value: t[k], tone: BUCKET_TONES[k] }))} /></Panel>}
      <div>
        <h2 className="mb-3 text-body font-semibold text-ink-900">{tr('Unpaid supplier bills')}</h2>
        <ListState loading={bills.loading && !bills.data} error={bills.error} empty={bills.data?.length === 0} emptyIcon={HandCoins} emptyLabel={tr('Nothing to pay')} emptyBody="Every received purchase order is paid." />
        {bills.data?.length > 0 && <Table><Thead><Th>{tr('Order')}</Th><Th>{tr('Supplier')}</Th><Th>{tr('Their invoice')}</Th><Th>{tr('Due')}</Th><Th className="text-right">{tr('Total')}</Th><Th className="text-right">{tr('Balance')}</Th><Th><span className="sr-only">{tr('Pay')}</span></Th></Thead>
          <tbody>{bills.data.map((o) => { const late = o.due_date && String(o.due_date).slice(0, 10) < new Date().toISOString().slice(0, 10); return <Tr key={o.po_id} onClick={() => navigate(`/app/wholesale/purchasing/${o.po_id}`)}><Td className="font-medium text-brand-700">{o.po_number}</Td><Td>{o.supplier}</Td><Td className="text-ink-500">{o.supplier_invoice_no || '—'}</Td><Td className={late ? 'font-semibold text-danger' : ''}>{o.due_date ? dateText(o.due_date) : '—'}{late ? tr('· late') : ''}</Td><Td className="text-right tabular">{money(o.total)}</Td><Td className="text-right tabular font-semibold">{money(o.balance)}</Td><Td className="text-right">{can('payments') && <Button size="sm" variant="secondary" onClick={(e) => { e.stopPropagation(); setPaying(o); }}>{tr('Pay')}</Button>}</Td></Tr>; })}</tbody></Table>}
      </div>
      {paying && <SupplierPayModal po={paying} onClose={() => setPaying(null)} onDone={() => { setPaying(null); onChanged(); }} />}
    </div>
  );
};

const WholesaleMoney = () => {
  const tr = useT();
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || 'receivables';
  const [paying, setPaying] = useState(params.get('new') === '1' ? { name: null } : null);
  const [stamp, setStamp] = useState(0);
  const changed = () => setStamp((n) => n + 1);
  const payFor = async (name) => {
    if (!name) { setPaying({ name: null }); return; }
    try { const rows = await api(`/wholesale/customers?q=${encodeURIComponent(name)}&limit=1`); setPaying({ customer: rows[0] ? { customer_id: rows[0].customer_id, name: rows[0].name, customer_type: rows[0].customer_type, phone: rows[0].phone, gstin: rows[0].gstin } : null }); } catch { setPaying({ name: null }); }
  };
  return (
    <div>
      <PageHeader title={tr('Receivables & payables')} lead={tr('Who owes you, who you owe, and the payments in between.')} action={can('payments') && <Button onClick={() => setPaying({ name: null })}>{tr('Record payment')}</Button>} />
      <Tabs tabs={[{ key: 'receivables', label: T('Receivables') }, { key: 'receipts', label: T('Receipts') }, { key: 'payables', label: T('Payables') }]} value={tab} onChange={(k) => setParams(k === 'receivables' ? {} : { tab: k }, { replace: true })} />
      <div key={stamp}>
        {tab === 'receivables' && <Receivables onPay={payFor} />}
        {tab === 'receipts' && <Receipts reloadKey={stamp} onChanged={changed} />}
        {tab === 'payables' && <Payables reloadKey={stamp} onChanged={changed} />}
      </div>
      {paying && <ReceiptModal customer={paying.customer || null} onClose={() => { setPaying(null); setParams((p) => { const n = new URLSearchParams(p); n.delete('new'); return n; }, { replace: true }); }} onDone={() => { setPaying(null); changed(); }} />}
    </div>
  );
};

export default WholesaleMoney;
