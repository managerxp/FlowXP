/*
 * True profitability: what sales leave after food cost, payment fees, delivery
 * commission and packaging, then after rent, salaries and wastage.
 *
 * Everything here is an estimate built from recorded sales and the cost
 * assumptions the owner sets — the page says so, and the backend flags it
 * (`is_estimate`). This file only formats; the maths is in
 * backend/src/modules/profitability.js.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { Alert, Badge, Button, Card, DataTable, Field, Input, Modal, PageHeader, useToast } from '../components/ui.jsx';

const RANGES = [{ days: 7, label: '7 days' }, { days: 30, label: '30 days' }, { days: 60, label: '60 days' }];
const CHANNEL_LABEL = { COUNTER: 'Counter / dine-in', TAKEAWAY: 'Takeaway', DELIVERY: 'Delivery', ZOMATO: 'Zomato', SWIGGY: 'Swiggy', ONDC: 'ONDC', MAGICPIN: 'Magicpin' };
const PARTS = [
  { key: 'cogs', label: 'Food cost', color: 'bg-amber-500' },
  { key: 'payment_fees', label: 'Payment fees', color: 'bg-violet-500' },
  { key: 'commission', label: 'Platform commission', color: 'bg-cyan-500' },
  { key: 'packaging', label: 'Packaging', color: 'bg-teal-500' },
  { key: 'contribution', label: 'Contribution', color: 'bg-brand-500' }
];

const isoDaysAgo = daysAgoISO;
const pctText = (n) => (n == null ? '—' : `${n}%`);

/* "▲ 4.2% vs previous 30 days" — colour follows whether up is good for this metric. */
const Delta = ({ value, unit = '%', upIsGood = true }) => {
  if (value == null || value === 0) return <span className="text-xs text-ink-400">no change</span>;
  const good = (value > 0) === upIsGood;
  return <span className={`text-xs font-medium ${good ? 'text-success' : 'text-danger'}`}>{value > 0 ? '▲' : '▼'} {Math.abs(value)}{unit}</span>;
};

const Stat = ({ label, value, sub, delta }) => (
  <div className="glass rounded-[--radius-card] p-4">
    <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
    <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
    <div className="mt-1 flex items-center gap-2">{delta}{sub && <span className="text-xs text-ink-400">{sub}</span>}</div>
  </div>
);

const AssumptionsForm = ({ onSaved, onClose }) => {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/profitability/settings').then((s) => setForm({
      fees: { CASH: s.payment_fee_pct.CASH ?? '', UPI: s.payment_fee_pct.UPI ?? '', CARD: s.payment_fee_pct.CARD ?? '' },
      commissions: { ZOMATO: s.platform_commission_pct.ZOMATO ?? '', SWIGGY: s.platform_commission_pct.SWIGGY ?? '', ONDC: s.platform_commission_pct.ONDC ?? '', MAGICPIN: s.platform_commission_pct.MAGICPIN ?? '' },
      packaging: s.packaging_per_order || ''
    })).catch((e) => setError(e.message));
  }, []);

  const num = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, Number(v) || 0]));
  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/profitability/settings', { method: 'PUT', body: { payment_fee_pct: num(form.fees), platform_commission_pct: num(form.commissions), packaging_per_order: Number(form.packaging) || 0 } });
      toast.success('Assumptions saved');
      onSaved();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const pctField = (group, key, label) => (
    <Field key={key} id={`${group}-${key}`} label={label}>
      <Input id={`${group}-${key}`} type="number" min="0" max="100" step="0.1" placeholder="0" value={form[group][key]}
             onChange={(e) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: e.target.value } }))} />
    </Field>
  );

  return (
    <Modal title="Cost assumptions" onClose={onClose} wide>
      {!form ? <p className="text-sm text-ink-400">{error || 'Loading…'}</p> : (
        <form onSubmit={save} className="space-y-5">
          <Alert>{error}</Alert>
          <p className="text-sm text-ink-500">FlowXP can't know what your card machine or delivery platform charges. Enter your real rates; anything left at 0 is not deducted.</p>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-900">Payment fees (% of amount collected)</p>
            <div className="grid gap-3 sm:grid-cols-3">{[['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card']].map(([k, l]) => pctField('fees', k, l))}</div>
          </div>
          <div>
            <p className="mb-2 text-sm font-semibold text-ink-900">Delivery platform commission (% of food value)</p>
            <div className="grid gap-3 sm:grid-cols-4">{[['ZOMATO', 'Zomato'], ['SWIGGY', 'Swiggy'], ['ONDC', 'ONDC'], ['MAGICPIN', 'Magicpin']].map(([k, l]) => pctField('commissions', k, l))}</div>
          </div>
          <Field id="packaging" label="Packaging per takeaway / delivery order (₹)" hint="Box, bag, cutlery.">
            <Input id="packaging" type="number" min="0" step="0.5" placeholder="0" value={form.packaging} onChange={(e) => setForm((f) => ({ ...f, packaging: e.target.value }))} />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save assumptions'}</Button>
          </div>
        </form>
      )}
    </Modal>
  );
};

/* Revenue split into where it went. Widths are shares of net revenue. */
const MoneyBar = ({ totals }) => {
  const revenue = totals.net_revenue || 1;
  return (
    <div>
      <div className="flex h-4 overflow-hidden rounded-full bg-surface-3" role="img" aria-label="Where each rupee of revenue goes">
        {PARTS.map((p) => totals[p.key] > 0 && <div key={p.key} className={p.color} style={{ width: `${Math.max(0, (totals[p.key] / revenue) * 100)}%` }} title={`${p.label}: ${formatCurrency(totals[p.key])}`} />)}
      </div>
      <ul className="mt-3 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2 lg:grid-cols-5">
        {PARTS.map((p) => (
          <li key={p.key} className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-ink-600"><span className={`h-2.5 w-2.5 rounded-full ${p.color}`} />{p.label}</span>
            <span className="font-medium text-ink-900">{formatCurrency(totals[p.key])}</span>
          </li>
        ))}
      </ul>
    </div>
  );
};

/* Daily revenue bars, with the contribution share shaded darker. Plain divs: a chart library is a lot of bundle for one strip. */
const Trend = ({ days }) => {
  const max = Math.max(...days.map((d) => d.net_revenue), 1);
  return (
    <div className="flex h-28 items-end gap-[3px]" role="img" aria-label="Daily revenue and contribution">
      {days.map((d) => (
        <div key={d.day} className="group relative flex h-full flex-1 flex-col justify-end" title={`${d.day}: revenue ${formatCurrency(d.net_revenue)}, contribution ${formatCurrency(d.contribution)}`}>
          <div className="w-full rounded-t-sm bg-brand-500/25" style={{ height: `${(d.net_revenue / max) * 100}%` }}>
            <div className="w-full rounded-t-sm bg-brand-500" style={{ height: `${d.net_revenue > 0 ? Math.max(0, (d.contribution / d.net_revenue) * 100) : 0}%`, marginTop: 'auto' }} />
          </div>
        </div>
      ))}
    </div>
  );
};

const ProfitabilityPage = () => {
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [sort, setSort] = useState('contribution');

  const load = () => {
    setData(null); setError('');
    api(`/profitability?from=${isoDaysAgo(days - 1)}&to=${isoDaysAgo(0)}`).then(setData).catch((e) => setError(e.message));
  };
  useEffect(load, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const t = data?.totals;
  const c = data?.change_pct;
  const compare = data && `vs previous ${data.period.days} days`;

  const items = data ? [...data.items].sort((a, b) => (sort === 'margin' ? (a.contribution_margin_pct ?? 0) - (b.contribution_margin_pct ?? 0) : b[sort] - a[sort])) : [];

  return (
    <div>
      <PageHeader
        title="Profitability"
        lead="What your sales actually leave, after the costs that come with them."
        action={<Button variant="secondary" onClick={() => setEditing(true)}>Cost assumptions</Button>}
      />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.days} type="button" onClick={() => setDays(r.days)} aria-pressed={days === r.days}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${days === r.days ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>
            Last {r.label}
          </button>
        ))}
        <Badge tone="warning">Estimate</Badge>
        <span className="text-xs text-ink-400">Built from recorded sales and your cost assumptions — not an accounting figure.</span>
      </div>

      <Alert>{error}</Alert>
      {!data && !error && <p className="py-10 text-center text-sm text-ink-400">Calculating…</p>}

      {data && (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Net revenue" value={formatCurrency(t.net_revenue)} sub={compare} delta={<Delta value={c.net_revenue_pct} />} />
            <Stat label="Food cost" value={pctText(t.food_cost_pct)} sub="of revenue" delta={<Delta value={c.food_cost_pct_points} unit=" pts" upIsGood={false} />} />
            <Stat label="Gross margin" value={pctText(t.gross_margin_pct)} sub="after food cost" />
            <Stat label="Contribution" value={formatCurrency(t.contribution)} sub={pctText(t.contribution_margin_pct)} delta={<Delta value={c.contribution_pct} />} />
            <Stat label="Estimated net" value={formatCurrency(t.estimated_net)} sub="after expenses" delta={<Delta value={c.estimated_net_pct} />} />
          </div>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Where each rupee of revenue goes</h2>
            <MoneyBar totals={t} />
            <div className="mt-4 grid gap-3 border-t border-line pt-4 text-sm sm:grid-cols-3">
              <p className="text-ink-600">Contribution <strong className="text-ink-900">{formatCurrency(t.contribution)}</strong></p>
              <p className="text-ink-600">− Operating expenses <strong className="text-ink-900">{formatCurrency(data.period_costs.expenses_total)}</strong>
                <span className="block text-xs text-ink-400">{data.period_costs.expenses.slice(0, 3).map((e) => `${e.category} ${formatCurrency(e.amount)}`).join(' · ')}</span></p>
              <p className="text-ink-600">− Wastage <strong className="text-ink-900">{formatCurrency(data.period_costs.wastage)}</strong>
                <span className="block text-xs text-ink-400">valued at current cost</span></p>
            </div>
            <p className="mt-3 text-xs text-ink-400">
              {t.discount > 0 && <>Discounts given: {formatCurrency(t.discount)}. </>}
              {t.refunded > 0 && <>Refunds: {formatCurrency(t.refunded)}. </>}
              Both are already taken off revenue.
            </p>
          </Card>

          <Card>
            <h2 className="mb-3 text-sm font-semibold text-ink-900">Daily revenue <span className="font-normal text-ink-400">— darker part is contribution</span></h2>
            <Trend days={data.trend} />
          </Card>

          <div>
            <h2 className="mb-2 text-sm font-semibold text-ink-900">By channel</h2>
            <DataTable
              keyField="channel"
              rows={data.channels}
              emptyLabel="No sales in this period."
              columns={[
                { key: 'channel', label: 'Channel', render: (r) => CHANNEL_LABEL[r.channel] || r.channel },
                { key: 'invoices', label: 'Orders', align: 'right' },
                { key: 'net_revenue', label: 'Revenue', align: 'right', render: (r) => formatCurrency(r.net_revenue) },
                { key: 'food_cost_pct', label: 'Food cost', align: 'right', render: (r) => pctText(r.food_cost_pct) },
                { key: 'commission', label: 'Commission', align: 'right', render: (r) => (r.commission ? formatCurrency(r.commission) : '—') },
                { key: 'contribution', label: 'Contribution', align: 'right', render: (r) => formatCurrency(r.contribution) },
                { key: 'contribution_margin_pct', label: 'Margin', align: 'right', render: (r) => <span className={r.contribution_margin_pct < 60 ? 'font-semibold text-warning' : ''}>{pctText(r.contribution_margin_pct)}</span> }
              ]}
            />
          </div>

          <div>
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900">By menu item</h2>
              <label className="flex items-center gap-2 text-xs text-ink-500">Sort by
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="rounded-lg border border-line-strong bg-surface px-2 py-1 text-xs text-ink-900">
                  <option value="contribution">Total contribution</option>
                  <option value="revenue">Revenue</option>
                  <option value="quantity">Quantity sold</option>
                  <option value="contribution_per_unit">Contribution per portion</option>
                  <option value="margin">Margin (lowest first)</option>
                </select>
              </label>
            </div>
            <DataTable
              keyField="product_id"
              rows={items}
              searchPlaceholder="Search menu items…"
              emptyLabel="No items sold in this period."
              columns={[
                { key: 'name', label: 'Item' },
                { key: 'quantity', label: 'Sold', align: 'right' },
                { key: 'revenue', label: 'Revenue', align: 'right', render: (r) => formatCurrency(r.revenue) },
                { key: 'food_cost_pct', label: 'Food cost', align: 'right', render: (r) => pctText(r.food_cost_pct) },
                { key: 'contribution_per_unit', label: 'Per portion', align: 'right', render: (r) => formatCurrency(r.contribution_per_unit) },
                { key: 'contribution', label: 'Contribution', align: 'right', render: (r) => formatCurrency(r.contribution) },
                { key: 'contribution_margin_pct', label: 'Margin', align: 'right', render: (r) => <span className={r.contribution_margin_pct < 55 ? 'font-semibold text-warning' : ''}>{pctText(r.contribution_margin_pct)}</span> }
              ]}
            />
          </div>

          <details className="rounded-[--radius-card] border border-line bg-surface p-4 text-sm text-ink-600">
            <summary className="cursor-pointer font-semibold text-ink-900">How this is calculated</summary>
            <ul className="mt-3 list-disc space-y-1.5 pl-5">
              <li><strong>Net revenue</strong> is what was billed before tax, minus discounts and refunds. Cancelled invoices are left out.</li>
              <li><strong>Food cost</strong> is the ingredient cost recorded on each bill at the moment of sale, from the dish's recipe and your latest purchase prices.</li>
              <li><strong>Payment fees, commission and packaging</strong> use the rates in Cost assumptions. Unset means zero — not guessed.</li>
              <li><strong>Contribution</strong> is what each sale leaves toward rent, salaries and other fixed costs. <strong>Estimated net</strong> then subtracts recorded expenses and wastage.</li>
              <li>Order-level costs and discounts are shared across an order's items in proportion to their revenue.</li>
            </ul>
          </details>
        </div>
      )}

      {editing && <AssumptionsForm onClose={() => setEditing(false)} onSaved={() => { setEditing(false); load(); }} />}
    </div>
  );
};

export default ProfitabilityPage;
