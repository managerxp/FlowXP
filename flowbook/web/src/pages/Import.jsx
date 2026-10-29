/* Bulk import from a CSV file: choose the file, check it (nothing is saved), then import the rows that passed. */
import { useState } from 'react';
import { STATES } from '../lib.js';
import { ITEM_ALIASES, PARTY_ALIASES, download, itemRow, parseCsv, partyRow, toRecords } from '../csv.js';
import { useSession } from '../session.jsx';
import { Btn, Card, Err, Note, Table, useAction } from '../ui.jsx';

const KINDS = {
  party: { aliases: PARTY_ALIASES, endpoint: '/import/parties', convert: (r, kind) => partyRow(r, kind, STATES), needs: 'name',
    template: 'Name,GSTIN,State,Phone,Email,Days to pay\nRavi Stores,,Maharashtra,9876543210,ravi@example.com,15\n', file: 'parties-template.csv' },
  item: { aliases: ITEM_ALIASES, endpoint: '/import/items', convert: (r) => itemRow(r), needs: 'sku',
    template: 'Code,Name,Type,HSN/SAC,Unit,GST,Selling price,Buying price\nTEA-1,Tea 1 kg,Goods,0902,Kg,5,400,320\nSETUP,Setup service,Service,998313,,18,1000,\n', file: 'items-template.csv' }
};

/** `what`: 'party' or 'item'. `partyKind` is CUSTOMER or VENDOR for parties. */
export const CsvImport = ({ what, partyKind, onDone, onClose }) => {
  const { o } = useSession();
  const cfg = KINDS[what];
  const [rows, setRows] = useState(null);       // [{ line, row, problem }]
  const [unknown, setUnknown] = useState([]);
  const [result, setResult] = useState(null);   // from the dry run
  const a = useAction();

  const choose = async (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    setResult(null); a.setError(''); a.setDone('');
    const { records, unknown: u } = toRecords(parseCsv(await file.text()), cfg.aliases);
    setUnknown(u);
    if (!records.length) { setRows([]); return; }
    setRows(records.map((r, i) => ({ line: i + 2, ...cfg.convert(r, partyKind) })));
  };
  const good = (rows || []).filter((r) => !r.problem);
  const send = (dryRun) => a.run(async () => {
    const out = await o(cfg.endpoint, { method: 'POST', body: { dryRun, rows: good.map((r) => r.row) } });
    setResult(out); if (!dryRun) { onDone?.(); }
    return out;
  });
  const errors = [...(rows || []).filter((r) => r.problem).map((r) => ({ line: r.line, message: r.problem })),
    ...(result?.errors || []).map((e) => ({ line: good[e.row - 1]?.line, message: e.message }))].sort((x, y) => x.line - y.line);
  const imported = result && !result.dryRun;

  return (
    <Card title={what === 'item' ? 'Import items from a CSV file' : `Import ${partyKind === 'VENDOR' ? 'vendors' : 'customers'} from a CSV file`} actions={<Btn type="button" className="btn small" onClick={onClose}>Close</Btn>}>
      <p className="muted">One row per line, with a header row. Columns can be in any order; the template shows the names. Up to 1000 rows. Excel: Save As, CSV.</p>
      <p className="actions"><input type="file" accept=".csv,text/csv" onChange={choose} aria-label="CSV file" /><Btn type="button" className="btn small" onClick={() => download(cfg.file, cfg.template)}>Download a template</Btn></p>
      <Err>{a.error}</Err>
      {rows && !rows.length && <p className="notice warn">No data rows found. Is there a header row, with a {cfg.needs === 'sku' ? 'Code' : 'Name'} column?</p>}
      {unknown.length > 0 && <p className="notice warn">These columns were not recognised and will be ignored: {unknown.join(', ')}.</p>}
      {rows?.length > 0 && <>
        <p>{rows.length} rows read. {errors.length ? `${errors.length} cannot be imported.` : 'No problems found so far.'}{result?.dryRun && !errors.length ? ' Checked: all will import.' : ''}</p>
        {errors.length > 0 && <Table head={['Line in file', 'Problem']}>{errors.slice(0, 50).map((e, i) => <tr key={i}><td>{e.line}</td><td>{e.message}</td></tr>)}</Table>}
        {errors.length > 50 && <p className="muted">…and {errors.length - 50} more.</p>}
        {imported
          ? <Note>{`Imported ${result.created} ${what === 'item' ? 'items' : 'people'}. ${errors.length ? 'The rows with problems were left out; fix them in the file and import again.' : ''}`}</Note>
          : <p className="actions"><Btn type="button" busy={a.busy} onClick={() => send(true)}>Check</Btn><Btn kind="primary" type="button" busy={a.busy} disabled={!good.length} onClick={() => send(false)}>Import {good.length} rows</Btn></p>}
      </>}
    </Card>
  );
};
