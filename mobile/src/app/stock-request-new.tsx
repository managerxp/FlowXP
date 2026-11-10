import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { goBack } from '../lib/nav.ts';
import { pname, type Product } from '../lib/catalog.ts';
import { addAsk, askBody, askProblem, dropAsk, setAskQty, type AskLine } from '../lib/stockRequests.ts';
import { Page } from '../lib/responsive.tsx';
import { t } from '../lib/i18n.ts';
import { Button, Chips, ErrorText, Line, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Ask another outlet for stock: choose the outlet, pick the items, type how much of each. */
export default function StockRequestNew() {
  const session = useSession();
  const scope = useScope();
  const others = (currentBusiness(session)?.outlets ?? []).filter((o) => o.branch_id !== session.branchId);
  const [from, setFrom] = useState(others.length === 1 ? String(others[0].branch_id) : '');
  const [text, setText] = useState('');
  const [found, setFound] = useState<Product[]>([]);
  const [lines, setLines] = useState<AskLine[]>([]);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState('');
  const key = useRef(newKey());   // one key for this request: a double tap sends it once
  const bad = askProblem(from ? Number(from) : null, lines);
  const edit = (next: AskLine[]) => { setLines(next); key.current = newKey(); setProblem(''); };

  useEffect(() => {
    let live = true;
    if (!scope || !text.trim()) { setFound([]); return; }
    void scope.catalog.search(text).then((r) => { if (live) setFound(r.filter((p) => p.track_inventory)); });
    return () => { live = false; };
  }, [scope, text]);

  const send = async () => {
    if (bad) return setProblem(t(bad));
    setBusy(true); setProblem('');
    try { await api.post('/transfer-requests', askBody(Number(from), lines, notes), { idempotencyKey: key.current }); router.replace('/stock-requests'); }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : t('Could not send the request.')); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{t('Ask for stock')}</Title></View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
          <SectionTitle>{t('Ask which outlet?')}</SectionTitle>
          <Chips items={others.map((o) => ({ id: String(o.branch_id), label: o.name }))} value={from} onChange={(v) => { setFrom(v); setProblem(''); }} />
          <SectionTitle>{t('What do you need?')}</SectionTitle>
          <View style={{ paddingHorizontal: 16, gap: 8 }}>
            <TextInput style={s.input} value={text} onChangeText={setText} placeholder="Search for an item" accessibilityLabel="Search for an item" autoCorrect={false} />
            {found.map((p) => <Line key={p.product_id} left={pname(p)} sub={p.unit ?? undefined} onPress={() => { edit(addAsk(lines, { product_id: p.product_id, name: pname(p), unit: p.unit })); setText(''); setFound([]); }} />)}
          </View>
          {lines.map((l) => (
            <View key={l.product_id} style={{ padding: 16, gap: 8, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
              <Text style={{ fontSize: 16, color: color.ink }}>{l.name}{l.unit ? ` (${l.unit})` : ''}</Text>
              <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                <TextInput style={[s.input, { width: 120 }]} value={l.quantity} onChangeText={(v) => edit(setAskQty(lines, l.product_id, v))} keyboardType="decimal-pad" placeholder={t('How much')} accessibilityLabel={`${t('How much')} ${l.name}`} />
                <Button title="Remove" kind="quiet" onPress={() => edit(dropAsk(lines, l.product_id))} />
              </View>
            </View>
          ))}
          <View style={{ padding: 16, gap: 10 }}>
            <TextInput style={s.input} value={notes} onChangeText={setNotes} placeholder={t('A note (optional)')} maxLength={300} accessibilityLabel={t('A note (optional)')} />
            <ErrorText>{problem}</ErrorText>
            <Button title={t('Send request')} onPress={() => { void send(); }} busy={busy} disabled={Boolean(bad)} />
            <Soft>{t('The other outlet will see this and send what it can.')}</Soft>
          </View>
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
