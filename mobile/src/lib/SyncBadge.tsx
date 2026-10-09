import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { router } from 'expo-router';
import { useSyncState } from './sync.ts';
import { color } from './ui.tsx';
import { t } from './i18n.ts';

/* One line that says whether the phone and FlowXP are level, and what is waiting. Tapping it opens the list of sales on this phone. */
export const SyncBadge = () => {
  const sync = useSyncState();
  let text = t('All bills sent'); let tone = color.ok;
  if (sync.failed > 0) { text = t(sync.failed === 1 ? '{n} bill needs a decision' : '{n} bills need a decision', { n: sync.failed }); tone = color.danger; }
  else if (sync.pending > 0) { text = t(sync.pending === 1 ? '{n} bill waiting to send' : '{n} bills waiting to send', { n: sync.pending }) + (sync.stopped === 'auth' ? ` · ${t('sign in again')}` : sync.stopped === 'offline' ? ` · ${t('no internet')}` : ''); tone = color.warn; }
  else if (sync.changesFailed > 0) { text = t('{n} changes need a decision', { n: sync.changesFailed }); tone = color.danger; }
  else if (sync.changesPending > 0) { text = t('{n} changes waiting to send', { n: sync.changesPending }) + (sync.stopped === 'offline' ? ` · ${t('no internet')}` : ''); tone = color.warn; }
  else if (sync.stopped === 'offline') { text = t('No internet. You can keep billing'); tone = color.soft; }
  else if (sync.stopped === 'server') { text = t('FlowXP is not answering. You can keep billing'); tone = color.soft; }
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push('/waiting')} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 6, minHeight: 48 }}>
      <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: tone }} />
      <Text style={{ color: tone, fontWeight: '600', flex: 1 }}>{text}</Text>
      {sync.busy ? <ActivityIndicator size="small" /> : <Text style={{ color: color.brand, fontWeight: '600' }}>{t('See')}</Text>}
    </Pressable>
  );
};
