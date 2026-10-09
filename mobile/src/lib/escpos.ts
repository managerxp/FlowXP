/*
 * What a thermal receipt printer understands: ESC/POS. A bill's text is turned into the bytes such a printer takes over Bluetooth, made on the phone from the
 * same text the screen shows, so printing needs no connection. (The server can also make these, GET /invoices/:id/escpos, for the website's print agent.)
 *
 * Thermal printers print a code page, not Unicode: the rupee sign and accents are not in the basic set, so they are swapped for what can be printed ("Rs.", plain
 * letters) rather than coming out as rubbish.
 */
import type { Paper } from './print.ts';

const ESC = 0x1b; const GS = 0x1d; const LF = 0x0a;

/** Characters per line the receipt text is laid out for. */
export const COLUMNS: Record<Paper, number> = { '58': 32, '80': 48 };

const SWAPS: [RegExp, string][] = [[/₹/g, 'Rs.'], [/[–—]/g, '-'], [/[‘’]/g, "'"], [/[“”]/g, '"'], [/…/g, '...'], [/[·•]/g, '-'], [/×/g, 'x']];
const PLAIN = /[̀-ͯ]/g;

/** Printable text for a thermal printer: letters stay letters (accents dropped), symbols become words, anything else becomes "?". */
export const printable = (text: string): string => {
  let out = text;
  for (const [from, to] of SWAPS) out = out.replace(from, to);
  out = out.normalize('NFD').replace(PLAIN, '');
  return out.replace(/[^\x20-\x7e\n\r\t]/g, '?').replace(/\r/g, '');
};

/** A line longer than the paper is cut at a space where it can be, rather than letting the printer wrap mid-word. */
export const fitLine = (line: string, columns: number): string[] => {
  if (line.length <= columns) return [line];
  const out: string[] = [];
  let rest = line;
  while (rest.length > columns) {
    const cut = rest.lastIndexOf(' ', columns);
    const at = cut > columns / 2 ? cut : columns;
    out.push(rest.slice(0, at).trimEnd());
    rest = rest.slice(at).trimStart();
  }
  if (rest) out.push(rest);
  return out;
};

/** The printer's own QR command (GS ( k): model 2, a module size to suit the paper, medium error correction, the text, then print. Centred. */
export const qrBytes = (data: string, paper: Paper): number[] => {
  const body = [...printable(data)].map((c) => c.charCodeAt(0));
  const n = body.length + 3;
  return [
    ESC, 0x61, 0x01,                                              // centre
    GS, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00,           // model 2
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, paper === '80' ? 7 : 6, // module size
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31,                 // error correction M
    GS, 0x28, 0x6b, n & 0xff, n >> 8, 0x31, 0x50, 0x30, ...body,   // store the data
    GS, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30,                 // print it
    LF, ESC, 0x61, 0x00                                           // back to left
  ];
};

/** Initialise, the lines, an optional QR code, a few blank lines to feed the paper past the tear bar, and a partial cut. `drawer` also opens a cash drawer wired to the printer. */
export const escposBytes = (text: string, paper: Paper, { cut = true, drawer = false, qr }: { cut?: boolean; drawer?: boolean; qr?: string } = {}): Uint8Array => {
  const bytes: number[] = [ESC, 0x40];                 // initialise
  if (drawer) bytes.push(ESC, 0x70, 0x00, 0x19, 0xfa);   // pulse pin 2
  for (const raw of printable(text).split('\n')) {
    for (const line of fitLine(raw, COLUMNS[paper])) { for (const ch of line) bytes.push(ch.charCodeAt(0)); bytes.push(LF); }
  }
  if (qr) bytes.push(LF, ...qrBytes(qr, paper));
  bytes.push(LF, LF, LF);
  if (cut) bytes.push(GS, 0x56, 0x01);                 // partial cut (printers without a cutter ignore it)
  return Uint8Array.from(bytes);
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
/** Base64 of some bytes, written by hand because the phone's JavaScript has no Buffer. */
export const toBase64 = (bytes: Uint8Array): string => {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i]; const b = bytes[i + 1]; const c = bytes[i + 2];
    out += B64[a >> 2] + B64[((a & 3) << 4) | ((b ?? 0) >> 4)] + (b === undefined ? '=' : B64[((b & 15) << 2) | ((c ?? 0) >> 6)]) + (c === undefined ? '=' : B64[c & 63]);
  }
  return out;
};
