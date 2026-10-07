/*
 * Printing a receipt. The phone hands the receipt to Android's own print system (expo-print), which prints to any printer the phone can
 * see: a Wi-Fi or USB receipt printer, or a Bluetooth one through its maker's print-service app. That needs no native Bluetooth code in
 * FlowXP and works with most printers a shop already owns.
 *
 * A one-tap Bluetooth printer (ESC/POS bytes straight to the printer, no dialog) is the next step: the server already makes those bytes
 * (GET /invoices/:id/escpos). It needs a native library and a real printer to test, so it plugs in behind the same `Printer` shape later.
 */
export type Paper = '58' | '80';
export type Printer = { print: (text: string, paper: Paper) => Promise<void> };

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* The receipt is 32 characters wide. A monospace character is about 0.6 of the font size, so the size is chosen to make 32 of them fill the
   paper: 58 mm is about 164 px wide at 72 PPI, 80 mm about 227 px. */
const WIDTH_PX: Record<Paper, number> = { '58': 164, '80': 227 };
const FONT_PX: Record<Paper, number> = { '58': 8.4, '80': 11.6 };

export const receiptHtml = (text: string, paper: Paper): { html: string; width: number } => ({
  width: WIDTH_PX[paper],
  html: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
    @page { margin: 0 } body { margin: 0; padding: 4px 0; width: ${WIDTH_PX[paper]}px }
    pre { margin: 0; font-family: monospace; font-size: ${FONT_PX[paper]}px; line-height: 1.25; white-space: pre; color: #000 }
  </style></head><body><pre>${esc(text)}</pre></body></html>`
});

export const printReceipt = async (text: string, paper: Paper) => {
  const Print = await import('expo-print');
  const { html, width } = receiptHtml(text, paper);
  await Print.printAsync({ html, width });
};
