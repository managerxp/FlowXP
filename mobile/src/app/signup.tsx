import { useState } from 'react';
import { KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, NetworkError } from '../lib/api.ts';
import { t } from '../lib/i18n.ts';
import { api, signedIn } from '../lib/session.ts';
import { kvSet } from '../lib/local.ts';
import { BUSINESS_TYPES, PRIVACY_URL, TERMS_URL, emptySignup, signupBody, signupProblem, suggestEmail, type SignupForm } from '../lib/account.ts';
import { EmailCode } from '../lib/EmailCode.tsx';
import { Logo } from '../lib/Logo.tsx';
import { LanguagePicker } from '../lib/lang.tsx';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* Start the 7-day free trial from the phone: about you, your business, agree to the terms, then confirm the email with a 6-digit code. No card, no sales call. */
export default function Signup() {
  const [f, setF] = useState<SignupForm>(emptySignup());
  const [show, setShow] = useState(false);
  const [challenge, setChallenge] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const set = <K extends keyof SignupForm>(k: K, v: SignupForm[K]) => setF((x) => ({ ...x, [k]: v }));
  const mend = suggestEmail(f.email);

  const create = async () => {
    const bad = signupProblem(f);
    if (bad) return setError(bad);
    setBusy(true); setError('');
    try {
      const reply = await api.post<{ challenge?: string }>('/auth/signup', signupBody(f), { signIn: true });
      if (reply.challenge) setChallenge(reply.challenge); else setError('Could not start your account. Try again.');
    } catch (e) {
      setError(e instanceof NetworkError ? 'No internet. Check your connection and try again.' : e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not create the account. Try again.');
    } finally { setBusy(false); }
  };
  const verified = async (token: string) => { void kvSet('last_email', f.email.trim()); await signedIn(token); router.replace('/'); };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={{ flexGrow: 1, padding: 20, gap: 12, maxWidth: 480, width: '100%', alignSelf: 'center' }} keyboardShouldPersistTaps="handled">
          {challenge ? <EmailCode challenge={challenge} email={f.email.trim()} onVerified={verified} onBack={() => setChallenge(null)} /> : (
            <>
              <Logo width={170} />
              <Title>Start your free trial</Title>
              <Soft>Seven days free, with every feature on. No card, no sales call. It takes about a minute.</Soft>

              <Text style={{ fontWeight: '700', color: color.ink, marginTop: 8 }}>About you</Text>
              <TextInput style={s.input} value={f.name} onChangeText={(v) => set('name', v)} placeholder="Your name" autoComplete="name" accessibilityLabel="Your name" />
              <TextInput style={s.input} value={f.email} onChangeText={(v) => set('email', v)} placeholder="Email" autoCapitalize="none" autoCorrect={false} keyboardType="email-address" autoComplete="email" accessibilityLabel="Email" />
              {mend ? <Pressable accessibilityRole="button" onPress={() => set('email', mend)} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.warn }}>{`Did you mean ${mend}? Tap to use it.`}</Text></Pressable> : <Soft>We send a 6-digit code here to confirm it is yours.</Soft>}
              <TextInput style={s.input} value={f.phone} onChangeText={(v) => set('phone', v)} placeholder="Mobile number (optional)" keyboardType="phone-pad" autoComplete="tel" accessibilityLabel="Mobile number" />
              <View>
                <TextInput style={[s.input, { paddingRight: 84 }]} value={f.password} onChangeText={(v) => set('password', v)} placeholder="Password, at least 10 characters" secureTextEntry={!show} autoComplete="new-password" autoCapitalize="none" accessibilityLabel="Password" />
                <Pressable accessibilityRole="button" accessibilityLabel={show ? 'Hide password' : 'Show password'} onPress={() => setShow((v) => !v)} style={{ position: 'absolute', right: 0, top: 0, bottom: 0, minWidth: 72, alignItems: 'center', justifyContent: 'center' }}>
                  <Text style={{ color: color.brand, fontWeight: '700' }}>{show ? 'Hide' : 'Show'}</Text>
                </Pressable>
              </View>

              <Text style={{ fontWeight: '700', color: color.ink, marginTop: 8 }}>Your business</Text>
              <TextInput style={s.input} value={f.businessName} onChangeText={(v) => set('businessName', v)} placeholder="Business name" autoComplete="organization" accessibilityLabel="Business name" />
              <Soft>What kind of business is it? FlowXP switches on the tools it needs.</Soft>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {BUSINESS_TYPES.map(([value, label]) => (
                  <Pressable key={value} accessibilityRole="radio" accessibilityState={{ selected: f.businessType === value }} onPress={() => set('businessType', value)}
                    style={{ minHeight: 48, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 24, borderWidth: 1, borderColor: f.businessType === value ? color.brand : color.line, backgroundColor: f.businessType === value ? color.brand : color.card }}>
                    <Text style={{ color: f.businessType === value ? '#fff' : color.ink, fontWeight: '600' }}>{label}</Text>
                  </Pressable>
                ))}
              </View>

              {f.businessType === 'AUTO_PARTS' ? (
                <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: f.alsoService }} onPress={() => set('alsoService', !f.alsoService)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48 }}>
                  <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: color.brand, backgroundColor: f.alsoService ? color.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{f.alsoService ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}</View>
                  <Text style={{ flex: 1, color: color.ink }}>{t('We also service bikes or cars (turns on job cards, labour and staff)')}</Text>
                </Pressable>
              ) : null}

              <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: f.agreed }} onPress={() => set('agreed', !f.agreed)} style={{ flexDirection: 'row', gap: 10, alignItems: 'center', minHeight: 48, marginTop: 8 }}>
                <View style={{ width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: color.brand, backgroundColor: f.agreed ? color.brand : 'transparent', alignItems: 'center', justifyContent: 'center' }}>{f.agreed ? <Text style={{ color: '#fff', fontWeight: '700' }}>✓</Text> : null}</View>
                <Text style={{ flex: 1, color: color.ink }}>I agree to the Terms and the Privacy Policy.</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 16 }}>
                <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(TERMS_URL); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.brand, fontWeight: '600' }}>Read the Terms</Text></Pressable>
                <Pressable accessibilityRole="link" onPress={() => { void Linking.openURL(PRIVACY_URL); }} style={{ minHeight: 48, justifyContent: 'center' }}><Text style={{ color: color.brand, fontWeight: '600' }}>Read the Privacy Policy</Text></Pressable>
              </View>

              <ErrorText>{error}</ErrorText>
              <Button title="Create my account" onPress={() => { void create(); }} busy={busy} />
              <Button title="I already have an account" kind="quiet" onPress={() => router.replace('/login')} />
              <LanguagePicker compact />
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
