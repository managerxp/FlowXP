/* The dialogs on the board: starting a session, managing a running one (players, time, move, details), stopping, and picking a player. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, Search, UserPlus, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { KIND_LABEL, duration, rs, useDebounced, useLoad } from '../../lib/gaming.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Alert, Button, Field, Input, Modal, Select, Textarea } from '../../components/ui.jsx';
import { Segmented, Tabs, useAction } from '../salon/parts.jsx';

/* A number with plus and minus, for players. */
export const Stepper = ({ value, onChange, min = 1, max = 20, label }) => (
  <div className="inline-flex items-center gap-1" role="group" aria-label={label}>
    <Button type="button" variant="secondary" size="sm" aria-label={`Fewer ${label || ''}`} disabled={value <= min} onClick={() => onChange(value - 1)}><Minus aria-hidden="true" className="h-4 w-4" /></Button>
    <span className="tabular w-10 text-center text-body font-semibold" aria-live="polite">{value}</span>
    <Button type="button" variant="secondary" size="sm" aria-label={`More ${label || ''}`} disabled={value >= max} onClick={() => onChange(value + 1)}><Plus aria-hidden="true" className="h-4 w-4" /></Button>
  </div>
);

/** Find a player by name, mobile or gamer tag, or add one in two fields. `value` is { customer_id, name, phone } or null. */
export const PlayerPicker = ({ value, onChange, id = 'player-picker' }) => {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 200);
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState({ name: '', phone: '' });
  const [busy, run] = useAction();
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    if (!term) { setMatches([]); return undefined; }
    api(`/gaming/players?search=${encodeURIComponent(term)}&limit=6`).then((rows) => { if (live) setMatches(rows); }).catch(() => {});
    return () => { live = false; };
  }, [term]);
  useEffect(() => {
    const away = (e) => { if (box.current && !box.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, []);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-(--radius-control) border border-line bg-surface-2 px-3 py-2">
        <div className="min-w-0"><p className="truncate text-small font-medium text-ink-900">{value.name}</p>{value.phone && <p className="text-caption text-ink-500">{value.phone}</p>}</div>
        <Button type="button" variant="ghost" size="sm" aria-label="Remove player" onClick={() => onChange(null)}><X aria-hidden="true" className="h-4 w-4" /></Button>
      </div>
    );
  }
  const add = () => run(async () => {
    const made = await api('/gaming/players', { method: 'POST', body: { name: draft.name, phone: draft.phone || null } });
    onChange({ customer_id: made.customer_id, name: made.name, phone: made.phone });
    setAdding(false);
  }, null);
  return (
    <div ref={box} className="relative">
      <div className="relative">
        <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
        <Input id={id} className="pl-9" value={q} placeholder="Name or mobile (leave blank for a walk-in)" autoComplete="off" onFocus={() => setOpen(true)} onChange={(e) => { setQ(e.target.value); setOpen(true); }} />
      </div>
      {open && term && (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-auto rounded-(--radius-card) border border-line bg-surface shadow-lg">
          {matches.map((m) => (
            <li key={m.customer_id}>
              <button type="button" className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-2" onClick={() => { onChange({ customer_id: m.customer_id, name: m.name, phone: m.phone }); setOpen(false); setQ(''); }}>
                <span className="min-w-0"><span className="block truncate text-small font-medium text-ink-900">{m.name}{m.gamer_tag ? ` · ${m.gamer_tag}` : ''}</span><span className="text-caption text-ink-500">{m.phone || 'No mobile'}</span></span>
                {m.wallet > 0 && <span className="tabular text-caption text-success">{rs(m.wallet)}</span>}
              </button>
            </li>
          ))}
          <li><button type="button" className="flex w-full items-center gap-2 border-t border-line px-3 py-2 text-left text-small font-medium text-brand-700 hover:bg-surface-2" onClick={() => { setAdding(true); setDraft({ name: /^[\d\s+-]{5,}$/.test(term) ? '' : term, phone: /^[\d\s+-]{5,}$/.test(term) ? term : '' }); setOpen(false); }}><UserPlus aria-hidden="true" className="h-4 w-4" />Add “{term}” as a new player</button></li>
        </ul>
      )}
      {adding && (
        <Modal title="Add a player" onClose={() => setAdding(false)} footer={<><Button variant="secondary" onClick={() => setAdding(false)}>Cancel</Button><Button onClick={add} loading={busy} disabled={!draft.name.trim()}>Add player</Button></>}>
          <div className="space-y-4">
            <Field id="np-name" label="Name"><Input id="np-name" value={draft.name} onChange={(e) => setDraft((d) => ({ ...d, name: e.target.value }))} autoFocus /></Field>
            <Field id="np-phone" label="Mobile" hint="How you find them next time"><Input id="np-phone" type="tel" inputMode="tel" value={draft.phone} onChange={(e) => setDraft((d) => ({ ...d, phone: e.target.value }))} /></Field>
          </div>
        </Modal>
      )}
    </div>
  );
};

const ALARMS = [['', 'No alarm'], ['30', '30 minutes'], ['60', '1 hour'], ['90', '1.5 hours'], ['120', '2 hours'], ['180', '3 hours']];

export const StartDialog = ({ station, onClose, onStarted }) => {
  const bundles = useLoad('/gaming/bundles?kind=SESSION');
  const games = useLoad('/gaming/games');
  const key = useIdempotencyKey();
  const [busy, run] = useAction();
  const { hasFeature } = useAuth();
  const [f, setF] = useState({ players: 1, how: 'OPEN', bundle_id: '', pack_id: '', alarm: '', game_id: '', note: '' });
  const [player, setPlayer] = useState(null);
  const packsOn = hasFeature('gaming_wallet');
  const passes = useLoad(packsOn && player ? `/gaming/players/${player.customer_id}/passes` : null);
  const usable = (passes.data || []).filter((x) => x.usable && (!x.kinds || x.kinds.includes(station.kind)));
  const [error, setError] = useState('');
  const [held, setHeld] = useState(false);   // the station is booked: say so, and let a person start it anyway
  const mine = useMemo(() => (bundles.data || []).filter((b) => !b.kinds || b.kinds.includes(station.kind)), [bundles.data, station.kind]);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const chosen = mine.find((b) => String(b.bundle_id) === String(f.bundle_id));
  const ready = f.how === 'OPEN' || (f.how === 'FIXED' && Boolean(chosen)) || (f.how === 'PACK' && Boolean(f.pack_id));

  const start = (override = false) => run(async () => {
    setError(''); setHeld(false);
    try {
      const body = { override: override || undefined, station_id: station.station_id, players: f.players, mode: f.how, customer_id: player?.customer_id ?? null, game_id: f.game_id || null, note: f.note || null };
      if (f.how === 'FIXED') body.bundle_id = Number(f.bundle_id);
      else if (f.how === 'PACK') body.pack_id = Number(f.pack_id);
      else if (f.alarm) body.planned_minutes = Number(f.alarm);
      const s = await api('/gaming/sessions', { method: 'POST', body, idempotencyKey: key.get() });
      key.settle(null);
      onStarted(s);
    } catch (e) { key.settle(e); setError(e.message); setHeld(e.code === 'BOOKED'); }
  }, null);

  return (
    <Modal title={`Start ${station.name}`} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button>{held ? <Button variant="danger" onClick={() => start(true)} loading={busy}>Start anyway</Button> : <Button onClick={() => start(false)} loading={busy} disabled={!ready}>Start timer</Button>}</>}>
      <div className="space-y-5">
        <Alert>{error}</Alert>
        <p className="text-small text-ink-500">{KIND_LABEL[station.kind]}{station.label ? ` · ${station.label}` : ''} · up to {station.max_players} players</p>
        <Field id="sd-players" label="How many are playing?"><Stepper value={f.players} onChange={set('players')} max={station.max_players} label="players" /></Field>
        <Field id="sd-how" label="How are they paying?">
          <Segmented label="Pay" value={f.how} onChange={set('how')} options={[{ value: 'OPEN', label: 'Pay for time used' }, { value: 'FIXED', label: 'An offer' }, ...(packsOn ? [{ value: 'PACK', label: 'An hour pack' }] : [])]} />
        </Field>
        {f.how === 'PACK' ? (
          <Field id="sd-pack" label="Pack" hint={!player ? 'Choose the player below first' : usable.length ? null : 'This player has no pack that works on this station.'}>
            <Select id="sd-pack" value={f.pack_id} disabled={!player} onChange={(e) => set('pack_id')(e.target.value)}><option value="">Choose a pack</option>{usable.map((x) => <option key={x.pass_id} value={x.pass_id}>{x.name}: {duration(x.minutes_left * 60)} left{x.expires_on ? `, until ${x.expires_on}` : ''}</option>)}</Select>
          </Field>
        ) : f.how === 'FIXED' ? (
          <Field id="sd-bundle" label="Offer" hint={mine.length ? null : 'No offer fits this station. Add one under Rates and offers.'}>
            <Select id="sd-bundle" value={f.bundle_id} onChange={(e) => set('bundle_id')(e.target.value)}>
              <option value="">Choose an offer</option>
              {mine.map((b) => <option key={b.bundle_id} value={b.bundle_id}>{b.name}: {duration(b.minutes * 60)} for {rs(b.price)}{b.players > 1 ? ` (${b.players} players)` : ''}</option>)}
            </Select>
          </Field>
        ) : (
          <Field id="sd-alarm" label="Alarm" hint="Optional. The board warns before this time is up; it does not stop anything."><Select id="sd-alarm" value={f.alarm} onChange={(e) => set('alarm')(e.target.value)}>{ALARMS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        )}
        <Field id="player-picker" label="Player (optional)"><PlayerPicker value={player} onChange={setPlayer} /></Field>
        {(games.data || []).length > 0 && (
          <Field id="sd-game" label="Game (optional)"><Select id="sd-game" value={f.game_id} onChange={(e) => set('game_id')(e.target.value)}><option value="">Not noted</option>{games.data.map((g) => <option key={g.game_id} value={g.game_id}>{g.name}</option>)}</Select></Field>
        )}
        <Field id="sd-note" label="Note (optional)"><Input id="sd-note" value={f.note} onChange={(e) => set('note')(e.target.value)} maxLength={200} /></Field>
      </div>
    </Modal>
  );
};

/* Everything you change while it runs: players, time, moving it, and who or what it is for. */
export const ManageDialog = ({ session, station, stations, onClose, onChanged }) => {
  const [tab, setTab] = useState('players');
  const [busy, run] = useAction();
  const [players, setPlayers] = useState(session.players);
  const [minutes, setMinutes] = useState('30');
  const [bundleId, setBundleId] = useState('');
  const [moveTo, setMoveTo] = useState('');
  const [note, setNote] = useState(session.note || '');
  const [gameId, setGameId] = useState(session.game_id ? String(session.game_id) : '');
  const [player, setPlayer] = useState(session.customer_id ? { customer_id: session.customer_id, name: session.customer_name } : null);
  const bundles = useLoad(session.mode === 'FIXED' ? '/gaming/bundles?kind=SESSION' : null);
  const games = useLoad('/gaming/games');
  const free = (stations || []).filter((s) => s.state === 'AVAILABLE' && s.station_id !== station.station_id && s.branch_id === station.branch_id);
  const post = (path, body, ok) => run(async () => { const s = await api(`/gaming/sessions/${session.session_id}${path}`, { method: path ? 'POST' : 'PUT', body }); onChanged(s); onClose(); return s; }, ok);

  return (
    <Modal title={`${station.name}: manage`} onClose={onClose}>
      <Tabs value={tab} onChange={setTab} tabs={[{ key: 'players', label: 'Players' }, { key: 'time', label: 'Time' }, { key: 'move', label: 'Move' }, { key: 'details', label: 'Details' }]} />
      {tab === 'players' && (
        <div className="space-y-4">
          <p className="text-small text-ink-500">The time so far is priced for the old number; from now on, for the new one.</p>
          <Stepper value={players} onChange={setPlayers} max={station.max_players} label="players" />
          <Button onClick={() => post('/players', { players }, 'Players changed')} loading={busy} disabled={players === session.players}>Change to {players}</Button>
        </div>
      )}
      {tab === 'time' && (session.mode === 'FIXED' ? (
        <div className="space-y-4">
          <p className="text-small text-ink-500">Add another offer. Its time is added and its price is added to the bill.</p>
          <Field id="md-bundle" label="Offer to add"><Select id="md-bundle" value={bundleId} onChange={(e) => setBundleId(e.target.value)}><option value="">Choose an offer</option>{(bundles.data || []).filter((b) => !b.kinds || b.kinds.includes(station.kind)).map((b) => <option key={b.bundle_id} value={b.bundle_id}>{b.name}: {duration(b.minutes * 60)} for {rs(b.price)}</option>)}</Select></Field>
          <Button onClick={() => post('/extend', { bundle_id: Number(bundleId) }, 'Time added')} loading={busy} disabled={!bundleId}>Add this offer</Button>
        </div>
      ) : (
        <div className="space-y-4">
          <p className="text-small text-ink-500">Move the alarm out. The time is still billed as it is used.</p>
          <Field id="md-min" label="Add minutes"><Select id="md-min" value={minutes} onChange={(e) => setMinutes(e.target.value)}>{['15', '30', '60', '90', '120'].map((m) => <option key={m} value={m}>{m} minutes</option>)}</Select></Field>
          <Button onClick={() => post('/extend', { minutes: Number(minutes) }, 'Alarm moved')} loading={busy}>Add {minutes} minutes</Button>
        </div>
      ))}
      {tab === 'move' && (
        <div className="space-y-4">
          <p className="text-small text-ink-500">The session and its food and drink move together. Time already played is priced at this station; the rest at the new one.</p>
          {free.length ? (
            <Field id="md-move" label="Move to"><Select id="md-move" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}><option value="">Choose a free station</option>{free.map((s) => <option key={s.station_id} value={s.station_id}>{s.name} ({KIND_LABEL[s.kind]})</option>)}</Select></Field>
          ) : <p className="rounded-(--radius-control) bg-surface-2 px-3.5 py-2.5 text-small text-ink-500">No other station is free right now.</p>}
          <Button onClick={() => post('/transfer', { station_id: Number(moveTo) }, 'Moved')} loading={busy} disabled={!moveTo}>Move</Button>
        </div>
      )}
      {tab === 'details' && (
        <div className="space-y-4">
          <Field id="player-picker" label="Player"><PlayerPicker value={player} onChange={setPlayer} /></Field>
          {(games.data || []).length > 0 && <Field id="md-game" label="Game"><Select id="md-game" value={gameId} onChange={(e) => setGameId(e.target.value)}><option value="">Not noted</option>{games.data.map((g) => <option key={g.game_id} value={g.game_id}>{g.name}</option>)}</Select></Field>}
          <Field id="md-note" label="Note"><Textarea id="md-note" rows={2} value={note} maxLength={200} onChange={(e) => setNote(e.target.value)} /></Field>
          <Button onClick={() => post('', { note, game_id: gameId || null, customer_id: player?.customer_id ?? null }, 'Saved')} loading={busy}>Save</Button>
        </div>
      )}
    </Modal>
  );
};

/* Stop and bill, or call the whole thing off. */
export const StopDialog = ({ session, station, charge, elapsed, onClose, onStopped }) => {
  const key = useIdempotencyKey();
  const [busy, run] = useAction();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const stop = () => run(async () => {
    setError('');
    try {
      const s = await api(`/gaming/sessions/${session.session_id}/stop`, { method: 'POST', body: voiding ? { void: true, reason } : {}, idempotencyKey: key.get() });
      key.settle(null);
      onStopped(s);
    } catch (e) { key.settle(e); setError(e.message); }
  }, null);
  return (
    <Modal title={voiding ? `Cancel ${station.name}` : `Stop ${station.name}`} onClose={onClose}
           footer={<><Button variant="secondary" onClick={onClose}>Not yet</Button><Button variant={voiding ? 'danger' : 'primary'} onClick={stop} loading={busy} disabled={voiding && !reason.trim()}>{voiding ? 'Cancel the session' : 'Stop the timer'}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        {voiding ? (
          <>
            <p className="text-small text-ink-500">Use this when a session was started by mistake. Nothing is charged and nothing goes on the bill. It is kept on record with your reason.</p>
            <Field id="st-reason" label="Reason"><Input id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} autoFocus /></Field>
          </>
        ) : (
          <>
            <dl className="grid grid-cols-2 gap-3 rounded-(--radius-card) bg-surface-2 p-4 text-small">
              <div><dt className="text-ink-500">Time played</dt><dd className="tabular text-h3 font-semibold text-ink-900">{duration(elapsed)}</dd></div>
              <div><dt className="text-ink-500">Charge so far</dt><dd className="tabular text-h3 font-semibold text-ink-900">{rs(charge)}</dd></div>
            </dl>
            <p className="text-small text-ink-500">The time goes onto the station&apos;s bill with any food and drink. You take payment next. The exact charge is worked out when you stop.</p>
          </>
        )}
        <button type="button" className="text-small font-medium text-brand-700 hover:underline" onClick={() => setVoiding((v) => !v)}>{voiding ? 'Stop and bill instead' : 'Started by mistake? Cancel it with no charge'}</button>
      </div>
    </Modal>
  );
};
