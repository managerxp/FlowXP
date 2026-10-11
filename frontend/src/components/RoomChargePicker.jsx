/*
 * "Charge to room" at a hotel's till: pick the in-house guest whose room the bill goes on. The bill is not paid here; it is put on their folio and paid at check-out.
 * `value` is the chosen guest ({ booking_id, label }) or null.
 */
import { useEffect, useState } from 'react';
import { BedDouble } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { Input } from './ui.jsx';

export const roomLabel = (g) => `${g.guest_name} · Room ${g.rooms}`;

const RoomChargePicker = ({ value, onChange }) => {
  const [q, setQ] = useState('');
  const [guests, setGuests] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let live = true;
    const t = setTimeout(() => {
      api(`/hotel/room-charge/guests?q=${encodeURIComponent(q)}`).then((rows) => { if (live) { setGuests(rows); setError(''); } })
        .catch((e) => { if (live) setError(e.message); });
    }, q ? 200 : 0);
    return () => { live = false; clearTimeout(t); };
  }, [q]);

  return (
    <div className="mt-2 rounded-lg border border-line p-2">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Room number or guest name" aria-label="Find an in-house guest" className="!py-1.5" />
      {error && <p className="mt-1 text-caption text-danger">{error}</p>}
      <ul className="mt-1.5 max-h-44 space-y-1 overflow-y-auto" role="radiogroup" aria-label="In-house guests">
        {guests?.map((g) => {
          const on = value?.booking_id === g.booking_id;
          return (
            <li key={g.booking_id}>
              <button type="button" role="radio" aria-checked={on} onClick={() => onChange({ booking_id: g.booking_id, label: roomLabel(g) })}
                      className={`flex w-full items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-left text-small ${on ? 'border-brand-500 bg-brand-50 text-brand-700' : 'border-line-strong text-ink-700 hover:border-ink-400'}`}>
                <span className="flex min-w-0 items-center gap-2"><BedDouble size={14} className="shrink-0" aria-hidden /><span className="truncate font-medium">{g.guest_name}</span></span>
                <span className="tabular shrink-0 text-caption text-ink-500">Room {g.rooms} · owes {formatCurrency(Number(g.balance_paise) / 100)}</span>
              </button>
            </li>
          );
        })}
      </ul>
      {guests && !guests.length && <p className="mt-1 text-caption text-ink-500">{q ? 'No guest in the hotel matches that.' : 'No guest is checked in right now.'}</p>}
    </div>
  );
};

export default RoomChargePicker;
