/*
 * "Type a PIN, get the address" — India only, since that's the one country
 * FlowXP has a real postal dataset for (see backend/src/modules/geo/pincode.js;
 * everywhere else the postal code field just stays a plain input). Debounced,
 * and purely a suggestion: it never overwrites what someone typed by itself —
 * they tap "Use this" or ignore it, so a half-finished address is never
 * silently replaced mid-edit.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Loader2 } from 'lucide-react';
import { api } from '../lib/api.js';

const DEBOUNCE_MS = 400;

const PincodeHint = ({ postalCode, country, onApply }) => {
  const [state, setState] = useState({ status: 'idle', result: null });
  const timer = useRef(null);
  const lastApplied = useRef(null);

  useEffect(() => {
    clearTimeout(timer.current);
    const code = String(postalCode || '').trim();
    if (country !== 'India' || !/^[1-9]\d{5}$/.test(code)) { setState({ status: 'idle', result: null }); return; }
    if (code === lastApplied.current) return;   // just applied this one — don't re-offer it

    setState({ status: 'loading', result: null });
    timer.current = setTimeout(() => {
      api(`/locations/pincode/${code}`)
        .then((data) => setState({ status: 'found', result: data }))
        .catch(() => setState({ status: 'not-found', result: null }));
    }, DEBOUNCE_MS);
    return () => clearTimeout(timer.current);
  }, [postalCode, country]);

  if (state.status === 'idle') return null;

  if (state.status === 'loading') {
    return <p className="mt-1.5 flex items-center gap-1.5 text-caption text-ink-500"><Loader2 aria-hidden="true" className="h-3.5 w-3.5 animate-spin" />Looking up the PIN code…</p>;
  }
  if (state.status === 'not-found') {
    return <p className="mt-1.5 text-caption text-warning">That PIN code was not found. Enter the address by hand.</p>;
  }
  const { city, state: st } = state.result;
  return (
    <button type="button" onClick={() => { lastApplied.current = String(postalCode).trim(); onApply(state.result); }}
            className="mt-1.5 flex items-center gap-1.5 text-caption font-medium text-brand-600 hover:text-brand-700">
      <Check aria-hidden="true" className="h-3.5 w-3.5" />{city}, {st} — use this
    </button>
  );
};

export default PincodeHint;
