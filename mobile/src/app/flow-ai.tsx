import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { askProblem, blocks, friendlyError, questionsFor, unavailable, type AiChat, type AiConversation, type AiMessage, type AiStatus } from '../lib/flowai.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Answers are drawn as plain text: paragraphs, bullets, numbers and bold. Nothing the assistant writes is ever run or opened. */
const Answer = ({ text }: { text: string }) => (
  <View style={{ gap: 6 }}>
    {blocks(text).map((b, i) => (
      <View key={i} style={{ flexDirection: 'row', gap: 8 }}>
        {b.kind === 'bullet' ? <Text style={{ color: color.ink, fontSize: 16 }}>•</Text> : b.kind === 'number' ? <Text style={{ color: color.ink, fontSize: 16 }}>{b.n}.</Text> : null}
        <Text style={{ flex: 1, color: color.ink, fontSize: 16, lineHeight: 23 }}>{b.spans.map((sp, k) => <Text key={k} style={sp.bold ? { fontWeight: '700' } : undefined}>{sp.text}</Text>)}</Text>
      </View>
    ))}
  </View>
);

/* Ask about the business in plain words. The server works the answer out from the business's own records and only from what this person may already see. It needs the internet. */
export default function FlowAi() {
  const session = useSession();
  const status = useLoad<AiStatus>(`ai-status:${session.businessId}`, () => api.get<AiStatus>('/ai/status'));
  const [earlier, setEarlier] = useState(false);
  const past = useLoad<AiConversation[]>(`ai-conversations:${session.businessId}`, () => api.get<AiConversation[]>('/ai/conversations'), earlier);
  const [messages, setMessages] = useState<AiMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const end = useRef<ScrollView>(null);
  const st = status.data;
  const blocked = unavailable(st);
  const canAsk = Boolean(st?.can_ask) && !busy;
  const bad = askProblem(text);

  useEffect(() => { setTimeout(() => end.current?.scrollToEnd({ animated: true }), 50); }, [messages, busy]);

  const ask = async (question: string, briefing = false) => {
    const q = question.trim();
    if (!briefing && (!q || askProblem(q))) return;
    setProblem(''); setBusy(true); setEarlier(false);
    if (briefing) { setConversationId(null); setMessages([{ role: 'user', content: 'Give me my briefing' }]); } else setMessages((m) => [...m, { role: 'user', content: q }]);
    try {
      const r = await api.call<AiChat>(briefing ? '/ai/briefing' : '/ai/chat', { method: 'POST', body: briefing ? {} : { message: q, ...(conversationId ? { conversation_id: conversationId } : {}) }, timeoutMs: 90000 });
      setConversationId(r.data.conversation_id);
      setMessages((m) => [...m, { role: 'assistant', content: r.data.answer, tools: r.data.tools_used }]);
      void status.refresh();
    } catch (e) {
      setProblem(friendlyError(e));
      if (!briefing) { setMessages((m) => m.slice(0, -1)); setText(q); }   // the question comes back so nothing has to be typed again
    } finally { setBusy(false); }
  };
  const send = () => { const q = text; if (!canAsk || !q.trim()) return; setText(''); void ask(q); };

  const openOld = async (id: number) => {
    setProblem('');
    try { const c = await api.get<{ messages: AiMessage[] }>(`/ai/conversations/${id}`); setConversationId(id); setMessages(c.messages); setEarlier(false); }
    catch (e) { setProblem(friendlyError(e)); }
  };
  const fresh = () => { setConversationId(null); setMessages([]); setProblem(''); setEarlier(false); };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Ask Flow AI</Title><Soft>{st?.remaining != null && st.can_ask ? `${st.remaining} questions left this month` : 'Questions about your business, in plain words'}</Soft></View>
          <Button title="Earlier" kind="quiet" onPress={() => setEarlier((v) => !v)} />
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {status.busy && !st ? <Loading /> : null}
        {status.error && !st ? <Failed message={friendlyError(new Error(status.error))} onRetry={() => { void status.refresh(); }} /> : null}

        {earlier ? (
          <ScrollView contentContainerStyle={{ paddingBottom: 24 }}>
            <View style={{ paddingHorizontal: 16 }}><Button title="Start a new chat" onPress={fresh} /></View>
            <SectionTitle>Earlier chats</SectionTitle>
            {past.busy && !past.data ? <Loading /> : null}
            {past.data && past.data.length === 0 ? <Soft style={{ padding: 16 }}>Nothing here yet. Ask your first question.</Soft> : null}
            {(past.data ?? []).map((c) => <Line key={c.conversation_id} icon="chatbubble-outline" left={c.title || 'Chat'} sub={String(c.updated_at).slice(0, 10)} onPress={() => { void openOld(c.conversation_id); }} />)}
          </ScrollView>
        ) : st ? (
          <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
            <ScrollView ref={end} contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 12 }} keyboardShouldPersistTaps="handled">
              {blocked ? (
                <View style={[s.card, { gap: 6 }]}><Text accessibilityRole="header" style={{ fontSize: 17, fontWeight: '700', color: color.ink }}>{blocked.title}</Text><Soft>{blocked.body}</Soft></View>
              ) : null}
              {!messages.length && !blocked ? (
                <View style={{ gap: 10 }}>
                  <Text style={{ fontSize: 17, fontWeight: '600', color: color.ink }}>What would you like to know?</Text>
                  {questionsFor(st).map((q) => (
                    <Pressable key={q} accessibilityRole="button" onPress={() => { if (canAsk) void ask(q); }} disabled={!canAsk} android_ripple={{ color: '#0b57ff22' }}
                      style={({ pressed }) => [s.card, { minHeight: 52, justifyContent: 'center', backgroundColor: pressed ? '#eaf1ff' : color.card }]}>
                      <Text style={{ color: color.ink, fontSize: 16 }}>“{q}”</Text>
                    </Pressable>
                  ))}
                  <Button title="Give me my daily briefing" kind="quiet" onPress={() => { void ask('', true); }} disabled={!canAsk} />
                </View>
              ) : null}
              {messages.map((m, i) => (
                <View key={i} style={{ alignItems: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                  <View style={{ maxWidth: '92%', borderRadius: 16, padding: 12, backgroundColor: m.role === 'user' ? color.brand : color.card, borderWidth: m.role === 'user' ? 0 : 1, borderColor: color.line }}>
                    {m.role === 'user' ? <Text style={{ color: '#fff', fontSize: 16 }}>{m.content}</Text> : <Answer text={m.content} />}
                    {m.role === 'assistant' && m.tools?.length ? <Text style={{ color: color.soft, fontSize: 12, marginTop: 8 }}>{`Looked at ${m.tools.map((t) => t.label).join(', ')}`}</Text> : null}
                  </View>
                </View>
              ))}
              {busy ? <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Soft>Looking at your records…</Soft></View> : null}
              <ErrorText>{problem}</ErrorText>
            </ScrollView>
            <View style={{ flexDirection: 'row', gap: 8, padding: 12, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card, alignItems: 'flex-end' }}>
              <TextInput style={[s.input, { flex: 1, maxHeight: 120 }]} value={text} onChangeText={setText} placeholder="Ask a question" accessibilityLabel="Your question" multiline editable={!blocked && !busy} />
              <Pressable accessibilityRole="button" accessibilityLabel="Send" onPress={send} disabled={!canAsk || !text.trim() || Boolean(bad)}
                style={{ width: 52, height: 52, borderRadius: 26, backgroundColor: canAsk && text.trim() && !bad ? color.brand : '#cbd5e1', alignItems: 'center', justifyContent: 'center' }}>
                <Ionicons name="send" size={22} color="#fff" />
              </Pressable>
            </View>
            {bad ? <Text style={{ color: color.danger, paddingHorizontal: 16, paddingBottom: 6 }}>{bad}</Text> : null}
          </KeyboardAvoidingView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
