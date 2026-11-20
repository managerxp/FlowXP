/*
 * The loyalty card as a customer sees it. Used by the owner's designer (live preview) and the customer's own page, so what the owner designs is exactly what is shown.
 * A stamp card shows one circle per stamp; every other kind shows the points.
 */
import { Coffee, Dumbbell, Car, Gift, Heart, Scissors, Star, Utensils } from 'lucide-react';
import { useT } from '../i18n/useT.js';

export const ICONS = { star: Star, coffee: Coffee, heart: Heart, gift: Gift, scissors: Scissors, utensils: Utensils, car: Car, dumbbell: Dumbbell };
export const DEFAULT_CARD = { bg: '#0f766e', fg: '#ffffff', accent: '#fbbf24', icon: 'star', title: '', message: '' };

const LoyaltyCardFace = ({ card = DEFAULT_CARD, business, name, kind, balance = 0, redeemAt = 5, customer, membershipNo }) => {
  const tr = useT();
  const c = { ...DEFAULT_CARD, ...card };
  const Icon = ICONS[c.icon] || Star;
  const stamps = kind === 'STAMPS' || kind === 'VISITS';
  const total = Math.min(Math.max(redeemAt || 1, 1), 12);
  const filled = Math.min(balance, total);
  return (
    <div className="relative overflow-hidden rounded-2xl p-5 shadow-md" style={{ background: `linear-gradient(135deg, ${c.bg}, ${c.bg}dd)`, color: c.fg }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold uppercase tracking-[0.14em] opacity-80">{business || tr('Your business')}</p>
          <p className="mt-1 text-xl font-semibold leading-snug">{c.title || name || tr('Loyalty card')}</p>
        </div>
        <Icon aria-hidden="true" className="h-8 w-8 shrink-0" style={{ color: c.accent }} />
      </div>
      {stamps ? (
        <div className="mt-4 flex flex-wrap gap-2" role="img" aria-label={tr('{{filled}} of {{total}} stamps', { filled, total })}>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="flex h-9 w-9 items-center justify-center rounded-full border-2 text-xs font-bold"
                  style={i < filled ? { background: c.accent, borderColor: c.accent, color: c.bg } : { borderColor: `${c.fg}88`, color: `${c.fg}aa` }}>
              {i < filled ? <Icon className="h-4 w-4" /> : i + 1}
            </span>
          ))}
        </div>
      ) : (
        <p className="mt-5 text-4xl font-bold tabular-nums">{balance}<span className="ml-2 text-sm font-medium opacity-80">{tr('points')}</span></p>
      )}
      {c.message && <p className="mt-4 rounded-lg px-3 py-2 text-sm" style={{ background: `${c.fg}22` }}>{c.message}</p>}
      {(customer || membershipNo) && <p className="mt-4 flex justify-between gap-3 text-xs opacity-80"><span className="truncate">{customer}</span><span className="tabular-nums">{membershipNo}</span></p>}
    </div>
  );
};

export default LoyaltyCardFace;
