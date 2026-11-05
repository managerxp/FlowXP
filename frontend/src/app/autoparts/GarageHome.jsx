/*
 * The home screen of a mechanic garage: what is in the garage now, what came in today, and the three or four things the owner does all day. Big numbers, plain words, no charts.
 * Money spent and cash in hand join it when Money Out and Close Today exist.
 */
import { Link } from 'react-router-dom';
import { ArrowDownLeft, ArrowUpRight, Plus, ShoppingBag, UserPlus, Wrench } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { rsPaise, useLoad } from '../../lib/autoparts.js';
import { Badge, ListState, PageHeader } from '../../components/ui.jsx';
import { useT, T } from '../../i18n/useT.js';

const STATUS = {
  OPEN: [T('Waiting'), 'neutral'], CHECKING: [T('Checking'), 'brand'], IN_PROGRESS: [T('Being worked on'), 'brand'], WAITING_PARTS: [T('Waiting for parts'), 'warning'], READY: [T('Ready'), 'success']
};

const Big = ({ label, value, note, tone, to }) => {
  const body = (
    <div className={`h-full rounded-xl border bg-surface p-4 ${tone === 'ready' ? 'border-success/40' : 'border-line'}`}>
      <p className="text-small text-ink-500">{label}</p>
      <p className="tabular mt-1 text-h3 font-semibold text-ink-900">{value}</p>
      {note ? <p className="mt-0.5 text-caption text-ink-500">{note}</p> : null}
    </div>
  );
  return to ? <Link to={to} className="block focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">{body}</Link> : body;
};

const Action = ({ to, icon: Icon, children, primary }) => (
  <Link to={to} className={`flex min-h-14 flex-1 items-center justify-center gap-2 rounded-xl px-4 py-3 text-body font-semibold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500 ${primary ? 'bg-brand-600 text-white hover:bg-brand-700' : 'border border-line-strong bg-surface text-ink-900 hover:bg-surface-2'}`}>
    <Icon aria-hidden="true" className="h-5 w-5" />{children}
  </Link>
);

export default function GarageHome() {
  const tr = useT();
  const { business, can } = useAuth();
  const l = useLoad('/autoparts/garage/today');
  const d = l.data;
  return (
    <div>
      <PageHeader title={business?.name || tr('Your garage')} lead={tr('What is in the garage and what came in today.')} />
      <div className="mb-5 flex flex-wrap gap-3">
        {can('billing') && <Action to="/app/parts/jobs?new=1" icon={Plus} primary>{tr('New job card')}</Action>}
        {can('billing') && <Action to="/app/customers?add=1" icon={UserPlus}>{tr('Add customer')}</Action>}
        {['grn', 'purchases'].some(can) && <Action to="/app/parts/receive" icon={ShoppingBag}>{tr('Buy spare parts')}</Action>}
        {['payments', 'expenses'].some(can) && <Action to="/app/money" icon={ArrowDownLeft}>{tr('Money In')}</Action>}
        {['payments', 'expenses'].some(can) && <Action to="/app/money" icon={ArrowUpRight}>{tr('Money Out')}</Action>}
      </div>
      <ListState loading={l.loading && !d} error={l.error} />
      {d && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
            <Big label={tr('Vehicles received today')} value={d.received_today} to="/app/parts/jobs" />
            <Big label={tr('Work in progress')} value={d.in_progress} to="/app/parts/jobs" />
            <Big label={tr('Ready for delivery')} value={d.ready} tone={d.ready > 0 ? 'ready' : undefined} to="/app/parts/jobs" />
            <Big label={tr('Delivered today')} value={d.delivered_today} />
            <Big label={tr('Today\'s collection')} value={rsPaise(d.collected_paise)} note={d.collected_paise > 0 ? tr('{{cash}} in cash', { cash: rsPaise(d.cash_collected_paise) }) : undefined} />
            <Big label={tr('Today\'s expenses')} value={rsPaise(d.spent_paise)} to="/app/money" />
            <Big label={tr('Cash in hand')} value={rsPaise(d.cash_in_hand_paise)} note={tr('Cash taken less cash spent today')} to="/app/money" />
            <Big label={tr('Customer payments due')} value={rsPaise(d.customer_due_paise)} note={d.customers_owing > 0 ? tr('From {{n}} customers', { n: d.customers_owing }) : undefined} to={['customers', 'billing'].some(can) ? '/app/customers' : undefined} />
          </div>
          <h2 className="mb-3 mt-7 text-title font-semibold text-ink-900">{tr('Today\'s work')}</h2>
          {d.work.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line-strong p-8 text-center text-body text-ink-500">{tr('No vehicles in the garage right now.')}</p>
          ) : (
            <ul className="grid gap-3 md:grid-cols-2">
              {d.work.map((j) => (
                <li key={j.job_id}>
                  <Link to="/app/parts/jobs" className="block rounded-xl border border-line bg-surface p-4 hover:border-line-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-title font-semibold tracking-wide text-ink-900">{j.vehicle_reg || '—'}</p>
                      <Badge tone={STATUS[j.status]?.[1] || 'neutral'}>{STATUS[j.status] ? tr(STATUS[j.status][0]) : j.status}</Badge>
                    </div>
                    <p className="mt-1 text-body text-ink-700">{[j.make, j.model].filter(Boolean).join(' ') || '—'}</p>
                    <p className="text-small text-ink-500">{j.customer_name || '—'} · {j.job_no}</p>
                    {j.promised_on && <p className="mt-1 text-caption text-ink-500">{tr('Promised for {{date}}', { date: j.promised_on })}</p>}
                    <p className="mt-2 inline-flex items-center gap-1.5 text-small font-semibold text-brand-700"><Wrench aria-hidden="true" className="h-4 w-4" />{tr('Open job card')}</p>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
