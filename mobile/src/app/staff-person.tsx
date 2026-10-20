import { useEffect, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { GROUP_ROLES, ROLES, ROLE_HELP, addPersonBody, canEditPerson, editPersonBody, needsOutlet, rolesFor, type Person } from '../lib/team.ts';
import { Button, Chips, ErrorText, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Add a person (they get an e-mail to set their own password), or change a person's role, outlet and access. */
export default function StaffPerson() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const session = useSession();
  const me = currentBusiness(session);
  const isOwner = me?.role === 'OWNER';
  const outlets = me?.outlets ?? [];
  const roles = rolesFor(me?.business_type, isOwner, Boolean(me?.distributor_enabled));
  const [person, setPerson] = useState<Person | null>(null);
  const [loaded, setLoaded] = useState(!id);
  const [form, setForm] = useState({ name: '', email: '', role: 'CASHIER', status: 'ACTIVE', branch_id: '' as number | '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!id) return;
    api.get<Person[]>('/staff').then((list) => {
      const p = list.find((x) => x.user_id === Number(id)) ?? null;
      setPerson(p);
      if (p) setForm({ name: p.name, email: p.email, role: p.role, status: p.status === 'DISABLED' ? 'DISABLED' : 'ACTIVE', branch_id: p.branch_id ?? '' });
      setLoaded(true);
    }).catch((e: Error) => { setError(e.message); setLoaded(true); });
  }, [id]);

  const group = GROUP_ROLES.includes(form.role);
  const mustPick = needsOutlet(form.role) && outlets.length > 1;
  const editable = !person || canEditPerson({ role: me?.role }, person);

  const save = async () => {
    if (!person && (!form.name.trim() || !form.email.trim())) { setError(t('Enter a name and an email.')); return; }
    if (mustPick && form.branch_id === '') { setError(t('Choose an outlet')); return; }
    setBusy(true); setError('');
    try {
      if (person) { await api.call(`/staff/${person.user_id}`, { method: 'PUT', body: editPersonBody(form) }); router.back(); return; }
      const result = await api.post<{ invited?: boolean }>('/staff', addPersonBody(form));
      Alert.alert(t('Added'), result?.invited ? t('Sent {email} a link to set their password', { email: form.email }) : t('{email} now has access', { email: form.email }), [{ text: 'OK', onPress: () => router.back() }]);
    } catch (e) { setError(e instanceof ApiError ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>{person ? person.name : t('Add person')}</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!loaded ? <Loading /> : null}
          {loaded && id && !person ? <ErrorText>{error || t('Not found')}</ErrorText> : null}
          {loaded && editable && (!id || person) ? (
            <>
              {!person ? (
                <>
                  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Name')}</Text><TextInput style={s.input} value={form.name} onChangeText={(v) => setForm((o) => ({ ...o, name: v }))} accessibilityLabel={t('Name')} /></View>
                  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t('Email')}</Text><TextInput style={s.input} value={form.email} onChangeText={(v) => setForm((o) => ({ ...o, email: v }))} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} accessibilityLabel={t('Email')} /></View>
                  <Soft>{t('They get a link to set their own password.')}</Soft>
                </>
              ) : <Soft>{person.email}</Soft>}

              <SectionTitle>Role</SectionTitle>
              {roles.map((r) => <Line key={r} left={ROLES[r]} sub={ROLE_HELP[r]} selected={form.role === r} onPress={() => setForm((o) => ({ ...o, role: r, branch_id: GROUP_ROLES.includes(r) ? '' : o.branch_id }))} />)}

              {group ? <Soft>{t('{role}s can see every outlet.', { role: ROLES[form.role] })}</Soft> : outlets.length > 1 ? (
                <>
                  <SectionTitle>Outlet</SectionTitle>
                  <Soft style={{ paddingHorizontal: 16 }}>{needsOutlet(form.role) ? t('They can only see and work in this outlet.') : t('Leave on "Every outlet" for a group-level manager.')}</Soft>
                  {!needsOutlet(form.role) ? <Line left={t('Every outlet')} selected={form.branch_id === ''} onPress={() => setForm((o) => ({ ...o, branch_id: '' }))} /> : null}
                  {outlets.map((o) => <Line key={o.branch_id} left={o.name} selected={form.branch_id === o.branch_id} onPress={() => setForm((x) => ({ ...x, branch_id: o.branch_id }))} />)}
                </>
              ) : null}

              {person ? (
                <>
                  <SectionTitle>Access</SectionTitle>
                  <Chips items={[{ id: 'ACTIVE', label: 'Active' }, { id: 'DISABLED', label: "Disabled: can't sign in to this business" }]} value={form.status} onChange={(v) => setForm((o) => ({ ...o, status: v }))} />
                </>
              ) : null}
              <ErrorText>{error}</ErrorText>
              <Button title={person ? t('Save changes') : t('Add person')} onPress={() => { void save(); }} busy={busy} />
              {person && isOwner && person.role !== 'OWNER' ? <Button title="Permissions" kind="quiet" onPress={() => router.push({ pathname: '/staff-permissions', params: { id: String(person.user_id) } })} /> : null}
            </>
          ) : null}
          {loaded && person && !editable ? <Soft>{t('Only owners and admins can manage this.')}</Soft> : null}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
