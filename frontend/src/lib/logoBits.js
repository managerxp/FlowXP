/* A logo as black and white dots, for thermal receipt printers. The browser draws the uploaded picture small and this turns it into the shape the server stores:
   { w, h, data } where data is base64 of h rows of w/8 bytes, the left dot in the top bit, 1 = black (see validLogoBits in backend/src/modules/escpos.js). */
export const MAX_W = 384; export const MAX_H = 200;

/** Pure: RGBA pixels (as from canvas getImageData) to the packed dots. Transparent counts as white; darker than the middle grey counts as black. */
export const bitsFromRgba = (rgba, w, h) => {
  const wb = Math.ceil(w / 8); const out = new Uint8Array(wb * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    const alpha = rgba[i + 3] / 255;
    const grey = (0.299 * rgba[i] + 0.587 * rgba[i + 1] + 0.114 * rgba[i + 2]) * alpha + 255 * (1 - alpha);
    if (grey < 140) out[y * wb + (x >> 3)] |= 0x80 >> (x & 7);
  }
  let bin = ''; for (const b of out) bin += String.fromCharCode(b);
  return { w: wb * 8, h, data: btoa(bin) };
};

/** The size to draw a picture at: as wide as fits, keeping its shape, a multiple of 8 dots wide. */
export const dotSize = (width, height) => {
  const scale = Math.min(MAX_W / width, MAX_H / height, 1);
  return { w: Math.max(8, Math.floor((width * scale) / 8) * 8), h: Math.max(1, Math.round(height * scale)) };
};

/** In the browser: a picture file to dots. */
export const fileToBits = async (file) => {
  const bitmap = await createImageBitmap(file);
  const { w, h } = dotSize(bitmap.width, bitmap.height);
  const canvas = document.createElement('canvas'); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, w, h); ctx.drawImage(bitmap, 0, 0, w, h);
  return bitsFromRgba(ctx.getImageData(0, 0, w, h).data, w, h);
};
