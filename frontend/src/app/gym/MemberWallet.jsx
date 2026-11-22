/* A member's wallet: money they left in advance. Add money, pay a bill from it, refund what is left, and see every movement. */
import { useState } from 'react';
import { Banknote, Receipt, Undo2 } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { METHODS, dayTime, rs, useLoad } from '../../lib/gym.js';
import { Alert, Button, Field, Input, ListState, Modal, Select, StatCard, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, useAction } from '../salon/parts.jsx';
import { useT } from '../../i18n/useT.js';

const KIND = { DEPOSIT: 'Money added', SPEND: 'Paid a bill', REFUND: 'Refunded', RETURN: 'Bill cancelled, money back' };
const IN_METHODS = METHODS.filter(([k]) => ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].includes(k));

export default function MemberWallet({ memberId, fin, canAdd, canRefund, onChanged }) {
  const tr = useT();
  const toast = useToast();
  const w = useLoad(`/gym/members/${memberId}/wallet`);
  const [dialog, setDialog] = useState(null);   // 'add' | 'pay' | 'refund'
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [invoice, setInvoice] = useState('');
  const [why, setWhy] = useState('');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const d = w.data;
  const owed = (fin?.invoices || []).filter((i) => i.balance_due > 0);
  const close = () => { setDialog(null); setError(''); setAmount(''); setWhy(''); setInvoice(''); setMethod('CASH'); };
  const send = (path, body, done) => run(async () => {
    try { await api(`/gym/members/${memberId}/wallet/${path}`, { method: 'POST', body, idempotencyKey: key.get() }); key.settle(null); close(); toast.success(done); w.reload(); onChanged?.(); }
    catch (e) { key.settle(e); setError(e.message); }
  }, null);
  const footer = (go, ok) => <><Button variant="secondary" onClick={close}>{tr('Cancel')}</Button><Button onClick={go} loading={busy} disabled={!ok}>{tr('Save')}</Button></>;
  return (
    <div className="space-y-5">
      <ListState loading={w.loading && !d} error={w.error} />
      {d && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={tr('Wallet balance')} value={rs(d.balance)} tone={d.balance > 0 ? 'success' : undefined} note={tr('Money they have left with you')} />
            <StatCard label={tr('Owes on bills')} value={rs(owed.reduce((a, i) => a + i.balance_due, 0))} tone={owed.length ? 'danger' : undefined} note={owed.length ? `${owed.length} ${tr('bills')}` : tr('Nothing owed')} />
          </section>
          <Panel title={tr('Wallet')} lead={tr('Money paid in advance. It is not income until a bill is paid from it.')}
            action={<div className="flex flex-wrap gap-2">
              {canAdd && <Button size="sm" onClick={() => setDialog('add')}><Banknote aria-hidden="true" className="h-4 w-4" />{tr('Add money')}</Button>}
              {canAdd && <Button size="sm" variant="secondary" onClick={() => setDialog('pay')} disabled={!d.balance || !owed.length}><Receipt aria-hidden="true" className="h-4 w-4" />{tr('Pay a bill')}</Button>}
              {canRefund && <Button size="sm" variant="secondary" onClick={() => setDialog('refund')} disabled={!d.balance}><Undo2 aria-hidden="true" className="h-4 w-4" />{tr('Refund')}</Button>}
            </div>}>
            {d.rows.length === 0 ? <p className="text-small text-ink-500">{tr('Nothing in the wallet yet.')}</p> : (
              <Table>
                <Thead><Th>{tr('When')}</Th><Th>{tr('What')}</Th><Th>{tr('Note')}</Th><Th className="text-right">{tr('Amount')}</Th></Thead>
                <tbody>{d.rows.map((r) => (
                  <Tr key={r.entry_id}>
                    <Td className="whitespace-nowrap">{dayTime(r.created_at)}</Td>
                    <Td>{tr(KIND[r.kind] || r.kind)}{r.invoice_number ? ` · ${r.invoice_number}` : ''}</Td>
                    <Td className="text-ink-500">{r.reason || r.method || ''}{r.by ? ` · ${r.by}` : ''}</Td>
                    <Td className={`tabular text-right ${r.amount_paise < 0 ? 'text-danger' : 'text-success'}`}>{r.amount_paise < 0 ? '-' : '+'}{rs(Math.abs(r.amount_paise) / 100)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
      {dialog === 'add' && (
        <Modal title={tr('Add money to the wallet')} onClose={close} footer={footer(() => send('deposit', { amount: Number(amount), method }, tr('Money added')), Number(amount) >= 1)}>
          <NumberField id="wl-amt" label={tr('Amount (Rs)')} value={amount} onChange={setAmount} min={1} step={1} />
          <div className="mt-3"><Field id="wl-m" label={tr('Paid by')}><Select id="wl-m" value={method} onChange={(e) => setMethod(e.target.value)}>{IN_METHODS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select></Field></div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
      {dialog === 'pay' && (
        <Modal title={tr('Pay a bill from the wallet')} onClose={close} footer={footer(() => send('pay-invoice', { invoice_id: Number(invoice), ...(amount ? { amount: Number(amount) } : {}) }, tr('Bill paid from the wallet')), !!invoice)}>
          <Field id="wl-inv" label={tr('Which bill')}><Select id="wl-inv" value={invoice} onChange={(e) => setInvoice(e.target.value)}><option value="">{tr('Choose')}</option>{owed.map((i) => <option key={i.invoice_id} value={i.invoice_id}>{i.invoice_number} · {tr('owes')} {rs(i.balance_due)}</option>)}</Select></Field>
          <div className="mt-3"><NumberField id="wl-pa" label={tr('Amount (Rs)')} hint={tr('Leave empty to pay as much as the wallet covers.')} value={amount} onChange={setAmount} min={1} step={1} /></div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
      {dialog === 'refund' && (
        <Modal title={tr('Refund from the wallet')} onClose={close} footer={footer(() => send('refund', { amount: Number(amount), method, reason: why }, tr('Refunded')), Number(amount) >= 1 && !!why.trim())}>
          <NumberField id="wl-ra" label={tr('Amount (Rs)')} value={amount} onChange={setAmount} min={1} step={1} />
          <div className="mt-3"><Field id="wl-rm" label={tr('Given back by')}><Select id="wl-rm" value={method} onChange={(e) => setMethod(e.target.value)}>{IN_METHODS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select></Field></div>
          <div className="mt-3"><Field id="wl-rw" label={tr('Why')} hint={tr('Kept on the ledger with your name.')}><Input id="wl-rw" value={why} onChange={(e) => setWhy(e.target.value)} /></Field></div>
          {error && <div className="mt-3"><Alert>{error}</Alert></div>}
        </Modal>
      )}
    </div>
  );
}
