/*
 * Member desk: the till's loyalty screen. Find a member by mobile number, membership number or a scanned card (QR or NFC link), then add a stamp or points,
 * claim a reward, or join a new customer. Every action carries a request key, so a double tap or a retry after a bad connection never counts twice.
 */
import { useEffect, useRef, useState } from 'react';
import { Camera, Search, UserPlus } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.jsx';
import LoyaltyCardFace from '../components/LoyaltyCardFace.jsx';
import { Alert, Button, Card, Field, Input, PageHeader, Select, useToast } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const rs = (paise) => formatCurrency(Number(paise) / 100);
const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

/* What was typed or scanned: a card link, a membership number, or a mobile number. */
export const parseLookup = (raw) => {
  const t = String(raw || '').trim();
  const link = t.match(/\/card\/([0-9a-f]{20,100})\/?(?:[?#].*)?$/i);
  if (link) return `token=${link[1]}`;
  if (/^M\d{8}$/i.test(t)) return `no=${t.toUpperCase()}`;
  if (/^[0-9a-f]{40,100}$/i.test(t)) return `token=${t}`;
  return `phone=${t.replace(/\D/g, '')}`;
};

/* Camera scan, only where the browser can read QR codes itself (Chrome and Android). Anywhere else the field takes a pasted link or a scanner gun. */
const canScan = typeof window !== 'undefined' && 'BarcodeDetector' in window && navigator.mediaDevices?.getUserMedia;
const Scanner = ({ onText, onClose }) => {
  const tr = useT();
  const video = useRef(null);
  const [err, setErr] = useState('');
  const started = useRef(false);
  const start = async (el) => {
    video.current = el;
    if (!el || started.current) return;
    started.current = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
      el.srcObject = stream; await el.play();
      const det = new window.BarcodeDetector({ formats: ['qr_code'] });
      const tick = async () => {
        if (!video.current?.srcObject) return;
        const hit = (await det.detect(el).catch(() => []))[0];
        if (hit) { stream.getTracks().forEach((t) => t.stop()); onText(hit.rawValue); return; }
        setTimeout(tick, 250);
      };
      tick();
    } catch { setErr('The camera could not be opened. Type or paste the number instead.'); }
  };
  return (
    <div className="space-y-2 rounded-xl border border-line bg-surface p-3">
      <video ref={start} playsInline muted className="aspect-square w-full max-w-sm rounded-lg bg-black object-cover" />
      {err && <Alert>{err}</Alert>}
      <Button variant="secondary" onClick={() => { video.current?.srcObject?.getTracks().forEach((t) => t.stop()); onClose(); }}>{tr('Close camera')}</Button>
    </div>
  );
};

const Member = ({ id }) => {
  const tr = useT();
  const [m, setM] = useState(null); const [rewards, setRewards] = useState([]); const [err, setErr] = useState(''); const [done, setDone] = useState('');
  const [amount, setAmount] = useState(''); const [points, setPoints] = useState(''); const [busy, setBusy] = useState(false);
  const keys = useRef({});   // one key per kind of action, kept until it succeeds, so a retry is the same request
  const toast = useToast();
  const { business } = useAuth();
  const owner = business?.role === 'OWNER' || business?.role === 'ADMIN';   // undoing is the owner's: the server refuses anyone else
  const load = async () => { const [a, r] = await Promise.all([api(`/loyalty/members/${id}`), api(`/loyalty/members/${id}/rewards`)]); setM(a); setRewards(r); };
  useEffect(() => { load().catch((e) => setErr(e.message)); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const run = async (name, path, body, message) => {
    setBusy(true); setErr(''); setDone('');
    keys.current[name] ||= newKey();
    try { const out = await api(path, { method: 'POST', body: { ...body, key: keys.current[name] } }); delete keys.current[name]; setDone(message(out)); toast.success(tr('Done')); await load(); return out; }
    catch (e) { setErr(e.message); return null; } finally { setBusy(false); }
  };
  if (!m) return err ? <Alert>{err}</Alert> : <p className="text-ink-500">{tr('Loading…')}</p>;
  const perBill = m.kind === 'STAMPS' || m.kind === 'VISITS';
  const needsAmount = !perBill || Number(m.min_txn_paise || 0) > 0;
  const redeemAt = m.redeem_points;
  return (
    <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
      <div className="space-y-3">
        <LoyaltyCardFace card={m.card} business={business?.name} name={m.programme_name} kind={m.kind} balance={m.balance} redeemAt={redeemAt} customer={m.customer_name} membershipNo={m.membership_no} />
        <p className="text-small text-ink-500">{m.customer_phone} · {m.status === 'ACTIVE' ? tr('Active') : tr('Switched off')}</p>
      </div>
      <div className="space-y-4">
        {done && <p role="status" className="rounded-lg bg-success/10 px-3 py-2 text-small font-medium text-success">{done}</p>}
        {err && <Alert>{err}</Alert>}
        <Card className="p-4">
          <h3 className="text-small font-semibold text-ink-900">{perBill ? tr('Add a stamp') : tr('Add points for this bill')}</h3>
          <div className="mt-2 flex flex-wrap items-end gap-2">
            {needsAmount && <div className="w-40"><Field id="md-amt" label={tr('Bill amount (₹)')}><Input id="md-amt" type="number" min="0" inputMode="decimal" value={amount} onChange={(e) => { setAmount(e.target.value); delete keys.current.earn; }} /></Field></div>}
            <Button loading={busy} disabled={m.status !== 'ACTIVE' || (needsAmount && !(Number(amount) > 0))} onClick={() => run('earn', `/loyalty/members/${id}/earn`, { amount_paise: Math.round(Number(amount || 0) * 100) }, (o) => (o.points ? `Added ${o.points} ${perBill ? 'stamp' : 'points'}. Balance ${o.balance}` : 'This bill is too small to earn anything'))}>
              {perBill ? tr('Stamp') : tr('Add points')}
            </Button>
          </div>
          <p className="mt-2 text-caption text-ink-500">Bills made with the customer's mobile number add automatically; use this for a bill made without it.</p>
        </Card>
        <Card className="p-4">
          <h3 className="text-small font-semibold text-ink-900">{tr('Rewards')}</h3>
          <ul className="mt-1 divide-y divide-line">
            {rewards.map((r) => (
              <li key={r.reward_id} className="flex items-center justify-between gap-3 py-2">
                <span className="min-w-0 text-ink-900">{r.name}<span className="block text-caption text-ink-500">{r.points_cost} {perBill ? 'stamps' : 'points'}{Number(r.value_paise) ? ` · worth ${rs(r.value_paise)}` : ''}{!r.affordable && r.points_short > 0 ? ` · ${r.points_short} more needed` : ''}</span></span>
                <Button size="sm" disabled={!r.affordable || busy || m.status !== 'ACTIVE'} onClick={() => run(`claim${r.reward_id}`, `/loyalty/members/${id}/claim`, { reward_id: r.reward_id }, (o) => `${r.name} given. ${Number(o.redemption.value_paise) ? `Take ${rs(o.redemption.value_paise)} off the bill. ` : ''}Balance ${o.balance}`)}>{tr('Give')}</Button>
              </li>))}
            {!rewards.length && <li className="py-2 text-small text-ink-500">{tr('No rewards on this card yet.')}</li>}
          </ul>
          {!perBill && (
            <div className="mt-3 flex flex-wrap items-end gap-2 border-t border-line pt-3">
              <div className="w-40"><Field id="md-pts" label={tr('Use points (at least {{min_redeem_points}})', { min_redeem_points: m.min_redeem_points })}><Input id="md-pts" type="number" min="1" value={points} onChange={(e) => { setPoints(e.target.value); delete keys.current.redeem; }} /></Field></div>
              <Button variant="secondary" loading={busy} disabled={!(Number(points) > 0)} onClick={() => run('redeem', `/loyalty/members/${id}/redeem`, { points: Number(points) }, (o) => `Take ${rs(o.value_paise)} off the bill. Balance ${o.balance}`)}>{tr('Use points')}</Button>
            </div>)}
        </Card>
        <Card className="p-4">
          <h3 className="text-small font-semibold text-ink-900">{tr('Recent')}</h3>
          <ul className="mt-1 divide-y divide-line">
            {m.ledger.slice(0, 8).map((e) => (
              <li key={e.entry_id} className="flex items-center justify-between gap-3 py-1.5 text-small"><span className="text-ink-700">{e.note || e.kind} · {new Date(e.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}</span>
                <span className="flex items-center gap-3"><span className={`tabular font-medium ${e.points > 0 ? 'text-success' : 'text-ink-900'}`}>{e.points > 0 ? '+' : ''}{e.points}</span>
                  {owner && (e.kind === 'EARN' || e.kind === 'REDEEM') && !e.undone && !e.invoice_id && (
                    <button type="button" disabled={busy} onClick={() => (e.claim_id
                      ? run(`undo${e.entry_id}`, `/loyalty/claims/${e.claim_id}/cancel`, {}, () => 'Reward taken back, points returned')
                      : run(`undo${e.entry_id}`, `/loyalty/ledger/${e.entry_id}/reverse`, { reason: 'Undone at the member desk' }, () => 'Undone'))} className="text-brand-700 hover:underline">{tr('Undo')}</button>)}
                </span></li>))}
            {!m.ledger.length && <li className="py-1.5 text-small text-ink-500">{tr('Nothing yet.')}</li>}
          </ul>
        </Card>
      </div>
    </div>
  );
};

const Join = ({ phone, onJoined }) => {
  const tr = useT();
  const [programmes, setProgrammes] = useState(null); const [pid, setPid] = useState(''); const [name, setName] = useState(''); const [p, setP] = useState(phone.length >= 10 ? phone : '');
  const [consent, setConsent] = useState(false); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  useEffect(() => { api('/loyalty/programmes').then((r) => { const on = r.filter((x) => x.is_active); setProgrammes(on); if (on[0]) setPid(String(on[0].programme_id)); }).catch((e) => setErr(e.message)); }, []);
  const go = async () => {
    setBusy(true); setErr('');
    try { const out = await api('/loyalty/members', { method: 'POST', body: { programme_id: Number(pid), name, phone: p, consent_marketing: consent } }); onJoined(out.membership.membership_id); }
    catch (e) { setErr(e.message); } finally { setBusy(false); }
  };
  if (programmes && !programmes.length) return <Alert>{tr('There is no loyalty card yet. The owner can make one under Loyalty & coupons.')}ons.</Alert>;
  return (
    <Card className="max-w-md space-y-3 p-4">
      <h3 className="flex items-center gap-2 font-semibold text-ink-900"><UserPlus className="h-4 w-4" />{tr('Not a member yet. Join them now')}</h3>
      <Field id="mj-name" label={tr('Name')}><Input id="mj-name" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field id="mj-phone" label={tr('Mobile number')}><Input id="mj-phone" inputMode="numeric" value={p} onChange={(e) => setP(e.target.value)} /></Field>
      {programmes && programmes.length > 1 && <Field id="mj-prog" label={tr('Card')}><Select id="mj-prog" value={pid} onChange={(e) => setPid(e.target.value)}>{programmes.map((x) => <option key={x.programme_id} value={x.programme_id}>{x.name}</option>)}</Select></Field>}
      <label className="flex items-start gap-2 text-small text-ink-700"><input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4" />{tr('They agreed to receive offers')}</label>
      {err && <Alert>{err}</Alert>}
      <Button onClick={go} loading={busy} disabled={!name.trim() || !pid}>{tr('Join')}</Button>
    </Card>
  );
};

const MemberDesk = () => {
  const tr = useT();
  const [q, setQ] = useState(''); const [found, setFound] = useState(null); const [picked, setPicked] = useState(null);
  const [err, setErr] = useState(''); const [none, setNone] = useState(false); const [scan, setScan] = useState(false);
  const search = async (raw = q) => {
    setErr(''); setNone(false); setPicked(null); setFound(null);
    if (!String(raw).trim()) return;
    try {
      const rows = await api(`/loyalty/members/lookup?${parseLookup(raw)}`);
      setFound(rows); if (rows.length === 1) setPicked(rows[0].membership_id);
    } catch (e) { if (e.status === 404) setNone(true); else setErr(e.message); }
  };
  return (
    <div>
      <PageHeader title={tr('Member desk')} lead={tr('Find a member, add a stamp or points, or give a reward.')} />
      <form onSubmit={(e) => { e.preventDefault(); search(); }} className="mb-5 flex max-w-xl gap-2">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={tr('Mobile number, member number, or scan the card')} aria-label={tr('Find a member')} />
        <Button type="submit"><Search className="h-4 w-4" />{tr('Find')}</Button>
        {canScan && <Button type="button" variant="secondary" onClick={() => setScan(true)} aria-label={tr('Scan a card with the camera')}><Camera className="h-4 w-4" /></Button>}
      </form>
      {scan && <div className="mb-5 max-w-sm"><Scanner onClose={() => setScan(false)} onText={(t) => { setScan(false); setQ(t); search(t); }} /></div>}
      {err && <Alert>{err}</Alert>}
      {found && found.length > 1 && !picked && (
        <div className="mb-5 grid max-w-xl gap-2">
          {found.map((r) => <button key={r.membership_id} type="button" onClick={() => setPicked(r.membership_id)} className="flex justify-between rounded-xl border border-line bg-surface p-3 text-left hover:bg-surface-2"><span><span className="block font-medium text-ink-900">{r.customer_name}</span><span className="text-small text-ink-500">{r.programme_name}</span></span><span className="tabular self-center font-semibold">{r.balance}</span></button>)}
        </div>)}
      {picked && <Member key={picked} id={picked} />}
      {none && <Join phone={parseLookup(q).startsWith('phone=') ? q.replace(/\D/g, '').slice(-10) : ''} onJoined={(id) => { setNone(false); setPicked(id); }} />}
    </div>
  );
};

export default MemberDesk;
