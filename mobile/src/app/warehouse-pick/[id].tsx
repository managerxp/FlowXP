import { useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, Text, TextInput, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError, newKey } from '../../lib/api.ts';
import { api } from '../../lib/session.ts';
import { goBack } from '../../lib/nav.ts';
import { useScope } from '../../lib/local.ts';
import { setCaptured, useCaptured } from '../../lib/capture.ts';
import { useLoad } from '../../lib/useLoad.ts';
import {
  KIND_LABEL, PICK_LABEL, dispatchBody, dispatchProblem, inUnit, matchScan, packBody, packProblem, pickBody, pickNext, pickProblem, pickedBase, shortItems, unitText, wantedText,
  type Kind, type PickDetail
} from '../../lib/warehouse.ts';
import { expiryText } from '../../lib/pharmacy.ts';
import { Page } from '../../lib/responsive.tsx';
import { Button, Chips, ErrorText, Failed, Loading, SectionTitle, Soft, Title, color, s } from '../../lib/ui.tsx';

const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const METHODS = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'BANK_TRANSFER', label: 'Bank' }, { id: 'CARD', label: 'Card' }];

/* One pick list. Not started: Start picking. Being picked: go down the list in bin order, scan or tap each item, change the number if some are missing, then Finish. Picked: pack it. Packed: send it out (the delivery challan and the bill are made together). */
export default function PickScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const scope = useScope();
  const captured = useCaptured();
  const list = useLoad<PickDetail>(`wh-pick:${id}`, () => api.get<PickDetail>(`/wholesale/pick-lists/${id}`));
  const l = list.data;
  const [typed, setTyped] = useState<Record<number, string>>({});
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [weight, setWeight] = useState('');
  const [vehicle, setVehicle] = useState('');
  const [driver, setDriver] = useState('');
  const [phone, setPhone] = useState('');
  const [kind, setKind] = useState<Kind>('TAX');
  const [method, setMethod] = useState('CASH');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState('');
  const [problem, setProblem] = useState('');
  const [note, setNote] = useState('');
  const keys = useRef<Record<string, string>>({});   // one key per kind of action on this list: a double tap or a retry does it once
  const keyFor = (what: string) => (keys.current[what] ??= newKey());
  const next = l ? pickNext(l.status) : null;

  // a barcode read by the scanner ticks off the item it belongs to
  useEffect(() => {
    if (!captured || !scope || !l) return;
    const code = captured; setCaptured(null);
    void scope.catalog.findByBarcode(code).then((p) => {
      const item = matchScan(l.items, p?.product_id ?? null);
      if (item) { setTicked((t) => new Set(t).add(item.pick_item_id)); setNote(`${item.product}: ticked off.`); setProblem(''); }
      else { setNote(''); setProblem(p ? `${p.name} is not on this pick list.` : 'That barcode is not on the phone. Tap the item instead.'); }
    });
  }, [captured]);   // eslint-disable-line react-hooks/exhaustive-deps

  const act = async (what: string, path: string, body: object = {}) => {
    setBusy(what); setProblem(''); setNote('');
    try { const r = await api.post<unknown>(`/wholesale/pick-lists/${id}/${path}`, body, { idempotencyKey: keyFor(what) }); await list.refresh(); return r; }
    catch (e) { setProblem(e instanceof ApiError ? e.message : e instanceof Error ? e.message : 'That did not work'); return null; }
    finally { setBusy(''); }
  };

  const finishPick = async () => {
    if (!l) return;
    const bad = pickProblem(l.items, typed);
    if (bad) return setProblem(bad);
    const shorts = shortItems(l.items, typed);
    const go = () => { void act('pick', 'pick', pickBody(l.items, typed)); };
    if (shorts.length) Alert.alert('Some items are short', `${shorts.map((x) => `${x.product}: ${x.short} ${x.unit}`).join(', ')} will go back to the order as a back-order.`, [{ text: 'Go back', style: 'cancel' }, { text: 'Finish picking', onPress: go }]);
    else go();
  };

  const sendOut = async () => {
    const bad = dispatchProblem(kind, method, reference);
    if (bad) return setProblem(bad);
    const r = await act('dispatch', 'dispatch', dispatchBody({ vehicle, driver, phone, kind, method, reference }));
    const out = r as { challan_number?: string; invoice_id?: number; invoice_number?: string; delivery_id?: number } | null;
    if (out?.invoice_id) setNote(`Sent out: challan ${out.challan_number}, bill ${out.invoice_number}.`);
  };
  const cancel = () => Alert.alert('Cancel this pick list?', 'What was set aside goes back to the order.', [{ text: 'Keep it', style: 'cancel' }, { text: 'Cancel pick list', style: 'destructive', onPress: () => { void act('cancel', 'cancel').then(() => goBack()); } }]);

  return (
    <SafeAreaView style={s.screen}>
      <Page>
        <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <View style={{ flex: 1 }}><Title>{l?.pick_number ?? 'Pick list'}</Title>{l ? <Soft>{`${l.customer} · ${l.order_number} · ${PICK_LABEL[l.status]}`}</Soft> : null}</View>
          <Button title="Back" kind="quiet" onPress={() => goBack()} />
        </View>
        {list.busy && !l ? <Loading /> : null}
        {list.error && !l ? <Failed message={list.error} onRetry={() => { void list.refresh(); }} /> : null}
        {l ? (
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ paddingBottom: 32 }}>
            {next === 'pick' ? <View style={{ paddingHorizontal: 16, paddingBottom: 8 }}><Button title="Scan an item" kind="quiet" onPress={() => router.push({ pathname: '/scan', params: { capture: '1' } })} /></View> : null}
            <SectionTitle>{`${l.items.length} products to take`}</SectionTitle>
            {l.items.map((i) => {
              const editing = next === 'pick';
              const got = editing ? pickedBase(i, typed[i.pick_item_id]) : i.picked_base;
              return (
                <View key={i.pick_item_id} style={{ padding: 16, gap: 6, borderTopWidth: 1, borderColor: color.line, backgroundColor: ticked.has(i.pick_item_id) ? '#ecfdf5' : color.card }}>
                  <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8 }}>
                    <View style={{ flex: 1 }}>
                      <Text style={{ fontSize: 16, fontWeight: '600', color: color.ink }}>{i.product}</Text>
                      <Soft>{`${i.location ? `Bin ${i.location} · ` : ''}take ${wantedText(i)}`}</Soft>
                    </View>
                    {!editing ? <Text style={{ fontWeight: '700', color: got < i.qty_base ? color.warn : color.ok }}>{`${inUnit(i, got)} ${unitText(i)}`}</Text> : null}
                  </View>
                  {i.batches.map((b) => <Soft key={b.batch_id}>{`Batch ${b.batch_no} · ${b.expiry_date ? expiryText(b.expiry_date, today()) : 'no use-by date'} · ${inUnit(i, b.qty_base)} ${unitText(i)}`}</Soft>)}
                  {i.serials.length ? <Soft>{`Serial numbers: ${i.serials.join(', ')}`}</Soft> : null}
                  {editing ? (
                    <View style={{ flexDirection: 'row', gap: 8, alignItems: 'center' }}>
                      <TextInput style={[s.input, { width: 110 }]} value={typed[i.pick_item_id] ?? ''} onChangeText={(v) => setTyped((t) => ({ ...t, [i.pick_item_id]: v }))} keyboardType="decimal-pad" placeholder={String(inUnit(i, i.qty_base))} accessibilityLabel={`How many ${i.product} were picked`} />
                      <Text style={{ color: color.soft, flex: 1 }}>{unitText(i)} picked</Text>
                      <Button title={ticked.has(i.pick_item_id) ? 'Got it' : 'Tick'} kind={ticked.has(i.pick_item_id) ? 'primary' : 'quiet'} onPress={() => setTicked((t) => { const n = new Set(t); if (n.has(i.pick_item_id)) n.delete(i.pick_item_id); else n.add(i.pick_item_id); return n; })} />
                    </View>
                  ) : null}
                </View>
              );
            })}

            <View style={{ padding: 16, gap: 10 }}>
              <ErrorText>{problem}</ErrorText>
              {note ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '600' }}>{note}</Text> : null}

              {next === 'start' ? <Button title="Start picking" onPress={() => { void act('start', 'start'); }} busy={busy === 'start'} /> : null}
              {next === 'pick' ? <Button title={ticked.size < l.items.length ? `Finish picking (${ticked.size} of ${l.items.length} ticked)` : 'Finish picking'} onPress={() => { void finishPick(); }} busy={busy === 'pick'} /> : null}

              {next === 'pack' ? (
                <>
                  <Soft>Everything picked goes in one package. More boxes are set up on the FlowXP website.</Soft>
                  <TextInput style={s.input} value={weight} onChangeText={setWeight} keyboardType="decimal-pad" placeholder="Weight in kg (optional)" accessibilityLabel="Weight in kilograms" />
                  <Button title="Pack it" onPress={() => { const bad = packProblem(weight); if (bad) setProblem(bad); else void act('pack', 'pack', packBody(l.items, weight)); }} busy={busy === 'pack'} />
                </>
              ) : null}

              {next === 'dispatch' ? (
                <>
                  <Soft>{`${l.packages.length} package${l.packages.length === 1 ? '' : 's'} ready. Sending it out makes the delivery challan and the bill, and takes the stock off the shelf.`}</Soft>
                  <TextInput style={s.input} value={vehicle} onChangeText={setVehicle} autoCapitalize="characters" placeholder="Vehicle number (optional)" accessibilityLabel="Vehicle number" />
                  <TextInput style={s.input} value={driver} onChangeText={setDriver} placeholder="Driver's name (optional)" accessibilityLabel="Driver name" />
                  <TextInput style={s.input} value={phone} onChangeText={setPhone} keyboardType="phone-pad" placeholder="Driver's mobile number (optional)" accessibilityLabel="Driver mobile number" />
                  <Soft>The bill</Soft>
                  <Chips<Kind> items={(Object.keys(KIND_LABEL) as Kind[]).map((k) => ({ id: k, label: KIND_LABEL[k] }))} value={kind} onChange={setKind} />
                  {kind === 'CASH' ? <Chips items={METHODS} value={method} onChange={setMethod} /> : null}
                  {kind === 'CASH' && method !== 'CASH' ? <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Payment reference" accessibilityLabel="Payment reference" /> : null}
                  <Button title="Send it out" onPress={() => { void sendOut(); }} busy={busy === 'dispatch'} />
                </>
              ) : null}

              {l.status === 'DISPATCHED' ? <Soft>This pick list has been sent out. Follow the delivery under Warehouse, On the road.</Soft> : null}
              {l.status !== 'DISPATCHED' && l.status !== 'CANCELLED' ? <Button title="Cancel pick list" kind="quiet" onPress={cancel} /> : null}
            </View>
          </ScrollView>
        ) : null}
      </Page>
    </SafeAreaView>
  );
}
