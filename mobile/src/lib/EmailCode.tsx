import { useEffect, useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { ApiError, NetworkError } from './api.ts';
import { api } from './session.ts';
import { codeProblem, resendWait, verifyBody } from './account.ts';
import { Button, ErrorText, Soft, color, s } from './ui.tsx';

/* The step after creating an account (or signing in to one whose email is not confirmed yet): a 6-digit code was emailed. Typing it confirms the email and signs the person in. */
export function EmailCode({ challenge, email, onVerified, onBack }: { challenge: string; email: string; onVerified: (token: string) => void | Promise<void>; onBack: () => void }) {
  const [code, setCode] = useState('');
  const [current, setCurrent] = useState(challenge);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [sentAt, setSentAt] = useState(Date.now());
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);
  const wait = resendWait(sentAt, now);

  const why = (e: unknown) => (e instanceof NetworkError ? 'No internet. Check your connection and try again.' : e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work. Try again.');
  const verify = async () => {
    const bad = codeProblem(code);
    if (bad) return setError(bad);
    setBusy(true); setError(''); setNote('');
    try {
      const reply = await api.post<{ token?: string }>('/auth/verify-email', verifyBody(current, code), { signIn: true });
      if (reply.token) await onVerified(reply.token); else setError('Could not sign you in. Go back and sign in again.');
    } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const resend = async () => {
    setBusy(true); setError(''); setNote('');
    try {
      const reply = await api.post<{ challenge?: string }>('/auth/resend-email-otp', { challenge: current }, { signIn: true });
      if (reply?.challenge) setCurrent(reply.challenge);
      setSentAt(Date.now()); setNote('A new code is on its way. It can take a minute. Check your spam folder too.');
    } catch (e) { setError(why(e)); } finally { setBusy(false); }
  };

  return (
    <View style={{ gap: 12 }}>
      <Text accessibilityRole="header" style={{ fontSize: 22, fontWeight: '700', color: color.ink }}>Check your email</Text>
      <Soft>{`We sent a 6-digit code to ${email}. It expires in 10 minutes.`}</Soft>
      <TextInput style={s.input} value={code} onChangeText={setCode} placeholder="6-digit code" keyboardType="number-pad" maxLength={8} autoFocus accessibilityLabel="Six-digit code" onSubmitEditing={() => { void verify(); }} />
      <ErrorText>{error}</ErrorText>
      {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{note}</Text> : null}
      <Button title="Verify and continue" onPress={() => { void verify(); }} busy={busy} disabled={!code.trim()} />
      <Button title={wait > 0 ? `Send a new code in ${wait}s` : 'Send a new code'} kind="quiet" onPress={() => { void resend(); }} disabled={busy || wait > 0} />
      <Button title="Wrong email? Go back" kind="quiet" onPress={onBack} />
    </View>
  );
}
