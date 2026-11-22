/* A member's money at a glance: the strip at the top of the page, and the Payments and Purchases tabs. Everything is read from their invoices; nothing here changes a balance. */
import { Link } from 'react-router-dom';
import { Badge, ListState, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { Panel } from '../salon/parts.jsx';
import { MEMBERSHIP_STATE, dayTime, longDate, rs } from '../../lib/gym.js';
import { useT } from '../../i18n/useT.js';

const METHOD = { CASH: 'Cash', UPI: 'UPI', CARD: 'Card', BANK_TRANSFER: 'Bank transfer', CHEQUE: 'Cheque', WALLET: 'Wallet' };
const kindOf = (i) => (i.is_membership ? 'Membership' : i.has_products ? 'Products' : 'Other');

/* The strip: what is running, what they owe, what they have spent. `current` is the membership running now (or next to start); `upcoming` the next one waiting. */
export const MemberSummary = ({ current, upcoming, fin }) => {
  const tr = useT();
  const s = fin?.summary;
  const state = current ? MEMBERSHIP_STATE[current.state] : null;
  const next = upcoming && upcoming !== current ? upcoming : null;
  const when = current && current.end_date ? ` · ${current.state === 'UPCOMING' ? tr('starts') : tr('ends')} ${longDate(current.state === 'UPCOMING' ? current.start_date : current.end_date)}` : '';
  return (
    <section aria-label={tr('Member at a glance')} className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-5">
      <StatCard label={tr('Membership')} value={current ? current.plan_name : tr('None')}
        note={current ? `${state?.label || ''}${when}${next ? ` · ${tr('next')}: ${next.plan_name} ${longDate(next.start_date)}` : ''}` : tr('Nothing running')} />
      <StatCard label={tr('Days left')} value={current && current.state !== 'UPCOMING' && current.days_left != null ? current.days_left : '–'} tone={current && current.days_left != null && current.days_left <= 7 ? 'warning' : undefined} />
      <StatCard label={tr('Owes')} value={s ? rs(s.due) : '…'} tone={s && s.due > 0 ? 'danger' : undefined} note={s ? (s.due > 0 ? tr('Unpaid on their bills') : tr('Nothing owed')) : undefined} />
      <StatCard label={tr('Spent in all')} value={s ? rs(s.billed) : '…'} note={s ? `${s.invoices} ${tr('bills')}, ${rs(s.paid)} ${tr('paid')}` : undefined} />
      <StatCard label={tr('Shop purchases')} value={s ? rs(s.purchase_spent) : '…'} note={s ? (s.purchases ? `${s.purchase_quantity} ${tr('items')}, ${s.purchases} ${tr('bills')}` : tr('Nothing bought yet')) : undefined} />
    </section>
  );
};

export const MemberPayments = ({ fin }) => {
  const tr = useT();
  const invoices = fin.data?.invoices || [];
  const payments = fin.data?.payments || [];
  return (
    <div className="space-y-5">
      <ListState loading={fin.loading && !fin.data} error={fin.error} />
      {fin.data && (
        <>
          <Panel title={tr('Bills')} lead={tr('Everything billed to this member: memberships, packs and shop sales.')}>
            {invoices.length === 0 ? <p className="text-small text-ink-500">{tr('No bills yet.')}</p> : (
              <Table>
                <Thead><Th>{tr('Date')}</Th><Th>{tr('Bill')}</Th><Th>{tr('For')}</Th><Th className="text-right">{tr('Total')}</Th><Th className="text-right">{tr('Paid')}</Th><Th className="text-right">{tr('Owes')}</Th></Thead>
                <tbody>{invoices.map((i) => (
                  <Tr key={i.invoice_id}>
                    <Td className="whitespace-nowrap">{longDate(i.invoice_date)}</Td>
                    <Td><Link to={`/app/billing/invoices/${i.invoice_id}`} className="font-medium text-brand-600 hover:underline">{i.invoice_number}</Link></Td>
                    <Td className="text-ink-500">{tr(kindOf(i))}</Td>
                    <Td className="tabular text-right">{rs(i.total - i.credited)}</Td>
                    <Td className="tabular text-right">{rs(i.amount_paid)}</Td>
                    <Td className="tabular text-right">{i.balance_due > 0 ? <Badge tone="danger">{rs(i.balance_due)}</Badge> : <span className="text-ink-500">–</span>}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </Panel>
          <Panel title={tr('Payments received')} lead={tr('Each payment, and the bill it went against.')}>
            {payments.length === 0 ? <p className="text-small text-ink-500">{tr('No payments yet.')}</p> : (
              <Table>
                <Thead><Th>{tr('When')}</Th><Th>{tr('How')}</Th><Th>{tr('Bill')}</Th><Th className="text-right">{tr('Amount')}</Th></Thead>
                <tbody>{payments.map((p) => (
                  <Tr key={p.payment_id}>
                    <Td className="whitespace-nowrap">{dayTime(p.created_at)}</Td>
                    <Td>{tr(METHOD[p.payment_method] || p.payment_method)}</Td>
                    <Td><Link to={`/app/billing/invoices/${p.invoice_id}`} className="text-brand-600 hover:underline">{p.invoice_number}</Link></Td>
                    <Td className="tabular text-right">{rs(p.amount)}</Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
};

export const MemberPurchases = ({ fin }) => {
  const tr = useT();
  const s = fin.data?.summary;
  const rows = fin.data?.purchases || [];
  const owing = (fin.data?.invoices || []).filter((i) => i.has_products && !i.is_membership).reduce((a, i) => a + (i.balance_due > 0 ? i.balance_due : 0), 0);
  return (
    <div className="space-y-5">
      <ListState loading={fin.loading && !fin.data} error={fin.error} />
      {fin.data && (
        <>
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-5">
            <StatCard label={tr('Total spent')} value={rs(s.purchase_spent)} />
            <StatCard label={tr('Items bought')} value={s.purchase_quantity} />
            <StatCard label={tr('Bills')} value={s.purchases} />
            <StatCard label={tr('Still owed on these')} value={rs(owing)} tone={owing > 0 ? 'danger' : undefined} />
            <StatCard label={tr('Last bought')} value={s.last_purchase_on ? longDate(s.last_purchase_on) : '–'} />
          </section>
          <Panel title={tr('What they bought')} lead={tr('Shop sales to this member. Memberships are under Payments.')}>
            {rows.length === 0 ? <p className="text-small text-ink-500">{tr('Nothing bought yet.')}</p> : (
              <Table>
                <Thead><Th>{tr('Date')}</Th><Th>{tr('Item')}</Th><Th className="text-right">{tr('Qty')}</Th><Th className="text-right">{tr('Price')}</Th><Th className="text-right">{tr('Discount')}</Th><Th className="text-right">{tr('Total')}</Th><Th>{tr('Bill')}</Th></Thead>
                <tbody>{rows.map((r) => (
                  <Tr key={r.item_id}>
                    <Td className="whitespace-nowrap">{longDate(r.invoice_date)}</Td>
                    <Td className="font-medium text-ink-900">{r.description}</Td>
                    <Td className="tabular text-right">{r.quantity}</Td>
                    <Td className="tabular text-right">{rs(r.unit_price)}</Td>
                    <Td className="tabular text-right">{r.discount > 0 ? rs(r.discount) : '–'}</Td>
                    <Td className="tabular text-right">{rs(r.line_total)}</Td>
                    <Td><Link to={`/app/billing/invoices/${r.invoice_id}`} className="text-brand-600 hover:underline">{r.invoice_number}</Link></Td>
                  </Tr>
                ))}</tbody>
              </Table>
            )}
          </Panel>
        </>
      )}
    </div>
  );
};
