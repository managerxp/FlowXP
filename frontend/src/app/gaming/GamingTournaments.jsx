/* Tournaments: a FIFA or pool night. Entries (the fee is billed with GST), check-in, and the results with prizes. No brackets. */
import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Trophy } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { dateTimeText, rs, useLoad } from '../../lib/gaming.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, useAction } from '../salon/parts.jsx';
import { PlayerPicker } from './SessionDialogs.jsx';

const STATUS = { PLANNED: ['Planned', 'neutral'], OPEN: ['Taking entries', 'success'], RUNNING: ['Under way', 'brand'], DONE: ['Finished', 'neutral'], CANCELLED: ['Cancelled', 'danger'] };
const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank'], ['OTHER', 'Other']];
const localInput = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;

const TournamentForm = ({ t, onClose, onSaved }) => {
  const [f, setF] = useState(t ? { name: t.name, game_name: t.game_name || '', starts: localInput(new Date(t.starts_at)), fee: String(t.entry_fee), pool: String(t.prize_pool), max: t.max_players ? String(t.max_players) : '', notes: t.notes || '' }
    : { name: '', game_name: '', starts: localInput(new Date(Date.now() + 7 * 86400000)), fee: '', pool: '', max: '16', notes: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    setError('');
    const body = { name: f.name, game_name: f.game_name || null, starts_at: new Date(f.starts).toISOString(), entry_fee: f.fee === '' ? 0 : Number(f.fee), prize_pool: f.pool === '' ? 0 : Number(f.pool), max_players: f.max === '' ? null : Number(f.max), notes: f.notes || null };
    try { onSaved(await api(t ? `/gaming/tournaments/${t.tournament_id}` : '/gaming/tournaments', { method: t ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={t ? `Edit ${t.name}` : 'New tournament'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim()}>{t ? 'Save' : 'Create'}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="tf-name" label="Name"><Input id="tf-name" value={f.name} onChange={(e) => set('name')(e.target.value)} placeholder="FIFA night, 8-ball cup" autoFocus /></Field>
          <Field id="tf-game" label="Game"><Input id="tf-game" value={f.game_name} onChange={(e) => set('game_name')(e.target.value)} /></Field>
          <Field id="tf-starts" label="Starts"><Input id="tf-starts" type="datetime-local" value={f.starts} onChange={(e) => set('starts')(e.target.value)} /></Field>
          <NumberField id="tf-max" label="Most players" value={f.max} onChange={set('max')} min={2} step={1} hint="Blank: no limit" />
          <NumberField id="tf-fee" label="Entry fee (before GST)" prefix="₹" value={f.fee} onChange={set('fee')} />
          <NumberField id="tf-pool" label="Prize pool" prefix="₹" value={f.pool} onChange={set('pool')} hint="What you give away. Not taken from the entry fees automatically." />
        </div>
        <Field id="tf-notes" label="Notes (optional)"><Textarea id="tf-notes" rows={2} value={f.notes} maxLength={300} onChange={(e) => set('notes')(e.target.value)} /></Field>
      </div>
    </Modal>
  );
};

const EntryForm = ({ t, onClose, onDone }) => {
  const key = useIdempotencyKey();
  const [player, setPlayer] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [payNow, setPayNow] = useState(true);
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const fee = t.entry_fee > 0;
  const save = () => run(async () => {
    setError('');
    try {
      const body = { customer_id: player?.customer_id ?? null, player_name: player ? null : name, phone: player ? null : phone || null, ...(fee && payNow ? { payment: { method, amount: 'FULL' } } : {}) };
      const out = await api(`/gaming/tournaments/${t.tournament_id}/entries`, { method: 'POST', body, idempotencyKey: key.get() });
      key.settle(null);
      onDone(out);
    } catch (e) { key.settle(e); setError(e.message); }
  }, null);
  return (
    <Modal title={`Enter a player in ${t.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!(player || name.trim())}>{fee && payNow ? `Take ${rs(t.entry_fee)} + GST and enter` : 'Enter'}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="player-picker" label="Player"><PlayerPicker value={player} onChange={setPlayer} /></Field>
        {!player && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="te-name" label="Or just a name"><Input id="te-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} /></Field>
            <Field id="te-phone" label="Mobile (optional)"><Input id="te-phone" type="tel" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} /></Field>
          </div>
        )}
        {fee && (
          <>
            <label className="flex items-center gap-2 text-small text-ink-700"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} /> Take the entry fee now</label>
            {payNow && <Field id="te-method" label="Paid by"><Select id="te-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>}
          </>
        )}
      </div>
    </Modal>
  );
};

const ResultsForm = ({ t, onClose, onSaved }) => {
  const entries = t.entries_list.filter((e) => e.status !== 'WITHDRAWN');
  const [rows, setRows] = useState(() => entries.map((e) => ({ entry_id: e.entry_id, name: e.name, placement: e.placement ? String(e.placement) : '', prize: e.prize ? String(e.prize) : '' })));
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (i, k, v) => setRows((x) => x.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  const filled = rows.filter((r) => r.placement !== '');
  const total = filled.reduce((s, r) => s + (Number(r.prize) || 0), 0);
  const save = () => run(async () => {
    setError('');
    try { onSaved(await api(`/gaming/tournaments/${t.tournament_id}/results`, { method: 'POST', body: { results: filled.map((r) => ({ entry_id: r.entry_id, placement: Number(r.placement), prize: Number(r.prize) || 0 })) } })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal wide title={`Results: ${t.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!filled.length}>Save the results and finish</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <p className="text-small text-ink-500">Type each placing and its prize. Leave the rest blank. Prizes so far {rs(total)} of {rs(t.prize_pool)}. This records the prizes; it does not pay them out.</p>
        <ul className="divide-y divide-line">
          {rows.map((r, i) => (
            <li key={r.entry_id} className="flex flex-wrap items-end gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-small font-medium text-ink-900">{r.name}</span>
              <div className="w-24"><NumberField id={`rs-p-${i}`} label={i === 0 ? 'Place' : null} value={r.placement} onChange={(v) => set(i, 'placement', v)} min={1} step={1} /></div>
              <div className="w-32"><NumberField id={`rs-z-${i}`} label={i === 0 ? 'Prize' : null} prefix="₹" value={r.prize} onChange={(v) => set(i, 'prize', v)} /></div>
            </li>
          ))}
        </ul>
      </div>
    </Modal>
  );
};

const PayEntry = ({ entry, onClose, onDone }) => {
  const key = useIdempotencyKey();
  const [method, setMethod] = useState('CASH');
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const save = () => run(async () => {
    setError('');
    try { const out = await api(`/gaming/entries/${entry.entry_id}/pay`, { method: 'POST', body: { payment: { method, amount: 'FULL' } }, idempotencyKey: key.get() }); key.settle(null); onDone(out); } catch (e) { key.settle(e); setError(e.message); }
  }, null);
  return (
    <Modal title={`Take the entry fee from ${entry.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy}>Take payment</Button></>}>
      <div className="space-y-4"><Alert>{error}</Alert><Field id="pe-method" label="Paid by"><Select id="pe-method" value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field></div>
    </Modal>
  );
};

const Detail = ({ id, onChanged }) => {
  const { can } = useAuth();
  const toast = useToast();
  const d = useLoad(`/gaming/tournaments/${id}`);
  const [dialog, setDialog] = useState(null);
  const [payFor, setPayFor] = useState(null);
  const [busy, run] = useAction();
  const t = d.data;
  const desk = can('gaming_desk'); const setup = can('gaming_setup');
  const after = (message) => { setDialog(null); setPayFor(null); toast.success(message); d.reload(); onChanged(); };
  const entryAct = (e, path, ok) => run(async () => { const out = await api(`/gaming/entries/${e.entry_id}/${path}`, { method: 'POST', body: {} }); after(out.refund_hint ? `${ok}. ${out.refund_hint}` : ok); }, null);
  const setStatus = (status) => run(async () => { await api(`/gaming/tournaments/${id}`, { method: 'PUT', body: { status } }); after('Saved'); }, null);

  return (
    <div className="space-y-5">
      <ListState loading={d.loading && !t} error={d.error} />
      {t && (
        <>
          <Panel title={t.name} lead={`${t.game_name ? `${t.game_name} · ` : ''}${dateTimeText(t.starts_at)}`}
                 action={<div className="flex flex-wrap gap-2">{setup && t.status !== 'DONE' && <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>Edit</Button>}{setup && ['OPEN', 'PLANNED'].includes(t.status) && <Button size="sm" variant="secondary" onClick={() => setStatus('RUNNING')}>Start the event</Button>}{setup && ['RUNNING', 'OPEN'].includes(t.status) && <Button size="sm" onClick={() => setDialog('results')}><Trophy aria-hidden="true" className="h-4 w-4" />Results</Button>}</div>}>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-small text-ink-700">
              <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
              <span>Entry {t.entry_fee > 0 ? `${rs(t.entry_fee)} + GST` : 'free'}</span>
              <span>Prize pool {rs(t.prize_pool)}</span>
              <span>{t.entries}{t.max_players ? ` of ${t.max_players}` : ''} in · {t.checked_in} checked in</span>
            </div>
            {t.notes && <p className="mt-2 text-small text-ink-500">{t.notes}</p>}
          </Panel>
          <Panel title="Entries" action={desk && ['OPEN', 'PLANNED'].includes(t.status) && <Button size="sm" onClick={() => setDialog('entry')} disabled={t.max_players && t.entries >= t.max_players}><Plus aria-hidden="true" className="h-4 w-4" />Enter a player</Button>}>
            {t.entries_list.length === 0 ? <p className="text-small text-ink-500">No entries yet.</p> : (
              <ul className="divide-y divide-line">
                {t.entries_list.map((e) => (
                  <li key={e.entry_id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 py-3">
                    <div className="min-w-0">
                      <p className={`text-small font-medium ${e.status === 'WITHDRAWN' ? 'text-ink-400 line-through' : 'text-ink-900'}`}>{e.placement ? `${e.placement}. ` : ''}{e.name}{e.prize > 0 ? <span className="ml-2 text-success">won {rs(e.prize)}</span> : null}</p>
                      <p className="text-caption text-ink-500">{e.phone || 'No mobile'}{t.entry_fee > 0 ? (e.paid ? ` · paid ${e.invoice_number || ''}` : e.status === 'WITHDRAWN' ? '' : ' · not paid') : ''}{e.status === 'CHECKED_IN' ? ' · here' : ''}{e.status === 'WITHDRAWN' ? ' · withdrawn' : ''}</p>
                    </div>
                    {desk && e.status !== 'WITHDRAWN' && t.status !== 'DONE' && (
                      <div className="flex gap-1">
                        {t.entry_fee > 0 && !e.paid && <Button size="sm" variant="secondary" onClick={() => setPayFor(e)}>Take fee</Button>}
                        {e.status === 'REGISTERED' && <Button size="sm" variant="secondary" loading={busy} onClick={() => entryAct(e, 'check-in', 'Checked in')}>Check in</Button>}
                        <Button size="sm" variant="ghost" loading={busy} onClick={() => { if (window.confirm(`Withdraw ${e.name}?`)) entryAct(e, 'withdraw', 'Withdrawn'); }}>Withdraw</Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </>
      )}
      {dialog === 'edit' && t && <TournamentForm t={t} onClose={() => setDialog(null)} onSaved={() => after('Saved')} />}
      {dialog === 'entry' && t && <EntryForm t={t} onClose={() => setDialog(null)} onDone={() => after('Entered')} />}
      {dialog === 'results' && t && <ResultsForm t={t} onClose={() => setDialog(null)} onSaved={() => after('Results saved')} />}
      {payFor && <PayEntry entry={payFor} onClose={() => setPayFor(null)} onDone={() => after('Entry fee taken')} />}
    </div>
  );
};

export default function GamingTournaments() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get('t');
  const list = useLoad('/gaming/tournaments');
  const [creating, setCreating] = useState(false);
  const rows = list.data || [];
  return (
    <div>
      <PageHeader title="Tournaments" lead="A FIFA night or a pool cup: entries, check-in and results." action={can('gaming_setup') && <Button onClick={() => setCreating(true)}><Plus aria-hidden="true" className="h-4 w-4" />New tournament</Button>} />
      <div className="grid gap-5 xl:grid-cols-5">
        <div className={`xl:col-span-2 ${selected ? 'hidden xl:block' : ''}`}>
          <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && !rows.length} emptyLabel="No tournaments yet" emptyBody={can('gaming_setup') ? 'Create one to start taking entries.' : undefined} />
          {rows.length > 0 && (
            <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
              {rows.map((t) => (
                <li key={t.tournament_id}>
                  <button type="button" onClick={() => setParams({ t: t.tournament_id })} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2 ${String(t.tournament_id) === selected ? 'bg-brand-50' : ''}`}>
                    <span className="min-w-0"><span className="block truncate text-small font-medium text-ink-900">{t.name}</span><span className="text-caption text-ink-500">{dateTimeText(t.starts_at)} · {t.entries}{t.max_players ? `/${t.max_players}` : ''} in</span></span>
                    <Badge tone={STATUS[t.status][1]}>{STATUS[t.status][0]}</Badge>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`xl:col-span-3 ${selected ? '' : 'hidden xl:block'}`}>
          {selected ? (
            <>
              <Button size="sm" variant="ghost" className="mb-3 xl:hidden" onClick={() => setParams({})}>Back to the list</Button>
              <Detail key={selected} id={selected} onChanged={list.reload} />
            </>
          ) : <div className="rounded-(--radius-card) border border-dashed border-line p-10 text-center text-small text-ink-500">Choose a tournament to see its entries.</div>}
        </div>
      </div>
      {creating && <TournamentForm onClose={() => setCreating(false)} onSaved={(t) => { setCreating(false); list.reload(); setParams({ t: t.tournament_id }); }} />}
    </div>
  );
}
