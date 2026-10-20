import { useState } from 'react';
import { Alert, Linking, ScrollView, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '../lib/api.ts';
import { api, signOut } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { DELETE_URL, deleteBody, deleteProblem } from '../lib/account.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* Delete the account from inside the app. The password confirms it is the owner of the account; the sign-in code too if two-step sign-in is on. A business keeps its bills: only the person goes. */
export default function DeleteAccount() {
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [needsCode, setNeedsCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [owner, setOwner] = useState('');

  const run = async () => {
    const bad = deleteProblem(password, needsCode, code);
    if (bad) return setError(bad);
    setBusy(true); setError(''); setOwner('');
    try {
      await api.post('/auth/delete-account', deleteBody(password, code));
      await signOut();
      Alert.alert('Account deleted', 'Your account has been deleted.', [{ text: 'OK', onPress: () => router.replace('/login') }]);
    } catch (e) {
      if (e instanceof ApiError && e.code === 'OWNS_BUSINESS') { setOwner(e.message); return; }
      if (e instanceof ApiError && e.status === 401 && /code/i.test(e.message)) setNeedsCode(true);
      setError(e instanceof NetworkError ? 'No internet. Nothing was deleted. Try again when it is back.' : e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not delete the account.');
    } finally { setBusy(false); }
  };
  const confirm = () => Alert.alert('Delete your account?', 'This cannot be undone. You will be signed out on every phone. Your business keeps its bills and records.', [{ text: 'Keep my account', style: 'cancel' }, { text: 'Delete it', style: 'destructive', onPress: () => { void run(); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <Title>Delete my account</Title>
          <Soft>This removes your sign-in and your personal details from FlowXP. The bills and records of a business you worked in stay with that business. If you are the only owner of a business, make someone else an owner first, or leave a request and FlowXP support will help you close it.</Soft>
          <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="Your password" secureTextEntry autoCapitalize="none" accessibilityLabel="Your password" />
          {needsCode ? <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="Code from your authenticator app, or a recovery code" autoCapitalize="none" accessibilityLabel="Authenticator code" /> : null}
          <ErrorText>{error}</ErrorText>
          {owner ? <Text accessibilityRole="alert" style={{ color: color.warn, fontWeight: '600' }}>{owner}</Text> : null}
          <Button title="Delete my account" kind="danger" onPress={confirm} busy={busy} disabled={!password} />
          <Button title="Cancel" onPress={() => goBack()} />
          <Button title="Ask us to delete it instead" kind="quiet" onPress={() => { void Linking.openURL(DELETE_URL); }} />
          <Soft>The website form works even if you cannot sign in.</Soft>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
