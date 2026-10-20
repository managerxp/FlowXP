import { useEffect, useState } from 'react';
import { ScrollView, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { ROLES, choiceOf, effective, permissionsBody, type Choice, type PermissionRow } from '../lib/team.ts';
import { Button, Chips, ErrorText, Failed, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

/* What one person may do: the role's default for each thing, with an allow or deny where the owner wants this person to differ (owner only). */
export default function StaffPermissions() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [data, setData] = useState<{ role: string; editable: boolean; permissions: PermissionRow[] } | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState('');

  useEffect(() => {
    api.get<{ role: string; editable: boolean; permissions: PermissionRow[] }>(`/staff/${id}/permissions`)
      .then((d) => { setData(d); setChoices(Object.fromEntries(d.permissions.map((p) => [p.key, choiceOf(p)]))); })
      .catch((e: Error) => setError(e.message));
  }, [id]);

  const save = async () => {
    if (!data) return;
    setBusy(true); setSaveError('');
    try { await api.call(`/staff/${id}/permissions`, { method: 'PUT', body: permissionsBody(data.permissions, choices) }); router.back(); }
    catch (e) { setSaveError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>Permissions</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
        {error ? <Failed message={error} /> : null}
        {!data && !error ? <Loading /> : null}
        {data ? (
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
            <Soft>{`${ROLES[data.role] ?? data.role}. ${t('Each row starts from what the role allows; change one only when this person should differ.')}`}</Soft>
            {!data.editable ? <Soft>{t('Owners always have every permission.')}</Soft> : data.permissions.map((p) => {
              const choice = choices[p.key] ?? 'default';
              return (
                <View key={p.key} style={[s.card, { gap: 8 }]}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <Text style={{ flex: 1, color: color.ink, fontWeight: '600' }}>{p.label}</Text>
                    <Text style={{ color: effective(p, choice) ? color.ok : color.danger, fontWeight: '700' }}>{effective(p, choice) ? '✓' : '✕'}</Text>
                  </View>
                  <Chips items={[{ id: 'default', label: p.role_default ? t('Role default (can)') : t("Role default (can't)") }, { id: 'allow', label: t('Allow') }, { id: 'deny', label: t('Deny') }]} value={choice} onChange={(v) => setChoices((o) => ({ ...o, [p.key]: v as Choice }))} />
                </View>
              );
            })}
            <ErrorText>{saveError}</ErrorText>
            {data.editable ? <Button title={t('Save permissions')} onPress={() => { void save(); }} busy={busy} /> : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
