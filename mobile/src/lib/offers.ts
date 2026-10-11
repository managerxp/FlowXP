/*
 * What the offers would save on this bill, asked of the server (it owns the offers: weekdays, hours, bundles, members-only). Shown as a
 * line on the till so the cashier sees the real price before taking payment. Online only: with no connection the till shows the plain
 * total, marked "about", and the server still applies the offers when the sale arrives.
 */
import type { Api } from './api.ts';
import { linePricePaise, type Cart } from './cart.ts';
import { toPaise } from './money.ts';

export type OffersResult = { byKey: Map<string, number>; savingPaise: number; names: string[] };
export const noOffers = (): OffersResult => ({ byKey: new Map(), savingPaise: 0, names: [] });

export const previewOffers = async (api: Api, cart: Cart): Promise<OffersResult> => {
  const lines = cart.lines;
  if (!lines.length) return noOffers();
  const reply = await api.post<{ lines: { index: number; discount: number; name: string }[] }>('/retail/promotions/preview', {
    lines: lines.map((l) => ({ product_id: l.product.product_id, quantity: l.quantity, unit_price: linePricePaise(l) / 100 }))
  });
  const byKey = new Map<string, number>(); const names = new Set<string>(); let saving = 0;
  for (const r of reply.lines || []) {
    const line = lines[r.index];
    if (!line) continue;
    const paise = toPaise(r.discount);
    byKey.set(line.key, (byKey.get(line.key) ?? 0) + paise); saving += paise; names.add(r.name);
  }
  return { byKey, savingPaise: saving, names: [...names] };
};
