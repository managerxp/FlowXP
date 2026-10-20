import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, Switch, Text, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { hasMore, noticesQuery, phoneRoute, timeAgo, withChange, type Notice, type NoticePage, type Preference } from '../lib/inbox.ts';
import { Button, Empty, ErrorText, Failed, Line, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const ago = (iso: string) => { const a = timeAgo(iso); const m = /^(\d+) (min|h) ago$/.exec(a) ?? /^(\d+) days ago$/.exec(a); return m ? (a.endsWith('min ago') ? t('{n} min ago', { n: m[1] }) : a.endsWith('h ago') ? t('{n} h ago', { n: m[1] }) : t('{n} days ago', { n: m[1] })) : a === 'just now' || a === 'yesterday' ? t(a) : a; };

/* What to be told about: for each kind of notification, in the app, by email, on this phone. The server offers only what this role can use. */
const Preferences = () => {
  const [prefs, setPrefs] = useState<Preference[] | null>(null);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState('');
  useEffect(() => { api.get<Preference[]>('/notifications/preferences').then(setPrefs).catch((e: Error) => setError(e.message)); }, []);
  const change = async (category: string, field: 'in_app' | 'email' | 'push', value: boolean) => {
    if (!prefs) return;
    const next = withChange(prefs, category, field, value); setPrefs(next); setError(''); setSaved('');
    try { await api.call('/notifications/preferences', { method: 'PUT', body: { preferences: next } }); setSaved(t('Saved')); }
    catch (e) { setPrefs(prefs); setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
  };
  if (!prefs) return error ? <ErrorText>{error}</ErrorText> : null;
  return (
    <View style={[s.card, { gap: 12 }]}>
      <Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{t('What to tell me about')}</Text>
      {prefs.length === 0 ? <Soft>{t('There are no notification settings for your role.')}</Soft> : prefs.map((p) => (
        <View key={p.category} style={{ gap: 4, borderTopWidth: 1, borderColor: color.line, paddingTop: 10 }}>
          <Text style={{ color: color.ink, fontWeight: '600' }}>{t(p.label)}</Text>
          <Soft>{t(p.description)}</Soft>
          {([['in_app', 'In app'], ['email', 'By email'], ['push', 'On my phone']] as const).map(([field, label]) => (
            <View key={field} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', minHeight: 40 }}>
              <Text style={{ color: color.ink }}>{t(label)}</Text>
              <Switch value={p[field]} onValueChange={(v) => { void change(p.category, field, v); }} accessibilityLabel={`${t(p.label)}: ${t(label)}`} />
            </View>
          ))}
        </View>
      ))}
      {saved ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{saved}</Text> : null}
      <ErrorText>{error}</ErrorText>
      <Soft>{t('Email goes to the address you sign in with. Phone alerts go to the FlowXP app on the phones you are signed in on. Notifications are never sent to customers.')}</Soft>
    </View>
  );
};

/* Notifications (the weekly summary arrives here every Monday morning, with low stock, unusual numbers and the rest): read, mark read, and choose what to be told about. */
export default function Notifications() {
  const [items, setItems] = useState<Notice[] | null>(null);
  const [unread, setUnread] = useState(0);
  const [unreadOnly, setUnreadOnly] = useState(false);
  const [more, setMore] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (append = false, current: Notice[] | null = null) => {
    setBusy(true); setError('');
    try {
      const before = append && current?.length ? current[current.length - 1].notification_id : null;
      const d = await api.get<NoticePage>(`/notifications?${noticesQuery(unreadOnly, before)}`);
      setItems(append && current ? [...current, ...d.items] : d.items); setUnread(d.unread); setMore(hasMore(d.items));
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not load.')); }
    finally { setBusy(false); }
  }, [unreadOnly]);
  useEffect(() => { setItems(null); void load(false); }, [load]);

  const open = async (n: Notice) => {
    if (!n.read_at) {
      setItems((cur) => (cur ? cur.map((x) => (x === n ? { ...x, read_at: new Date().toISOString() } : x)) : cur)); setUnread((u) => Math.max(0, u - 1));
      api.call(`/notifications/${n.notification_id}/read`, { method: 'POST', body: {} }).catch(() => {});
    }
    const route = phoneRoute(n);
    if (route) router.push(route as never);
  };
  const readAll = async () => { try { await api.call('/notifications/read-all', { method: 'POST', body: {} }); void load(false); } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); } };

  return (
    <SafeAreaView style={s.screen}>
      <Page max={720}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><Title>Notifications</Title><Button title="Back" kind="quiet" onPress={() => goBack()} /></View>
        <ScrollView refreshControl={<RefreshControl refreshing={busy && !items} onRefresh={() => { void load(false); }} />} contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 32 }}>
          <Soft>{t("What needs your attention, so you don't have to go looking.")}</Soft>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}><Switch value={unreadOnly} onValueChange={setUnreadOnly} accessibilityLabel={t('Unread only')} /><Text style={{ color: color.ink }}>{t('Unread only')}</Text></View>
            <Button title="Mark all read" kind="quiet" onPress={() => { void readAll(); }} disabled={!unread} />
          </View>
          {error && !items ? <Failed message={error} onRetry={() => { void load(false); }} /> : null}
          {!items && !error ? <Loading /> : null}
          {items && items.length === 0 ? <Empty>{unreadOnly ? 'Nothing unread.' : 'No notifications yet.'}</Empty> : null}
          {items?.map((n) => (
            <Line key={n.notification_id} left={`${n.read_at ? '' : '● '}${t(n.title)}`} sub={n.body ?? undefined} right={ago(n.created_at)} selected={!n.read_at} onPress={() => { void open(n); }} />
          ))}
          {items && more ? <Button title="Show older" kind="quiet" onPress={() => { void load(true, items); }} busy={busy} /> : null}
          <Preferences />
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
