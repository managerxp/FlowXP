/*
 * "Find your shop on Google": type the shop name, pick the listing, and the address, city, state, PIN and map pin fill in.
 * The owner still reviews and edits everything. Hidden when the server has no Places key, and the manual form always works.
 */
import { useEffect, useState } from 'react';
import { Search, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';
import { Input } from './ui.jsx';

const PlaceSearch = ({ onPick, near }) => {
  const [q, setQ] = useState('');
  const [list, setList] = useState([]);
  const [available, setAvailable] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const text = q.trim();
    if (text.length < 3) { setList([]); setNote(''); return undefined; }
    const timer = setTimeout(() => {
      setBusy(true);
      const where = near ? `&lat=${near.lat}&lon=${near.lon}` : '';
      api(`/businesses/places?q=${encodeURIComponent(text)}${where}`)
        .then((r) => { setAvailable(r.available !== false); setList(r.places || []); setNote(r.available !== false && !(r.places || []).length ? 'No shop found. Type the address below instead.' : ''); })
        .catch((e) => { setList([]); setNote(e.message || 'Shop search is not available right now.'); })
        .finally(() => setBusy(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!available) return null;
  return (
    <div className="relative">
      <label htmlFor="place-search" className="mb-1 block text-sm font-medium text-ink-700">Find your shop on Google <span className="font-normal text-ink-500">(optional)</span></label>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-500" aria-hidden />
        <Input id="place-search" className="pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Shop name and area, e.g. Sharma Salon Indiranagar" autoComplete="off" />
        {busy && <Loader2 className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-ink-500" aria-hidden />}
      </div>
      {note && <p className="mt-1 text-caption text-ink-500">{note}</p>}
      {list.length > 0 && (
        <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border border-line bg-surface shadow-lg">
          {list.map((p) => (
            <li key={p.place_id}>
              <button type="button" className="block w-full px-3 py-2 text-left hover:bg-surface-2" onClick={() => { onPick(p); setQ(''); setList([]); }}>
                <span className="block text-sm font-medium text-ink-900">{p.name}</span>
                <span className="block text-caption text-ink-500">{p.formatted}</span>
              </button>
            </li>))}
        </ul>
      )}
    </div>
  );
};

export default PlaceSearch;
