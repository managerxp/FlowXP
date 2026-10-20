import { useState } from 'react';
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { api, currentBusiness, useSession } from './session.ts';
import { allowed } from './access.ts';
import { useLoad } from './useLoad.ts';
import { friendlyError, type AiChat, type AiStatus } from './flowai.ts';
import { REPORT_EXAMPLES, cleanQuestion } from './askReports.ts';
import AiAnswer from './AiAnswer.tsx';
import { t } from './i18n.ts';
import { Button, ErrorText, Soft, color, s } from './ui.tsx';

/* "Ask your reports": a question box above the reports. Shown only when this person may ask Flow AI (on, set up, questions left); otherwise the reports stand alone. `suggested` is a question about the report on screen. */
export default function AskReports({ suggested }: { suggested?: string }) {
  const session = useSession();
  const business = currentBusiness(session);
  const status = useLoad<AiStatus>(`ai-status:${session.businessId}`, () => api.get<AiStatus>('/ai/status'), allowed(business, 'ai'));
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [answer, setAnswer] = useState<{ question: string; text: string; conversation: number; tools: string[] } | null>(null);
  if (!status.data?.can_ask) return null;

  const ask = async (q: string) => {
    const question = cleanQuestion(q);
    if (!question || busy) return;
    setBusy(true); setError(''); setAnswer(null);
    try {
      const r = await api.call<AiChat>('/ai/chat', { method: 'POST', body: { message: question }, timeoutMs: 90000 });
      setAnswer({ question, text: r.data.answer, conversation: r.data.conversation_id, tools: (r.data.tools_used ?? []).map((x) => x.label) });
      setText('');
    } catch (e) { setError(friendlyError(e)); }
    finally { setBusy(false); }
  };
  const chips = [...(suggested ? [suggested] : []), ...REPORT_EXAMPLES.map((q) => t(q))];

  return (
    <View style={[s.card, { margin: 16, gap: 10 }]} accessibilityLabel={t('Ask your reports')}>
      <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
        <TextInput style={[s.input, { flex: 1 }]} value={text} onChangeText={setText} onSubmitEditing={() => { void ask(text); }} returnKeyType="send" maxLength={500} placeholder={t('Ask your reports')} accessibilityLabel={t('Ask your reports')} editable={!busy} />
        <Button title={busy ? t('Thinking…') : t('Ask')} onPress={() => { void ask(text); }} disabled={busy || !text.trim()} />
      </View>
      {!answer && !busy ? (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {chips.map((q) => (
            <Pressable key={q} accessibilityRole="button" onPress={() => { void ask(q); }} style={({ pressed }) => ({ borderRadius: 16, borderWidth: 1, borderColor: color.lineStrong, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: pressed ? color.tint : color.card })}>
              <Text style={{ color: color.ink, fontSize: 14 }}>{q}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      {busy ? <View accessibilityLiveRegion="polite" style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}><ActivityIndicator /><Soft>{t('Thinking…')}</Soft></View> : null}
      <ErrorText>{error}</ErrorText>
      {answer ? (
        <View style={{ gap: 8, padding: 12, borderRadius: 12, backgroundColor: color.wash }}>
          <Text style={{ color: color.soft, fontSize: 13, fontWeight: '600' }}>{answer.question}</Text>
          <AiAnswer text={answer.text} />
          {answer.tools.length ? <Text style={{ color: color.soft, fontSize: 12 }}>{t('Looked at {tools}', { tools: answer.tools.join(', ') })}</Text> : null}
          <Button title="Open in Flow AI" kind="quiet" onPress={() => router.push({ pathname: '/flow-ai', params: { c: String(answer.conversation) } })} />
        </View>
      ) : null}
    </View>
  );
}
