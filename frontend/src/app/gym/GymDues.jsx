/* Who owes the gym money, for how long, and who has a credit limit or a payment promise. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, Input, ListState, PageHeader, Select, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { longDate, rsPaise, useDebounced, useLoad } from '../../lib/gym.js';
import { useT } from '../../i18n/useT.js';

const AGE = [['0', 'All who owe'], ['7', 'Owing for a week or more'], ['15', 'Owing for 15 days or more'], ['30', 'Owing for a month or more']];

export default function GymDues() {
  const tr = useT();
  const [age, setAge] = useState('0');
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const d = useLoad(`/gym/dues?overdue_days=${age}&q=${encodeURIComponent(search)}`);
  const data = d.data;
  return (
    <div>
      <PageHeader title={tr('Dues')} lead={tr('Everything members owe: memberships, packs and shop bills. Set a limit or note a promise on the member\'s page.')} />
      <ListState loading={d.loading && !data} error={d.error} />
      {data && (
        <div className="space-y-5">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={tr('Owed to you')} value={rsPaise(data.total_owed_paise)} tone={data.total_owed_paise > 0 ? 'danger' : undefined} />
            <StatCard label={tr('Members who owe')} value={data.members} />
            <StatCard label={tr('Over their limit')} value={data.over_limit} tone={data.over_limit ? 'warning' : undefined} note={tr('Stopped at the door')} />
            <StatCard label={tr('Promises missed')} value={data.promises_broken} tone={data.promises_broken ? 'danger' : undefined} />
          </section>
          <div className="flex flex-wrap gap-3">
            <Input aria-label={tr('Search')} placeholder={tr('Name, phone or member number')} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
            <Select aria-label={tr('How long')} value={age} onChange={(e) => setAge(e.target.value)} className="max-w-xs">{AGE.map(([k, l]) => <option key={k} value={k}>{tr(l)}</option>)}</Select>
          </div>
          {data.rows.length === 0 ? <p className="text-small text-ink-500">{tr('Nobody owes anything here.')}</p> : (
            <Table>
              <Thead><Th>{tr('Member')}</Th><Th>{tr('Phone')}</Th><Th className="text-right">{tr('Owes')}</Th><Th>{tr('Oldest bill')}</Th><Th>{tr('Limit')}</Th><Th>{tr('Promise')}</Th></Thead>
              <tbody>{data.rows.map((r) => (
                <Tr key={r.member_id}>
                  <Td><Link to={`/app/gym/members/${r.member_id}`} className="font-medium text-brand-600 hover:underline">{r.name}</Link><div className="text-caption text-ink-500">{r.member_code} · {r.bills} {tr('bills')}</div></Td>
                  <Td className="tabular">{r.phone}</Td>
                  <Td className="tabular text-right"><Badge tone="danger">{rsPaise(r.owed_paise)}</Badge></Td>
                  <Td className="whitespace-nowrap">{longDate(r.oldest_on)}<div className="text-caption text-ink-500">{r.days_old} {tr('days')}</div></Td>
                  <Td>{r.credit_limit_paise == null ? <span className="text-ink-500">-</span> : <>{rsPaise(r.credit_limit_paise)} {r.over_limit && <Badge tone="warning">{tr('Over')}</Badge>}</>}</Td>
                  <Td>{r.promise_on ? <>{longDate(r.promise_on)}{r.promise_paise ? ` · ${rsPaise(r.promise_paise)}` : ''} {r.promise_broken && <Badge tone="danger">{tr('Missed')}</Badge>}</> : <span className="text-ink-500">-</span>}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
