import { useState } from 'react';
import { Text, View } from 'react-native';
import { currentBusiness, useSession } from '../lib/session.ts';
import { hasFeature } from '../lib/access.ts';
import { t, fill } from '../lib/i18n.ts';
import { Card, Panel, SetupShell, useList } from '../lib/formKit.tsx';
import { Chips, Empty, Failed, Line, Loading, SectionTitle, Soft, color, Group } from '../lib/ui.tsx';
import { display } from '../lib/theme.ts';
import { PERIODS, canSeeResults, money, problemCount, resultsPath, share, type Results } from '../lib/loyaltyResults.ts';

const Tile = ({ label, value, hint }: { label: string; value: string; hint?: string }) => (
  <View style={{ flexBasis: '47%', flexGrow: 1, borderWidth: 1, borderColor: color.line, borderRadius: 12, padding: 12, backgroundColor: color.card }}>
    <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
    <Text style={{ color: color.ink, fontSize: 22, fontFamily: display.bold, fontVariant: ['tabular-nums'] }}>{value}</Text>
    {hint ? <Text style={{ color: color.soft, fontSize: 12 }}>{hint}</Text> : null}
  </View>
);

export default function LoyaltyResults() {
  const me = currentBusiness(useSession());
  const [days, setDays] = useState('30');
  const ok = canSeeResults(me?.role) && hasFeature(me, 'loyalty_programmes');
  const { data, error, reload } = useList<Results>(ok ? resultsPath(days) : null);
  const tt = data?.totals;
  return (
    <SetupShell title="Card results" sub="How your loyalty cards are doing" ok={ok} denied="You do not have access to the card results.">
      <Chips items={PERIODS} value={days} onChange={setDays} />
      {!data ? (error ? <Failed message={error} onRetry={reload} /> : <Loading />) : !data.cards.length || !tt ? <Empty>No cards yet. Make one on the web under Loyalty & coupons.</Empty> : (
        <Panel>
          {problemCount(data) > 0 ? <Soft style={{ color: color.warn }}>{fill(t('Something in the card books needs a look ({n} found). Nothing was changed. Ask support to check.'), { n: String(problemCount(data)) })}</Soft> : null}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
            <Tile label="Members" value={String(tt.members)} hint={fill(t('{n} joined in this period'), { n: String(tt.joined) })} />
            <Tile label="Came in" value={share(data.active_share)} hint={fill(t('{n} members earned or used'), { n: String(tt.active) })} />
            <Tile label="Came back" value={String(tt.repeaters)} hint={t('Members with 2+ visits')} />
            <Tile label="Spend on cards" value={money(tt.spend_paise)} hint={fill(t('{n} visits'), { n: String(tt.visits) })} />
            <Tile label="Rewards claimed" value={String(tt.claims)} hint={fill(t('Worth {value}'), { value: money(tt.claim_paise) })} />
            <Tile label="Members are owed" value={money(tt.owed_paise)} hint={t('Value of balances not yet used')} />
            <Tile label="Scanned the bill QR" value={String(tt.bill_scans ?? 0)} hint={t('stamped or earned by scanning the bill')} />
            <Tile label="Agreed to offers" value={String(tt.consented)} />
          </View>
          <Card>
            <SectionTitle>By card</SectionTitle>
            <Group>{data.cards.map((c) => <Line key={c.programme_id} left={c.name} right={money(c.owed_paise)} sub={fill(t('Given {given}, used {used}, claimed {n}'), { given: String(c.earned), used: String(c.used), n: String(c.claims) })} />)}</Group>
          </Card>
          {data.top_rewards.length ? (
            <Card>
              <SectionTitle>Most claimed rewards</SectionTitle>
              <Group>{data.top_rewards.map((r) => <Line key={r.reward_id} left={r.name} right={String(r.claims)} />)}</Group>
            </Card>
          ) : null}
        </Panel>
      )}
    </SetupShell>
  );
}
