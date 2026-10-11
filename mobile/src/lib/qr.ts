import QRCode from 'qrcode';

/* A QR code as a grid of dark and light squares, and as a picture the phone's print screen can draw. */

/** true = dark square. */
export const qrMatrix = (text: string): boolean[][] => {
  const { size, data } = QRCode.create(text, { errorCorrectionLevel: 'M' }).modules;
  const rows: boolean[][] = [];
  for (let y = 0; y < size; y++) rows.push(Array.from({ length: size }, (_, x) => data[y * size + x] === 1));
  return rows;
};

/** An SVG of the code, `px` wide, with the quiet border scanners need. */
export const qrSvg = (text: string, px: number): string => {
  const m = qrMatrix(text); const n = m.length; const quiet = 2;
  const path = m.flatMap((row, y) => row.map((dark, x) => (dark ? `M${x + quiet} ${y + quiet}h1v1h-1z` : ''))).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n + quiet * 2} ${n + quiet * 2}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
};
