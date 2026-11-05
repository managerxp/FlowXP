import { useCallback, useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { allowed } from '../lib/access.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { Page } from '../lib/responsive.tsx';
import { RATING_FILTERS, averageRating, replyBody, replyProblem, reviewsUrl, stars, type Review } from '../lib/reviews.ts';
import { Button, Chips, Empty, ErrorText, Failed, Loading, Soft, Title, color, s } from '../lib/ui.tsx';

const ReviewCard = ({ row, onSent }: { row: Review; onSent: () => void }) => {
  const [reply, setReply] = useState(row.reply_text ?? '');
  const [busy, setBusy] = useState<'' | 'draft' | 'send'>('');
  const [problem, setProblem] = useState('');
  const say = (e: unknown) => setProblem(e instanceof ApiError || e instanceof Error ? e.message : t('Could not save. Check the connection and try again.'));
  const draft = async () => { setBusy('draft'); setProblem(''); try { setReply((await api.post<{ reply: string }>(`/reviews/${row.feedback_id}/draft-reply`, {})).reply); } catch (e) { say(e); } finally { setBusy(''); } };
  const send = async () => {
    const bad = replyProblem(reply);
    if (bad) return setProblem(t(bad));
    setBusy('send'); setProblem('');
    try { await api.post(`/reviews/${row.feedback_id}/reply`, replyBody(reply)); onSent(); } catch (e) { say(e); } finally { setBusy(''); }
  };
  return (
    <View style={[s.card, { gap: 8 }]}>
      <Text accessibilityLabel={`${row.rating} / 5`} style={{ fontSize: 20, color: color.warn }}>{stars(row.rating)}</Text>
      <Soft>{`${row.customer_name || t('A customer')} · ${row.invoice_number} · ${row.created_at.slice(0, 10)}`}</Soft>
      <Text style={{ color: row.comment ? color.ink : color.soft }}>{row.comment ? `“${row.comment}”` : t('No comment left.')}</Text>
      {row.reply_sent_at ? (
        <><Text style={{ color: color.ok, fontWeight: '600' }}>{t('Replied')}</Text><Soft>{row.reply_text ?? ''}</Soft></>
      ) : (
        <>
          <TextInput style={[s.input, { minHeight: 70 }]} value={reply} onChangeText={setReply} multiline maxLength={1000} placeholder={t('Write a reply, or let Flow AI draft one')} accessibilityLabel={t('Write a reply, or let Flow AI draft one')} />
          <ErrorText>{problem}</ErrorText>
          <Button title={busy === 'draft' ? t('Drafting…') : t('Draft with Flow AI')} kind="quiet" onPress={() => { void draft(); }} busy={busy === 'draft'} />
          <Button title={busy === 'send' ? t('Sending…') : t('Send reply')} onPress={() => { void send(); }} busy={busy === 'send'} disabled={!reply.trim()} />
        </>
      )}
    </View>
  );
};

/* Ratings customers left after their bill (owner and admins). A reply goes to the customer by message; Flow AI can write the first draft. */
export default function ReviewsScreen() {
  const me = currentBusiness(useSession());
  const ok = allowed(me, 'settings');
  const [rating, setRating] = useState('');
  const [rows, setRows] = useState<Review[] | null>(null);
  const [error, setError] = useState('');
  const load = useCallback(() => { setError(''); api.get<Review[]>(reviewsUrl(rating)).then(setRows).catch((e: unknown) => setError(e instanceof Error ? e.message : t("Could not load."))); }, [rating]);
  useEffect(() => { setRows(null); if (ok) load(); }, [load, ok]);
  const avg = rows ? averageRating(rows) : null;

  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Reviews</Title><Soft>What customers said after their bill</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {!ok ? <Empty>Only the owner and admins can see this page.</Empty> : (
          <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
            <Chips items={RATING_FILTERS.map((r) => ({ id: r, label: r ? `${r}★` : t('All') }))} value={rating} onChange={setRating} />
            {error ? <Failed message={error} onRetry={load} /> : !rows ? <Loading /> : (
              <>
                {avg ? <Soft style={{ padding: 16 }}>{t('Average {avg} out of 5, from {n} ratings shown.', { avg, n: rows.length })}</Soft> : <Empty>{t('No feedback yet. It appears here once a customer rates their bill.')}</Empty>}
                <View style={{ padding: 16, gap: 12 }}>{rows.map((r) => <ReviewCard key={r.feedback_id} row={r} onSent={load} />)}</View>
              </>
            )}
          </ScrollView>
        )}
      </Page>
    </SafeAreaView>
  );
}
