/*
 * Settings → Business → Invoice print: how the A4 / A5 invoice looks (layout, paper, text size, colour, copies, which columns and blocks show,
 * the declaration / signature / footer wording), with a live preview of a sample tax invoice that changes as you choose. Saved inside the
 * business's receipt settings as `invoice_print` (modules/invoicePrint.js validates it); the invoice page and its print preview read it back.
 */
import { useState } from 'react';
import { useDirty, useUnsavedWarning } from '../lib/unsaved.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Field, Input, Select, Textarea, Button, Alert, useToast } from '../components/ui.jsx';
import TallyInvoice from './billing/TallyInvoice.jsx';
import { ACCENTS, COPY_LABELS, SHOW_OPTIONS, withDefaults } from '../lib/invoicePrint.js';
import { useT, T } from '../i18n/useT.js';

const SHOW_LABELS = {
  logo: T('Logo'), email: T('Company e-mail'), pan: T('Company PAN'), hsn: T('HSN/SAC column'), unit: T('Unit of measure'), rate_incl_tax: T('Rate including tax column'),
  disc_pct: T('Discount % column'), total_qty: T('Total quantity'), amount_in_words: T('Total in words'), tax_summary: T('Tax summary by HSN'), bank: T('Bank details'),
  terms: T('Terms and conditions'), signature: T('Signature block'), received_by: T('Received by / Delivered by lines'), eoe: T('E. & O.E.')
};
const COPY_TEXT = { 'Original for Recipient': T('Original for Recipient'), 'Duplicate for Transporter': T('Duplicate for Transporter'), 'Triplicate for Supplier': T('Triplicate for Supplier') };
const COLOUR_TEXT = { Black: T('Black'), Blue: T('Blue'), Green: T('Green'), Red: T('Red'), Purple: T('Purple'), Orange: T('Orange') };

/* what the preview shows: two lines, one with a discount, so every column has something in it */
const sample = (date, details) => ({
  invoice_id: 0, invoice_number: 'INV-0001', invoice_date: date, status: 'ISSUED', customer_name: 'Sample Customer', customer_phone: '9000000000', customer_gstin: '',
  customer_address: '12, Market Road, Bengaluru', customer_state: 'Karnataka', customer_state_code: '29', print_extra: {}, print_details: details, payments: [{ method: 'CASH', amount: 289.1 }],
  items: [
    { item_id: 1, description: 'Sample item A', hsn: '73181500', unit: 'nos', quantity: 2, unit_price: 100, discount: 0, tax_rate: 18, tax_amount: 36, line_total: 236 },
    { item_id: 2, description: 'Sample item B', hsn: '73181600', unit: 'nos', quantity: 1, unit_price: 50, discount: 5, tax_rate: 18, tax_amount: 8.1, line_total: 53.1 }
  ],
  subtotal: 245, tax: 44.1, cgst: 22.05, sgst: 22.05, igst: 0, round_off: 0, total: 289.1, amount_paid: 289.1, balance_due: 0, order_number: null, notes: ''
});

export default function InvoicePrintSettings({ initial }) {
  const tr = useT();
  const toast = useToast();
  const { business } = useAuth();
  const [s, setS] = useState(() => withDefaults(initial?.invoice_print));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const unsaved = useDirty(s);
  useUnsavedWarning(unsaved.dirty);
  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const details = Object.fromEntries(['pan', 'bank_name', 'bank_account', 'bank_ifsc', 'bank_branch', 'terms'].map((k) => [k, initial?.[k] || '']));

  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/businesses/current', { method: 'PATCH', body: { receipt_settings: { invoice_print: s } } }); toast.success(tr('Invoice print settings saved')); unsaved.clean(); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const toggleCopy = (label) => set({ copies: s.copies.includes(label) ? s.copies.filter((c) => c !== label) : COPY_LABELS.filter((c) => c === label || s.copies.includes(c)) });

  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('Invoice print')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('Choose how your A4 and A5 invoices look. The preview below changes as you choose.')}</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-3">
          <Field id="ip_layout" label={tr('Layout')}>
            <Select id="ip_layout" value={s.layout} onChange={(e) => set({ layout: e.target.value })}>
              <option value="auto">{tr('Automatic (tax invoice for trade businesses)')}</option>
              <option value="standard">{tr('Standard bill')}</option>
              <option value="tally">{tr('Tax invoice (Tally style)')}</option>
            </Select>
          </Field>
          <Field id="ip_paper" label={tr('Paper')}><Select id="ip_paper" value={s.paper} onChange={(e) => set({ paper: e.target.value })}><option value="A4">A4</option><option value="A5">A5</option></Select></Field>
          <Field id="ip_size" label={tr('Text size')}>
            <Select id="ip_size" value={s.text_size} onChange={(e) => set({ text_size: e.target.value })}>
              <option value="small">{tr('Small')}</option><option value="medium">{tr('Medium')}</option><option value="large">{tr('Large')}</option>
            </Select>
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-900">{tr('Colour')}</p>
          <div className="flex flex-wrap gap-2">
            {ACCENTS.map(([hex, name]) => (
              <button key={hex} type="button" onClick={() => set({ accent: hex })} aria-pressed={s.accent === hex} aria-label={tr(COLOUR_TEXT[name])}
                      className={`h-8 w-8 rounded-full border-2 ${s.accent === hex ? 'border-ink-900 ring-2 ring-brand-300' : 'border-line'}`} style={{ backgroundColor: hex }} />
            ))}
          </div>
        </div>

        <div>
          <p className="text-sm font-medium text-ink-900">{tr('Copies to print')}</p>
          <p className="mb-1.5 text-xs text-ink-500">{tr('Each ticked copy prints as its own page, labelled. None ticked prints one plain copy.')}</p>
          <div className="space-y-2">
            {COPY_LABELS.map((label) => (
              <label key={label} className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={s.copies.includes(label)} onChange={() => toggleCopy(label)} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {tr(COPY_TEXT[label])}</label>
            ))}
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-sm font-medium text-ink-900">{tr('Show on the invoice')}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {SHOW_OPTIONS.map(([key]) => (
              <label key={key} className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={Boolean(s.show[key])} onChange={(e) => set({ show: { ...s.show, [key]: e.target.checked } })} className="h-4 w-4 accent-[var(--color-brand-500)]" /> {tr(SHOW_LABELS[key])}</label>
            ))}
          </div>
        </div>

        <Field id="ip_decl" label={tr('Declaration')}><Textarea id="ip_decl" rows={2} maxLength={400} value={s.declaration} onChange={(e) => set({ declaration: e.target.value })} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="ip_sig" label={tr('Signature line')}><Input id="ip_sig" maxLength={60} value={s.signature_text} onChange={(e) => set({ signature_text: e.target.value })} /></Field>
          <Field id="ip_foot" label={tr('Footer line')}><Input id="ip_foot" maxLength={120} value={s.footer_note} onChange={(e) => set({ footer_note: e.target.value })} /></Field>
        </div>
        <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save invoice print settings')}</Button>
      </form>

      <div className="mt-6 border-t border-line pt-4">
        <p className="mb-2 text-sm font-semibold text-ink-900">{tr('Preview')}</p>
        <div className="rounded-lg border border-line bg-surface-3 p-3">
          <TallyInvoice invoice={sample(new Date().toISOString().slice(0, 10), details)} business={{ ...business, receipt_settings: initial }} outlet={null}
                        seller={{ gstin: business?.gstin, address: business?.address, city: business?.city, phone: business?.phone, state: business?.state }} plain print={s} />
        </div>
      </div>
    </Card>
  );
}
