import { Text, ScrollView, View } from 'react-native';
import { router, type Href } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '../../lib/icons.tsx';
import { currentBusiness, useSession } from '../../lib/session.ts';
import { allowed, hasFeature } from '../../lib/access.ts';
import { api } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { rupees } from '../../lib/money.ts';
import { canMessaging } from '../../lib/messaging.ts';
import { canGymSetup } from '../../lib/gymSetup.ts';
import { canManageTeam } from '../../lib/team.ts';
import { t } from '../../lib/i18n.ts';
import { Page } from '../../lib/responsive.tsx';
import { Group, Line, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

type Item = { left: string; sub?: string; icon: React.ComponentProps<typeof Ionicons>['name']; go: string; show?: boolean };

/* The Gym tab: the gym's own details and everything that is set up once (plans, classes, team, settings), grouped as an owner thinks of it. */
export default function GymHub() {
  const session = useSession();
  const business = currentBusiness(session);
  const outlet = business?.outlets.find((o) => o.branch_id === session.branchId);
  const can = (...k: string[]) => allowed(business, ...k);
  const wa = canMessaging(business?.role) && hasFeature(business, 'messaging');
  const wallet = useLoad<{ required: boolean; balance_paise: number }>(`gym-wa-credit:${session.businessId}`, () => api.get('/messaging/wallet'), wa);
  const setup = canGymSetup((p) => allowed(business, p));
  const groups: { title: string; items: Item[] }[] = [
    { title: 'Manage plans', items: [
      { left: 'Membership plans', sub: 'What the gym sells, for how long and for how much', icon: 'pricetags-outline', go: '/gym-plans', show: setup },
      { left: 'Classes and trainers', sub: 'Today’s classes: who booked, who came', icon: 'calendar-outline', go: '/gym-classes', show: can('gym_desk', 'gym_trainer') }
    ] },
    { title: 'Shop and supplements', items: [
      { left: 'Sell supplements', sub: 'Protein, shakers and more, to a member or a walk-in', icon: 'cart-outline', go: '/gym-shop', show: can('gym_desk') },
      { left: 'Products', sub: 'Your product list: prices, photos and what is in stock', icon: 'cube-outline', go: '/products', show: can('products', 'inventory') },
      { left: 'Add a product', sub: 'Name, price and GST; then receive its stock', icon: 'add', go: '/product/new', show: can('products') },
      { left: 'Receive stock', sub: 'Goods you bought, added to the shelf', icon: 'layers-outline', go: '/receive', show: can('purchases', 'inventory') }
    ] },
    { title: 'Attendance', items: [
      { left: 'Front desk', sub: 'Let members in: scan a pass or find them', icon: 'qr-code-outline', go: '/gym', show: can('gym_desk') },
      { left: 'Who came today', sub: 'Visits so far, and who is still inside', icon: 'time-outline', go: '/gym-attendance', show: can('gym_desk', 'gym_members') },
      { left: 'Check-in rules and the entrance QR', sub: 'Hours, holidays and how members enter', icon: 'settings-outline', go: '/gym-settings', show: setup }
    ] },
    { title: 'WhatsApp', items: [
      { left: 'WhatsApp messages and credit', sub: wallet.data ? `${t('Credit')}: ${rupees(Number(wallet.data.balance_paise))}` : 'Welcome, renewal and dues messages, and your credit', icon: 'chatbubbles-outline', go: '/messaging', show: wa }
    ] },
    { title: 'Account and billing', items: [
      { left: 'Staff logins', sub: 'Who can sign in, their role and outlet', icon: 'people-circle-outline', go: '/staff', show: canManageTeam(business?.role) },
      { left: 'Business and invoice settings', sub: 'Name, GST, address, printers', icon: 'business-outline', go: '/business-settings', show: canManageTeam(business?.role) },
      { left: 'Your FlowXP plan', sub: 'Renew or change your subscription', icon: 'card-outline', go: '/subscription', show: canManageTeam(business?.role) }
    ] },
    { title: 'App and support', items: [
      { left: 'Language, theme and alerts', icon: 'language-outline', go: '/settings' },
      { left: 'Help and support', sub: 'How to do things, ask a question', icon: 'help-buoy-outline', go: '/help-center' },
      { left: 'Everything else', sub: 'Reports, expenses, messages and more', icon: 'menu-outline', go: '/more' }
    ] }
  ];
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ paddingBottom: 60 }}>
          <View style={{ padding: 16 }}>
            <View style={[s.card, { flexDirection: 'row', alignItems: 'center', gap: 14 }]}>
              <View style={{ width: 56, height: 56, borderRadius: 28, backgroundColor: color.navy, alignItems: 'center', justifyContent: 'center' }}><Ionicons name="barbell-outline" size={28} color={color.onNavy} /></View>
              <View style={{ flex: 1 }}>
                <Title>{business?.name ?? 'My gym'}</Title>
                <Soft>{[outlet?.name, session.user?.name].filter(Boolean).join(' · ')}</Soft>
                {session.user?.email ? <Text selectable style={{ color: color.soft, fontSize: 13 }}>{session.user.email}</Text> : null}
              </View>
            </View>
          </View>
          {groups.map((g) => {
            const items = g.items.filter((i) => i.show !== false);
            return items.length ? (
              <View key={g.title}>
                <SectionTitle>{g.title}</SectionTitle>
                <Group>{items.map((i) => <Line key={i.left} left={i.left} sub={i.sub} icon={i.icon} onPress={() => router.push(i.go as Href)} />)}</Group>
              </View>
            ) : null;
          })}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
