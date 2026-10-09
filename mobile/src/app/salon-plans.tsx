import { useState } from 'react';
import { RefreshControl, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { packageLine, planLine, type Package, type Plan } from '../lib/salonPlans.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page, Rows } from '../lib/responsive.tsx';
import { Button, Chips, Empty, Failed, Line, Loading, SavedNote, Soft, Title, s } from '../lib/ui.tsx';

type Kind = 'membership' | 'package';

/* What the salon sells besides single services: memberships (a discount, free services, priority) and packages (a bundle of visits at one price). Tap one to change it. */
export default function SalonPlans() {
  const session = useSession();
  const [kind, setKind] = useState<Kind>('membership');
  const plans = useLoad<Plan[]>(`salon-plans:${session.businessId}`, () => api.get<Plan[]>('/salon/membership-plans'), kind === 'membership');
  const packs = useLoad<Package[]>(`salon-packages:${session.businessId}`, () => api.get<Package[]>('/salon/packages'), kind === 'package');
  const cur = kind === 'membership' ? plans : packs;

  return (
    <SafeAreaView style={s.screen}>
      <Page max={1040}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Memberships and packages</Title><Soft>What you sell besides single services</Soft></View>
          <Button title="Add" onPress={() => router.push({ pathname: '/salon-plan', params: { kind } })} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <Chips<Kind> items={[{ id: 'membership', label: 'Memberships' }, { id: 'package', label: 'Packages' }]} value={kind} onChange={setKind} />
        <SavedNote at={cur.savedAt} />
        {cur.error && !cur.data ? <Failed message={cur.error} onRetry={() => { void cur.refresh(); }} /> : null}
        {cur.busy && !cur.data ? <Loading /> : null}
        <ScrollView refreshControl={<RefreshControl refreshing={cur.busy} onRefresh={() => { void cur.refresh(); }} />} contentContainerStyle={{ paddingBottom: 32, paddingTop: 8 }}>
          {kind === 'membership' ? (
            <>
              {plans.data && plans.data.length === 0 ? <Empty>No membership yet. A membership gives regular clients a discount or free services for a fee.</Empty> : null}
              <Rows>{(plans.data ?? []).map((p) => <Line key={p.plan_id} icon="ribbon-outline" left={p.name} sub={planLine(p)} right={rupees(toPaise(p.price))} onPress={() => router.push({ pathname: '/salon-plan', params: { kind, id: String(p.plan_id) } })} />)}</Rows>
            </>
          ) : (
            <>
              {packs.data && packs.data.length === 0 ? <Empty>No package yet. A package sells a bundle of visits at one price.</Empty> : null}
              <Rows>{(packs.data ?? []).map((p) => <Line key={p.package_id} icon="gift-outline" left={p.name} sub={packageLine(p)} right={rupees(toPaise(p.price))} onPress={() => router.push({ pathname: '/salon-plan', params: { kind, id: String(p.package_id) } })} />)}</Rows>
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
