/*
 * One purchase order: lines (ordered / received / outstanding), goods receipts, payments to the supplier, debit notes,
 * and the actions each stage allows (approve, email or WhatsApp the order, receive, pay, return goods, close short, cancel).
 */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Pencil } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { api } from '../../lib/api.js';
import { PAYMENT_METHODS, PO_STATUS, PAY_STATUS, dateText, longDate, money, qty, todayIn, useLoad } from '../../lib/wholesale.js';
import { Alert, Badge, Button, Field, Input, Modal, PageHeader, Select, Skeleton, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, StatusPill, useAction } from './parts.jsx';
import GrnModal from './GrnModal.jsx';
import { PurchaseReturnModal } from './ReturnModals.jsx';
import { SupplierPayModal as PayModal } from './SupplierPayModal.jsx';
import { useT } from '../../i18n/useT.js';

const PurchaseDetail = () => {
  const tr = useT();
  const { id } = useParams();
  const { can } = useAuth();
  const toast = useToast();
  const dialog = useDialog();
  const [stamp, setStamp] = useState(0);
  const { data: po, loading, error } = useLoad(`/wholesale/purchase-orders/${id}?k=${stamp}`);
  const [busy, run] = useAction();
  const [receiving, setReceiving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [returning, setReturning] = useState(false);
  const [sent, setSent] = useState(null);
  const refresh = () => setStamp((n) => n + 1);

  if (error) return <div><PageHeader title={tr('Purchase order')} /><Alert>{error}</Alert><Button to="/app/wholesale/purchasing" variant="secondary">{tr('Back')}</Button></div>;
  if (loading && !po) return <div className="space-y-3"><Skeleton className="h-10 w-64" /><Skeleton className="h-48" /></div>;
  if (!po) return null;
  const act = (path, success, body) => run(async () => { const r = await api(`/wholesale/purchase-orders/${id}/${path}`, { method: 'POST', body: body || {} }); refresh(); return r; }, success);
  const send = async () => { const r = await run(() => api(`/wholesale/purchase-orders/${id}/send`, { method: 'POST', body: {} }), 'Order prepared'); if (r) setSent(r); };
  const cancel = async () => { const reason = await dialog.prompt({ title: `Cancel ${po.po_number}?`, body: tr('Nothing has been received on it yet.'), label: tr('Reason (optional)'), required: false, confirmLabel: tr('Cancel order'), cancelLabel: tr('Keep it'), danger: true }); if (reason !== null) act('cancel', 'Order cancelled', { reason }); };
  const closeShort = async () => { if (await dialog.confirm({ title: tr('Close this order short?'), body: tr('The goods still owed will not be coming. The order is marked received.'), confirmLabel: tr('Close it') })) act('close-short', 'Order closed'); };
  const received = ['PARTIAL', 'RECEIVED'].includes(po.status);

  return (
    <div>
      <PageHeader title={<span className="flex flex-wrap items-center gap-3">{po.po_number}<StatusPill map={PO_STATUS} status={po.status} />{received && <StatusPill map={PAY_STATUS} status={po.payment_status} />}</span>} lead={`${po.supplier || 'No supplier'} · ${po.warehouse} · ${longDate(po.po_date)}`}
                  action={<>
                    {po.status === 'DRAFT' && can('purchases') && <Button variant="secondary" to={`/app/wholesale/purchasing/${id}/edit`}><Pencil aria-hidden="true" className="h-4 w-4" />{tr('Edit')}</Button>}
                    {po.status === 'DRAFT' && can('purchase_approve') && <Button loading={busy} onClick={() => act('approve', 'Order approved')}>{tr('Approve and order')}</Button>}
                    {['ORDERED', 'CONFIRMED', 'PARTIAL'].includes(po.status) && can('purchases') && <Button variant="secondary" loading={busy} onClick={send}>{tr('Send to supplier')}</Button>}
                    {['ORDERED', 'CONFIRMED', 'PARTIAL', 'DRAFT'].includes(po.status) && (can('purchases') || can('inventory')) && <Button variant={po.status === 'DRAFT' ? 'ghost' : 'primary'} onClick={() => setReceiving(true)}>{tr('Receive goods')}</Button>}
                    {received && po.balance > 0 && (can('payments') || can('purchases')) && <Button onClick={() => setPaying(true)}>{tr('Pay supplier')}</Button>}
                    {received && can('purchases') && <Button variant="secondary" onClick={() => setReturning(true)}>{tr('Return goods')}</Button>}
                    {po.status === 'PARTIAL' && can('purchases') && <Button variant="ghost" onClick={closeShort}>{tr('Close short')}</Button>}
                    {['DRAFT', 'ORDERED', 'CONFIRMED'].includes(po.status) && can('purchases') && <Button variant="ghost" onClick={cancel}>{tr('Cancel')}</Button>}
                  </>} />
      {po.status === 'DRAFT' && !can('purchase_approve') && <p className="mb-4 rounded-lg bg-surface-2 px-4 py-2.5 text-small text-ink-700">{tr('This is a draft. A purchase manager has to approve it before it is ordered.')}</p>}
      {po.approved_by && <p className="mb-4 text-small text-ink-500">{tr('Approved by {{approved_by}} on {{longDate}}.', { approved_by: po.approved_by, longDate: longDate(po.approved_at) })}</p>}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-6">
          <Panel title={tr('Items')}>
            <Table><Thead><Th>{tr('Product')}</Th><Th className="text-right">{tr('Ordered')}</Th><Th className="text-right">{tr('Received')}</Th><Th className="text-right">{tr('Outstanding')}</Th><Th className="text-right">{tr('Cost')}</Th><Th className="text-right">{tr('GST')}</Th></Thead>
              <tbody>{po.items.map((i) => <Tr key={i.item_id}><Td><span className="font-medium">{tr(i.description)}</span>{i.unit_factor !== 1 && <span className="block text-caption text-ink-500">1 {i.unit_name} = {qty(i.unit_factor)} {i.base_unit}</span>}</Td><Td className="text-right tabular">{qty(i.ordered)} {i.unit_name}</Td><Td className="text-right tabular">{i.received ? qty(i.received) : '—'}</Td><Td className={`text-right tabular ${i.outstanding > 0 && received ? 'font-semibold text-warning' : ''}`}>{i.outstanding > 0 ? qty(i.outstanding) : '—'}</Td><Td className="text-right tabular">{money(i.unit_cost)}</Td><Td className="text-right tabular">{i.tax_rate}%</Td></Tr>)}</tbody></Table>
          </Panel>
          {po.grns.length > 0 && <Panel title={tr('Goods receipts')}><Table><Thead><Th>{tr('GRN')}</Th><Th>{tr('Date')}</Th><Th>{tr('Supplier invoice')}</Th><Th className="text-right">{tr('Value')}</Th></Thead><tbody>{po.grns.map((g) => <Tr key={g.grn_id}><Td className="font-medium"><Link to={`/app/wholesale/purchasing?tab=grns`} className="text-brand-700">{g.grn_number}</Link></Td><Td>{dateText(g.grn_date)}</Td><Td>{g.supplier_invoice_no || '—'}</Td><Td className="text-right tabular">{money(g.total_cost)}</Td></Tr>)}</tbody></Table></Panel>}
          {(po.payments.length > 0 || po.debit_notes.length > 0) && (
            <Panel title={tr('Payments and debit notes')}><Table><Thead><Th>{tr('Date')}</Th><Th>{tr('Type')}</Th><Th>{tr('Reference')}</Th><Th className="text-right">{tr('Amount')}</Th></Thead><tbody>
              {po.payments.map((p) => <Tr key={`p${p.payment_id}`}><Td>{dateText(p.date)}</Td><Td><Badge tone="success">{tr('Payment · {{v}}', { v: (PAYMENT_METHODS[p.method] || p.method).toLowerCase() })}</Badge></Td><Td>{p.reference || '—'}</Td><Td className="text-right tabular">{money(p.amount)}</Td></Tr>)}
              {po.debit_notes.map((n) => <Tr key={`n${n.dn_id}`}><Td>{dateText(n.date)}</Td><Td><Badge tone="warning">{tr('Debit note · {{v}}', { v: n.kind.toLowerCase() })}</Badge></Td><Td>{n.dn_number}</Td><Td className="text-right tabular">{money(n.total)}</Td></Tr>)}</tbody></Table></Panel>
          )}
        </div>
        <aside className="space-y-4">
          <Panel title={tr('Money')}><dl className="space-y-1.5 text-small">
            <div className="flex justify-between"><dt className="text-ink-500">{tr('Before GST')}</dt><dd className="tabular">{money(po.subtotal)}</dd></div><div className="flex justify-between"><dt className="text-ink-500">{po.reverse_charge ? tr('GST you pay yourself (reverse charge)') : tr('GST')}</dt><dd className="tabular">{money(po.tax)}</dd></div>
            <div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>{received ? tr('Payable') : tr('Order value')}</dt><dd className="tabular">{money(po.total)}</dd></div>
            {po.debited > 0 && <div className="flex justify-between"><dt className="text-ink-500">{tr('Returned')}</dt><dd className="tabular">−{money(po.debited)}</dd></div>}
            {received && <><div className="flex justify-between"><dt className="text-ink-500">{tr('Paid')}</dt><dd className="tabular">{money(po.paid)}</dd></div><div className="flex justify-between border-t border-line pt-2 font-semibold"><dt>{tr('Balance')}</dt><dd className={`tabular ${po.balance > 0 ? 'text-warning' : ''}`}>{money(po.balance)}</dd></div></>}
          </dl>{!received && po.status !== 'CANCELLED' && <p className="mt-2 text-caption text-ink-500">{tr('Nothing is payable until goods are received. You pay for what is accepted.')}</p>}</Panel>
          <Panel title={tr('Terms')}><dl className="space-y-1.5 text-small">
            <div className="flex justify-between"><dt className="text-ink-500">{tr('Supplier')}</dt><dd>{po.supplier_id ? <Link to={`/app/wholesale/suppliers/${po.supplier_id}`} className="font-medium text-brand-700">{po.supplier}</Link> : '—'}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-500">{tr('Payment terms')}</dt><dd>{po.payment_terms_days != null ? `${po.payment_terms_days} days` : '—'}</dd></div>
            {po.expected_date && <div className="flex justify-between"><dt className="text-ink-500">{tr('Expected')}</dt><dd>{dateText(po.expected_date)}</dd></div>}
            {po.supplier_invoice_no && <div className="flex justify-between"><dt className="text-ink-500">{tr('Their invoice')}</dt><dd>{po.supplier_invoice_no}</dd></div>}
            {po.due_date && <div className="flex justify-between"><dt className="text-ink-500">{tr('Payment due')}</dt><dd className={po.balance > 0 && po.due_date < todayIn() ? 'font-semibold text-danger' : ''}>{dateText(po.due_date)}</dd></div>}
          </dl></Panel>
          {po.notes && <Panel title={tr('Notes')}><p className="whitespace-pre-line text-small text-ink-700">{po.notes}</p></Panel>}
        </aside>
      </div>
      {receiving && <GrnModal poId={Number(id)} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); refresh(); }} />}
      {paying && <PayModal po={po} onClose={() => setPaying(false)} onDone={() => { setPaying(false); refresh(); }} />}
      {returning && <PurchaseReturnModal poId={Number(id)} onClose={() => setReturning(false)} onDone={() => { setReturning(false); refresh(); }} />}
      {sent && (
        <Modal title={tr('Send to supplier')} onClose={() => setSent(null)}>
          <div className="space-y-4">
            <p className="text-small text-ink-500">{sent.emailed ? tr('The order was emailed to the supplier.') : tr('No email address is on file for this supplier.')}</p>
            <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-surface-2 p-3 text-small text-ink-900">{sent.message}</pre>
            <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4"><Button variant="secondary" onClick={() => { navigator.clipboard?.writeText(sent.message); toast.success(tr('Copied')); }}>{tr('Copy text')}</Button>{sent.whatsapp_url && <Button href={sent.whatsapp_url} target="_blank" rel="noreferrer">{tr('Open WhatsApp')}</Button>}<Button variant="ghost" onClick={() => setSent(null)}>{tr('Done')}</Button></div>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PurchaseDetail;
