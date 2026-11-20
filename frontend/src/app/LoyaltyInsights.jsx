/*
 * Card results (a tab of the Loyalty page): is the loyalty card working? Members, who came back, what was given and used, what members are still owed,
 * and a health check that names anything wrong in the books. Read straight from the ledger by GET /loyalty/analytics (owner only).
 */
import { useEffect, useState } from 'react';
import { api, formatCurrency } from '../lib/api.js';
import { Alert, Card, ListState, Select } from '../components/ui.jsx';
import { useT } from '../i18n/useT.js';

const rupees = (paise) => formatCurrency(Number(paise) / 100);   // loyalty endpoints return raw paise
const Tile = ({ label, value, hint }) => {
  const tr = useT();
  return (
  <div className="rounded-xl border border-line bg-surface p-4"><p className="text-small text-ink-500">{tr(label)}</p><p className="mt-1 text-xl font-semibold tabular-nums text-ink-900">{value}</p>{hint && <p className="mt-1 text-small text-ink-500">{tr(hint)}</p>}</div>
);
};

const LoyaltyInsights = () => {
  const tr = useT();
  const [days, setDays] = useState('30'); const [d, setD] = useState(null); const [error, setError] = useState('');
  useEffect(() => { setD(null); api(`/loyalty/analytics?days=${days}`).then((r) => { setD(r); setError(''); }).catch((e) => { setError(e.message); setD({ cards: [], series: [], top_rewards: [], problems: [], totals: null }); }); }, [days]);
  const t = d?.totals; const max = Math.max(1, ...(d?.series || []).map((s) => s.earns + s.redeems));
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-xl text-small text-ink-500">{tr('How your loyalty cards are doing. Figures come straight from the card ledger.')}</p>
        <label className="flex items-center gap-2 text-small text-ink-700">{tr('Period')}
          <Select value={days} onChange={(e) => setDays(e.target.value)} aria-label={tr('Period')}><option value="7">{tr('Last 7 days')}</option><option value="30">{tr('Last 30 days')}</option><option value="90">{tr('Last 90 days')}</option><option value="365">{tr('Last year')}</option></Select></label>
      </div>
      {error && <Alert>{error}</Alert>}
      <ListState loading={d === null} empty={d && !d.cards.length && !error} emptyLabel={tr('No cards yet. Make one in the Loyalty cards tab.')} />
      {d?.problems?.length > 0 && (
        <Alert>{tr('Something in the card books needs a look: {{v}}. Nothing was changed. Ask support to check.', { v: d.problems.map((p) => `${p.text} (${p.ids.length})`).join('; ') })}</Alert>)}
      {t && d.cards.length > 0 && (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Tile label={tr('Members')} value={t.members} hint={tr('{{joined}} joined in this period', { joined: t.joined })} />
            <Tile label={tr('Came in')} value={d.active_share === null ? '-' : `${d.active_share}%`} hint={tr('{{active}} members earned or used', { active: t.active })} />
            <Tile label={tr('Came back')} value={t.repeaters} hint={tr('members with 2+ visits')} />
            <Tile label={tr('Spend on cards')} value={rupees(t.spend_paise)} hint={tr('{{visits}} visits', { visits: t.visits })} />
            <Tile label={tr('Rewards claimed')} value={t.claims} hint={tr('worth {{rupees}}', { rupees: rupees(t.claim_paise) })} />
            <Tile label={tr('Members are owed')} value={rupees(t.owed_paise)} hint={tr('value of balances not yet used')} />
            <Tile label={tr('Scanned the bill QR')} value={t.bill_scans ?? 0} hint={tr('stamped or earned by scanning the bill')} />
            <Tile label={tr('Agreed to offers')} value={t.consented} hint={tr('can be sent offers')} />
          </div>
          {d.series.length > 0 && (
            <Card className="p-4"><h2 className="mb-3 font-semibold text-ink-900">{tr('Day by day')}</h2>
              <div className="flex h-28 items-end gap-1" role="img" aria-label={tr('Visits and rewards used each day')}>
                {d.series.map((s) => <div key={s.day} title={tr('{{day}}: {{earns}} earned, {{redeems}} used', { day: s.day, earns: s.earns, redeems: s.redeems })} className="flex-1 rounded-t bg-brand-500" style={{ height: `${Math.max(4, ((s.earns + s.redeems) / max) * 100)}%` }} />)}
              </div></Card>)}
          <Card className="overflow-x-auto p-4"><h2 className="mb-2 font-semibold text-ink-900">{tr('By card')}</h2>
            <table className="w-full text-left text-small"><thead className="text-ink-500"><tr><th className="py-1 pr-3">{tr('Card')}</th><th className="pr-3">{tr('Members')}</th><th className="pr-3">{tr('Active')}</th><th className="pr-3">{tr('Given')}</th><th className="pr-3">{tr('Used')}</th><th className="pr-3">{tr('Expired')}</th><th className="pr-3">{tr('Claims')}</th><th>{tr('Owed')}</th></tr></thead>
              <tbody className="tabular-nums text-ink-900">{d.cards.map((c) => <tr key={c.programme_id} className="border-t border-line"><td className="py-2 pr-3">{c.name}</td><td className="pr-3">{c.members}</td><td className="pr-3">{c.active}</td><td className="pr-3">{c.earned}</td><td className="pr-3">{c.used}</td><td className="pr-3">{c.expired}</td><td className="pr-3">{c.claims}</td><td>{rupees(c.owed_paise)}</td></tr>)}</tbody></table></Card>
          {d.top_rewards.length > 0 && (
            <Card className="p-4"><h2 className="mb-2 font-semibold text-ink-900">{tr('Most claimed rewards')}</h2>
              <ul className="divide-y divide-line">{d.top_rewards.map((r) => <li key={r.reward_id} className="flex justify-between py-2 text-small"><span className="text-ink-900">{r.name}</span><span className="tabular-nums text-ink-700">{r.claims}</span></li>)}</ul></Card>)}
        </>)}
    </div>
  );
};

export default LoyaltyInsights;
