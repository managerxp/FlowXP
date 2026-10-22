/*
 * Settings → Business → Printers: the printers this outlet has (WiFi / LAN, USB, Bluetooth, or the browser's print dialog) and which one prints what:
 * the receipt, takeaway / parcel bills, the cash drawer, kitchen tickets, and a printer for each kitchen station. Saved on the server (backend
 * modules/printers.js), so every till and phone at the outlet follows the same routing. The print agent on a till computer does the sending; a
 * test page goes through THIS computer's agent (set up in "Silent printing" below).
 */
import { useCallback, useEffect, useState } from 'react';
import { Pencil, Plus, Printer, Trash2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { getDevicePrefs, testPrint } from '../lib/printing.js';
import { Alert, Button, Card, Field, Input, Modal, Select, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const CONNECTIONS = { NETWORK: T('WiFi / LAN (network)'), USB: T('USB (on this computer)'), BLUETOOTH: T('Bluetooth (paired with this computer)'), BROWSER: T('Browser print dialog') };
const HINTS = {
  NETWORK: T('The printer\'s IP address from its self-test slip, such as 192.168.1.50. Port 9100 is used unless you add one.'),
  USB: T('The printer must be installed on the till computer that does the printing.'),
  BLUETOOTH: T('Pair the printer with the till computer first (Windows: Settings → Bluetooth & devices), install it as a printer, then enter its name here.'),
  BROWSER: T('Nothing to set up: bills open the normal print window, where a person chooses the printer.')
};

/* USB / Bluetooth addresses the print agent understands, built from what a person types: share://computer/Name on Windows, lp://Name on Mac and Linux */
const localAddress = (os, host, name) => (os === 'windows' ? `share://${host.trim() || 'localhost'}/${encodeURIComponent(name.trim())}` : `lp://${encodeURIComponent(name.trim())}`);
const parseLocal = (address = '') => {
  const win = /^share:\/\/([^/]+)\/(.+)$/i.exec(address); if (win) return { os: 'windows', host: win[1], name: decodeURIComponent(win[2]) };
  const lp = /^lp:\/\/(.+)$/i.exec(address); if (lp) return { os: 'unix', host: '', name: decodeURIComponent(lp[1]) };
  return { os: 'windows', host: 'localhost', name: address.startsWith('file://') ? address : '' };
};

const PrinterForm = ({ printer, onSaved, onClose }) => {
  const tr = useT();
  const edit = Boolean(printer);
  const local = parseLocal(printer?.address);
  const [f, setF] = useState({
    name: printer?.name || '', connection: printer?.connection || 'NETWORK', paper_width: String(printer?.paper_width || 80), all_outlets: false,
    network: printer?.connection === 'NETWORK' ? printer.address.replace(/^tcp:\/\//, '').replace(/:9100$/, '') : '', os: local.os, host: local.host || 'localhost', pname: local.name
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = (k) => (e) => setF((o) => ({ ...o, [k]: e.target.value }));
  const save = async (e) => {
    e.preventDefault(); setBusy(true); setError('');
    const address = f.connection === 'NETWORK' ? f.network : f.connection === 'BROWSER' ? '' : localAddress(f.os, f.host, f.pname);
    const body = { name: f.name, connection: f.connection, address, paper_width: Number(f.paper_width) };
    try {
      if (edit) await api(`/printers/${printer.printer_id}`, { method: 'PATCH', body });
      else await api('/printers', { method: 'POST', body: { ...body, all_outlets: f.all_outlets } });
      onSaved();
    } catch (caught) { setError(caught.message); setBusy(false); }
  };
  return (
    <Modal title={edit ? tr('Edit printer') : tr('Add a printer')} onClose={onClose}>
      <form onSubmit={save} className="space-y-3">
        <Alert>{error}</Alert>
        <Field id="pr_name" label={tr('Name')} hint={tr('What you will call it, such as "Counter", "Kitchen" or "Bar".')}><Input id="pr_name" value={f.name} maxLength={60} onChange={set('name')} required /></Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field id="pr_conn" label={tr('Connected by')}><Select id="pr_conn" value={f.connection} onChange={set('connection')}>{Object.entries(CONNECTIONS).map(([k, v]) => <option key={k} value={k}>{tr(v)}</option>)}</Select></Field>
          {f.connection !== 'BROWSER' && <Field id="pr_paper" label={tr('Paper')}><Select id="pr_paper" value={f.paper_width} onChange={set('paper_width')}><option value="80">{tr('80 mm (standard)')}</option><option value="58">{tr('58 mm (small)')}</option></Select></Field>}
        </div>
        {f.connection === 'NETWORK' && <Field id="pr_net" label={tr('Printer address')}><Input id="pr_net" value={f.network} placeholder="192.168.1.50" onChange={set('network')} autoComplete="off" required /></Field>}
        {(f.connection === 'USB' || f.connection === 'BLUETOOTH') && (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="pr_os" label={tr('Till computer is')}><Select id="pr_os" value={f.os} onChange={set('os')}><option value="windows">Windows</option><option value="unix">{tr('Mac or Linux')}</option></Select></Field>
            <Field id="pr_pname" label={tr('Printer name')} hint={tr('As your computer lists it (the shared name on Windows).')}><Input id="pr_pname" value={f.pname} onChange={set('pname')} autoComplete="off" required /></Field>
            {f.os === 'windows' && <Field id="pr_host" label={tr('Computer name')} hint={tr('Leave as "localhost" for the computer the agent runs on.')}><Input id="pr_host" value={f.host} onChange={set('host')} autoComplete="off" /></Field>}
          </div>
        )}
        <p className="text-caption text-ink-500">{tr(HINTS[f.connection])}</p>
        {!edit && <label className="flex items-center gap-2 text-small text-ink-700"><input type="checkbox" checked={f.all_outlets} onChange={(e) => setF((o) => ({ ...o, all_outlets: e.target.checked }))} />{tr('Available at every outlet, not just this one')}</label>}
        <div className="flex justify-end gap-2"><Button type="button" variant="secondary" onClick={onClose}>{tr('Cancel')}</Button><Button type="submit" disabled={busy}>{busy ? tr('Saving…') : tr('Save printer')}</Button></div>
      </form>
    </Modal>
  );
};

export default function PrintersSettings() {
  const toast = useToast();
  const tr = useT();
  const [data, setData] = useState(null);                 // { printers, routing }
  const [stations, setStations] = useState([]);
  const [routing, setRouting] = useState({ stations: {} });
  const [form, setForm] = useState(null);                 // null | {} (new) | printer (edit)
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const { hasFeature } = useAuth();

  const load = useCallback(async () => {
    try {
      const d = await api('/printers');
      setData(d); setRouting({ ...d.routing, stations: { ...(d.routing.stations || {}) } });
    } catch (caught) { setError(caught.message); }
    // only a business with a kitchen has stations: asking any other kind of shop is a 402 in its console
    if (hasFeature('kitchen')) api('/kitchen/stations').then((s) => setStations(Array.isArray(s) ? s : [])).catch(() => setStations([]));
  }, [hasFeature]);
  useEffect(() => { load(); }, [load]);

  const printers = (data?.printers || []).filter((p) => p.is_active);
  const where = (p) => (p.connection === 'BROWSER' ? tr('Browser print dialog') : p.address.replace(/^tcp:\/\//, ''));
  const pick = (role) => ({ value: routing[role] || '', onChange: (e) => setRouting((r) => ({ ...r, [role]: e.target.value ? Number(e.target.value) : null })) });
  const pickStation = (id) => ({ value: routing.stations[id] || '', onChange: (e) => setRouting((r) => ({ ...r, stations: { ...r.stations, [id]: e.target.value ? Number(e.target.value) : null } })) });
  const choices = (blank) => [<option key="" value="">{blank}</option>, ...printers.map((p) => <option key={p.printer_id} value={p.printer_id}>{p.name}</option>)];

  const saveRouting = async () => {
    setBusy('routing'); setError('');
    try {
      const stationMap = Object.fromEntries(Object.entries(routing.stations).filter(([, v]) => v));
      await api('/printers/routing', { method: 'PUT', body: { receipt: routing.receipt, takeaway: routing.takeaway, drawer: routing.drawer, kot: routing.kot, stations: stationMap } });
      toast.success(tr('Printer routing saved'));
    } catch (caught) { setError(caught.message); }
    finally { setBusy(''); }
  };
  const test = async (p) => {
    setBusy(`t${p.printer_id}`); setError(''); setNote('');
    try {
      const prefs = getDevicePrefs();
      if (prefs.printMode !== 'agent') throw new Error(tr('Silent printing is not switched on for this computer. Set it up under "Silent printing and cash drawer" below, then test again.'));
      await testPrint(prefs, { printerId: p.printer_id });
      setNote(tr('Sent a test page to {{name}}. If nothing prints, check its address and that the print agent can reach it.', { name: p.name }));
    } catch (caught) { setError(caught.message); }
    finally { setBusy(''); }
  };
  const remove = async (p) => {
    if (!window.confirm(tr('Delete {{name}}? Anything routed to it falls back to the next choice.', { name: p.name }))) return;
    try { await api(`/printers/${p.printer_id}`, { method: 'DELETE' }); load(); } catch (caught) { setError(caught.message); }
  };

  return (
    <Card className="mt-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-bold text-ink-900">{tr('Printers')}</h2>
          <p className="mt-1 text-sm text-ink-500">{tr('List the printers at this outlet, then choose which one prints the receipt, takeaway bills, the cash drawer and each kitchen station. Everything keeps working as before until you set this up.')}</p>
        </div>
        <Button type="button" onClick={() => setForm({})}><Plus aria-hidden="true" className="h-4 w-4" />{tr('Add printer')}</Button>
      </div>
      <div className="mt-3 space-y-2"><Alert>{error}</Alert>{note && <p className="text-sm text-success" role="status">{note}</p>}</div>

      {!data ? null : data.printers.length === 0 ? (
        <p className="mt-4 rounded-md bg-surface-2 p-4 text-sm text-ink-700">{tr('No printers yet. Add your counter printer first, then a kitchen or bar printer if you have them.')}</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-md border border-line">
          {data.printers.map((p) => (
            <li key={p.printer_id} className="flex flex-wrap items-center gap-3 p-3">
              <Printer aria-hidden="true" className="h-5 w-5 shrink-0 text-ink-500" />
              <div className="min-w-0 flex-1">
                <p className="text-small font-medium text-ink-900">{p.name}{p.branch_id == null && <span className="ml-2 text-caption text-ink-500">{tr('all outlets')}</span>}</p>
                <p className="truncate text-caption text-ink-500">{tr(CONNECTIONS[p.connection])} · {where(p)}{p.connection !== 'BROWSER' && ` · ${p.paper_width} mm`}</p>
              </div>
              <Button type="button" variant="secondary" size="sm" disabled={Boolean(busy)} onClick={() => test(p)}>{busy === `t${p.printer_id}` ? tr('Sending…') : tr('Test print')}</Button>
              <Button type="button" variant="secondary" size="sm" aria-label={tr('Edit {{name}}', { name: p.name })} onClick={() => setForm(p)}><Pencil aria-hidden="true" className="h-4 w-4" /></Button>
              <Button type="button" variant="secondary" size="sm" aria-label={tr('Delete {{name}}', { name: p.name })} onClick={() => remove(p)}><Trash2 aria-hidden="true" className="h-4 w-4" /></Button>
            </li>
          ))}
        </ul>
      )}

      {printers.length > 0 && (
        <div className="mt-6 border-t border-line pt-4">
          <p className="text-sm font-semibold text-ink-900">{tr('Which printer prints what')}</p>
          <p className="mb-3 text-xs text-ink-500">{tr('Leave a choice empty to use the next one down: takeaway and the cash drawer use the receipt printer, and a station uses the kitchen printer. With nothing chosen at all, this computer\'s own addresses (below) or the browser print window are used.')}</p>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field id="rt_receipt" label={tr('Receipts')}><Select id="rt_receipt" {...pick('receipt')}>{choices(tr('Not set'))}</Select></Field>
            <Field id="rt_takeaway" label={tr('Takeaway and parcel bills')}><Select id="rt_takeaway" {...pick('takeaway')}>{choices(tr('Same as receipts'))}</Select></Field>
            <Field id="rt_drawer" label={tr('Cash drawer')}><Select id="rt_drawer" {...pick('drawer')}>{choices(tr('Same as receipts'))}</Select></Field>
            {stations.length > 0 && <Field id="rt_kot" label={tr('Kitchen tickets (every station without its own)')}><Select id="rt_kot" {...pick('kot')}>{choices(tr('Not set'))}</Select></Field>}
          </div>
          {stations.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-small font-medium text-ink-900">{tr('Kitchen stations')}</p>
              <div className="grid gap-3 sm:grid-cols-2">
                {stations.map((s) => <Field key={s.station_id} id={`rt_st${s.station_id}`} label={s.name}><Select id={`rt_st${s.station_id}`} {...pickStation(s.station_id)}>{choices(tr('Same as the kitchen default'))}</Select></Field>)}
              </div>
            </div>
          )}
          <div className="mt-4"><Button type="button" onClick={saveRouting} disabled={busy === 'routing'}>{busy === 'routing' ? tr('Saving…') : tr('Save routing')}</Button></div>
        </div>
      )}
      {form && <PrinterForm printer={form.printer_id ? form : null} onClose={() => setForm(null)} onSaved={() => { setForm(null); load(); }} />}
    </Card>
  );
}
