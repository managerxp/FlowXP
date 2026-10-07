/*
 * Taking a sale. Online it goes straight to the server and the server's invoice is the bill. With no usable connection it is kept in the
 * outbox and sent later with the same key, marked offline and dated the day it was taken; the cashier gets a provisional receipt, clearly
 * marked, and the real invoice number arrives when it syncs.
 *
 * A REFUSAL (not enough stock, an archived product, a bad coupon) is not a connection problem: it is shown, and the sale is NOT queued
 * behind the cashier's back. Only "could not reach the server" queues.
 */
import { ApiError, NetworkError, type Api } from './api.ts';
import { lineName, linePricePaise, saleBody, totals, type Cart } from './cart.ts';
import type { Entry, Outbox, Preview } from './outbox.ts';

export type Taken = { kind: 'billed'; invoiceId: number; token: string | null } | { kind: 'queued'; entry: Entry } | { kind: 'full' };

/** The phone could not get an answer: no connection, a timeout, or a gateway in front of the server that is down. */
export const unreachable = (e: unknown) => e instanceof NetworkError || (e instanceof ApiError && [502, 503, 504].includes(e.status));

export const previewOf = (cart: Cart, method: string): Preview => {
  const t = totals(cart);
  return {
    lines: cart.lines.map((l) => ({ name: lineName(l), quantity: l.quantity, unitPricePaise: linePricePaise(l) })),
    subtotalPaise: t.subtotalPaise, taxPaise: t.taxPaise, totalPaise: t.totalPaise, method
  };
};

/** The phone's own calendar day, YYYY-MM-DD (the server believes it within a week; see invoices.controller offlineDate). */
export const dayOf = (ms: number): string => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

export const takeSale = async (
  { api, outbox, cart, method, reference, key, kitchen = false, tryMs = 8000 }:
  { api: Api; outbox: Outbox; cart: Cart; method: string; reference?: string; key: string; kitchen?: boolean; tryMs?: number }
): Promise<Taken> => {
  const body = saleBody(cart, { method, reference }, { kitchen });
  try {
    const invoice = await api.post<{ invoice_id: number; order?: { order_number: string } }>('/invoices', body, { idempotencyKey: key, timeoutMs: tryMs });
    return { kind: 'billed', invoiceId: invoice.invoice_id, token: invoice.order?.order_number ?? null };
  } catch (e) {
    if (!unreachable(e)) throw e;
    const entry = await outbox.add({ id: key, body, preview: previewOf(cart, method) });
    return entry ? { kind: 'queued', entry } : { kind: 'full' };
  }
};

/* What the outbox sends for one queued sale: the SAME body as the first attempt (the server's duplicate guard compares bodies), with the
   fact that it was taken offline, and the day, in headers. */
export const sendEntry = (api: Api) => async (e: Entry) => {
  const invoice = await api.post<{ invoice_id: number; invoice_number: string }>('/invoices', e.body, {
    idempotencyKey: e.id, headers: { 'X-Offline-Sale': '1', 'X-Sale-Date': dayOf(e.taken_at) }
  });
  return { invoice_id: invoice.invoice_id, invoice_number: invoice.invoice_number };
};
