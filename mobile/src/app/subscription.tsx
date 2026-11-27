import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { canSubscription, dateText, statusLabel, type Subscription } from '../lib/subscription.ts';
import { rupees } from '../lib/money.ts';
import { Button, Empty, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const CONTACT = 'flowxp.manager@gmail.com';
const contact = (subject: string) => { void Linking.openURL(`mailto:${CONTACT}?subject=${encodeURIComponent(subject)}`); };

/* The subscription (owner): the plan, the trial and the date it runs to. Information only: no prices, no payment button and no link to pay, because Google Play requires in-app payments for features to go through Play Billing. */
export default function SubscriptionScreen() {
  const me = currentBusiness(useSession());
  const ok = canSubscription(me?.role);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [error, setError] = useState('');
  const [wallet, setWallet] = useState<{ balance_paise: number } | null>(null);
  const load = useCallback(async () => {
    try { setSub(await api.get<Subscription>('/businesses/current/subscription')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
  }, []);
  useEffect(() => { if (ok) { void load(); api.get<{ balance_paise: number }>('/messaging/wallet').then(setWallet).catch(() => {}); } }, [load, ok]);

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Subscription</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>Only the owner can see the subscription.</Empty> : error && !sub ? <Failed message={error} onRetry={() => { void load(); }} /> : !sub ? <Loading /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Line left={t('Status')} right={statusLabel(sub.status)} />
            <Line left={t('Plan')} right={sub.plan?.name ?? sub.plan_code} />
            {sub.status === 'TRIAL' ? <><Line left={t('Trial ends')} right={dateText(sub.trial_ends_at)} /><Line left={t('Days remaining')} right={String(sub.trial_days_remaining ?? 0)} /></> : null}
            {sub.next_billing_date ? <Line left={t('Next billing date')} right={dateText(sub.next_billing_date)} /> : null}
            {sub.status === 'EXPIRED' ? <Soft style={{ padding: 16 }}>{t('Your trial has ended. Everything you created is still here and still readable.')}</Soft> : null}
            {wallet ? (
              <>
                <SectionTitle>WhatsApp credit</SectionTitle>
                <Line left={t('Credit')} right={rupees(Number(wallet.balance_paise))} />
                <Soft style={{ paddingHorizontal: 16, paddingTop: 8 }}>We load credit for you.</Soft>
              </>
            ) : null}
            {sub.addons?.length ? (
              <>
                <SectionTitle>Add-ons</SectionTitle>
                {sub.addons.map((a) => (
                  <View key={a.addon_key} style={{ paddingHorizontal: 16, paddingVertical: 10, gap: 4, borderTopWidth: 1, borderColor: color.line }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{a.name}{a.owned ? `  ·  ${t('On')}` : ''}</Text>
                    {a.description ? <Soft>{a.description}</Soft> : null}
                  </View>
                ))}
              </>
            ) : null}
            {/* the one way to reach us: add-ons, WhatsApp credit, plan prices and questions */}
            <View style={{ padding: 16, paddingTop: 24, gap: 10 }}>
              <Soft style={{ textAlign: 'center' }}>For add-ons, WhatsApp credit, plan prices or any question, write to us.</Soft>
              <Button title="Contact us" onPress={() => contact('FlowXP subscription')} />
            </View>
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
