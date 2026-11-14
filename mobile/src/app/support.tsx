import { useCallback, useEffect, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, Chips, Empty, ErrorText, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

/* Help and support: ask FlowXP a question, read the answer, write back. The same tickets as the website's Help and support page. */
type Ticket = { ticket_id: number; subject: string; status: 'OPEN' | 'ANSWERED' | 'CLOSED'; unread_client: boolean; last_message_at: string };
type Message = { message_id: number; sender: 'CLIENT' | 'ADMIN'; body: string; created_at: string };
type One = { ticket_id: number; subject: string; status: Ticket['status']; messages: Message[] };

const CATEGORIES: { id: string; label: string }[] = [
  { id: 'QUESTION', label: 'A question' }, { id: 'BILLING', label: 'Billing' }, { id: 'WHATSAPP', label: 'WhatsApp' },
  { id: 'SETUP', label: 'Setup help' }, { id: 'BUG', label: 'Not working' }, { id: 'OTHER', label: 'Other' }
];
const STATUS = { OPEN: 'Waiting for us', ANSWERED: 'We replied', CLOSED: 'Closed' } as const;
const when = (iso: string) => new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const why = (e: unknown) => (e instanceof Error ? e.message : 'Something went wrong. Try again.');

export default function Support() {
  const [view, setView] = useState<{ name: 'list' } | { name: 'new' } | { name: 'one'; id: number }>({ name: 'list' });
  const [tickets, setTickets] = useState<Ticket[] | null>(null);
  const [one, setOne] = useState<One | null>(null);
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState('QUESTION');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadList = useCallback(() => { api.get<Ticket[]>('/support/tickets').then((r) => { setTickets(r); setError(''); }).catch((e) => setError(why(e))); }, []);
  const loadOne = useCallback((id: number) => { api.get<One>(`/support/tickets/${id}`).then(setOne).catch((e) => setError(why(e))); }, []);
  useEffect(() => { if (view.name === 'list') loadList(); if (view.name === 'one') { setOne(null); loadOne(view.id); } }, [view, loadList, loadOne]);

  const create = async () => {
    setBusy(true); setError('');
    try { const r = await api.call<{ ticket_id: number }>('/support/tickets', { method: 'POST', body: { subject, category, body: text } }); setSubject(''); setText(''); if (r.data) setView({ name: 'one', id: r.data.ticket_id }); }
    catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const reply = async (id: number) => {
    setBusy(true); setError('');
    try { await api.call(`/support/tickets/${id}/reply`, { method: 'POST', body: { body: text } }); setText(''); loadOne(id); }
    catch (e) { setError(why(e)); } finally { setBusy(false); }
  };
  const close = async (id: number) => { try { await api.call(`/support/tickets/${id}/close`, { method: 'POST' }); loadOne(id); } catch (e) { setError(why(e)); } };

  return (
    <SafeAreaView style={s.screen}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <Page>
          <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
            <Title>Help and support</Title>
            <ErrorText>{error}</ErrorText>

            {view.name === 'list' && (
              <>
                <Button title="Ask for help" onPress={() => { setText(''); setError(''); setView({ name: 'new' }); }} />
                {!tickets && !error && <Loading />}
                {tickets?.length === 0 && <Empty>You have not asked us anything yet.</Empty>}
                {(tickets || []).map((t) => (
                  <Pressable key={t.ticket_id} accessibilityRole="button" onPress={() => { setText(''); setView({ name: 'one', id: t.ticket_id }); }} style={{ padding: 14, borderRadius: 12, borderWidth: 1, borderColor: color.line, gap: 2 }}>
                    <Text style={{ fontWeight: '700', color: color.ink }}>{t.subject}</Text>
                    <Soft>{`${STATUS[t.status]}${t.unread_client ? ' · new answer' : ''} · ${when(t.last_message_at)}`}</Soft>
                  </Pressable>
                ))}
                <Button title="Back" kind="quiet" onPress={() => goBack()} />
              </>
            )}

            {view.name === 'new' && (
              <>
                <Soft>Tell us what you need. We answer here and tell you when we do.</Soft>
                <Chips<string> items={CATEGORIES} value={category} onChange={setCategory} />
                <TextInput style={s.input} value={subject} onChangeText={setSubject} maxLength={160} placeholder="A few words as a title" accessibilityLabel="Title" />
                <TextInput style={[s.input, { minHeight: 140, textAlignVertical: 'top' }]} value={text} onChangeText={setText} multiline maxLength={4000} placeholder="What happened, and what did you expect?" accessibilityLabel="Your message" />
                <Button title="Send" onPress={() => { void create(); }} busy={busy} disabled={subject.trim().length < 3 || text.trim().length < 10} />
                <Button title="Cancel" kind="quiet" onPress={() => setView({ name: 'list' })} />
              </>
            )}

            {view.name === 'one' && (
              <>
                {!one && !error && <Loading />}
                {one && (
                  <>
                    <Text style={{ fontWeight: '700', fontSize: 16, color: color.ink }}>{one.subject}</Text>
                    <Soft>{STATUS[one.status]}</Soft>
                    {one.messages.map((m) => (
                      <View key={m.message_id} style={{ padding: 12, borderRadius: 12, backgroundColor: m.sender === 'ADMIN' ? color.tint : color.card, borderWidth: m.sender === 'ADMIN' ? 0 : 1, borderColor: color.line, gap: 4 }}>
                        <Soft>{`${m.sender === 'ADMIN' ? 'FlowXP support' : 'You'} · ${when(m.created_at)}`}</Soft>
                        <Text style={{ color: color.ink }}>{m.body}</Text>
                      </View>
                    ))}
                    <TextInput style={[s.input, { minHeight: 90, textAlignVertical: 'top' }]} value={text} onChangeText={setText} multiline maxLength={4000} placeholder={one.status === 'CLOSED' ? 'Write again to reopen this' : 'Your reply'} accessibilityLabel="Your reply" />
                    <Button title="Send" onPress={() => { void reply(one.ticket_id); }} busy={busy} disabled={!text.trim()} />
                    {one.status !== 'CLOSED' && <Button title="It is solved, close it" kind="quiet" onPress={() => { void close(one.ticket_id); }} />}
                  </>
                )}
                <Button title="All my tickets" kind="quiet" onPress={() => setView({ name: 'list' })} />
              </>
            )}
          </ScrollView>
        </Page>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
