/*
 * Settings → Business → GST options: switch composite scheme, cess, TCS, TDS and reverse charge on or off (backend modules/gstOptions.js).
 * Every option starts disabled. What each one does on a bill is described under it; TCS and TDS also take a rate. The abbreviations (TCS, TDS)
 * are the statutory ones and stay as they are in every language.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Alert, Button, Card, Field, Input, Select, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const OPTIONS = [
  { key: 'composite', label: T('Composite scheme'), rate: 'composite_rate', rateLabel: T('Composite tax rate (% of turnover)'),
    text: T('You pay a flat share of your turnover instead of charging GST. Bills become Bills of Supply with no tax on them.') },
  { key: 'cess', label: T('Cess'), text: T('Compensation cess on top of GST. Set the cess rate on each product (Products → edit); it is added to the line and the bill.') },
  { key: 'tcs', label: T('TCS (tax collected at source)'), rate: 'tcs_rate', rateLabel: T('TCS rate (%)'),
    text: T('A "Collect TCS" tick appears on the billing screen. When ticked, the TCS is added to that bill.') },
  { key: 'tds', label: T('TDS (tax deducted by the customer)'), rate: 'tds_rate', rateLabel: T('TDS rate (%)'),
    text: T('A "Customer deducts TDS" tick appears on the billing screen. When ticked, the TDS is taken off what the customer pays and noted on the bill.') },
  { key: 'reverse_charge', label: T('Reverse charge'), text: T('A "Tax payable on reverse charge" tick appears on the billing screen and prints on the invoice.') }
];

export default function GstOptionsSettings() {
  const toast = useToast();
  const tr = useT();
  const { business, refresh } = useAuth();
  const [s, setS] = useState(() => ({ ...business?.gst_options }));
  const [gst, setGst] = useState(Boolean(business?.gst_enabled));   // charging GST at all; the options below only apply when it is on
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (patch) => setS((x) => ({ ...x, ...patch }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await api('/businesses/current', { method: 'PATCH', body: { gst_enabled: gst, gst_settings: s } }); await refresh(); toast.success(tr('GST options saved')); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <Card className="mt-6">
      <h2 className="text-base font-bold text-ink-900">{tr('GST options')}</h2>
      <p className="mt-1 text-sm text-ink-500">{tr('Enable only what applies to your business. Everything is disabled until you switch it on, and your bills stay as they are until then.')}</p>
      <form onSubmit={save} className="mt-4 space-y-4">
        <Alert>{error}</Alert>
        <div className="rounded-md border border-line p-3">
          <div className="grid items-end gap-3 sm:grid-cols-[1fr_9rem]">
            <div><p className="text-small font-medium text-ink-900">{tr('Charge GST')}</p><p className="text-caption text-ink-500">{tr('Switch on only if you are registered. Your GSTIN is set above.')}</p></div>
            <Field id="gst_charge" label={tr('Status')}>
              <Select id="gst_charge" value={gst ? 'on' : 'off'} onChange={(e) => setGst(e.target.value === 'on')}>
                <option value="off">{tr('Disabled')}</option><option value="on">{tr('Enabled')}</option>
              </Select>
            </Field>
          </div>
        </div>
        {gst && OPTIONS.map((o) => (
          <div key={o.key} className="rounded-md border border-line p-3">
            <div className="grid items-end gap-3 sm:grid-cols-[1fr_9rem_12rem]">
              <div><p className="text-small font-medium text-ink-900">{tr(o.label)}</p><p className="text-caption text-ink-500">{tr(o.text)}</p></div>
              <Field id={`gst_${o.key}`} label={tr('Status')}>
                <Select id={`gst_${o.key}`} value={s[o.key] ? 'on' : 'off'} onChange={(e) => set({ [o.key]: e.target.value === 'on' })}>
                  <option value="off">{tr('Disabled')}</option><option value="on">{tr('Enabled')}</option>
                </Select>
              </Field>
              {o.rate && s[o.key] ? (
                <Field id={`gst_${o.rate}`} label={tr(o.rateLabel)}>
                  <Input id={`gst_${o.rate}`} type="number" min="0" max="30" step="0.01" value={s[o.rate] ?? ''} onChange={(e) => set({ [o.rate]: e.target.value })} />
                </Field>
              ) : <span />}
            </div>
            {o.key === 'composite' && s.composite && <p className="mt-2 text-caption text-warning">{tr('Only choose this if you are registered under the composite scheme. While it is enabled no GST is charged on any bill.')}</p>}
          </div>
        ))}
        <Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save GST options')}</Button>
      </form>
    </Card>
  );
}
