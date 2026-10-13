/* Rewards and reminders: what earns points, the catalogue, what is waiting to be handed over, what the gym owes in points, and which reminders go out by themselves. */
import { useEffect, useState } from 'react';
import { Archive, ArchiveRestore, Check, Plus } from 'lucide-react';
import { api } from '../../lib/api.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { dayTime, rs, useLoad } from '../../lib/gym.js';
import { Alert, Badge, Button, Field, Input, ListState, Modal, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr, useDialog, useToast } from '../../components/ui.jsx';
import { NumberField, Panel, Tabs, Toggle, useAction } from '../salon/parts.jsx';

const Rules = ({ manager }) => {
  const r = useLoad('/gym/rewards/rules');
  const [f, setF] = useState(null);
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  useEffect(() => { if (r.data) setF({ ...r.data, milestones: r.data.milestones || [], expiry_days: r.data.expiry_days ?? '', max_points_per_day: r.data.max_points_per_day ?? '' }); }, [r.data]);
  if (!f) return <ListState loading={r.loading} error={r.error} />;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));
  const save = () => run(async () => {
    setError('');
    try {
      await api('/gym/rewards/rules', { method: 'PUT', body: {
        is_enabled: f.is_enabled, visit_points: Number(f.visit_points), renewal_flat_points: Number(f.renewal_flat_points), renewal_points_per_100: Number(f.renewal_points_per_100),
        referral_points: Number(f.referral_points), referee_points: Number(f.referee_points), birthday_points: Number(f.birthday_points),
        milestones: f.milestones.map((m) => ({ visits: Number(m.visits), points: Number(m.points) })), expiry_days: f.expiry_days === '' ? null : Number(f.expiry_days),
        max_points_per_day: f.max_points_per_day === '' ? null : Number(f.max_points_per_day), min_redeem_points: Number(f.min_redeem_points), point_value: Number(f.point_value)
      } });
      r.reload();
    } catch (e) { setError(e.message); }
  }, 'Rewards saved');
  const off = !manager;
  return (
    <div className="space-y-5">
      <Panel title="Points for what members do" lead="Points are paid once for each real event, never for a refused check-in, a repeat scan or an unpaid membership.">
        <Toggle id="rw-on" checked={f.is_enabled} onChange={set('is_enabled')} disabled={off} label="Rewards are on" hint="Nothing is paid until you switch this on." />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <NumberField id="rw-visit" label="For a visit (once a day)" value={f.visit_points} onChange={set('visit_points')} min={0} step={1} disabled={off} />
          <NumberField id="rw-birthday" label="On their birthday (once a year)" value={f.birthday_points} onChange={set('birthday_points')} min={0} step={1} disabled={off} />
          <NumberField id="rw-flat" label="For a paid membership: flat points" value={f.renewal_flat_points} onChange={set('renewal_flat_points')} min={0} step={1} disabled={off} />
          <NumberField id="rw-per100" label="For a paid membership: points per ₹100" value={f.renewal_points_per_100} onChange={set('renewal_points_per_100')} min={0} disabled={off} hint="On the price before GST." />
          <NumberField id="rw-ref" label="Referral: the member who brings a friend" value={f.referral_points} onChange={set('referral_points')} min={0} step={1} disabled={off} hint="Paid when the friend's first membership is paid." />
          <NumberField id="rw-referee" label="Referral: the new member" value={f.referee_points} onChange={set('referee_points')} min={0} step={1} disabled={off} />
        </div>
      </Panel>
      <Panel title="Milestones" lead="A bonus when a member's visit count reaches a number, paid once.">
        {f.milestones.map((m, i) => (
          <div key={i} className="mb-2 flex items-end gap-3">
            <NumberField id={`ms-v-${i}`} label="Visits" value={m.visits} onChange={(v) => set('milestones')(f.milestones.map((x, j) => (j === i ? { ...x, visits: v } : x)))} min={1} step={1} disabled={off} />
            <NumberField id={`ms-p-${i}`} label="Bonus points" value={m.points} onChange={(v) => set('milestones')(f.milestones.map((x, j) => (j === i ? { ...x, points: v } : x)))} min={1} step={1} disabled={off} />
            {!off && <Button variant="ghost" size="sm" onClick={() => set('milestones')(f.milestones.filter((_, j) => j !== i))}>Remove</Button>}
          </div>
        ))}
        {!off && f.milestones.length < 20 && <Button size="sm" variant="secondary" onClick={() => set('milestones')([...f.milestones, { visits: '', points: '' }])}><Plus aria-hidden="true" className="h-4 w-4" />Add a milestone</Button>}
      </Panel>
      <Panel title="Limits">
        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField id="rw-exp" label="Points last (days)" value={f.expiry_days} onChange={set('expiry_days')} min={1} step={1} disabled={off} hint="Empty means they never expire." />
          <NumberField id="rw-cap" label="Most points a member can earn in a day" value={f.max_points_per_day} onChange={set('max_points_per_day')} min={1} step={1} disabled={off} hint="Empty means no limit." />
          <NumberField id="rw-min" label="Fewest points that can be spent at once" value={f.min_redeem_points} onChange={set('min_redeem_points')} min={0} step={1} disabled={off} />
          <NumberField id="rw-value" label="What one point is worth (₹)" value={f.point_value} onChange={set('point_value')} min={0} prefix="₹" disabled={off} hint="Only used for the figure of what you owe in points." />
        </div>
      </Panel>
      {error && <Alert>{error}</Alert>}
      {manager && <Button onClick={save} loading={busy}>Save rewards</Button>}
    </div>
  );
};

const KINDS = [['ITEM', 'A gift handed over at the desk'], ['FREE_DAYS', 'Free days added to the membership'], ['DISCOUNT', 'A discount on the next bill']];

const RewardForm = ({ reward, onClose, onSaved }) => {
  const [f, setF] = useState(reward ? { ...reward, stock: reward.stock ?? '', value: String(reward.value) } : { name: '', description: '', points_cost: '', kind: 'ITEM', value: '0', stock: '' });
  const [error, setError] = useState('');
  const [busy, run] = useAction();
  const save = () => run(async () => {
    setError('');
    try { onSaved(await api(reward ? `/gym/rewards/${reward.reward_id}` : '/gym/rewards', { method: reward ? 'PUT' : 'POST', body: { name: f.name, description: f.description || null, points_cost: Number(f.points_cost), kind: f.kind, value: Number(f.value || 0), stock: f.stock === '' ? null : Number(f.stock) } })); } catch (e) { setError(e.message); }
  }, null);
  return (
    <Modal title={reward ? `Edit ${reward.name}` : 'New reward'} onClose={onClose} footer={<><Button variant="secondary" onClick={onClose}>Cancel</Button><Button onClick={save} loading={busy} disabled={!f.name.trim() || !(Number(f.points_cost) > 0)}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field id="r-name" label="Name"><Input id="r-name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
        <NumberField id="r-cost" label="Costs (points)" value={f.points_cost} onChange={(v) => setF({ ...f, points_cost: v })} min={1} step={1} />
        <Field id="r-kind" label="What it is"><Select id="r-kind" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{KINDS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
        {f.kind !== 'ITEM' && <NumberField id="r-val" label={f.kind === 'FREE_DAYS' ? 'Days' : 'Amount (₹)'} value={f.value} onChange={(v) => setF({ ...f, value: v })} min={1} step={f.kind === 'FREE_DAYS' ? 1 : 'any'} />}
        <NumberField id="r-stock" label="In stock (optional)" value={f.stock} onChange={(v) => setF({ ...f, stock: v })} min={0} step={1} hint="Empty means no limit." />
        <div className="sm:col-span-2"><Field id="r-desc" label="Description (optional)"><Input id="r-desc" value={f.description || ''} onChange={(e) => setF({ ...f, description: e.target.value })} /></Field></div>
      </div>
      {error && <div className="mt-3"><Alert>{error}</Alert></div>}
    </Modal>
  );
};

const Catalogue = ({ manager }) => {
  const toast = useToast();
  const list = useLoad('/gym/rewards?all=true');
  const [edit, setEdit] = useState(null);
  const rows = list.data || [];
  const toggle = async (r) => { try { await api(`/gym/rewards/${r.reward_id}/${r.is_active ? 'archive' : 'restore'}`, { method: 'POST' }); list.reload(); } catch (e) { toast.error(e.message); } };
  return (
    <div>
      {manager && <div className="mb-4"><Button onClick={() => setEdit('new')}><Plus aria-hidden="true" className="h-4 w-4" />New reward</Button></div>}
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel="No rewards yet." emptyBody="Add what members can spend their points on." />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Reward</Th><Th>Costs</Th><Th>Kind</Th><Th>Stock</Th><Th> </Th></Thead>
          <tbody>{rows.map((r) => (
            <Tr key={r.reward_id}>
              <Td><span className={r.is_active ? 'font-medium' : 'text-ink-500 line-through'}>{r.name}</span>{r.description && <span className="block text-caption text-ink-500">{r.description}</span>}</Td>
              <Td className="tabular">{r.points_cost} points</Td>
              <Td>{r.kind === 'FREE_DAYS' ? `${r.value} free days` : r.kind === 'DISCOUNT' ? `${rs(r.value)} off` : 'Gift'}</Td>
              <Td>{r.stock == null ? 'No limit' : r.stock}</Td>
              <Td className="text-right">{manager && <span className="inline-flex gap-1"><Button size="sm" variant="ghost" onClick={() => setEdit(r)}>Edit</Button><Button size="sm" variant="ghost" onClick={() => toggle(r)}>{r.is_active ? <Archive aria-hidden="true" className="h-4 w-4" /> : <ArchiveRestore aria-hidden="true" className="h-4 w-4" />}</Button></span>}</Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
      {edit && <RewardForm reward={edit === 'new' ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); toast.success('Saved'); list.reload(); }} />}
    </div>
  );
};

const Redemptions = ({ manager }) => {
  const toast = useToast();
  const dialog = useDialog();
  const list = useLoad('/gym/redemptions?status=ISSUED');
  const rows = list.data || [];
  const act = async (r, what) => {
    if (what === 'cancel' && !await dialog.confirm({ title: 'Cancel this reward?', body: `${r.member_name} gets their ${r.points} points back.`, confirmLabel: 'Cancel it', danger: true })) return;
    try { await api(`/gym/redemptions/${r.redemption_id}/${what}`, { method: 'POST', body: {} }); toast.success(what === 'fulfil' ? 'Marked as handed over' : 'Cancelled'); list.reload(); } catch (e) { toast.error(e.message); }
  };
  return (
    <div>
      <ListState loading={list.loading && !rows.length} error={list.error} empty={!list.loading && !rows.length} emptyLabel="Nothing is waiting to be handed over." />
      {rows.length > 0 && (
        <Table>
          <Thead><Th>Member</Th><Th>Reward</Th><Th>Points</Th><Th>When</Th><Th> </Th></Thead>
          <tbody>{rows.map((r) => (
            <Tr key={r.redemption_id}>
              <Td>{r.member_name}<span className="block text-caption text-ink-500">{r.member_code}</span></Td>
              <Td>{r.reward_name}</Td><Td className="tabular">{r.points}</Td><Td className="whitespace-nowrap text-ink-500">{dayTime(r.created_at)}</Td>
              <Td className="text-right"><span className="inline-flex gap-1"><Button size="sm" onClick={() => act(r, 'fulfil')}><Check aria-hidden="true" className="h-4 w-4" />Handed over</Button>{manager && <Button size="sm" variant="ghost" onClick={() => act(r, 'cancel')}>Cancel</Button>}</span></Td>
            </Tr>
          ))}</tbody>
        </Table>
      )}
    </div>
  );
};

const Owed = () => {
  const r = useLoad('/gym/reports/rewards');
  const d = r.data;
  return (
    <div>
      <ListState loading={r.loading && !d} error={r.error} />
      {d && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Points outstanding" value={d.outstanding_points.toLocaleString('en-IN')} note={`${d.members_with_points} members`} />
            <StatCard label="What that is worth" value={rs(d.liability)} note="Points outstanding × what a point is worth" />
            <StatCard label="Expire within 30 days" value={d.expiring_in_30_days.toLocaleString('en-IN')} />
            <StatCard label="Spent this month" value={d.redeemed.toLocaleString('en-IN')} note={`${d.earned.toLocaleString('en-IN')} earned, ${d.expired.toLocaleString('en-IN')} expired`} />
          </div>
          <Panel title="Where points came from this month">
            {d.earned_by_reason.length ? <ul className="space-y-1.5 text-small">{d.earned_by_reason.map((x) => <li key={x.reason} className="flex justify-between"><span>{{ VISIT: 'Visits', RENEWAL: 'Paid memberships', REFERRAL: 'Referrals', MILESTONE: 'Milestones', BIRTHDAY: 'Birthdays', MANUAL: 'Added by hand', REFUND: 'Returned' }[x.reason] || x.reason}</span><span className="tabular font-medium">{x.points.toLocaleString('en-IN')}</span></li>)}</ul> : <p className="text-small text-ink-500">Nothing earned yet this month.</p>}
          </Panel>
        </div>
      )}
    </div>
  );
};

const Reminders = ({ manager }) => {
  const toast = useToast();
  const list = useLoad('/gym/automations');
  const [cfg, setCfg] = useState({});
  const save = async (a, patch) => {
    try { await api(`/gym/automations/${a.key}`, { method: 'PUT', body: { is_enabled: patch.is_enabled ?? a.is_enabled, config: { ...a.config, ...(cfg[a.key] || {}), ...(patch.config || {}) } } }); toast.success('Saved'); list.reload(); } catch (e) { toast.error(e.message); }
  };
  const LABELS = { days_before: 'Days before it ends', days_overdue: 'Days after the sale', repeat_days: 'Then every (days)', days: 'Days without a visit' };
  return (
    <div className="space-y-3">
      <Alert>Reminders go out as WhatsApp or SMS through your Messaging settings, between 9 am and 8 pm, and never twice for the same thing. With messaging switched off, none are sent.</Alert>
      <ListState loading={list.loading && !list.data} error={list.error} />
      {(list.data || []).filter((a) => !a.internal).map((a) => (
        <div key={a.key} className="rounded-(--radius-card) border border-line bg-surface p-4">
          <Toggle id={`au-${a.key}`} checked={a.is_enabled} onChange={(v) => save(a, { is_enabled: v })} disabled={!manager} label={a.label} hint={a.description} />
          {Object.keys(a.defaults).length > 0 && (
            <div className="mt-3 flex flex-wrap items-end gap-3 pl-7">
              {Object.keys(a.defaults).map((k) => (
                <NumberField key={k} id={`au-${a.key}-${k}`} label={LABELS[k] || k} value={cfg[a.key]?.[k] ?? a.config[k]} onChange={(v) => setCfg((c) => ({ ...c, [a.key]: { ...c[a.key], [k]: Number(v) } }))} min={1} step={1} disabled={!manager} />
              ))}
              {manager && <Button size="sm" variant="secondary" onClick={() => save(a, {})}>Save</Button>}
            </div>
          )}
        </div>
      ))}
    </div>
  );
};

export default function GymRewards() {
  const { can } = useAuth();
  const [tab, setTab] = useState('rules');
  const manager = can('gym_setup');
  const tabs = [{ key: 'rules', label: 'Rules' }, { key: 'catalogue', label: 'Rewards' }, { key: 'waiting', label: 'To hand over' }, ...(can('reports') || manager ? [{ key: 'owed', label: 'What you owe' }] : []), ...(manager ? [{ key: 'reminders', label: 'Reminders' }] : [])];
  return (
    <div>
      <PageHeader title="Rewards and reminders" lead="Points members earn and spend, and the messages that go out on their own." />
      <Tabs tabs={tabs} value={tab} onChange={setTab} />
      {tab === 'rules' && <Rules manager={manager} />}
      {tab === 'catalogue' && <Catalogue manager={manager} />}
      {tab === 'waiting' && <Redemptions manager={manager} />}
      {tab === 'owed' && <Owed />}
      {tab === 'reminders' && <Reminders manager={manager} />}
    </div>
  );
}
