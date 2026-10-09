/* Test helpers: Node's built-in SQLite as the app's Db, and a fake FlowXP server that behaves like the real one where it matters. */
import { DatabaseSync } from 'node:sqlite';
import { fromExpo, type Db } from '../src/lib/db.ts';
import { createApi, type Session } from '../src/lib/api.ts';
import type { Product } from '../src/lib/catalog.ts';

/* Node's SQLite dressed as the phone's library (async calls), then wrapped by the app's own fromExpo: the tests exercise the same queue and
   transaction code the phone runs. */
export const nodeDb = (path = ':memory:'): Db => {
  const d = new DatabaseSync(path);
  const later = <T,>(fn: () => T) => new Promise<T>((resolve, reject) => setImmediate(() => { try { resolve(fn()); } catch (e) { reject(e); } }));
  return fromExpo({
    execAsync: (sql) => later(() => { d.exec(sql); }),
    runAsync: (sql, params) => later(() => d.prepare(sql).run(...params)),
    getAllAsync: <T,>(sql: string, params: (string | number | null)[]) => later(() => d.prepare(sql).all(...params) as T[])
  });
};

export const P = (id: number, name: string, price: number, extra: Partial<Product> = {}): Product => ({
  product_id: id, name, sku: `SKU${id}`, barcodes: [`890000000${id}`], unit: 'pc', selling_price: price, mrp: null, tax_rate: 5,
  track_inventory: false, current_stock: null, category_name: 'Snacks', is_available: true, modifier_group_ids: [], ...extra
});

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export type Sale = { invoice_id: number; invoice_number: string; key: string; headers: Record<string, string>; body: any };

/** A FlowXP stand-in: a catalogue with a change log, invoices that honour the Idempotency-Key, and switches for "no signal" and "server broken". */
export const fakeServer = (products: Product[] = [], { pageSize = 1000 }: { pageSize?: number } = {}) => {
  const state = {
    products: new Map(products.map((p) => [p.product_id, p])),
    log: [] as { seq: number; id: number; entity: 'product' | 'customer' }[],
    customers: new Map<number, { customer_id: number; name: string; phone: string | null; email: string | null; gstin: string | null }>(),
    applied: [] as { path: string; body: unknown; key: string }[],        // changes (price, stock) the server applied, by key
    floor: 0,
    down: false,                         // no signal: fetch throws
    status: 0,                           // a fixed status for every call, e.g. 503
    refuse: new Map<string, { status: number; message: string }>(),   // key -> refusal for the sale made under it
    hang: false,                         // never answers (until the request's signal aborts)
    sales: [] as Sale[],
    calls: [] as string[],
    visits: new Set<string>(),            // the visits the field server has been told about, by the phone's own reference
    review: [] as string[],               // what the pharmacy till says a person should check on an offline sale
    lostReplies: 0,                      // the next N sales are made but the reply never arrives (signal dropped just after)
    groups: [] as unknown[],             // GET /modifier-groups
    groupsDown: false,                   // that one call fails
    offerPerLine: 0 as number,           // rupees every previewed line saves (0 = no offers)
    held: [] as { hold_id: number; label: string | null; bill: unknown; item_count: number; estimate: number; created_at: string; held_by: string | null }[],
    heldFull: false                      // the outlet already has 50 bills on hold
  };
  let seq = 0;
  const head = () => Math.max(seq, state.floor);          // the real server's head is never below the floor
  const touch = (id: number, entity: 'product' | 'customer' = 'product') => { state.log.push({ seq: ++seq, id, entity }); };
  products.forEach((p) => touch(p.product_id));
  state.log = [];                        // the initial catalogue is the starting point, not a change

  const server = {
    state,
    upsert: (p: Product) => { state.products.set(p.product_id, p); touch(p.product_id); },
    upsertCustomer: (c: { customer_id: number; name: string; phone?: string | null }) => { state.customers.set(c.customer_id, { email: null, gstin: null, phone: null, ...c }); touch(c.customer_id, 'customer'); },
    removeCustomer: (id: number) => { state.customers.delete(id); touch(id, 'customer'); },
    remove: (id: number) => { state.products.delete(id); touch(id); },
    session: { token: 'tok', businessId: 7, branchId: 9 } as Session,
    fetchImpl: (async (input: string, init: RequestInit = {}) => {
      const url = input.replace(/^http:\/\/x\/api/, '');
      state.calls.push(`${init.method || 'GET'} ${url}`);
      if (state.down) throw new TypeError('Network request failed');
      if (state.hang) await new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
      if (state.status) return json(state.status, { success: false, message: `status ${state.status}` });
      const headers = (init.headers || {}) as Record<string, string>;

      if (url === '/customers') return json(200, { success: true, data: [...state.customers.values()] });
      if (url === '/inventory/adjust' && init.method === 'POST') {
        const key = headers['Idempotency-Key']; const done = state.applied.find((a) => a.key === key);
        if (state.refuse.has(key)) return json(state.refuse.get(key)!.status, { success: false, message: state.refuse.get(key)!.message });
        if (!done) state.applied.push({ path: url, body: JSON.parse(String(init.body)), key });
        if (state.lostReplies > 0) { state.lostReplies--; throw new TypeError('Network request failed'); }
        return json(201, { success: true, data: {} });
      }
      if (/^\/products\/\d+$/.test(url) && (init.method ?? 'GET') === 'GET') { const p = state.products.get(Number(url.split('/')[2])); return p ? json(200, { success: true, data: p }) : json(404, { success: false, message: 'Not found' }); }
      if (/^\/products\/\d+$/.test(url) && init.method === 'PATCH') {
        const id = Number(url.split('/')[2]); const b = JSON.parse(String(init.body)); const p = state.products.get(id);
        if (!p) return json(404, { success: false, message: 'Not found' });
        state.applied.push({ path: url, body: b, key: headers['Idempotency-Key'] }); state.products.set(id, { ...p, selling_price: b.selling_price }); touch(id); return json(200, { success: true, data: {} });
      }
      if (init.method === 'POST' && (['/distributor/visits', '/wholesale/orders', '/wholesale/receipts'].includes(url) || /^\/distributor\/vehicles\/\d+\/sell$/.test(url))) {
        const key = headers['Idempotency-Key']; const b = JSON.parse(String(init.body));
        if (url !== '/distributor/visits' && b.visit_ref && !state.visits.has(b.visit_ref)) return json(400, { success: false, message: 'That visit was not found' });
        const refusal = state.refuse.get(key);
        if (refusal) return json(refusal.status, { success: false, message: refusal.message });
        if (!state.applied.some((a) => a.key === key)) { state.applied.push({ path: url, body: b, key, headers } as never); if (url === '/distributor/visits') state.visits.add(b.client_ref); }
        const n = state.applied.findIndex((a) => a.key === key) + 1;
        if (state.lostReplies > 0) { state.lostReplies--; throw new TypeError('Network request failed'); }
        return json(201, { success: true, data: /\/sell$/.test(url) ? { order_id: n, invoice_id: n, invoice_number: `INV-${n}`, review: state.review } : url === '/distributor/visits' ? { visit_id: n } : url === '/wholesale/orders' ? { order_id: n, order_number: `SO-${n}` } : { receipt_id: n, receipt_number: `RC-${n}`, allocated: b.amount, advance: 0 } });
      }
      if (url === '/modifier-groups') return state.groupsDown ? json(500, { success: false, message: 'boom' }) : json(200, { success: true, data: state.groups });
      if (url === '/retail/promotions/preview') {
        const lines = JSON.parse(String(init.body)).lines as unknown[];
        return json(200, { success: true, data: { lines: state.offerPerLine ? lines.map((_, index) => ({ index, discount: state.offerPerLine, name: 'Happy hour' })) : [], saving: 0 } });
      }
      if (url === '/held-bills' && init.method === 'POST') {
        if (state.heldFull) return json(409, { success: false, message: '50 bills are already on hold here. Resume or discard some first.' });
        const b = JSON.parse(String(init.body));
        const row = { hold_id: state.held.length + 100, label: b.label ?? null, bill: b.bill, item_count: b.bill.lines.reduce((n: number, l: { quantity: number }) => n + l.quantity, 0), estimate: b.estimate ?? 0, created_at: new Date().toISOString(), held_by: 'Ravi' };
        state.held.push(row); return json(201, { success: true, data: row });
      }
      if (url === '/held-bills' && (!init.method || init.method === 'GET')) return json(200, { success: true, data: state.held });
      if (url.startsWith('/held-bills/') && init.method === 'DELETE') {
        const at = state.held.findIndex((h) => String(h.hold_id) === url.split('/')[2]);
        if (at < 0) return json(404, { success: false, message: 'That held bill is not here any more. Someone may have resumed it.' });
        return json(200, { success: true, data: state.held.splice(at, 1)[0] });
      }
      if (url === '/sync/head') return json(200, { success: true, data: { head: head() } });
      if (url.startsWith('/products/pos-catalog')) {
        const after = Number(new URL(`http://x${url}`).searchParams.get('after'));
        const rows = [...state.products.values()].filter((p) => p.product_id > after).sort((a, b) => a.product_id - b.product_id).slice(0, pageSize);
        return json(200, { success: true, data: rows, meta: { next_after: rows.length === pageSize ? rows[rows.length - 1].product_id : null } });
      }
      if (url.startsWith('/sync/changes')) {
        const q = new URL(`http://x${url}`).searchParams; const since = Number(q.get('since')); const limit = Number(q.get('limit'));
        if (since < state.floor || since > head()) return json(409, { success: false, code: 'RESYNC', message: 'Download the catalogue again.', data: { head: seq } });
        const raw = state.log.filter((l) => l.seq > since).slice(0, limit);
        const last = new Map<string, { id: number; entity: string }>(); raw.forEach((l) => { last.delete(`${l.entity}:${l.id}`); last.set(`${l.entity}:${l.id}`, { id: l.id, entity: l.entity }); });
        const changes = [...last.values()].map(({ id, entity }) => { const row = entity === 'customer' ? state.customers.get(id) : state.products.get(id); return row ? { entity, op: 'upsert', id, row } : { entity, op: 'delete', id }; });
        const more = raw.length === limit;
        return json(200, { success: true, data: { changes, next: more ? raw[raw.length - 1].seq : Math.max(head(), raw.length ? raw[raw.length - 1].seq : since), has_more: more } });
      }
      if ((url === '/invoices' || url === '/pharmacy/pos/invoices') && init.method === 'POST') {
        const pharmacy = url === '/pharmacy/pos/invoices';
        const key = headers['Idempotency-Key'];
        const body = JSON.parse(String(init.body));
        const before = state.sales.find((s) => s.key === key);
        if (before) {
          if (JSON.stringify(before.body) !== JSON.stringify(body)) return json(422, { success: false, message: 'This Idempotency-Key was already used for a different request' });
          return json(201, { success: true, data: pharmacy ? { invoice: { invoice_id: before.invoice_id, invoice_number: before.invoice_number }, review: [] } : { invoice_id: before.invoice_id, invoice_number: before.invoice_number } });
        }
        const refusal = state.refuse.get(key);
        if (refusal) return json(refusal.status, { success: false, message: refusal.message });
        const sale: Sale = { invoice_id: state.sales.length + 1, invoice_number: `INV-${String(state.sales.length + 1).padStart(4, '0')}`, key, headers, body };
        state.sales.push(sale);
        if (state.lostReplies > 0) { state.lostReplies--; throw new TypeError('Network request failed'); }
        if (pharmacy) return json(201, { success: true, data: { invoice: { invoice_id: sale.invoice_id, invoice_number: sale.invoice_number }, review: state.review } });
        const kitchen = body.send_to_kitchen === true && headers['X-Offline-Sale'] !== '1';
        return json(201, { success: true, data: { invoice_id: sale.invoice_id, invoice_number: sale.invoice_number, ...(kitchen ? { order: { order_number: `ORD-${String(sale.invoice_id).padStart(4, '0')}` } } : {}) } });
      }
      return json(404, { success: false, message: `no route ${url}` });
    }) as unknown as typeof fetch
  };
  const api = createApi({ baseUrl: 'http://x', getSession: () => server.session, fetchImpl: server.fetchImpl });
  return { ...server, api };
};
