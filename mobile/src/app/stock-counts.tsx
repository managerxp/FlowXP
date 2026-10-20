import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { canCount, listLine, startBody, startProblem, statusLabel, type CountRow } from '../lib/stockCount.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

type Category = { category_id: number; name: string };

/* Stock counts: the ones made so far, and a new one (the whole store, or one category). */
export default function StockCounts() {
  const me = currentBusiness(useSession());
  const ok = canCount((p) => allowed(me, p));
  const [rows, setRows] = useState<CountRow[] | null>(null);
  const [cats, setCats] = useState<Category[]>([]);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [error, setError] = useState('');
  const [problem, setProblem] = useState('');
  const [busy, setBusy] = useState(false);
  const load = useCallback(async () => {
    setBusy(true);
    try { setRows(await api.get<CountRow[]>('/retail/counts')); setError(''); } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); } finally { setBusy(false); }
  }, []);
  useFocusEffect(useCallback(() => { if (ok) void load(); }, [load, ok]));
  useEffect(() => { if (ok) api.get<Category[]>('/categories').then(setCats).catch(() => {}); }, [ok]);

  const start = async () => {
    const bad = startProblem(name);
    if (bad) { setProblem(t(bad)); return; }
    setBusy(true); setProblem('');
    try { const c = await api.post<CountRow>('/retail/counts', startBody(name, category)); setName(''); router.push({ pathname: '/stock-count', params: { id: String(c.count_id) } }); }
    catch (e) { setProblem(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Stock counts</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!ok ? <Empty>You do not have access to stock counts.</Empty> : error && !rows ? <Failed message={error} onRetry={() => { void load(); }} /> : !rows ? <Loading /> : (
          <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            <View style={{ padding: 16, gap: 10 }}>
              <Soft>{t('Walk the shelf, scan each product once per unit, and see what differs from the system before anything changes.')}</Soft>
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('Name')}</Text>
              <TextInput style={s.input} value={name} onChangeText={setName} maxLength={80} accessibilityLabel={t('Name')} />
              <Soft>{t('So you can tell counts apart later, like “Aisle 3” or “Month end”.')}</Soft>
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('What are you counting?')}</Text>
              <Chips items={[{ id: '', label: 'The whole store' }, ...cats.map((c) => ({ id: String(c.category_id), label: c.name }))]} value={category} onChange={setCategory} />
              <ErrorText>{problem}</ErrorText>
              <Button title="Start counting" onPress={() => { void start(); }} busy={busy} />
            </View>
            {rows.length === 0 ? <Empty>No stock counts yet.</Empty> : <SectionTitle>Count stock</SectionTitle>}
            {rows.map((c) => (
              <Line key={c.count_id} left={c.name} right={statusLabel(c.status)} sub={listLine(c)} onPress={() => router.push({ pathname: '/stock-count', params: { id: String(c.count_id) } })} />
            ))}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
