/*
 * What a customer opens on their own phone, no app and no login:
 *   /card/join/:code   the page the programme's QR / NFC tag / link opens: name and mobile number, then the card.
 *   /card/:token       their own card: balance or stamps, what they can claim, recent activity. The long link is the key, so it is kept on this phone.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { APP_HEADER } from '../lib/api.js';
import LoyaltyCardFace from '../components/LoyaltyCardFace.jsx';

const call = async (path, { method = 'GET', body } = {}) => {
  let res;
  try { res = await fetch(`/api/public/card${path}`, { method, headers: { ...APP_HEADER, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error("You're offline, or FlowXP can't be reached. Try again in a moment."); }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(payload.message || 'Something went wrong'), { status: res.status });
  return payload.data;
};
const KEY = (code) => `flowxp_card_${code}`;
const day = (iso) => new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });

const Shell = ({ children }) => <div className="min-h-dvh bg-surface-2 px-4 py-6"><div className="mx-auto w-full max-w-md space-y-4">{children}</div></div>;
const Notice = ({ children }) => <Shell><p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-700">{children}</p></Shell>;

const Join = ({ code }) => {
  const navigate = useNavigate();
  const [p, setP] = useState(null); const [err, setErr] = useState(''); const [gone, setGone] = useState(false);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [already, setAlready] = useState(false);
  useEffect(() => {
    let saved = null; try { saved = localStorage.getItem(KEY(code)); } catch { /* private window */ }
    if (saved) { navigate(`/card/${saved}`, { replace: true }); return; }
    call(`/join/${code}`).then(setP).catch(() => setGone(true));
  }, [code, navigate]);
  if (gone) return <Notice>This card is not available right now.</Notice>;
  if (!p) return <Notice>Loading…</Notice>;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await call(`/join/${code}`, { method: 'POST', body: { name, phone, consent_marketing: consent } });
      if (r.already) { setAlready(true); return; }
      try { localStorage.setItem(KEY(code), r.token); } catch { /* the link still works */ }
      navigate(`/card/${r.token}`, { replace: true });
    } catch (x) { setErr(x.message); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <LoyaltyCardFace card={p.card} business={p.business} name={p.name} kind={p.kind} redeemAt={p.redeem_points} />
      {!p.open ? <p className="rounded-xl bg-surface p-4 text-center text-ink-700">This card is not taking new members right now.</p> : already ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-ink-700">This number already has a card here. Ask the staff at the counter for your card link.</p>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <h1 className="text-lg font-semibold text-ink-900">Get your card</h1>
          <label className="block text-sm font-medium text-ink-700">Your name
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 min-h-12 w-full rounded-xl border border-line-strong px-3 text-base" /></label>
          <label className="block text-sm font-medium text-ink-700">Mobile number
            <input required inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder="10 digits" className="mt-1 min-h-12 w-full rounded-xl border border-line-strong px-3 text-base" /></label>
          <label className="flex items-start gap-2 text-sm text-ink-700"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />It is fine to send me offers from {p.business} (optional).</label>
          {err && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          <button disabled={busy} className="min-h-12 w-full rounded-xl bg-brand-500 px-5 text-base font-semibold text-white disabled:opacity-60">{busy ? 'Please wait…' : 'Join'}</button>
        </form>
      )}
    </Shell>
  );
};

const Card = ({ token }) => {
  const [d, setD] = useState(null); const [gone, setGone] = useState(false);
  useEffect(() => { call(`/${token}`).then(setD).catch(() => setGone(true)); }, [token]);
  if (gone) return <Notice>This card link is not valid. Ask the staff for a new one.</Notice>;
  if (!d) return <Notice>Loading…</Notice>;
  const stamps = d.kind === 'STAMPS' || d.kind === 'VISITS';
  return (
    <Shell>
      <LoyaltyCardFace card={d.card} business={d.business} name={d.name} kind={d.kind} balance={d.balance} redeemAt={d.redeem_points} customer={d.customer} membershipNo={d.membership_no} />
      {d.status !== 'ACTIVE' && <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">This card is switched off. Please ask the staff.</p>}
      <p className="rounded-xl border border-line bg-surface p-3 text-center text-sm text-ink-700">Show this card, or say your mobile number, at the counter.</p>
      {d.rewards.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-2 font-semibold text-ink-900">Rewards</h2>
          <ul className="divide-y divide-line">{d.rewards.map((r) => (
            <li key={r.reward_id} className="flex items-center justify-between gap-3 py-2"><span className="text-ink-900">{r.name}</span>
              <span className={`shrink-0 text-sm font-medium ${r.affordable ? 'text-success' : 'text-ink-500'}`}>{r.affordable ? 'Ready to claim' : `${r.points_short} more ${stamps ? 'stamps' : 'points'}`}</span></li>))}</ul>
        </section>)}
      {d.ledger.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-2 font-semibold text-ink-900">Recent</h2>
          <ul className="divide-y divide-line">{d.ledger.map((e, i) => (
            <li key={i} className="flex justify-between gap-3 py-2 text-sm"><span className="text-ink-700">{e.note || (e.points > 0 ? 'Earned' : 'Used')} · {day(e.at)}</span><span className={`tabular-nums font-medium ${e.points > 0 ? 'text-success' : 'text-ink-900'}`}>{e.points > 0 ? '+' : ''}{e.points}</span></li>))}</ul>
        </section>)}
    </Shell>
  );
};

const LoyaltyCardPage = () => { const { code, token } = useParams(); return code ? <Join code={code} /> : <Card token={token} />; };
export default LoyaltyCardPage;
