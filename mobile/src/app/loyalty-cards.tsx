import { router } from 'expo-router';
import { View } from 'react-native';
import { currentBusiness, useSession } from '../lib/session.ts';
import { hasFeature } from '../lib/access.ts';
import { Panel, SetupShell, useList } from '../lib/formKit.tsx';
import { Empty, Failed, Loading } from '../lib/ui.tsx';
import { Pressable } from 'react-native';
import { canDesign, lookOf, type Programme } from '../lib/cardDesign.ts';
import CardFace from '../lib/CardFace.tsx';

/* Your loyalty cards, each shown as customers see it. Tap one to change its colours, icon, heading and message. */
export default function LoyaltyCards() {
  const me = currentBusiness(useSession());
  const ok = canDesign(me?.role) && hasFeature(me, 'loyalty_programmes');
  const { data, error, reload } = useList<Programme[]>(ok ? '/loyalty/programmes' : null);
  return (
    <SetupShell title="Design loyalty cards" sub="Change how your cards look" ok={ok} denied="You do not have access to the card designer.">
      {!data ? (error ? <Failed message={error} onRetry={reload} /> : <Loading />) : !data.length ? <Empty>No cards yet. Make one on the web under Loyalty & coupons.</Empty> : (
        <Panel>
          {data.map((p) => (
            <Pressable key={p.programme_id} accessibilityRole="button" accessibilityLabel={p.name} onPress={() => router.push({ pathname: '/loyalty-card-design', params: { id: String(p.programme_id) } })}>
              <View pointerEvents="none"><CardFace look={lookOf(p)} business={me?.name ?? ''} name={p.name} kind={p.kind} balance={p.kind === 'POINTS' ? 120 : Math.min(2, p.redeem_points)} redeemAt={p.redeem_points} /></View>
            </Pressable>
          ))}
        </Panel>
      )}
    </SetupShell>
  );
}
