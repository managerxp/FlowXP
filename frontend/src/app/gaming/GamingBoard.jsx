/*
 * The board: every station at a glance, with its timer. A tile shows who is playing and for how long, what it has cost, and what food and drink is on the
 * same tab; the buttons start, pause, stop, move and bill. The server keeps the time. The clock on a tile ticks between refreshes (every 15 seconds and after
 * each action), and each refresh replaces whatever the clock has added.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Gamepad2, Pause, Play, Plus, Settings2, Square, UtensilsCrossed, Undo2, Wrench } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { KIND_LABEL, STATE, clock, duration, liveCharge, liveElapsed, liveRemaining, rs, rsShort, timeText, useSecondsSince, usePolling } from '../../lib/gaming.js';
import { Badge, Button, ListState, PageHeader, StatCard, useToast } from '../../components/ui.jsx';
import { useAction } from '../salon/parts.jsx';
import { ManageDialog, StartDialog, StopDialog } from './SessionDialogs.jsx';

const EDGE = { RUNNING: 'border-brand-300 bg-brand-50/40', PAUSED: 'border-warning/50 bg-warning/5', TO_BILL: 'border-danger/40 bg-danger/5', RESERVED: 'border-warning/40', OUT_OF_SERVICE: 'border-line bg-surface-2', AVAILABLE: 'border-line bg-surface' };

const Tile = ({ st, since, stations, can, onStart, onManage, onStop, onChanged, navigate }) => {
  const [busy, run] = useAction();
  const s = st.session;
  const live = st.state === 'RUNNING' || st.state === 'PAUSED';
  const elapsed = s ? liveElapsed(s, since) : 0;
  const remaining = s && live ? liveRemaining(s, since) : null;
  const over = remaining != null && remaining < 0;
  const ending = remaining != null && remaining >= 0 && remaining <= (st.alert_minutes ?? 5) * 60;
  const act = (path, body, ok) => run(async () => { const out = await api(`/gaming/sessions/${s.session_id}/${path}`, { method: 'POST', body }); onChanged(); return out; }, ok);
  const food = st.tab && st.tab.fnb_lines > 0 ? st.tab : null;
  const desk = can('gaming_desk');
  const toOrder = () => navigate(`/app/orders?order=${st.order_id}`);

  return (
    <article className={`flex flex-col rounded-(--radius-card) border p-4 transition-colors ${EDGE[st.state] || EDGE.AVAILABLE} ${over ? 'ring-2 ring-danger/60' : ending ? 'ring-2 ring-warning/60' : ''}`} aria-label={`${st.name}, ${STATE[st.state]?.label}`}>
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-body font-semibold text-ink-900">{st.name}</h3>
          <p className="truncate text-caption text-ink-500">{st.label || KIND_LABEL[st.kind]}{st.label ? ` · ${KIND_LABEL[st.kind]}` : ''}</p>
        </div>
        <Badge tone={STATE[st.state]?.tone}>{over ? 'Time up' : ending ? 'Ending soon' : STATE[st.state]?.label}</Badge>
      </header>

      {live && s && (
        <div className="mt-3">
          {remaining != null ? (
            <>
              <p className={`tabular text-[32px] font-semibold leading-none ${over ? 'text-danger' : ending ? 'text-warning' : 'text-ink-900'}`} aria-label={over ? 'Over time' : 'Time left'}>{clock(remaining)}</p>
              <p className="mt-1 text-caption text-ink-500">{over ? 'over the booked time' : 'left'} · played {duration(elapsed)}</p>
            </>
          ) : (
            <>
              <p className="tabular text-[32px] font-semibold leading-none text-ink-900" aria-label="Time played">{clock(elapsed)}</p>
              <p className="mt-1 text-caption text-ink-500">played{s.status === 'PAUSED' ? ' (paused)' : ''}</p>
            </>
          )}
          <p className="mt-2 text-small text-ink-700">
            {s.bills_time ? <>{s.players} player{s.players === 1 ? '' : 's'} · {rsShort(s.hour_rate)}/hr{s.band ? ` · ${s.band}` : ''} · </> : null}
            <span className="tabular font-medium">{rs(liveCharge(s, since))}</span> so far
          </p>
          {s.customer_name || s.player_name ? <p className="mt-0.5 truncate text-caption text-ink-500">{s.customer_name || s.player_name}{s.game_name ? ` · ${s.game_name}` : ''}</p> : s.game_name ? <p className="mt-0.5 text-caption text-ink-500">{s.game_name}</p> : null}
          {s.unit_price > 0 && (
            <div className="mt-2 flex items-center gap-2">
              <span className="text-small text-ink-700">{s.unit_label ? `${s.unit_label[0].toUpperCase()}${s.unit_label.slice(1)}s` : 'Frames'}: <span className="tabular font-semibold">{s.units}</span></span>
              {desk && <Button size="sm" variant="secondary" loading={busy} onClick={() => act('units', { delta: 1 })} aria-label={`Add a ${s.unit_label || 'frame'}`}><Plus aria-hidden="true" className="h-4 w-4" />1</Button>}
              {desk && s.units > 0 && <Button size="sm" variant="ghost" loading={busy} onClick={() => act('units', { delta: -1 })} aria-label={`Take off a ${s.unit_label || 'frame'}`}>−1</Button>}
            </div>
          )}
        </div>
      )}

      {st.state === 'TO_BILL' && s && (
        <div className="mt-3">
          <p className="text-caption text-ink-500">Played {duration(s.elapsed_seconds)}, stopped {timeText(s.ended_at)}</p>
          <p className="tabular mt-1 text-[28px] font-semibold leading-none text-ink-900">{rs((st.tab?.total_paise || 0) / 100)}</p>
          <p className="mt-1 text-caption text-ink-500">to collect, with GST{food ? ` · includes ${rs(food.fnb_paise / 100)} food and drink` : ''}</p>
        </div>
      )}

      {st.state === 'AVAILABLE' && <p className="mt-3 text-small text-ink-500">{st.max_players} player{st.max_players === 1 ? '' : 's'} at most</p>}
      {st.state === 'RESERVED' && st.next_booking && <p className="mt-3 text-small text-ink-700">Booked at {timeText(st.next_booking.starts_at)}{st.next_booking.guest_name ? ` for ${st.next_booking.guest_name}` : ''}</p>}
      {st.state === 'OUT_OF_SERVICE' && <p className="mt-3 flex items-center gap-1.5 text-small text-ink-500"><Wrench aria-hidden="true" className="h-4 w-4" />{st.status_note || 'Not in use'}</p>}

      {food && live && (
        <p className="mt-3 flex flex-wrap items-center gap-x-2 rounded-(--radius-control) bg-surface px-2.5 py-1.5 text-caption text-ink-700">
          <UtensilsCrossed aria-hidden="true" className="h-3.5 w-3.5 text-ink-400" />
          <span className="tabular font-medium">{rs(food.fnb_paise / 100)}</span> food and drink · {food.fnb_items} item{food.fnb_items === 1 ? '' : 's'}
          {food.not_sent > 0 && <span className="text-warning">{food.not_sent} not sent</span>}
          {food.cooking > 0 && <span>{food.cooking} cooking</span>}
          {food.ready > 0 && <span className="font-medium text-success">{food.ready} ready</span>}
        </p>
      )}

      <footer className="mt-auto flex flex-wrap items-center gap-2 pt-4">
        {desk && st.state === 'AVAILABLE' && <Button size="sm" onClick={() => onStart(st)}><Play aria-hidden="true" className="h-4 w-4" />Start</Button>}
        {desk && live && (
          <>
            {st.state === 'RUNNING'
              ? <Button size="sm" variant="secondary" loading={busy} onClick={() => act('pause', {})}><Pause aria-hidden="true" className="h-4 w-4" />Pause</Button>
              : <Button size="sm" loading={busy} onClick={() => act('resume', {})}><Play aria-hidden="true" className="h-4 w-4" />Resume</Button>}
            <Button size="sm" variant="secondary" onClick={() => onStop(st)}><Square aria-hidden="true" className="h-4 w-4" />Stop</Button>
            <Button size="sm" variant="ghost" onClick={() => onManage(st)} aria-label={`Manage ${st.name}`}><Settings2 aria-hidden="true" className="h-4 w-4" />Manage</Button>
          </>
        )}
        {st.state === 'TO_BILL' && (
          <>
            <Button size="sm" onClick={toOrder}>Take payment</Button>
            {desk && <Button size="sm" variant="ghost" loading={busy} onClick={() => act('reopen', {}, 'Timer running again')}><Undo2 aria-hidden="true" className="h-4 w-4" />Undo stop</Button>}
          </>
        )}
        {st.order_id && st.state !== 'TO_BILL' && (live || st.state === 'AVAILABLE') && <Button size="sm" variant="ghost" onClick={toOrder}><UtensilsCrossed aria-hidden="true" className="h-4 w-4" />{live ? 'Food & drink' : 'Open tab'}</Button>}
      </footer>
    </article>
  );
};

export default function GamingBoard() {
  const { can } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const [state, setState] = useState({ data: null, error: '', loading: true, at: 0 });
  const seq = useRef(0);
  const [starting, setStarting] = useState(null);
  const [managing, setManaging] = useState(null);
  const [stopping, setStopping] = useState(null);
  const [stopped, setStopped] = useState(null);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const data = await api('/gaming/board');
      if (mine === seq.current) setState({ data, error: '', loading: false, at: Date.now() });
    } catch (error) {
      if (mine === seq.current) setState((s) => ({ ...s, error: error.message, loading: false }));
    }
  }, []);
  useEffect(() => { load(); }, [load]);
  usePolling(load, 15000);
  const since = useSecondsSince(state.at);

  const stations = useMemo(() => (state.data?.zones || []).flatMap((z) => z.stations.map((s) => ({ ...s, alert_minutes: state.data.alert_minutes }))), [state.data]);
  const count = (k) => stations.filter((s) => s.state === k).length;
  const stopFor = stopping && stations.find((s) => s.station_id === stopping.station_id);

  return (
    <div>
      <PageHeader title="Board" lead="Every station, its timer and its tab. Food and drink ordered for a station is on the same bill as its time."
        action={can('gaming_setup') && <Button variant="secondary" to="/app/gaming/setup"><Settings2 aria-hidden="true" className="h-4 w-4" />Stations and rates</Button>} />
      <ListState loading={state.loading && !state.data} error={state.error}
                 empty={state.data && stations.length === 0} emptyLabel="No stations yet" emptyIcon={Gamepad2}
                 emptyBody={can('gaming_setup') ? 'Add your PS5s, rooms and tables, then set what time costs.' : 'Ask the owner to add the stations.'}
                 emptyAction={can('gaming_setup') ? <Button to="/app/gaming/setup">Add stations</Button> : null} />
      {stations.length > 0 && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Free" value={count('AVAILABLE')} tone="success" />
            <StatCard label="Playing" value={count('RUNNING') + count('PAUSED')} tone="brand" />
            <StatCard label="To bill" value={count('TO_BILL')} tone={count('TO_BILL') ? 'danger' : undefined} />
            <StatCard label="Out of service" value={count('OUT_OF_SERVICE')} />
          </div>
          {state.data.zones.map((z) => (
            <section key={z.zone_id ?? 'none'} aria-label={z.name}>
              <h2 className="mb-3 text-body font-semibold text-ink-900">{z.name}<span className="ml-2 text-small font-normal text-ink-400">{z.stations.length}</span></h2>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                {z.stations.map((st) => (
                  <Tile key={st.station_id} st={{ ...st, alert_minutes: state.data.alert_minutes }} since={since} stations={stations} can={can}
                        onStart={setStarting} onManage={setManaging} onStop={setStopping} onChanged={load} navigate={navigate} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}

      {starting && <StartDialog station={starting} onClose={() => setStarting(null)} onStarted={() => { setStarting(null); toast.success('Timer started'); load(); }} />}
      {managing && managing.session && <ManageDialog session={managing.session} station={managing} stations={stations} onClose={() => setManaging(null)} onChanged={load} />}
      {stopping && stopFor?.session && (
        <StopDialog session={stopFor.session} station={stopFor} charge={liveCharge(stopFor.session, since)} elapsed={liveElapsed(stopFor.session, since)}
                    onClose={() => setStopping(null)} onStopped={(s) => { setStopping(null); load(); if (s.status === 'CANCELLED') toast.success('Session cancelled'); else setStopped({ ...s, station: stopFor }); }} />
      )}
      {stopped && (
        <div className="fixed inset-x-4 bottom-4 z-40 mx-auto max-w-md rounded-(--radius-card) border border-line bg-surface p-4 shadow-lg" role="status">
          <p className="text-small text-ink-500">{stopped.station.name} stopped after {duration(stopped.elapsed_seconds)}</p>
          <p className="tabular mt-0.5 text-title font-semibold text-ink-900">{rs(stopped.charge)} <span className="text-small font-normal text-ink-500">for the time, before GST</span></p>
          <div className="mt-3 flex gap-2">
            {stopped.tab_closed ? <Button size="sm" variant="secondary" onClick={() => setStopped(null)}>Done, nothing to pay</Button> : <><Button size="sm" onClick={() => navigate(`/app/orders?order=${stopped.order_id}`)}>Take payment</Button><Button size="sm" variant="secondary" onClick={() => setStopped(null)}>Later</Button></>}
          </div>
        </div>
      )}
    </div>
  );
}
