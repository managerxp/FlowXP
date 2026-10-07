import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, signOut, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { useSyncState } from '../../lib/sync.ts';
import { appVersion } from '../../lib/crash.ts';
import { SyncBadge } from '../../lib/SyncBadge.tsx';
import { Page } from '../../lib/responsive.tsx';
import { Line, SectionTitle, Soft, Title, s } from '../../lib/ui.tsx';

/* Everything that is not on a tab: customers, stock, reports, the printer and the phone's settings, switching outlet, signing out. */
export default function More() {
  const session = useSession();
  const sync = useSyncState();
  const business = currentBusiness(session);
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const several = (session.businesses.flatMap((b) => b.outlets).length) > 1;

  const leave = () => {
    const unsent = sync.pending + sync.failed;
    const go = () => { void signOut().then(() => router.replace('/login')); };
    if (!unsent) return go();
    Alert.alert(`${unsent} bill${unsent === 1 ? ' has' : 's have'} not been sent yet`, 'They stay safe on this phone. They are sent after you sign in again at this outlet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', onPress: go }]);
  };

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ padding: 16, gap: 4 }}>
            <Title>More</Title>
            <Soft>{business?.name} · {outlet?.name}</Soft>
            <Soft>{session.user?.email}</Soft>
            <SyncBadge />
          </View>
          <Line left="Help" sub="How to do things, and the quick tour" onPress={() => router.push('/help')} />
          <SectionTitle>Shop</SectionTitle>
          {KITCHEN_TYPES.includes(business?.business_type ?? '') ? <Line left="Products" sub="The menu: prices, stock, add an item" onPress={() => router.navigate('/products')} /> : null}
          {KITCHEN_TYPES.includes(business?.business_type ?? '') ? <Line left="Kitchen screen" sub="What to make, what is ready to serve" onPress={() => router.push('/kitchen')} /> : null}
          <Line left="Bills on hold" sub="Resume or discard" onPress={() => router.push('/held')} />
          <Line left="Customers" sub="Their bills, and what they still owe" onPress={() => router.push('/customers')} />
          <Line left="Stock" sub="What is running low, and fix a count" onPress={() => router.push('/stock')} />
          <Line left="Reports" sub="How much you sold, and what sells best" onPress={() => router.push('/reports')} />
          <SectionTitle>This phone</SectionTitle>
          <Line left="Bills waiting to send" sub="Made without internet, and recent" onPress={() => router.push('/waiting')} />
          <Line left="Settings" sub="Printer, updates, this phone" onPress={() => router.push('/settings')} />
          {several ? <Line left="Switch outlet" sub={outlet?.name} onPress={() => router.push('/choose')} /> : null}
          <SectionTitle>Account</SectionTitle>
          <Line left="Sign out" onPress={leave} />
          <Soft style={{ textAlign: 'center', padding: 16 }}>FlowXP {appVersion()}</Soft>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
