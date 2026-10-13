import { useEffect, useState } from 'react';
import { Pressable, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from './session.ts';
import { PROBE_EVERY_MS, offlineFor, reportNetwork, useOnline, netStore } from './net.ts';
import { useStore } from './store.ts';

/* Shown over every screen while the server cannot be reached. Bills made now are kept on the phone and sent when the signal is back. While it shows, the app checks again every few
   seconds, so it goes away by itself; tapping it checks at once. */
export function OfflineBar() {
  const online = useOnline();
  const { since } = useStore(netStore);
  const [now, setNow] = useState(Date.now());
  const [checking, setChecking] = useState(false);

  const probe = async () => {
    setChecking(true);
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 4000);
    try { const r = await fetch(`${API_URL}/api/auth/oauth/providers`, { signal: abort.signal }); reportNetwork(r.status > 0); } catch { reportNetwork(false); } finally { clearTimeout(timer); setChecking(false); }
  };
  useEffect(() => {
    if (online) return undefined;
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const again = setInterval(() => { void probe(); }, PROBE_EVERY_MS);
    return () => { clearInterval(tick); clearInterval(again); };
  }, [online]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (online) return null;
  return (
    <SafeAreaView edges={['top']} style={{ backgroundColor: '#92400e' }}>
      <Pressable accessibilityRole="button" accessibilityLabel="No internet. Tap to check again." onPress={() => { void probe(); }} style={{ minHeight: 48, paddingHorizontal: 16, paddingVertical: 8, justifyContent: 'center' }}>
        <Text accessibilityLiveRegion="polite" style={{ color: '#fff', fontWeight: '700' }}>{checking ? 'Checking the connection…' : `No internet${since ? ` (${offlineFor(since, now)})` : ''}`}</Text>
        <Text style={{ color: '#fde68a', fontSize: 13 }}>Bills are saved on this phone and sent when it is back. Tap to check again.</Text>
      </Pressable>
    </SafeAreaView>
  );
}
