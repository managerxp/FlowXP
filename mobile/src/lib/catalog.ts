/*
 * The till's copy of the catalogue, kept in the phone's SQLite so scanning and searching work with no connection, answer at once, and
 * survive the app being closed. The server stays the authority: this is for FINDING products and showing hints (stock is a hint); a
 * bill is priced and stock-checked by the server when it arrives.
 *
 * Getting it and keeping it fresh:
 *   first time (or a forced resync) : read the sync position (/sync/head), download every page of /products/pos-catalog, then replace the
 *                                     whole copy in ONE transaction, so a download that stops half way leaves the old copy untouched.
 *                                     The position is read BEFORE the download: anything that changes meanwhile arrives again as a change.
 *   afterwards                      : ask /sync/changes since the stored position and apply what comes (an upsert replaces the product,
 *                                     a delete removes it), page after page. 409 RESYNC (away too long) = the first-time path again.
 */
import type { Api, Envelope } from './api.ts';
import { ApiError } from './api.ts';
import type { Db } from './db.ts';
import type { Group } from './options.ts';

export type Product = {
  product_id: number; name: string; sku: string | null; barcodes: string[]; unit: string | null;
  selling_price: number; mrp: number | null; tax_rate: number; track_inventory: boolean; current_stock: number | null;
  category_name: string | null; is_available: boolean; modifier_group_ids: number[];
};

export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS products (product_id INTEGER PRIMARY KEY, name TEXT NOT NULL, s TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_products_name ON products (name);
  CREATE TABLE IF NOT EXISTS barcodes (barcode TEXT PRIMARY KEY, product_id INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_barcodes_product ON barcodes (product_id);
  CREATE TABLE IF NOT EXISTS meta (k TEXT PRIMARY KEY, v TEXT);
  CREATE TABLE IF NOT EXISTS groups (group_id INTEGER PRIMARY KEY, data TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS customers (customer_id INTEGER PRIMARY KEY, name TEXT NOT NULL, s TEXT NOT NULL, data TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS idx_customers_name ON customers (name);
`;

/** A customer as the phone keeps it: enough to find them and put them on a bill, offline. */
export type LocalCustomer = { customer_id: number; name: string; phone: string | null; email: string | null; gstin: string | null };
const customerText = (c: LocalCustomer) => `${c.name} ${c.phone || ''} ${c.email || ''}`.toLowerCase();
const slim = (c: LocalCustomer): LocalCustomer => ({ customer_id: c.customer_id, name: c.name, phone: c.phone ?? null, email: c.email ?? null, gstin: c.gstin ?? null });
const putCustomer = (db: Db, c: LocalCustomer) => db.run(`INSERT OR REPLACE INTO customers (customer_id, name, s, data) VALUES (?,?,?,?)`, [c.customer_id, c.name, customerText(c), JSON.stringify(slim(c))]);

/* The option groups (Size, Milk...) are few and small, so the whole list is refreshed rather than followed change by change: on a full
   download, and then at most this often while online. A price changed in the last ten minutes can still show its old figure on the phone;
   the server prices the sale, so the bill is right either way. */
/* Bump this when what the phone keeps changes shape (or what the server sends changes meaning): every phone then downloads the catalogue
   once more. 2 = ingredients and packaging are no longer in the product list. */
const COPY_VERSION = '3';   // 3 = customers are kept on the phone too
const GROUPS_FRESH_MS = 10 * 60 * 1000;

const textOf = (p: Product) => `${p.name} ${p.sku || ''} ${(p.barcodes || []).join(' ')} ${p.category_name || ''}`.toLowerCase();
const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Change = { entity: 'product' | 'category' | 'customer'; op: 'upsert' | 'delete'; id: number; row?: Product & LocalCustomer };
type ChangePage = { changes: Change[]; next: number; has_more: boolean };

const putProduct = async (db: Db, p: Product) => {
  await db.run(`INSERT OR REPLACE INTO products (product_id, name, s, data) VALUES (?,?,?,?)`, [p.product_id, p.name, textOf(p), JSON.stringify(p)]);
  await db.run(`DELETE FROM barcodes WHERE product_id = ?`, [p.product_id]);
  for (const b of p.barcodes || []) await db.run(`INSERT OR REPLACE INTO barcodes (barcode, product_id) VALUES (?,?)`, [b, p.product_id]);
};
/* A full download writes many rows: a few hundred per statement, because every statement on a phone crosses into native code. */
const CHUNK = 100;
const putMany = async (db: Db, rows: Product[], products = 'products', barcodes = 'barcodes') => {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await db.run(`INSERT OR REPLACE INTO ${products} (product_id, name, s, data) VALUES ${part.map(() => '(?,?,?,?)').join(',')}`,
      part.flatMap((p) => [p.product_id, p.name, textOf(p), JSON.stringify(p)]));
    const codes = part.flatMap((p) => (p.barcodes || []).map((b) => [b, p.product_id] as const));
    for (let j = 0; j < codes.length; j += CHUNK) {
      const bit = codes.slice(j, j + CHUNK);
      await db.run(`INSERT OR REPLACE INTO ${barcodes} (barcode, product_id) VALUES ${bit.map(() => '(?,?)').join(',')}`, bit.flatMap(([b, id]) => [b, id]));
    }
  }
};
const dropProduct = async (db: Db, id: number) => {
  await db.run(`DELETE FROM barcodes WHERE product_id = ?`, [id]);
  await db.run(`DELETE FROM products WHERE product_id = ?`, [id]);
};

export const createCatalog = (db: Db) => {
  const setMeta = (k: string, v: string | number) => db.run(`INSERT OR REPLACE INTO meta (k, v) VALUES (?,?)`, [k, String(v)]);
  const getMeta = async (k: string) => (await db.all<{ v: string }>(`SELECT v FROM meta WHERE k = ?`, [k]))[0]?.v ?? null;

  const full = async (api: Api, onProgress: (n: number) => void) => {
    const head = (await api.get<{ head: number }>('/sync/head')).head;
    const rows: Product[] = [];
    let after: number | null = 0;
    while (after !== null) {
      const page: Envelope<Product[]> = await api.call<Product[]>(`/products/pos-catalog?after=${after}&limit=1000`);
      rows.push(...page.data);
      after = (page.meta?.next_after as number | null | undefined) ?? null;
      onProgress(rows.length);
    }
    // The download is written to side tables in many small steps, so a sale being saved or a search being read never waits on one long
    // write; only the final swap (a bulk copy, about a second) is a single transaction, and it is all or nothing: a download that stops
    // half way leaves the copy in use exactly as it was.
    await db.exec(`DROP TABLE IF EXISTS products_next; DROP TABLE IF EXISTS barcodes_next;
      CREATE TABLE products_next (product_id INTEGER PRIMARY KEY, name TEXT NOT NULL, s TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE barcodes_next (barcode TEXT PRIMARY KEY, product_id INTEGER NOT NULL);`);
    await putMany(db, rows, 'products_next', 'barcodes_next');
    // the customer list comes with the first download; one that cannot be read (no permission, a slow link) does not stop the products
    const people = await api.get<LocalCustomer[]>('/customers').catch(() => null);
    await db.tx(async (t) => {
      if (people) { await t.run(`DELETE FROM customers`); for (const c of people) await putCustomer(t, c); }
      await t.run(`DELETE FROM barcodes`); await t.run(`DELETE FROM products`);
      await t.run(`INSERT INTO products SELECT * FROM products_next`); await t.run(`INSERT INTO barcodes SELECT * FROM barcodes_next`);
      await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('head', ?)`, [String(head)]);
      await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('v', ?)`, [COPY_VERSION]);
      await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('synced_at', ?)`, [String(Date.now())]);
    });
    await db.exec(`DROP TABLE IF EXISTS products_next; DROP TABLE IF EXISTS barcodes_next;`);
    return { mode: 'full' as const, products: rows.length };
  };

  const catchUp = async (api: Api, since: number) => {
    let at = since; let applied = 0;
    for (;;) {
      const page = await api.get<ChangePage>(`/sync/changes?since=${at}&limit=500`);
      await db.tx(async (t) => {
        for (const c of page.changes) {
          if (c.entity === 'customer') { if (c.op === 'upsert' && c.row) await putCustomer(t, c.row); else await t.run(`DELETE FROM customers WHERE customer_id = ?`, [c.id]); continue; }
          if (c.entity !== 'product') continue;          // categories are not used by the till yet
          if (c.op === 'upsert' && c.row) await putProduct(t, c.row); else await dropProduct(t, c.id);
        }
        await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('head', ?)`, [String(page.next)]);
        await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('synced_at', ?)`, [String(Date.now())]);
      });
      applied += page.changes.length; at = page.next;
      if (!page.has_more) return { mode: 'changes' as const, applied };
    }
  };

  const refreshGroups = async (api: Api, force = false) => {
    const at = await getMeta('groups_at');
    if (!force && at && Date.now() - Number(at) < GROUPS_FRESH_MS) return;
    const groups = await api.get<(Group & { products?: unknown })[]>('/modifier-groups');
    await db.tx(async (t) => {
      await t.run(`DELETE FROM groups`);
      for (const g of groups) await t.run(`INSERT INTO groups (group_id, data) VALUES (?,?)`, [g.group_id, JSON.stringify({ group_id: g.group_id, name: g.name, is_variant: g.is_variant, min_select: g.min_select, max_select: g.max_select, modifiers: g.modifiers })]);
      await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('groups_at', ?)`, [String(Date.now())]);
    });
  };

  return {
    count: async () => Number((await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM products`))[0].n),
    syncedAt: async () => { const v = await getMeta('synced_at'); return v ? Number(v) : null; },

    /** Bring the copy up to date: a full download the first time, changes after that. */
    sync: async (api: Api, onProgress: (n: number) => void = () => {}) => {
      const head = await getMeta('head');
      let result;
      if (head === null || (await getMeta('v')) !== COPY_VERSION) result = await full(api, onProgress);
      else {
        try { result = await catchUp(api, Number(head)); }
        catch (e) { if (e instanceof ApiError && e.status === 409 && e.code === 'RESYNC') result = await full(api, onProgress); else throw e; }
      }
      // a failure to read the groups never fails the product sync: the copy kept last time still works
      await refreshGroups(api, result.mode === 'full').catch(() => {});
      return result;
    },

    /** The option groups a product offers, from this phone's copy (so the picker works offline). */
    groupsFor: async (product: Product): Promise<Group[]> => {
      const ids = product.modifier_group_ids || [];
      if (!ids.length) return [];
      const rows = await db.all<{ data: string }>(`SELECT data FROM groups WHERE group_id IN (${ids.map(() => '?').join(',')}) ORDER BY group_id`, ids);
      return rows.map((r) => JSON.parse(r.data) as Group);
    },

    byId: async (id: number): Promise<Product | undefined> => {
      const row = (await db.all<{ data: string }>(`SELECT data FROM products WHERE product_id = ?`, [id]))[0];
      return row ? (JSON.parse(row.data) as Product) : undefined;
    },

    findByBarcode: async (code: string): Promise<Product | undefined> => {
      const row = (await db.all<{ data: string }>(`SELECT p.data FROM barcodes b JOIN products p ON p.product_id = b.product_id WHERE b.barcode = ?`, [code.trim()]))[0];
      return row ? (JSON.parse(row.data) as Product) : undefined;
    },

    /** Every word typed must appear somewhere in the name, SKU, barcode or category; names that start with the text come first.
        `category` narrows to one category ('' = the products with none). */
    search: async (text: string, limit = 40, category?: string, offset = 0): Promise<Product[]> => {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const clauses = words.map(() => `s LIKE ? ESCAPE '\\'`);
      const args: (string | number)[] = words.map(like);
      if (category !== undefined) { clauses.push(category === '' ? `json_extract(data, '$.category_name') IS NULL` : `json_extract(data, '$.category_name') = ?`); if (category !== '') args.push(category); }
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const order = words.length ? `ORDER BY (name LIKE ? ESCAPE '\\') DESC, name` : 'ORDER BY name';
      if (words.length) args.push(`${words[0].replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
      return (await db.all<{ data: string }>(`SELECT data FROM products ${where} ${order} LIMIT ? OFFSET ?`, [...args, limit, offset])).map((r) => JSON.parse(r.data) as Product);
    },

    /** The categories on this phone with how many products each has, biggest first (products with none are grouped as ''). */
    categories: async (): Promise<{ name: string; count: number }[]> =>
      (await db.all<{ c: string | null; n: number }>(`SELECT json_extract(data, '$.category_name') AS c, COUNT(*) AS n FROM products GROUP BY c ORDER BY n DESC, c`)).map((r) => ({ name: r.c ?? '', count: Number(r.n) })),

    /** Throw away this phone's copy of the product list and start it again: the tables are dropped and made fresh (so even a damaged copy goes),
        and only the product list is touched, never a bill waiting to be sent. The next sync downloads everything. */
    rebuild: async () => {
      await db.exec(`DROP TABLE IF EXISTS products_next; DROP TABLE IF EXISTS barcodes_next; DROP TABLE IF EXISTS products; DROP TABLE IF EXISTS barcodes; DROP TABLE IF EXISTS groups; DROP TABLE IF EXISTS customers;`);
      await db.exec(SCHEMA);
      await db.run(`DELETE FROM meta WHERE k IN ('head','synced_at','groups_at','v')`);
    },
    /** Find customers on this phone by name, phone or email (every word must match). Works with no signal. */
    customers: async (text: string, limit = 40): Promise<LocalCustomer[]> => {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const where = words.length ? `WHERE ${words.map(() => `s LIKE ? ESCAPE '\\'`).join(' AND ')}` : '';
      return (await db.all<{ data: string }>(`SELECT data FROM customers ${where} ORDER BY name LIMIT ?`, [...words.map(like), limit])).map((r) => JSON.parse(r.data) as LocalCustomer);
    },
    customerCount: async () => Number((await db.all<{ n: number }>(`SELECT COUNT(*) AS n FROM customers`))[0].n),

    /** A price or stock change made on this phone shows at once on the till, before the server has been told (the server's own row replaces it on the next sync). */
    setLocal: async (productId: number, patch: { selling_price?: number; stockDelta?: number }) => {
      const row = (await db.all<{ data: string }>(`SELECT data FROM products WHERE product_id = ?`, [productId]))[0];
      if (!row) return;
      const p = JSON.parse(row.data) as Product;
      if (patch.selling_price != null) p.selling_price = patch.selling_price;
      if (patch.stockDelta != null && p.current_stock != null) p.current_stock = Math.round((p.current_stock + patch.stockDelta) * 1000) / 1000;
      await db.run(`UPDATE products SET data = ? WHERE product_id = ?`, [JSON.stringify(p), productId]);
    },

    clear: async () => { await db.run(`DELETE FROM barcodes`); await db.run(`DELETE FROM products`); await db.run(`DELETE FROM groups`); await db.run(`DELETE FROM meta WHERE k IN ('head','synced_at','groups_at')`); }
  };
};

export type Catalog = ReturnType<typeof createCatalog>;
