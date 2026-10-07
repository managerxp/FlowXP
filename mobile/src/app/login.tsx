import { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { ApiError } from '../lib/api.ts';
import { api, signedIn } from '../lib/session.ts';
import { Button, ErrorText, Screen, Soft, Title, color, s } from '../lib/ui.tsx';

type LoginReply = { token?: string; requires_2fa?: boolean; requires_email_otp?: boolean; challenge?: string };

export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const finish = async (reply: LoginReply) => {
    if (reply.token) { await signedIn(reply.token); router.replace('/'); return true; }
    return false;
  };

  const submit = async () => {
    setBusy(true); setError('');
    try {
      if (challenge) {
        const reply = await api.post<LoginReply>('/auth/login/2fa', { challenge, ...(code.includes('-') || code.length > 6 ? { recovery_code: code.trim() } : { code: code.trim() }) }, { signIn: true });
        await finish(reply);
      } else {
        const reply = await api.post<LoginReply>('/auth/login', { email: email.trim(), password }, { signIn: true });
        if (reply.requires_2fa && reply.challenge) { setChallenge(reply.challenge); return; }
        if (reply.requires_email_otp) { setError('Confirm your email on the FlowXP website first, then sign in here.'); return; }
        await finish(reply);
      }
    } catch (e) { setError(e instanceof ApiError || e instanceof Error ? e.message : 'Could not sign in'); }
    finally { setBusy(false); }
  };

  return (
    <Screen>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'center', gap: 12 }}>
        <Title>FlowXP</Title>
        <Soft>{challenge ? 'Enter the 6-digit code from your authenticator app, or a recovery code.' : 'Sign in to start billing.'}</Soft>
        {challenge ? (
          <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="Code" keyboardType="number-pad" autoFocus accessibilityLabel="Two-step code" />
        ) : (
          <View style={{ gap: 12 }}>
            <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder="Email" autoCapitalize="none" keyboardType="email-address" autoComplete="email" accessibilityLabel="Email" />
            <TextInput style={s.input} value={password} onChangeText={setPassword} placeholder="Password" secureTextEntry autoComplete="password" accessibilityLabel="Password" onSubmitEditing={submit} />
          </View>
        )}
        <ErrorText>{error}</ErrorText>
        <Button title={challenge ? 'Verify' : 'Sign in'} onPress={submit} busy={busy} disabled={challenge ? !code : !email || !password} />
        {challenge ? <Button title="Back" kind="quiet" onPress={() => { setChallenge(null); setCode(''); setError(''); }} /> : null}
        <Text style={{ color: color.soft, fontSize: 12, textAlign: 'center' }}>Your sign-in stays on this phone, in its secure storage.</Text>
      </KeyboardAvoidingView>
    </Screen>
  );
}
