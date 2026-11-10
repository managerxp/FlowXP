import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { newMemberBody, newMemberProblem } from '../lib/gymMembers.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* A new member: name and mobile number are enough. If the number is already a member, the desk is asked before a second one is made. */
export default function GymMemberNew() {
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [dupe, setDupe] = useState(false);
  const [key] = useState(() => newKey());

  const save = async (confirm = false) => {
    const bad = newMemberProblem(name, phone);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try {
      const m = await api.post<{ member_id: number }>('/gym/members', newMemberBody(name, phone, email, confirm), { idempotencyKey: key });
      router.replace({ pathname: '/gym-member/[id]', params: { id: String(m.member_id) } });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 409 || /DUPLICATE/.test(e.code ?? ''))) setDupe(true);
      else setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
    } finally { setBusy(false); }
  };
  const field = (label: string, v: string, on: (x: string) => void, o: { keyboard?: 'default' | 'phone-pad' | 'email-address'; max?: number } = {}) => (
    <View style={{ gap: 4 }}>
      <Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>
      <TextInput style={s.input} value={v} onChangeText={(x) => { on(x); setDupe(false); }} keyboardType={o.keyboard ?? 'default'} maxLength={o.max} autoCapitalize={o.keyboard === 'email-address' ? 'none' : 'words'} autoCorrect={false} accessibilityLabel={t(label)} />
    </View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><Title>New member</Title><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {field('Name', name, setName, { max: 80 })}
          {field('Mobile number', phone, setPhone, { keyboard: 'phone-pad', max: 16 })}
          {field('Email (optional)', email, setEmail, { keyboard: 'email-address', max: 120 })}
          <Soft>You can sell them a membership on the next screen.</Soft>
          <ErrorText>{error}</ErrorText>
          {dupe ? (
            <View style={[s.card, { gap: 8 }]}>
              <Text style={{ color: color.warn, fontWeight: '600' }}>{t('Someone with this number is already a member.')}</Text>
              <Button title="Go back and search for them" kind="quiet" onPress={() => router.replace('/gym-members')} />
              <Button title="Add as a new member anyway" kind="quiet" onPress={() => { void save(true); }} busy={busy} />
            </View>
          ) : <Button title="Save member" onPress={() => { void save(); }} busy={busy} />}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
