/* Wallet & Credits: who has money left with the gym, and a way into the dues side. A member's own wallet (add money, pay a bill, refund) is on their page. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Input, ListState, PageHeader, StatCard, Table, Td, Th, Thead, Tr } from '../../components/ui.jsx';
import { longDate, qs, rsPaise, useDebounced, useLoad } from '../../lib/gym.js';
import { useT } from '../../i18n/useT.js';

export default function GymWallets() {
  const tr = useT();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const d = useLoad(`/gym/wallets${qs({ q: search.trim() })}`);
  const data = d.data;
  const dues = useLoad('/gym/dues?overdue_days=0&limit=1');
  return (
    <div>
      <PageHeader title={tr('Wallet and credits')} lead={tr('Money members have left with you, and money they owe. Open a member to add money or pay a bill from their wallet.')} />
      <ListState loading={d.loading && !data} error={d.error} />
      {data && (
        <div className="space-y-5">
          <section className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label={tr('Held for members')} value={rsPaise(data.held_paise)} note={tr('Their money, not your income yet')} />
            <StatCard label={tr('Members with a balance')} value={data.members} />
            {dues.data && <StatCard label={tr('Members owe you')} value={rsPaise(dues.data.total_owed_paise)} tone={dues.data.total_owed_paise > 0 ? 'danger' : undefined} to="/app/gym/dues" note={`${dues.data.members} ${tr('members')}`} />}
          </section>
          <Input aria-label={tr('Search')} placeholder={tr('Name, phone or member number')} value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          {data.rows.length === 0 ? <p className="text-small text-ink-500">{tr('No member has money in the wallet.')}</p> : (
            <Table>
              <Thead><Th>{tr('Member')}</Th><Th>{tr('Phone')}</Th><Th>{tr('Last moved')}</Th><Th className="text-right">{tr('Balance')}</Th></Thead>
              <tbody>{data.rows.map((m) => (
                <Tr key={m.member_id}>
                  <Td><Link to={`/app/gym/members/${m.member_id}`} className="font-medium text-brand-600 hover:underline">{m.name}</Link><div className="text-caption text-ink-500">{m.member_code}</div></Td>
                  <Td className="tabular">{m.phone}</Td>
                  <Td className="whitespace-nowrap">{longDate(String(m.last_moved).slice(0, 10))}</Td>
                  <Td className="tabular text-right">{rsPaise(m.balance_paise)}</Td>
                </Tr>
              ))}</tbody>
            </Table>
          )}
        </div>
      )}
    </div>
  );
}
