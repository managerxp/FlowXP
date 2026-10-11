/*
 * Returns and exchanges at the counter: find the bill the customer brings back (its number, their name or phone), choose
 * what comes back, and either pay it back or keep the credit for an exchange. It uses the same credit note as the
 * invoice screen (GST reversed exactly, stock put back, a number of its own); the exchange then continues in Billing,
 * where the credit pays for the new items as a payment, never as a discount.
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftRight, Search } from 'lucide-react';
import CreditNoteModal from '../components/CreditNoteModal.jsx';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Input, StatusBadge, useToast } from '../components/ui.jsx';

const when = (d) => new Date(d).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const ReturnsPage = () => {
  const { can } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [bills, setBills] = useState(null);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(null);       // the bill being returned from
  const [done, setDone] = useState(null);       // the credit note just issued: offer the exchange

  const find = (text) => {
    setError('');
    api(`/invoices${text.trim() ? `?search=${encodeURIComponent(text.trim())}` : ''}`).then((r) => setBills((Array.isArray(r) ? r : []).slice(0, 20))).catch((e) => setError(e.message));
  };
  useEffect(() => { find(''); }, []);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => find(query), 300); return () => clearTimeout(t); }, [query]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!can('refunds')) return <Alert>You do not have access to returns. Ask the owner to allow refunds for your role.</Alert>;

  const issued = (note) => { setOpen(null); setDone(note); toast.success(`${note.cn_number} issued for ${formatCurrency(note.total)}`); };

  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-semibold tracking-tight text-ink-900">Returns and exchanges</h1>
      <p className="mt-1 text-sm text-ink-500">Find the bill the customer brought back. Pay the money back, or keep it as credit for something else.</p>

      <div className="relative mt-5">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input autoFocus aria-label="Find a bill" className="min-h-12 pl-10" placeholder="Bill number, customer name or phone" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <Alert>{error}</Alert>

      {done && (
        <div role="status" className="mt-5 rounded-(--radius-card) border border-success/40 bg-success/5 p-4">
          <p className="font-semibold text-ink-900">{done.cn_number}: {formatCurrency(done.total)} credited</p>
          <p className="mt-0.5 text-sm text-ink-700">{done.refunded > 0 ? `${formatCurrency(done.refunded)} was paid back.` : 'No money was paid back: the credit is kept.'}{done.credit_left > 0 ? ` ${formatCurrency(done.credit_left)} is available for an exchange.` : ''}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {done.credit_left > 0 && <Button onClick={() => navigate(`/app/billing?exchange=${done.cn_id}`)}><ArrowLeftRight aria-hidden="true" className="h-4 w-4" />Start the exchange sale</Button>}
            <Button variant="ghost" onClick={() => setDone(null)}>Done</Button>
          </div>
        </div>
      )}

      <ul className="mt-5 divide-y divide-line overflow-hidden rounded-(--radius-card) border border-line bg-surface" aria-label="Bills">
        {bills === null && <li className="px-4 py-6 text-sm text-ink-500">Loading…</li>}
        {bills?.length === 0 && <li className="px-4 py-6 text-sm text-ink-500">No bill matches that.</li>}
        {bills?.map((b) => (
          <li key={b.invoice_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
            <div className="min-w-0 flex-1">
              <p className="font-medium text-ink-900">{b.invoice_number} <span className="font-normal text-ink-500">· {when(b.invoice_date)}</span></p>
              <p className="truncate text-small text-ink-500">{b.customer_name || 'Walk-in'}</p>
            </div>
            <StatusBadge status={b.status} />
            <p className="tabular w-24 text-right font-semibold text-ink-900">{formatCurrency(b.total)}</p>
            <Button size="sm" variant="secondary" disabled={b.status !== 'ISSUED'} onClick={() => setOpen(b)}>Return items</Button>
          </li>
        ))}
      </ul>

      {open && <CreditNoteModal invoice={open} onClose={() => setOpen(null)} onIssued={issued} />}
    </div>
  );
};

export default ReturnsPage;
