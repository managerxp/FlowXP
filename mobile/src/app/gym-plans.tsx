import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { canGymSetup, planPriceText, planSub, type GymSettings, type Plan } from '../lib/gymSetup.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* The gym's plans: what it sells, for how long and for how much. Each membership keeps the rules it was sold with. */
export default function GymPlans() {
  const me = currentBusiness(useSession());
  const ok = canGymSetup((p) => allowed(me, p));
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [settings, setSettings] = useState<GymSettings | null>(null);
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { const [p, st] = await Promise.all([api.get<Plan[]>('/gym/plans?all=true'), api.get<GymSettings>('/gym/settings')]); setPlans(p); setSettings(st); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (ok) void load(); }, [load, ok]));
  const archive = async (p: Plan) => {
    setProblem(''); setNote('');
    try { await api.call(`/gym/plans/${p.plan_id}/${p.is_active ? 'archive' : 'restore'}`, { method: 'POST', body: {} }); setNote(p.is_active ? t('Plan taken off sale') : t('Plan is back on sale')); await load(); } catch (e) { setProblem(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Gym plans</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to gym set-up.</Empty> : error && !plans ? <Failed message={error} onRetry={() => { void load(); }} /> : !plans ? <Loading /> : (
          <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 40 }}>
            <View style={{ padding: 16, gap: 8 }}>
              <Soft>{t('What you sell. Each membership keeps the rules it was sold with, so changing a plan only affects the next sale.')}</Soft>
              <Button title="New plan" onPress={() => router.push('/gym-plan-edit')} />
              <ErrorText>{problem}</ErrorText>
              {note ? <Soft>{note}</Soft> : null}
            </View>
            {plans.length === 0 ? <View style={{ padding: 16, gap: 8 }}><Empty>No plans yet.</Empty><Soft>{t('Add a monthly plan to start selling memberships.')}</Soft></View> : null}
            {plans.map((p) => (
              <View key={p.plan_id} style={{ opacity: p.is_active ? 1 : 0.7 }}>
                <Line left={p.name} right={p.is_active ? planPriceText(p) : t('Off sale')} sub={planSub(p, settings?.branches ?? [])} onPress={() => router.push({ pathname: '/gym-plan-edit', params: { id: String(p.plan_id) } })} />
                <View style={{ paddingHorizontal: 16, paddingBottom: 10 }}><Button title={p.is_active ? 'Take off sale' : 'Put back on sale'} kind="quiet" onPress={() => { void archive(p); }} /></View>
              </View>
            ))}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
