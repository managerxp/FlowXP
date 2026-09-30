/*
 * The bill a customer opens from the link in their WhatsApp/SMS. No login, no app chrome:
 * the unguessable token in the URL is the whole key (see publicBill.controller.js).
 *
 * Also carries the "rate your visit" prompt (2026-09-29): a star rating and an
 * optional comment, submitted right here — no extra link, no app to install.
 * A 4-5 star rating is then asked to also post it on Google (the business's
 * own share link); 1-3 stars just says thanks and stays private for the
 * owner to see on their own Reviews page.
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatCurrency } from '../lib/api.js';

const Row = ({ label, value, strong }) => (
  <div className={`flex justify-between py-1 text-sm ${strong ? 'border-t border-line pt-2 text-base font-semibold text-ink-900' : 'text-ink-600'}`}><span>{label}</span><span>{value}</span></div>
);

const StarPicker = ({ value, onChange }) => (
  <div className="flex justify-center gap-1.5" role="radiogroup" aria-label="Rate your visit">
    {[1, 2, 3, 4, 5].map((n) => (
      <button
        key={n} type="button" role="radio" aria-checked={value === n} aria-label={`${n} star${n === 1 ? '' : 's'}`}
        onClick={() => onChange(n)}
        className={`text-3xl leading-none transition-transform ${value >= n ? 'text-warning' : 'text-line-strong'} hover:scale-110`}
      >★</button>
    ))}
  </div>
);

const FeedbackBox = ({ token, initial }) => {
  const [submitted, setSubmitted] = useState(initial ? { rating: initial.rating } : null);
  const [rating, setRating] = useState(initial?.rating || 0);
  const [comment, setComment] = useState(initial?.comment || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState(null); // { happy, google_review_link } after a fresh submit

  const submit = async () => {
    setError('');
    setBusy(true);
    try {
      const result = await api(`/public/bill/${token}/feedback`, { method: 'POST', body: { rating, comment: comment.trim() || undefined } });
      setSubmitted({ rating });
      setOutcome(result);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  };

  if (submitted) {
    return (
      <div className="mt-4 rounded-2xl border border-line bg-surface p-5 text-center shadow-sm">
        <p className="text-2xl" aria-hidden="true">{'★'.repeat(submitted.rating)}{'☆'.repeat(5 - submitted.rating)}</p>
        {outcome?.happy && outcome.google_review_link ? (
          <>
            <p className="mt-2 text-sm font-semibold text-ink-900">Thank you! Would you share this on Google too?</p>
            <a href={outcome.google_review_link} target="_blank" rel="noreferrer" className="mt-3 inline-block rounded-full bg-brand-500 px-5 py-2 text-sm font-semibold text-white">Post a Google review</a>
          </>
        ) : (
          <p className="mt-2 text-sm text-ink-600">Thanks for letting us know — we've noted it.</p>
        )}
      </div>
    );
  }

  return (
    <div className="mt-4 rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <p className="text-center text-sm font-semibold text-ink-900">How was your visit?</p>
      <div className="mt-3"><StarPicker value={rating} onChange={setRating} /></div>
      {rating > 0 && (
        <div className="mt-3 space-y-2">
          <textarea
            value={comment} onChange={(e) => setComment(e.target.value)} maxLength={1000} rows={2}
            placeholder="Anything you'd like to add? (optional)"
            className="w-full rounded-lg border border-line-strong bg-surface px-3 py-2 text-sm text-ink-900 placeholder:text-ink-400 focus:border-brand-500 focus:outline-none"
          />
          {error && <p className="text-xs text-danger">{error}</p>}
          <button type="button" onClick={submit} disabled={busy} className="w-full rounded-full bg-brand-500 py-2.5 text-sm font-semibold text-white disabled:opacity-60">
            {busy ? 'Sending…' : 'Submit'}
          </button>
        </div>
      )}
    </div>
  );
};

const BillPage = () => {
  const { token } = useParams();
  const [bill, setBill] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { api(`/public/bill/${token}`).then(setBill).catch((e) => setError(e.message)); }, [token]);

  if (error) return <p className="p-8 text-center text-sm text-ink-500">{error}</p>;
  if (!bill) return <p className="p-8 text-center text-sm text-ink-400">Loading your bill…</p>;
  const tax = bill.cgst + bill.sgst + bill.igst;

  return (
    <main className="mx-auto max-w-md p-5">
      <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
        <h1 className="text-lg font-semibold text-ink-900">{bill.business}</h1>
        {bill.outlet && bill.outlet !== 'Main' && <p className="text-sm text-ink-500">{bill.outlet}</p>}
        {bill.gstin && <p className="text-xs text-ink-400">GSTIN {bill.gstin}</p>}
        <p className="mt-3 text-sm text-ink-600">Bill {bill.invoice_number} · {new Date(bill.date).toLocaleDateString([], { day: 'numeric', month: 'short', year: 'numeric' })}</p>
        {bill.status === 'CANCELLED' && <p className="mt-2 rounded bg-danger/10 p-2 text-sm font-semibold text-danger">This bill was cancelled.</p>}

        <ul className="my-4 divide-y divide-line">
          {bill.items.map((i, n) => (
            <li key={n} className="flex justify-between py-2 text-sm"><span className="text-ink-900">{i.quantity} × {i.description}</span><span>{formatCurrency(i.amount)}</span></li>
          ))}
        </ul>

        <Row label="Subtotal" value={formatCurrency(bill.subtotal)} />
        {bill.discount > 0 && <Row label="Discount" value={`− ${formatCurrency(bill.discount)}`} />}
        {tax > 0 && <Row label="GST" value={formatCurrency(tax)} />}
        {bill.round_off !== 0 && <Row label="Round off" value={formatCurrency(bill.round_off)} />}
        <Row label="Total" value={formatCurrency(bill.total)} strong />
        <Row label="Paid" value={formatCurrency(bill.paid)} />
        {bill.balance > 0 && <Row label="Balance due" value={formatCurrency(bill.balance)} />}

        {bill.upi_link && <a href={bill.upi_link} className="mt-4 block rounded-full bg-brand-500 py-2.5 text-center text-sm font-semibold text-white">Pay {formatCurrency(bill.balance)} with UPI</a>}
      </div>
      {bill.feedback_enabled && <FeedbackBox token={token} initial={bill.feedback} />}
      <p className="mt-4 text-center text-xs text-ink-400">Thank you for visiting {bill.business}.</p>
    </main>
  );
};

export default BillPage;
