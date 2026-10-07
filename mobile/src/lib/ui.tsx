import { ActivityIndicator, Pressable, Pressable as P2, ScrollView as S2, StyleSheet, Text, Text as T2, View, View as V2, type ViewStyle } from 'react-native';
import { ago } from './ranges.ts';
import { t, tx } from './i18n.ts';
import type { ReactNode } from 'react';

export const color = { brand: '#0b57ff', ink: '#0f172a', soft: '#475569', line: '#e2e8f0', bg: '#f8fafc', card: '#ffffff', danger: '#b91c1c', ok: '#047857', warn: '#92400e' };

export const Button = ({ title, onPress, kind = 'primary', busy = false, disabled = false, style }: { title: string; onPress: () => void; kind?: 'primary' | 'quiet' | 'danger'; busy?: boolean; disabled?: boolean; style?: ViewStyle }) => (
  <Pressable
    accessibilityRole="button" accessibilityState={{ disabled: busy || disabled, busy }} onPress={onPress} disabled={busy || disabled} android_ripple={{ color: '#ffffff33' }}
    style={({ pressed }) => [s.button, kind === 'primary' && s.primary, kind === 'quiet' && s.quiet, kind === 'danger' && s.dangerBtn, (disabled || busy) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }, style]}
  >
    {busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : color.brand} /> : <Text style={[s.buttonText, kind !== 'primary' && { color: kind === 'danger' ? color.danger : color.brand }]}>{t(title)}</Text>}
  </Pressable>
);

export const Screen = ({ children, pad = true }: { children: ReactNode; pad?: boolean }) => <View style={[s.screen, pad && { padding: 16 }]}>{children}</View>;
export const Title = ({ children }: { children: ReactNode }) => <Text accessibilityRole="header" style={s.title}>{tx(children)}</Text>;
export const Soft = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={[s.soft, style]}>{tx(children)}</Text>;
export const ErrorText = ({ children }: { children: ReactNode }) => (children ? <Text accessibilityRole="alert" style={s.error}>{children}</Text> : null);

export const s = StyleSheet.create({
  screen: { flex: 1, backgroundColor: color.bg },
  title: { fontSize: 24, fontWeight: '700', color: color.ink },
  soft: { color: color.soft, fontSize: 14 },
  error: { color: color.danger, fontSize: 14, marginVertical: 6 },
  button: { minHeight: 48, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 18 },
  primary: { backgroundColor: color.brand },
  quiet: { backgroundColor: '#eaf1ff' },
  dangerBtn: { backgroundColor: '#fee2e2' },
  buttonText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  input: { minHeight: 48, borderWidth: 1, borderColor: color.line, borderRadius: 12, paddingHorizontal: 14, fontSize: 16, backgroundColor: color.card, color: color.ink },
  card: { backgroundColor: color.card, borderRadius: 14, borderWidth: 1, borderColor: color.line, padding: 14 }
});

/* ── pieces shared by the pages ───────────────────────────────────────── */

/** A row of filter chips (a date range, a category). The chosen one is filled. */
export const Chips = <T extends string>({ items, value, onChange }: { items: { id: T; label: string }[]; value: T; onChange: (id: T) => void }) => (
  <S2 horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingVertical: 4 }} style={{ flexGrow: 0 }}>
    {items.map((i) => (
      <P2 key={i.id} accessibilityRole="button" accessibilityState={{ selected: value === i.id }} onPress={() => onChange(i.id)}
        style={{ minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22, backgroundColor: value === i.id ? color.brand : color.card, borderWidth: 1, borderColor: value === i.id ? color.brand : color.line }}>
        <T2 style={{ color: value === i.id ? '#fff' : color.ink, fontWeight: '600' }}>{t(i.label)}</T2>
      </P2>
    ))}
  </S2>
);

/** One figure with its label: a day's sales, the bills owed. */
export const Stat = ({ label, value, note, tone }: { label: string; value: string; note?: string; tone?: string }) => (
  <V2 style={[s.card, { flex: 1, minWidth: 140, gap: 2 }]}>
    <T2 style={{ color: color.soft, fontSize: 13 }}>{t(label)}</T2>
    <T2 style={{ color: tone ?? color.ink, fontSize: 22, fontWeight: '700' }}>{value}</T2>
    {note ? <T2 style={{ color: color.soft, fontSize: 12 }}>{t(note)}</T2> : null}
  </V2>
);

/** A label on the left and a value on the right, in a list. */
export const Line = ({ left, right, sub, onPress }: { left: string; right?: string; sub?: string; onPress?: () => void }) => (
  <P2 disabled={!onPress} onPress={onPress} accessibilityRole={onPress ? 'button' : undefined} android_ripple={onPress ? { color: '#0b57ff22' } : undefined}
    style={({ pressed }) => ({ minHeight: 56, paddingHorizontal: 16, paddingVertical: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: pressed ? '#eaf1ff' : color.card, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12 })}>
    <V2 style={{ flex: 1 }}>
      <T2 style={{ fontSize: 16, color: color.ink }}>{t(left)}</T2>
      {sub ? <T2 style={{ color: color.soft, fontSize: 13 }}>{t(sub)}</T2> : null}
    </V2>
    {right ? <T2 style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{t(right)}</T2> : null}
  </P2>
);

export const SectionTitle = ({ children }: { children: ReactNode }) => <T2 style={{ fontSize: 15, fontWeight: '700', color: color.ink, paddingHorizontal: 16, paddingTop: 16, paddingBottom: 6 }}>{tx(children)}</T2>;

/** Shown above a page that is displaying what was saved last time because there is no signal. */
export const SavedNote = ({ at }: { at: number | null }) => (at ? <T2 accessibilityLiveRegion="polite" style={{ color: color.warn, paddingHorizontal: 16, paddingVertical: 6, fontSize: 13 }}>{t('No internet. Showing what was saved {when}.', { when: ago(at) })}</T2> : null);

export const Empty = ({ children }: { children: ReactNode }) => <T2 style={{ color: color.soft, padding: 24, textAlign: 'center' }}>{tx(children)}</T2>;

/** Something is loading: a spinner and, after a moment, what it is waiting for (never a blank screen). */
export const Loading = ({ what = 'Loading' }: { what?: string }) => (
  <V2 accessibilityLiveRegion="polite" style={{ padding: 32, alignItems: 'center', gap: 10 }}>
    <ActivityIndicator accessibilityLabel={t(what)} />
    <T2 style={{ color: color.soft }}>{t(what)}…</T2>
  </V2>
);

/** Something failed: what happened, in the server's words, and a way to try again. */
export const Failed = ({ message, onRetry }: { message: string; onRetry?: () => void }) => (
  <V2 accessibilityRole="alert" style={[s.card, { margin: 16, gap: 10, borderColor: '#fecaca', backgroundColor: '#fef2f2' }]}>
    <T2 style={{ color: color.danger, fontWeight: '600' }}>{message}</T2>
    {onRetry ? <Button title="Try again" kind="quiet" onPress={onRetry} /> : null}
  </V2>
);
