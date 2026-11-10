import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { WALLET_METHODS, TOURNAMENT_TEXT, entryBody, inr, type Tournament } from '../lib/gamingDesk.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

const when = (iso: string) => new Date(iso).toLocaleString([], { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

/* Tournaments: see who has entered, add an entry (and take the fee), check people in. Creating a tournament and entering results stay on the website. */
export default function GamingTournaments() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const list = useLoad<Tournament[]>(`gaming-tournaments:${scope}`, () => api.get<Tournament[]>('/gaming/tournaments'));
  const [open, setOpen] = useState<number | null>(null);
  const one = useLoad<Tournament>(`gaming-tournament:${scope}:${open}`, () => api.get<Tournament>(`/gaming/tournaments/${open}`), open !== null);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [pay, setPay] = useState<'NOW' | 'LATER'>('NOW');
  const [method, setMethod] = useState('CASH');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [key, setKey] = useState(() => newKey());

  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError('');
    try { await fn(); setKey(newKey()); await Promise.all([one.refresh(), list.refresh()]); return true; }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); return false; }
    finally { setBusy(false); }
  };
  const tn = one.data;
  const addEntry = async () => {
    if (name.trim().length < 2) { setError(t('Type who is entering.')); return; }
    const ok = await run(() => api.post(`/gaming/tournaments/${open}/entries`, entryBody({ name, phone }, pay === 'NOW' && (tn?.entry_fee ?? 0) > 0, method), { idempotencyKey: key }));
    if (ok) { setName(''); setPhone(''); setAdding(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Tournaments</Title><Soft>Entries and check-in</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>No tournaments yet. Create one on the website.</Empty> : null}
          {(list.data ?? []).map((x) => (
            <View key={x.tournament_id}>
              <Line left={x.name} sub={`${when(x.starts_at)}${x.entry_fee ? ` · ${t('Entry')} ${inr(x.entry_fee)}` : ''}`} right={`${x.entries ?? 0}${x.max_players ? `/${x.max_players}` : ''}`} selected={open === x.tournament_id} onPress={() => { setOpen(open === x.tournament_id ? null : x.tournament_id); setAdding(false); setError(''); }} />
              {open === x.tournament_id ? (
                <View style={{ padding: 16, gap: 8, backgroundColor: color.card }}>
                  {one.busy && !tn ? <Loading /> : null}
                  {tn ? (
                    <>
                      <Text style={{ color: tn.status === 'OPEN' ? color.ok : color.soft, fontWeight: '600' }}>{t(TOURNAMENT_TEXT[tn.status])}{tn.prize_pool ? ` · ${t('Prize pool')} ${inr(tn.prize_pool)}` : ''}</Text>
                      <Soft>{t('{a} in · {b} checked in', { a: tn.entries ?? 0, b: tn.checked_in ?? 0 })}</Soft>
                      {(tn.entries_list ?? []).filter((e) => e.status !== 'WITHDRAWN').map((e) => (
                        <View key={e.entry_id} style={{ paddingVertical: 6, gap: 6 }}>
                          <Text style={{ color: color.ink, fontSize: 16 }}>{e.name}<Text style={{ color: color.soft }}>{`  ${e.status === 'CHECKED_IN' ? t('Checked in') : tn.entry_fee && !e.paid ? t('Not paid') : t('Entered')}`}</Text>{e.placement ? <Text style={{ color: color.brand }}>{`  #${e.placement}`}</Text> : null}</Text>
                          {tn.status !== 'DONE' && tn.status !== 'CANCELLED' ? (
                            <View style={{ flexDirection: 'row', gap: 8 }}>
                              {tn.entry_fee && !e.paid ? <Button title="Take the fee" kind="quiet" disabled={busy} style={{ flex: 1 }} onPress={() => { void run(() => api.post(`/gaming/entries/${e.entry_id}/pay`, { payment: { method, amount: 'FULL' } }, { idempotencyKey: newKey() })); }} /> : null}
                              {e.status !== 'CHECKED_IN' ? <Button title="Check in" kind="quiet" disabled={busy} style={{ flex: 1 }} onPress={() => { void run(() => api.post(`/gaming/entries/${e.entry_id}/check-in`, {})); }} /> : null}
                            </View>
                          ) : null}
                        </View>
                      ))}
                      {tn.entry_fee ? <><SectionTitle>Fee paid by</SectionTitle><Chips items={WALLET_METHODS} value={method} onChange={setMethod} /></> : null}
                      {tn.status === 'OPEN' || tn.status === 'PLANNED' ? (
                        adding ? (
                          <View style={{ gap: 8 }}>
                            <TextInput style={s.input} value={name} onChangeText={setName} placeholder={t('Name')} accessibilityLabel={t('Name')} />
                            <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder={t('Mobile number (optional)')} accessibilityLabel={t('Mobile number (optional)')} />
                            {tn.entry_fee ? <Chips items={[{ id: 'NOW', label: t('Take {n} now', { n: inr(tn.entry_fee) }) }, { id: 'LATER', label: 'Pay later' }]} value={pay} onChange={(v) => setPay(v as 'NOW' | 'LATER')} /> : null}
                            <Button title="Add entry" onPress={() => { void addEntry(); }} busy={busy} />
                          </View>
                        ) : <Button title="Add an entry" onPress={() => setAdding(true)} disabled={Boolean(tn.max_players && (tn.entries ?? 0) >= tn.max_players)} />
                      ) : null}
                      <ErrorText>{error}</ErrorText>
                    </>
                  ) : null}
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
