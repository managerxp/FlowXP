/* The supplement desk: pick a member (or sell to a walk-in), add products, take payment (cash, UPI, card or the member's wallet) and see what is running low. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Minus, Plus, ShoppingBag, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { METHODS, longDate, qs, rs, rsPaise, useDebounced, useLoad } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, useAction } from '../salon/parts.jsx';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { useT } from '../../i18n/useT.js';

const PAY_METHODS = METHODS.filter(([k]) => ['CASH', 'UPI', 'CARD', 'BANK_TRANSFER'].includes(k));

function Sale({ onSold }) {
  const tr = useT();
  const toast = useToast();
  const { hasFeature } = useAuth();
  const [search, setSearch] = useState('');
  const sq = useDebounced(search);
  const found = useLoad(`/gym/shop/products${qs({ q: sq.trim(), limit: 12 })}`);
  const [cart, setCart] = useState([]);                   // [{ product, quantity }]
  const [who, setWho] = useState('');
  const wq = useDebounced(who);
  const [member, setMember] = useState(null);
  const members = useLoad(!member && wq.trim().length >= 2 ? `/gym/members${qs({ q: wq.trim(), limit: 6 })}` : null, { paged: true });
  const wallet = useLoad(member && hasFeature('gym_wallet') ? `/gym/members/${member.member_id}/wallet` : null);
  const [method, setMethod] = useState('CASH');
  const [mode, setMode] = useState('FULL');               // FULL | PART | LATER
  const [part, setPart] = useState('');
  const [useWallet, setUseWallet] = useState(false);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const key = useIdempotencyKey();
  const balance = wallet.data?.balance || 0;
  const estimate = cart.reduce((a, l) => a + (l.product.selling_price_paise / 100) * l.quantity * (1 + l.product.tax_rate / 100), 0);

  const add = (p) => setCart((c) => (c.some((l) => l.product.product_id === p.product_id) ? c.map((l) => (l.product.product_id === p.product_id ? { ...l, quantity: l.quantity + 1 } : l)) : [...c, { product: p, quantity: 1 }]));
  const bump = (id, d) => setCart((c) => c.map((l) => (l.product.product_id === id ? { ...l, quantity: l.quantity + d } : l)).filter((l) => l.quantity > 0));
  const reset = () => { setCart([]); setMember(null); setWho(''); setMode('FULL'); setPart(''); setUseWallet(false); setError(''); };

  const sell = () => run(async () => {
    setError('');
    const body = { member_id: member?.member_id, items: cart.map((l) => ({ product_id: l.product.product_id, quantity: l.quantity })), method, use_wallet: useWallet && balance > 0 };
    if (mode === 'FULL') body.amount = 'FULL';   // with the wallet on, the wallet pays first and this method pays the rest
    else if (mode === 'PART') body.amount = Number(part);
    try {
      const out = await api('/gym/shop/sale', { method: 'POST', body, idempotencyKey: key.get() });
      key.settle(null);
      toast.success(`${out.invoice_number} · ${rs(out.total)}${out.still_owed > 0 ? ` · ${tr('owes')} ${rs(out.still_owed)}` : ''}`);
      reset(); found.reload(); onSold?.();
    } catch (e) { key.settle(e); setError(e.message); }
  }, null);

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_24rem]">
      <Panel title={tr('Products')} lead={tr('Search by name, SKU or barcode, then tap to add.')}>
        <Input aria-label={tr('Search products')} placeholder={tr('Search products')} value={search} onChange={(e) => setSearch(e.target.value)} />
        <ListState loading={found.loading && !found.data} error={found.error} />
        <ul className="mt-3 divide-y divide-line">
          {(found.data || []).map((p) => (
            <li key={p.product_id} className="flex items-center gap-3 py-2 text-small">
              <div className="min-w-0 flex-1"><p className="truncate font-medium text-ink-900">{p.name}</p><p className="text-caption text-ink-500">{rsPaise(p.selling_price_paise)}{p.tax_rate ? ` + ${p.tax_rate}% GST` : ''}{p.track_inventory ? ` · ${p.stock} ${tr('in stock')}` : ''}</p></div>
              {p.track_inventory && p.stock <= p.min_stock && <Badge tone="warning">{tr('Low')}</Badge>}
              <Button size="sm" variant="secondary" onClick={() => add(p)} disabled={p.track_inventory && p.stock <= 0}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add')}</Button>
            </li>
          ))}
        </ul>
        {found.data && found.data.length === 0 && <p className="text-small text-ink-500">{tr('No product matches.')} <Link to="/app/inventory" className="text-brand-600 hover:underline">{tr('Add products in Inventory')}</Link></p>}
      </Panel>
      <Panel title={tr('This sale')}>
        <div className="space-y-4">
          {member ? (
            <div className="flex items-center justify-between rounded-md border border-line px-3 py-2 text-small">
              <span><span className="font-medium text-ink-900">{member.name}</span><span className="text-ink-500"> · {member.member_code}</span>{hasFeature('gym_wallet') && wallet.data && <span className="block text-caption text-ink-500">{tr('Wallet')}: {rs(balance)}</span>}</span>
              <button type="button" aria-label={tr('Remove member')} onClick={() => { setMember(null); setUseWallet(false); if (mode === 'LATER') setMode('FULL'); }} className="text-ink-500 hover:text-ink-900"><X className="h-4 w-4" /></button>
            </div>
          ) : (
            <div>
              <Input aria-label={tr('Member')} placeholder={tr('Member name, phone or number (or leave empty for a walk-in)')} value={who} onChange={(e) => setWho(e.target.value)} />
              <ul className="mt-1 divide-y divide-line rounded-md border border-line empty:hidden">{(members.data || []).map((m) => <li key={m.member_id}><button type="button" onClick={() => { setMember(m); setWho(''); }} className="w-full px-3 py-2 text-left text-small hover:bg-surface-2">{m.name} <span className="text-ink-500">· {m.member_code}</span></button></li>)}</ul>
            </div>
          )}
          {cart.length === 0 ? <p className="text-small text-ink-500">{tr('Nothing added yet.')}</p> : (
            <ul className="divide-y divide-line">
              {cart.map((l) => (
                <li key={l.product.product_id} className="flex items-center gap-2 py-2 text-small">
                  <span className="min-w-0 flex-1 truncate">{l.product.name}</span>
                  <button type="button" aria-label={tr('Less')} onClick={() => bump(l.product.product_id, -1)} className="rounded border border-line p-1"><Minus className="h-3.5 w-3.5" /></button>
                  <span className="tabular w-6 text-center">{l.quantity}</span>
                  <button type="button" aria-label={tr('More')} onClick={() => bump(l.product.product_id, 1)} className="rounded border border-line p-1"><Plus className="h-3.5 w-3.5" /></button>
                </li>
              ))}
            </ul>
          )}
          <p className="flex justify-between text-small"><span className="text-ink-500">{tr('About (with GST)')}</span><span className="tabular font-semibold">{rs(estimate)}</span></p>
          <Field id="sh-m" label={tr('Paid by')}><Select id="sh-m" value={method} onChange={(e) => setMethod(e.target.value)}>{PAY_METHODS.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select></Field>
          {member && hasFeature('gym_wallet') && balance > 0 && (
            <label className="flex items-center gap-2 text-small"><input type="checkbox" checked={useWallet} onChange={(e) => setUseWallet(e.target.checked)} />{tr('Use the wallet first')} ({rs(balance)})</label>
          )}
          <Field id="sh-mode" label={tr('Payment')}>
            <Select id="sh-mode" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option value="FULL">{tr('Paid in full')}</option>
              <option value="PART">{tr('Part now, rest owed')}</option>
              {member && <option value="LATER">{tr('Pay later (adds to dues)')}</option>}
            </Select>
          </Field>
          {mode === 'PART' && <NumberField id="sh-part" label={tr('Paid now (Rs)')} value={part} onChange={setPart} min={1} step={1} />}
          {error && <Alert>{error}</Alert>}
          <Button onClick={sell} loading={busy} disabled={!cart.length || (mode === 'PART' && !Number(part))} className="w-full"><ShoppingBag aria-hidden="true" className="h-4 w-4" />{tr('Complete sale')}</Button>
        </div>
      </Panel>
    </div>
  );
}

function Alerts() {
  const tr = useT();
  const a = useLoad('/gym/shop/alerts');
  const d = a.data;
  return (
    <div className="space-y-5">
      <ListState loading={a.loading && !d} error={a.error} />
      {d && (
        <>
          <Panel title={tr('Running low')} lead={tr('At or under the minimum you set for the product.')}>
            {d.low_stock.length === 0 ? <p className="text-small text-ink-500">{tr('Everything is stocked.')}</p> : (
              <Table>
                <Thead><Th>{tr('Product')}</Th><Th className="text-right">{tr('In stock')}</Th><Th className="text-right">{tr('Minimum')}</Th></Thead>
                <tbody>{d.low_stock.map((r) => <Tr key={r.product_id}><Td className="font-medium text-ink-900">{r.name}</Td><Td className="tabular text-right">{r.stock <= 0 ? <Badge tone="danger">{tr('Out')}</Badge> : r.stock}</Td><Td className="tabular text-right">{r.min_stock}</Td></Tr>)}</tbody>
              </Table>
            )}
          </Panel>
          {d.batches.length > 0 && (
            <Panel title={tr('Expired or expiring')} lead={`${d.expired} ${tr('expired')}, ${d.expiring} ${tr('expiring soon')}`}>
              <Table>
                <Thead><Th>{tr('Product')}</Th><Th>{tr('Batch')}</Th><Th>{tr('Expires')}</Th><Th className="text-right">{tr('Qty')}</Th></Thead>
                <tbody>{d.batches.map((r) => <Tr key={r.batch_id}><Td className="font-medium text-ink-900">{r.name}</Td><Td>{r.batch_no}</Td><Td>{longDate(r.expiry_date)} {r.days_left < 0 ? <Badge tone="danger">{tr('Expired')}</Badge> : <Badge tone="warning">{r.days_left} {tr('days')}</Badge>}</Td><Td className="tabular text-right">{r.qty_on_hand}</Td></Tr>)}</tbody>
              </Table>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

export default function GymShop() {
  const tr = useT();
  const [tab, setTab] = useState('sell');
  const [sold, setSold] = useState(0);
  return (
    <div>
      <PageHeader title={tr('Shop')} lead={tr('Sell supplements and other products at the desk, and keep an eye on the shelves.')} />
      <Tabs tabs={[{ key: 'sell', label: tr('Sell') }, { key: 'stock', label: tr('Stock alerts') }]} value={tab} onChange={setTab} />
      {tab === 'sell' ? <Sale onSold={() => setSold((n) => n + 1)} /> : <Alerts key={sold} />}
    </div>
  );
}
