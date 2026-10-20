import { useCallback, useEffect, useState } from 'react';
import { router, useFocusEffect } from 'expo-router';
import { RefreshControl, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { canEditPerson, canManageTeam, roleLabel, statusLabel, type Person } from '../lib/team.ts';
import { Button, Empty, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* Staff (owner and admin): who can sign in, in what role and at which outlet. Tap a person to change their role, outlet or access. */
export default function Staff() {
  const session = useSession();
  const me = currentBusiness(session);
  const allowed = canManageTeam(me?.role);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!allowed) return;
    setBusy(true); setError('');
    try { setPeople(await api.get<Person[]>('/staff')); }
    catch (e) { setError(e instanceof ApiError && e.status === 403 ? t('Managing staff is for owners and admins.') : e instanceof Error ? e.message : t('Could not load.')); }
    finally { setBusy(false); }
  }, [allowed]);
  useEffect(() => { void load(); }, [load]);
  useFocusEffect(useCallback(() => { void load(); }, [load]));   // back from an edit: show the change

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <Title>Staff</Title>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            {allowed ? <Button title="Add person" onPress={() => router.push('/staff-person')} /> : null}
            <Button title="Back" kind="quiet" onPress={() => goBack()} />
          </View>
        </View>
        <Soft style={{ paddingHorizontal: 16, paddingBottom: 8 }}>{t('Who can sign in, what they can do, and where.')}</Soft>
        {!allowed ? <Empty>Only owners and admins can manage this.</Empty> : null}
        {allowed && error && !people ? <Failed message={error} onRetry={() => { void load(); }} /> : null}
        {allowed && busy && !people ? <Loading /> : null}
        {allowed && people ? (
          <ScrollView refreshControl={<RefreshControl refreshing={busy} onRefresh={() => { void load(); }} />} contentContainerStyle={{ paddingBottom: 32 }}>
            {people.length === 0 ? <Empty>No one yet.</Empty> : null}
            {people.map((p) => {
              const editable = canEditPerson({ role: me?.role }, p);
              return (
                <Line key={p.user_id} left={p.is_you ? `${p.name} (${t('You')})` : p.name} right={t(statusLabel(p.status))}
                  sub={[roleLabel(p.role), p.branch_name ?? t('Every outlet'), p.email].join(' · ')}
                  onPress={editable ? () => router.push({ pathname: '/staff-person', params: { id: String(p.user_id) } }) : undefined} />
              );
            })}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
