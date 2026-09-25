/*
 * Revenue leakage: patterns that differ from this restaurant's own normal and
 * may be costing it money, each with the evidence to check.
 *
 * The wording is deliberate and comes from the backend — "unusual", "needs a
 * look", never a conclusion about a person. Owner/admin only (the API returns
 * 403 for anyone else, and this page says so plainly).
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { daysAgoISO } from '../lib/dates.js';
import { Alert, Badge, Button, Card, Input, PageHeader, useToast } from '../components/ui.jsx';

const RANGES = [{ days: 14, label: '14 days' }, { days: 30, label: '30 days' }, { days: 60, label: '60 days' }];
const CATEGORY_LABEL = { discounts: 'Discounts', cancellations: 'Cancellations', refunds: 'Refunds', wastage: 'Wastage', inventory: 'Stock adjustments' };
const SEVERITY = { critical: { tone: 'danger', label: 'Needs attention' }, warning: { tone: 'warning', label: 'Worth a look' }, informational: { tone: 'neutral', label: 'For information' } };

const isoDaysAgo = daysAgoISO;
const show = (value, unit) => (unit === '₹' ? formatCurrency(value) : `${value}${unit || ''}`);

const Evidence = ({ evidence }) => (
  <div className="mt-3 overflow-x-auto rounded-lg border border-line">
    <table className="w-full text-left text-xs">
      <thead className="bg-surface-2 text-ink-400">
        <tr>{evidence.columns.map((c) => <th key={c} className="px-3 py-2 font-semibold">{c}</th>)}</tr>
      </thead>
      <tbody>
        {evidence.rows.map((row, i) => (
          <tr key={i} className="border-t border-line text-ink-700">
            {row.map((cell, j) => (
              <td key={j} className="px-3 py-2">
                {typeof cell === 'number' && /collected|refunded|discount|amount|bill/i.test(evidence.columns[j]) && !/%/.test(evidence.columns[j]) ? formatCurrency(cell)
                  : typeof cell === 'number' && /% off/i.test(evidence.columns[j]) ? `${cell}%` : cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  </div>
);

const Finding = ({ finding, onReview }) => {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  const [deciding, setDeciding] = useState(null);   // 'REVIEWED' | 'DISMISSED'
  const sev = SEVERITY[finding.severity];
  const decided = finding.status !== 'OPEN';

  return (
    <Card className={decided ? 'opacity-70' : ''}>
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={sev.tone}>{sev.label}</Badge>
        <Badge>{CATEGORY_LABEL[finding.category] || finding.category}</Badge>
        <span className="text-xs text-ink-400">Confidence: {finding.confidence}</span>
        {decided && <Badge tone="success">{finding.status === 'DISMISSED' ? 'Dismissed' : 'Reviewed'}</Badge>}
        {finding.potential > 0 && <span className="ml-auto text-sm font-bold text-ink-900">{formatCurrency(finding.potential)} <span className="text-xs font-normal text-ink-400">potential</span></span>}
      </div>

      <h3 className="mt-3 text-base font-semibold text-ink-900">{finding.title}</h3>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{finding.summary}</p>

      {finding.expected_value !== undefined && (
        <div className="mt-3 grid gap-3 text-sm sm:grid-cols-3">
          <div><p className="text-xs text-ink-400">{finding.metric.label}</p><p className="font-semibold text-ink-900">{show(finding.current_value, finding.metric.unit)}</p></div>
          <div><p className="text-xs text-ink-400">Your normal</p><p className="font-semibold text-ink-900">{show(finding.expected_value, finding.metric.unit)}</p></div>
          <div><p className="text-xs text-ink-400">Difference</p><p className="font-semibold text-warning">+{show(finding.difference, finding.metric.unit)}</p></div>
        </div>
      )}

      <p className="mt-3 rounded-lg bg-surface-2 p-3 text-sm text-ink-700"><strong>Suggested next step:</strong> {finding.recommendation}</p>

      {finding.review?.note && <p className="mt-2 text-xs text-ink-500">Note: “{finding.review.note}” — {finding.review.reviewed_by}</p>}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        {finding.evidence && <Button size="sm" variant="secondary" onClick={() => setOpen((v) => !v)}>{open ? 'Hide details' : 'Investigate'}</Button>}
        {!decided && !deciding && (
          <>
            <Button size="sm" variant="ghost" onClick={() => setDeciding('REVIEWED')}>Mark reviewed</Button>
            <Button size="sm" variant="ghost" onClick={() => setDeciding('DISMISSED')}>Dismiss</Button>
          </>
        )}
        {decided && <Button size="sm" variant="ghost" onClick={() => onReview(finding, 'OPEN')}>Reopen</Button>}
      </div>

      {deciding && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="min-w-56 flex-1"><Input placeholder="Add a note (optional)" value={note} onChange={(e) => setNote(e.target.value)} autoFocus /></div>
          <Button size="sm" onClick={() => onReview(finding, deciding, note)}>{deciding === 'DISMISSED' ? 'Dismiss for 14 days' : 'Save'}</Button>
          <Button size="sm" variant="ghost" onClick={() => setDeciding(null)}>Cancel</Button>
        </div>
      )}

      {open && finding.evidence && <Evidence evidence={finding.evidence} />}
    </Card>
  );
};

const LeakagePage = () => {
  const toast = useToast();
  const [days, setDays] = useState(30);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [showDecided, setShowDecided] = useState(false);

  const load = () => {
    setError('');
    api(`/leakage?from=${isoDaysAgo(days - 1)}&to=${isoDaysAgo(0)}`).then(setData)
      .catch((e) => setError(e.status === 403 ? 'Only the owner and admins can see this page.' : e.message));
  };
  useEffect(() => { setData(null); load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = async (finding, status, note) => {
    try {
      await api('/leakage/reviews', { method: 'POST', body: { fingerprint: finding.fingerprint, status, note } });
      toast.success(status === 'OPEN' ? 'Reopened' : status === 'DISMISSED' ? 'Dismissed for 14 days' : 'Marked reviewed');
      load();
    } catch (caught) { toast.error(caught.message); }
  };

  const open = data?.findings.filter((f) => f.status === 'OPEN') ?? [];
  const decided = data?.findings.filter((f) => f.status !== 'OPEN') ?? [];
  const max = Math.max(...(data?.summary.by_category.map((c) => c.potential) ?? [1]), 1);

  return (
    <div>
      <PageHeader title="Revenue leakage" lead="Activity that differs from your own normal and may be costing you money." />

      <div className="mb-5 flex flex-wrap items-center gap-2">
        {RANGES.map((r) => (
          <button key={r.days} type="button" onClick={() => setDays(r.days)} aria-pressed={days === r.days}
                  className={`rounded-full border px-3.5 py-1.5 text-sm font-medium ${days === r.days ? 'border-brand-500 bg-brand-50 text-brand-600' : 'border-line-strong bg-surface text-ink-700'}`}>
            Last {r.label}
          </button>
        ))}
      </div>

      <Alert>{error}</Alert>
      {!data && !error && <p className="py-10 text-center text-sm text-ink-400">Checking your records…</p>}

      {data && (
        <div className="space-y-6">
          <Card>
            <div className="grid gap-6 lg:grid-cols-[auto_1fr] lg:items-center">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider text-ink-400">Potential leakage detected</p>
                <p className="mt-1 text-3xl font-bold text-ink-900">{formatCurrency(data.summary.potential)}</p>
                <p className="mt-1 text-xs text-ink-500">{data.summary.open} open finding{data.summary.open === 1 ? '' : 's'}{data.summary.critical > 0 && `, ${data.summary.critical} needing attention`}</p>
              </div>
              {data.summary.by_category.length > 0 && (
                <ul className="space-y-2">
                  {data.summary.by_category.map((c) => (
                    <li key={c.category} className="grid grid-cols-[8rem_1fr_auto] items-center gap-3 text-sm">
                      <span className="text-ink-600">{CATEGORY_LABEL[c.category] || c.category}</span>
                      <span className="h-2 overflow-hidden rounded-full bg-surface-3"><span className="block h-full rounded-full bg-brand-500" style={{ width: `${(c.potential / max) * 100}%` }} /></span>
                      <span className="font-medium text-ink-900">{formatCurrency(c.potential)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <p className="mt-4 border-t border-line pt-3 text-xs text-ink-500">{data.note} A pattern can have an ordinary explanation — a comped regular, a bad batch, a training week. The details below are there to check, not to conclude.</p>
          </Card>

          {open.length === 0 && (
            <p className="rounded-[--radius-card] border border-dashed border-line-strong py-10 text-center text-sm text-ink-500">
              Nothing unusual found in the last {data.period.days} days. FlowXP compares against your own normal, so this improves as your history grows.
            </p>
          )}
          <div className="space-y-4">{open.map((f) => <Finding key={f.fingerprint} finding={f} onReview={review} />)}</div>

          {decided.length > 0 && (
            <div>
              <button type="button" onClick={() => setShowDecided((v) => !v)} className="text-sm font-semibold text-brand-600">
                {showDecided ? 'Hide' : 'Show'} {decided.length} reviewed or dismissed
              </button>
              {showDecided && <div className="mt-3 space-y-4">{decided.map((f) => <Finding key={f.fingerprint} finding={f} onReview={review} />)}</div>}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default LeakagePage;
