/* Small form pieces shared by the set-up screens that follow the same pattern: labelled inputs, switches, lists loaded from the server, and a save/remove runner that never throws. */
import { useCallback, useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from './session.ts';
import { goBack } from './nav.ts';
import { t } from './i18n.ts';
import { Page } from './responsive.tsx';
import { Button, Empty, ErrorText, Soft, Title, color, s } from './ui.tsx';

const why = (e: unknown) => (e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));

export const Field = ({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) => (
  <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text>{children}{hint ? <Soft>{t(hint)}</Soft> : null}</View>
);
export const Input = ({ label, value, onChange, hint, numeric, max, placeholder, multiline, upper }: { label: string; value: string; onChange: (v: string) => void; hint?: string; numeric?: boolean; max?: number; placeholder?: string; multiline?: boolean; upper?: boolean }) => (
  <Field label={label} hint={hint}>
    <TextInput style={[s.input, multiline ? { minHeight: 70, textAlignVertical: 'top', paddingTop: 12 } : null]} multiline={multiline} value={value} onChangeText={(v) => onChange(numeric ? v.replace(/[^\d.]/g, '') : upper ? v.toUpperCase() : v)} keyboardType={numeric ? 'decimal-pad' : 'default'} maxLength={max} placeholder={placeholder ? t(placeholder) : undefined} autoCapitalize={upper ? 'characters' : 'none'} autoCorrect={false} accessibilityLabel={t(label)} />
  </Field>
);
export const Row = ({ label, hint, value, onChange }: { label: string; hint?: string; value: boolean; onChange: (v: boolean) => void }) => (
  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}><View style={{ flex: 1 }}><Text style={{ color: color.ink, fontWeight: '600' }}>{t(label)}</Text>{hint ? <Soft>{t(hint)}</Soft> : null}</View><Switch value={value} onValueChange={onChange} accessibilityLabel={t(label)} /></View>
);
/** Several choices can be on at once. */
export const Multi = ({ items, values, onToggle }: { items: { id: string; label: string }[]; values: string[]; onToggle: (id: string) => void }) => (
  <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
    {items.map((i) => {
      const on = values.includes(i.id);
      return <Pressable key={i.id} onPress={() => onToggle(i.id)} accessibilityRole="button" accessibilityState={{ selected: on }} style={{ minHeight: 44, minWidth: 52, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: on ? color.brand : color.card, borderWidth: 1, borderColor: on ? color.brand : color.line }}><Text style={{ color: on ? '#fff' : color.ink, fontWeight: '600' }}>{i.label}</Text></Pressable>;
    })}
  </View>
);
export const Panel = ({ children }: { children: React.ReactNode }) => <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">{children}</ScrollView>;
export const Card = ({ children }: { children: React.ReactNode }) => <View style={[s.card, { gap: 10 }]}>{children}</View>;

/** Load one list from the server and keep it fresh. */
export function useList<T>(path: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const reload = useCallback(() => { if (!path) return; api.get<T>(path).then((d) => { setData(d); setError(''); }).catch((e: Error) => setError(e.message || t('Could not load.'))); }, [path]);
  useEffect(reload, [reload]);
  return { data, error, reload };
}
/** Run a save/remove: report the result, never throw. A problem found beforehand is shown without calling the server. */
export const useAct = () => {
  const [error, setError] = useState(''); const [note, setNote] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (problem: string, job: () => Promise<unknown>, done = 'Saved') => {
    if (problem) { setError(t(problem)); setNote(''); return false; }
    setBusy(true); setError(''); setNote('');
    try { await job(); setNote(t(done)); return true; } catch (e) { setError(why(e)); return false; } finally { setBusy(false); }
  };
  return { error, note, busy, run, setError, setNote };
};
export const Msg = ({ a }: { a: { error: string; note: string } }) => <><ErrorText>{a.error}</ErrorText>{a.note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{a.note}</Text> : null}</>;
export const confirm = (title: string, body: string, ok: string, go: () => void) => Alert.alert(title, body, [{ text: t('Cancel'), style: 'cancel' }, { text: t(ok), style: 'destructive', onPress: go }]);

/** The frame every set-up screen sits in: a title, a Back button, and a notice when the person lacks the right. */
export const SetupShell = ({ title, sub, ok, denied, children }: { title: string; sub: string; ok: boolean; denied: string; children: React.ReactNode }) => (
  <SafeAreaView style={s.screen}>
    <Page max={640}>
      <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>{title}</Title><Soft>{sub}</Soft></View><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
      {ok ? children : <Empty>{denied}</Empty>}
    </Page>
  </SafeAreaView>
);
