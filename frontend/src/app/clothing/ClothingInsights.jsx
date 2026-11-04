/*
 * Clothing insights: what sells and what sits. From the shop's own bills and stock (GET /clothing/analytics): the sizes, colours and styles that sell most, margin by style, and the stock
 * that has not moved (ageing and dead stock). Sold is pieces on bills in the chosen days; stock is what is on hand now.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { formatCurrency } from '../../lib/api.js';
import { qs, useLoad } from '../../lib/salon.js';
import { Alert, PageHeader, StatCard } from '../../components/ui.jsx';
import { Chips, Panel, Tabs } from '../salon/parts.jsx';
import { useT, T } from '../../i18n/useT.js';

const rs = (paise) => formatCurrency((paise || 0) / 100);
const day = (d) => (d ? new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '');
const PERIODS = [{ value: '7', label: T('7 days') }, { value: '30', label: T('30 days') }, { value: '90', label: T('90 days') }];
const DEAD = [{ value: '30', label: T('30 days') }, { value: '60', label: T('60 days') }, { value: '90', label: T('90 days') }];

/** A row with a bar: how much of everything sold this one is. */
const Bar = ({ label, hex, pieces, share, note }) => (
  <li className="py-1.5">
    <div className="flex items-baseline justify-between gap-3 text-small">
      <span className="min-w-0 truncate font-medium text-ink-900">{hex !== undefined && <span aria-hidden="true" className="mr-1.5 inline-block h-3 w-3 rounded-full border border-line-strong align-middle" style={{ background: hex || '#e5e7eb' }} />}{label}</span>
      <span className="tabular shrink-0 text-ink-700">{pieces} <span className="text-caption text-ink-500">· {share}%</span></span>
    </div>
    <div className="mt-1 h-2 overflow-hidden rounded-full bg-surface-3"><div className="h-full rounded-full bg-brand-500" style={{ width: `${Math.max(share, pieces ? 2 : 0)}%` }} /></div>
    {note && <p className="mt-0.5 text-caption text-ink-500">{note}</p>}
  </li>
);

const ClothingInsights = () => {
  const tr = useT();
  const [days, setDays] = useState('30');
  const [dead, setDead] = useState('60');
  const [tab, setTab] = useState('sellers');
  const { data: a, error, loading } = useLoad(`/clothing/analytics${qs({ days, dead_days: dead })}`);
  const sold = (e) => tr('{{n}} left · {{p}}% sold', { n: e.stock, p: e.sell_through_pct });

  return (
    <div>
      <PageHeader title={tr('Clothing insights')} lead={tr('What sells, what earns and what sits on the shelf, from your own bills and stock.')} />
      <div className="mb-4 flex flex-wrap items-center gap-3"><span className="text-small text-ink-500">{tr('Sold in the last')}</span><Chips label="Period" options={PERIODS} value={days} onChange={setDays} /></div>
      <Alert>{error}</Alert>
      {loading && !a && <div className="h-40 animate-pulse rounded-(--radius-card) bg-surface-3" />}
      {a && (
        <>
          <div className="mb-5 grid grid-cols-2 gap-2 lg:grid-cols-4">
            <StatCard label={tr('Pieces sold')} value={a.totals.pieces} note={tr('{{n}} bills', { n: a.bills })} />
            <StatCard label={tr('Sales before GST')} value={rs(a.totals.revenue_paise)} />
            <StatCard label={tr('Margin')} value={a.totals.margin_pct == null ? '—' : `${a.totals.margin_pct}%`} note={rs(a.totals.margin_paise)} />
            <StatCard label={tr('Stock at cost')} value={rs(a.totals.stock_value_paise)} note={tr('{{n}} pieces', { n: a.totals.stock })} />
          </div>
          {a.totals.pieces === 0 && <p className="mb-4 rounded-(--radius-card) border border-dashed border-line-strong p-5 text-center text-small text-ink-500">{tr('Nothing sold in this time yet.')}</p>}
          <Tabs value={tab} onChange={setTab} tabs={[{ key: 'sellers', label: T('Best sellers') }, { key: 'margin', label: T('Margin by style') }, { key: 'stock', label: T('Ageing and dead stock') }]} />

          {tab === 'sellers' && (
            <div className="grid gap-4 lg:grid-cols-2">
              <Panel title={tr('Sizes')}><ul>{a.sizes.map((e) => <Bar key={e.size} label={e.size} pieces={e.pieces} share={e.share_pct} note={sold(e)} />)}</ul></Panel>
              <Panel title={tr('Colours')}><ul>{a.colours.map((e) => <Bar key={e.colour} label={e.colour} hex={e.hex} pieces={e.pieces} share={e.share_pct} note={sold(e)} />)}</ul></Panel>
              <Panel title={tr('Styles')} className="lg:col-span-2"><ul>{a.styles.map((e) => <Bar key={e.style_id} label={e.name} pieces={e.pieces} share={e.share_pct} note={`${e.style_code} · ${sold(e)}`} />)}</ul></Panel>
            </div>
          )}

          {tab === 'margin' && (
            <Panel title={tr('Margin by style')} lead={tr('Price less the cost on each bill, before GST. Highest margin first.')}>
              <ul className="divide-y divide-line">
                {[...a.styles].filter((e) => e.pieces > 0).sort((x, y) => (y.margin_pct ?? -1) - (x.margin_pct ?? -1)).map((e) => (
                  <li key={e.style_id} className="flex items-center justify-between gap-3 py-2 text-small">
                    <span className="min-w-0"><span className="block truncate font-medium text-ink-900">{e.name}</span><span className="block text-caption text-ink-500">{e.style_code} · {tr('{{n}} sold', { n: e.pieces })}</span></span>
                    <span className="tabular shrink-0 text-right"><span className="block font-semibold text-ink-900">{e.margin_pct == null ? '—' : `${e.margin_pct}%`}</span><span className="block text-caption text-ink-500">{rs(e.margin_paise)} {tr('on')} {rs(e.revenue_paise)}</span></span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}

          {tab === 'stock' && (
            <div className="space-y-4">
              <Panel title={tr('How long stock has sat')} lead={tr('Days since each size and colour last sold, or since it was added if it never has. Valued at cost.')}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {a.ageing.map((b) => <StatCard key={b.label} label={tr('{{d}} days', { d: b.label })} value={rs(b.value_paise)} note={tr('{{n}} pieces', { n: b.pieces })} tone={b.label === '91+' && b.pieces ? 'text-warning' : undefined} />)}
                </div>
              </Panel>
              <Panel title={tr('Dead stock')} lead={tr('In stock, but not sold for this long. Worth a discount or a rethink before buying more.')}
                     action={<Chips label={T('Dead after')} options={DEAD} value={dead} onChange={setDead} />}>
                {a.dead.length === 0 ? <p className="py-3 text-small text-ink-500">{tr('Nothing has been sitting this long.')}</p> : (
                  <>
                    <p className="mb-2 text-small text-ink-700">{tr('{{n}} pieces worth {{v}} across {{c}} sizes and colours.', { n: a.dead_total.pieces, v: rs(a.dead_total.value_paise), c: a.dead_total.variants })}</p>
                    <ul className="divide-y divide-line">
                      {a.dead.map((d) => (
                        <li key={d.product_id} className="flex items-center justify-between gap-3 py-2 text-small">
                          <span className="min-w-0"><span className="block truncate font-medium text-ink-900">{d.style_name} · {d.colour} · {d.size}</span>
                            <span className="block text-caption text-ink-500">{d.never_sold ? tr('Never sold') : tr('Last sold {{d}}', { d: day(d.last_sold) })} · {tr('{{n}} days', { n: d.days })}</span></span>
                          <span className="tabular shrink-0 text-right"><span className="block font-semibold text-ink-900">{rs(d.value_paise)}</span><span className="block text-caption text-ink-500">{tr('{{n}} pieces', { n: d.stock })}</span></span>
                        </li>
                      ))}
                    </ul>
                    <p className="mt-3 text-caption text-ink-500"><Link to="/app/clothing" className="font-semibold text-brand-600 hover:underline">{tr('Open Styles and sizes')}</Link> {tr('to change prices or archive a style.')}</p>
                  </>
                )}
              </Panel>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default ClothingInsights;
