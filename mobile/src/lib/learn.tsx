/* The glue between the learning logic (onboarding.ts) and the screens: one shared state, loaded from the phone, and the small components. */
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { createStore, useStore } from './store.ts';
import { kvGet, kvSet } from './local.ts';
import { checklist, dismiss, empty, HINTS, load, mark, progress, reset, save, showHint, type Flag, type HintId, type Kept } from './onboarding.ts';
import { color, s } from './ui.tsx';
import { t } from './i18n.ts';

const store = createStore<{ kept: Kept; ready: boolean }>({ kept: empty(), ready: false });
const kv = { get: kvGet, set: kvSet };
let started = false;
const ensure = () => { if (!started) { started = true; void load(kv).then((kept) => store.set({ kept, ready: true })); } };

const update = (next: (k: Kept) => Kept) => { const kept = next(store.get().kept); store.set({ kept }); void save(kv, kept); };
export const markDone = (flag: Flag) => { ensure(); update((k) => mark(k, flag)); };
export const dismissHint = (hint: HintId) => update((k) => dismiss(k, hint));
export const resetLearning = () => update(() => reset());
export const useLearning = () => { ensure(); return useStore(store); };

/** One sentence at the moment a screen is first used. One tap makes it go away for good. */
export const Hint = ({ id }: { id: HintId }) => {
  const { kept, ready } = useLearning();
  if (!ready || !showHint(kept, id)) return null;
  const h = HINTS[id];
  return (
    <View accessibilityRole="summary" style={{ marginHorizontal: 12, marginVertical: 6, padding: 12, borderRadius: 12, backgroundColor: '#eaf1ff', gap: 6 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Ionicons name="bulb-outline" size={20} color={color.brand} />
        <Text style={{ fontWeight: '700', color: color.ink, flex: 1 }}>{t(h.title)}</Text>
      </View>
      <Text style={{ color: color.ink, lineHeight: 21 }}>{t(h.body)}</Text>
      <Pressable accessibilityRole="button" accessibilityLabel={`${t('Got it')}: ${t(h.title)}`} onPress={() => dismissHint(id)} style={{ minHeight: 44, justifyContent: 'center', alignSelf: 'flex-start' }}>
        <Text style={{ color: color.brand, fontWeight: '700' }}>{t('Got it')}</Text>
      </Pressable>
    </View>
  );
};

/** Home: what to try first, ticked from what has really been done. Goes away by itself when finished, or with Hide. */
export const GettingStarted = ({ food }: { food: boolean }) => {
  const { kept, ready } = useLearning();
  if (!ready) return null;
  const steps = checklist(kept, food);
  const p = progress(steps);
  if (kept.flags.includes('checklist_hidden') || p.complete) return null;
  return (
    <View style={[s.card, { marginHorizontal: 16, marginTop: 12, gap: 4 }]}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
        <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{t('Getting started')}</Text>
        <Text style={{ color: color.soft }}>{t('{done} of {total}', { done: p.done, total: p.total })}</Text>
      </View>
      <View accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: p.total, now: p.done }} style={{ height: 6, borderRadius: 3, backgroundColor: color.line, overflow: 'hidden', marginVertical: 6 }}>
        <View style={{ width: `${(p.done / p.total) * 100}%`, height: 6, backgroundColor: color.ok }} />
      </View>
      {steps.map((st) => (
        <Pressable key={st.id} accessibilityRole="button" accessibilityLabel={`${t(st.label)}${st.done ? ', ✓' : ''}`} onPress={() => router.push(st.go as never)} style={{ minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Ionicons name={st.done ? 'checkmark-circle' : 'ellipse-outline'} size={24} color={st.done ? color.ok : color.soft} />
          <View style={{ flex: 1 }}>
            <Text style={{ fontSize: 16, color: st.done ? color.soft : color.ink, fontWeight: st.done ? '400' : '600', textDecorationLine: st.done ? 'line-through' : 'none' }}>{t(st.label)}</Text>
            {!st.done ? <Text style={{ color: color.soft, fontSize: 13 }}>{t(st.why)}</Text> : null}
          </View>
          {!st.done ? <Ionicons name="chevron-forward" size={20} color={color.soft} /> : null}
        </Pressable>
      ))}
      <Pressable accessibilityRole="button" onPress={() => markDone('checklist_hidden')} style={{ minHeight: 44, justifyContent: 'center' }}>
        <Text style={{ color: color.soft }}>{t('Hide this. You can bring it back from Help.')}</Text>
      </Pressable>
    </View>
  );
};
