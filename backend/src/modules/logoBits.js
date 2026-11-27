/* The business logo as the black and white dots a thermal printer takes (see validLogoBits in escpos.js), made from the uploaded picture itself, so a logo uploaded from the
   phone prints as well as one from the website. White margins are cut off so the logo prints as large as it can; anything that is not close to white prints black, so bright
   colours (cyan, light blue, yellow-green) do not vanish. 384 dots is the full print width of 58 mm paper; on 80 mm the same picture is centred. */
import sharp from 'sharp';
import { MAX_LOGO_H, MAX_LOGO_W, validLogoBits } from './escpos.js';

const WHITE_FROM = 225;   // grey at or above this is paper

export const logoBitsFrom = async (buffer) => {
  const flat = await sharp(buffer, { limitInputPixels: 40e6 }).rotate().flatten({ background: '#ffffff' }).toBuffer();
  const cut = await sharp(flat).trim({ background: '#ffffff', threshold: 20 }).toBuffer().catch(() => flat);   // a picture with nothing to trim stays as it is
  const { data, info } = await sharp(cut).resize({ width: MAX_LOGO_W, height: MAX_LOGO_H, fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  // rows are a whole number of bytes: the spare columns on the right stay white, split evenly so the logo stays centred
  const w = Math.ceil(info.width / 8) * 8; const wb = w / 8; const left = (w - info.width) >> 1;
  const out = Buffer.alloc(wb * info.height);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels] < WHITE_FROM) out[y * wb + ((x + left) >> 3)] |= 0x80 >> ((x + left) & 7);
  }
  const bits = { w, h: info.height, data: out.toString('base64') };
  return validLogoBits(bits) ? bits : null;
};
