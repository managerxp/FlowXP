import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, Text, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { kvGet, useScope } from '../lib/local.ts';
import { printReceipt } from '../lib/print.ts';
import { useSyncState } from '../lib/sync.ts';
import { pendingReceiptText, receiptText, type Invoice } from '../lib/receipt.ts';
import type { Entry } from '../lib/outbox.ts';
import { rupees } from '../lib/money.ts';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* The bill as FlowXP made it (its number, GST and round-off), or, for a sale still waiting to be sent, the provisional receipt, plainly
   marked. When a waiting sale is sent, this screen switches to the real bill by itself. */
export default function Receipt() {
  const { id, local, change } = useLocalSearchParams<{ id?: string; local?: string; change?: string }>();
  const session = useSession();
  const scope = useScope();
  const sync = useSyncState();
  const business = currentBusiness(session);
  const [pending, setPending] = useState<Entry | null>(null);
  const [invoiceId, setInvoiceId] = useState<string | undefined>(id);
  const [invoice, setInvoice] = useState<Invoice | null>(null);
  const [error, setError] = useState('');
  const [printError, setPrintError] = useState('');

  // a queued sale: read it from the phone; once it has been sent it has an invoice, and we show that instead
  useEffect(() => {
    if (!local || !scope) return;
    void scope.outbox.get(local).then((e) => { setPending(e); if (e?.invoice_id) setInvoiceId(String(e.invoice_id)); });
  }, [local, scope, sync.pending, sync.failed, sync.busy]);

  const load = () => { if (!invoiceId) return; setError(''); api.get<Invoice>(`/invoices/${invoiceId}`).then(setInvoice).catch((e: Error) => setError(e.message)); };
  useEffect(load, [invoiceId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const name = business?.name || 'FlowXP';
  const text = invoice ? receiptText(invoice, name) : pending ? pendingReceiptText(pending, name) : '';
  const waiting = !invoice && pending && pending.state !== 'sent';
  return (
    <SafeAreaView style={s.screen}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <Title>{waiting ? 'Bill saved on this phone' : 'Bill made'}</Title>
        {invoice?.order_number ? (
          <View style={[s.card, { alignItems: 'center' }]}>
            <Soft>Token to call out</Soft>
            <Text accessibilityRole="header" style={{ fontSize: 40, fontWeight: '800', color: color.ink }}>{invoice.order_number}</Text>
          </View>
        ) : null}
        {invoice ? <Soft>{invoice.invoice_number} · {rupees(Math.round(invoice.total * 100))} paid</Soft> : null}
        {waiting ? <Soft>{pending.state === 'failed' ? 'FlowXP could not accept this bill. Open Bills, then Waiting to send, to see why.' : 'No internet right now. It will be sent by itself, and gets its real bill number then. You do not need to do anything.'}</Soft> : null}
        {change ? <Text style={{ fontSize: 20, fontWeight: '700', color: color.ok }}>Give back {rupees(Number(change))}</Text> : null}
        {!invoice && !pending && !error ? <ActivityIndicator /> : null}
        <ErrorText>{error}</ErrorText>
        {error ? <Button title="Try again" kind="quiet" onPress={load} /> : null}
        {text ? <View style={[s.card]}><Text selectable style={{ fontFamily: 'monospace', fontSize: 13, color: color.ink }}>{text}</Text></View> : null}
        <Button title={invoice?.table_name ? 'Back to the tables' : 'Next customer: new bill'} onPress={() => router.replace(invoice?.table_name ? '/tables' : '/sell')} />
        {text ? <Button title="Print the bill" kind="quiet" onPress={() => { setPrintError(''); void kvGet('paper').then((p) => printReceipt(text, p === '80' ? '80' : '58')).catch((e: Error) => setPrintError(e.message)); }} /> : null}
        <ErrorText>{printError}</ErrorText>
        {text ? <Button title="Share the bill" kind="quiet" onPress={() => { void Share.share({ message: text }); }} /> : null}
      </ScrollView>
    </SafeAreaView>
  );
}
