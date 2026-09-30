/*
 * Aggregator settlement reconciliation (owner's request, 2026-09-29) — the
 * honest fallback for not having real Zomato/Swiggy/ONDC API access: paste
 * the statement the platform already gives you (their portal exports one),
 * one settled order per line, and FlowXP checks whether their own numbers
 * add up and whether the amount matches what was actually billed here —
 * rather than just trusting a spreadsheet.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { PLATFORM_LABEL } from '../lib/business.js';
import { PageHeader, Card, Badge, Button, Field, Select, Textarea, Alert, ListState, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const STATUS_TONE = { MATCHED: 'success', VALUE_MISMATCH: 'warning', ARITHMETIC_ERROR: 'danger', ORDER_NOT_FOUND: 'danger' };
const STATUS_LABEL = { MATCHED: 'Matched', VALUE_MISMATCH: 'Value mismatch', ARITHMETIC_ERROR: "Doesn't add up", ORDER_NOT_FOUND: 'No FlowXP order' };
const COLUMNS = ['Order ID', 'Date (YYYY-MM-DD)', 'Gross amount', 'Commission', 'Payment charges', 'Delivery charges', 'Tax', 'Other deductions', 'Net settled'];

/** One line per settled order, in COLUMNS' order — no header row, no fancy CSV quoting: this is a template we define, not a format we adapt to. */
const parseRows = (text) => text.trim().split('\n').map((line) => line.split(',').map((c) => c.trim())).filter((cells) => cells[0]).map((cells) => ({
  external_order_id: cells[0], settlement_date: cells[1] || undefined, gross_amount: cells[2] || 0, commission: cells[3] || 0,
  payment_charges: cells[4] || 0, delivery_charges: cells[5] || 0, tax: cells[6] || 0, other_deductions: cells[7] || 0, net_settled: cells[8] ?? cells[2] ?? 0
}));

const ImportBox = ({ platform, onImported }) => {
  const toast = useToast();
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async () => {
    setError('');
    const rows = parseRows(text);
    if (!rows.length) return setError('Paste at least one row first.');
    setBusy(true);
    try {
      const result = await api('/settlements/import', { method: 'POST', body: { platform, rows } });
      toast.success(`Imported ${result.rows} row${result.rows === 1 ? '' : 's'}`);
      setText('');
      onImported();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-400">Import a statement</h3>
      <p className="mb-3 text-sm text-ink-500">
        One settled order per line, comma-separated, in this order: {COLUMNS.join(', ')}. Leave charges blank if
        {' '}{PLATFORM_LABEL[platform] || platform} doesn't break them out — e.g. <code className="rounded bg-surface-2 px-1">Z1234,2026-09-20,500,100,,,,,400</code>
      </p>
      <Textarea rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Z1234,2026-09-20,500,100,,,,,400" />
      {error && <div className="mt-2"><Alert>{error}</Alert></div>}
      <Button className="mt-3" onClick={submit} disabled={busy || !text.trim()}>{busy ? 'Importing…' : 'Import'}</Button>
    </Card>
  );
};

const MissingCard = ({ platform, refreshKey }) => {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { setData(null); api(`/settlements/missing?platform=${platform}`).then(setData).catch((e) => setError(e.message)); }, [platform, refreshKey]);

  return (
    <Card>
      <h3 className="mb-1 text-sm font-bold uppercase tracking-wide text-ink-400">Never settled</h3>
      <p className="mb-3 text-sm text-ink-500">Billed orders on {PLATFORM_LABEL[platform] || platform} with no matching statement line at all yet — money that should have been paid.</p>
      <ListState loading={!data && !error} error={error} empty={data?.orders.length === 0} emptyLabel="Nothing unpaid, as far as an imported statement can tell." />
      {data?.orders.length > 0 && (
        <>
          <p className="mb-2 text-sm font-semibold text-danger">₹{data.total_owed.toLocaleString('en-IN')} across {data.orders.length} order{data.orders.length === 1 ? '' : 's'}</p>
          <ul className="max-h-56 space-y-1 overflow-y-auto text-sm">
            {data.orders.map((o) => (
              <li key={o.order_id} className="flex justify-between border-b border-line py-1 last:border-0">
                <span>{o.order_number} · {o.external_order_number || o.external_order_id}</span>
                <span className="tabular font-medium">₹{o.total.toLocaleString('en-IN')}</span>
              </li>
            ))}
          </ul>
        </>
      )}
    </Card>
  );
};

const SettlementsPage = () => {
  const [platform, setPlatform] = useState('ZOMATO');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    setData(null);
    api(`/settlements?platform=${platform}`).then(setData).catch((e) => setError(e.message));
  }, [platform, refreshKey]);

  return (
    <div>
      <PageHeader
        title="Settlement reconciliation"
        lead="Real Zomato/Swiggy/ONDC API access needs their own partner approval, which FlowXP doesn't have yet — so this checks the statement they already export you, instead of a live feed."
      />
      <div className="mb-4 max-w-xs">
        <Field id="platform" label="Platform">
          <Select id="platform" value={platform} onChange={(e) => setPlatform(e.target.value)}>
            {Object.keys(PLATFORM_LABEL).map((p) => <option key={p} value={p}>{PLATFORM_LABEL[p]}</option>)}
          </Select>
        </Field>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <ImportBox platform={platform} onImported={() => setRefreshKey((k) => k + 1)} />
        <MissingCard platform={platform} refreshKey={refreshKey} />
      </div>

      <div className="mt-6">
        <h3 className="mb-2 text-sm font-bold uppercase tracking-wide text-ink-400">Imported lines</h3>
        {error && <Alert>{error}</Alert>}
        <ListState loading={!data && !error} error={null} empty={data?.lines.length === 0} emptyLabel="Nothing imported for this platform yet." />
        {data?.lines.length > 0 && (
          <>
            <p className="mb-2 text-sm text-ink-500">{data.summary.matched} matched, {data.summary.flagged} flagged, out of {data.summary.count} — ₹{data.summary.net_settled_total.toLocaleString('en-IN')} settled in total.</p>
            <Table>
              <Thead><Th>Order</Th><Th>Gross</Th><Th>Net settled</Th><Th>Expected</Th><Th>Status</Th></Thead>
              <tbody>
                {data.lines.map((l) => (
                  <Tr key={l.line_id}>
                    <Td>{l.order_number || l.external_order_id}</Td>
                    <Td>₹{l.gross_amount.toLocaleString('en-IN')}</Td>
                    <Td>₹{l.net_settled.toLocaleString('en-IN')}</Td>
                    <Td>₹{l.expected_settlement.toLocaleString('en-IN')}</Td>
                    <Td><Badge tone={STATUS_TONE[l.status]}>{STATUS_LABEL[l.status]}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </>
        )}
      </div>
    </div>
  );
};

export default SettlementsPage;
