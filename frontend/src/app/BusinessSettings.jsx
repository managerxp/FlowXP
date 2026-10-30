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
import { PageHeader, Card, Field, Input, Select, Textarea, Button, Alert, useToast, PageLoader } from '../components/ui.jsx';
import { getDevicePrefs, setDevicePref, testPrint } from '../lib/printing.js';
import { COUNTRIES, regionsFor, subdivisionLabel } from '../lib/states.js';
import PincodeHint from '../components/PincodeHint.jsx';
import InvoicePrintSettings from './InvoicePrintSettings.jsx';
import DisplaySettings from './DisplaySettings.jsx';
import GstOptionsSettings from './GstOptionsSettings.jsx';
import DocumentNumbersSettings from './DocumentNumbersSettings.jsx';
import { useDirty, useUnsavedWarning } from '../lib/unsaved.js';
import PrintersSettings from './PrintersSettings.jsx';
import BackupSettings from './BackupSettings.jsx';
import MechanicModeSettings from './MechanicModeSettings.jsx';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, writeStored } from '../i18n/config.js';
import { useLanguage } from '../i18n/LanguageSync.jsx';
import { useT, T } from '../i18n/useT.js';

const FIELDS = [
  ['name', T('Business name')],
  ['email', T('Email')],
  ['phone', T('Phone')],
  ['gstin', T('GSTIN'), 'Optional — only needed if you charge GST'],
  ['upi_vpa', T('UPI ID for QR payments'), 'e.g. shopname@okhdfcbank — shown to customers ordering by QR'],
  ['google_review_link', T('Google review link'), 'Paste the https:// link from "Share" on your Google Business listing — shown to a customer who rates their visit 4-5 stars']
];

/* Address fields, broken out of the generic FIELDS loop above so state and country can be proper
   dropdowns (regionsFor()) instead of free text, with the same PIN-code assist as onboarding. */
const AddressFields = ({ form, set, setForm }) => {
  const tr = useT();
  const regions = regionsFor(form.country || 'India');
  const setCountry = (e) => setForm((f) => ({ ...f, country: e.target.value, state: '' }));
  return (
    <>
      <Field id="address" label={tr('Address')}><Input id="address" value={form.address || ''} onChange={set('address')} /></Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="city" label={tr('City')}><Input id="city" value={form.city || ''} onChange={set('city')} /></Field>
        <Field id="country" label={tr('Country')}>
          <Select id="country" value={form.country || 'India'} onChange={setCountry}>
            {COUNTRIES.map((c) => <option key={c} value={c}>{c}</option>)}
          </Select>
        </Field>
        <Field id="state" label={subdivisionLabel(form.country || 'India')}>
          {regions.length > 0 ? (
            <Select id="state" value={form.state || ''} onChange={set('state')}>
              <option value="">{tr('Choose {{subdivisionLabel}}', { subdivisionLabel: subdivisionLabel(form.country || 'India').toLowerCase() })}</option>
              {regions.map((r) => <option key={r.shortCode} value={r.name}>{r.name}</option>)}
            </Select>
          ) : (
            <Input id="state" value={form.state || ''} onChange={set('state')} />
          )}
        </Field>
        <Field id="postal_code" label={(form.country || 'India') === 'India' ? tr('PIN code') : tr('Postal code')}>
          <Input id="postal_code" value={form.postal_code || ''} onChange={set('postal_code')} inputMode="numeric" />
          <PincodeHint postalCode={form.postal_code} country={form.country || 'India'}
                       onApply={(r) => setForm((f) => ({ ...f, city: r.city, state: r.state }))} />
        </Field>
      </div>
    </>
  );
};

/* The picture printed at the top of browser receipts. */
const LogoSetting = ({ logoUrl, onChange }) => {
  const tr = useT();
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
      onChange(r.logo_url); toast.success(tr('Logo saved'));
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
      <p className="mb-1 text-sm font-medium text-ink-700">{tr('Logo')}</p>
      <Alert>{error}</Alert>
      <div className="flex items-center gap-4">
        {logoUrl ? <img src={logoUrl} alt={tr('Your logo')} className="h-14 max-w-[8rem] rounded border border-line bg-white object-contain p-1" /> : <span className="text-xs text-ink-400">{tr('No logo yet')}</span>}
        <label className="cursor-pointer text-sm font-semibold text-brand-600">
          {busy ? tr('Working…') : logoUrl ? tr('Replace') : tr('Upload')}
          <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" onChange={upload} disabled={busy} />
        </label>
        {logoUrl && <button type="button" className="text-sm font-semibold text-danger" onClick={remove} disabled={busy}>{tr('Remove')}</button>}
      </div>
      <p className="mt-1 text-xs text-ink-500">PNG, JPEG or WebP up to 2 MB. A simple black-and-white logo prints best; it appears on receipts printed from the browser (silent thermal printing shows the business name in large text).</p>
    </div>
  );
};

/* Silent printing: this computer's print agent, printers and cash drawer. Remembered in this browser only. */
const SilentPrinting = () => {
  const tr = useT();
  const [p, setP] = useState(getDevicePrefs);
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const set = (key, value) => { setDevicePref(key, value); setP((x) => ({ ...x, [key]: value })); };
  const text = (key, label, hint, placeholder) => (
    <Field id={`sp-${key}`} label={tr(label)} hint={tr(hint)}><Input id={`sp-${key}`} value={p[key]} placeholder={tr(placeholder)} onChange={(e) => set(key, e.target.value.trim())} autoComplete="off" /></Field>
  );
  const run = async (drawer) => {
    setBusy(true); setResult(null);
    try { await testPrint(p, { drawer }); setResult({ ok: true, message: drawer ? 'Sent. The page should print and the drawer open.' : 'Sent. A test page should be printing.' }); }
    catch (caught) { setResult({ ok: false, message: caught.message }); }
    finally { setBusy(false); }
  };
  return (
    <div className="mt-6 border-t border-line pt-4">
      <p className="text-sm font-semibold text-ink-900">{tr('Silent printing and cash drawer (this computer)')}</p>
      <p className="mb-3 text-xs text-ink-500">{tr('Prints straight to the receipt printer with no print dialog, and opens the cash drawer. Needs the small FlowXP print agent running on this computer (see print-agent/README.md). Without it, receipts print from the browser as before.')}</p>
      <Field id="sp-mode" label={tr('Printing')}>
        <Select id="sp-mode" value={p.printMode} onChange={(e) => set('printMode', e.target.value)}>
          <option value="browser">{tr('From the browser (print dialog)')}</option>
          <option value="agent">{tr('Silent, through the print agent')}</option>
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
          <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={p.openDrawer} onChange={(e) => set('openDrawer', e.target.checked)} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {tr('Open the cash drawer when a cash payment is taken')}</label>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={busy || !p.agentToken} onClick={() => run(false)}>{tr('Print a test page')}</Button>
            <Button type="button" variant="secondary" size="sm" disabled={busy || !p.agentToken} onClick={() => run(true)}>{tr('Test the cash drawer')}</Button>
          </div>
          {result && <p className={`text-sm ${result.ok ? 'text-success' : 'text-danger'}`} role="status">{result.message}</p>}
        </div>
      )}
    </div>
  );
};

/* What every receipt and kitchen slip looks like (business-wide), and what THIS device does automatically. */
const ReceiptSettings = ({ initial }) => {
  const tr = useT();
  const toast = useToast();
  const [s, setS] = useState(initial);
  const [device, setDevice] = useState(getDevicePrefs);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try { await api('/businesses/current', { method: 'PATCH', body: { receipt_settings: s } }); toast.success(tr('Receipt settings saved')); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const flag = (key, label) => (
    <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={s[key]} onChange={(e) => setS((x) => ({ ...x, [key]: e.target.checked }))} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {tr(label)}</label>
  );
  const deviceFlag = (key, label) => (
    <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={device[key]} onChange={(e) => { setDevicePref(key, e.target.checked); setDevice((d) => ({ ...d, [key]: e.target.checked })); }} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {tr(label)}</label>
  );

  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Receipts and kitchen slips')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('Prints from the browser to any printer, including 58 mm and 80 mm receipt printers. Pick the printer in the print dialog.')}</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Alert>{error}</Alert>
        <Field id="paper" label={tr('Paper width')}><Select id="paper" value={s.paper_width} onChange={(e) => setS((x) => ({ ...x, paper_width: Number(e.target.value) }))}><option value={80}>{tr('80 mm (standard)')}</option><option value={58}>{tr('58 mm (narrow)')}</option></Select></Field>
        <Field id="footer" label={tr('Footer message')} hint={tr('Printed at the bottom of every receipt.')}><Input id="footer" value={s.footer} onChange={(e) => setS((x) => ({ ...x, footer: e.target.value }))} maxLength={200} /></Field>
        <LogoSetting logoUrl={s.logo_url} onChange={(url) => setS((x) => ({ ...x, logo_url: url }))} />
        <div className="space-y-2">{flag('show_logo', 'Print the logo at the top of receipts')}{flag('show_gstin', 'Show the GSTIN on receipts')}{flag('show_upi_qr', 'Show a UPI QR for any unpaid balance')}{flag('show_loyalty', 'Show the customer’s loyalty card line')}{flag('auto_cut', T('Cut the paper after each receipt'))}</div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="copies" label={tr('Copies of each receipt')}><Select id="copies" value={s.copies ?? 1} onChange={(e) => setS((x) => ({ ...x, copies: Number(e.target.value) }))}>{[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
          <Field id="extra_lines" label={tr('Blank lines after the receipt')}><Select id="extra_lines" value={s.extra_lines ?? 3} onChange={(e) => setS((x) => ({ ...x, extra_lines: Number(e.target.value) }))}>{[0, 1, 2, 3, 4, 5, 6, 8, 10].map((n) => <option key={n} value={n}>{n}</option>)}</Select></Field>
        </div>
        <div className="space-y-4 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink-900">{tr('Printed on tax invoices')}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pan" label={tr('PAN')}><Input id="pan" maxLength={10} value={s.pan ?? ''} onChange={(e) => setS((x) => ({ ...x, pan: e.target.value.toUpperCase() }))} /></Field>
            <Field id="bank_name" label={tr('Bank name')}><Input id="bank_name" maxLength={80} value={s.bank_name ?? ''} onChange={(e) => setS((x) => ({ ...x, bank_name: e.target.value }))} /></Field>
            <Field id="bank_account" label={tr('Account number')}><Input id="bank_account" maxLength={24} value={s.bank_account ?? ''} onChange={(e) => setS((x) => ({ ...x, bank_account: e.target.value }))} /></Field>
            <Field id="bank_ifsc" label={tr('IFSC')}><Input id="bank_ifsc" maxLength={11} value={s.bank_ifsc ?? ''} onChange={(e) => setS((x) => ({ ...x, bank_ifsc: e.target.value.toUpperCase() }))} /></Field>
            <Field id="bank_branch" label={tr('Bank branch')}><Input id="bank_branch" maxLength={80} value={s.bank_branch ?? ''} onChange={(e) => setS((x) => ({ ...x, bank_branch: e.target.value }))} /></Field>
          </div>
          <Field id="terms" label={tr('Terms and conditions')}><Textarea id="terms" rows={4} maxLength={1000} value={s.terms ?? ''} onChange={(e) => setS((x) => ({ ...x, terms: e.target.value }))} /></Field>
        </div>
        <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save receipt settings')}</Button>
      </form>
      <SilentPrinting />
      <div className="mt-6 border-t border-line pt-4">
        <p className="text-sm font-semibold text-ink-900">{tr('This device')}</p>
        <p className="mb-2 text-xs text-ink-500">{tr('Remembered in this browser only, so the counter and the kitchen can behave differently.')}</p>
        <div className="space-y-2">{deviceFlag('autoPrintReceipt', 'Print the receipt automatically after billing')}{deviceFlag('autoPrintKot', 'Print the KOT automatically when an order is sent to the kitchen')}{deviceFlag('kitchenSound', 'Play a sound for new and late kitchen tickets')}</div>
      </div>
    </Card>
  );
};

/* Cash round-off: each bill rounded to the nearest rupee, with the difference shown on the bill. */
const RoundOffSetting = ({ initial }) => {
  const tr = useT();
  const toast = useToast();
  const [on, setOn] = useState(Boolean(initial));
  const change = async (checked) => {
    setOn(checked);
    try { await api('/businesses/current', { method: 'PATCH', body: { round_off_enabled: checked } }); toast.success(checked ? tr('Bills will be rounded to the rupee') : tr('Round-off switched off')); }
    catch (caught) { setOn(!checked); toast.error?.(caught.message); }
  };
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Billing')}</h2>
      <label className="mt-3 flex items-start gap-2 text-sm text-ink-700">
        <input type="checkbox" checked={on} onChange={(e) => change(e.target.checked)} className="mt-0.5 h-4 w-4 accent-[var(--color-brand-500)]" />
        <span>{tr('Round each bill to the nearest rupee')}<span className="block text-xs text-ink-500">{tr('The difference (for example +₹0.40) is shown as “Round off” on the bill, is never taxed, and is kept on the invoice. Applies to new bills.')}</span></span>
      </label>
    </Card>
  );
};

/* Display language only: a person's own choice (all their devices) and the default their staff start with. Never touches money, tax, dates on bills or any other setting. */
const LanguageSetting = ({ businessDefault }) => {
  const { t } = useTranslation('settings');
  const { user, refresh } = useAuth();
  const toast = useToast();
  const { lang, choose } = useLanguage();
  const [staff, setStaff] = useState(businessDefault || '');
  const own = user?.language || '';
  const machine = LANGUAGES.find((l) => l.code === lang)?.status === 'machine';

  const setOwn = async (value) => {
    try {
      if (value) await choose(value);
      else { await api('/auth/language', { method: 'PATCH', body: { language: null } }); writeStored(null); await refresh(); }
      if (value) await refresh();
      toast.success(t('language.saved'));
    } catch (caught) { toast.error?.(caught.message); }
  };
  const setStaffDefault = async (value) => {
    setStaff(value);
    try { await api('/businesses/current', { method: 'PATCH', body: { default_language: value || null } }); await refresh(); toast.success(t('language.saved')); }
    catch (caught) { setStaff(businessDefault || ''); toast.error?.(caught.message); }
  };
  const options = LANGUAGES.map((l) => <option key={l.code} value={l.code} lang={l.code}>{l.name}{l.code !== 'en' ? ` · ${l.english}` : ''}</option>);
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{t('language.title')}</h2>
      <div className="mt-3 space-y-4">
        <Field id="my-language" label={t('language.mine')} hint={t('language.mineHint')}>
          <Select id="my-language" value={own} onChange={(e) => setOwn(e.target.value)}>
            <option value="">{t('language.useDefault')}</option>
            {options}
          </Select>
        </Field>
        <Field id="staff-language" label={t('language.business')} hint={t('language.businessHint')}>
          <Select id="staff-language" value={staff} onChange={(e) => setStaffDefault(e.target.value)}>
            <option value="">{t('language.noDefault')}</option>
            {options}
          </Select>
        </Field>
        {machine && <p className="text-xs text-ink-500">{t('language.machineNote')}</p>}
      </div>
    </Card>
  );
};

const BusinessSettings = () => {
  const tr = useT();
  const { refresh } = useAuth();
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const unsaved = useDirty(form, form !== null);
  useUnsavedWarning(unsaved.dirty);

  useEffect(() => { api('/businesses/current').then(setForm).catch((e) => setError(e.message)); }, []);

  const set = (field) => (e) => setForm((f) => ({ ...f, [field]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      await api('/businesses/current', {
        method: 'PATCH',
        body: Object.fromEntries([...FIELDS.map(([key]) => [key, form[key] || '']), ...['address', 'city', 'state', 'postal_code', 'country'].map((key) => [key, form[key] || ''])])
      });
      toast.success(tr('Saved'));
      unsaved.clean();
      refresh(); // business name may have changed — the nav/topbar read it from AuthContext
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  if (!form) return <PageLoader compact />;

  return (
    <div className="mx-auto max-w-2xl">
      <PageHeader title={tr('Business details')} lead={tr('Your business\'s own identity, contact and payment info.')} />
      <Card>
        <form onSubmit={save} className="space-y-4">
          <Alert>{error}</Alert>
          {FIELDS.slice(0, 3).map(([key, label, hint]) => (
            <Field key={key} id={key} label={tr(label)} hint={tr(hint)}>
              <Input id={key} value={form[key] || ''} onChange={set(key)} />
            </Field>
          ))}
          <AddressFields form={form} set={set} setForm={setForm} />
          {FIELDS.slice(3).map(([key, label, hint]) => (
            <Field key={key} id={key} label={tr(label)} hint={tr(hint)}>
              <Input id={key} value={form[key] || ''} onChange={set(key)} />
            </Field>
          ))}
          <div className="flex items-center gap-3 pt-2">
            <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save changes')}</Button>
          </div>
        </form>
      </Card>
      <MechanicModeSettings />
      <RoundOffSetting initial={form.round_off_enabled} />
      <LanguageSetting businessDefault={form.default_language} />
      <PrintersSettings />
      <ReceiptSettings initial={form.receipt_settings} />
      <GstOptionsSettings />
      <DocumentNumbersSettings />
      <InvoicePrintSettings initial={form.receipt_settings} />
      <DisplaySettings />
      <BackupSettings />
    </div>
  );
};

export default BusinessSettings;
