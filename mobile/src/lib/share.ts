/*
 * Sharing a bill from the phone: as a PDF file (made from the same receipt text the screen shows, handed to the phone's share sheet so it can
 * go to WhatsApp, email or Drive), or as a WhatsApp message with the bill's public link and what is still due (the server writes the message,
 * POST /messaging/bill-share, and gives the wa.me address). Neither needs a printer or a WhatsApp Business account.
 */
import { Linking, Share } from 'react-native';
import { receiptHtml, type Paper } from './print.ts';
import type { Api } from './api.ts';
import type { BackupRequest } from './backup.ts';
import { taxInvoiceHtml, type TaxBusiness, type TaxInvoice } from './taxInvoice.ts';

/** The bill as a PDF in the share sheet. Throws a message a person can read when the phone cannot share files. */
export const shareReceiptPdf = async (text: string, paper: Paper, qr?: string): Promise<void> => {
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot share files from FlowXP.');
  const { html, width } = receiptHtml(text, paper, qr);
  const { uri } = await Print.printToFileAsync({ html, width });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: 'Share the bill', UTI: 'com.adobe.pdf' });
};

/** The GST tax invoice (Tally layout, A4 or A5 as the business chose) as a PDF in the share sheet, or on the phone's print screen. The business's name, e-mail and logo come from the server. */
export const taxInvoiceFor = async (api: Api, invoiceId: string | number): Promise<{ invoice: TaxInvoice; html: string; width: number }> => {
  const [invoice, business] = await Promise.all([api.get<TaxInvoice>(`/invoices/${invoiceId}`), api.get<TaxBusiness>('/businesses/current')]);
  return { invoice, ...taxInvoiceHtml(invoice, business) };
};
export const shareTaxInvoicePdf = async (api: Api, invoiceId: string | number): Promise<void> => {
  const Print = await import('expo-print');
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot share files from FlowXP.');
  const { invoice, html, width } = await taxInvoiceFor(api, invoiceId);
  const { uri } = await Print.printToFileAsync({ html, width, height: Math.round(width * 1.414) });
  await Sharing.shareAsync(uri, { mimeType: 'application/pdf', dialogTitle: `Tax invoice ${invoice.invoice_number}`, UTI: 'com.adobe.pdf' });
};
export const printTaxInvoice = async (api: Api, invoiceId: string | number): Promise<void> => {
  const Print = await import('expo-print');
  const { html } = await taxInvoiceFor(api, invoiceId);
  await Print.printAsync({ html });
};

/** Save the backup ZIP on the phone (its cache) and open the share sheet on it. Throws a message a person can read. */
export const shareBackupZip = (req: BackupRequest): Promise<void> => shareDownload(req, 'application/zip', 'public.zip-archive', 'Save the backup');

/** Download a file from the server into the phone's cache and open the share sheet on it (the backup ZIP, the activity log's CSV). */
export const shareDownload = async (req: BackupRequest, mimeType: string, uti: string, dialogTitle: string): Promise<void> => {
  const Files = await import('expo-file-system');
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot share files from FlowXP.');
  let file;
  try { file = await Files.File.downloadFileAsync(req.url, new Files.File(Files.Paths.cache, req.fileName), { headers: req.headers, idempotent: true }); }
  catch { throw new Error(mimeType === 'text/csv' ? 'Could not export. The phone needs a connection, and exporting needs permission.' : mimeType === 'application/json' ? 'Could not download. The phone needs a connection, and filing needs permission.' : 'Could not take the backup. Only the owner can, and the phone needs a connection.'); }
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle, UTI: uti });
};

type BillShare = { link: string; text: string; phone: string | null; wa_url: string };

/** WhatsApp, opened on the customer's number with the bill message and link ready; the share sheet with the same message if WhatsApp cannot be opened. */
export const shareBillOnWhatsApp = async (api: Api, invoiceId: string | number): Promise<void> => {
  const r = await api.post<BillShare>('/messaging/bill-share', { invoice_id: Number(invoiceId) });
  try { await Linking.openURL(r.wa_url); } catch { await Share.share({ message: r.text }); }
};

type BalanceShare = { text: string; wa_url: string };
/** WhatsApp opened on the customer's number with the payment reminder ready (the shop's own WhatsApp); the share sheet with the same words if it cannot be opened. */
export const remindOnWhatsApp = async (api: Api, customerId: number): Promise<void> => {
  const r = await api.post<BalanceShare>('/messaging/balance-share', { customer_id: customerId });
  try { await Linking.openURL(r.wa_url); } catch { await Share.share({ message: r.text }); }
};

/** Write some text to a file in the phone's cache and open the share sheet on it (the e-way bill's JSON). */
export const shareTextFile = async (fileName: string, content: string, mimeType: string, uti: string, dialogTitle: string): Promise<void> => {
  const Files = await import('expo-file-system');
  const Sharing = await import('expo-sharing');
  if (!(await Sharing.isAvailableAsync())) throw new Error('This phone cannot share files from FlowXP.');
  const file = new Files.File(Files.Paths.cache, fileName);
  file.create({ overwrite: true });
  file.write(content);
  await Sharing.shareAsync(file.uri, { mimeType, dialogTitle, UTI: uti });
};
