/*
 * Choosing a client at the till or when booking: type a few letters of the name or the end of the mobile number,
 * pick from the matches, or add a new client in two fields without leaving the screen.
 */
import { useEffect, useRef, useState } from 'react';
import { Crown, Plus, Search, X } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useDebounced } from '../../lib/salon.js';
import { Alert, Button, Field, Input, Modal, useToast } from '../../components/ui.jsx';

export const QuickClientModal = ({ initialName = '', onSaved, onClose }) => {
  const toast = useToast();
  const isPhone = /^[\d\s+-]{5,}$/.test(initialName);
  const [form, setForm] = useState({ name: isPhone ? '' : initialName, phone: isPhone ? initialName : '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError('');
    try {
      const made = await api('/salon/clients', { method: 'POST', body: { name: form.name, phone: form.phone || null } });
      toast.success(`${made.name} added`);
      onSaved(made);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };
  return (
    <Modal title="Add a client" onClose={onClose}>
      <form onSubmit={submit} className="space-y-4">
        <Alert>{error}</Alert>
        <Field id="qc-name" label="Name"><Input id="qc-name" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required autoFocus /></Field>
        <Field id="qc-phone" label="Mobile" hint="How you will find them next time"><Input id="qc-phone" type="tel" inputMode="tel" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></Field>
        <div className="flex justify-end gap-2 border-t border-line pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>Add client</Button>
        </div>
      </form>
    </Modal>
  );
};

/** `value` is { customer_id, name, phone } or null. `onChange` gets the same shape. */
const ClientPicker = ({ value, onChange, inputRef, placeholder = 'Find a client by name or mobile', allowNone = true, id = 'client-picker' }) => {
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 200);
  const [matches, setMatches] = useState([]);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const box = useRef(null);

  useEffect(() => {
    let live = true;
    if (term.length < 2) { setMatches([]); return undefined; }
    api(`/salon/clients/lookup?q=${encodeURIComponent(term)}`).then((rows) => { if (live) setMatches(rows); }).catch(() => { if (live) setMatches([]); });
    return () => { live = false; };
  }, [term]);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const pick = (c) => { onChange({ customer_id: c.customer_id, name: c.name, phone: c.phone, allergies: c.allergies, membership: c.membership, points: c.points }); setQ(''); setOpen(false); };

  if (value) {
    return (
      <div className="flex items-center gap-3 rounded-(--radius-control) border border-line bg-surface-2 px-3 py-2">
        <span aria-hidden="true" className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-caption font-semibold text-brand-700">{String(value.name).slice(0, 1).toUpperCase()}</span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-small font-semibold text-ink-900">{value.name}</span>
          <span className="block truncate text-caption text-ink-500">{[value.phone, value.membership && `${value.membership} member`].filter(Boolean).join(' · ') || 'No mobile on file'}</span>
        </span>
        {value.membership && <Crown aria-hidden="true" className="h-4 w-4 text-warning" />}
        {allowNone && <button type="button" onClick={() => onChange(null)} aria-label="Remove client" className="rounded-lg p-1.5 text-ink-400 hover:bg-surface hover:text-ink-900"><X className="h-4 w-4" /></button>}
      </div>
    );
  }

  return (
    <div className="relative" ref={box}>
      <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
      <Input id={id} ref={inputRef} type="search" autoComplete="off" value={q} placeholder={placeholder} aria-label="Find a client" className="pl-9"
             onChange={(e) => { setQ(e.target.value); setOpen(true); }} onFocus={() => setOpen(true)} />
      {open && term.length >= 2 && (
        <div className="absolute inset-x-0 top-full z-30 mt-1 max-h-72 overflow-y-auto rounded-(--radius-card) border border-line bg-surface p-1 shadow-lg">
          {matches.map((c) => (
            <button key={c.customer_id} type="button" onClick={() => pick(c)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-surface-2">
              <span className="min-w-0 flex-1">
                <span className="block truncate text-small font-medium text-ink-900">{c.name}</span>
                <span className="block truncate text-caption text-ink-500">{[c.phone, c.visits ? `${c.visits} visit${c.visits === 1 ? '' : 's'}` : 'New', c.membership].filter(Boolean).join(' · ')}</span>
              </span>
              {c.allergies && <span className="rounded-full bg-danger/10 px-2 py-0.5 text-[11px] font-medium text-danger">Allergy noted</span>}
            </button>
          ))}
          {matches.length === 0 && <p className="px-3 py-2 text-caption text-ink-500">No client matches “{term}”.</p>}
          <button type="button" onClick={() => { setAdding(true); setOpen(false); }} className="mt-1 flex w-full items-center gap-2 rounded-lg border-t border-line px-3 py-2 text-left text-small font-medium text-brand-600 hover:bg-surface-2">
            <Plus aria-hidden="true" className="h-4 w-4" />Add “{term}” as a new client
          </button>
        </div>
      )}
      {adding && <QuickClientModal initialName={q.trim()} onClose={() => setAdding(false)} onSaved={(made) => { setAdding(false); pick(made); }} />}
    </div>
  );
};

export default ClientPicker;
