/*
 * What a customer opens on their own phone, no app and no login:
 *   /card/join/:code   the page the programme's QR / NFC tag / link opens: name and mobile number, then the card.
 *   /card/:token       their own card: balance or stamps, what they can claim, recent activity. The long link is the key, so it is kept on this phone.
 */
import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { APP_HEADER } from '../lib/api.js';
import { intlTag } from '../i18n/config.js';
import LanguageSelect from '../i18n/LanguageSelect.jsx';
import LoyaltyCardFace from '../components/LoyaltyCardFace.jsx';
import { T, useT } from '../i18n/useT.js';

const call = async (path, { method = 'GET', body } = {}) => {
  let res;
  try { res = await fetch(`/api/public/card${path}`, { method, headers: { ...APP_HEADER, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined }); }
  catch { throw new Error(T('You are offline, or FlowXP cannot be reached. Try again in a moment.')); }
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(payload.message || T('Something went wrong')), { status: res.status });
  return payload.data;
};
/* What the server can say to a customer, in English. The page shows it through tr(), so each reads in the customer's language (an unknown message just stays as it is). */
const SERVER_TEXTS = [
  T('Enter your name and 10 digit mobile number'), T('This card is not available right now'), T('This programme is switched off'), T('This programme has not started yet'), T('This programme has ended'),
  T('Too many sign-ups from here. Try again later.'), T('Too many requests from here.'), T('Too many attempts from here. Try again in a few minutes.'), T('Not allowed'),
  T('Could not make a membership number, try again')
];
const KEY = (code) => `flowxp_card_${code}`;
const day = (iso, lang) => new Date(iso).toLocaleDateString(intlTag(lang || 'en'), { day: 'numeric', month: 'short' });

/** What a row of the member's history says, in the customer's language (the server's own English note is only used for a reward's name). */
const entryLabel = (e, tr) => (e.kind === 'REDEEM' && String(e.note || '').startsWith('Reward: ') ? tr('Reward: {{name}}', { name: e.note.slice(8) }) : e.kind === 'EARN' ? tr('Earned') : e.kind === 'REVERSAL' ? tr('Reversed') : e.kind === 'EXPIRE' ? tr('Points expired') : e.kind === 'ADJUST' ? tr('Adjustment') : e.points > 0 ? tr('Earned') : tr('Used'));

const Shell = ({ children }) => <div className="min-h-dvh bg-surface-2 px-4 py-6"><div className="mx-auto w-full max-w-md space-y-4">{children}<div className="flex justify-center pt-2"><LanguageSelect /></div></div></div>;
const Notice = ({ children }) => <Shell><p className="rounded-xl border border-line bg-surface p-6 text-center text-ink-700">{children}</p></Shell>;

const Join = ({ code }) => {
  const tr = useT();
  const navigate = useNavigate();
  const [p, setP] = useState(null); const [err, setErr] = useState(''); const [gone, setGone] = useState(false);
  const [name, setName] = useState(''); const [phone, setPhone] = useState(''); const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false); const [already, setAlready] = useState(false);
  useEffect(() => {
    let saved = null; try { saved = localStorage.getItem(KEY(code)); } catch { /* private window */ }
    if (saved) { navigate(`/card/${saved}`, { replace: true }); return; }
    call(`/join/${code}`).then(setP).catch(() => setGone(true));
  }, [code, navigate]);
  if (gone) return <Notice>{tr('This card is not available right now.')}</Notice>;
  if (!p) return <Notice>{tr('Loading…')}</Notice>;
  const submit = async (e) => {
    e.preventDefault(); setBusy(true); setErr('');
    try {
      const r = await call(`/join/${code}`, { method: 'POST', body: { name, phone, consent_marketing: consent } });
      if (r.already) { setAlready(true); return; }
      try { localStorage.setItem(KEY(code), r.token); } catch { /* the link still works */ }
      navigate(`/card/${r.token}`, { replace: true });
    } catch (x) { setErr(tr(x.message)); } finally { setBusy(false); }
  };
  return (
    <Shell>
      <LoyaltyCardFace card={p.card} business={p.business} name={p.name} kind={p.kind} redeemAt={p.redeem_points} />
      {!p.open ? <p className="rounded-xl bg-surface p-4 text-center text-ink-700">{tr('This card is not taking new members right now.')}</p> : already ? (
        <p className="rounded-xl border border-line bg-surface p-4 text-ink-700">{tr('This number already has a card here. Ask the staff at the counter for your card link.')}</p>
      ) : (
        <form onSubmit={submit} className="space-y-3 rounded-xl border border-line bg-surface p-4">
          <h1 className="text-lg font-semibold text-ink-900">{tr('Get your card')}</h1>
          <label className="block text-sm font-medium text-ink-700">{tr('Your name')}
            <input required maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" className="mt-1 min-h-12 w-full rounded-xl border border-line-strong px-3 text-base" /></label>
          <label className="block text-sm font-medium text-ink-700">{tr('Mobile number')}
            <input required inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" placeholder={tr('10 digits')} className="mt-1 min-h-12 w-full rounded-xl border border-line-strong px-3 text-base" /></label>
          <label className="flex items-start gap-2 text-sm text-ink-700"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-1 h-4 w-4" />{tr('It is fine to send me offers from {{business}} (optional).', { business: p.business })}</label>
          {err && <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm text-danger">{err}</p>}
          <button disabled={busy} className="min-h-12 w-full rounded-xl bg-brand-500 px-5 text-base font-semibold text-white disabled:opacity-60">{busy ? tr('Please wait…') : tr('Join')}</button>
        </form>
      )}
    </Shell>
  );
};

const Card = ({ token }) => {
  const tr = useT();
  const { i18n } = useTranslation();
  const [d, setD] = useState(null); const [gone, setGone] = useState(false); const [walletErr, setWalletErr] = useState('');
  const addToWallet = () => { setWalletErr(''); call(`/${token}/google-wallet`).then((r) => { window.location.href = r.url; }).catch((e) => setWalletErr(tr(e.message))); };
  useEffect(() => { call(`/${token}`).then(setD).catch(() => setGone(true)); }, [token]);
  if (gone) return <Notice>{tr('This card link is not valid. Ask the staff for a new one.')}</Notice>;
  if (!d) return <Notice>{tr('Loading…')}</Notice>;
  const stamps = d.kind === 'STAMPS' || d.kind === 'VISITS';
  return (
    <Shell>
      <LoyaltyCardFace card={d.card} business={d.business} name={d.name} kind={d.kind} balance={d.balance} redeemAt={d.redeem_points} customer={d.customer} membershipNo={d.membership_no} />
      {d.status !== 'ACTIVE' && <p className="rounded-xl bg-warning/10 p-3 text-sm text-warning">{tr('This card is switched off. Please ask the staff.')}</p>}
      {d.wallet?.google && <div><button type="button" onClick={addToWallet} className="min-h-12 w-full rounded-xl bg-ink-900 px-5 text-base font-semibold text-white">{tr('Add to Google Wallet')}</button>{walletErr && <p role="alert" className="mt-2 text-sm text-danger">{walletErr}</p>}</div>}
      <p className="rounded-xl border border-line bg-surface p-3 text-center text-sm text-ink-700">{tr('Show this card, or say your mobile number, at the counter.')}</p>
      {d.rewards.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-2 font-semibold text-ink-900">{tr('Rewards')}</h2>
          <ul className="divide-y divide-line">{d.rewards.map((r) => (
            <li key={r.reward_id} className="flex items-center justify-between gap-3 py-2"><span className="text-ink-900">{r.name}</span>
              <span className={`shrink-0 text-sm font-medium ${r.affordable ? 'text-success' : 'text-ink-500'}`}>{r.affordable ? tr('Ready to claim') : (stamps ? tr('{{n}} more stamps', { n: r.points_short }) : tr('{{n}} more points', { n: r.points_short }))}</span></li>))}</ul>
        </section>)}
      {d.ledger.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-4"><h2 className="mb-2 font-semibold text-ink-900">{tr('Recent')}</h2>
          <ul className="divide-y divide-line">{d.ledger.map((e, i) => (
            <li key={i} className="flex justify-between gap-3 py-2 text-sm"><span className="text-ink-700">{entryLabel(e, tr)} · {day(e.at, i18n.resolvedLanguage)}</span><span className={`tabular-nums font-medium ${e.points > 0 ? 'text-success' : 'text-ink-900'}`}>{e.points > 0 ? '+' : ''}{e.points}</span></li>))}</ul>
        </section>)}
    </Shell>
  );
};

const LoyaltyCardPage = () => { const { code, token } = useParams(); return code ? <Join code={code} /> : <Card token={token} />; };
export default LoyaltyCardPage;
