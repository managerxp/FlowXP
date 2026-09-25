/*
 * The visit card, and the mobile-number lookup a till uses to find a customer.
 * Both are display + small fetches; the rules (what counts as a visit, when the
 * reward applies) live on the server.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { Button, Input } from './ui.jsx';

/** Stamp dots and the message. `card` is what /loyalty/... returns. */
export const LoyaltyCard = ({ card, compact = false }) => {
  if (!card) return null;
  const slots = card.visits_required - 1;
  return (
    <div className={`rounded-lg border ${card.reward_ready ? 'border-success/40 bg-success/10' : 'border-line bg-surface-2'} ${compact ? 'p-2.5' : 'p-3.5'}`}>
      <div className="flex flex-wrap gap-1.5" aria-label={`${card.stamps} of ${slots} visits`}>
        {Array.from({ length: slots }, (_, i) => (
          <span key={i} className={`flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${i < card.stamps ? 'bg-brand-500 text-white' : 'border border-line-strong text-ink-400'}`}>
            {i < card.stamps ? '✓' : i + 1}
          </span>
        ))}
        <span className={`flex h-5 items-center justify-center rounded-full px-1.5 text-[10px] font-bold ${card.reward_ready ? 'bg-success text-white' : 'border border-dashed border-line-strong text-ink-400'}`}>FREE</span>
      </div>
      <p className={`mt-2 text-sm ${card.reward_ready ? 'font-semibold text-success' : 'text-ink-700'}`}>{card.message}</p>
    </div>
  );
};

/**
 * Type a mobile number: find the customer (or add them with a name), show their card.
 * onPick(customer, card) fires once someone is chosen.
 */
export const MobileLookup = ({ onPick, placeholder = 'Customer mobile number' }) => {
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState(null);      // { customer, loyalty } | null
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const digits = phone.replace(/\D/g, '');
  const ready = digits.length >= 10;

  const look = async () => {
    setError(''); setBusy(true);
    try {
      const result = await api(`/loyalty/lookup?phone=${encodeURIComponent(phone)}`);
      setFound(result);
      if (result.customer) onPick(result.customer, result.loyalty);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const add = async () => {
    setError(''); setBusy(true);
    try {
      const created = await api('/customers', { method: 'POST', body: { name: name.trim() || `Guest ${digits.slice(-4)}`, phone: digits.slice(-10) } });
      const card = await api(`/loyalty/customers/${created.customer_id}`).then((d) => d.loyalty).catch(() => null);
      setFound({ customer: created, loyalty: card });
      onPick(created, card);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-2">
      <div className="flex gap-2">
        <Input inputMode="tel" placeholder={placeholder} value={phone} onChange={(e) => { setPhone(e.target.value); setFound(null); setError(''); }}
               onKeyDown={(e) => { if (e.key === 'Enter' && ready) { e.preventDefault(); look(); } }} />
        <Button type="button" variant="secondary" onClick={look} disabled={!ready || busy}>Find</Button>
      </div>
      {error && <p className="text-xs text-danger" role="alert">{error}</p>}
      {found && !found.customer && (
        <div className="rounded-lg border border-dashed border-line-strong p-3">
          <p className="text-sm text-ink-600">New customer — add them to start a visit card.</p>
          <div className="mt-2 flex gap-2">
            <Input placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
            <Button type="button" size="sm" onClick={add} disabled={busy}>Add</Button>
          </div>
        </div>
      )}
      {found?.customer && (
        <div className="space-y-2">
          <p className="text-sm font-semibold text-ink-900">{found.customer.name} <span className="font-normal text-ink-400">· {found.customer.phone}</span></p>
          <LoyaltyCard card={found.loyalty} compact />
        </div>
      )}
    </div>
  );
};
