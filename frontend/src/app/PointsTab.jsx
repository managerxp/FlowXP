/*
 * Loyalty points and tiers (a tab of the Loyalty page): how points are earned and spent, the tiers,
 * what is owed to customers in points, and a way to give or take points for one customer.
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { MobileLookup } from '../components/LoyaltyCard.jsx';
import { Alert, Button, Card, Field, Input, ListState, Table, Td, Th, Thead, Tr, useToast } from '../components/ui.jsx';

const Summary = ({ refreshKey }) => {
  const [s, setS] = useState(null);
  useEffect(() => { api('/loyalty/points-summary').then(setS).catch(() => setS(null)); }, [refreshKey]);
  if (!s || !s.enabled) return null;
  const Stat = ({ label, value }) => <Card className="p-4"><p className="text-xs text-ink-500">{label}</p><p className="mt-1 text-lg font-semibold text-ink-900">{value}</p></Card>;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Customers with points" value={s.members_with_points} />
        <Stat label="Points outstanding" value={`${s.outstanding_points} (${formatCurrency(s.liability)})`} />
        <Stat label="Earned, last 30 days" value={s.earned_30d} />
        <Stat label="Spent, last 30 days" value={`${s.redeemed_30d} (${formatCurrency(s.discount_30d)} off)`} />
      </div>
      {s.top.length > 0 && (
        <Table>
          <Thead><Th>Top holders</Th><Th className="text-right">Points</Th><Th className="text-right">Earned over time</Th></Thead>
          <tbody>{s.top.map((c) => <Tr key={c.customer_id}><Td className="font-medium">{c.name}<span className="block text-xs text-ink-400">{c.phone}</span></Td><Td className="text-right">{c.balance}</Td><Td className="text-right">{c.lifetime ?? 0}</Td></Tr>)}</tbody>
        </Table>
      )}
    </div>
  );
};

const Adjust = ({ onDone }) => {
  const toast = useToast();
  const [customer, setCustomer] = useState(null);
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const card = await api(`/loyalty/customers/${customer.customer_id}/points/adjust`, { method: 'POST', body: { points: Number(points), note } });
      toast.success(`${customer.name} now has ${card.balance} points`);
      setPoints(''); setNote(''); onDone();
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-semibold text-ink-900">Give or take points</h3>
      <MobileLookup onPick={(c) => setCustomer(c)} placeholder="Customer mobile number" />
      {customer && (
        <form onSubmit={save} className="mt-3 grid items-end gap-3 sm:grid-cols-[8rem_1fr_auto]">
          <Field id="adj-p" label={`Points for ${customer.name}`} hint="Negative takes away"><Input id="adj-p" type="number" step="1" value={points} onChange={(e) => setPoints(e.target.value)} required /></Field>
          <Field id="adj-n" label="Reason (kept in their history)"><Input id="adj-n" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Birthday gift, service recovery…" required /></Field>
          <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </form>
      )}
      <Alert>{error}</Alert>
    </Card>
  );
};

const PointsTab = () => {
  const toast = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    api('/loyalty/points-program').then((p) => setForm({ ...p, tiers: p.tiers.map((t) => ({ ...t })) })).catch((e) => setError(e.message));
  }, []);
  if (!form) return <ListState loading={!error} error={error} />;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setTier = (i, key, value) => setForm((f) => ({ ...f, tiers: f.tiers.map((t, j) => (j === i ? { ...t, [key]: value } : t)) }));
  const example = Math.floor(Number(form.earn_per_100) * 5);

  const save = async (e) => {
    e.preventDefault();
    setError(''); setBusy(true);
    try {
      const saved = await api('/loyalty/points-program', {
        method: 'PUT',
        body: {
          is_enabled: form.is_enabled, earn_per_100: Number(form.earn_per_100), point_value: Number(form.point_value),
          min_redeem_points: Number(form.min_redeem_points), max_redeem_pct: Number(form.max_redeem_pct),
          tiers: form.tiers.map((t) => ({ name: t.name, min_points: Number(t.min_points), multiplier: Number(t.multiplier) }))
        }
      });
      setForm({ ...saved, tiers: saved.tiers.map((t) => ({ ...t })) });
      setRefreshKey((k) => k + 1);
      toast.success('Saved');
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="space-y-8">
      <form onSubmit={save} className="max-w-2xl space-y-5">
        <Alert>{error}</Alert>
        <label className="flex items-center gap-3 text-sm font-medium text-ink-900">
          <input type="checkbox" checked={form.is_enabled} onChange={(e) => setForm((f) => ({ ...f, is_enabled: e.target.checked }))} /> Loyalty points are on
        </label>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field id="earn" label={`Points earned per ${formatCurrency(100)} paid`} hint={`A ${formatCurrency(500)} bill earns ${example} points.`}><Input id="earn" type="number" step="0.5" min="0.5" value={form.earn_per_100} onChange={set('earn_per_100')} /></Field>
          <Field id="val" label="One point is worth (in rupees)" hint="What a customer saves per point spent."><Input id="val" type="number" step="0.25" min="0.01" value={form.point_value} onChange={set('point_value')} /></Field>
          <Field id="min" label="Least points that can be spent"><Input id="min" type="number" step="1" min="1" value={form.min_redeem_points} onChange={set('min_redeem_points')} /></Field>
          <Field id="max" label="Most of one bill points can pay (%)"><Input id="max" type="number" step="1" min="1" max="100" value={form.max_redeem_pct} onChange={set('max_redeem_pct')} /></Field>
        </div>

        <div>
          <h3 className="text-sm font-semibold text-ink-900">Tiers</h3>
          <p className="mb-2 text-xs text-ink-500">A tier is decided by the points a customer has earned over time (spending points never lowers it). A higher tier earns points faster. The first tier must start at 0. Leave empty for no tiers.</p>
          <div className="space-y-2">
            {form.tiers.map((t, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_8rem_7rem_auto]">
                <Input aria-label="Tier name" placeholder="Silver" value={t.name} onChange={(e) => setTier(i, 'name', e.target.value)} />
                <Input aria-label="Points to reach it" type="number" min="0" step="1" placeholder="From points" value={t.min_points} onChange={(e) => setTier(i, 'min_points', e.target.value)} />
                <Input aria-label="Earning multiplier" type="number" min="1" max="10" step="0.25" placeholder="× earning" value={t.multiplier} onChange={(e) => setTier(i, 'multiplier', e.target.value)} />
                <button type="button" onClick={() => setForm((f) => ({ ...f, tiers: f.tiers.filter((_, j) => j !== i) }))} className="text-xs font-semibold text-ink-400 hover:text-danger">Remove</button>
              </div>
            ))}
          </div>
          {form.tiers.length < 6 && (
            <Button type="button" variant="secondary" size="sm" className="mt-2" onClick={() => setForm((f) => ({ ...f, tiers: [...f.tiers, { name: '', min_points: f.tiers.length ? '' : 0, multiplier: 1 }] }))}>Add tier</Button>
          )}
        </div>
        <Button type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
      </form>

      <Summary refreshKey={refreshKey} />
      {form.is_enabled && <Adjust onDone={() => setRefreshKey((k) => k + 1)} />}
    </div>
  );
};

export default PointsTab;
