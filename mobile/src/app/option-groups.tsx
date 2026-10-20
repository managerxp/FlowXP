import { useCallback, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { canOptions, groupSub, ruleOf, usedText, type Group } from '../lib/menuOptions.ts';
import { Button, Empty, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* Options & add-ons: the groups customers choose from on a dish (a size, a level, extras), and how many dishes offer each. */
export default function OptionGroups() {
  const me = currentBusiness(useSession());
  const ok = canOptions((p) => allowed(me, p));
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setGroups(await api.get<Group[]>('/modifier-groups?all=true')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (ok) void load(); }, [load, ok]));
  const active = (groups ?? []).filter((g) => g.is_active);
  const unused = active.filter((g) => g.products.length === 0).length;

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Options & add-ons</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to options.</Empty> : error && !groups ? <Failed message={error} onRetry={() => { void load(); }} /> : !groups ? <Loading /> : (
          <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ padding: 16, gap: 8 }}>
              <Soft>{[t('Sizes, levels and add-ons customers choose on a dish'), t('{n} in use', { n: active.length }), unused ? t('{n} not on any dish', { n: unused }) : ''].filter(Boolean).join(' · ')}</Soft>
              <Button title="New group" onPress={() => router.push('/option-group-edit')} />
            </View>
            {groups.length === 0 ? <View style={{ padding: 16, gap: 8 }}><Empty>No option groups yet</Empty><Soft>{t('Make one for a size (Half / Full), a level (Mild / Hot) or extras (Cheese, Egg), then choose the dishes that offer it.')}</Soft></View> : null}
            {groups.map((g) => (
              <Line key={g.group_id} left={g.name} right={g.is_active ? usedText(g) : t('Off')} sub={`${ruleOf(g)} · ${groupSub(g)}`} onPress={() => router.push({ pathname: '/option-group', params: { id: String(g.group_id) } })} />
            ))}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
