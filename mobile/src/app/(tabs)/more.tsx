import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, signOut, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { RETAIL_TYPES, WHOLESALE_TYPES } from '../../lib/retail.ts';
import { allowed } from '../../lib/access.ts';
import { useSyncState } from '../../lib/sync.ts';
import { appVersion } from '../../lib/crash.ts';
import { SyncBadge } from '../../lib/SyncBadge.tsx';
import { Page, Rows } from '../../lib/responsive.tsx';
import { Line, SectionTitle, Soft, Title, s } from '../../lib/ui.tsx';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
type Item = { left: string; sub: string; icon: Icon; go: string; show?: boolean };

/* Everything that is not on a tab, grouped by what the owner is trying to do: sell, look after stock, deal with customers, understand the business, set up. Only what this person may use is shown. */
export default function More() {
  const session = useSession();
  const sync = useSyncState();
  const business = currentBusiness(session);
  const type = business?.business_type ?? '';
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const several = (session.businesses.flatMap((b) => b.outlets).length) > 1;
  const food = KITCHEN_TYPES.includes(type);
  const wholesale = WHOLESALE_TYPES.includes(type);
  const retail = RETAIL_TYPES.includes(type);
  const salon = type === 'SALON';
  const pharmacy = type === 'PHARMACY';
  const can = (...k: string[]) => allowed(business, ...k);

  const leave = () => {
    const unsent = sync.pending + sync.failed;
    const go = () => { void signOut().then(() => router.replace('/login')); };
    if (!unsent) return go();
    Alert.alert(`${unsent} bill${unsent === 1 ? ' has' : 's have'} not been sent yet`, 'They stay safe on this phone. They are sent after you sign in again at this outlet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', onPress: go }]);
  };

  const groups: { title: string; items: Item[] }[] = [
    { title: 'Sell', items: [
      { left: 'Kitchen screen', sub: 'What to make, what is ready to serve', icon: 'restaurant-outline', go: '/kitchen', show: food },
      { left: 'Bookings and waiting', sub: 'Tables booked, guests waiting for one', icon: 'calendar-outline', go: '/reservations', show: food },
      { left: 'Appointments', sub: 'Who is booked, who has arrived', icon: 'calendar-outline', go: '/appointments', show: salon },
      { left: 'Orders', sub: 'What customers have ordered', icon: 'clipboard-outline', go: '/wholesale-orders', show: wholesale },
      { left: 'Collect payment', sub: 'A customer pays what they owe', icon: 'cash-outline', go: '/collect', show: wholesale },
      { left: 'Returns', sub: 'Goods a shop sent back, and goods sent back to a supplier', icon: 'return-down-back-outline', go: '/returns', show: wholesale },
      { left: 'My route', sub: "Today's shops, orders and payments in the field", icon: 'navigate-outline', go: '/field', show: wholesale },
      { left: 'My van', sub: 'What you carry, and sell from it', icon: 'bus-outline', go: '/van', show: wholesale },
      { left: 'Bills on hold', sub: 'Resume or discard', icon: 'pause-circle-outline', go: '/held' }
    ] },
    { title: 'Stock and buying', items: [
      { left: 'Products', sub: 'The menu: prices, stock, add an item', icon: 'cube-outline', go: '/products', show: food },
      { left: 'Stock', sub: 'What is running low, and fix a count', icon: 'layers-outline', go: '/stock', show: can('inventory') },
      { left: 'Use-by dates', sub: 'What is expiring, and what has expired', icon: 'time-outline', go: '/expiry', show: retail },
      { left: 'Batches and use-by dates', sub: 'What is expiring, hold back or recall a batch', icon: 'time-outline', go: '/pharmacy-batches', show: pharmacy },
      { left: 'Receive medicines', sub: 'A delivery from a supplier, batch by batch', icon: 'download-outline', go: '/pharmacy-receive', show: pharmacy },
      { left: 'Buying', sub: 'Orders to suppliers, and goods coming in', icon: 'cart-outline', go: '/purchasing', show: wholesale && can('purchases') },
      { left: 'Warehouse', sub: 'Pick, pack and send out orders', icon: 'business-outline', go: '/warehouse', show: wholesale },
      { left: 'Moving stock', sub: 'Send goods between warehouses, and receive them', icon: 'swap-horizontal-outline', go: '/transfers', show: wholesale && can('inventory', 'fulfilment') },
      { left: 'Price lists', sub: 'Who pays what, and offer prices', icon: 'pricetags-outline', go: '/price-lists', show: wholesale && can('pricing', 'sales_orders') },
      { left: 'Suppliers and stock coming in', sub: 'Who you buy from, and receive a delivery', icon: 'people-outline', go: '/suppliers', show: can('suppliers', 'purchases', 'inventory') }
    ] },
    { title: 'Customers', items: [
      { left: 'Customers', sub: 'Their bills, and what they still owe', icon: 'person-outline', go: '/customers', show: can('customers', 'billing') },
      { left: 'Customer accounts', sub: 'Who owes what, and their credit', icon: 'wallet-outline', go: '/wholesale-customers', show: wholesale },
      { left: 'Clients', sub: 'Visits, memberships, notes and history', icon: 'heart-outline', go: '/salon-clients', show: salon }
    ] },
    { title: 'Your business', items: [
      { left: 'Expenses', sub: 'Rent, salary, electricity: what you spent', icon: 'receipt-outline', go: '/expenses', show: can('expenses') },
      { left: 'Reports', sub: 'How much you sold, and what sells best', icon: 'stats-chart-outline', go: '/reports', show: can('reports') },
      { left: 'Ask Flow AI', sub: 'Questions about your business, in plain words', icon: 'sparkles-outline', go: '/flow-ai', show: can('ai') },
      { left: 'Service menu', sub: 'What you offer, its price and how long it takes', icon: 'cut-outline', go: '/salon-services', show: salon && can('products') },
      { left: 'Memberships and packages', sub: 'What you sell besides single services', icon: 'ribbon-outline', go: '/salon-plans', show: salon && can('products') },
      { left: 'Salon reports', sub: 'Today at a glance, and every report', icon: 'stats-chart-outline', go: '/salon-reports', show: salon },
      { left: 'Team', sub: 'Who is in today, and commission', icon: 'people-circle-outline', go: '/salon-team', show: salon }
    ] },
    { title: 'This phone', items: [
      { left: 'Bills waiting to send', sub: 'Made without internet, and recent', icon: 'cloud-upload-outline', go: '/waiting' },
      { left: 'Settings', sub: 'Printer, updates, this phone', icon: 'settings-outline', go: '/settings' },
      { left: 'Switch outlet', sub: outlet?.name ?? '', icon: 'swap-vertical-outline', go: '/choose', show: several }
    ] }
  ];

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page max={1040}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
          <View style={{ padding: 16, gap: 4 }}>
            <Title>More</Title>
            <Soft>{business?.name} · {outlet?.name}</Soft>
            <Soft>{session.user?.email}</Soft>
            <SyncBadge />
          </View>
          {groups.map((g) => {
            const items = g.items.filter((i) => i.show !== false);
            return items.length ? (
              <View key={g.title}>
                <SectionTitle>{g.title}</SectionTitle>
                <Rows>{items.map((i) => <Line key={i.left} icon={i.icon} left={i.left} sub={i.sub} onPress={() => (i.go === '/products' ? router.navigate('/products') : router.push(i.go as never))} />)}</Rows>
              </View>
            ) : null;
          })}
          <SectionTitle>Help</SectionTitle>
          <Rows><Line icon="help-circle-outline" left="Help" sub="How to do things, and the quick tour" onPress={() => router.push('/help')} /></Rows>
          <SectionTitle>Account</SectionTitle>
          <Rows><Line icon="log-out-outline" left="Sign out" onPress={leave} /></Rows>
          <Soft style={{ textAlign: 'center', padding: 16 }}>FlowXP {appVersion()}</Soft>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
