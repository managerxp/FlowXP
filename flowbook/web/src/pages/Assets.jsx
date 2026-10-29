/* Fixed assets: the register, depreciation run, adding an asset, and selling or writing one off. */
import { useState } from 'react';
import { useLoad } from '../api.js';
import { inr, showDate, today } from '../lib.js';
import { useSession } from '../session.jsx';
import { Async, Badge, Btn, Card, Confirm, Empty, Err, Field, Money, Note, Page, Table, useAction } from '../ui.jsx';

const METHOD = { SLM: 'Straight line', WDV: 'Written-down value', NONE: 'No depreciation' };
const blank = () => ({ name: '', tag: '', category: '', purchaseDate: today(), startDate: '', cost: '', salvage: '', method: 'SLM', lifeYears: '5', ratePercent: '15', paidFrom: 'BANK', openingAccumulated: '', itBlock: '', itOpeningWdv: '' });

const AddAsset = ({ blocks, onDone, onClose }) => {
  const { o } = useSession();
  const a = useAction();
  const [f, setF] = useState(blank);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  const owned = f.paidFrom === 'OPENING_BALANCE';
  const save = (e) => {
    e.preventDefault();
    a.run(async () => {
      await o('/assets', { method: 'POST', body: { name: f.name, purchaseDate: f.purchaseDate, cost: f.cost, method: f.method, paidFrom: f.paidFrom,
        ...(f.tag && { tag: f.tag }), ...(f.category && { category: f.category }), ...(f.startDate && { startDate: f.startDate }), ...(f.salvage && { salvage: f.salvage }),
        ...(f.method === 'SLM' && { lifeYears: f.lifeYears }), ...(f.method === 'WDV' && { ratePercent: f.ratePercent }), ...(owned && f.openingAccumulated && { openingAccumulated: f.openingAccumulated }),
        ...(f.itBlock && { itBlock: f.itBlock, ...(owned && f.itOpeningWdv && { itOpeningWdv: f.itOpeningWdv }) }) } });
      onDone(); onClose();
    }, 'Asset added.');
  };
  return (
    <Card title="Add an asset"><Err>{a.error}</Err>
      <form className="form" onSubmit={save}>
        <Field label="Name"><input value={f.name} onChange={set('name')} required maxLength={160} /></Field>
        <Field label="Tag or serial (optional)"><input value={f.tag} onChange={set('tag')} maxLength={40} /></Field>
        <Field label="Kind (optional)" hint="Computer, furniture, vehicle..."><input value={f.category} onChange={set('category')} maxLength={60} /></Field>
        <Field label="Bought on"><input type="date" value={f.purchaseDate} onChange={set('purchaseDate')} required /></Field>
        <Field label="Cost (₹)"><input inputMode="decimal" value={f.cost} onChange={set('cost')} required /></Field>
        <Field label="Where the money came from" hint="Choose Already owned for something the business had before these books"><select value={f.paidFrom} onChange={set('paidFrom')}>
          <option value="BANK">Bank</option><option value="CASH">Cash</option><option value="AP">Owed to a vendor (payable)</option><option value="OPENING_BALANCE">Already owned</option></select></Field>
        {owned && <Field label="Depreciation already taken (₹)" hint="Total written off before these books began"><input inputMode="decimal" value={f.openingAccumulated} onChange={set('openingAccumulated')} /></Field>}
        <Field label="How it loses value"><select value={f.method} onChange={set('method')}><option value="SLM">Straight line (same amount every month)</option><option value="WDV">Written-down value (a yearly percent of what is left)</option><option value="NONE">None (land, for example)</option></select></Field>
        {f.method === 'SLM' && <Field label="Useful life (years)"><input inputMode="decimal" value={f.lifeYears} onChange={set('lifeYears')} required /></Field>}
        {f.method === 'WDV' && <Field label="Yearly rate (%)"><input inputMode="decimal" value={f.ratePercent} onChange={set('ratePercent')} required /></Field>}
        {f.method !== 'NONE' && <Field label="Scrap value (₹)" hint="What it should be worth at the end (optional)"><input inputMode="decimal" value={f.salvage} onChange={set('salvage')} /></Field>}
        {f.method !== 'NONE' && <Field label="Start depreciating from" hint={owned ? 'Must be inside your books, such as the first day of this financial year' : 'Defaults to the purchase month, counted as a full month'}><input type="date" value={f.startDate} onChange={set('startDate')} /></Field>}
        <Field label="Income tax block (optional)" hint="The class the Income Tax Act pools it into; used for the tax depreciation schedule"><select value={f.itBlock} onChange={set('itBlock')}><option value="">Not set</option>{blocks.map((b) => <option key={b.code} value={b.code}>{b.label} ({b.rate_percent}%)</option>)}</select></Field>
        {owned && f.itBlock && <Field label="Its tax value at the start of this financial year (₹)" hint="What is left of it for tax, from last year's schedule"><input inputMode="decimal" value={f.itOpeningWdv} onChange={set('itOpeningWdv')} /></Field>}
        <div className="wide actions"><Btn kind="primary" busy={a.busy}>Save</Btn><Btn type="button" onClick={onClose}>Cancel</Btn></div>
      </form>
    </Card>
  );
};

const Dispose = ({ asset, onDone, onClose }) => {
  const { o } = useSession();
  const a = useAction();
  const [f, setF] = useState({ date: today(), proceeds: '', receivedIn: 'BANK', taxCode: '', interState: false });
  const rates = useLoad(() => o('/tax-rates'), []);
  const codes = [...new Set((rates.data || []).map((r) => r.code))].filter((c) => c !== 'GST0');
  const set = (k) => (e) => setF({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  const book = Number(asset.book_value_minor);
  const gain = f.proceeds === '' ? null : Number(f.proceeds) - book;
  return (
    <Confirm><p>Selling or writing off <strong>{asset.name}</strong> clears its cost and depreciation from the books and posts the difference as a gain or loss. Depreciation must be up to date through the month before.</p>
      <Err>{a.error}</Err>
      <div className="form">
        <Field label="Date"><input type="date" value={f.date} onChange={set('date')} required /></Field>
        <Field label="Sold for (₹)" hint="Leave empty or 0 for a write-off"><input inputMode="decimal" value={f.proceeds} onChange={set('proceeds')} /></Field>
        {Number(f.proceeds) > 0 && <Field label="GST charged on the sale" hint="On top of the price; it goes to output tax and into GSTR-3B"><select value={f.taxCode} onChange={set('taxCode')}><option value="">None</option>{codes.map((c) => <option key={c}>{c}</option>)}</select></Field>}
        {Number(f.proceeds) > 0 && f.taxCode && <p className="check"><input id="ist" type="checkbox" checked={f.interState} onChange={set('interState')} /><label htmlFor="ist">Buyer is in another state (IGST)</label></p>}
        {Number(f.proceeds) > 0 && <Field label="Money went into"><select value={f.receivedIn} onChange={set('receivedIn')}><option value="BANK">Bank</option><option value="CASH">Cash</option><option value="UPI_CLEARING">UPI</option></select></Field>}
      </div>
      <p className="muted">Worth ₹{inr(book)} on the books{gain !== null ? `: ${gain >= 0 ? 'gain' : 'loss'} of ₹${inr(Math.abs(gain))}` : ''}.</p>
      <p className="actions"><Btn kind="danger" busy={a.busy} onClick={() => a.run(async () => { await o(`/assets/${asset.id}/dispose`, { method: 'POST', body: { date: f.date, ...(Number(f.proceeds) > 0 && { proceeds: f.proceeds, receivedIn: f.receivedIn, ...(f.taxCode && { taxCode: f.taxCode, interState: f.interState }) }) } }); onDone(); onClose(); })}>{Number(f.proceeds) > 0 ? 'Record the sale' : 'Write it off'}</Btn><Btn onClick={onClose}>Cancel</Btn></p>
    </Confirm>
  );
};

const thisFy = () => { const d = new Date(); return d.getFullYear() - (d.getMonth() < 3 ? 1 : 0); };

/* The same assets seen year by year: from the books, and as the Income Tax Act pools them into blocks. */
const Schedules = () => {
  const { o, org } = useSession();
  const [fy, setFy] = useState(thisFy());
  const [view, setView] = useState('books');
  const book = useLoad(() => o(`/assets/schedule?fy=${fy}`), [org.id, fy]);
  const tax = useLoad(() => o(`/assets/tax-depreciation?fy=${fy}`), [org.id, fy]);
  const years = book.data?.years?.length ? book.data.years : [fy];
  return (
    <Card title="Year by year">
      <p className="actions">
        <select value={fy} onChange={(e) => setFy(Number(e.target.value))}>{[...new Set([...years, fy])].sort().map((y) => <option key={y} value={y}>{y}-{String(y + 1).slice(2)}</option>)}</select>{' '}
        <Btn kind={view === 'books' ? 'primary' : undefined} onClick={() => setView('books')}>From the books</Btn>
        <Btn kind={view === 'tax' ? 'primary' : undefined} onClick={() => setView('tax')}>Income tax blocks</Btn>
      </p>
      {view === 'books'
        ? <Async load={book}>{(d) => (
          <Table head={['Asset', '>Cost at start', '>Added', '>Sold', '>Cost at end', '>Depreciation to start', '>This year', '>Taken off on sale', '>Worth at end']} empty={!d.lines.length && <Empty>No assets in this year.</Empty>}>
            {d.lines.map((l) => <tr key={l.id}><td>{l.name}</td><td className="r"><Money v={l.gross_opening_minor} /></td><td className="r"><Money v={l.gross_additions_minor} /></td><td className="r"><Money v={l.gross_disposals_minor} /></td><td className="r"><Money v={l.gross_closing_minor} /></td>
              <td className="r"><Money v={l.accum_opening_minor} /></td><td className="r"><Money v={l.depreciation_minor} /></td><td className="r"><Money v={l.accum_on_disposals_minor} /></td><td className="r"><Money v={l.wdv_closing_minor} strong /></td></tr>)}
            {d.lines.length > 0 && <tr><td><strong>Total</strong></td>{['gross_opening_minor', 'gross_additions_minor', 'gross_disposals_minor', 'gross_closing_minor', 'accum_opening_minor', 'depreciation_minor', 'accum_on_disposals_minor', 'wdv_closing_minor'].map((k) => <td key={k} className="r"><Money v={d.totals[k]} strong /></td>)}</tr>}
          </Table>)}</Async>
        : <Async load={tax}>{(d) => (<>
          <Table head={['Block', '>At start', '>Added', '>Added, half rate', '>Sold for', '>Depreciation', '>Gain / (loss)', '>At end']} empty={!d.blocks.length && <Empty>Give your assets an income tax block to see the schedule.</Empty>}>
            {d.blocks.map((b) => <tr key={b.block}><td>{b.label} <span className="muted">{b.rate_percent}%</span></td><td className="r"><Money v={b.opening_minor} /></td><td className="r"><Money v={b.additions_full_minor} /></td><td className="r"><Money v={b.additions_half_minor} /></td><td className="r"><Money v={b.sales_minor} /></td>
              <td className="r"><Money v={b.depreciation_minor} strong /></td><td className="r"><Money v={b.capital_gain_minor} /></td><td className="r"><Money v={b.closing_minor} strong /></td></tr>)}
            {d.blocks.length > 0 && <tr><td><strong>Total</strong></td>{['opening_minor', 'additions_full_minor', 'additions_half_minor', 'sales_minor', 'depreciation_minor', 'capital_gain_minor', 'closing_minor'].map((k) => <td key={k} className="r"><Money v={d.totals[k]} strong /></td>)}</tr>}
          </Table>
          {d.unassigned > 0 && <Note>{d.unassigned} asset{d.unassigned === 1 ? '' : 's'} still without a block are left out. Pick one in the list below.</Note>}
          <p className="muted">A report for your tax return, not posted to the books. Additions used less than 180 days in the year get half the rate; a sale comes off the block, and if it takes the block below zero the rest is a short-term capital gain. Rates are the standard ones: confirm with your CA.</p>
        </>)}</Async>}
    </Card>
  );
};

export default () => {
  const { o, org } = useSession();
  const load = useLoad(() => o('/assets'), [org.id]);
  const a = useAction();
  const blocks = useLoad(() => o('/assets/tax-blocks'), []);
  const [adding, setAdding] = useState(false);
  const [dispose, setDispose] = useState(null);
  const [through, setThrough] = useState(today().slice(0, 7));
  const runDep = () => a.run(async () => {
    const done = await o('/assets/depreciation', { method: 'POST', body: { through } });
    await load.reload();
    if (!done.length) throw new Error('Nothing to post: depreciation is already up to date through that month.');
    return done;
  }, 'Depreciation posted.');
  return (
    <Page title="Fixed assets" lead="Things the business owns and uses for years. Depreciation is posted a month at a time." actions={<Btn kind="primary" onClick={() => setAdding(true)}>Add asset</Btn>}>
      <Err>{a.error}</Err><Note>{a.done}</Note>
      {adding && <AddAsset blocks={blocks.data || []} onDone={load.reload} onClose={() => setAdding(false)} />}
      <Card title="Post depreciation">
        <div className="form"><Field label="Through the end of" hint="Posts every month not yet done, one entry per month"><input type="month" value={through} onChange={(e) => setThrough(e.target.value)} /></Field></div>
        <p className="actions"><Btn busy={a.busy} onClick={runDep}>Post depreciation</Btn></p>
      </Card>
      {dispose && <Dispose asset={dispose} onDone={load.reload} onClose={() => setDispose(null)} />}
      <Card><Async load={load}>{(d) => (<>
        <Table head={['Asset', 'Bought', 'Method', '>Cost', '>Depreciation so far', '>Worth now', 'Tax block', '']} empty={!d.assets.length && <Empty>No assets yet. Add a computer, vehicle or machine to start.</Empty>}>
          {d.assets.map((r) => (
            <tr key={r.id} className={r.status === 'DISPOSED' ? 'muted' : ''}>
              <td>{r.name}{r.tag && <span className="muted"> · {r.tag}</span>}{r.status === 'DISPOSED' && <> <Badge status="VOID">gone {showDate(r.disposed_on)}</Badge></>}</td>
              <td>{showDate(r.purchase_date)}</td>
              <td>{METHOD[r.method]}{r.method === 'SLM' ? `, ${r.life_months / 12} yrs` : r.method === 'WDV' ? `, ${r.rate_bp / 100}%` : ''}</td>
              <td className="r"><Money v={r.cost_minor} /></td><td className="r"><Money v={r.accumulated_minor} /></td><td className="r"><Money v={r.book_value_minor} strong /></td>
              <td>{r.status !== 'CANCELLED' && <select value={r.it_block || ''} onChange={(e) => a.run(async () => { await o(`/assets/${r.id}/tax`, { method: 'PATCH', body: { itBlock: e.target.value || null } }); await load.reload(); })}><option value="">Not set</option>{(blocks.data || []).map((b) => <option key={b.code} value={b.code}>{b.label}</option>)}</select>}</td>
              <td>{r.status === 'ACTIVE' && <button className="linkish" onClick={() => setDispose(r)}>Sell or write off</button>}</td>
            </tr>
          ))}
        </Table>
        {d.assets.some((r) => r.status === 'ACTIVE') && <p className="muted">On the books now: cost ₹{inr(d.totals.cost_minor)}, depreciation ₹{inr(d.totals.accumulated_minor)}, worth ₹{inr(d.totals.book_value_minor)}.</p>}
      </>)}</Async></Card>
      <Schedules />
    </Page>
  );
};
