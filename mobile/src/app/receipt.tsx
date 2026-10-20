import { useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, Share, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { kvGet, useScope } from '../lib/local.ts';
import { printReceipt, type Paper } from '../lib/print.ts';
import { canEway } from '../lib/ewayBill.ts';
import { billSentText, canSendBill, type BillSent } from '../lib/messaging.ts';
import { printTaxInvoice, shareBillOnWhatsApp, shareReceiptPdf, shareTaxInvoicePdf } from '../lib/share.ts';
import { usesTaxInvoice, type TaxInvoice } from '../lib/taxInvoice.ts';
import { COLUMNS } from '../lib/escpos.ts';
import { t } from '../lib/i18n.ts';
import { useSyncState } from '../lib/sync.ts';
import { pendingReceiptText, receiptText, type Invoice } from '../lib/receipt.ts';
import type { Entry } from '../lib/outbox.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { upiPayLink } from '../lib/upiBill.ts';
import { Page } from '../lib/responsive.tsx';
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
  const [invoice, setInvoice] = useState<(Invoice & Pick<TaxInvoice, 'invoice_print'>) | null>(null);
  const [error, setError] = useState('');
  const [printError, setPrintError] = useState('');
  const [shareError, setShareError] = useState('');
  const [sentNote, setSentNote] = useState('');
  const [sending, setSending] = useState(false);
  const [paper, setPaper] = useState<Paper>('58');
  useEffect(() => { void kvGet('paper').then((p) => setPaper(p === '80' ? '80' : '58')); }, []);

  // a queued sale: read it from the phone; once it has been sent it has an invoice, and we show that instead
  useEffect(() => {
    if (!local || !scope) return;
    void scope.outbox.get(local).then((e) => { setPending(e); if (e?.invoice_id) setInvoiceId(String(e.invoice_id)); });
  }, [local, scope, sync.pending, sync.failed, sync.busy]);

  const load = () => { if (!invoiceId) return; setError(''); api.get<Invoice & Pick<TaxInvoice, 'invoice_print'>>(`/invoices/${invoiceId}`).then(setInvoice).catch((e: Error) => setError(e.message)); };
  useEffect(load, [invoiceId]);   // eslint-disable-line react-hooks/exhaustive-deps

  const name = business?.name || 'FlowXP';
  // a bill with money still owed carries a UPI QR code for exactly that amount, so the customer can settle it by scanning the paper
  const owed = invoice && invoice.balance_due > 0 ? toPaise(invoice.balance_due) : 0;
  const text = invoice ? receiptText(invoice, name, COLUMNS[paper]) : pending ? pendingReceiptText(pending, name, COLUMNS[paper]) : '';
  const waiting = !invoice && pending && pending.state !== 'sent';
  return (
    <SafeAreaView style={s.screen}>
      <Page max={560}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 4, paddingVertical: 8 }}>
          <Ionicons name={waiting ? 'cloud-offline-outline' : 'checkmark-circle'} size={56} color={waiting ? color.warn : color.ok} />
          <Title>{waiting ? 'Bill saved on this phone' : 'Payment received'}</Title>
          {invoice ? <Text style={{ fontSize: 32, fontWeight: '800', color: color.ink }}>{rupees(Math.round(invoice.total * 100))}</Text> : null}
        </View>
        {invoice?.order_number ? (
          <View style={[s.card, { alignItems: 'center' }]}>
            <Soft>Token to call out</Soft>
            <Text accessibilityRole="header" style={{ fontSize: 40, fontWeight: '800', color: color.ink }}>{invoice.order_number}</Text>
          </View>
        ) : null}
        {invoice ? <Soft style={{ textAlign: 'center' }}>{`Bill ${invoice.invoice_number}`}</Soft> : null}
        {waiting ? <Soft>{pending.state === 'failed' ? 'FlowXP could not accept this bill. Open Bills, then Waiting to send, to see why.' : 'No internet right now. It will be sent by itself, and gets its real bill number then. You do not need to do anything.'}</Soft> : null}
        {change ? <Text style={{ fontSize: 20, fontWeight: '700', color: color.ok }}>Give back {rupees(Number(change))}</Text> : null}
        {!invoice && !pending && !error ? <ActivityIndicator /> : null}
        <ErrorText>{error}</ErrorText>
        {error ? <Button title="Try again" kind="quiet" onPress={load} /> : null}
        {text ? <View style={[s.card]}><Text selectable style={{ fontFamily: 'monospace', fontSize: 13, color: color.ink }}>{text}</Text></View> : null}
        <Button title={invoice?.table_name ? 'Back to the tables' : 'Next customer: new bill'} onPress={() => router.replace(invoice?.table_name ? '/tables' : '/sell')} />
        {text ? <Button title="Print the bill" kind="quiet" onPress={() => { setPrintError(''); void kvGet('paper').then((p) => printReceipt(text, p === '80' ? '80' : '58', owed && business?.upi_vpa ? { qr: upiPayLink(business.upi_vpa, business.name, owed) } : {})).then((how) => { if (how === 'fallback') setPrintError(t("Could not reach the printer, so the bill went to the phone's print screen instead.")); }).catch((e: Error) => setPrintError(e.message)); }} /> : null}
        <ErrorText>{printError}</ErrorText>
        {text ? <Button title="Send the bill" kind="quiet" onPress={() => { void Share.share({ message: text }); }} /> : null}
        {invoice && canSendBill(invoice.customer_phone) ? <Button title="Send the bill from FlowXP" onPress={() => { setShareError(''); setSentNote(''); setSending(true); api.post<BillSent>('/messaging/send-bill', { invoice_id: invoice.invoice_id }).then((m) => setSentNote(billSentText(m))).catch((e: Error) => setShareError(e.message)).finally(() => setSending(false)); }} busy={sending} /> : null}
        {sentNote ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{sentNote}</Text> : null}
        {invoice && canEway(business?.role, Boolean(invoice.customer_gstin)) ? <Button title={invoice.eway_bill_no ? t('E-way bill {number}', { number: invoice.eway_bill_no }) : 'E-way bill'} kind="quiet" onPress={() => router.push({ pathname: '/eway-bill', params: { id: String(invoice.invoice_id) } })} /> : null}
        {invoice ? <Button title="Send on WhatsApp (with link)" kind="quiet" onPress={() => { setShareError(''); shareBillOnWhatsApp(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} /> : null}
        {text ? <Button title="Share as PDF" kind="quiet" onPress={() => { setShareError(''); shareReceiptPdf(text, paper).catch((e: Error) => setShareError(e.message)); }} /> : null}
        {invoice && usesTaxInvoice(invoice, business?.business_type) ? (
          <>
            <Button title="Share tax invoice (PDF)" kind="quiet" onPress={() => { setShareError(''); shareTaxInvoicePdf(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} />
            <Button title="Print tax invoice" kind="quiet" onPress={() => { setShareError(''); printTaxInvoice(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} />
            <Button title="Edit invoice details" kind="quiet" onPress={() => router.push({ pathname: '/invoice-details', params: { id: String(invoice.invoice_id) } })} />
          </>
        ) : null}
        <ErrorText>{shareError}</ErrorText>
        {invoice ? <Button title="Return items" kind="quiet" onPress={() => router.push(['WHOLESALE', 'DISTRIBUTOR'].includes(business?.business_type ?? '') ? { pathname: '/return-sale', params: { invoice: String(invoiceId) } } : { pathname: '/return', params: { id: String(invoiceId) } })} /> : null}
      </ScrollView>
      </Page>
    </SafeAreaView>
  );
}
