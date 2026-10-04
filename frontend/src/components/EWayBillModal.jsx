/*
 * The e-way bill file for one invoice (goods being moved, normally worth more than Rs 50,000): enter how it travels,
 * download the JSON for the e-way bill portal, then record the number the portal gives back.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Alert, Button, Field, Input, Modal, Select, useToast } from './ui.jsx';

const EWayBillModal = ({ invoice, onClose, onDone }) => {
  const toast = useToast();
  const [t, setT] = useState({ mode: 'road', distance_km: '', vehicle_no: '', transporter_id: '', transporter_name: '' });
  const [result, setResult] = useState(null);
  const [number, setNumber] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => setT((x) => ({ ...x, [k]: e.target.value }));

  const prepare = async () => {
    setBusy(true); setError('');
    try { setResult(await api('/gst/eway-bill', { method: 'POST', body: { invoice_id: invoice.invoice_id, transport: { ...t, distance_km: t.distance_km === '' ? undefined : Number(t.distance_km) } } })); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  const download = () => {
    const blob = new Blob([JSON.stringify(result.json, null, 2)], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `eway_${invoice.invoice_number}.json`; a.click(); URL.revokeObjectURL(a.href);
  };
  const record = async () => {
    setBusy(true); setError('');
    try { await api(`/gst/invoices/${invoice.invoice_id}/eway-bill`, { method: 'POST', body: { eway_bill_no: number, date: new Date().toISOString().slice(0, 10) } }); toast.success('E-way bill number saved'); onDone(); }
    catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Modal title={`E-way bill — ${invoice.invoice_number}`} onClose={onClose} wide>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-xs text-ink-500">Needed for goods (not services) moved for more than ₹50,000. The customer's state, pincode and GSTIN, your address and pincode, and an HSN on every product must be filled in.</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="ew-mode" label="Transport"><Select id="ew-mode" value={t.mode} onChange={set('mode')}><option value="road">Road</option><option value="rail">Rail</option><option value="air">Air</option><option value="ship">Ship</option></Select></Field>
          <Field id="ew-dist" label="Distance (km)"><Input id="ew-dist" type="number" min="0" max="4000" value={t.distance_km} onChange={set('distance_km')} /></Field>
          <Field id="ew-veh" label="Vehicle number" hint="Or the transporter's ID below"><Input id="ew-veh" value={t.vehicle_no} onChange={set('vehicle_no')} placeholder="KA01AB1234" className="uppercase" /></Field>
          <Field id="ew-tid" label="Transporter GSTIN (optional)"><Input id="ew-tid" value={t.transporter_id} onChange={set('transporter_id')} maxLength={15} className="uppercase" /></Field>
        </div>
        <Button onClick={prepare} disabled={busy}>{busy ? 'Preparing…' : 'Prepare the file'}</Button>

        {result && (
          <div className="space-y-3 border-t border-line pt-4">
            {result.errors.length > 0 && <div className="rounded-lg bg-danger/10 p-3 text-sm text-danger"><p className="font-semibold">Fix these first:</p><ul className="mt-1 list-disc pl-5">{result.errors.map((e, i) => <li key={i}>{e}</li>)}</ul></div>}
            {result.warnings.map((w, i) => <p key={i} className="rounded-lg bg-amber-500/10 p-3 text-sm text-ink-900">{w.message}</p>)}
            {result.ready && (
              <>
                <Button variant="secondary" onClick={download}>Download e-way bill file (JSON)</Button>
                <p className="text-xs text-ink-500">Upload it on the e-way bill portal (Generate in bulk). The portal gives you a 12-digit number: save it here.</p>
                <div className="flex items-end gap-2"><Field id="ew-no" label="E-way bill number"><Input id="ew-no" value={number} onChange={(e) => setNumber(e.target.value)} inputMode="numeric" maxLength={14} /></Field><Button onClick={record} disabled={busy || number.replace(/\s/g, '').length !== 12}>Save number</Button></div>
              </>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
};

export default EWayBillModal;
