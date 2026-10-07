import { ActivityIndicator, Pressable, StyleSheet, Text, View, type ViewStyle } from 'react-native';
import type { ReactNode } from 'react';

export const color = { brand: '#0b57ff', ink: '#0f172a', soft: '#64748b', line: '#e2e8f0', bg: '#f8fafc', card: '#ffffff', danger: '#b91c1c', ok: '#047857' };

export const Button = ({ title, onPress, kind = 'primary', busy = false, disabled = false, style }: { title: string; onPress: () => void; kind?: 'primary' | 'quiet' | 'danger'; busy?: boolean; disabled?: boolean; style?: ViewStyle }) => (
  <Pressable
    accessibilityRole="button" onPress={onPress} disabled={busy || disabled}
    style={({ pressed }) => [s.button, kind === 'primary' && s.primary, kind === 'quiet' && s.quiet, kind === 'danger' && s.dangerBtn, (disabled || busy) && { opacity: 0.5 }, pressed && { transform: [{ scale: 0.98 }] }, style]}
  >
    {busy ? <ActivityIndicator color={kind === 'primary' ? '#fff' : color.brand} /> : <Text style={[s.buttonText, kind !== 'primary' && { color: kind === 'danger' ? color.danger : color.brand }]}>{title}</Text>}
  </Pressable>
);

export const Screen = ({ children, pad = true }: { children: ReactNode; pad?: boolean }) => <View style={[s.screen, pad && { padding: 16 }]}>{children}</View>;
export const Title = ({ children }: { children: ReactNode }) => <Text style={s.title}>{children}</Text>;
export const Soft = ({ children, style }: { children: ReactNode; style?: object }) => <Text style={[s.soft, style]}>{children}</Text>;
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
