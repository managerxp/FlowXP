import { useEffect, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { router } from 'expo-router';
import { useFocusEffect } from 'expo-router';
import { useCallback } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { SearchBox } from '../lib/SearchBox.tsx';
import { STATE_LABEL, memberSub, type Member } from '../lib/gym.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Empty, Failed, Line, Loading, Soft, Title, s } from '../lib/ui.tsx';

/* The gym's members: search by name, phone or member number, open one, or add a new member. With nothing typed it shows the latest members. */
export default function GymMembers() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const x = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(x); }, [text]);
  const list = useLoad<Member[]>(`gym-members:${scope}:${q}`, () => api.get<Member[]>(`/gym/members?limit=30${q.length >= 2 ? `&search=${encodeURIComponent(q)}` : ''}`));
  useFocusEffect(useCallback(() => { void list.refresh(); }, [])); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Members</Title><Soft>Find a member, or add a new one</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <View style={{ paddingHorizontal: 16, gap: 8 }}>
          <SearchBox value={text} onChange={setText} placeholder="Name, phone or member number" label="Find a member" />
          <Button title="Add a new member" onPress={() => router.push('/gym-member-new')} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>{q ? t('No member matches that.') : t('No members yet. Add the first one above.')}</Empty> : null}
          {(list.data ?? []).map((m) => <Line key={m.member_id} left={m.name} sub={memberSub(m)} right={STATE_LABEL[m.state] ?? m.state} onPress={() => router.push({ pathname: '/gym-member/[id]', params: { id: String(m.member_id) } })} />)}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
