/* The business logo as the black and white dots a thermal printer takes (see validLogoBits in escpos.js), made from the uploaded picture itself, so a logo uploaded from the
   phone prints as well as one from the website. White margins are cut off so all of the small print size goes to the logo; anything that is not close to white prints black, so bright
   colours (cyan, light blue, yellow-green) do not vanish. It is centred on 58 mm and 80 mm paper. */
import sharp from 'sharp';
import { validLogoBits } from './escpos.js';

const WHITE_FROM = 225;   // grey at or above this is paper
const PRINT_W = 192; const PRINT_H = 96;   // half the width of 58 mm paper: a mark under the shop's name, not a banner

export const logoBitsFrom = async (buffer) => {
  const flat = await sharp(buffer, { limitInputPixels: 40e6 }).rotate().flatten({ background: '#ffffff' }).toBuffer();
  const cut = await sharp(flat).trim({ background: '#ffffff', threshold: 20 }).toBuffer().catch(() => flat);   // a picture with nothing to trim stays as it is
  const { data, info } = await sharp(cut).resize({ width: PRINT_W, height: PRINT_H, fit: 'inside' }).greyscale().raw().toBuffer({ resolveWithObject: true });
  // rows are a whole number of bytes: the spare columns on the right stay white, split evenly so the logo stays centred
  const w = Math.ceil(info.width / 8) * 8; const wb = w / 8; const left = (w - info.width) >> 1;
  const out = Buffer.alloc(wb * info.height);
  for (let y = 0; y < info.height; y++) for (let x = 0; x < info.width; x++) {
    if (data[(y * info.width + x) * info.channels] < WHITE_FROM) out[y * wb + ((x + left) >> 3)] |= 0x80 >> ((x + left) & 7);
  }
  const bits = { w, h: info.height, data: out.toString('base64') };
  return validLogoBits(bits) ? bits : null;
};
