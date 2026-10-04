/*
 * One figure on a dashboard, drawn to read without much reading: an icon in a tinted tile says what it is, the
 * number is large, a coloured pill with an arrow says how it moved against yesterday, and a sparkline shows its
 * last week. Used by every dashboard (restaurant/retail, pharmacy, salon, distributor). Pass `now`/`before` for the
 * change pill, or `note` for a line of words instead; `spark` (numbers, oldest first) for the line; `to` makes it a link.
 */
import { Link } from 'react-router-dom';
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react';
import { Sparkline } from './charts.jsx';

export const Delta = ({ now, before, against = 'vs yesterday' }) => {
  if (!before) return <span className="text-caption text-ink-500">{now ? `First sales ${against}` : 'Nothing yet today'}</span>;
  const pct = ((now - before) / before) * 100;
  const level = Math.abs(pct) < 0.5;
  const up = pct > 0;
  const Icon = level ? Minus : up ? ArrowUpRight : ArrowDownRight;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className={`tabular inline-flex items-center gap-0.5 rounded-full px-2 py-0.5 text-caption font-semibold ${level ? 'bg-surface-2 text-ink-500' : up ? 'bg-success/10 text-success' : 'bg-danger/10 text-danger'}`}>
        <Icon aria-hidden="true" className="h-3.5 w-3.5" strokeWidth={2.5} />{level ? '0%' : `${Math.abs(pct).toFixed(1)}%`}
        <span className="sr-only">{level ? ' level' : up ? ' up' : ' down'}</span>
      </span>
      <span className="text-caption text-ink-500">{against}</span>
    </span>
  );
};

/* Icon tile tints. Brand for money, the others to tell neighbouring figures apart at a glance; warning/success/danger
   only where the figure itself is good or bad news. */
export const TONES = {
  brand: 'bg-brand-50 text-brand-600',
  violet: 'bg-violet-50 text-violet-600',
  teal: 'bg-teal-50 text-teal-700',
  success: 'bg-success/10 text-success',
  warning: 'bg-warning/10 text-warning',
  danger: 'bg-danger/10 text-danger'
};

const MetricCard = ({ icon: Icon, tone = 'brand', label, value, valueTone, now, before, against, spark, note, to }) => {
  const body = (
    <>
      <span className="flex items-center gap-2.5">
        <span aria-hidden="true" className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${TONES[tone] || TONES.brand}`}><Icon className="h-[18px] w-[18px]" strokeWidth={2} /></span>
        <span className="text-small font-medium text-ink-500">{label}</span>
      </span>
      <span className={`tabular mt-3 block text-[26px] font-semibold leading-none tracking-tight [overflow-wrap:anywhere] ${valueTone || 'text-ink-900'}`}>{value}</span>
      <span className="mt-auto flex items-end justify-between gap-3 pt-3">
        <span className="min-w-0">{note !== undefined ? <span className="block text-caption text-ink-500">{note}</span> : now !== undefined ? <Delta now={now} before={before} against={against} /> : null}</span>
        {spark && spark.length > 1 && <span className="w-20 shrink-0 sm:w-24"><Sparkline values={spark} /></span>}
      </span>
    </>
  );
  const cls = 'flex h-full min-w-0 flex-col rounded-(--radius-card) border border-line bg-surface p-4 sm:p-5';
  return to
    ? <Link to={to} className={`${cls} transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-line-strong hover:shadow-sm`}>{body}</Link>
    : <div className={cls}>{body}</div>;
};

export default MetricCard;
