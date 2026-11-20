/*
 * Loyalty cards (a tab of the Loyalty page): the owner makes a card in three steps (what it is, the rule, how it looks), shares its join link / QR / NFC tag,
 * and adds rewards. Staff credit and redeem from the till; customers join and see their card on their own phone (public/LoyaltyCardPage.jsx).
 */
import { useCallback, useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { Copy, Download, Plus, QrCode } from 'lucide-react';
import { api, formatCurrency } from '../lib/api.js';
import LoyaltyCardFace, { DEFAULT_CARD, ICONS, suggestedIcons } from '../components/LoyaltyCardFace.jsx';
import { Alert, Badge, Button, Card, Field, Input, ListState, Modal, Select, useToast } from '../components/ui.jsx';
import { useT, T } from '../i18n/useT.js';

const KINDS = [
  ['STAMPS', T('Stamp card'), 'One stamp for each bill. Collect enough stamps, get a reward.'],
  ['POINTS', T('Points'), 'Points for every amount spent. Spend points on rewards.'],
  ['VISITS', T('Visits'), 'Counts visits. Every Nth visit earns a reward.']
];
const THEMES = [['#0f766e', '#ffffff', '#fbbf24'], ['#1e3a8a', '#ffffff', '#fbbf24'], ['#7c2d12', '#ffffff', '#fdba74'], ['#831843', '#ffffff', '#f9a8d4'], ['#111827', '#ffffff', '#34d399'], ['#fef3c7', '#78350f', '#b45309']];
const ICON_NAMES = { star: T('Star'), coffee: T('Coffee mug'), heart: T('Heart'), gift: T('Gift'), scissors: T('Scissors'), utensils: T('Food'), car: T('Car'), dumbbell: T('Dumbbell'), crown: T('Caesar crown'), sparkles: T('Sparkles'), smile: T('Smile'), cake: T('Cake'), pizza: T('Pizza'), shirt: T('Shirt'), wrench: T('Spanner'), bike: T('Bike') };
/** Text colour that stays readable on a colour the owner picked: dark on light, white on dark. */
const readableOn = (hex) => { const n = parseInt(hex.slice(1), 16); return (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) > 160 ? '#111827' : '#ffffff'; };
const rupees = (paise) => (Number(paise) / 100) || '';
const paise = (r) => Math.round(Number(r || 0) * 100);
const joinUrl = (code) => `${window.location.origin}/card/join/${code}`;

/* Share: the link, a QR to print, and the same link for an NFC sticker. */
const Share = ({ programme, onClose }) => {
  const tr = useT();
  const url = joinUrl(programme.join_code);
  const [qr, setQr] = useState('');
  const toast = useToast();
  useEffect(() => { QRCode.toDataURL(url, { width: 480, margin: 2 }).then(setQr).catch(() => setQr('')); }, [url]);
  return (
    <Modal title={tr('Share {{programme_name}}', { programme_name: programme.name })} onClose={onClose}>
      <div className="space-y-4">
        {qr && <img src={qr} alt={tr('QR code to join')} className="mx-auto h-56 w-56 rounded-lg border border-line" />}
        <p className="break-all rounded-lg bg-surface-2 p-3 text-small text-ink-700">{url}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success(tr('Link copied')))}><Copy className="h-4 w-4" />{tr('Copy link')}</Button>
          {qr && <a download={`${programme.name}-qr.png`} href={qr} className="inline-flex items-center gap-2 rounded-(--radius-control) border border-line-strong px-4 py-2.5 text-sm font-medium text-ink-900"><Download className="h-4 w-4" />{tr('Download QR')}</a>}
        </div>
        <p className="text-small text-ink-500">{tr('Print the QR for the counter or a table. For an NFC sticker, write the same link onto it with any free NFC writer app: customers tap with their phone and the page opens, no app needed.')}</p>
      </div>
    </Modal>
  );
};

const Rewards = ({ programme }) => {
  const tr = useT();
  const [list, setList] = useState(null); const [name, setName] = useState(''); const [cost, setCost] = useState(''); const [value, setValue] = useState(''); const [err, setErr] = useState('');
  const toast = useToast();
  const load = useCallback(() => api(`/loyalty/rewards?programme_id=${programme.programme_id}`).then(setList).catch(() => setList([])), [programme.programme_id]);
  useEffect(() => { load(); }, [load]);
  const add = async () => {
    setErr('');
    try { await api('/loyalty/rewards', { method: 'POST', body: { programme_id: programme.programme_id, name, points_cost: Number(cost), value_paise: paise(value) } }); setName(''); setCost(''); setValue(''); toast.success(tr('Reward added')); load(); }
    catch (e) { setErr(e.message); }
  };
  const flip = (r) => api(`/loyalty/rewards/${r.reward_id}`, { method: 'PUT', body: { is_active: !r.is_active } }).then(load).catch((e) => setErr(e.message));
  const unit = programme.kind === 'POINTS' ? 'points' : programme.kind === 'VISITS' ? 'visits' : 'stamps';
  return (
    <div className="mt-4 border-t border-line pt-4">
      <h4 className="text-small font-semibold text-ink-900">{tr('Rewards')}</h4>
      <ul className="mt-2 divide-y divide-line">
        {(list || []).map((r) => (
          <li key={r.reward_id} className="flex items-center justify-between gap-3 py-2 text-small">
            <span className={r.is_active ? 'text-ink-900' : 'text-ink-400 line-through'}>{r.name} <span className="text-ink-500">· {r.points_cost} {unit}{Number(r.value_paise) ? ` · worth ${formatCurrency(Number(r.value_paise) / 100)}` : ''}</span></span>
            <button type="button" onClick={() => flip(r)} className="shrink-0 text-brand-700 hover:underline">{r.is_active ? tr('Switch off') : tr('Switch on')}</button>
          </li>))}
        {list && !list.length && <li className="py-2 text-small text-ink-500">{tr('No rewards yet. Add the first one below.')}</li>}
      </ul>
      <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_7rem_7rem_auto]">
        <Input placeholder={tr('Reward, for example Free coffee')} value={name} onChange={(e) => setName(e.target.value)} aria-label={tr('Reward name')} />
        <Input type="number" min="1" placeholder={tr('Costs ({{unit}})', { unit })} value={cost} onChange={(e) => setCost(e.target.value)} aria-label={tr('Cost in {{unit}}', { unit })} />
        <Input type="number" min="0" placeholder={tr('Worth ₹')} value={value} onChange={(e) => setValue(e.target.value)} aria-label={tr('Worth in rupees')} />
        <Button onClick={add} disabled={!name || !cost}>{tr('Add')}</Button>
      </div>
      {err && <p role="alert" className="mt-2 text-small text-danger">{err}</p>}
    </div>
  );
};

/** Silver / Gold style tiers for a points card: pick a starter set or type your own. A higher tier earns faster. */
const SPEEDS = [1, 1.25, 1.5, 2, 3];
const STARTER = [{ name: 'Silver', min_points: 0, multiplier: 1 }, { name: 'Gold', min_points: 500, multiplier: 1.5 }, { name: 'Platinum', min_points: 2000, multiplier: 2 }];
const TiersEditor = ({ value, onChange }) => {
  const tr = useT();
  const row = (i, patch) => onChange(value.map((t, j) => (j === i ? { ...t, ...patch } : t)));
  return (
    <div className="space-y-2 rounded-xl border border-line p-3">
      <p className="text-sm font-medium text-ink-700">{tr('Tiers (optional)')}</p>
      <p className="text-small text-ink-500">{tr('Members move up as they earn more, and a higher tier earns points faster. Spending points never moves anyone down.')}</p>
      {value.map((t, i) => (
        <div key={i} className="flex flex-wrap items-end gap-2">
          <div className="min-w-36 flex-1"><Field id={`tier-n${i}`} label={i === 0 ? tr('Tier name') : ''}><Input id={`tier-n${i}`} maxLength={30} value={t.name} onChange={(e) => row(i, { name: e.target.value })} /></Field></div>
          <div className="w-28"><Field id={`tier-p${i}`} label={i === 0 ? tr('From points') : ''}><Input id={`tier-p${i}`} type="number" min="0" disabled={i === 0} value={t.min_points} onChange={(e) => row(i, { min_points: e.target.value })} /></Field></div>
          <div className="w-24"><Field id={`tier-m${i}`} label={i === 0 ? tr('Earns') : ''}><Select id={`tier-m${i}`} value={t.multiplier} onChange={(e) => row(i, { multiplier: Number(e.target.value) })}>{SPEEDS.map((x) => <option key={x} value={x}>{x}x</option>)}</Select></Field></div>
          <Button variant="secondary" size="sm" aria-label={tr('Remove tier')} onClick={() => onChange(value.filter((_, j) => j !== i))}>×</Button>
        </div>))}
      <div className="flex flex-wrap gap-2">
        {value.length === 0 && <Button variant="secondary" size="sm" onClick={() => onChange(STARTER)}>{tr('Use Silver, Gold and Platinum')}</Button>}
        {value.length < 6 && <Button variant="secondary" size="sm" onClick={() => onChange([...value, { name: '', min_points: value.length ? Number(value[value.length - 1].min_points || 0) + 500 : 0, multiplier: 1 }])}>{tr('Add a tier')}</Button>}
      </div>
    </div>
  );
};

/* The three steps: what it is, the rule, how it looks. Anything unusual is left to the defaults. */
const Wizard = ({ programme, business, businessType, onClose, onSaved }) => {
  const tr = useT();
  const editing = Boolean(programme);
  const [step, setStep] = useState(editing ? 2 : 0);
  const [f, setF] = useState(() => ({
    name: programme?.name || '', kind: programme?.kind || 'STAMPS',
    stamps: programme?.redeem_points || 5, minBill: rupees(programme?.min_txn_paise) || 0,
    earn: programme?.earn_points || 1, per: rupees(programme?.per_amount_paise) || 100, redeemPoints: programme?.redeem_points || 100, redeemValue: rupees(programme?.redeem_value_paise) || 50,
    expiry: programme?.expiry_days || '', rewardName: '', rewardValue: '', autoEnrol: programme ? programme.settings?.auto_enrol === true : true, billQr: programme ? programme.settings?.bill_qr === true : true, verifyPhone: programme?.settings?.verify_phone === true,
    card: { ...DEFAULT_CARD, ...(programme?.card || {}) }
  }));
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const [tiers, setTiers] = useState([]); const [tiersTouched, setTiersTouched] = useState(false);
  useEffect(() => { if (programme?.programme_id && programme.kind === 'POINTS') api(`/loyalty/programmes/${programme.programme_id}/tiers`).then(setTiers).catch(() => {}); }, [programme]);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const [moreIcons, setMoreIcons] = useState(false);
  const setCard = (k, v) => setF((x) => ({ ...x, card: { ...x.card, [k]: v } }));
  const perBill = f.kind !== 'POINTS';
  const body = () => ({
    name: f.name, kind: f.kind, card: f.card, auto_enrol: f.autoEnrol, bill_qr: f.billQr, verify_phone: f.billQr && f.verifyPhone, min_txn_paise: paise(f.minBill), expiry_days: Number(f.expiry) > 0 ? Number(f.expiry) : null,
    ...(perBill ? { earn_points: 1, redeem_points: Number(f.stamps), min_redeem_points: Number(f.stamps), redeem_value_paise: paise(f.rewardValue) }
      : { earn_points: Number(f.earn), per_amount_paise: paise(f.per), redeem_points: Number(f.redeemPoints), redeem_value_paise: paise(f.redeemValue), min_redeem_points: Number(f.redeemPoints) })
  });
  const save = async () => {
    setBusy(true); setErr('');
    try {
      let programmeId = programme?.programme_id;
      if (editing) await api(`/loyalty/programmes/${programme.programme_id}`, { method: 'PUT', body: body() });
      else {
        const made = await api('/loyalty/programmes', { method: 'POST', body: body() });
        programmeId = made.programme_id;
        if (perBill && f.rewardName.trim()) await api('/loyalty/rewards', { method: 'POST', body: { programme_id: made.programme_id, name: f.rewardName, points_cost: Number(f.stamps), value_paise: paise(f.rewardValue) } });
      }
      if (tiersTouched && f.kind === 'POINTS') await api(`/loyalty/programmes/${programmeId}/tiers`, { method: 'PUT', body: { tiers: tiers.map((t) => ({ ...t, min_points: Number(t.min_points) })) } });
      onSaved();
    } catch (e) { setErr(e.message); setBusy(false); }
  };
  const expiryField = <Field id="lp-exp" label={tr('Points expire after (days)')} hint={tr('Leave empty to never expire. Points a customer earned and has not used for this long are taken off, oldest first.')}><Input id="lp-exp" type="number" min="1" max="3650" value={f.expiry} onChange={(e) => set('expiry', e.target.value)} /></Field>;
  const nextOk = step === 0 ? f.name.trim().length > 0 : step === 1 ? (perBill ? Number(f.stamps) >= 1 : Number(f.earn) >= 1 && Number(f.per) > 0 && Number(f.redeemPoints) >= 1) : true;
  return (
    <Modal title={editing ? `Edit ${programme.name}` : tr('Make a card')} onClose={onClose} wide>
      <div className="grid gap-6 md:grid-cols-[1fr_20rem]">
        <div className="space-y-4">
          {!editing && <p className="text-caption font-semibold uppercase tracking-wider text-ink-500">{tr('Step {{v}} of 3', { v: step + 1 })}</p>}
          {step === 0 && (<>
            <Field id="lp-name" label={tr('Name of the card')}><Input id="lp-name" autoFocus value={f.name} onChange={(e) => set('name', e.target.value)} placeholder={tr('Coffee card')} /></Field>
            <div className="space-y-2" role="radiogroup" aria-label={tr('Type of card')}>
              {KINDS.map(([k, label, hint]) => (
                <label key={k} className={`flex cursor-pointer gap-3 rounded-xl border p-3 ${f.kind === k ? 'border-brand-500 bg-brand-50' : 'border-line'}`}>
                  <input type="radio" name="kind" checked={f.kind === k} onChange={() => set('kind', k)} className="mt-1" /><span><span className="block font-medium text-ink-900">{tr(label)}</span><span className="text-small text-ink-500">{tr(hint)}</span></span>
                </label>))}
            </div>
          </>)}
          {step === 1 && (perBill ? (<>
            <Field id="lp-stamps" label={f.kind === 'VISITS' ? tr('Visits for one reward') : tr('Stamps for one reward')} hint={tr('A customer collects this many, then claims the reward.')}><Input id="lp-stamps" type="number" min="1" max="12" value={f.stamps} onChange={(e) => set('stamps', e.target.value)} /></Field>
            <Field id="lp-min" label={tr('Smallest bill that counts (₹)')} hint={tr('Leave 0 for every bill.')}><Input id="lp-min" type="number" min="0" value={f.minBill} onChange={(e) => set('minBill', e.target.value)} /></Field>
            {expiryField}
            {!editing && <>
              <Field id="lp-rw" label={tr('What is the reward?')} hint={tr('For example, a free coffee. You can add more later.')}><Input id="lp-rw" value={f.rewardName} onChange={(e) => set('rewardName', e.target.value)} placeholder={tr('Free coffee')} /></Field>
              <Field id="lp-rv" label={tr('Worth (₹)')}><Input id="lp-rv" type="number" min="0" value={f.rewardValue} onChange={(e) => set('rewardValue', e.target.value)} /></Field></>}
          </>) : (<>
            <div className="grid grid-cols-2 gap-3">
              <Field id="lp-earn" label={tr('Points earned')}><Input id="lp-earn" type="number" min="1" value={f.earn} onChange={(e) => set('earn', e.target.value)} /></Field>
              <Field id="lp-per" label={tr('For every (₹)')}><Input id="lp-per" type="number" min="1" value={f.per} onChange={(e) => set('per', e.target.value)} /></Field>
              <Field id="lp-rp" label={tr('Points to redeem')}><Input id="lp-rp" type="number" min="1" value={f.redeemPoints} onChange={(e) => set('redeemPoints', e.target.value)} /></Field>
              <Field id="lp-rvv" label={tr('Worth (₹)')}><Input id="lp-rvv" type="number" min="0" value={f.redeemValue} onChange={(e) => set('redeemValue', e.target.value)} /></Field>
            </div>
            <Field id="lp-min2" label={tr('Smallest bill that counts (₹)')}><Input id="lp-min2" type="number" min="0" value={f.minBill} onChange={(e) => set('minBill', e.target.value)} /></Field>
            {expiryField}
          </>))}
          {step === 2 && (<>
            <div><p className="mb-1.5 text-sm font-medium text-ink-700">{tr('Colours')}</p>
              <div className="flex flex-wrap gap-2">{THEMES.map(([bg, fg, accent]) => (
                <button key={bg} type="button" aria-label={tr('Colour {{bg}}', { bg })} onClick={() => setF((x) => ({ ...x, card: { ...x.card, bg, fg, accent } }))}
                        className={`h-9 w-9 rounded-full border-2 ${f.card.bg === bg ? 'border-ink-900' : 'border-transparent'}`} style={{ background: bg }} />))}
                <label className="flex items-center gap-1.5 text-small text-ink-500">{tr('own')} <input type="color" value={f.card.bg} onChange={(e) => setF((x) => ({ ...x, card: { ...x.card, bg: e.target.value, fg: readableOn(e.target.value) } }))} aria-label={tr('Pick your own colour')} className="h-9 w-9 rounded border border-line" /></label>
                <label className="flex items-center gap-1.5 text-small text-ink-500">{tr('Stamp colour')} <input type="color" value={f.card.accent || '#fbbf24'} onChange={(e) => setCard('accent', e.target.value)} aria-label={tr('Pick the stamp colour')} className="h-9 w-9 rounded border border-line" /></label></div></div>
            <div><p className="mb-1.5 text-sm font-medium text-ink-700">{tr('Icon')}</p>
              <div className="flex flex-wrap items-center gap-2">{(moreIcons ? Object.keys(ICONS) : [...new Set([...suggestedIcons(businessType), f.card.icon])]).map((k) => { const I = ICONS[k] || ICONS.star; return (
                <button key={k} type="button" aria-label={tr(ICON_NAMES[k] || 'Star')} title={tr(ICON_NAMES[k] || 'Star')} aria-pressed={f.card.icon === k} onClick={() => setCard('icon', k)} className={`flex h-10 w-10 items-center justify-center rounded-lg border ${f.card.icon === k ? 'border-brand-500 bg-brand-50' : 'border-line'}`}><I className="h-5 w-5" /></button>); })}
                <button type="button" onClick={() => setMoreIcons((v) => !v)} className="text-small text-brand-600 underline">{moreIcons ? tr('Fewer icons') : tr('More icons')}</button></div></div>
            <Field id="lp-title" label={tr('Heading on the card')} hint={tr('Leave empty to use the card\'s name.')}><Input id="lp-title" maxLength={40} value={f.card.title} onChange={(e) => setCard('title', e.target.value)} placeholder={tr('Buy 5, get 1 free')} /></Field>
            <Field id="lp-msg" label={tr('A message inside the card')} hint={tr('Customers see it every time they open the card.')}><Input id="lp-msg" maxLength={140} value={f.card.message} onChange={(e) => setCard('message', e.target.value)} placeholder={tr('Thank you for coming back!')} /></Field>
            <label className="flex items-start gap-2 text-small text-ink-700"><input type="checkbox" checked={f.autoEnrol} onChange={(e) => set('autoEnrol', e.target.checked)} className="mt-0.5 h-4 w-4" />{tr('Join every customer billed with a mobile number automatically')}</label>
            <label className="flex items-start gap-2 text-small text-ink-700"><input type="checkbox" checked={f.billQr} onChange={(e) => set('billQr', e.target.checked)} className="mt-0.5 h-4 w-4" /><span>{tr('Print a QR on the bill so customers scan it for their stamp')}<span className="block text-ink-500">{tr('Customers scan it after paying, type their mobile number once, and join and get the stamp. It works for 24 hours, once per bill.')}</span></span></label>
            {f.billQr && <label className="flex items-start gap-2 text-small text-ink-700"><input type="checkbox" checked={f.verifyPhone} onChange={(e) => set('verifyPhone', e.target.checked)} className="mt-0.5 h-4 w-4" /><span>{tr('Check the mobile number with a WhatsApp code')}<span className="block text-ink-500">{tr('A customer types a code sent to their WhatsApp the first time only. It proves the number is theirs, so offers can be sent to it.')}</span></span></label>}
            {f.kind === 'POINTS' && <TiersEditor value={tiers} onChange={(v) => { setTiers(v); setTiersTouched(true); }} />}
          </>)}
          {err && <Alert>{err}</Alert>}
          <div className="flex justify-between gap-2 pt-2">
            {step > 0 && !editing ? <Button variant="secondary" onClick={() => setStep(step - 1)}>{tr('Back')}</Button> : <span />}
            {step < 2 ? <Button onClick={() => setStep(step + 1)} disabled={!nextOk}>{tr('Next')}</Button> : <Button onClick={save} loading={busy}>{editing ? tr('Save') : tr('Make the card')}</Button>}
          </div>
        </div>
        <div className="md:sticky md:top-0 md:self-start"><p className="mb-2 text-caption font-semibold uppercase tracking-wider text-ink-500">{tr('What customers see')}</p>
          <LoyaltyCardFace card={f.card} business={business} name={f.name} kind={f.kind} balance={perBill ? Math.min(2, Number(f.stamps) || 0) : 120} redeemAt={Number(f.stamps) || 5} /></div>
      </div>
    </Modal>
  );
};

/* Where each outlet is. A Google Wallet loyalty card can use it to show on the member's lock screen when they are nearby (Google decides when). Optional. */
const Locations = () => {
  const tr = useT();
  const [rows, setRows] = useState(null); const [err, setErr] = useState(''); const [edit, setEdit] = useState({});
  const toast = useToast();
  const load = useCallback(() => api('/loyalty/locations').then(setRows).catch(() => setRows([])), []);
  useEffect(() => { load(); }, [load]);
  const save = async (b, lat, lng) => {
    setErr('');
    try { await api(`/loyalty/locations/${b.branch_id}`, { method: 'PUT', body: { latitude: lat, longitude: lng } }); toast.success(tr('Location saved')); setEdit((e) => ({ ...e, [b.branch_id]: undefined })); load(); }
    catch (e) { setErr(e.message); }
  };
  const here = (b) => navigator.geolocation?.getCurrentPosition((p) => save(b, Number(p.coords.latitude.toFixed(6)), Number(p.coords.longitude.toFixed(6))), () => setErr('Could not read the location of this device. Allow location access in the browser and try again.'), { enableHighAccuracy: true, timeout: 15000 });
  if (!rows || !rows.length) return null;
  return (
    <Card className="p-4">
      <h3 className="text-small font-semibold text-ink-900">{tr('Outlet locations')}</h3>
      <p className="mt-1 text-small text-ink-500">{tr('Stand at the outlet and tap "Use this device\'s location". Members who saved the card in Google Wallet can then be reminded when they are nearby.')}</p>
      <ul className="mt-2 divide-y divide-line">
        {rows.map((b) => (
          <li key={b.branch_id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-small">
            <span className="text-ink-900">{b.name} <span className="text-ink-500">{b.latitude != null ? `· ${b.latitude}, ${b.longitude}` : tr('· not set')}</span></span>
            <span className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => here(b)}>{tr('Use this device\'s location')}</Button>
              {b.latitude != null && <Button size="sm" variant="secondary" onClick={() => save(b, null, null)}>{tr('Clear')}</Button>}
            </span>
          </li>))}
      </ul>
      {err && <p role="alert" className="mt-2 text-small text-danger">{err}</p>}
    </Card>
  );
};

const LoyaltyProgrammes = ({ business, businessType }) => {
  const tr = useT();
  const [list, setList] = useState(null); const [error, setError] = useState('');
  const [wizard, setWizard] = useState(null); const [share, setShare] = useState(null);
  const load = useCallback(() => api('/loyalty/programmes').then((r) => { setList(r); setError(''); }).catch((e) => { setError(e.message); setList([]); }), []);
  useEffect(() => { load(); }, [load]);
  const flip = (p) => api(`/loyalty/programmes/${p.programme_id}`, { method: 'PUT', body: { is_active: !p.is_active } }).then(load).catch((e) => setError(e.message));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-small text-ink-500">{tr('Make a card, print its QR or tap-tag, and customers join from their own phone. Staff stamp or add points at the till.')}</p>
        <Button onClick={() => setWizard({})}><Plus className="h-4 w-4" />{tr('Make a card')}</Button>
      </div>
      {error && <Alert>{error}</Alert>}
      <ListState loading={list === null} empty={list && !list.length && !error} emptyLabel={tr('No cards yet. Make your first one in three steps.')} />
      {list && list.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {(list || []).map((p) => (
            <Card key={p.programme_id} className="p-4">
              <LoyaltyCardFace card={p.card} business={business} name={p.name} kind={p.kind} balance={p.kind === 'POINTS' ? 120 : Math.min(2, p.redeem_points)} redeemAt={p.redeem_points} />
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <p className="text-small text-ink-700"><Badge tone={p.is_active ? 'success' : 'neutral'}>{p.is_active ? tr('On') : tr('Off')}</Badge> <span className="ml-2 tabular-nums">{p.members}</span> {tr('members')}</p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setShare(p)}><QrCode className="h-4 w-4" />{tr('Share')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => setWizard(p)}>{tr('Edit')}</Button>
                  <Button size="sm" variant="secondary" onClick={() => flip(p)}>{p.is_active ? tr('Switch off') : tr('Switch on')}</Button>
                </div>
              </div>
              <Rewards programme={p} />
            </Card>))}
        </div>)}
      <Locations />
      {wizard && <Wizard programme={wizard.programme_id ? wizard : null} business={business} businessType={businessType} onClose={() => setWizard(null)} onSaved={() => { setWizard(null); load(); }} />}
      {share && <Share programme={share} onClose={() => setShare(null)} />}
    </div>
  );
};

export default LoyaltyProgrammes;
