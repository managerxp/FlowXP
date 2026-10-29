/* The paper copy of an invoice, bill, credit note or receipt. It sits outside the app root, is hidden on screen and is the only thing shown when printing. */
import { useState } from 'react';
import { createPortal } from 'react-dom';
import { useLoad } from '../api.js';
import { STATES, amountInWords, inr, showDate, unitLabel } from '../lib.js';
import { useSession } from '../session.jsx';
import { Btn, Confirm, Err, Field, Note, useAction } from '../ui.jsx';

const SIZE = { A4: 'A4', A5: 'A5', THERMAL: '80mm 297mm' };
const DEFAULTS = { paper: 'A4', accent: '#1a56db', title: '', showHsn: true, showBank: true, showTerms: true, showUnit: true };

const useSheet = (partyId) => {
  const { o, org } = useSession();
  const profile = useLoad(() => o('/profile'), [org.id]);
  const party = useLoad(() => (partyId ? o(`/parties/${partyId}`).catch(() => null) : Promise.resolve(null)), [org.id, partyId]);
  const s = { ...DEFAULTS, ...(profile.data?.print_settings || {}) };
  return { p: profile.data, party: party.data, s, ready: Boolean(profile.data) };
};

const Shell = ({ s, p, heading, children }) => createPortal(
  <div className={`sheet ${s.paper === 'THERMAL' ? 'thermal' : ''}`} style={{ '--accent': s.accent }}>
    <style>{`@media print { @page { size: ${SIZE[s.paper] || 'A4'}; margin: ${s.paper === 'THERMAL' ? '4mm' : '12mm'}; } }`}</style>
    <header>
      <div><strong className="biz">{p.legal_name || p.name}</strong>
        {(p.address_line || p.city || p.pincode) && <div>{[p.address_line, p.city, p.pincode].filter(Boolean).join(', ')}</div>}
        {(p.phone || p.email) && <div>{[p.phone, p.email].filter(Boolean).join(' · ')}</div>}
        {p.gstin && <div>GSTIN: {p.gstin}</div>}</div>
      <h1>{heading}</h1>
    </header>
    {children}
  </div>, document.body);

const Parties = ({ party, label }) => (
  <div className="bill-to"><span className="muted">{label}</span><strong>{party?.name}</strong>
    {party?.address_line && <div>{[party.address_line, party.city, party.pincode].filter(Boolean).join(', ')}</div>}
    {party?.gstin && <div>GSTIN: {party.gstin}</div>}
    {party?.state_code && <div>State: {party.state_code} {STATES[party.state_code] || ''}</div>}
  </div>
);

/** kind: { one, who } from the document screens; d: the document as the API returns it. */
export const DocSheet = ({ kind, d }) => {
  const { p, party, s, ready } = useSheet(d.party_id);
  if (!ready) return null;
  const heading = s.title || (kind.api === 'invoices' ? (p.gstin ? 'Tax Invoice' : 'Invoice') : kind.one);
  const t = s.paper === 'THERMAL';
  return (
    <Shell s={s} p={p} heading={heading}>
      <div className="meta">
        <Parties party={party || { name: d.party_name }} label={kind.who} />
        <dl><dt>No.</dt><dd>{d.number}</dd><dt>Date</dt><dd>{showDate(d.issue_date)}</dd>{d.due_date && <><dt>{kind.dueLabel || 'Due'}</dt><dd>{showDate(d.due_date)}</dd></>}
          {d.place_of_supply && <><dt>Place of supply</dt><dd>{d.place_of_supply} {STATES[d.place_of_supply] || ''}</dd></>}</dl>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th>{s.showHsn && !t && <th>HSN/SAC</th>}<th className="r">Qty</th><th className="r">Price</th>{!t && <th className="r">GST</th>}<th className="r">Amount</th></tr></thead>
        <tbody>{d.lines.map((l) => (
          <tr key={l.id}><td>{l.line_no}</td><td>{l.description}</td>{s.showHsn && !t && <td>{l.hsn_sac}</td>}<td className="r">{l.quantity}{s.showUnit && l.unit ? ` ${unitLabel(l.unit)}` : ''}</td><td className="r">{inr(l.unit_price_minor)}</td>{!t && <td className="r">{l.tax_rate_bp / 100}%</td>}<td className="r">{inr(Number(l.taxable_minor) + Number(l.tax_minor))}</td></tr>))}</tbody>
      </table>
      <div className="sum">
        <div><span>Subtotal</span><span>{inr(d.subtotal_minor)}</span></div>
        {d.inter_state ? <div><span>IGST</span><span>{inr(d.tax_minor)}</span></div> : <><div><span>CGST</span><span>{inr(Number(d.tax_minor) / 2)}</span></div><div><span>SGST</span><span>{inr(Number(d.tax_minor) / 2)}</span></div></>}
        {Number(d.tcs_minor) > 0 && <div><span>TCS</span><span>{inr(d.tcs_minor)}</span></div>}
        {Number(d.round_off_minor) !== 0 && <div><span>Round off</span><span>{inr(d.round_off_minor)}</span></div>}
        <div className="grand"><span>Total</span><span>₹{inr(d.total_minor)}</span></div>
        {d.currency && d.currency !== 'INR' && <div><span>Amount in {d.currency}</span><span>{d.currency} {inr(d.foreign_total_minor)} (at ₹{String(d.fx_rate).replace(/0+$/, '').replace(/.$/, '')})</span></div>}
      </div>
      <p className="words">{amountInWords(d.total_minor)}</p>
      {s.showBank && (p.bank_account || p.upi_id) && <p className="small"><strong>Pay to</strong> {[p.bank_name, p.bank_account && `A/c ${p.bank_account}`, p.bank_ifsc && `IFSC ${p.bank_ifsc}`, p.upi_id && `UPI ${p.upi_id}`].filter(Boolean).join(' · ')}</p>}
      {s.showTerms && p.terms && <p className="small"><strong>Terms</strong> {p.terms}</p>}
      <footer><span>Thank you.</span><span>For {p.legal_name || p.name}<br /><br />Authorised signatory</span></footer>
    </Shell>
  );
};

export const ReceiptSheet = ({ pay }) => {
  const { p, party, s, ready } = useSheet(pay.party_id);
  if (!ready) return null;
  const incoming = pay.direction === 'IN';
  return (
    <Shell s={s} p={p} heading={incoming ? 'Receipt' : 'Payment voucher'}>
      <div className="meta">
        <Parties party={party || { name: pay.party_name }} label={incoming ? 'Received from' : 'Paid to'} />
        <dl><dt>No.</dt><dd>{pay.number}</dd><dt>Date</dt><dd>{showDate(pay.pay_date)}</dd><dt>How</dt><dd>{pay.mode}</dd>{pay.reference && <><dt>Reference</dt><dd>{pay.reference}</dd></>}</dl>
      </div>
      <div className="sum">{Number(pay.tds_minor) > 0 && <div><span>TDS deducted{pay.tds_section ? ` (${pay.tds_section})` : ''}</span><span>{inr(pay.tds_minor)}</span></div>}<div className="grand"><span>{incoming ? 'Amount received' : 'Amount paid'}</span><span>₹{inr(pay.amount_minor)}</span></div></div>
      <p className="words">{amountInWords(pay.amount_minor)}</p>
      <footer><span>{incoming ? 'Received with thanks.' : ''}</span><span>For {p.legal_name || p.name}<br /><br />Authorised signatory</span></footer>
    </Shell>
  );
};

/** Transport details in, e-way bill upload file out. */
export const EwayPanel = ({ id, number, onClose }) => {
  const { o } = useSession();
  const [f, setF] = useState({ distanceKm: '', mode: '1', vehicleNo: '', transporterName: '', transporterId: '' });
  const a = useAction();
  const [warnings, setWarnings] = useState([]);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const make = (e) => {
    e.preventDefault();
    a.run(async () => {
      const q = new URLSearchParams(Object.entries(f).filter(([, v]) => v));
      const { file, warnings: w } = await o(`/invoices/${id}/eway-bill?${q}`);
      setWarnings(w);
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' }));
      Object.assign(document.createElement('a'), { href: url, download: `eway_${number}.json` }).click(); URL.revokeObjectURL(url);
    }, 'File downloaded. Upload it on the e-way bill portal under Generate in bulk.');
  };
  return (
    <Confirm><p>Makes the JSON file the e-way bill portal reads for bulk upload. It is not an e-way bill until you upload it there, and the file has not been checked on the portal.</p>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      {warnings.map((w) => <p key={w} className="notice warn">{w}</p>)}
      <form className="form" onSubmit={make}>
        <Field label="Distance (km)"><input inputMode="numeric" value={f.distanceKm} onChange={set('distanceKm')} required /></Field>
        <Field label="Mode"><select value={f.mode} onChange={set('mode')}><option value="1">Road</option><option value="2">Rail</option><option value="3">Air</option><option value="4">Ship</option></select></Field>
        <Field label="Vehicle number" hint="Like MH12AB1234"><input value={f.vehicleNo} onChange={set('vehicleNo')} maxLength={15} /></Field>
        <Field label="Transporter name"><input value={f.transporterName} onChange={set('transporterName')} maxLength={100} /></Field>
        <Field label="Transporter ID (GSTIN)"><input value={f.transporterId} onChange={set('transporterId')} maxLength={15} /></Field>
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Download file</Btn><Btn type="button" onClick={onClose}>Close</Btn></div>
      </form></Confirm>
  );
};
