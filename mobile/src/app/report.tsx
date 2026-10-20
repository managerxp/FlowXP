import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, Text, TextInput } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { goBack } from '../lib/nav.ts';
import { sendReport } from '../lib/bugsend.ts';
import { appVersion } from '../lib/crash.ts';
import { CATEGORIES, reportProblem } from '../lib/bugreport.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* Tell FlowXP when something went wrong. The note goes to the FlowXP team with the app version and the kind of phone, and with your name and business so they can write back. */
export default function Report() {
  const { screen } = useLocalSearchParams<{ screen?: string }>();
  const [category, setCategory] = useState('BROKE');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<'' | 'sent' | 'queued'>('');

  const send = async () => {
    const bad = reportProblem(text);
    if (bad) return setError(bad);
    setBusy(true); setError('');
    try { setDone(await sendReport(category, text, typeof screen === 'string' ? screen : undefined)); }
    catch (e) { setError(e instanceof ApiError ? (e.status === 401 ? 'Sign in first, then send the report.' : e.message) : e instanceof Error ? e.message : 'Could not send the report. Try again.'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Page>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Title>Report a problem</Title>
            {done ? (
              <>
                <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '700', fontSize: 18 }}>{done === 'sent' ? 'Thank you. We have your report.' : 'Saved on this phone.'}</Text>
                <Soft>{done === 'sent' ? 'The FlowXP team will look at it. If we need to know more, we write to the email on your account.' : 'There is no internet right now. It is sent by itself when the connection is back.'}</Soft>
                <Button title="Done" onPress={() => goBack()} />
              </>
            ) : (
              <>
                <Soft>What went wrong? Say what you were doing and what you saw. Do not type passwords.</Soft>
                <Chips<string> items={CATEGORIES.map(([id, label]) => ({ id, label }))} value={category} onChange={setCategory} />
                <TextInput style={[s.input, { minHeight: 140, textAlignVertical: 'top' }]} value={text} onChangeText={setText} multiline maxLength={2000} placeholder="For example: I tapped Cash on a bill of 3 items and the screen froze." accessibilityLabel="What went wrong" />
                <Soft>{`Sent with it: the app version (${appVersion()}), the kind of phone, your name and your business.`}</Soft>
                <ErrorText>{error}</ErrorText>
                <Button title="Send the report" onPress={() => { void send(); }} busy={busy} disabled={!text.trim()} />
                <Button title="Cancel" kind="quiet" onPress={() => goBack()} />
              </>
            )}
          </ScrollView>
        </Page>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
