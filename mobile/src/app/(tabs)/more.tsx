import { OUTLET_TYPES, canManageTeam } from '../../lib/team.ts';
import { Alert, ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, signOut, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { RETAIL_TYPES, isDistributor, isWholesale } from '../../lib/retail.ts';
import { canOffers } from '../../lib/offerList.ts';
import { canLoyalty } from '../../lib/loyalty.ts';
import { canMessaging } from '../../lib/messaging.ts';
import { canOptions } from '../../lib/menuOptions.ts';
import { canSubscription } from '../../lib/subscription.ts';
import { canDelivery } from '../../lib/platforms.ts';
import { canGymSetup } from '../../lib/gymSetup.ts';
import { canSalonSetup } from '../../lib/salonSetup.ts';
import { canHotelSetup } from '../../lib/hotelSetup.ts';
import { canGamingSetup } from '../../lib/gamingSetup.ts';
import { HOTEL_TYPES } from '../../lib/hotel.ts';
import { AUTO_PARTS_TYPES } from '../../lib/parts.ts';
import { GAMING_TYPES } from '../../lib/gaming.ts';
import { GYM_TYPES } from '../../lib/gym.ts';
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
  const wholesale = isWholesale(business);
  const distributor = isDistributor(business);
  const retail = RETAIL_TYPES.includes(type);
  const hotel = HOTEL_TYPES.includes(type);
  const parts = AUTO_PARTS_TYPES.includes(type);
  const gaming = GAMING_TYPES.includes(type);
  const gym = GYM_TYPES.includes(type);
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
      { left: 'Gaming set-up', sub: 'Stations, rates, offers and the lounge rules', icon: 'construct-outline', go: '/gaming-setup', show: gaming && canGamingSetup((p) => allowed(business, p)) },
      { left: 'Lounge board', sub: 'Every station with its timer: start, pause, stop, take payment', icon: 'game-controller-outline', go: '/gaming', show: gaming && can('gaming_desk', 'gaming_setup') },
      { left: 'Gym front desk', sub: 'Let members in: scan a pass or find them', icon: 'barbell-outline', go: '/gym', show: gym && can('gym_desk') },
      { left: 'Gym plans', sub: 'What the gym sells, for how long and for how much', icon: 'pricetags-outline', go: '/gym-plans', show: gym && canGymSetup((p) => allowed(business, p)) },
      { left: 'Gym settings', sub: 'Check-in rules, hours, holidays and the entrance QR', icon: 'settings-outline', go: '/gym-settings', show: gym && canGymSetup((p) => allowed(business, p)) },
      { left: 'Find a part', sub: 'By name, barcode or any part number: price, stock and shelf', icon: 'search-outline', go: '/parts', show: parts && can('billing', 'parts_catalog', 'warehouse', 'inventory') },
      { left: 'Parts for a vehicle', sub: 'What fits a car or bike, each marked verified or not', icon: 'car-outline', go: '/parts-vehicle', show: parts && can('billing', 'parts_catalog', 'warehouse') },
      { left: 'Front desk', sub: 'Arrivals, who is in the house, rooms and guest bills', icon: 'bed-outline', go: '/hotel', show: hotel && can('front_desk', 'housekeeping') },
      { left: 'Hotel set-up', sub: 'Rooms, rates, banquet and the property\'s rules', icon: 'construct-outline', go: '/hotel-setup', show: hotel && canHotelSetup((p) => allowed(business, p)) },
      { left: 'New online orders', sub: 'Zomato, Swiggy, QR and website orders waiting to be accepted', icon: 'notifications-outline', go: '/incoming', show: food && can('billing', 'kitchen') },
      { left: 'Deliveries', sub: 'Open deliveries, their riders and where each has got to', icon: 'bicycle-outline', go: '/deliveries', show: food && can('billing', 'kitchen') },
      { left: 'Kitchen screen', sub: 'What to make, what is ready to serve', icon: 'restaurant-outline', go: '/kitchen', show: food },
      { left: 'Bookings and waiting', sub: 'Tables booked, guests waiting for one', icon: 'calendar-outline', go: '/reservations', show: food },
      { left: 'Appointments', sub: 'Who is booked, who has arrived', icon: 'calendar-outline', go: '/appointments', show: salon },
      { left: 'Orders', sub: 'What customers have ordered', icon: 'clipboard-outline', go: '/wholesale-orders', show: wholesale },
      { left: 'Collect payment', sub: 'A customer pays what they owe', icon: 'cash-outline', go: '/collect', show: wholesale },
      { left: 'Returns', sub: 'Goods a shop sent back, and goods sent back to a supplier', icon: 'return-down-back-outline', go: '/returns', show: wholesale },
      { left: 'My route', sub: "Today's shops, orders and payments in the field", icon: 'navigate-outline', go: '/field', show: distributor },
      { left: 'My van', sub: 'What you carry, and sell from it', icon: 'bus-outline', go: '/van', show: distributor },
      { left: 'Principals', sub: 'The manufacturers you distribute and what you owe them', icon: 'business-outline', go: '/dist-principals', show: distributor && can('principals', 'products', 'purchases') },
      { left: 'Schemes', sub: 'Free goods and discounts for shops', icon: 'pricetags-outline', go: '/dist-schemes', show: distributor && can('schemes') },
      { left: 'Areas and routes', sub: 'Regions, territories, areas and beats', icon: 'map-outline', go: '/dist-areas', show: distributor && can('territories') },
      { left: 'Sales team', sub: 'Salespeople, targets and commission', icon: 'people-outline', go: '/dist-team', show: distributor && can('targets', 'territories') },
      { left: 'Vans', sub: 'The register of vans, drivers and routes', icon: 'car-outline', go: '/dist-vans', show: distributor && can('vehicles') },
      { left: 'Bills on hold', sub: 'Resume or discard', icon: 'pause-circle-outline', go: '/held' }
    ] },
    { title: 'Stock and buying', items: [
      { left: 'Products', sub: 'The menu: prices, stock, add an item', icon: 'cube-outline', go: '/products', show: food || salon },
      { left: 'Racks and bins', sub: 'Look in a bin, put stock away, move it between bins', icon: 'file-tray-stacked-outline', go: '/parts-warehouse', show: parts && can('warehouse', 'grn', 'stock_count') },
      { left: 'Receive parts', sub: 'A delivery: accepted, damaged and rejected counted apart', icon: 'download-outline', go: '/parts-receive', show: parts && can('grn') },
      { left: 'Manage parts', sub: 'Add parts, numbers, vehicles and racks', icon: 'construct-outline', go: '/parts-manage', show: parts && can('parts_catalog', 'warehouse') },
      { left: 'Job cards', sub: 'Vehicles in for service: parts, labour and one bill', icon: 'build-outline', go: '/job-cards', show: parts && can('billing') },
      { left: 'Staff', sub: 'People, attendance and payroll', icon: 'people-circle-outline', go: '/workshop-staff', show: parts && can('hr', 'payroll') },
      { left: 'Stock', sub: 'What is running low, and fix a count', icon: 'layers-outline', go: '/stock', show: can('inventory') },
      { left: 'Stock counts', sub: 'Scan the shelf and see what differs', icon: 'clipboard-outline', go: '/stock-counts', show: retail && can('inventory') },
      { left: 'Use-by dates', sub: 'What is expiring, and what has expired', icon: 'time-outline', go: '/expiry', show: retail },
      { left: 'Batches and use-by dates', sub: 'What is expiring, hold back or recall a batch', icon: 'time-outline', go: '/pharmacy-batches', show: pharmacy },
      { left: 'Receive medicines', sub: 'A delivery from a supplier, batch by batch', icon: 'download-outline', go: '/pharmacy-receive', show: pharmacy },
      { left: 'Medicines and items', sub: 'Add, change and price what you stock', icon: 'medkit-outline', go: '/medicine-admin', show: pharmacy && can('products') },
      { left: 'Buying', sub: 'Orders to suppliers, and goods coming in', icon: 'cart-outline', go: '/purchasing', show: wholesale && can('purchases') },
      { left: 'Warehouse', sub: 'Pick, pack and send out orders', icon: 'business-outline', go: '/warehouse', show: wholesale },
      { left: 'Moving stock', sub: 'Send goods between warehouses, and receive them', icon: 'swap-horizontal-outline', go: '/transfers', show: wholesale && can('inventory', 'fulfilment') },
      { left: 'Wholesale settings', sub: 'Credit rules, stock rules, messages and salespeople', icon: 'settings-outline', go: '/wholesale-settings', show: wholesale && can('settings') },
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
      { left: 'More reports', sub: 'Day Book, profit and loss, GST, stock, who owes you', icon: 'document-text-outline', go: '/biz-reports', show: can('reports', 'gst', 'inventory') },
      { left: 'GST filing', sub: 'GSTR-1 file, GSTR-3B figures, e-invoice', icon: 'document-attach-outline', go: '/gst-filing', show: canManageTeam(business?.role) && can('gst') },
      { left: 'Accountant pack', sub: 'A ZIP of your books for the accountant', icon: 'briefcase-outline', go: '/accountant-pack', show: can('export') },
      { left: 'Notifications', sub: 'Weekly summary, alerts, and what to be told about', icon: 'notifications-outline', go: '/notifications' },
      { left: 'Ask Flow AI', sub: 'Questions about your business, in plain words', icon: 'sparkles-outline', go: '/flow-ai', show: can('ai') },
      { left: 'Service menu', sub: 'What you offer, its price and how long it takes', icon: 'cut-outline', go: '/salon-services', show: salon && can('products') },
      { left: 'Memberships and packages', sub: 'What you sell besides single services', icon: 'ribbon-outline', go: '/salon-plans', show: salon && can('products') },
      { left: 'Salon settings', sub: 'Hours, booking, tax, loyalty, reminders and campaigns', icon: 'options-outline', go: '/salon-settings', show: salon && canSalonSetup(business?.role) },
      { left: 'Salon reports', sub: 'Today at a glance, and every report', icon: 'stats-chart-outline', go: '/salon-reports', show: salon },
      { left: 'Team', sub: 'Who is in today, and commission', icon: 'people-circle-outline', go: '/salon-team', show: salon }
    ] },
    { title: 'This phone', items: [
      { left: 'Bills waiting to send', sub: 'Made without internet, and recent', icon: 'cloud-upload-outline', go: '/waiting' },
      { left: 'Printers', sub: 'Bluetooth and Wi-Fi printers: receipt and kitchen ticket', icon: 'print-outline', go: '/printers' },
      { left: 'Settings', sub: 'Printer, updates, this phone', icon: 'settings-outline', go: '/settings' },
      { left: 'Business settings', sub: 'Details, receipt, GST and invoice (owner)', icon: 'business-outline', go: '/business-settings', show: business?.role === 'OWNER' },
      { left: 'Restore from a backup', sub: 'Put back what a backup has and this business does not (owner)', icon: 'cloud-upload-outline', go: '/restore-backup', show: business?.role === 'OWNER' },
      { left: 'Staff', sub: 'Who can sign in, their role and outlet', icon: 'people-circle-outline', go: '/staff', show: canManageTeam(business?.role) },
      { left: 'Activity log', sub: 'Who did what, and when', icon: 'time-outline', go: '/activity', show: canManageTeam(business?.role) },
      { left: 'Security', sub: 'Two-step verification, password, sign-ins', icon: 'shield-checkmark-outline', go: '/security' },
      { left: 'Offers', sub: 'Discounts the till applies by itself', icon: 'pricetag-outline', go: '/offers', show: (retail || food) && canOffers((p) => allowed(business, p)) },
      { left: 'Loyalty & coupons', sub: 'Visit card, points and tiers, offer codes', icon: 'gift-outline', go: '/loyalty', show: canLoyalty(business?.role) && !wholesale },
      { left: 'Messaging', sub: 'WhatsApp or SMS: bills, bookings, offers', icon: 'chatbubbles-outline', go: '/messaging', show: canMessaging(business?.role) },
      { left: 'Options & add-ons', sub: 'Sizes, levels and add-ons for dishes', icon: 'options-outline', go: '/option-groups', show: food && canOptions((p) => allowed(business, p)) },
      { left: 'Credit and debit notes', sub: 'Goods that came back, and goods sent back to suppliers', icon: 'receipt-outline', go: '/notes', show: !wholesale && (can('purchases') || can('refunds')) },
      { left: 'Subscription', sub: 'Your plan, trial and payment link', icon: 'card-outline', go: '/subscription', show: canSubscription(business?.role) },
      { left: 'Delivery platforms and settlements', sub: 'Connect Zomato, Swiggy and others, and check what they paid', icon: 'bicycle-outline', go: '/delivery-platforms', show: food && canDelivery((p) => allowed(business, p)) },
      { left: 'Profitability', sub: 'What your sales leave after food cost, fees and commission', icon: 'trending-up-outline', go: '/profitability', show: food && can('reports') },
      { left: 'Forecast', sub: 'The week ahead, and what to buy for it', icon: 'analytics-outline', go: '/forecast', show: food && can('reports') },
      { left: 'Revenue leakage', sub: 'Unusual discounts, cancellations, refunds and wastage', icon: 'shield-outline', go: '/leakage', show: food && can('settings') },
      { left: 'Kitchen performance', sub: 'How long dishes take', icon: 'timer-outline', go: '/kitchen-performance', show: food && can('reports') },
      { left: 'Outlets', sub: 'Your places, and how they compare', icon: 'storefront-outline', go: '/outlets', show: canManageTeam(business?.role) && OUTLET_TYPES.includes(business?.business_type ?? '') },
      { left: 'Report a problem', sub: 'Tell FlowXP something went wrong', icon: 'bug-outline', go: '/report' },
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
                <Rows>{items.map((i) => <Line key={i.left} icon={i.icon} left={i.left} sub={i.sub} onPress={() => (['/products', '/appointments', '/salon-clients'].includes(i.go) ? router.navigate(i.go as never) : router.push(i.go as never))} />)}</Rows>
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
