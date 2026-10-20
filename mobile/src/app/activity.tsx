import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { API_URL, api, currentBusiness, sessionStore, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { shareDownload } from '../lib/share.ts';
import { activityCsvRequest, activityQuery, canSeeTeamSecurity, lastDays, roleText, whenText, type ActivityFilters, type ActivityPage } from '../lib/security.ts';
import type { Person } from '../lib/team.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const RANGES = [{ id: '1', label: 'Today' }, { id: '7', label: '7 days' }, { id: '30', label: '30 days' }];

/* The activity log (owner and admin): who did what and when, in plain sentences. Filter by person, area, outlet, dates and words; export what is shown. */
export default function Activity() {
  const session = useSession();
  const me = currentBusiness(session);
  const allowed = canSeeTeamSecurity(me?.role);
  const outlets = me?.outlets ?? [];
  const [days, setDays] = useState('7');
  const [filters, setFilters] = useState<ActivityFilters>({ user_id: '', category: '', outlet: '', q: '', ...lastDays(7) });
  const [search, setSearch] = useState('');
  const [people, setPeople] = useState<Person[]>([]);
  const [data, setData] = useState<ActivityPage | null>(null);
  const [categories, setCategories] = useState<{ key: string; label: string }[]>([]);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [exportError, setExportError] = useState('');

  const load = useCallback(async (more = false) => {
    if (!allowed) return;
    setBusy(true); setError('');
    try {
      const page = await api.get<ActivityPage>(`/audit?${activityQuery(filters, more && data?.next ? { before: data.next } : {})}`);
      setData((prev) => (more && prev ? { ...page, entries: [...prev.entries, ...page.entries] } : page));
      if (page.categories.length) setCategories(page.categories);
    } catch (e) { setError(e instanceof ApiError && e.status === 403 ? t('The activity log is for owners and admins.') : e instanceof Error ? e.message : t('Could not load.')); }
    finally { setBusy(false); }
  }, [allowed, filters]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { if (allowed) api.get<Person[]>('/staff').then(setPeople).catch(() => {}); }, [allowed]);

  const set = (patch: Partial<ActivityFilters>) => setFilters((f) => ({ ...f, ...patch }));
  const exportCsv = async () => {
    setExportError('');
    try { await shareDownload(activityCsvRequest(API_URL, sessionStore.get(), filters), 'text/csv', 'public.comma-separated-values-text', 'Export CSV'); }
    catch (e) { setExportError(e instanceof Error ? t(e.message) : t('Could not load.')); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={720}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Activity log</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        {!allowed ? <Empty>{t('The activity log is for owners and admins.')}</Empty> : (
          <ScrollView refreshControl={<RefreshControl refreshing={busy && !data} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }} keyboardShouldPersistTaps="handled">
            <Soft style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{t('Who did what, and when. Everything that changes money, stock, the menu or the team is recorded here.')}</Soft>
            <Chips items={RANGES.map((r) => ({ id: r.id, label: t(r.label) }))} value={days} onChange={(d) => { setDays(d); set(lastDays(Number(d))); }} />
            <View style={{ paddingHorizontal: 16, gap: 6, paddingTop: 8 }}>
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('Person')}</Text>
              <Chips items={[{ id: '', label: t('Everyone') }, ...people.map((p) => ({ id: String(p.user_id), label: p.name }))]} value={filters.user_id} onChange={(v) => set({ user_id: v })} />
              {categories.length ? <><Text style={{ color: color.soft, fontSize: 13 }}>{t('Area')}</Text><Chips items={[{ id: '', label: t('All areas') }, ...categories.map((c) => ({ id: c.key, label: t(c.label) }))]} value={filters.category} onChange={(v) => set({ category: v })} /></> : null}
              {outlets.length > 1 ? <><Text style={{ color: color.soft, fontSize: 13 }}>{t('Outlet')}</Text><Chips items={[{ id: '', label: t('All outlets') }, ...outlets.map((o) => ({ id: String(o.branch_id), label: o.name }))]} value={filters.outlet} onChange={(v) => set({ outlet: v })} /></> : null}
              <TextInput style={s.input} value={search} onChangeText={setSearch} onSubmitEditing={() => set({ q: search.trim() })} returnKeyType="search" placeholder={t('Search…')} accessibilityLabel={t('Search…')} autoCapitalize="none" />
            </View>
            {error && !data ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
            {busy && !data ? <Loading /> : null}
            {data && data.entries.length === 0 ? <Empty>Nothing recorded for these filters.</Empty> : null}
            {data?.entries.map((e) => (
              <Line key={e.audit_id} left={e.summary} right={t(categories.find((c) => c.key === e.category)?.label ?? 'Other')}
                sub={[e.user, roleText(e.role), whenText(e.at), e.outlet].filter(Boolean).join(' · ')} />
            ))}
            {data ? (
              <View style={{ padding: 16, gap: 8 }}>
                {data.next ? <Button title="Show older" kind="quiet" onPress={() => { void load(true); }} busy={busy} /> : data.entries.length ? <Soft style={{ textAlign: 'center' }}>{t('That’s everything for these days.')}</Soft> : null}
                {data.entries.length ? <Button title="Export CSV" kind="quiet" onPress={() => { void exportCsv(); }} /> : null}
                <ErrorText>{exportError || (error && data ? error : '')}</ErrorText>
              </View>
            ) : null}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
