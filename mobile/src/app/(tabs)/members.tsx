import { useCallback, useEffect, useState } from 'react';
import { Linking, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { router, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '../../lib/icons.tsx';
import { api, useSession } from '../../lib/session.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { SearchBox } from '../../lib/SearchBox.tsx';
import { STATE_LABEL, STATE_TONE, type Member } from '../../lib/gym.ts';
import { waNumber } from '../../lib/gymApp.ts';
import { Page } from '../../lib/responsive.tsx';
import { t } from '../../lib/i18n.ts';
import { Chips, Empty, Failed, Loading, Soft, Title, color, s } from '../../lib/ui.tsx';

const FILTERS = [{ id: '', label: 'All' }, { id: 'ACTIVE', label: 'Active' }, { id: 'EXPIRING', label: 'Ends soon' }, { id: 'EXPIRED', label: 'Ended' }, { id: 'FROZEN', label: 'Frozen' }, { id: 'NONE', label: 'No membership' }];
const tone = (x: string) => (STATE_TONE[x] === 'ok' ? color.ok : STATE_TONE[x] === 'bad' ? color.danger : STATE_TONE[x] === 'warn' ? color.warn : color.soft);

const Act = ({ icon, label, go }: { icon: React.ComponentProps<typeof Ionicons>['name']; label: string; go: () => void }) => (
  <Pressable accessibilityRole="button" accessibilityLabel={t(label)} onPress={go} hitSlop={6} style={({ pressed }) => ({ flex: 1, minHeight: 44, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 6, borderRadius: 10, backgroundColor: pressed ? color.press : color.wash })}>
    <Ionicons name={icon} size={18} color={color.ink} /><Text style={{ color: color.ink, fontSize: 13, fontWeight: '600' }}>{t(label)}</Text>
  </Pressable>
);

/* The Members tab: search, filter by how their membership stands, and the usual next steps (call, WhatsApp, renew) on each card. */
export default function Members() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  const [state, setState] = useState('');
  useEffect(() => { const x = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(x); }, [text]);
  const list = useLoad<Member[]>(`gym-tab-members:${scope}:${state}:${q}`, () => api.get<Member[]>(`/gym/members?limit=60${state ? `&state=${state}` : ''}${q.length >= 2 ? `&search=${encodeURIComponent(q)}` : ''}`));
  useFocusEffect(useCallback(() => { void list.refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps
  const open = (m: Member) => router.push({ pathname: '/gym-member/[id]', params: { id: String(m.member_id) } });

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, gap: 10 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
            <View><Title>Members</Title><Soft>{t('{n} shown', { n: list.data?.length ?? 0 })}</Soft></View>
            <Pressable accessibilityRole="button" accessibilityLabel={t('Front desk')} onPress={() => router.push('/gym')} style={{ minHeight: 44, paddingHorizontal: 14, borderRadius: 22, backgroundColor: color.wash, flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Ionicons name="qr-code-outline" size={18} color={color.ink} /><Text style={{ fontWeight: '600', color: color.ink }}>{t('Front desk')}</Text>
            </Pressable>
          </View>
          <SearchBox value={text} onChange={setText} placeholder="Name, phone or member number" label="Find a member" />
        </View>
        <Chips items={FILTERS} value={state} onChange={setState} />
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 120 }} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={list.busy && !!list.data} onRefresh={() => { void list.refresh(); }} />}>
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>{q || state ? t('No member matches that.') : t('No members yet. Add the first one above.')}</Empty> : null}
          {(list.data ?? []).map((m) => (
            <View key={m.member_id} style={[s.card, { gap: 10 }]}>
              <Pressable accessibilityRole="button" onPress={() => open(m)} style={{ gap: 3 }}>
                <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                  <Text style={{ flex: 1, fontSize: 17, fontWeight: '700', color: color.ink }} numberOfLines={1}>{m.name}</Text>
                  <Text style={{ fontSize: 13, fontWeight: '700', color: tone(m.state) }}>{t(STATE_LABEL[m.state] ?? m.state)}</Text>
                </View>
                <Text style={{ color: color.soft, fontSize: 13 }}>{[m.member_code, m.phone].filter(Boolean).join(' · ')}</Text>
                <Text style={{ color: color.soft, fontSize: 13 }}>{m.plan_name ? `${m.plan_name}${m.expires_on ? ` · ${t('ends')} ${m.expires_on}` : ''}` : t('No membership')}</Text>
              </Pressable>
              <View style={{ flexDirection: 'row', gap: 8 }}>
                {m.phone ? <Act icon="call-outline" label="Call" go={() => { void Linking.openURL(`tel:${m.phone}`); }} /> : null}
                {m.phone ? <Act icon="logo-whatsapp" label="WhatsApp" go={() => { void Linking.openURL(`https://wa.me/${waNumber(m.phone as string)}`); }} /> : null}
                <Act icon="refresh-outline" label="Renew" go={() => open(m)} />
              </View>
            </View>
          ))}
        </ScrollView>
        <Pressable accessibilityRole="button" accessibilityLabel={t('Add a new member')} onPress={() => router.push('/gym-member-new')}
          style={({ pressed }) => ({ position: 'absolute', right: 20, bottom: 24, minHeight: 56, paddingHorizontal: 20, borderRadius: 28, backgroundColor: color.action, flexDirection: 'row', alignItems: 'center', gap: 8, opacity: pressed ? 0.9 : 1, boxShadow: '0 6px 18px rgba(0,0,0,0.2)' })}>
          <Ionicons name="person-add-outline" size={20} color={color.onAction} /><Text style={{ color: color.onAction, fontWeight: '700', fontSize: 16 }}>{t('Add Member')}</Text>
        </Pressable>
      </Page>
    </SafeAreaView>
  );
}
