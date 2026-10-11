import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '../lib/api.ts';
import { api, signedIn } from '../lib/session.ts';
import { kvGet, kvSet } from '../lib/local.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';
import { LanguagePicker } from '../lib/lang.tsx';
import { t } from '../lib/i18n.ts';

type LoginReply = { token?: string; requires_2fa?: boolean; requires_email_otp?: boolean; challenge?: string };

/* Sign in. The email is remembered so the next time it is only the password; the code step (if the account has one) says exactly what to type. */
export default function Login() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const passwordBox = useRef<TextInput>(null);

  useEffect(() => { void kvGet('last_email').then((v) => { if (v) setEmail(v); }); }, []);

  const finish = async (reply: LoginReply) => {
    if (reply.token) { void kvSet('last_email', email.trim()); await signedIn(reply.token); router.replace('/'); }
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
        if (reply.requires_email_otp) { setError('Confirm your email first. Open flowxp.in on any device, sign in there, and enter the code we email you. Then come back here.'); return; }
        await finish(reply);
      }
    } catch (e) {
      setError(e instanceof NetworkError ? 'No internet. Check your connection and try again.' : e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not sign in. Try again.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, justifyContent: 'center', padding: 20, gap: 12, maxWidth: 480, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          <LanguagePicker compact />
          <Title>FlowXP</Title>
          <Soft>{challenge ? t('Open your authenticator app and type the 6-digit code for FlowXP. Lost your phone? Type a recovery code instead.') : t('Sign in with the email and password you use on flowxp.in.')}</Soft>
          {challenge ? (
            <TextInput style={s.input} value={code} onChangeText={setCode} placeholder={t('6-digit code')} keyboardType="number-pad" autoFocus accessibilityLabel="Six-digit code" onSubmitEditing={submit} />
          ) : (
            <View style={{ gap: 12 }}>
              <TextInput style={s.input} value={email} onChangeText={setEmail} placeholder={t('Email')} autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" returnKeyType="next" accessibilityLabel="Email" onSubmitEditing={() => passwordBox.current?.focus()} />
              <View>
                <TextInput ref={passwordBox} style={[s.input, { paddingRight: 84 }]} value={password} onChangeText={setPassword} placeholder={t('Password')} secureTextEntry={!show} autoComplete="password" accessibilityLabel="Password" returnKeyType="go" onSubmitEditing={submit} />
                <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((v) => !v)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, minWidth: 76, justifyContent: 'center', alignItems: 'center' }}>
                  <Text style={{ color: color.brand, fontWeight: '700' }}>{t(show ? 'Hide' : 'Show')}</Text>
                </Pressable>
              </View>
            </View>
          )}
          <ErrorText>{error}</ErrorText>
          <Button title={challenge ? 'Continue' : 'Sign in'} onPress={submit} busy={busy} disabled={challenge ? !code : !email.trim() || !password} />
          {challenge ? <Button title="Back" kind="quiet" onPress={() => { setChallenge(null); setCode(''); setError(''); }} /> : (
            <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL('https://flowxp.in/forgot-password'); }} style={{ minHeight: 48, justifyContent: 'center', alignItems: 'center' }}>
              <Text style={{ color: color.brand, fontWeight: '600' }}>{t('Forgot your password?')}</Text>
            </Pressable>
          )}
          <Text style={{ color: color.soft, fontSize: 13, textAlign: 'center' }}>{t('Your sign-in stays on this phone, in its secure storage.')}</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
