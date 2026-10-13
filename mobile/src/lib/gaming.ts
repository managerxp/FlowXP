/* The gaming lounge board on a phone: every station with its timer, start, pause, resume, stop, the frame count for pool, and the way to the food and drink tab or the bill.
   The server keeps the time; the clock on a tile only ticks between refreshes and is replaced by the server's figures on each one. Online only: a station is shared by the whole desk. */

export const GAMING_TYPES = ['GAMING_CAFE'];

export type SessionView = {
  session_id: number; status: 'RUNNING' | 'PAUSED' | 'ENDED' | string; elapsed_seconds: number; remaining_seconds: number | null; charge: number; bills_time: boolean; hour_rate: number | null;
  players: number; band: string | null; units: number; unit_label: string | null; unit_price: number; customer_name: string | null; player_name: string | null; game_name: string | null; ended_at: string | null;
};
export type StationTab = { fnb_lines: number; fnb_items: number; fnb_paise: number; total_paise: number; not_sent: number; cooking: number; ready: number };
export type State = 'AVAILABLE' | 'RUNNING' | 'PAUSED' | 'TO_BILL' | 'RESERVED' | 'OUT_OF_SERVICE';
export type Station = {
  station_id: number; name: string; label: string | null; kind: string; max_players: number; status_note: string | null; state: State; session: SessionView | null; tab: StationTab | null; order_id: number | null;
  next_booking: { starts_at: string; guest_name: string | null } | null; alert_minutes?: number;
};
export type Board = { alert_minutes: number; zones: { name: string | null; stations: Station[] }[] };
export type Bundle = { bundle_id: number; name: string; price?: number; minutes?: number; kinds: string[] | null };

export const STATE_LABEL: Record<State, string> = { AVAILABLE: 'Free', RUNNING: 'Playing', PAUSED: 'Paused', TO_BILL: 'To bill', RESERVED: 'Booked soon', OUT_OF_SERVICE: 'Out of service' };
export const KIND_LABEL: Record<string, string> = { CONSOLE: 'Console', VR: 'VR', POOL: 'Pool table', SNOOKER: 'Snooker table', TABLE_GAME: 'Table game', OTHER: 'Other' };
export const ALARMS: { id: string; label: string }[] = [{ id: '', label: 'No alarm' }, { id: '30', label: '30 min' }, { id: '60', label: '1 hour' }, { id: '90', label: '1.5 hours' }, { id: '120', label: '2 hours' }];

/** 3725 -> "1:02:05"; 125 -> "2:05". A negative value (over time) keeps its sign. */
export const clock = (seconds: number): string => {
  const s = Math.abs(Math.round(seconds || 0));
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  const body = h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`;
  return seconds < 0 ? `-${body}` : body;
};
/** "1h 05m" or "42m", for lists. */
export const duration = (seconds: number): string => {
  const m = Math.floor(Math.max(0, seconds || 0) / 60);
  return m >= 60 ? `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m` : `${m}m`;
};

/** `since` is the seconds gone by since the numbers were loaded: only a running session moves. */
export const liveElapsed = (s: Pick<SessionView, 'elapsed_seconds' | 'status'>, since: number): number => (s.elapsed_seconds || 0) + (s.status === 'RUNNING' ? since : 0);
export const liveRemaining = (s: Pick<SessionView, 'remaining_seconds' | 'status'>, since: number): number | null => (s.remaining_seconds == null ? null : s.remaining_seconds - (s.status === 'RUNNING' ? since : 0));
/** What the session has cost so far, extrapolated at the current hourly rate between refreshes (the server works out the real charge when it stops). */
export const liveCharge = (s: Pick<SessionView, 'charge' | 'status' | 'bills_time' | 'hour_rate'>, since: number): number =>
  (s.charge || 0) + (s.status === 'RUNNING' && s.bills_time && s.hour_rate ? (s.hour_rate * since) / 3600 : 0);

/** "Time up" past the booked time, "Ending soon" inside the alarm minutes. */
export const timeWarning = (remaining: number | null, alertMinutes: number): 'over' | 'soon' | null =>
  remaining == null ? null : remaining < 0 ? 'over' : remaining <= alertMinutes * 60 ? 'soon' : null;

export const stations = (b: Board | null | undefined): Station[] => (b?.zones ?? []).flatMap((z) => z.stations.map((s) => ({ ...s, alert_minutes: b?.alert_minutes })));
export const countBy = (list: Station[], state: State): number => list.filter((s) => s.state === state).length;

/* ── starting and stopping ─────────────────────────────────────────────── */

export type How = 'OPEN' | 'FIXED';
export type StartForm = { players: number; how: How; bundleId: number | null; alarm: string };
/** The offers that apply to this kind of station. */
export const offersFor = (bundles: Bundle[], kind: string): Bundle[] => bundles.filter((b) => !b.kinds || b.kinds.includes(kind));
export const startProblem = (st: Pick<Station, 'max_players'>, f: StartForm): string => {
  if (!(f.players >= 1 && f.players <= st.max_players)) return `From 1 to ${st.max_players} players.`;
  if (f.how === 'FIXED' && !f.bundleId) return 'Choose the offer.';
  return '';
};
export const startBody = (st: Pick<Station, 'station_id'>, f: StartForm, override = false) => ({
  station_id: st.station_id, players: f.players, mode: f.how, customer_id: null, game_id: null, note: null,
  ...(override ? { override: true } : {}), ...(f.how === 'FIXED' && f.bundleId ? { bundle_id: f.bundleId } : {}), ...(f.how === 'OPEN' && f.alarm ? { planned_minutes: Number(f.alarm) } : {})
});
export const stopProblem = (voiding: boolean, reason: string): string => (voiding && !reason.trim() ? 'Say why it is being cancelled.' : '');
export const stopBody = (voiding: boolean, reason: string) => (voiding ? { void: true, reason: reason.trim().slice(0, 200) } : {});
