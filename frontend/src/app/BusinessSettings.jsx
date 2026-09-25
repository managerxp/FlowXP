/*
 * Business details — the page the dashboard's setup checklist has always
 * linked to (`/app/settings/business`, see dashboard.controller.js's
 * buildChecklist) without one existing yet. Owner-only, same as any other
 * write to businesses.current (see routes/index.js's requireOwner).
 *
 * The UPI ID here is what powers the "pay via UPI" QR on the customer
 * ordering confirmation screen (public/CustomerMenu.jsx) — not a payment
 * gateway connection, just the business's own receiving address, the same
 * as a UPI QR sticker taped to the counter.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { PageHeader, Card, Field, Input, Select, Button, Alert, useToast } from '../components/ui.jsx';
import { getDevicePrefs, setDevicePref } from '../lib/printing.js';

const FIELDS = [
  ['name', 'Business name'],
  ['email', 'Email'],
  ['phone', 'Phone'],
  ['address', 'Address'],
  ['city', 'City'],
  ['state', 'State'],
  ['gstin', 'GSTIN', 'Optional — only needed if you charge GST'],
  ['upi_vpa', 'UPI ID for QR payments', 'e.g. shopname@okhdfcbank — shown to customers ordering by QR']
];

/* What every receipt and kitchen slip looks like (business-wide), and what THIS device does automatically. */
const ReceiptSettings = ({ initial }) => {
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [device, setDevice] = useState(getDevicePrefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api('/businesses/current', { method: 'PATCH', body: { receipt_settings: s } }); toast.success('Receipt settings saved'); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const flag = (key, label) => (
    <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={s[key]} onChange={(e) => setS((x) => ({ ...x, [key]: e.target.checked }))} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {label}</label>
  );
  const deviceFlag = (key, label) => (
    <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={device[key]} onChange={(e) => { setDevicePref(key, e.target.checked); setDevice((d) => ({ ...d, [key]: e.target.checked })); }} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {label}</label>
  );

  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">Receipts and kitchen slips</h2>
      <p className="mt-1 text-sm text-ink-500">Prints from the browser to any printer, including 58 mm and 80 mm receipt printers. Pick the printer in the print dialog.</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Alert>{error}</Alert>
        <Field id="paper" label="Paper width"><Select id="paper" value={s.paper_width} onChange={(e) => setS((x) => ({ ...x, paper_width: Number(e.target.value) }))}><option value={80}>80 mm (standard)</option><option value={58}>58 mm (narrow)</option></Select></Field>
        <Field id="footer" label="Footer message" hint="Printed at the bottom of every receipt."><Input id="footer" value={s.footer} onChange={(e) => setS((x) => ({ ...x, footer: e.target.value }))} maxLength={200} /></Field>
        <div className="space-y-2">{flag('show_gstin', 'Show the GSTIN on receipts')}{flag('show_upi_qr', 'Show a UPI QR for any unpaid balance')}{flag('show_loyalty', 'Show the customer’s loyalty card line')}</div>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save receipt settings'}</Button>
      </form>
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-900">This device</p>
        <p className="mb-2 text-xs text-ink-500">Remembered in this browser only, so the counter and the kitchen can behave differently.</p>
        <div className="space-y-2">{deviceFlag('autoPrintReceipt', 'Print the receipt automatically after billing')}{deviceFlag('autoPrintKot', 'Print the KOT automatically when an order is sent to the kitchen')}{deviceFlag('kitchenSound', 'Play a sound for new and late kitchen tickets')}</div>
      </div>
    </Card>
  );
};

/* Cash round-off: each bill rounded to the nearest rupee, with the difference shown on the bill. */
const RoundOffSetting = ({ initial }) => {
  const toast = useToast();
  const [on, setOn] = useState(Boolean(initial));
  const change = async (checked) => {
    setOn(checked);
    try { await api('/businesses/current', { method: 'PATCH', body: { round_off_enabled: checked } }); toast.success(checked ? 'Bills will be rounded to the rupee' : 'Round-off switched off'); }
    catch (caught) { setOn(!checked); toast.error?.(caught.message); }
  };
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">Billing</h2>
      <label className="mt-3 flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]" />
        <span>Round each bill to the nearest rupee<span className="block text-xs text-ink-500">The difference (for example +₹0.40) is shown as “Round off” on the bill, is never taxed, and is kept on the invoice. Applies to new bills.</span></span>
      </label>
    </Card>
  );
};

const BusinessSettings = () => {
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { api('/businesses/current').then(setForm).catch((e) => setError(e.message)); }, []);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/businesses/current', {
        method: 'PATCH',
        body: Object.fromEntries(FIELDS.map(([key]) => [key, form[key] || '']))
      });
      toast.success('Saved');
      refresh(); // business name may have changed — the nav/topbar read it from AuthContext
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  if (!form) return <p className="text-sm text-ink-400">Loading…</p>;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title="Business details" lead="Your business's own identity, contact and payment info." />
      <Card>
        <form onSubmit={save} className="space-y-4">
          <Alert>{error}</Alert>
          {FIELDS.map(([key, label, hint]) => (
            <Field key={key} id={key} label={label} hint={hint}>
              <Input id={key} value={form[key] || ''} onChange={set(key)} />
            </Field>
          ))}
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </form>
      </Card>
      <RoundOffSetting initial={form.round_off_enabled} />
      <ReceiptSettings initial={form.receipt_settings} />
    </div>
  );
};

export default BusinessSettings;
