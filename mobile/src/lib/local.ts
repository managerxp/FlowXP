/*
 * What this phone keeps for the outlet being worked in: its own SQLite file (so two outlets, or two businesses on one phone, never mix),
 * holding the catalogue copy and the outbox of unsent sales. Signing out does NOT delete it: unsent sales are real money and are sent
 * after the next sign-in. A second small file keeps app-level things that must work with no connection (who is signed in, their outlets).
 */
import { openOnPhone, type Db } from './db.ts';
import { SCHEMA as CATALOG_SCHEMA, createCatalog, type Catalog } from './catalog.ts';
import { SCHEMA as OUTBOX_SCHEMA, createOutbox, type Outbox } from './outbox.ts';
import { createStore, useStore } from './store.ts';

export type Scope = { key: string; db: Db; catalog: Catalog; outbox: Outbox };

/** Build the catalogue and outbox on any database (the phone's, or a test's). */
export const makeScope = async (key: string, db: Db): Promise<Scope> => {
  await db.exec(CATALOG_SCHEMA); await db.exec(OUTBOX_SCHEMA);
  return { key, db, catalog: createCatalog(db), outbox: createOutbox(db) };
};

export const scopeStore = createStore<{ scope: Scope | null }>({ scope: null });
export const useScope = () => useStore(scopeStore).scope;

export const openScope = async (businessId: number, branchId: number) => {
  const key = `b${businessId}-o${branchId}`;
  if (scopeStore.get().scope?.key === key) return scopeStore.get().scope!;
  const scope = await makeScope(key, await openOnPhone(`flowxp-${key}.db`));
  scopeStore.set({ scope });
  return scope;
};
export const closeScope = () => scopeStore.set({ scope: null });

let appDb: Promise<Db> | null = null;
const app = () => (appDb ??= openOnPhone('flowxp-app.db').then(async (db) => { await db.exec(`CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v TEXT)`); return db; }));
export const kvGet = async (k: string): Promise<string | null> => (await (await app()).all<{ v: string }>(`SELECT v FROM kv WHERE k = ?`, [k]))[0]?.v ?? null;
export const kvSet = async (k: string, v: string) => (await app()).run(`INSERT OR REPLACE INTO kv (k, v) VALUES (?,?)`, [k, v]);
