import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWide } from '../../lib/responsive.tsx';
import { useSyncState } from '../../lib/sync.ts';
import { currentBusiness, useSession } from '../../lib/session.ts';
import { allowed } from '../../lib/access.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { Rail, type RailProps } from '../../lib/Rail.tsx';
import { color } from '../../lib/ui.tsx';
import { t } from '../../lib/i18n.ts';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
const tab = (title: string, icon: IconName, iconOn: IconName) => ({
  title: t(title),
  tabBarIcon: ({ focused, color: c, size }: { focused: boolean; color: ColorValue; size: number }) => <Ionicons name={focused ? iconOn : icon} size={size} color={c} />
});

/* The main places, always one tap away: a bar along the bottom on a phone, a rail down the left on a tablet or a phone turned sideways. */
export default function TabsLayout() {
  const wide = useWide();
  const sync = useSyncState();
  const waiting = sync.pending + sync.failed;
  // a restaurant or café works by the table: it gets a Tables tab, and Products moves into More to keep the bar to five
  const business = currentBusiness(useSession());
  const food = KITCHEN_TYPES.includes(business?.business_type ?? '');
  const diningRoom = business?.business_type !== 'CLOUD_KITCHEN';   // a cloud kitchen has no tables: the same tab holds its takeaway and delivery orders
  // only the places this person may use: someone who cannot make bills does not get Sell, Tables or Bills
  const noSell = !allowed(business, 'billing', 'sales_orders', 'fulfilment', 'field_sales', 'collections', 'appointments', 'dispensing', 'vehicles');
  const hidden = [...(food ? ['products'] : ['tables']), ...(noSell ? ['sell', 'tables', 'sales'] : []), ...(!allowed(business, 'products', 'inventory') ? ['products'] : [])];
  return (
    <Tabs
      tabBar={wide ? (p) => <Rail {...(p as unknown as Omit<RailProps, 'hidden'>)} hidden={hidden} /> : undefined}
      screenOptions={{
        headerShown: false,
        tabBarPosition: wide ? 'left' : 'bottom',
        tabBarActiveTintColor: color.brand,
        tabBarInactiveTintColor: color.soft,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '600' },
        tabBarStyle: { backgroundColor: color.card, borderColor: color.line }
      }}
    >
      <Tabs.Screen name="home" options={tab('Home', 'home-outline', 'home')} />
      <Tabs.Screen name="sell" options={{ ...tab('Sell', 'cart-outline', 'cart'), href: noSell ? null : undefined }} />
      <Tabs.Screen name="tables" options={{ ...tab(diningRoom ? 'Tables' : 'Orders', 'grid-outline', 'grid'), href: food && !noSell ? undefined : null }} />
      <Tabs.Screen name="sales" options={{ ...tab('Bills', 'receipt-outline', 'receipt'), tabBarBadge: waiting > 0 ? waiting : undefined, href: noSell ? null : undefined }} />
      <Tabs.Screen name="products" options={{ ...tab('Products', 'cube-outline', 'cube'), href: hidden.includes('products') ? null : undefined }} />
      <Tabs.Screen name="more" options={tab('More', 'menu-outline', 'menu')} />
    </Tabs>
  );
}
