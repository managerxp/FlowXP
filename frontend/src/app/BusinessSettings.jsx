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
import { getDevicePrefs, setDevicePref, testPrint } from '../lib/printing.js';

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

/* The picture printed at the top of browser receipts. */
const LogoSetting = ({ logoUrl, onChange }) => {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true); setError('');
    try {
      const body = new FormData(); body.append('logo', file);
      const r = await api('/businesses/current/logo', { method: 'POST', body });
      onChange(r.logo_url); toast.success('Logo saved');
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); e.target.value = ''; }
  };
  const remove = async () => {
    setBusy(true); setError('');
    try { await api('/businesses/current/logo', { method: 'DELETE' }); onChange(null); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <div>
      <p className="mb-1 text-sm font-medium text-ink-700">Logo</p>
      <Alert>{error}</Alert>
      <div className="flex items-center gap-4">
        {logoUrl ? <img src={logoUrl} alt="Your logo" className="h-14 max-w-[8rem] rounded border border-line bg-white object-contain p-1" /> : <span className="text-xs text-ink-400">No logo yet</span>}
        <label className="cursor-pointer text-sm font-semibold text-brand-600">
          {busy ? 'Working…' : logoUrl ? 'Replace' : 'Upload'}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={upload} disabled={busy} />
        </label>
        {logoUrl && <button type="button" className="text-sm font-semibold text-danger" onClick={remove} disabled={busy}>Remove</button>}
      </div>
      <p className="mt-1 text-xs text-ink-500">PNG, JPEG or WebP up to 2 MB. A simple black-and-white logo prints best; it appears on receipts printed from the browser (silent thermal printing shows the business name in large text).</p>
    </div>
  );
};

/* Silent printing: this computer's print agent, printers and cash drawer. Remembered in this browser only. */
const SilentPrinting = () => {
  const [p, setP] = useState(getDevicePrefs);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key, value) => { setDevicePref(key, value); setP((x) => ({ ...x, [key]: value })); };
  const text = (key, label, hint, placeholder) => (
    <Field id={`sp-${key}`} label={label} hint={hint}><Input id={`sp-${key}`} value={p[key]} placeholder={placeholder} onChange={(e) => set(key, e.target.value.trim())} autoComplete="off" /></Field>
  );
  const run = async (drawer) => {
    setBusy(true); setResult(null);
    try { await testPrint(p, { drawer }); setResult({ ok: true, message: drawer ? 'Sent. The page should print and the drawer open.' : 'Sent. A test page should be printing.' }); }
    catch (caught) { setResult({ ok: false, message: caught.message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="text-sm font-semibold text-ink-900">Silent printing and cash drawer (this computer)</p>
      <p className="mb-3 text-xs text-ink-500">Prints straight to the receipt printer with no print dialog, and opens the cash drawer. Needs the small FlowXP print agent running on this computer (see print-agent/README.md). Without it, receipts print from the browser as before.</p>
      <Field id="sp-mode" label="Printing">
        <Select id="sp-mode" value={p.printMode} onChange={(e) => set('printMode', e.target.value)}>
          <option value="browser">From the browser (print dialog)</option>
          <option value="agent">Silent, through the print agent</option>
        </Select>
      </Field>
      {p.printMode === 'agent' && (
        <div className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            {text('agentUrl', 'Print agent address', 'Where the agent listens on this computer.', 'http://127.0.0.1:9101')}
            {text('agentToken', 'Agent token', 'The secret the agent was started with.', '')}
            {text('receiptTarget', 'Receipt printer', 'tcp://192.168.1.50:9100, share://PC-NAME/PrinterName, lp://PrinterName', 'tcp://192.168.1.50:9100')}
            {text('kotTarget', 'Kitchen printer (optional)', 'Leave empty to use the receipt printer.', '')}
          </div>
          <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={p.openDrawer} onChange={(e) => set('openDrawer', e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" /> Open the cash drawer when a cash payment is taken</label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy || !p.agentToken || !p.receiptTarget} onClick={() => run(false)}>Print a test page</Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy || !p.agentToken || !p.receiptTarget} onClick={() => run(true)}>Test the cash drawer</Button>
          </div>
          {result && <p className={`text-sm ${result.ok ? 'text-success' : 'text-danger'}`} role="status">{result.message}</p>}
        </div>
      )}
    </div>
  );
};

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
        <LogoSetting logoUrl={s.logo_url} onChange={(url) => setS((x) => ({ ...x, logo_url: url }))} />
        <div className="space-y-2">{flag('show_logo', 'Print the logo at the top of receipts')}{flag('show_gstin', 'Show the GSTIN on receipts')}{flag('show_upi_qr', 'Show a UPI QR for any unpaid balance')}{flag('show_loyalty', 'Show the customer’s loyalty card line')}</div>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save receipt settings'}</Button>
      </form>
      <SilentPrinting />
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
