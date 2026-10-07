/* Test helpers: Node's built-in SQLite as the app's Db, and a fake FlowXP server that behaves like the real one where it matters. */
import { DatabaseSync } from 'node:sqlite';
import type { Db } from '../src/lib/db.ts';
import { createApi, type Session } from '../src/lib/api.ts';
import type { Product } from '../src/lib/catalog.ts';

export const nodeDb = (path = ':memory:'): Db => {
  const d = new DatabaseSync(path);
  const make = (): Db => ({
    exec: async (sql) => { d.exec(sql); },
    run: async (sql, params = []) => { d.prepare(sql).run(...params); },
    all: async <T,>(sql: string, params: (string | number | null)[] = []) => d.prepare(sql).all(...params) as T[],
    tx: async (work) => { d.exec('BEGIN'); try { await work(make()); d.exec('COMMIT'); } catch (e) { d.exec('ROLLBACK'); throw e; } }
  });
  return make();
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
    log: [] as { seq: number; id: number }[],
    floor: 0,
    down: false,                         // no signal: fetch throws
    status: 0,                           // a fixed status for every call, e.g. 503
    refuse: new Map<string, { status: number; message: string }>(),   // key -> refusal for the sale made under it
    hang: false,                         // never answers (until the request's signal aborts)
    sales: [] as Sale[],
    calls: [] as string[],
    lostReplies: 0,                      // the next N sales are made but the reply never arrives (signal dropped just after)
    groups: [] as unknown[],             // GET /modifier-groups
    groupsDown: false,                   // that one call fails
    offerPerLine: 0 as number            // rupees every previewed line saves (0 = no offers)
  };
  let seq = 0;
  const head = () => Math.max(seq, state.floor);          // the real server's head is never below the floor
  const touch = (id: number) => { state.log.push({ seq: ++seq, id }); };
  products.forEach((p) => touch(p.product_id));
  state.log = [];                        // the initial catalogue is the starting point, not a change

  const server = {
    state,
    upsert: (p: Product) => { state.products.set(p.product_id, p); touch(p.product_id); },
    remove: (id: number) => { state.products.delete(id); touch(id); },
    session: { token: 'tok', businessId: 7, branchId: 9 } as Session,
    fetchImpl: (async (input: string, init: RequestInit = {}) => {
      const url = input.replace(/^http:\/\/x\/api/, '');
      state.calls.push(`${init.method || 'GET'} ${url}`);
      if (state.down) throw new TypeError('Network request failed');
      if (state.hang) await new Promise((_, reject) => { init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))); });
      if (state.status) return json(state.status, { success: false, message: `status ${state.status}` });
      const headers = (init.headers || {}) as Record<string, string>;

      if (url === '/modifier-groups') return state.groupsDown ? json(500, { success: false, message: 'boom' }) : json(200, { success: true, data: state.groups });
      if (url === '/retail/promotions/preview') {
        const lines = JSON.parse(String(init.body)).lines as unknown[];
        return json(200, { success: true, data: { lines: state.offerPerLine ? lines.map((_, index) => ({ index, discount: state.offerPerLine, name: 'Happy hour' })) : [], saving: 0 } });
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
        const last = new Map<number, number>(); raw.forEach((l) => { last.delete(l.id); last.set(l.id, l.seq); });
        const changes = [...last.keys()].map((id) => { const row = state.products.get(id); return row ? { entity: 'product', op: 'upsert', id, row } : { entity: 'product', op: 'delete', id }; });
        const more = raw.length === limit;
        return json(200, { success: true, data: { changes, next: more ? raw[raw.length - 1].seq : Math.max(head(), raw.length ? raw[raw.length - 1].seq : since), has_more: more } });
      }
      if (url === '/invoices' && init.method === 'POST') {
        const key = headers['Idempotency-Key'];
        const body = JSON.parse(String(init.body));
        const before = state.sales.find((s) => s.key === key);
        if (before) {
          if (JSON.stringify(before.body) !== JSON.stringify(body)) return json(422, { success: false, message: 'This Idempotency-Key was already used for a different request' });
          return json(201, { success: true, data: { invoice_id: before.invoice_id, invoice_number: before.invoice_number } });
        }
        const refusal = state.refuse.get(key);
        if (refusal) return json(refusal.status, { success: false, message: refusal.message });
        const sale: Sale = { invoice_id: state.sales.length + 1, invoice_number: `INV-${String(state.sales.length + 1).padStart(4, '0')}`, key, headers, body };
        state.sales.push(sale);
        if (state.lostReplies > 0) { state.lostReplies--; throw new TypeError('Network request failed'); }
        const kitchen = body.send_to_kitchen === true && headers['X-Offline-Sale'] !== '1';
        return json(201, { success: true, data: { invoice_id: sale.invoice_id, invoice_number: sale.invoice_number, ...(kitchen ? { order: { order_number: `ORD-${String(sale.invoice_id).padStart(4, '0')}` } } : {}) } });
      }
      return json(404, { success: false, message: `no route ${url}` });
    }) as unknown as typeof fetch
  };
  const api = createApi({ baseUrl: 'http://x', getSession: () => server.session, fetchImpl: server.fetchImpl });
  return { ...server, api };
};
