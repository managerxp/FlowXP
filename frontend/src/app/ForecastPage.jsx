/*
 * Demand forecast and predictive stock.
 *
 * Everything on this page is a prediction, and says so: point values always sit
 * next to a typical range, the method is stated, and the recent accuracy of the
 * same method is shown so a person can judge how much to trust it. Purchasing
 * suggestions open a pre-filled purchase form — nothing is ordered until a
 * person reviews and saves it.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Badge, Button, Card, DataTable, Field, Input, PageHeader, useToast } from '../components/ui.jsx';

const TABS = [{ key: 'demand', label: 'Demand' }, { key: 'stock', label: 'Stock & purchasing' }];
const CONFIDENCE_TONE = { high: 'success', medium: 'warning', low: 'neutral' };
const STATUS = { ORDER_NOW: { tone: 'danger', label: 'Order now' }, ORDER_SOON: { tone: 'warning', label: 'Order soon' }, OK: { tone: 'success', label: 'OK' } };

const shortDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
const hourLabel = (h) => `${h % 12 === 0 ? 12 : h % 12}${h < 12 ? 'am' : 'pm'}`;
const range = (r, digits = 0) => (r ? `${r.low.toFixed(digits)}–${r.high.toFixed(digits)}` : '—');

const Prediction = () => <Badge tone="warning">Prediction</Badge>;

const Accuracy = ({ accuracy }) => {
  const a = accuracy?.orders;
  if (!a) return <span className="text-xs text-ink-400">Not enough history yet to check how accurate this has been.</span>;
  return (
    <span className="text-xs text-ink-500">
      On the last {a.days} days the same method was off by <strong className="text-ink-900">{a.mape_pct}%</strong> on average for orders
      {a.bias_pct !== 0 && <> and tended to run {Math.abs(a.bias_pct)}% {a.bias_pct > 0 ? 'high' : 'low'}</>}.
    </span>
  );
};

const Events = ({ events, onChanged }) => {
  const toast = useToast();
  const [form, setForm] = useState({ date: '', label: '', uplift_pct: '25' });
  const [error, setError] = useState('');
  const add = async (e) => {
    e.preventDefault(); setError('');
    try {
      await api('/forecast/events', { method: 'POST', body: { date: form.date, label: form.label, uplift_pct: Number(form.uplift_pct) } });
      toast.success('Event added — forecasts updated');
      setForm({ date: '', label: '', uplift_pct: '25' });
      onChanged();
    } catch (caught) { setError(caught.message); }
  };
  const remove = async (id) => { await api(`/forecast/events/${id}`, { method: 'DELETE' }); onChanged(); };

  return (
    <Card>
      <h2 className="text-sm font-semibold text-ink-900">Things you know that history doesn't</h2>
      <p className="mt-1 text-xs text-ink-500">A festival, a match night, a promotion, a planned closure. Tell FlowXP and it adjusts that day's forecast.</p>
      {events.length > 0 && (
        <ul className="mt-3 space-y-1.5 text-sm">
          {events.map((ev) => (
            <li key={ev.event_id} className="flex items-center justify-between gap-3">
              <span className="text-ink-700">{shortDate(ev.date)} · {ev.label} <span className="text-ink-400">({ev.multiplier >= 1 ? '+' : ''}{Math.round((ev.multiplier - 1) * 100)}%)</span></span>
              <button type="button" onClick={() => remove(ev.event_id)} className="text-xs font-semibold text-ink-400 hover:text-danger">Remove</button>
            </li>
          ))}
        </ul>
      )}
      <form onSubmit={add} className="mt-4 grid gap-3 sm:grid-cols-[9rem_1fr_7rem_auto] sm:items-end">
        <Field id="ev-date" label="Date"><Input id="ev-date" type="date" value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} required /></Field>
        <Field id="ev-label" label="What's happening"><Input id="ev-label" value={form.label} onChange={(e) => setForm((f) => ({ ...f, label: e.target.value }))} placeholder="e.g. Diwali weekend" required /></Field>
        <Field id="ev-pct" label="Expected change %"><Input id="ev-pct" type="number" step="5" value={form.uplift_pct} onChange={(e) => setForm((f) => ({ ...f, uplift_pct: e.target.value }))} required /></Field>
        <Button type="submit" size="sm">Add</Button>
      </form>
      <Alert>{error}</Alert>
    </Card>
  );
};

const Demand = () => {
  const [focus, setFocus] = useState(null);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  const load = (date = focus) => {
    api(`/forecast?horizon=7${date ? `&focus=${date}` : ''}`).then((d) => { setData(d); if (!date) setFocus(d.focus.date); }).catch((e) => setError(e.message));
  };
  useEffect(() => { load(null); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="py-10 text-center text-sm text-ink-400">Working out the week ahead…</p>;

  const peak = Math.max(...data.focus.hourly.map((h) => h.orders), 1);
  const focusDay = data.daily.find((d) => d.date === data.focus.date);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2"><Prediction /><Accuracy accuracy={data.accuracy} /></div>

      {data.daily.every((d) => d.insufficient_data) ? (
        <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-500">
          Forecasting needs at least three weeks of sales on the same weekday. You have {data.history_days} trading days so far — check back as history builds.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4 lg:grid-cols-7">
            {data.daily.map((d) => {
              const on = d.date === data.focus.date;
              return (
                <button key={d.date} type="button" onClick={() => { setFocus(d.date); load(d.date); }} aria-pressed={on}
                        className={`rounded-[--radius-card] border p-3 text-left transition-colors ${on ? 'border-brand-500 bg-brand-50' : 'border-line bg-surface hover:bg-surface-2'}`}>
                  <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{d.weekday.slice(0, 3)} {shortDate(d.date)}</p>
                  {d.orders ? (
                    <>
                      <p className="mt-1 text-xl font-bold text-ink-900">{Math.round(d.orders.predicted)}<span className="ml-1 text-xs font-medium text-ink-400">orders</span></p>
                      <p className="text-xs text-ink-500">typically {range(d.orders)}</p>
                      <p className="mt-1 text-xs text-ink-700">{d.revenue ? formatCurrency(d.revenue.predicted) : '—'}</p>
                      <div className="mt-1.5 flex flex-wrap items-center gap-1">
                        <Badge tone={CONFIDENCE_TONE[d.confidence]}>{d.confidence}</Badge>
                        {d.events.map((ev) => <Badge key={ev.event_id} tone="brand">{ev.label}</Badge>)}
                      </div>
                    </>
                  ) : <p className="mt-2 text-xs text-ink-400">Not enough history</p>}
                </button>
              );
            })}
          </div>

          <Card>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink-900">
                {focusDay?.weekday} {shortDate(data.focus.date)} <span className="font-normal text-ink-400">— hour by hour</span>
              </h2>
              <Prediction />
            </div>
            {data.focus.hourly.length > 0 ? (
              <div className="mt-4 flex h-32 items-end gap-1.5" role="img" aria-label="Expected orders by hour">
                {data.focus.hourly.map((h) => (
                  <div key={h.hour} className="flex h-full flex-1 flex-col items-center justify-end gap-1" title={`${hourLabel(h.hour)}: about ${h.orders} orders`}>
                    <span className="text-[10px] text-ink-500">{h.orders >= 1 ? Math.round(h.orders) : ''}</span>
                    <div className={`w-full rounded-t-sm ${h.orders >= peak * 0.8 ? 'bg-brand-500' : 'bg-brand-500/40'}`} style={{ height: `${(h.orders / peak) * 100}%` }} />
                    <span className="text-[10px] text-ink-400">{hourLabel(h.hour)}</span>
                  </div>
                ))}
              </div>
            ) : <p className="mt-3 text-sm text-ink-400">No hourly pattern yet.</p>}
          </Card>

          <div className="grid gap-6 lg:grid-cols-[2fr_1fr]">
            <div>
              <h2 className="mb-2 text-sm font-semibold text-ink-900">Expected portions — {shortDate(data.focus.date)}</h2>
              <DataTable
                keyField="product_id"
                rows={data.focus.items}
                emptyLabel="No item history yet."
                columns={[
                  { key: 'name', label: 'Dish' },
                  { key: 'category', label: 'Category' },
                  { key: 'portions', label: 'Portions', align: 'right', searchValue: () => '', render: (r) => <><strong>{Math.round(r.portions.predicted)}</strong> <span className="text-xs text-ink-400">({range(r.portions)})</span></> },
                  { key: 'confidence', label: 'Confidence', align: 'right', render: (r) => <Badge tone={CONFIDENCE_TONE[r.confidence]}>{r.confidence}</Badge> }
                ]}
              />
            </div>
            <Card>
              <h2 className="text-sm font-semibold text-ink-900">By category</h2>
              <ul className="mt-3 space-y-2 text-sm">
                {data.focus.categories.map((c) => (
                  <li key={c.category} className="flex items-baseline justify-between gap-2">
                    <span className="text-ink-700">{c.category}</span>
                    <span><strong className="text-ink-900">{Math.round(c.portions.predicted)}</strong> <span className="text-xs text-ink-400">{range(c.portions)}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>
        </>
      )}

      <Events events={data.upcoming_events} onChanged={() => load(focus)} />
      <p className="text-xs text-ink-400"><strong>How this is made:</strong> {data.method} It is a prediction from your own history, not a promise. A day with no sales at all is treated as closed.</p>
    </div>
  );
};

const Stock = () => {
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  useEffect(() => { api('/forecast/inventory').then(setData).catch((e) => setError(e.message)); }, []);

  if (error) return <Alert>{error}</Alert>;
  if (!data) return <p className="py-10 text-center text-sm text-ink-400">Projecting stock…</p>;
  const s = data.summary;

  const draft = (group) => navigate('/app/purchases', { state: { prefill: { supplier_id: group.supplier_id, items: group.items } } });

  // One draft per supplier for everything suggested, skipping what is already on order. Nothing is sent or received.
  const draftAll = async () => {
    setBusy(true); setNote(''); setError('');
    try {
      const r = await api('/purchases/orders/from-forecast', { method: 'POST', body: {} });
      if (r.orders.length) navigate('/app/purchases');
      else setNote(r.already_on_order.length ? 'Everything suggested is already on an open order.' : 'Nothing needs ordering right now.');
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-2">
        <Prediction />
        <span className="text-xs text-ink-500">Based on how much of each item your kitchen has actually used, day by day.</span>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {[['Order now', s.order_now, 'will run short before a delivery can arrive'], ['Order soon', s.order_soon, 'within the next couple of days'],
          ['Suggested purchases', formatCurrency(s.estimated_cost), 'at your latest prices'], ['Missed by a fixed minimum', s.flagged_only_by_prediction, 'items a simple low-stock alert would not have flagged']].map(([label, value, sub]) => (
          <div key={label} className="glass rounded-[--radius-card] p-4">
            <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">{label}</p>
            <p className="mt-1 text-xl font-bold text-ink-900">{value}</p>
            <p className="text-xs text-ink-400">{sub}</p>
          </div>
        ))}
      </div>

      {data.by_supplier.length > 0 && (
        <div>
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-ink-900">Suggested purchases</h2>
            <Button size="sm" onClick={draftAll} disabled={busy}>{busy ? 'Creating…' : 'Create draft orders for all'}</Button>
          </div>
          {note && <p className="mb-2 text-sm text-ink-500">{note}</p>}
          <div className="grid gap-4 md:grid-cols-2">
            {data.by_supplier.map((g) => (
              <Card key={g.supplier_id ?? 'none'}>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-sm font-semibold text-ink-900">{g.supplier_name}</h3>
                  <span className="text-sm font-bold text-ink-900">{formatCurrency(g.total)}</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm text-ink-600">
                  {g.items.map((i) => <li key={i.product_id} className="flex justify-between"><span>{i.name}</span><span>{i.quantity} {i.unit}</span></li>)}
                </ul>
                <Button size="sm" className="mt-4" onClick={() => draft(g)}>Review as an order</Button>
                <p className="mt-2 text-xs text-ink-400">Opens a pre-filled draft. Nothing is ordered until you send it.</p>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div>
        <h2 className="mb-2 text-sm font-semibold text-ink-900">Every tracked item</h2>
        <DataTable
          keyField="product_id"
          rows={data.items}
          searchPlaceholder="Search items…"
          emptyLabel="Not enough usage history yet — forecasts start once an item has a week of use."
          columns={[
            { key: 'name', label: 'Item' },
            { key: 'current_stock', label: 'In stock', align: 'right', render: (r) => `${r.current_stock} ${r.unit}` },
            { key: 'tomorrow_need', label: 'Tomorrow', align: 'right', render: (r) => `${r.tomorrow_need} ${r.unit}` },
            { key: 'days_of_cover', label: 'Cover', align: 'right', render: (r) => (r.days_of_cover == null ? '—' : `${r.days_of_cover} d`) },
            { key: 'reorder_point', label: 'Reorder at', align: 'right', render: (r) => <>{r.reorder_point} <span className="text-xs text-ink-400">(min {r.static_min_stock})</span></> },
            { key: 'status', label: 'Status', render: (r) => <Badge tone={STATUS[r.status].tone}>{STATUS[r.status].label}</Badge> },
            { key: 'recommended_qty', label: 'Buy', align: 'right', render: (r) => (r.recommended_qty ? `${r.recommended_qty} ${r.unit}` : '—') },
            { key: 'estimated_cost', label: 'Cost', align: 'right', render: (r) => (r.estimated_cost ? formatCurrency(r.estimated_cost) : '—') }
          ]}
        />
      </div>
      <p className="text-xs text-ink-400"><strong>How this is made:</strong> {data.method} Delivery time per item is set on the product (default 1 day).</p>
    </div>
  );
};

const ForecastPage = () => {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') === 'stock' ? 'stock' : 'demand');
  return (
    <div>
      <PageHeader title="Forecast" lead="What to expect, and what to have in the kitchen for it." />
      <div className="mb-5 flex gap-2 border-b border-line">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
                  className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${tab === t.key ? 'border-brand-500 text-brand-600' : 'border-transparent text-ink-500 hover:text-ink-900'}`}>
            {t.label}
          </button>
        ))}
      </div>
      {tab === 'demand' ? <Demand /> : <Stock />}
    </div>
  );
};

export default ForecastPage;
