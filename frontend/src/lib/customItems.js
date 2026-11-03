/* Quick picks for a custom item at the till: what a shop of this kind most often bills without having it in the catalogue, with the GST that usually goes with it.
 * A pick fills the name and the GST rate; the cashier types the price. A rate can also be a slab (clothing and footwear are taxed by the price of one piece),
 * which follows the price until the cashier chooses a rate by hand. */
import { T } from '../i18n/useT.js';

/* Clothing and footwear, per piece: up to this price the low rate, above it the high one. Check the current notification with the CA. */
const SLABS = { APPAREL: { upTo: 2500, low: 5, high: 18 }, FOOTWEAR: { upTo: 2500, low: 5, high: 18 } };
export const slabRate = (slab, unitPrice) => { const s = SLABS[slab]; return s ? (Number(unitPrice) > s.upTo ? s.high : s.low) : 0; };

const CLOTHING = [
  [T('Shirt'), 'APPAREL'], [T('T-shirt'), 'APPAREL'], [T('Pants'), 'APPAREL'], [T('Jeans'), 'APPAREL'], [T('Kurta'), 'APPAREL'], [T('Saree'), 'APPAREL'],
  [T('Dress'), 'APPAREL'], [T('Leggings'), 'APPAREL'], [T('Innerwear'), 'APPAREL'], [T('Shoes'), 'FOOTWEAR'], [T('Belt'), 18]
];
const FOOD = [[T('Tea'), 5], [T('Coffee'), 5], [T('Meal'), 5], [T('Snacks'), 5], [T('Cold drink'), 5]];
const SALON = [[T('Haircut'), 18], [T('Shave'), 18], [T('Facial'), 18], [T('Hair colour'), 18], [T('Massage'), 18]];
const AUTO = [[T('Labour'), 18], [T('Spare part'), 18], [T('Oil'), 18]];

const BY_TYPE = { CLOTHING: CLOTHING, RESTAURANT: FOOD, CAFE: FOOD, CLOUD_KITCHEN: FOOD, SALON: SALON, AUTO_PARTS: AUTO };

/** [[name, gst]] for the business type; gst is a rate or a slab key. Empty when the shop has no usual ones. */
export const customPresets = (businessType) => BY_TYPE[businessType] || [];
export const GST_RATES = [0, 5, 12, 18, 28];
