/*
 * GST filing: prepare the GSTR-1 file, see the GSTR-3B figures, and get the e-invoice file for B2B invoices.
 * FlowXP never files for you: it prepares the numbers and files, says what is missing, and you (or your accountant)
 * upload them on the GST portal. E-way bills are made from an invoice (see the invoice screen).
 */
import { useEffect, useState } from 'react';
import { api, downloadFile, formatCurrency } from '../lib/api.js';
import { Alert, Badge, Button, Card, Field, Input, ListState, PageHeader, Select, Table, Td, Th, Thead, Tr, useToast, StatCard } from '../components/ui.jsx';

const monthNow = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };   // last month: what is usually being filed

const Stat = StatCard;

const Warnings = ({ warnings }) => warnings?.length ? (
  <div className="space-y-2">
    {warnings.map((w, i) => <p key={i} className="rounded-lg bg-amber-500/10 p-3 text-sm text-ink-900"><strong className="mr-1 text-warning">Check:</strong>{w.message}</p>)}
  </div>
) : <p className="rounded-lg bg-success/10 p-3 text-sm text-success">Nothing to fix. The file is ready to upload.</p>;

const Gstr1 = ({ period, gstin }) => {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setD(null); setError(''); api(`/gst/gstr1?period=${period}&gstin=${gstin}`).then(setD).catch((e) => setError(e.message)); }, [period, gstin]);
  if (!d) return <ListState loading={!error} error={error} />;
  const s = d.summary;
  return (
    <div className="space-y-5">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="B2B invoices" value={s.b2b.invoices} sub={`${s.b2b.customers} customers · ${formatCurrency(s.b2b.taxable_value)} taxable`} />
        <Stat label="B2C large (inter-state)" value={s.b2cl.invoices} sub={`${formatCurrency(s.b2cl.taxable_value)} taxable`} />
        <Stat label="B2C small (summary rows)" value={s.b2cs.rows} sub={`${formatCurrency(s.b2cs.taxable_value)} taxable, net of returns`} />
        <Stat label="Credit notes" value={s.credit_notes} sub={`${s.credit_notes_registered.notes} to registered · ${s.credit_notes_unregistered.notes} to others`} />
      </div>
      <Warnings warnings={d.warnings} />
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={() => downloadFile(`/gst/gstr1?period=${period}&gstin=${gstin}&download=1`, `GSTR1_${gstin}_${period.slice(5)}${period.slice(0, 4)}.json`).catch((e) => setError(e.message))}>Download GSTR-1 file (JSON)</Button>
        <span className="text-xs text-ink-500">Upload it on the GST portal (Returns, GSTR-1, Prepare offline) or give it to your accountant. {s.hsn_rows} HSN rows included.</span>
      </div>
      <Alert>{error}</Alert>
    </div>
  );
};

const Row = ({ label, cgst, sgst, igst, taxable, strong }) => (
  <Tr><Td className={strong ? 'font-semibold' : ''}>{label}</Td>
    <Td className="text-right">{taxable != null ? formatCurrency(taxable) : ''}</Td><Td className="text-right">{formatCurrency(igst ?? 0)}</Td><Td className="text-right">{formatCurrency(cgst ?? 0)}</Td><Td className="text-right">{formatCurrency(sgst ?? 0)}</Td></Tr>
);

const Gstr3b = ({ period, gstin }) => {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setD(null); setError(''); api(`/gst/gstr3b?period=${period}&gstin=${gstin}`).then(setD).catch((e) => setError(e.message)); }, [period, gstin]);
  if (!d) return <ListState loading={!error} error={error} />;
  return (
    <div className="space-y-4">
      <Table>
        <Thead><Th></Th><Th className="text-right">Taxable value</Th><Th className="text-right">IGST</Th><Th className="text-right">CGST</Th><Th className="text-right">SGST</Th></Thead>
        <tbody>
          <Row label="3.1(a) Outward taxable supplies (net of credit notes)" {...d.outward_taxable} />
          <Row label="3.1(c) Nil-rated, exempt" taxable={d.outward_nil_or_exempt.taxable} />
          {d.inter_state_to_unregistered.map((x) => <Row key={x.pos} label={`3.2 Inter-state to unregistered, state ${x.pos}`} taxable={x.taxable} igst={x.igst} />)}
          <Row label="4(A) Input tax credit you can claim" igst={d.itc.igst} cgst={d.itc.cgst} sgst={d.itc.sgst} />
          <Row strong label="Tax to pay in cash (after credit)" igst={d.tax_payable_in_cash.igst} cgst={d.tax_payable_in_cash.cgst} sgst={d.tax_payable_in_cash.sgst} />
        </tbody>
      </Table>
      <p className="text-sm text-ink-700">Purchases from suppliers without a GSTIN carry {formatCurrency(d.itc.ineligible)} of tax that is not claimable.</p>
      <ul className="list-disc space-y-1 pl-5 text-xs text-ink-500">{d.notes.map((n, i) => <li key={i}>{n}</li>)}</ul>
    </div>
  );
};

const EInvoice = ({ period, gstin }) => {
  const toast = useToast();
  const [d, setD] = useState(null);
  const [error, setError] = useState('');
  const [irn, setIrn] = useState({});
  const load = () => api(`/gst/einvoice?period=${period}&gstin=${gstin}`).then(setD).catch((e) => setError(e.message));
  useEffect(() => { setD(null); setError(''); load(); }, [period, gstin]);   // eslint-disable-line react-hooks/exhaustive-deps
  if (!d) return <ListState loading={!error} error={error} />;

  const record = async (id) => {
    setError('');
    try { await api(`/gst/invoices/${id}/irn`, { method: 'POST', body: { irn: irn[id] } }); toast.success('IRN saved'); setIrn((x) => ({ ...x, [id]: '' })); load(); }
    catch (caught) { setError(caught.message); }
  };
  const ready = d.invoices.filter((i) => i.ready && !i.irn);
  return (
    <div className="space-y-4">
      <p className="text-sm text-ink-700">E-invoicing applies to businesses above a turnover limit and only for sales to customers with a GSTIN. If it does not apply to you, ignore this tab. {d.applies ? '' : 'It is switched off for your business.'}</p>
      <Alert>{error}</Alert>
      <ListState empty={d.invoices.length === 0} emptyLabel="No sales to GST-registered customers in this month." />
      {d.invoices.length > 0 && (
        <Table>
          <Thead><Th>Invoice</Th><Th>Status</Th><Th>IRN</Th></Thead>
          <tbody>
            {d.invoices.map((i) => (
              <Tr key={i.invoice_id}>
                <Td className="font-medium">{i.invoice_number}</Td>
                <Td>{i.irn ? <Badge tone="success">Has IRN</Badge> : i.ready ? <Badge tone="brand">Ready</Badge> : <span className="text-xs text-danger">Missing: {i.errors.join('; ')}</span>}</Td>
                <Td>{i.irn ? <span className="font-mono text-xs text-ink-500">{i.irn.slice(0, 16)}…</span> : (
                  <span className="flex gap-2"><Input className="!w-64 !py-1 font-mono text-xs" placeholder="Paste the IRN from the portal" value={irn[i.invoice_id] || ''} onChange={(e) => setIrn((x) => ({ ...x, [i.invoice_id]: e.target.value }))} aria-label={`IRN for ${i.invoice_number}`} />
                    <Button size="sm" variant="secondary" disabled={!(irn[i.invoice_id] || '').trim()} onClick={() => record(i.invoice_id)}>Save</Button></span>
                )}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      )}
      {ready.length > 0 && <Button onClick={() => downloadFile(`/gst/einvoice?period=${period}&gstin=${gstin}&download=1`, `einvoice_${gstin}_${period}.json`).catch((e) => setError(e.message))}>Download e-invoice file ({ready.length} ready)</Button>}
    </div>
  );
};

const Settings = () => {
  const toast = useToast();
  const [s, setS] = useState(null);
  useEffect(() => { api('/gst/settings').then(setS).catch(() => {}); }, []);
  if (!s) return null;
  const save = async (patch) => { try { setS(await api('/gst/settings', { method: 'PUT', body: patch })); toast.success('Saved'); } catch (caught) { toast.error(caught.message); } };
  return (
    <Card className="mt-8 p-4">
      <p className="text-sm font-semibold text-ink-900">Filing settings</p>
      <div className="mt-3 grid items-end gap-4 sm:grid-cols-2">
        <Field id="b2cl" label="Large inter-state invoice limit (₹)" hint="Inter-state sales to people without a GSTIN above this go in the B2CL table. Confirm the current limit with your accountant."><Input id="b2cl" type="number" defaultValue={s.b2cl_limit} onBlur={(e) => Number(e.target.value) !== s.b2cl_limit && save({ b2cl_limit: Number(e.target.value) })} /></Field>
        <label className="flex items-center gap-2 text-sm text-ink-700"><input type="checkbox" checked={s.einvoice_enabled} onChange={(e) => save({ einvoice_enabled: e.target.checked })} /> My business must issue e-invoices</label>
      </div>
      <p className="mt-3 text-xs text-ink-500">Your GSTIN is set in Business settings. Add each customer's state, pincode and GSTIN on the Customers page, and an HSN/SAC code on every product, so the files come out complete.</p>
    </Card>
  );
};

const GstPage = () => {
  const [period, setPeriod] = useState(monthNow());
  const [tab, setTab] = useState('gstr1');
  const [filings, setFilings] = useState(null);
  const [gstin, setGstin] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
    api(`/gst/filings?period=${period}`).then((f) => {
      setFilings(f);
      const own = f.gstins.map((g) => g.gstin);
      setGstin((cur) => (cur && (own.includes(cur) || cur === f.business_gstin) ? cur : f.business_gstin || own[0] || ''));
    }).catch((e) => setError(e.message));
  }, [period]);

  const options = filings ? [...new Set([filings.business_gstin, ...filings.gstins.map((g) => g.gstin)].filter(Boolean))] : [];
  const usable = filings?.gst_enabled && gstin;

  return (
    <div>
      <PageHeader title="GST filing" lead="Prepare your GSTR-1 file, the GSTR-3B figures and e-invoice files. You upload them on the GST portal." />
      <div className="mb-5 flex flex-wrap items-end gap-4">
        <Field id="gst-month" label="Month"><Input id="gst-month" type="month" value={period} onChange={(e) => e.target.value && setPeriod(e.target.value)} /></Field>
        {options.length > 1 && <Field id="gst-gstin" label="GSTIN"><Select id="gst-gstin" value={gstin} onChange={(e) => setGstin(e.target.value)}>{options.map((g) => <option key={g} value={g}>{g}</option>)}</Select></Field>}
        {options.length === 1 && <p className="pb-2 text-sm text-ink-500">GSTIN {gstin}</p>}
      </div>
      <Alert>{error}</Alert>
      {filings && !filings.gst_enabled && <p className="rounded-lg bg-surface-2 p-4 text-sm text-ink-700">GST is not switched on for this business. Turn it on in Business settings to prepare returns.</p>}
      {filings && filings.gst_enabled && !gstin && <p className="rounded-lg bg-surface-2 p-4 text-sm text-ink-700">Add your GSTIN in Business settings first.</p>}
      {usable && (
        <>
          <div className="mb-5 flex gap-2" role="tablist">
            {[['gstr1', 'GSTR-1'], ['gstr3b', 'GSTR-3B'], ['einvoice', 'E-invoice']].map(([id, label]) => (
              <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`rounded-lg px-3.5 py-1.5 text-sm font-medium ${tab === id ? 'bg-brand-50 text-brand-600' : 'text-ink-700 hover:bg-surface-2'}`}>{label}</button>
            ))}
          </div>
          {tab === 'gstr1' && <Gstr1 period={period} gstin={gstin} />}
          {tab === 'gstr3b' && <Gstr3b period={period} gstin={gstin} />}
          {tab === 'einvoice' && <EInvoice period={period} gstin={gstin} />}
          <Settings />
        </>
      )}
    </div>
  );
};

export default GstPage;
