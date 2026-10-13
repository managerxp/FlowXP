import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { Logo } from '../lib/Logo.tsx';
import { LanguagePicker } from '../lib/lang.tsx';
import { emailLooksRight, resetBody, resetProblem } from '../lib/account.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* A password forgotten: ask for a code by email, then type it with a new password. The same answer is given whether or not the address has an account. */
export default function Forgot() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const why = (e: unknown) => (e instanceof NetworkError ? 'No internet. Check your connection and try again.' : e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work. Try again.');

  const ask = async () => {
    if (!emailLooksRight(email)) return setError('Type the email you sign in with.');
    setBusy(true); setError('');
    try { await api.post('/auth/forgot-password', { email: email.trim() }, { signIn: true }); setSent(true); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const reset = async () => {
    const bad = resetProblem(email, code, password, again);
    if (bad) return setError(bad);
    setBusy(true); setError('');
    try { await api.post('/auth/reset-password', resetBody(email, code, password), { signIn: true }); setDone(true); } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 12, maxWidth: 480, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <Logo width={170} />
          <Title>{done ? 'Password changed' : 'Forgot your password?'}</Title>
          {done ? (
            <>
              <Soft>Your password has been changed. Sign in with the new one.</Soft>
              <Button title="Go to sign in" onPress={() => router.replace('/login')} />
            </>
          ) : !sent ? (
            <>
              <Soft>Type the email you sign in with. If it has an account, we email you a 6-digit code.</Soft>
              <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" accessibilityLabel="Email" />
              <ErrorText>{error}</ErrorText>
              <Button title="Send me a code" onPress={() => { void ask(); }} busy={busy} disabled={!email.trim()} />
              <Button title="Back to sign in" kind="quiet" onPress={() => router.replace('/login')} />
            </>
          ) : (
            <>
              <Soft>If that email has an account, a code is on its way. It can take a minute. Check your spam folder too.</Soft>
              <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" maxLength={8} accessibilityLabel="Six-digit code" />
              <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="New password, at least 10 characters" secureTextEntry autoCapitalize="none" autoComplete="new-password" accessibilityLabel="New password" />
              <TextInput style={s.input} value={again} onChangeText={setAgain} placeholder="New password again" secureTextEntry autoCapitalize="none" autoComplete="new-password" accessibilityLabel="New password again" />
              <ErrorText>{error}</ErrorText>
              <Button title="Change my password" onPress={() => { void reset(); }} busy={busy} disabled={!code.trim() || !password} />
              <Button title="Send a new code" kind="quiet" onPress={() => { void ask(); }} disabled={busy} />
              <Text style={{ color: color.soft, fontSize: 13 }}>Changing your password signs you out everywhere else.</Text>
            </>
          )}
          <LanguagePicker compact />
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
