/*
 * The visit card, and the mobile-number lookup a till uses to find a customer.
 * Both are display + small fetches; the rules (what counts as a visit, when the
 * reward applies) live on the server.
 */
import { useState } from 'react';
import { api } from '../lib/api.js';
import { formatCurrency } from '../lib/api.js';
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
 * A customer's points at the till: balance, tier, and a box to spend some on this bill.
 * `points` is what /loyalty/... returns (null when the scheme is off); `total` is what is left to pay
 * in rupees (used only to suggest a sensible maximum, the server enforces the real one).
 */
export const PointsPanel = ({ points, total = 0, value, onChange }) => {
  if (!points) return null;
  const spendable = points.balance >= points.min_redeem_points;
  const cap = Math.floor((total * points.max_redeem_pct) / 100 / points.point_value);
  const most = Math.max(0, Math.min(points.balance, cap));
  const n = Number(value) || 0;
  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <p className="text-ink-700">
        <strong className="text-ink-900">{points.balance} points</strong> ({formatCurrency(points.balance_value)})
        {points.tier && <> · <span className="font-semibold text-brand-600">{points.tier.name}</span> earns {points.earn_per_100} per {formatCurrency(100)}</>}
      </p>
      {points.next_tier && <p className="text-xs text-ink-500">{points.next_tier.points_needed} more points to {points.next_tier.name}.</p>}
      {spendable ? (
        <div className="mt-2 flex items-center gap-2">
          <Input type="number" min="0" step="1" className="!w-28" placeholder="Use points" value={value} onChange={(e) => onChange(e.target.value)} aria-label="Points to use" />
          <button type="button" className="text-xs font-semibold text-brand-600 disabled:opacity-40" disabled={most < points.min_redeem_points} onClick={() => onChange(String(most))}>Use max ({most})</button>
          {n > 0 && <span className="text-xs font-medium text-success">−{formatCurrency(n * points.point_value)}</span>}
        </div>
      ) : (
        <p className="mt-1 text-xs text-ink-500">Needs {points.min_redeem_points} points to spend.</p>
      )}
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
      if (result.customer) onPick(result.customer, result.loyalty, result.points);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  const add = async () => {
    setError(''); setBusy(true);
    try {
      const created = await api('/customers', { method: 'POST', body: { name: name.trim() || `Guest ${digits.slice(-4)}`, phone: digits.slice(-10) } });
      const both = await api(`/loyalty/customers/${created.customer_id}`).catch(() => ({}));
      setFound({ customer: created, loyalty: both.loyalty ?? null });
      onPick(created, both.loyalty ?? null, both.points ?? null);
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
