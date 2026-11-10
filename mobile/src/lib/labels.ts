/*
 * Price labels with a barcode, for any product: a Code 128 barcode (the product's own barcode, or its item code), the name and the price. Made as a small web page that the
 * phone prints (expo-print) or shares as a PDF. Two sizes: an A4 sheet, 3 across, or a 50 x 25 mm label roll. The barcode drawing is the same one the website uses.
 */
import type { Product } from './catalog.ts';

const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];

/** The bar and space widths (in modules) of `text` in Code 128 subset B, as digits starting with a bar. */
export const code128 = (text: string): string => {
  const chars = [...String(text)].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  const codes = [104, ...chars.map((c) => c.charCodeAt(0) - 32)];
  const checksum = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, checksum, 106].map((c) => PATTERNS[c]).join('');
};

export const barcodeSvg = (text: string, height = 36, module = 1.6): string => {
  const widths = code128(text).split('').map(Number);
  const quiet = 10 * module; let x = quiet; let bars = '';
  widths.forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w * module}" height="${height}"/>`; x += w * module; });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" style="width:100%;max-width:100%;height:${height}px" fill="#000">${bars}</svg>`;
};

export type LabelSize = 'sheet' | 'roll';
export type LabelLine = { product: Pick<Product, 'product_id' | 'name' | 'sku' | 'barcodes' | 'selling_price' | 'mrp'>; copies: number };

/** The code printed on a product's label: its own barcode first, else its item code; '' when it has neither (then it cannot get a label). */
export const codeOf = (p: Pick<Product, 'sku' | 'barcodes'>): string => p.barcodes?.[0] || p.sku || '';

export const MAX_COPIES = 200;
export const clampCopies = (n: number): number => (Number.isFinite(n) ? Math.max(0, Math.min(MAX_COPIES, Math.round(n))) : 0);
export const totalLabels = (lines: LabelLine[]): number => lines.reduce((s, l) => s + (codeOf(l.product) ? clampCopies(l.copies) : 0), 0);

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inr = (n: number) => `₹${(Math.round(n * 100) / 100).toLocaleString('en-IN', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/** The page to print or turn into a PDF: one label per copy, with the name, a barcode, its digits and the price (and the MRP struck through when it is higher). */
export const labelsHtml = (lines: LabelLine[], size: LabelSize, showMrp: boolean): { html: string; width: number; height?: number } => {
  const one = (p: LabelLine['product']) => {
    const code = codeOf(p);
    const mrp = showMrp && p.mrp != null && p.mrp > p.selling_price ? ` <s style="font-size:9px;font-weight:400;color:#555">${esc(inr(p.mrp))}</s>` : '';
    return `<div class="l"><div class="n">${esc(p.name)}</div>${barcodeSvg(code, 34)}<div class="c">${esc(code)}</div><div class="p">${esc(inr(p.selling_price))}${mrp}</div></div>`;
  };
  const labels = lines.flatMap((l) => (codeOf(l.product) ? Array.from({ length: clampCopies(l.copies) }, () => one(l.product)) : []));
  const page = size === 'roll' ? '50mm 25mm; margin: 1mm' : 'A4; margin: 10mm';
  const grid = size === 'roll' ? '1fr' : 'repeat(3, 1fr)';
  return {
    width: size === 'roll' ? 142 : 595,
    html: `<html><head><meta name="viewport" content="width=device-width, initial-scale=1"/><style>
      @page { size: ${page} } body { margin: 0; font-family: sans-serif; color: #000 }
      .g { display: grid; grid-template-columns: ${grid}; gap: 6px } .l { text-align: center; border: 1px solid #ccc; padding: 4px; break-inside: avoid; page-break-after: ${size === 'roll' ? 'always' : 'auto'} }
      .n { font-size: 11px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis } .c { font-size: 10px; letter-spacing: 1px } .p { font-size: 14px; font-weight: 700 }
    </style></head><body><div class="g">${labels.join('')}</div></body></html>`
  };
};
