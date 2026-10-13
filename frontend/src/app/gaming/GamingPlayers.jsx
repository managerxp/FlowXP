/* Players: find or add one, see their prepaid wallet and hour packs, top up, sell a pack, and their recent sessions. */
import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Plus, Search, UserPlus, Wallet } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useIdempotencyKey } from '../../lib/idempotency.js';
import { dateTimeText, duration, rs, useDebounced, useLoad } from '../../lib/gaming.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, Textarea, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Toggle, useAction } from '../salon/parts.jsx';

const METHODS = [['CASH', 'Cash'], ['UPI', 'UPI'], ['CARD', 'Card'], ['BANK_TRANSFER', 'Bank'], ['OTHER', 'Other']];

/* the bonus a top-up of this size earns, worked out the way the server does it, so the person at the desk can say it out loud */
const bonusFor = (rules, amount) => (rules || []).reduce((best, r) => (amount >= Number(r.min) && Number(r.min) > best.min ? { min: Number(r.min), bonus: Number(r.bonus) } : best), { min: -1, bonus: 0 }).bonus;

const PlayerForm = ({ player, onClose, onSaved }) => {
  const [f, setF] = useState(player ? { name: player.name, phone: player.phone || '', gamer_tag: player.gamer_tag || '', is_minor: Boolean(player.is_minor), guardian_name: player.guardian_name || '', guardian_phone: player.guardian_phone || '', notes: player.notes || '' }
    : { name: '', phone: '', gamer_tag: '', is_minor: false, guardian_name: '', guardian_phone: '', notes: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => run(async () => {
    setError('');
    const body = { name: f.name, phone: f.phone || null, gamer_tag: f.gamer_tag || null, is_minor: f.is_minor, guardian_name: f.is_minor ? f.guardian_name || null : null, guardian_phone: f.is_minor ? f.guardian_phone || null : null, notes: f.notes || null };
    if (player) delete body.phone;
    try { onSaved(await api(player ? `/gaming/players/${player.customer_id}` : '/gaming/players', { method: player ? 'PUT' : 'POST', body })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={player ? `Edit ${player.name}` : 'Add a player'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim()}>{player ? 'Save' : 'Add player'}</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="pf-name" label="Name"><Input id="pf-name" value={f.name} onChange={set('name')} autoFocus /></Field>
          {!player && <Field id="pf-phone" label="Mobile" hint="How you find them next time"><Input id="pf-phone" type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} /></Field>}
          <Field id="pf-tag" label="Gamer tag (optional)"><Input id="pf-tag" value={f.gamer_tag} onChange={set('gamer_tag')} maxLength={40} /></Field>
        </div>
        <Toggle id="pf-minor" checked={f.is_minor} onChange={(v) => setF((x) => ({ ...x, is_minor: v }))} label="Under 18" hint="Keep a parent or guardian on record" />
        {f.is_minor && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field id="pf-gname" label="Parent or guardian"><Input id="pf-gname" value={f.guardian_name} onChange={set('guardian_name')} /></Field>
            <Field id="pf-gphone" label="Their mobile"><Input id="pf-gphone" type="tel" inputMode="tel" value={f.guardian_phone} onChange={set('guardian_phone')} /></Field>
          </div>
        )}
        <Field id="pf-notes" label="Notes (optional)"><Textarea id="pf-notes" rows={2} value={f.notes} onChange={set('notes')} maxLength={300} /></Field>
      </div>
    </Modal>
  );
};

const TopUpDialog = ({ player, rules, onClose, onDone }) => {
  const key = useIdempotencyKey();
  const [requestId] = useState(() => crypto.randomUUID());
  const [f, setF] = useState({ amount: '', method: 'UPI', reference: '', noBonus: false });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const amount = Number(f.amount) || 0;
  const bonus = f.noBonus ? 0 : bonusFor(rules, amount);
  const save = () => run(async () => {
    setError('');
    try {
      const out = await api(`/gaming/players/${player.customer_id}/wallet/topup`, { method: 'POST', idempotencyKey: key.get(), body: { amount, method: f.method, reference_number: f.reference || null, no_bonus: f.noBonus, request_id: requestId } });
      key.settle(null);
      onDone(out);
    } catch (e) { key.settle(e); setError(e.message); }
  }, null);
  return (
    <Modal title={`Top up ${player.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={amount < 1}>Add {rs(amount + bonus)} to the wallet</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <div className="flex flex-wrap gap-2" role="group" aria-label="Quick amounts">
          {[200, 500, 1000, 2000].map((n) => <Button key={n} type="button" size="sm" variant={amount === n ? 'primary' : 'secondary'} onClick={() => setF((x) => ({ ...x, amount: String(n) }))}>{rs(n)}</Button>)}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="tu-amount" label="Amount paid" prefix="₹" value={f.amount} onChange={(v) => setF((x) => ({ ...x, amount: v }))} />
          <Field id="tu-method" label="Paid by"><Select id="tu-method" value={f.method} onChange={(e) => setF((x) => ({ ...x, method: e.target.value }))}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        </div>
        {f.method !== 'CASH' && <Field id="tu-ref" label="Reference (optional)" hint="UPI transaction number or card slip"><Input id="tu-ref" value={f.reference} onChange={(e) => setF((x) => ({ ...x, reference: e.target.value }))} maxLength={80} /></Field>}
        {bonus > 0 && <p className="rounded-(--radius-control) bg-success/10 px-3.5 py-2.5 text-small font-medium text-success">Bonus {rs(bonus)}: they get {rs(amount + bonus)} for {rs(amount)}.</p>}
        {(rules || []).length > 0 && <Toggle id="tu-nobonus" checked={f.noBonus} onChange={(v) => setF((x) => ({ ...x, noBonus: v }))} label="Leave the bonus off this time" />}
        <p className="text-caption text-ink-500">The money is counted today. GST is charged on the bill the wallet later pays, not on the top-up.</p>
      </div>
    </Modal>
  );
};

const AdjustDialog = ({ player, onClose, onDone }) => {
  const [f, setF] = useState({ amount: '', reason: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const save = () => run(async () => {
    setError('');
    try { onDone(await api(`/gaming/players/${player.customer_id}/wallet/adjust`, { method: 'POST', body: { amount: Number(f.amount), reason: f.reason } })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={`Correct ${player.name}'s wallet`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!Number(f.amount) || !f.reason.trim()}>Save correction</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        <NumberField id="ad-amount" label="Add (or take off with a minus)" prefix="₹" value={f.amount} onChange={(v) => setF((x) => ({ ...x, amount: v }))} min={-500000} />
        <Field id="ad-reason" label="Reason" hint="Kept on record"><Input id="ad-reason" value={f.reason} onChange={(e) => setF((x) => ({ ...x, reason: e.target.value }))} maxLength={200} /></Field>
      </div>
    </Modal>
  );
};

const SellPackDialog = ({ player, onClose, onDone }) => {
  const bundles = useLoad('/gaming/bundles?kind=PACK');
  const key = useIdempotencyKey();
  const [f, setF] = useState({ bundle_id: '', method: 'UPI' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const chosen = (bundles.data || []).find((b) => String(b.bundle_id) === f.bundle_id);
  const save = () => run(async () => {
    setError('');
    try {
      const out = await api(`/gaming/players/${player.customer_id}/passes`, { method: 'POST', idempotencyKey: key.get(), body: { bundle_id: Number(f.bundle_id), payment: { method: f.method, amount: 'FULL' } } });
      key.settle(null);
      onDone(out);
    } catch (e) { key.settle(e); setError(e.message); }
  }, null);
  return (
    <Modal title={`Sell an hour pack to ${player.name}`} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!chosen}>Take payment and sell</Button></>}>
      <div className="space-y-4">
        <Alert>{error}</Alert>
        {bundles.data && !bundles.data.length ? <p className="text-small text-ink-500">No hour packs are set up yet. Add one under Stations and rates, Offers.</p> : (
          <Field id="sp-pack" label="Pack"><Select id="sp-pack" value={f.bundle_id} onChange={(e) => setF((x) => ({ ...x, bundle_id: e.target.value }))}><option value="">Choose a pack</option>{(bundles.data || []).map((b) => <option key={b.bundle_id} value={b.bundle_id}>{b.name}: {duration(b.minutes * 60)} for {rs(b.price)}{b.valid_days ? `, good for ${b.valid_days} days` : ''}</option>)}</Select></Field>
        )}
        <Field id="sp-method" label="Paid by"><Select id="sp-method" value={f.method} onChange={(e) => setF((x) => ({ ...x, method: e.target.value }))}>{METHODS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {chosen && <p className="text-small text-ink-500">GST is added to the price on the bill. The pack is paid in full when it is sold.</p>}
      </div>
    </Modal>
  );
};

const PASS_TONE = { ACTIVE: 'success', EXPIRED: 'warning', USED: 'neutral', CANCELLED: 'danger' };
const PASS_LABEL = { ACTIVE: 'In use', EXPIRED: 'Expired', USED: 'Used up', CANCELLED: 'Withdrawn' };

const Detail = ({ id, onChanged }) => {
  const { can, hasFeature } = useAuth();
  const toast = useToast();
  const p = useLoad(`/gaming/players/${id}`);
  const walletOn = hasFeature('gaming_wallet');
  const w = useLoad(walletOn ? `/gaming/players/${id}/wallet?limit=10` : null, { paged: true });
  const passes = useLoad(walletOn ? `/gaming/players/${id}/passes` : null);
  const settings = useLoad(walletOn ? '/gaming/settings' : null);
  const [dialog, setDialog] = useState(null);
  const balance = w.meta?.balance ?? p.data?.wallet ?? 0;
  const done = (message) => { setDialog(null); toast.success(message); p.reload(); w.reload(); passes.reload(); onChanged(); };
  const player = p.data;

  return (
    <div className="space-y-5">
      <ListState loading={p.loading && !player} error={p.error} />
      {player && (
        <>
          <Panel title={player.name} lead={[player.phone, player.gamer_tag && `Tag ${player.gamer_tag}`].filter(Boolean).join(' · ') || 'No mobile on record'}
                 action={can('gaming_desk') && <Button size="sm" variant="secondary" onClick={() => setDialog('edit')}>Edit</Button>}>
            {player.is_minor && <p className="mb-2 text-small"><Badge tone="warning">Under 18</Badge> <span className="text-ink-700">Guardian: {player.guardian_name}{player.guardian_phone ? ` (${player.guardian_phone})` : ''}</span></p>}
            {player.notes && <p className="text-small text-ink-700">{player.notes}</p>}
            {!player.is_minor && !player.notes && <p className="text-small text-ink-500">Nothing noted.</p>}
          </Panel>

          {walletOn && (
            <Panel title="Wallet" lead="Prepaid money. It pays a bill at the till when the player is on the tab."
                   action={<div className="flex gap-2">{can('gaming_setup') && <Button size="sm" variant="ghost" onClick={() => setDialog('adjust')}>Correct</Button>}{can('gaming_desk') && <Button size="sm" onClick={() => setDialog('topup')}><Wallet aria-hidden="true" className="h-4 w-4" />Top up</Button>}</div>}>
              <p className="tabular text-[28px] font-semibold leading-none text-ink-900">{rs(balance)}</p>
              <ListState loading={w.loading && !w.data} error={w.error} />
              {(w.data || []).length > 0 && (
                <ul className="mt-4 divide-y divide-line text-small">
                  {w.data.map((r) => (
                    <li key={r.entry_id} className="flex items-center justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="font-medium text-ink-900">{{ TOPUP: 'Top-up', BONUS: 'Bonus', SPEND: 'Paid a bill', REFUND: 'Refund', ADJUST: 'Correction' }[r.kind]}</span>{r.invoice_number ? ` · ${r.invoice_number}` : ''}{r.note ? ` · ${r.note}` : ''}<span className="block text-caption text-ink-500">{dateTimeText(r.created_at)}{r.by ? ` · ${r.by}` : ''}</span></span>
                      <span className={`tabular font-medium ${r.amount < 0 ? 'text-danger' : 'text-success'}`}>{r.amount < 0 ? '−' : '+'}{rs(Math.abs(r.amount))}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          {walletOn && (
            <Panel title="Hour packs" lead="Prepaid hours, played from the board" action={can('gaming_desk') && <Button size="sm" variant="secondary" onClick={() => setDialog('pack')}><Plus aria-hidden="true" className="h-4 w-4" />Sell a pack</Button>}>
              <ListState loading={passes.loading && !passes.data} error={passes.error} empty={passes.data && !passes.data.length} emptyLabel="No packs" />
              {(passes.data || []).length > 0 && (
                <ul className="divide-y divide-line">
                  {passes.data.map((x) => (
                    <li key={x.pass_id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                      <div><p className="text-small font-medium text-ink-900">{x.name} <Badge tone={PASS_TONE[x.state]}>{PASS_LABEL[x.state]}</Badge></p><p className="text-caption text-ink-500">{duration(x.minutes_left * 60)} left of {duration(x.minutes_total * 60)}{x.expires_on ? ` · until ${x.expires_on}` : ''}</p></div>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel title="Recent sessions">
            {(player.recent_sessions || []).length === 0 ? <p className="text-small text-ink-500">No sessions yet.</p> : (
              <ul className="divide-y divide-line text-small">
                {player.recent_sessions.map((s) => <li key={s.session_id} className="flex items-center justify-between gap-3 py-2"><span><span className="font-medium text-ink-900">{s.station_name}</span> · {dateTimeText(s.started_at)} · {duration(s.elapsed_seconds)}</span><span className="tabular text-ink-700">{s.status === 'ENDED' ? rs(s.charge) : ''}</span></li>)}
              </ul>
            )}
          </Panel>
        </>
      )}
      {dialog === 'edit' && player && <PlayerForm player={player} onClose={() => setDialog(null)} onSaved={() => done('Saved')} />}
      {dialog === 'topup' && player && <TopUpDialog player={player} rules={settings.data?.topup_bonus} onClose={() => setDialog(null)} onDone={(o) => done(o.repeated ? 'That top-up was already added' : `Added ${rs(o.topup + o.bonus)} to the wallet`)} />}
      {dialog === 'adjust' && player && <AdjustDialog player={player} onClose={() => setDialog(null)} onDone={() => done('Wallet corrected')} />}
      {dialog === 'pack' && player && <SellPackDialog player={player} onClose={() => setDialog(null)} onDone={() => done('Pack sold')} />}
    </div>
  );
};

export default function GamingPlayers() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const selected = params.get('c');
  const [q, setQ] = useState('');
  const term = useDebounced(q.trim(), 250);
  const [version, setVersion] = useState(0);
  const [adding, setAdding] = useState(false);
  const list = useLoad(`/gaming/players?search=${encodeURIComponent(term)}&limit=40`);
  useEffect(() => { list.reload(); }, [version]); // eslint-disable-line react-hooks/exhaustive-deps
  const rows = useMemo(() => list.data || [], [list.data]);

  return (
    <div>
      <PageHeader title="Players" lead="Regulars, their wallet and hour packs. Walk-ins do not need to be added."
        action={can('gaming_desk') && <Button onClick={() => setAdding(true)}><UserPlus aria-hidden="true" className="h-4 w-4" />Add a player</Button>} />
      <div className="grid gap-5 xl:grid-cols-5">
        <div className={`xl:col-span-2 ${selected ? 'hidden xl:block' : ''}`}>
          <div className="relative mb-3">
            <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-400" />
            <Input aria-label="Find a player" className="pl-9" placeholder="Name, mobile or gamer tag" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ListState loading={list.loading && !list.data} error={list.error} empty={list.data && !rows.length} emptyLabel="No one found" emptyBody="Add them with the button above." />
          {rows.length > 0 && (
            <ul className="divide-y divide-line rounded-(--radius-card) border border-line bg-surface">
              {rows.map((r) => (
                <li key={r.customer_id}>
                  <button type="button" onClick={() => setParams({ c: r.customer_id })} aria-current={String(r.customer_id) === selected} className={`flex w-full items-center justify-between gap-3 px-4 py-3 text-left hover:bg-surface-2 ${String(r.customer_id) === selected ? 'bg-brand-50' : ''}`}>
                    <span className="min-w-0"><span className="block truncate text-small font-medium text-ink-900">{r.name}{r.gamer_tag ? ` · ${r.gamer_tag}` : ''}</span><span className="text-caption text-ink-500">{r.phone || 'No mobile'}</span></span>
                    {r.wallet > 0 && <span className="tabular text-small font-medium text-success">{rs(r.wallet)}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className={`xl:col-span-3 ${selected ? '' : 'hidden xl:block'}`}>
          {selected ? (
            <>
              <Button size="sm" variant="ghost" className="mb-3 xl:hidden" onClick={() => setParams({})}>Back to the list</Button>
              <Detail key={selected} id={selected} onChanged={() => setVersion((v) => v + 1)} />
            </>
          ) : <div className="rounded-(--radius-card) border border-dashed border-line p-10 text-center text-small text-ink-500">Choose a player to see their wallet, packs and sessions.</div>}
        </div>
      </div>
      {adding && <PlayerForm onClose={() => setAdding(false)} onSaved={(p) => { setAdding(false); setVersion((v) => v + 1); setParams({ c: p.customer_id }); }} />}
    </div>
  );
}
