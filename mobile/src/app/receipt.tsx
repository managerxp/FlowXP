import { SvgXml } from 'react-native-svg';
import { display } from '../lib/theme.ts';
import { qrSvg } from '../lib/qr.ts';
import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, ScrollView, Share, Text, View } from 'react-native';
import { Ionicons } from '../lib/icons.tsx';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { api, currentBusiness, useSession } from '../lib/session.ts';
import { newKey } from '../lib/api.ts';
import { kvGet, useScope } from '../lib/local.ts';
import { printReceipt, type Paper } from '../lib/print.ts';
import { canEway } from '../lib/ewayBill.ts';
import { billSentText, canSendBill, type BillSent } from '../lib/messaging.ts';
import { printTaxInvoice, shareBillOnWhatsApp, shareReceiptPdf, shareTaxInvoicePdf } from '../lib/share.ts';
import { usesTaxInvoice, type TaxInvoice } from '../lib/taxInvoice.ts';
import { COLUMNS } from '../lib/escpos.ts';
import { t } from '../lib/i18n.ts';
import { useSyncState } from '../lib/sync.ts';
import { pendingReceiptText, receiptText, tokenText, type Invoice } from '../lib/receipt.ts';
import type { Entry } from '../lib/outbox.ts';
import { rupees, toPaise } from '../lib/money.ts';
import { upiPayLink } from '../lib/upiBill.ts';
import { Page } from '../lib/responsive.tsx';
import { Button, ErrorText, Soft, Title, color, s } from '../lib/ui.tsx';

/* The bill as FlowXP made it (its number, GST and round-off), or, for a sale still waiting to be sent, the provisional receipt, plainly
   marked. When a waiting sale is sent, this screen switches to the real bill by itself. */
export default function Receipt() {
  const { id, local, change, fresh } = useLocalSearchParams<{ id?: string; local?: string; change?: string; fresh?: string }>();
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
  const [paperReady, setPaperReady] = useState(false);
  // the printer is connected and the logo fetched while the bill is on screen, so Print starts at once
  useEffect(() => { void (async () => { if ((await (await import('../lib/thermal.ts')).readMode()) !== 'direct') return; void (await import('../lib/printLogo.ts')).printLogo(api).catch(() => {}); await (await import('../lib/printerLink.ts')).warmPrinter(); })().catch(() => {}); }, []);
  useEffect(() => { void kvGet('paper').then((p) => { setPaper(p === '80' ? '80' : '58'); setPaperReady(true); }); }, []);

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
  // a bill with nothing owed carries the loyalty QR instead (scan it for the stamp), when the card has that switched on
  const qrLink = owed && business?.upi_vpa && invoice?.receipt?.show_upi_qr !== false ? upiPayLink(business.upi_vpa, business.name, owed) : invoice && !owed && invoice.loyalty_claim_url ? invoice.loyalty_claim_url : undefined;
  const half = { flexGrow: 1, flexBasis: '45%' as const };   // the other choices sit two to a row, each the same size
  const token = invoice ? tokenText(invoice, name) : null;   // the daily token slip, printed after the bill
  const text = invoice ? receiptText(invoice, name, COLUMNS[paper]) : pending ? pendingReceiptText(pending, name, COLUMNS[paper], session.user?.name) : '';
  const waiting = !invoice && pending && pending.state !== 'sent';
  // A sale just charged prints by itself when a thermal printer is saved on this phone: no button, no phone print screen. "Receipt printed" and OK is all the till sees.
  const [printedNote, setPrintedNote] = useState(false);
  const payKey = useRef(newKey());   // one key for this payment: a double tap records it once
  const [confirming, setConfirming] = useState(false);
  const confirmUpi = () => {
    if (!invoice) return;
    Alert.alert(t('Payment received?'), t('Check that the money has reached your UPI app before you confirm.'), [
      { text: t('Not yet'), style: 'cancel' },
      { text: t('Yes, received'), onPress: () => {
        setShareError(''); setConfirming(true);
        api.post(`/invoices/${invoice.invoice_id}/payments`, { amount: invoice.balance_due, method: 'UPI' }, { idempotencyKey: payKey.current })
          .then(() => { payKey.current = newKey(); load(); }).catch((e: Error) => setShareError(e.message)).finally(() => setConfirming(false));
      } }
    ]);
  };
  const auto = useRef(false);
  useEffect(() => {
    if (!fresh || !paperReady || !text || auto.current || (!invoice && !pending)) return;
    auto.current = true;
    void (async () => {
      const mode = await (await import('../lib/thermal.ts')).readMode();
      if (mode === 'system') return;   // no thermal printer set up: the Print button is still there
      try { await printReceipt(text, paper, { noDialog: true, ...(qrLink ? { qr: qrLink } : {}) }); if (token) await printReceipt(token, paper, { noDialog: true, big: true }); setPrintedNote(true); }
      catch { setPrintError(t('Could not reach the printer. Tap Print the bill to try again.')); }
    })();
  }, [fresh, paperReady, text, invoice, pending]);   // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <SafeAreaView style={s.screen}>
      <Page max={560}>
      <ScrollView contentContainerStyle={{ padding: 16, gap: 12 }}>
        <View accessibilityLiveRegion="polite" style={{ alignItems: 'center', gap: 4, paddingVertical: 8 }}>
          <View style={{ width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', backgroundColor: waiting ? color.warnBg : color.okBg, marginBottom: 6 }}><Ionicons name={waiting ? 'cloud-offline-outline' : 'checkmark'} size={44} color={waiting ? color.warn : color.ok} /></View>
          <Title>{waiting ? 'Bill saved on this phone' : 'Payment received'}</Title>
          {invoice ? <Text selectable style={{ fontSize: 38, fontFamily: display.bold, letterSpacing: -1, color: color.ink, fontVariant: ['tabular-nums'] }}>{rupees(Math.round(invoice.total * 100))}</Text> : null}
        </View>
        {invoice?.order_number ? (
          <View style={[s.card, { alignItems: 'center' }]}>
            <Soft>Token to call out</Soft>
            <Text accessibilityRole="header" style={{ fontSize: 40, fontFamily: display.bold, fontVariant: ['tabular-nums'], color: color.ink }}>{invoice.order_number}</Text>
          </View>
        ) : null}
        {invoice ? <Soft style={{ textAlign: 'center' }}>{`Bill ${invoice.invoice_number}`}</Soft> : null}
        {waiting ? <Soft>{pending.state === 'failed' ? 'FlowXP could not accept this bill. Open Bills, then Waiting to send, to see why.' : 'No internet right now. It will be sent by itself, and gets its real bill number then. You do not need to do anything.'}</Soft> : null}
        {change ? <Text style={{ fontSize: 20, fontWeight: '700', color: color.ok }}>Give back {rupees(Number(change))}</Text> : null}
        {!invoice && !pending && !error ? <ActivityIndicator /> : null}
        <ErrorText>{error}</ErrorText>
        {error ? <Button title="Try again" kind="quiet" onPress={load} /> : null}
        {invoice && owed && business?.upi_vpa && invoice.status !== 'CANCELLED' ? (
          <View style={[s.card, { gap: 8 }]}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: color.ink }}>{t('To collect by UPI')}: {rupees(owed)}</Text>
            <Soft>{t('Send the link, wait for the money, then confirm it here. The customer can pay with any UPI app.')}</Soft>
            <Button title={t('Send payment link on WhatsApp')} onPress={() => { setShareError(''); shareBillOnWhatsApp(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} />
            <Button title={t('Payment received')} kind="quiet" busy={confirming} onPress={confirmUpi} />
          </View>
        ) : null}
        {invoice && !owed && invoice.loyalty_claim_url ? (
          <View style={[s.card, { alignItems: 'center', gap: 6 }]}>
            <SvgXml xml={qrSvg(invoice.loyalty_claim_url, 180)} width={180} height={180} />
            <Text style={{ color: color.ink, fontWeight: '600', textAlign: 'center' }}>{t('Customer: scan for your loyalty stamp')}</Text>
          </View>
        ) : null}
        {text ? <View style={[s.card, { alignItems: 'center' }]}><Text selectable style={{ fontFamily: 'monospace', fontSize: 12.5, color: color.ink }}>{text}</Text></View> : null}
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10 }}>
          {text ? <Button style={half} title="Send the bill" kind="quiet" onPress={() => { void Share.share({ message: text }); }} /> : null}
          {invoice && canSendBill(invoice.customer_phone) ? <Button style={half} title="Send the bill from FlowXP" onPress={() => { setShareError(''); setSentNote(''); setSending(true); api.post<BillSent>('/messaging/send-bill', { invoice_id: invoice.invoice_id }).then((m) => setSentNote(billSentText(m))).catch((e: Error) => setShareError(e.message)).finally(() => setSending(false)); }} busy={sending} /> : null}
          {text ? <Button style={half} title="Share as PDF" kind="quiet" onPress={() => { setShareError(''); shareReceiptPdf(text, paper).catch((e: Error) => setShareError(e.message)); }} /> : null}
          {invoice && canEway(business?.role, Boolean(invoice.customer_gstin)) ? <Button style={half} title={invoice.eway_bill_no ? t('E-way bill {number}', { number: invoice.eway_bill_no }) : 'E-way bill'} kind="quiet" onPress={() => router.push({ pathname: '/eway-bill', params: { id: String(invoice.invoice_id) } })} /> : null}
          {invoice && usesTaxInvoice(invoice, business?.business_type) ? (
          <>
            <Button style={half} title="Share tax invoice (PDF)" kind="quiet" onPress={() => { setShareError(''); shareTaxInvoicePdf(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} />
            <Button style={half} title="Print tax invoice" kind="quiet" onPress={() => { setShareError(''); printTaxInvoice(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} />
            <Button style={half} title="Edit invoice details" kind="quiet" onPress={() => router.push({ pathname: '/invoice-details', params: { id: String(invoice.invoice_id) } })} />
          </>
        ) : null}
          {invoice ? <Button style={half} title="Return items" kind="quiet" onPress={() => router.push(['WHOLESALE', 'DISTRIBUTOR'].includes(business?.business_type ?? '') ? { pathname: '/return-sale', params: { invoice: String(invoiceId) } } : { pathname: '/return', params: { id: String(invoiceId) } })} /> : null}
        </View>
        {sentNote ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok }}>{sentNote}</Text> : null}
      </ScrollView>
      <View style={{ padding: 16, paddingTop: 10, gap: 10, borderTopWidth: 1, borderColor: color.line, backgroundColor: color.card }}>
        {printedNote ? <Text accessibilityLiveRegion="polite" style={{ color: color.ok, fontWeight: '700', textAlign: 'center' }}>{t('Receipt printed')}</Text> : null}
        <ErrorText>{printError || shareError}</ErrorText>
        <View style={{ flexDirection: 'row', gap: 10 }}>
          {text ? <Button title="Print the bill" kind="quiet" style={{ flex: 1 }} onPress={() => { setPrintError(''); void kvGet('paper').then((p) => printReceipt(text, p === '80' ? '80' : '58', qrLink ? { qr: qrLink } : {})).then((how) => { if (how === 'fallback') setPrintError(t("Could not reach the printer, so the bill went to the phone's print screen instead.")); else if (token) return printReceipt(token, paper, { noDialog: true, big: true }).then(() => undefined); }).catch((e: Error) => setPrintError(e.message)); }} /> : null}
          {invoice ? <Button title="WhatsApp" kind="quiet" style={{ flex: 1 }} onPress={() => { setShareError(''); shareBillOnWhatsApp(api, invoice.invoice_id).catch((e: Error) => setShareError(e.message)); }} /> : null}
        </View>
        <Button title={printedNote ? t('OK') : invoice?.table_name ? 'Back to the tables' : 'Next customer: new bill'} onPress={() => router.replace(invoice?.table_name ? '/tables' : '/sell')} />
      </View>
      </Page>
    </SafeAreaView>
  );
}
