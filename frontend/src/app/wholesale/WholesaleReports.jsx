/*
 * Reports: sales, purchases, inventory and financial, each computed live from the documents. Pick a report on the left,
 * set the period and any filter, read it, export it to CSV or print it. Totals are the sums of the rows shown.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Download, Printer } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { dateText, money, pct, qs, qty, saveCsv, todayIn, useLoad, addDays } from '../../lib/wholesale.js';
import { Alert, Button, Field, ListState, PageHeader, Select, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { DateRange, Panel, WarehouseSelect } from './parts.jsx';

const cellText = (type, v) => {
  if (v == null || v === '') return '';
  if (type === 'money') return money(v);
  if (type === 'number') return qty(v);
  if (type === 'percent') return pct(v);
  if (type === 'date') return /^\d{4}-\d{2}-\d{2}/.test(String(v)) ? dateText(String(v).slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' }) : String(v);
  return String(v);
};
const rawText = (type, v) => (v == null ? '' : v);

const WholesaleReports = () => {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const catalogue = useLoad('/wholesale/reports');
  const key = params.get('r') || 'sales_summary';
  const today = todayIn();
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`);
  const [to, setTo] = useState(today);
  const [warehouse, setWarehouse] = useState('');
  const [group, setGroup] = useState('day');
  const [category, setCategory] = useState('');
  const [salesperson, setSalesperson] = useState('');
  const def = (catalogue.data || []).find((r) => r.key === key);
  const cats = useLoad(def?.filters?.includes('category_id') ? '/wholesale/categories' : null);
  const people = useLoad(def?.filters?.includes('salesperson_id') ? '/wholesale/salespeople' : null);
  const query = useMemo(() => qs({ from: def?.period ? from : undefined, to: def ? to : undefined, branch_id: warehouse, group: def?.filters?.includes('group') ? group : undefined, category_id: def?.filters?.includes('category_id') ? category : undefined, salesperson_id: def?.filters?.includes('salesperson_id') ? salesperson : undefined }), [def, from, to, warehouse, group, category, salesperson]);
  const { data: rep, loading, error } = useLoad(def ? `/wholesale/reports/${key}${query}` : null);

  const groups = useMemo(() => { const g = {}; for (const r of catalogue.data || []) (g[r.group] ||= []).push(r); return g; }, [catalogue.data]);
  const exportCsv = () => saveCsv(`${key}-${new Date().toISOString().slice(0, 10)}.csv`, rep.columns, [...rep.rows.map((r) => Object.fromEntries(rep.columns.map((c) => [c.key, rawText(c.type, r[c.key])]))), ...(rep.totals ? [Object.fromEntries(rep.columns.map((c) => [c.key, rawText(c.type, rep.totals[c.key])]))] : [])]);

  return (
    <div>
      <style>{`@media print { .no-print { display: none !important; } main { padding: 0 !important; } }`}</style>
      <div className="no-print"><PageHeader title="Reports" lead="Sales, purchases, stock and money, worked out live from your records." /></div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[240px_minmax(0,1fr)]">
        <nav aria-label="Reports" className="no-print space-y-4 lg:sticky lg:top-4 lg:self-start">
          {Object.entries(groups).map(([name, items]) => (
            <div key={name}><p className="mb-1 px-2 text-caption font-semibold uppercase tracking-wide text-ink-500">{name}</p>
              <ul>{items.map((r) => <li key={r.key}><button type="button" onClick={() => setParams({ r: r.key }, { replace: true })} className={`block w-full rounded-lg px-2.5 py-1.5 text-left text-small ${key === r.key ? 'bg-brand-50 font-semibold text-brand-700' : 'text-ink-700 hover:bg-surface-2'}`}>{r.label}</button></li>)}</ul></div>
          ))}
        </nav>
        <div className="min-w-0 space-y-4">
          <ListState loading={catalogue.loading && !catalogue.data} error={catalogue.error} />
          {def && (
            <>
              <div className="no-print space-y-3">
                <p className="text-small text-ink-500">{def.description}</p>
                <div className="flex flex-wrap items-end gap-3">
                  {def.period ? <DateRange from={from} to={to} onChange={(a, b) => { setFrom(a); setTo(b); }} /> : ['receivables_ageing', 'payables_ageing'].includes(key) ? <Field id="rp-to" label="As of"><input id="rp-to" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} className="rounded-(--radius-control) border border-line-strong bg-surface px-3 py-2 text-sm" /></Field> : null}
                  {!['receivables_ageing', 'payables_ageing', 'customer_outstanding', 'supplier_outstanding', 'collections'].includes(key) && <WarehouseSelect allowAll value={warehouse} onChange={setWarehouse} id="rp-wh" />}
                  {def.filters?.includes('group') && <Field id="rp-group" label="Group by"><Select id="rp-group" value={group} onChange={(e) => setGroup(e.target.value)}><option value="day">Day</option><option value="week">Week</option><option value="month">Month</option></Select></Field>}
                  {def.filters?.includes('category_id') && <Field id="rp-cat" label="Category"><Select id="rp-cat" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">All</option>{(cats.data || []).map((c) => <option key={c.category_id} value={c.category_id}>{c.name}</option>)}</Select></Field>}
                  {def.filters?.includes('salesperson_id') && <Field id="rp-sp" label="Salesperson"><Select id="rp-sp" value={salesperson} onChange={(e) => setSalesperson(e.target.value)}><option value="">All</option>{(people.data || []).map((p) => <option key={p.salesperson_id} value={p.salesperson_id}>{p.name}</option>)}</Select></Field>}
                  <div className="ml-auto flex gap-2 pb-0.5">{rep && can('export') && <Button variant="secondary" onClick={exportCsv}><Download aria-hidden="true" className="h-4 w-4" />CSV</Button>}{rep && <Button variant="secondary" onClick={() => window.print()}><Printer aria-hidden="true" className="h-4 w-4" />Print</Button>}</div>
                </div>
              </div>
              <h2 className="hidden text-lg font-semibold print:block">{def.label}{def.period ? ` · ${dateText(from, { day: 'numeric', month: 'short', year: 'numeric' })} to ${dateText(to, { day: 'numeric', month: 'short', year: 'numeric' })}` : ''}</h2>
              <ListState loading={loading && !rep} error={error} empty={rep?.rows.length === 0} emptyLabel="No data" emptyBody="There is nothing to show for these filters." />
              {rep && rep.rows.length > 0 && (
                <>
                  <Table>
                    <Thead>{rep.columns.map((c) => <Th key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'text-right' : ''}>{c.label}</Th>)}</Thead>
                    <tbody>
                      {rep.rows.map((r, i) => <Tr key={i}>{rep.columns.map((c) => <Td key={c.key} className={['money', 'number', 'percent'].includes(c.type) ? 'text-right tabular' : ''}>{cellText(c.type, r[c.key])}</Td>)}</Tr>)}
                      {rep.totals && <Tr>{rep.columns.map((c) => <Td key={c.key} className={`font-semibold ${['money', 'number', 'percent'].includes(c.type) ? 'text-right tabular' : ''}`}>{cellText(c.type, rep.totals[c.key])}</Td>)}</Tr>}
                    </tbody>
                  </Table>
                  <p className="text-caption text-ink-500">{rep.rows.length} row{rep.rows.length === 1 ? '' : 's'}.{rep.note ? ` ${rep.note}` : ''} GST reports for filing are under GST filing.</p>
                </>
              )}
            </>
          )}
          {!def && !catalogue.loading && !catalogue.error && <Alert>That report does not exist.</Alert>}
        </div>
      </div>
    </div>
  );
};

export default WholesaleReports;
