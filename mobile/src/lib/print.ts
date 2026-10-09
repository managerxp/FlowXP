/*
 * Printing a receipt. The phone hands the receipt to Android's own print system (expo-print), which prints to any printer the phone can
 * see: a Wi-Fi or USB receipt printer, or a Bluetooth one through its maker's print-service app. That needs no native Bluetooth code in
 * FlowXP and works with most printers a shop already owns.
 *
 * A thermal printer chosen in Settings is printed to with no dialog: the receipt is made as ESC/POS bytes on the phone (escpos.ts) and handed to the RawBT app, which holds the
 * Bluetooth connection (thermal.ts). If that cannot be done the bill goes to the phone's print screen instead, so a sale is never stuck.
 */
import { qrSvg } from './qr.ts';

export type Paper = '58' | '80';
export type Printer = { print: (text: string, paper: Paper) => Promise<void> };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* The receipt is 32 characters wide. A monospace character is about 0.6 of the font size, so the size is chosen to make 32 of them fill the
   paper: 58 mm is about 164 px wide at 72 PPI, 80 mm about 227 px. */
const WIDTH_PX: Record<Paper, number> = { '58': 164, '80': 227 };
const FONT_PX: Record<Paper, number> = { '58': 8.4, '80': 11.6 };

export const receiptHtml = (text: string, paper: Paper, qr?: string): { html: string; width: number } => ({
  width: WIDTH_PX[paper],
  html: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
    @page { margin: 0 } body { margin: 0; padding: 4px 0; width: ${WIDTH_PX[paper]}px }
    pre { margin: 0; font-family: monospace; font-size: ${FONT_PX[paper]}px; line-height: 1.25; white-space: pre; color: #000 }
  </style></head><body><pre>${esc(text)}</pre>${qr ? `<div style="text-align:center;padding:6px 0">${qrSvg(qr, WIDTH_PX[paper] - 24)}</div>` : ''}</body></html>`
});

/** What happened: 'printer' = handed to the thermal printer (through RawBT); 'screen' = the phone's print screen; 'fallback' = the thermal printer could not be used, so the print screen was used instead. */
export type Printed = 'printer' | 'screen' | 'fallback';

/** `qr` is a payment link (a UPI one for the amount due): it is printed as a QR code at the foot of the receipt, by the printer's own QR command or as a picture on the print screen. */
export const printReceipt = async (text: string, paper: Paper, options: { drawer?: boolean; qr?: string } = {}): Promise<Printed> => {
  const thermal = await import('./thermal.ts');
  let tried = false;
  if ((await thermal.readMode()) === 'rawbt') {
    tried = true;
    try { await thermal.printViaRawBT(text, paper, options); return 'printer'; } catch { /* fall through to the print screen */ }
  }
  const Print = await import('expo-print');
  const { html, width } = receiptHtml(text, paper, options.qr);
  await Print.printAsync({ html, width });
  return tried ? 'fallback' : 'screen';
};
