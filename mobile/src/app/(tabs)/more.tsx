import { canManageTeam } from '../../lib/team.ts';
import { useState } from 'react';
import { Alert, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { router } from 'expo-router';
import { Ionicons } from '../../lib/icons.tsx';
import { SafeAreaView } from 'react-native-safe-area-context';
import { currentBusiness, signOut, useSession } from '../../lib/session.ts';
import { KITCHEN_TYPES } from '../../lib/cart.ts';
import { RETAIL_TYPES, isDistributor, isWholesale } from '../../lib/retail.ts';
import { canOffers } from '../../lib/offerList.ts';
import { canLoyalty } from '../../lib/loyalty.ts';
import { canMessaging } from '../../lib/messaging.ts';
import { canOptions } from '../../lib/menuOptions.ts';
import { PLATFORMS_ON, canDelivery } from '../../lib/platforms.ts';
import { canGymSetup } from '../../lib/gymSetup.ts';
import { canSalonSetup } from '../../lib/salonSetup.ts';
import { canGamingSetup } from '../../lib/gamingSetup.ts';
import { AUTO_PARTS_TYPES } from '../../lib/parts.ts';
import { workshopOn } from '../../lib/workshopExtras.ts';
import { GAMING_TYPES } from '../../lib/gaming.ts';
import { GYM_TYPES } from '../../lib/gym.ts';
import { allowed, hasFeature } from '../../lib/access.ts';
import { hasBooks } from '../../lib/flowbook.ts';
import { useSyncState } from '../../lib/sync.ts';
import { appVersion } from '../../lib/crash.ts';
import { SyncBadge } from '../../lib/SyncBadge.tsx';
import { Page, Rows } from '../../lib/responsive.tsx';
import { Empty, Group as Card, Initials, Line, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';
import { display, radius, shadow } from '../../lib/theme.ts';
import { t } from '../../lib/i18n.ts';
import { FadeIn } from '../../lib/motion.tsx';

type Icon = React.ComponentProps<typeof Ionicons>['name'];
type Item = { left: string; sub: string; icon: Icon; go: string; show?: boolean; main?: boolean };
type Group = { title: string; icon: Icon; items: Item[] };

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
  const parts = AUTO_PARTS_TYPES.includes(type);
  const workshop = workshopOn(business);
  const gaming = GAMING_TYPES.includes(type);
  const gym = GYM_TYPES.includes(type);
  const salon = type === 'SALON';
  const pharmacy = type === 'PHARMACY';
  const clothing = type === 'CLOTHING';
  const can = (...k: string[]) => allowed(business, ...k);

  const leave = () => {
    const unsent = sync.pending + sync.failed;
    const go = () => { void signOut().then(() => router.replace('/login')); };
    if (!unsent) return go();
    Alert.alert(`${unsent} bill${unsent === 1 ? ' has' : 's have'} not been sent yet`, 'They stay safe on this phone. They are sent after you sign in again at this outlet.', [{ text: 'Stay', style: 'cancel' }, { text: 'Sign out', onPress: go }]);
  };

  /* A mechanic garage sees a short list: its customers and parts, money and reports, messaging, staff and this phone. No stock, GST filing, loyalty or other industries. */
  const garageGroups: Group[] = [
    { title: 'Garage', icon: 'build-outline', items: [
      { left: 'Labour and services', sub: 'What you charge for work: oil change, alignment', icon: 'pricetag-outline', go: '/job-services', show: can('billing') },
      { left: 'Customers', sub: 'Their vehicles, bills and what they still owe', icon: 'person-outline', go: '/customers', main: true, show: can('customers', 'billing') },
      { left: 'Find a part', sub: 'By name, barcode or any part number: price, stock and shelf', icon: 'search-outline', go: '/parts', show: can('billing', 'parts_catalog', 'warehouse', 'inventory') },
      { left: 'Parts reports', sub: 'What to buy, what sells, stock age and value', icon: 'analytics-outline', go: '/parts-reports', show: parts && can('reports', 'inventory', 'purchases') },
      { left: 'Trade prices', sub: 'Price lists for garages and trade, and parts held for customers', icon: 'pricetags-outline', go: '/parts-trade', show: parts && can('billing', 'price_change', 'inventory') },
      { left: 'Receive parts', sub: 'A delivery: accepted, damaged and rejected counted apart', icon: 'download-outline', go: '/parts-receive', show: can('grn') },
      { left: 'Suppliers and stock coming in', sub: 'Who you buy from, and receive a delivery', icon: 'people-outline', go: '/suppliers', show: can('suppliers', 'purchases', 'inventory') },
      { left: 'Staff', sub: 'People, attendance and payroll', icon: 'people-circle-outline', go: '/workshop-staff', show: can('hr', 'payroll') }
    ] },
    { title: 'Your business', icon: 'stats-chart-outline', items: [
      { left: 'What we earned', sub: 'Labour and parts earned, by day and mechanic', icon: 'stats-chart-outline', go: '/job-earnings', show: can('billing') },
      { left: 'Reports', sub: 'How much you earned, and download it', icon: 'stats-chart-outline', go: '/reports', main: true, show: can('reports') },
      { left: 'Expenses', sub: 'Rent, salary, electricity: what you spent', icon: 'receipt-outline', go: '/expenses', show: can('expenses') },
      { left: 'Estimates', sub: 'A price before the sale: share it, then make the invoice', icon: 'document-text-outline', go: '/estimates', show: can('billing') && hasFeature(business, 'estimates') },
      { left: 'Other income', sub: 'Interest, rent received, scrap: money in that is not from a bill', icon: 'cash-outline', go: '/other-income', show: can('expenses') && hasFeature(business, 'other_income') },
      { left: 'Messaging', sub: 'WhatsApp or SMS: vehicle ready, estimate, offers', icon: 'chatbubbles-outline', go: '/messaging', show: canMessaging(business?.role) },
    ] }
  ];

  /* The same order as the laptop's sidebar: Sell, the kind of business you run, Stock, Customers, Business, Team, then Settings and help. */
  const groups: Group[] = [
    { title: 'Sell', icon: 'cart-outline', items: [
      { left: 'Bills on hold', sub: 'Resume or discard', icon: 'pause-circle-outline', go: '/held', main: true },
      { left: 'Bills waiting to send', sub: 'Made without internet, and recent', icon: 'cloud-upload-outline', go: '/waiting' },
      { left: 'Estimates', sub: 'A price before the sale: share it, then make the invoice', icon: 'document-text-outline', go: '/estimates', show: can('billing') && hasFeature(business, 'estimates') },
      { left: 'Credit and debit notes', sub: 'Goods that came back, and goods sent back to suppliers', icon: 'receipt-outline', go: '/notes', show: !wholesale && (can('purchases') || can('refunds')) }
    ] },
    { title: 'Restaurant', icon: 'restaurant-outline', items: [
      { left: 'New online orders', sub: 'Zomato, Swiggy, QR and website orders waiting to be accepted', icon: 'notifications-outline', go: '/incoming', show: PLATFORMS_ON && food && can('billing', 'kitchen') },
      { left: 'Deliveries', sub: 'Open deliveries, their riders and where each has got to', icon: 'bicycle-outline', go: '/deliveries', show: food && can('billing', 'kitchen') },
      { left: 'Kitchen screen', sub: 'What to make, what is ready to serve', icon: 'restaurant-outline', go: '/kitchen', show: food },
      { left: 'Bookings and waiting', sub: 'Tables booked, guests waiting for one', icon: 'calendar-outline', go: '/reservations', show: food },
      { left: 'Kitchen performance', sub: 'How long dishes take', icon: 'timer-outline', go: '/kitchen-performance', show: food && can('reports') },
      { left: 'Delivery platforms and settlements', sub: 'Connect Zomato, Swiggy and others, and check what they paid', icon: 'bicycle-outline', go: '/delivery-platforms', show: PLATFORMS_ON && food && canDelivery((p) => allowed(business, p)) }
    ] },
    { title: 'Salon', icon: 'cut-outline', items: [
      { left: 'Appointments', sub: 'Who is booked, who has arrived', icon: 'calendar-outline', go: '/appointments', show: salon },
      { left: 'Clients', sub: 'Visits, memberships, notes and history', icon: 'heart-outline', go: '/salon-clients', show: salon },
      { left: 'Service menu', sub: 'What you offer, its price and how long it takes', icon: 'cut-outline', go: '/salon-services', show: salon && can('products') },
      { left: 'Memberships and packages', sub: 'What you sell besides single services', icon: 'ribbon-outline', go: '/salon-plans', show: salon && can('products') },
      { left: 'Team', sub: 'Who is in today, and commission', icon: 'people-circle-outline', go: '/salon-team', show: salon },
      { left: 'Salon stock', sub: 'What is running low or expiring, batches on the shelf, add stock', icon: 'flask-outline', go: '/salon-stock', show: salon && can('inventory', 'reports') },
      { left: 'Salon reports', sub: 'Today at a glance, and every report', icon: 'stats-chart-outline', go: '/salon-reports', show: salon },
      { left: 'Salon settings', sub: 'Hours, booking, tax, loyalty, reminders and campaigns', icon: 'options-outline', go: '/salon-settings', show: salon && canSalonSetup(business?.role) }
    ] },
    { title: 'Clothing', icon: 'shirt-outline', items: [
      { left: 'Styles and sizes', sub: 'Each product with every size and colour, and what is left', icon: 'shirt-outline', go: '/clothing', show: clothing && can('billing', 'inventory', 'products') },
      { left: 'Clothing insights', sub: 'What sells, what earns and what sits', icon: 'stats-chart-outline', go: '/clothing-insights', show: clothing && can('reports', 'inventory', 'products') }
    ] },
    { title: 'Gym', icon: 'barbell-outline', items: [
      { left: 'Gym front desk', sub: 'Let members in: scan a pass or find them', icon: 'barbell-outline', go: '/gym', show: gym && can('gym_desk') },
      { left: 'Gym members', sub: 'Find a member, sell or renew a membership, freeze it, add a new member', icon: 'people-outline', go: '/gym-members', show: gym && can('gym_members', 'gym_desk') },
      { left: 'Who came today', sub: 'Visits so far today, and who is still inside', icon: 'time-outline', go: '/gym-attendance', show: gym && can('gym_desk', 'gym_members') },
      { left: 'Gym classes', sub: 'Today’s classes: who booked, who came', icon: 'calendar-outline', go: '/gym-classes', show: gym && can('gym_desk', 'gym_trainer') },
      { left: 'Gym plans', sub: 'What the gym sells, for how long and for how much', icon: 'pricetags-outline', go: '/gym-plans', show: gym && canGymSetup((p) => allowed(business, p)) },
      { left: 'Gym settings', sub: 'Check-in rules, hours, holidays and the entrance QR', icon: 'settings-outline', go: '/gym-settings', show: gym && canGymSetup((p) => allowed(business, p)) }
    ] },
    { title: 'Gaming', icon: 'game-controller-outline', items: [
      { left: 'Lounge board', sub: 'Every station with its timer: start, pause, stop, take payment', icon: 'game-controller-outline', go: '/gaming', show: gaming && can('gaming_desk', 'gaming_setup') },
      { left: 'Bookings', sub: 'Who has a station and when; start the timer when they arrive', icon: 'calendar-number-outline', go: '/gaming-bookings', show: gaming && can('gaming_desk', 'gaming_setup') },
      { left: 'Players', sub: 'Find a player, add one, top up a prepaid wallet', icon: 'person-add-outline', go: '/gaming-players', show: gaming && can('gaming_desk', 'gaming_setup') },
      { left: 'Tournaments', sub: 'Entries, entry fees and check-in', icon: 'trophy-outline', go: '/gaming-tournaments', show: gaming && can('gaming_desk', 'gaming_setup') },
      { left: 'Lounge takings', sub: 'Gaming time against food and drink, hours played, best stations', icon: 'stats-chart-outline', go: '/gaming-reports', show: gaming && can('gaming_setup', 'reports') },
      { left: 'Gaming set-up', sub: 'Stations, rates, offers and the lounge rules', icon: 'construct-outline', go: '/gaming-setup', show: gaming && canGamingSetup((p) => allowed(business, p)) }
    ] },
    { title: 'Spare parts', icon: 'car-outline', items: [
      { left: 'Find a part', sub: 'By name, barcode or any part number: price, stock and shelf', icon: 'search-outline', go: '/parts', show: parts && can('billing', 'parts_catalog', 'warehouse', 'inventory') },
      { left: 'Parts for a vehicle', sub: 'What fits a car or bike, each marked verified or not', icon: 'car-outline', go: '/parts-vehicle', show: parts && can('billing', 'parts_catalog', 'warehouse') },
      { left: 'Racks and bins', sub: 'Look in a bin, put stock away, move it between bins', icon: 'file-tray-stacked-outline', go: '/parts-warehouse', show: parts && can('warehouse', 'grn', 'stock_count') },
      { left: 'Receive parts', sub: 'A delivery: accepted, damaged and rejected counted apart', icon: 'download-outline', go: '/parts-receive', show: parts && can('grn') },
      { left: 'Manage parts', sub: 'Add parts, numbers, vehicles and racks', icon: 'construct-outline', go: '/parts-manage', show: parts && can('parts_catalog', 'warehouse') },
      { left: 'Job cards', sub: 'Vehicles in for service: parts, labour and one bill', icon: 'build-outline', go: '/job-cards', show: parts && workshop && can('billing') },
      { left: 'Labour and services', sub: 'What you charge for work: oil change, alignment', icon: 'pricetag-outline', go: '/job-services', show: parts && workshop && can('billing') },
      { left: 'What we earned', sub: 'Labour and parts earned, by day and mechanic', icon: 'stats-chart-outline', go: '/job-earnings', show: parts && workshop && can('billing') },
      { left: 'Staff', sub: 'People, attendance and payroll', icon: 'people-circle-outline', go: '/workshop-staff', show: parts && workshop && can('hr', 'payroll') },
      { left: 'Mechanic mode', sub: 'Show job cards, labour and staff, or hide them for a parts-only shop', icon: 'build-outline', go: '/mechanic-mode', show: parts && business?.role === 'OWNER' }
    ] },
    { title: 'Pharmacy', icon: 'medkit-outline', items: [
      { left: 'Batches and use-by dates', sub: 'What is expiring, hold back or recall a batch', icon: 'time-outline', go: '/pharmacy-batches', show: pharmacy },
      { left: 'Receive medicines', sub: 'A delivery from a supplier, batch by batch', icon: 'download-outline', go: '/pharmacy-receive', show: pharmacy },
      { left: 'Medicines and items', sub: 'Add, change and price what you stock', icon: 'medkit-outline', go: '/medicine-admin', show: pharmacy && can('products') }
    ] },
    { title: 'Wholesale', icon: 'business-outline', items: [
      { left: 'Orders', sub: 'What customers have ordered', icon: 'clipboard-outline', go: '/wholesale-orders', show: wholesale },
      { left: 'Customer accounts', sub: 'Who owes what, and their credit', icon: 'wallet-outline', go: '/wholesale-customers', show: wholesale },
      { left: 'Collect payment', sub: 'A customer pays what they owe', icon: 'cash-outline', go: '/collect', show: wholesale },
      { left: 'Returns', sub: 'Goods a shop sent back, and goods sent back to a supplier', icon: 'return-down-back-outline', go: '/returns', show: wholesale },
      { left: 'Price lists', sub: 'Who pays what, and offer prices', icon: 'pricetags-outline', go: '/price-lists', show: wholesale && can('pricing', 'sales_orders') },
      { left: 'Buying', sub: 'Orders to suppliers, and goods coming in', icon: 'cart-outline', go: '/purchasing', show: wholesale && can('purchases') },
      { left: 'Warehouse', sub: 'Pick, pack and send out orders', icon: 'business-outline', go: '/warehouse', show: wholesale },
      { left: 'Moving stock', sub: 'Send goods between warehouses, and receive them', icon: 'swap-horizontal-outline', go: '/transfers', show: wholesale && can('inventory', 'fulfilment') },
      { left: 'Wholesale reports', sub: 'Sales, buying, stock and money, pick a report', icon: 'document-text-outline', go: '/wholesale-reports', show: wholesale && can('reports') },
      { left: 'Wholesale settings', sub: 'Credit rules, stock rules, messages and salespeople', icon: 'settings-outline', go: '/wholesale-settings', show: wholesale && can('settings') }
    ] },
    { title: 'Distributor', icon: 'navigate-outline', items: [
      { left: 'My route', sub: "Today's shops, orders and payments in the field", icon: 'navigate-outline', go: '/field', show: distributor },
      { left: 'My van', sub: 'What you carry, and sell from it', icon: 'bus-outline', go: '/van', show: distributor },
      { left: 'Principals', sub: 'The manufacturers you distribute and what you owe them', icon: 'business-outline', go: '/dist-principals', show: distributor && can('principals', 'products', 'purchases') },
      { left: 'Schemes', sub: 'Free goods and discounts for shops', icon: 'pricetags-outline', go: '/dist-schemes', show: distributor && can('schemes') },
      { left: 'Areas and routes', sub: 'Regions, territories, areas and beats', icon: 'map-outline', go: '/dist-areas', show: distributor && can('territories') },
      { left: 'Sales team', sub: 'Salespeople, targets and commission', icon: 'people-outline', go: '/dist-team', show: distributor && can('targets', 'territories') },
      { left: 'Vans', sub: 'The register of vans, drivers and routes', icon: 'car-outline', go: '/dist-vans', show: distributor && can('vehicles') }
    ] },
    { title: 'Stock', icon: 'cube-outline', items: [
      { left: 'Products', sub: 'The menu: prices, stock, add an item', icon: 'cube-outline', go: '/products', main: true, show: food || salon },
      { left: 'Stock', sub: 'What is running low, and fix a count', icon: 'layers-outline', go: '/stock', main: true, show: can('inventory') },
      { left: 'Stock counts', sub: 'Scan the shelf and see what differs', icon: 'clipboard-outline', go: '/stock-counts', show: retail && can('inventory') },
      { left: 'Use-by dates', sub: 'What is expiring, and what has expired', icon: 'time-outline', go: '/expiry', show: retail },
      { left: 'Suppliers and stock coming in', sub: 'Who you buy from, and receive a delivery', icon: 'people-outline', go: '/suppliers', show: can('suppliers', 'purchases', 'inventory') },
      { left: 'Stock requests', sub: 'Ask another outlet for stock, or send what it asked for', icon: 'git-pull-request-outline', go: '/stock-requests', show: several && can('inventory') }
    ] },
    { title: 'Customers', icon: 'people-outline', items: [
      { left: 'Customers', sub: 'Their bills, and what they still owe', icon: 'person-outline', go: '/customers', main: true, show: can('customers', 'billing') },
      { left: 'Member desk', sub: 'Find a member, stamp their card, give a reward', icon: 'ribbon-outline', go: '/member-desk', show: can('billing') && hasFeature(business, 'loyalty_programmes') && !wholesale },
      { left: 'Card results', sub: 'How your loyalty cards are doing', icon: 'stats-chart-outline', go: '/loyalty-results', show: canLoyalty(business?.role) && hasFeature(business, 'loyalty_programmes') && !wholesale },
      { left: 'Design loyalty cards', sub: 'Change how your cards look', icon: 'color-palette-outline', go: '/loyalty-cards', show: canLoyalty(business?.role) && hasFeature(business, 'loyalty_programmes') && !wholesale },
      { left: 'Offers', sub: 'Discounts the till applies by itself', icon: 'pricetag-outline', go: '/offers', show: (retail || food) && canOffers((p) => allowed(business, p)) },
      { left: 'Loyalty & coupons', sub: 'Coupons', icon: 'gift-outline', go: '/loyalty', show: canLoyalty(business?.role) && !wholesale },
      { left: 'Messaging', sub: 'WhatsApp or SMS: bills, bookings, offers', icon: 'chatbubbles-outline', go: '/messaging', show: canMessaging(business?.role) },
      { left: 'Reviews', sub: 'What customers said after their bill', icon: 'star-outline', go: '/reviews', show: can('settings') && hasFeature(business, 'reviews') }
    ] },
    { title: 'Business', icon: 'stats-chart-outline', items: [
      { left: 'Payroll', sub: 'Salary from attendance, PF, ESI and tax', icon: 'wallet-outline', go: '/payroll', show: can('payroll') && hasFeature(business, 'payroll') },
      { left: 'Reports', sub: 'How much you sold, and what sells best', icon: 'stats-chart-outline', go: '/reports', main: true, show: can('reports') },
      { left: 'More reports', sub: 'Day Book, profit and loss, GST, stock, who owes you', icon: 'document-text-outline', go: '/biz-reports', show: can('reports', 'gst', 'inventory') },
      { left: 'Ask Flow AI', sub: 'Questions about your business, in plain words', icon: 'sparkles-outline', go: '/flow-ai', show: can('ai') },
      { left: 'Expenses', sub: 'Rent, salary, electricity: what you spent', icon: 'receipt-outline', go: '/expenses', show: can('expenses') },
      { left: 'Other income', sub: 'Interest, rent received, scrap: money in that is not from a bill', icon: 'cash-outline', go: '/other-income', show: can('expenses') && hasFeature(business, 'other_income') },
      { left: 'FlowBook', sub: 'Your accounts at a glance', icon: 'book-outline', go: '/flowbook', show: can('reports') && hasBooks(business) },
      { left: 'GST filing', sub: 'GSTR-1 file, GSTR-3B figures, e-invoice', icon: 'document-attach-outline', go: '/gst-filing', show: canManageTeam(business?.role) && can('gst') },
      { left: 'Accountant pack', sub: 'A ZIP of your books for the accountant', icon: 'briefcase-outline', go: '/accountant-pack', show: can('export') },
      { left: 'Profitability', sub: 'What your sales leave after food cost, fees and commission', icon: 'trending-up-outline', go: '/profitability', show: food && can('reports') },
      { left: 'Forecast', sub: 'The week ahead, and what to buy for it', icon: 'analytics-outline', go: '/forecast', show: food && can('reports') },
      { left: 'Revenue leakage', sub: 'Unusual discounts, cancellations, refunds and wastage', icon: 'shield-outline', go: '/leakage', show: food && can('settings') }
    ] },
    { title: 'Team', icon: 'people-circle-outline', items: [
      { left: 'Staff', sub: 'Who can sign in, their role and outlet', icon: 'people-circle-outline', go: '/staff', show: canManageTeam(business?.role) },
      { left: 'Outlets', sub: 'Your places, and how they compare', icon: 'storefront-outline', go: '/outlets', show: canManageTeam(business?.role) },
      { left: 'Activity log', sub: 'Who did what, and when', icon: 'time-outline', go: '/activity', show: canManageTeam(business?.role) },
      { left: 'Switch outlet', sub: outlet?.name ?? '', icon: 'swap-vertical-outline', go: '/choose', show: several }
    ] }
  ];

  /* Settings, help, team logins and switching outlet are always at the bottom, outside the grid. */
  const foot = ([
    { left: 'Settings', sub: 'Business and GST, printers and Bluetooth, language, alerts, security, backup, your plan', icon: 'settings-outline', go: '/settings' },
    { left: 'Help and support', sub: 'Find things, how to do them, ask a question, report a problem', icon: 'help-buoy-outline', go: '/help-center' },
    { left: 'Team logins', sub: 'Who can sign in, their role and outlet', icon: 'people-circle-outline', go: '/staff', show: business?.business_type === 'MECHANIC' && canManageTeam(business?.role) },
    { left: 'Switch outlet', sub: outlet?.name ?? '', icon: 'swap-vertical-outline', go: '/choose', show: several }
  ] as Item[]).filter((i) => i.show !== false);
  const shown0 = (business?.business_type === 'MECHANIC' ? garageGroups : groups)
    .map((g) => ({ ...g, items: g.items.filter((i) => i.show !== false) }))
    .filter((g) => g.items.length);
  /* The everyday options sit outside the grid as rows (once each); the groups keep the rest. */
  const top = shown0.flatMap((g) => g.items.filter((i) => i.main)).filter((i, n, all) => all.findIndex((o) => o.go === i.go) === n);
  const onTop = new Set(top.map((i) => i.go));
  const shown = shown0.map((g) => ({ ...g, items: g.items.filter((i) => !onTop.has(i.go)) })).filter((g) => g.items.length);
  const TRADE = ['Restaurant', 'Salon', 'Clothing', 'Gym', 'Gaming', 'Spare parts', 'Pharmacy', 'Wholesale', 'Distributor'];
  shown.sort((a, b) => Number(TRADE.includes(b.title)) - Number(TRADE.includes(a.title)));   // stable: the owner's own trade first, the rest keep the laptop sidebar order
  const [openTitle, setOpenTitle] = useState<string | null>(null);
  const [find, setFind] = useState('');
  const { width } = useWindowDimensions();
  const cols = width >= 900 ? 4 : width >= 560 ? 3 : 2;
  const words = find.trim().toLowerCase();
  const matches = words ? [...top, ...shown.flatMap((g) => g.items.map((i) => ({ ...i, sub: i.sub, left: i.left, _g: g.title }))), ...foot].filter((i) => `${t(i.left)} ${i.left} ${t(i.sub)} ${(i as { _g?: string })._g ?? ''}`.toLowerCase().includes(words)) : [];
  const group = shown.find((g) => g.title === openTitle);
  const go = (i: Item) => (['/products', '/appointments', '/salon-clients'].includes(i.go) ? router.navigate(i.go as never) : router.push(i.go as never));

  return (
    <SafeAreaView style={s.screen} edges={['top']}>
      <Page max={1040}>
        <ScrollView contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
          <View style={{ padding: 16, paddingBottom: 8, gap: 4 }}>
            <Title>More</Title>
            <Soft>{business?.name} · {outlet?.name}</Soft>
            <SyncBadge />
          </View>
          {group ? (
            <>
              <Pressable accessibilityRole="button" accessibilityLabel={t('All menus')} onPress={() => setOpenTitle(null)} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 16, paddingVertical: 12, minHeight: 48 }}>
                <Ionicons name="chevron-back" size={22} color={color.brand} />
                <Text style={{ color: color.brand, fontSize: 16, fontWeight: '600' }}>{t('All menus')}</Text>
              </Pressable>
              <SectionTitle>{group.title}</SectionTitle>
              <Card><Rows>{group.items.map((i) => <Line key={i.left} icon={i.icon} left={i.left} sub={i.sub} onPress={() => go(i)} />)}</Rows></Card>
            </>
          ) : (
            <>
              <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}>
                <TextInput value={find} onChangeText={setFind} placeholder={t('Find a menu: bills, stock, staff…')} placeholderTextColor={color.soft} autoCapitalize="none" autoCorrect={false} returnKeyType="search" accessibilityLabel={t('Find a menu')} style={{ minHeight: 48, borderWidth: 1, borderColor: color.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, color: color.ink, backgroundColor: color.card }} />
              </View>
              {words ? (
                matches.length ? <Card><Rows>{matches.map((i) => <Line key={i.left + i.go} icon={i.icon} left={i.left} sub={i.sub} onPress={() => go(i)} />)}</Rows></Card> : <Empty>{t('Nothing matches. Try another word.')}</Empty>
              ) : (
                <>
                {top.length ? <SectionTitle>Quick access</SectionTitle> : null}
                <Card><Rows>{top.map((i) => <Line key={i.go} icon={i.icon} left={i.left} sub={i.sub} onPress={() => go(i)} />)}</Rows></Card>
                <SectionTitle>All features</SectionTitle>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 10 }}>
                  {shown.map((g, gi) => (
                    <FadeIn key={g.title} index={gi} lift={8} style={{ width: `${100 / cols}%`, padding: 6 }}>
                      <Pressable accessibilityRole="button" accessibilityLabel={`${t(g.title)}, ${g.items.length}`} onPress={() => setOpenTitle(g.title)} android_ripple={{ color: '#0b57ff22' }}
                        style={{ minHeight: 104, borderRadius: radius.card, borderCurve: 'continuous', borderWidth: 1, borderColor: color.line, backgroundColor: color.card, padding: 14, gap: 10, justifyContent: 'space-between', boxShadow: shadow.card }}>
                        <View style={{ width: 44, height: 44, borderRadius: 14, borderCurve: 'continuous', backgroundColor: color.wash, alignItems: 'center', justifyContent: 'center' }}><Ionicons name={g.icon} size={22} color={color.ink} /></View>
                        <View>
                          <Text numberOfLines={1} style={{ fontSize: 15, fontFamily: display.bold, color: color.ink }}>{t(g.title)}</Text>
                          <Text style={{ fontSize: 12, color: color.soft }}>{g.items.length === 1 ? t('1 thing') : t('{{n}} things', { n: g.items.length })}</Text>
                        </View>
                      </Pressable>
                    </FadeIn>
                  ))}
                </View>
                <SectionTitle>Settings and help</SectionTitle><Card><Rows>{foot.map((i) => <Line key={i.go} icon={i.icon} left={i.left} sub={i.sub} onPress={() => go(i)} />)}</Rows></Card>
                </>
              )}
              <SectionTitle>Account</SectionTitle>
              <View style={[s.card, { marginHorizontal: 16, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 }]}>
                <Initials name={session.user?.name ?? session.user?.email} size={48} />
                <View style={{ flex: 1, gap: 2 }}>
                  {session.user?.name ? <Text numberOfLines={1} style={{ color: color.ink, fontSize: 16, fontWeight: '700' }}>{session.user.name}</Text> : null}
                  <Soft>{session.user?.email}</Soft>
                </View>
              </View>
              <Card><Rows><Line icon="log-out-outline" left="Sign out" onPress={leave} /></Rows></Card>
            </>
          )}
          <Soft style={{ textAlign: 'center', padding: 16 }}>FlowXP {appVersion()}</Soft>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
