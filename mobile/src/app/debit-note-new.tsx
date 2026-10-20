import { useEffect, useRef, useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { newKey } from '../lib/api.ts';
import { api } from '../lib/session.ts';
import { goBack } from '../lib/nav.ts';
import { t } from '../lib/i18n.ts';
import { qty, rupees } from '../lib/money.ts';
import { Page } from '../lib/responsive.tsx';
import { canRaise, debitBody, debitEstimate, debitProblem, emptyDebit, maxFor, type DebitForm, type DebitKind, type DebitOptions } from '../lib/notes.ts';
import { Button, Chips, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../lib/ui.tsx';

/* Raise a debit note against an order that has arrived: goods sent back (at the price paid) or a price correction (the overcharge per unit). */
export default function DebitNoteNew() {
  const { po } = useLocalSearchParams<{ po: string }>();
  const [opts, setOpts] = useState<DebitOptions | null>(null);
  const [f, setF] = useState<DebitForm>(emptyDebit());
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const key = useRef(newKey());   // one key for this note: a double tap raises it once
  useEffect(() => { api.get<DebitOptions>(`/purchases/${po}/debit-notes/options`).then(setOpts).catch((e: Error) => setError(e.message || t('Could not load.'))); }, [po]);
  const edit = (id: number, patch: Partial<{ qty: string; unit_cost: string }>) => setF((x) => ({ ...x, entries: { ...x.entries, [id]: { ...(x.entries[id] ?? { qty: '', unit_cost: '' }), ...patch } } }));

  const save = async () => {
    if (!opts) return;
    const bad = debitProblem(f, opts.items);
    if (bad) { setError(t(bad)); return; }
    setBusy(true); setError('');
    try { const made = await api.post<{ dn_number: string; dn_id: number }>(`/purchases/${po}/debit-notes`, debitBody(f, opts.items), { idempotencyKey: key.current }); router.replace({ pathname: '/note', params: { type: 'debit', id: String(made.dn_id) } }); }
    catch (e) { setError(e instanceof Error ? e.message : t('Could not save. Check the connection and try again.')); key.current = newKey(); } finally { setBusy(false); }
  };

  if (error && !opts) return <SafeAreaView style={s.screen}><Failed message={error} /></SafeAreaView>;
  if (!opts) return <SafeAreaView style={s.screen}><Loading /></SafeAreaView>;
  const estimate = debitEstimate(f, opts.items);
  return (
    <SafeAreaView style={s.screen}>
      <Page max={640}>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 12, paddingBottom: 40 }} keyboardShouldPersistTaps="handled">
          <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}><View style={{ flex: 1 }}><Title>Raise a debit note</Title><Soft>{t('Order {number}', { number: opts.po_number })}</Soft></View><Button title="Cancel" kind="quiet" onPress={() => goBack()} /></View>
          {!canRaise(opts.status) ? <Soft>{t('Only an order that has arrived can have a debit note.')}</Soft> : (
            <>
              <Text style={{ color: color.soft, fontSize: 13 }}>{t('What is this for?')}</Text>
              <Chips items={[{ id: 'RETURN', label: 'Goods sent back' }, { id: 'PRICE', label: 'A price correction' }]} value={f.kind} onChange={(k: DebitKind) => setF((x) => ({ ...x, kind: k }))} />
              <TextInput style={s.input} value={f.reason} onChangeText={(v) => setF((x) => ({ ...x, reason: v }))} maxLength={300} placeholder={t('Why? (the supplier will read it)')} accessibilityLabel={t('Reason')} />
              <SectionTitle>Items</SectionTitle>
              {opts.items.map((l) => {
                const max = maxFor(f.kind, l);
                const e = f.entries[l.item_id];
                return (
                  <View key={l.item_id} style={[s.card, { gap: 6 }]}>
                    <Text style={{ color: color.ink, fontWeight: '600' }}>{l.description}</Text>
                    <Soft>{f.kind === 'RETURN' ? t('Arrived {n}, can still go back {left}', { n: qty(l.received), left: qty(l.returnable) }) : t('Arrived {n}', { n: qty(l.received) })} · {rupees(Math.round(l.unit_cost * 100))}</Soft>
                    <View style={{ flexDirection: 'row', gap: 8 }}>
                      <TextInput style={[s.input, { flex: 1 }]} value={e?.qty ?? ''} onChangeText={(v) => edit(l.item_id, { qty: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" editable={max > 0} placeholder={t('How many')} accessibilityLabel={`${t('How many')} ${l.description}`} />
                      {f.kind === 'PRICE' ? <TextInput style={[s.input, { flex: 1 }]} value={e?.unit_cost ?? ''} onChangeText={(v) => edit(l.item_id, { unit_cost: v.replace(/[^\d.]/g, '') })} keyboardType="decimal-pad" placeholder={t('Overcharge per unit (₹)')} accessibilityLabel={`${t('Overcharge per unit (₹)')} ${l.description}`} /> : null}
                    </View>
                  </View>
                );
              })}
              {estimate > 0 ? <Soft>{t('About {value} will come off what you owe, tax included.', { value: rupees(estimate) })}</Soft> : null}
              <ErrorText>{error}</ErrorText>
              <Button title="Issue the debit note" onPress={() => { void save(); }} busy={busy} />
            </>
          )}
        </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
