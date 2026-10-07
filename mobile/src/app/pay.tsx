import { useState } from 'react';
import { ScrollView, Text, TextInput, View } from 'react-native';
import { router } from 'expo-router';
import QRCode from 'react-native-qrcode-svg';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ApiError } from '../lib/api.ts';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { useScope } from '../lib/local.ts';
import { refreshCounts, syncAll } from '../lib/sync.ts';
import { takeSale } from '../lib/till.ts';
import { clearSale, keyForSale, useSale } from '../lib/sale.ts';
import { KITCHEN_TYPES, totals, upiLink } from '../lib/cart.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

type Method = 'CASH' | 'UPI' | 'CARD';
const METHODS: { id: Method; label: string }[] = [{ id: 'CASH', label: 'Cash' }, { id: 'UPI', label: 'UPI' }, { id: 'CARD', label: 'Card' }];

export default function Pay() {
  const session = useSession();
  const business = currentBusiness(session);
  const scope = useScope();
  const { cart, kitchen, offers } = useSale();
  const sum = totals(cart, offers.byKey);
  const toKitchen = kitchen && KITCHEN_TYPES.includes(business?.business_type ?? '');
  const [method, setMethod] = useState<Method>('CASH');
  const [given, setGiven] = useState('');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const change = method === 'CASH' && given ? toPaise(given) - sum.totalPaise : 0;

  const confirm = async () => {
    if (!scope) return;
    setBusy(true); setError('');
    try {
      // the same key for every attempt at THIS sale: if the first one reached the server before the signal dropped, a retry returns that invoice.
      // With no signal the sale is kept on the phone and sent later, with that same key.
      const taken = await takeSale({ api, outbox: scope.outbox, cart, method, reference: reference.trim() || undefined, key: keyForSale(), kitchen: toKitchen });
      if (taken.kind === 'full') { setError('Too many sales are waiting on this phone. Connect to the internet so they can be sent, then bill again.'); return; }
      clearSale();
      if (taken.kind === 'queued') {
        await refreshCounts(); void syncAll();
        router.replace({ pathname: '/receipt', params: { local: taken.entry.id, change: change > 0 ? String(change) : '' } });
      } else {
        router.replace({ pathname: '/receipt', params: { id: String(taken.invoiceId), change: change > 0 ? String(change) : '' } });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not make the bill. Nothing was billed twice: tap again.');
    } finally { setBusy(false); }
  };

  const vpa = business?.upi_vpa;
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 14 }} keyboardShouldPersistTaps="handled">
        <Title>{rupees(sum.totalPaise)}</Title>
        <Soft>About, with GST. {cart.lines.length} lines. The final bill comes from FlowXP.</Soft>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {METHODS.map((m) => (
            <Button key={m.id} title={m.label} kind={method === m.id ? 'primary' : 'quiet'} onPress={() => setMethod(m.id)} style={{ flex: 1 }} />
          ))}
        </View>

        {method === 'CASH' ? (
          <View style={{ gap: 8 }}>
            <Soft>Cash received (optional)</Soft>
            <TextInput style={s.input} value={given} onChangeText={setGiven} keyboardType="decimal-pad" placeholder={rupees(sum.totalPaise)} accessibilityLabel="Cash received" />
            {change > 0 ? <Text style={{ fontSize: 18, fontWeight: '700', color: color.ok }}>Give back {rupees(change)}</Text> : null}
            {given && change < 0 ? <Text style={{ color: color.danger }}>Short by {rupees(-change)}</Text> : null}
          </View>
        ) : null}

        {method === 'UPI' ? (
          <View style={[s.card, { alignItems: 'center', gap: 10 }]}>
            {vpa ? (
              <>
                <QRCode value={upiLink(vpa, business?.name || 'FlowXP', sum.totalPaise, 'Bill')} size={220} />
                <Soft>{vpa}</Soft>
                <Soft>Ask the customer to scan, then confirm the money has arrived.</Soft>
              </>
            ) : <Soft>This business has no UPI ID set up. Add one in FlowXP settings, or take the payment another way.</Soft>}
            <TextInput style={[s.input, { alignSelf: 'stretch' }]} value={reference} onChangeText={setReference} placeholder="UPI reference (optional)" accessibilityLabel="UPI reference" />
          </View>
        ) : null}

        {method === 'CARD' ? (
          <View style={{ gap: 8 }}>
            <Soft>Take the card on your machine, then record it here. FlowXP is not connected to the machine.</Soft>
            <TextInput style={s.input} value={reference} onChangeText={setReference} placeholder="Slip or approval number (optional)" accessibilityLabel="Card reference" />
          </View>
        ) : null}

        <ErrorText>{error}</ErrorText>
        <Button title={method === 'CASH' ? 'Cash received, make the bill' : method === 'UPI' ? 'Money received, make the bill' : 'Card paid, make the bill'} onPress={confirm} busy={busy} disabled={!cart.lines.length} />
        <Button title="Back to the bill" kind="quiet" onPress={() => router.back()} disabled={busy} />
      </ScrollView>
    </SafeAreaView>
  );
}
