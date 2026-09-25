/*
 * The bill a customer opens from the link in their WhatsApp/SMS. No login, no app chrome:
 * the unguessable token in the URL is the whole key (see publicBill.controller.js).
 */
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, formatCurrency } from '../lib/api.js';

const Row = ({ label, value, strong }) => (
  <div className={`flex justify-between py-1 text-sm ${strong ? 'border-t border-line pt-2 text-base font-semibold text-ink-900' : 'text-ink-600'}`}><span>{label}</span><span>{value}</span></div>
);

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
      <p className="mt-4 text-center text-xs text-ink-400">Thank you for visiting {bill.business}.</p>
    </main>
  );
};

export default BillPage;
