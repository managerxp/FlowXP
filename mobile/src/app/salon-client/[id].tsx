import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { setCustomer } from '../../lib/sale.ts';
import { useLoad } from '../../lib/useLoad.ts';
import { timelineText, type ClientDetail, type TimelineRow } from '../../lib/salon.ts';
import { rupees, toPaise } from '../../lib/money.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

/* One client: what they have (membership, packages, gift cards, points), a note for the team, and everything that has happened, newest first. */
export default function SalonClient() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const client = useLoad<ClientDetail>(`salon-client:${id}`, () => api.get<ClientDetail>(`/salon/clients/${id}`));
  const timeline = useLoad<TimelineRow[]>(`salon-timeline:${id}`, () => api.get<TimelineRow[]>(`/salon/clients/${id}/timeline?limit=30`));
  const [note, setNote] = useState('');
  const [key, setKey] = useState(newKey());
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const c = client.data;

  const addNote = async () => {
    if (!note.trim()) return;
    setBusy(true); setProblem('');
    try { await api.call(`/salon/clients/${id}/notes`, { method: 'POST', body: { body: note.trim() }, idempotencyKey: key }); setNote(''); setKey(newKey()); void client.refresh(); void timeline.refresh(); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'Could not save the note'); }
    finally { setBusy(false); }
  };

  const bill = () => { if (c) { setCustomer({ id: c.customer_id, name: c.name, phone: c.phone }); router.navigate('/sell'); } };
  const book = () => { if (c) { setCustomer({ id: c.customer_id, name: c.name, phone: c.phone }); router.push('/appointment-new'); } };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{c?.name ?? 'Client'}</Title>{c ? <Soft>{[c.phone, c.email].filter(Boolean).join(' · ')}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {client.busy && !c ? <Loading /> : null}
        {client.error && !c ? <Failed message={client.error} onRetry={() => { void client.refresh(); }} /> : null}
        {c ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            <View style={{ flexDirection: 'row', gap: 8, paddingHorizontal: 16 }}>
              <Button title="Bill" onPress={bill} style={{ flex: 1 }} />
              <Button title="Book" kind="quiet" onPress={book} style={{ flex: 1 }} />
            </View>
            <Soft style={{ padding: 16 }}>{`${c.visits} visit${c.visits === 1 ? '' : 's'}${c.last_visit ? ` · last ${String(c.last_visit).slice(0, 10)}` : ''}${c.total_spent != null ? ` · spent ${rupees(toPaise(c.total_spent))}` : ''}${c.outstanding ? ` · owes ${rupees(toPaise(c.outstanding))}` : ''}`}</Soft>
            {c.allergies ? <Text style={{ paddingHorizontal: 16, color: color.danger, fontWeight: '700' }}>Allergies: {c.allergies}</Text> : null}
            {c.favorite_staff_name ? <Soft style={{ paddingHorizontal: 16, paddingTop: 4 }}>{`Usually sees ${c.favorite_staff_name}`}</Soft> : null}
            {c.labels.length ? <Soft style={{ paddingHorizontal: 16, paddingTop: 4 }}>{c.labels.join(' · ')}</Soft> : null}

            {c.memberships.some((m) => m.active) || c.packages.some((p) => p.active) || c.gift_cards.length || c.loyalty ? <SectionTitle>What they have</SectionTitle> : null}
            {c.memberships.filter((m) => m.active).map((m) => <Line key={m.membership_id} left={m.plan_name} sub={`Member until ${String(m.expiry_date).slice(0, 10)}`} />)}
            {c.packages.filter((p) => p.active).map((p) => <Line key={p.cp_id} left={p.name} sub={`${(p.items ?? []).map((i) => `${i.remaining} of ${i.total} ${i.name}`).join(', ')} · until ${String(p.expiry_date).slice(0, 10)}`} />)}
            {c.gift_cards.filter((g) => g.status === 'ACTIVE' && g.balance > 0).map((g) => <Line key={g.code} left={`Gift card ${g.code}`} sub={g.expires_on ? `Until ${String(g.expires_on).slice(0, 10)}` : 'No expiry'} right={rupees(toPaise(g.balance))} />)}
            {c.loyalty ? <Line left="Points" sub={`${c.loyalty.tier ? `${c.loyalty.tier} · ` : ''}${c.loyalty.expiring_soon ? `${c.loyalty.expiring_soon} expire soon` : 'Spend them at the till'}`} right={String(c.loyalty.available)} /> : null}

            <SectionTitle>Notes</SectionTitle>
            <View style={{ padding: 16, gap: 8 }}>
              <TextInput style={s.input} value={note} onChangeText={setNote} placeholder="Add a note for the team" accessibilityLabel="Note" multiline />
              <ErrorText>{problem}</ErrorText>
              <Button title="Save note" kind="quiet" onPress={() => { void addNote(); }} busy={busy} disabled={!note.trim()} />
            </View>
            {c.notes.map((n) => <Line key={n.note_id} left={n.body} sub={`${n.author ?? 'Team'} · ${String(n.created_at).slice(0, 10)}`} />)}

            <SectionTitle>History</SectionTitle>
            {(timeline.data ?? []).map((r, i) => <Line key={`${r.type}${i}`} left={timelineText(r)} sub={String(r.at).slice(0, 10)} right={r.amount != null && r.type !== 'points' ? rupees(toPaise(r.amount)) : undefined} />)}
            {timeline.data && timeline.data.length === 0 ? <Soft style={{ padding: 16 }}>Nothing yet.</Soft> : null}
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
