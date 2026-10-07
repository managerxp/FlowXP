import type { ColorValue } from 'react-native';
import { Tabs } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useWide } from '../../lib/responsive.tsx';
import { useSyncState } from '../../lib/sync.ts';
import { currentBusiness, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
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
  const food = KITCHEN_TYPES.includes(currentBusiness(useSession())?.business_type ?? '');
  return (
    <Tabs
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
      <Tabs.Screen name="sell" options={tab('Sell', 'cart-outline', 'cart')} />
      <Tabs.Screen name="tables" options={{ ...tab('Tables', 'grid-outline', 'grid'), href: food ? undefined : null }} />
      <Tabs.Screen name="sales" options={{ ...tab('Bills', 'receipt-outline', 'receipt'), tabBarBadge: waiting > 0 ? waiting : undefined }} />
      <Tabs.Screen name="products" options={{ ...tab('Products', 'cube-outline', 'cube'), href: food ? null : undefined }} />
      <Tabs.Screen name="more" options={tab('More', 'menu-outline', 'menu')} />
    </Tabs>
  );
}
