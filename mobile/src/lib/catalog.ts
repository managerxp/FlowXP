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
`;

/* The option groups (Size, Milk...) are few and small, so the whole list is refreshed rather than followed change by change: on a full
   download, and then at most this often while online. A price changed in the last ten minutes can still show its old figure on the phone;
   the server prices the sale, so the bill is right either way. */
const GROUPS_FRESH_MS = 10 * 60 * 1000;

const textOf = (p: Product) => `${p.name} ${p.sku || ''} ${(p.barcodes || []).join(' ')} ${p.category_name || ''}`.toLowerCase();
const like = (w: string) => `%${w.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

type Change = { entity: 'product' | 'category' | 'customer'; op: 'upsert' | 'delete'; id: number; row?: Product };
type ChangePage = { changes: Change[]; next: number; has_more: boolean };

const putProduct = async (db: Db, p: Product) => {
  await db.run(`INSERT OR REPLACE INTO products (product_id, name, s, data) VALUES (?,?,?,?)`, [p.product_id, p.name, textOf(p), JSON.stringify(p)]);
  await db.run(`DELETE FROM barcodes WHERE product_id = ?`, [p.product_id]);
  for (const b of p.barcodes || []) await db.run(`INSERT OR REPLACE INTO barcodes (barcode, product_id) VALUES (?,?)`, [b, p.product_id]);
};
/* A full download writes many rows: a few hundred per statement, because every statement on a phone crosses into native code. */
const CHUNK = 200;
const putMany = async (db: Db, rows: Product[]) => {
  for (let i = 0; i < rows.length; i += CHUNK) {
    const part = rows.slice(i, i + CHUNK);
    await db.run(`INSERT OR REPLACE INTO products (product_id, name, s, data) VALUES ${part.map(() => '(?,?,?,?)').join(',')}`,
      part.flatMap((p) => [p.product_id, p.name, textOf(p), JSON.stringify(p)]));
    const codes = part.flatMap((p) => (p.barcodes || []).map((b) => [b, p.product_id] as const));
    for (let j = 0; j < codes.length; j += CHUNK) {
      const bit = codes.slice(j, j + CHUNK);
      await db.run(`INSERT OR REPLACE INTO barcodes (barcode, product_id) VALUES ${bit.map(() => '(?,?)').join(',')}`, bit.flatMap(([b, id]) => [b, id]));
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
    await db.tx(async (t) => {
      await t.run(`DELETE FROM barcodes`); await t.run(`DELETE FROM products`);
      await putMany(t, rows);
      await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('head', ?)`, [String(head)]);
      await t.run(`INSERT OR REPLACE INTO meta (k, v) VALUES ('synced_at', ?)`, [String(Date.now())]);
    });
    return { mode: 'full' as const, products: rows.length };
  };

  const catchUp = async (api: Api, since: number) => {
    let at = since; let applied = 0;
    for (;;) {
      const page = await api.get<ChangePage>(`/sync/changes?since=${at}&limit=500`);
      await db.tx(async (t) => {
        for (const c of page.changes) {
          if (c.entity !== 'product') continue;          // categories and customers are not used by the till yet
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
      if (head === null) result = await full(api, onProgress);
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

    /** Every word typed must appear somewhere in the name, SKU, barcode or category; names that start with the text come first. */
    search: async (text: string, limit = 40): Promise<Product[]> => {
      const words = text.toLowerCase().split(/\s+/).filter(Boolean);
      const where = words.length ? `WHERE ${words.map(() => `s LIKE ? ESCAPE '\\'`).join(' AND ')}` : '';
      const order = words.length ? `ORDER BY (name LIKE ? ESCAPE '\\') DESC, name` : 'ORDER BY name';
      const params = [...words.map(like), ...(words.length ? [`${words[0].replace(/[\\%_]/g, (c) => `\\${c}`)}%`] : []), limit];
      return (await db.all<{ data: string }>(`SELECT data FROM products ${where} ${order} LIMIT ?`, params)).map((r) => JSON.parse(r.data) as Product);
    },

    clear: async () => { await db.run(`DELETE FROM barcodes`); await db.run(`DELETE FROM products`); await db.run(`DELETE FROM groups`); await db.run(`DELETE FROM meta WHERE k IN ('head','synced_at','groups_at')`); }
  };
};

export type Catalog = ReturnType<typeof createCatalog>;
