/*
 * Code 128 (subset B) barcodes as SVG — printable shelf and carton labels without a library. Handles any printable
 * ASCII text (SKUs, EAN digits as text). Scanners read Code 128 everywhere; an EAN-13 on the product itself is
 * printed as its digits in Code 128 too, which every scanner decodes to the same number.
 */
const PATTERNS = [
  '212222', '222122', '222221', '121223', '121322', '131222', '122213', '122312', '132212', '221213', '221312', '231212', '112232', '122132', '122231', '113222', '123122', '123221', '223211', '221132',
  '221231', '213212', '223112', '312131', '311222', '321122', '321221', '312212', '322112', '322211', '212123', '212321', '232121', '111323', '131123', '131321', '112313', '132113', '132311', '211313',
  '231113', '231311', '112133', '112331', '132131', '113123', '113321', '133121', '313121', '211331', '231131', '213113', '213311', '213131', '311123', '311321', '331121', '312113', '312311', '332111',
  '314111', '221411', '431111', '111224', '111422', '121124', '121421', '141122', '141221', '112214', '112412', '122114', '122411', '142112', '142211', '241211', '221114', '413111', '241112', '134111',
  '111242', '121142', '121241', '114212', '124112', '124211', '411212', '421112', '421211', '212141', '214121', '412121', '111143', '111341', '131141', '114113', '114311', '411113', '411311', '113141',
  '114131', '311141', '411131', '211412', '211214', '211232', '2331112'
];
const START_B = 104; const STOP = 106;

/** The bar/space widths (in modules) for `text`, as a string of digits starting with a bar. */
export const code128 = (text) => {
  const chars = [...String(text)].filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 126);
  const codes = [START_B, ...chars.map((c) => c.charCodeAt(0) - 32)];
  const checksum = codes.reduce((s, c, i) => s + c * (i === 0 ? 1 : i), 0) % 103;
  return [...codes, checksum, STOP].map((c) => PATTERNS[c]).join('');
};

/** An <svg> string: `module` px per narrow bar, `height` px tall, with quiet zones. */
export const barcodeSvg = (text, { module = 1.6, height = 44 } = {}) => {
  const widths = code128(text).split('').map(Number);
  const quiet = 10 * module;
  let x = quiet; let bars = '';
  widths.forEach((w, i) => { if (i % 2 === 0) bars += `<rect x="${x}" y="0" width="${w * module}" height="${height}"/>`; x += w * module; });
  const total = x + quiet;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${total} ${height}" width="${total}" height="${height}" fill="#000" role="img" aria-label="Barcode ${String(text).replace(/[<>&"]/g, '')}">${bars}</svg>`;
};
