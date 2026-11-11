/* Quick picks for a one-off line at the till, by kind of shop: a tap fills the name and the usual GST (same list as the website's till). Clothing and footwear are taxed by the price of one piece. */
export type Preset = { name: string; gst: number | 'APPAREL' };
const FOOD: Preset[] = [{ name: 'Tea', gst: 5 }, { name: 'Coffee', gst: 5 }, { name: 'Meal', gst: 5 }, { name: 'Snacks', gst: 5 }, { name: 'Cold drink', gst: 5 }];
const CLOTHING: Preset[] = [{ name: 'Shirt', gst: 'APPAREL' }, { name: 'T-shirt', gst: 'APPAREL' }, { name: 'Pants', gst: 'APPAREL' }, { name: 'Jeans', gst: 'APPAREL' }, { name: 'Kurta', gst: 'APPAREL' }, { name: 'Saree', gst: 'APPAREL' }, { name: 'Dress', gst: 'APPAREL' }, { name: 'Shoes', gst: 'APPAREL' }, { name: 'Belt', gst: 18 }];
const SALON: Preset[] = [{ name: 'Haircut', gst: 18 }, { name: 'Shave', gst: 18 }, { name: 'Facial', gst: 18 }, { name: 'Hair colour', gst: 18 }, { name: 'Massage', gst: 18 }];
const AUTO: Preset[] = [{ name: 'Labour', gst: 18 }, { name: 'Spare part', gst: 18 }, { name: 'Oil', gst: 18 }];
const BY_TYPE: Record<string, Preset[]> = { CLOTHING, RESTAURANT: FOOD, CAFE: FOOD, CLOUD_KITCHEN: FOOD, SALON, AUTO_PARTS: AUTO, MECHANIC: AUTO };

export const customPresets = (businessType: string): Preset[] => BY_TYPE[businessType] ?? [];
export const GST_RATES = [0, 3, 5, 12, 18, 28, 40];
/** The GST rate for a pick at this price (a slab follows the price of one piece). */
export const presetRate = (gst: Preset['gst'], pricePaise: number): number => (gst === 'APPAREL' ? (pricePaise > 250000 ? 18 : 5) : gst);
