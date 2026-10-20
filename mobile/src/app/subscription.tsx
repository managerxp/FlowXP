import { useCallback, useEffect, useState } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { canSubscription, cycleText, dateText, payText, planPrice, safeLink, statusLabel, type Plan, type Subscription } from '../lib/subscription.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* The subscription (owner): the plan, trial and next billing date, any payment link sent for this account, and the plans. */
export default function SubscriptionScreen() {
  const me = currentBusiness(useSession());
  const ok = canSubscription(me?.role);
  const [sub, setSub] = useState<Subscription | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const load = useCallback(async () => {
    try { const [a, b] = await Promise.all([api.get<Subscription>('/businesses/current/subscription'), api.get<Plan[]>('/plans')]); setSub(a); setPlans(b); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
  }, []);
  useEffect(() => { if (ok) void load(); }, [load, ok]);
  const pay = async () => { setProblem(''); const link = safeLink(sub?.pending_payment?.payment_link_url); try { if (!link) throw new Error('no link'); await Linking.openURL(link); } catch { setProblem(t('Could not open the payment page.')); } };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Subscription</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>Only the owner can see the subscription.</Empty> : error && !sub ? <Failed message={error} onRetry={() => { void load(); }} /> : !sub ? <Loading /> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Line left={t('Status')} right={statusLabel(sub.status)} />
            <Line left={t('Plan')} right={sub.plan?.name ?? sub.plan_code} />
            {sub.status === 'TRIAL' ? <><Line left={t('Trial ends')} right={dateText(sub.trial_ends_at)} /><Line left={t('Days remaining')} right={String(sub.trial_days_remaining ?? 0)} /></> : null}
            {sub.billing_cycle ? <Line left={t('Billing cycle')} right={cycleText(sub.billing_cycle)} /> : null}
            {sub.next_billing_date ? <Line left={t('Next billing date')} right={dateText(sub.next_billing_date)} /> : null}
            {sub.status === 'EXPIRED' && !sub.pending_payment ? <Soft style={{ padding: 16 }}>{t('Your trial has ended. Everything you created is still here and still readable. Paying turns billing back on.')}</Soft> : null}
            {sub.pending_payment ? (
              <View style={[s.card, { margin: 16, gap: 8 }]}>
                <Text style={{ fontWeight: '700', color: color.ink }}>{payText(sub.pending_payment)}</Text>
                <Soft>{t("A payment link was sent for your account. Pay on Cashfree's secure page. We never see your card or UPI details.")}</Soft>
                <Button title={t('Pay {amount} now', { amount: rupees(toPaise(sub.pending_payment.amount)) })} onPress={() => { void pay(); }} />
                <ErrorText>{problem}</ErrorText>
              </View>
            ) : null}
            <SectionTitle>Plans</SectionTitle>
            {plans.map((p) => <Line key={p.plan_code} left={p.name} right={planPrice(p)} sub={p.description} />)}
            <Soft style={{ padding: 16 }}>{t('Pricing is agreed with our team, not self-serve. Contact flowxp.manager@gmail.com and we will send a secure payment link for your plan.')}</Soft>
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
