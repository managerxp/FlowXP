import { useEffect, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api, useSession } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { useLoad } from '../lib/useLoad.ts';
import { SearchBox } from '../lib/SearchBox.tsx';
import { WALLET_METHODS, inr, newPlayerBody, newPlayerProblem, topupBody, topupProblem, type Player } from '../lib/gamingDesk.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, Empty, ErrorText, Failed, Line, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Players and their prepaid wallets: find one, add one, put money on the wallet. */
export default function GamingPlayers() {
  const session = useSession();
  const scope = `${session.businessId}:${session.branchId}`;
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => { const x = setTimeout(() => setQ(text.trim()), 300); return () => clearTimeout(x); }, [text]);
  const list = useLoad<Player[]>(`gaming-players:${scope}:${q}`, () => api.get<Player[]>(`/gaming/players?limit=30&only=players${q ? `&search=${encodeURIComponent(q)}` : ''}`));
  const [open, setOpen] = useState<number | 'new' | null>(null);
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('CASH');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [tag, setTag] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [reqKey, setReqKey] = useState(() => newKey());

  const topup = async (p: Player) => {
    const bad = topupProblem(Number(amount));
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError(''); setNote('');
    try {
      const r = await api.post<{ balance: number; bonus: number }>(`/gaming/players/${p.customer_id}/wallet/topup`, topupBody(Number(amount), method, reqKey), { idempotencyKey: reqKey });
      setNote(`${t('Added')} ${inr(Number(amount))}${r.bonus ? ` + ${inr(r.bonus)} ${t('bonus')}` : ''} · ${t('Balance')} ${inr(r.balance)}`);
      setAmount(''); setReqKey(newKey()); await list.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const add = async () => {
    const bad = newPlayerProblem(name, phone);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { const p = await api.post<Player>('/gaming/players', newPlayerBody(name, phone, tag)); setName(''); setPhone(''); setTag(''); setText(p.name); setOpen(p.customer_id); await list.refresh(); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); }
    finally { setBusy(false); }
  };
  const field = (label: string, v: string, on: (x: string) => void, phonePad = false) => (
    <View style={{ gap: 4 }}><Text style={{ color: color.soft, fontSize: 13 }}>{t(label)}</Text><TextInput style={s.input} value={v} onChangeText={on} keyboardType={phonePad ? 'phone-pad' : 'default'} autoCorrect={false} accessibilityLabel={t(label)} /></View>
  );
  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>Players</Title><Soft>Find a player, add one, top up a wallet</Soft></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView contentContainerStyle={{ paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <SearchBox value={text} onChange={setText} placeholder="Name, phone or gamer tag" label="Find a player" />
            <Button title="Add a new player" kind="quiet" onPress={() => { setOpen(open === 'new' ? null : 'new'); setError(''); }} selected={open === 'new'} />
          </View>
          {open === 'new' ? (
            <View style={{ padding: 16, gap: 10 }}>
              {field('Name', name, setName)}{field('Mobile number (optional)', phone, setPhone, true)}{field('Gamer tag (optional)', tag, setTag)}
              <ErrorText>{error}</ErrorText>
              <Button title="Save player" onPress={() => { void add(); }} busy={busy} />
            </View>
          ) : null}
          {list.busy && !list.data ? <Loading /> : null}
          {list.error && !list.data ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
          {list.data && list.data.length === 0 ? <Empty>{q ? 'No player matches that.' : 'No players yet. Add the first one above.'}</Empty> : null}
          {(list.data ?? []).map((p) => (
            <View key={p.customer_id}>
              <Line left={p.gamer_tag ? `${p.name} (${p.gamer_tag})` : p.name} sub={p.phone ?? undefined} right={inr(p.wallet)} selected={open === p.customer_id} onPress={() => { setOpen(open === p.customer_id ? null : p.customer_id); setError(''); setNote(''); setAmount(''); }} />
              {open === p.customer_id ? (
                <View style={{ padding: 16, gap: 10, backgroundColor: color.card }}>
                  <SectionTitle>Put money on the wallet</SectionTitle>
                  <TextInput style={s.input} value={amount} onChangeText={(v) => setAmount(v.replace(/[^\d.]/g, ''))} keyboardType="decimal-pad" placeholder={t('Amount (₹)')} accessibilityLabel={t('Amount (₹)')} />
                  <Chips items={WALLET_METHODS} value={method} onChange={setMethod} />
                  {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}
                  <ErrorText>{error}</ErrorText>
                  <Button title="Add to wallet" onPress={() => { void topup(p); }} busy={busy} />
                </View>
              ) : null}
            </View>
          ))}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
