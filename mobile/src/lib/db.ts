/*
 * The one thing the app asks of a database, so the same SQL runs on the phone (expo-sqlite) and in the tests (Node's own SQLite).
 * `tx` runs its steps as one transaction: all of them happen or none do (a download that stops half way leaves the old copy).
 */
export interface Db {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: (string | number | null)[]): Promise<void>;
  all<T = Record<string, unknown>>(sql: string, params?: (string | number | null)[]): Promise<T[]>;
  tx(work: (db: Db) => Promise<void>): Promise<void>;
}

export type ExpoLike = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: (string | number | null)[]): Promise<T[]>;
};

/*
 * One connection, one writer at a time. Every write (and every transaction) waits its turn in a queue, so two screens saving at once can
 * never overlap, and a transaction is a plain BEGIN / COMMIT on the same connection. (The phone library's "exclusive transaction" opens a
 * second connection to the same file, which is what produced "database is locked" and the native errors on a real phone.) Reads queue behind
 * them too (each write is a small step, so a read is never kept waiting long).
 */
export const fromExpo = (db: ExpoLike): Db => {
  let tail: Promise<unknown> = Promise.resolve();
  const turn = <T,>(work: () => Promise<T>): Promise<T> => { const next = tail.then(work, work); tail = next.catch(() => {}); return next; };
  const raw: Db = {
    exec: (sql) => db.execAsync(sql),
    run: async (sql, params = []) => { await db.runAsync(sql, params); },
    all: (sql, params = []) => db.getAllAsync(sql, params),
    tx: () => Promise.reject(new Error('A transaction cannot start inside another'))
  };
  return {
    exec: (sql) => turn(() => raw.exec(sql)),
    run: (sql, params) => turn(() => raw.run(sql, params)),
    // reads wait their turn too: on a real phone two statements on one connection at the same moment can fail inside the library
    all: (sql, params) => turn(() => raw.all(sql, params)),
    tx: (work) => turn(async () => {
      await raw.exec('BEGIN IMMEDIATE');
      try { await work(raw); await raw.exec('COMMIT'); }
      catch (e) { await raw.exec('ROLLBACK').catch(() => {}); throw e; }
    })
  };
};

const opening = new Map<string, Promise<Db>>();

/** Open (or create) a database file on the phone. Opened once per file even when two screens ask at the same moment (two opens at once is what
    locked it). Imported on demand so the tests, which never call this, need no phone libraries. */
export const openOnPhone = (name: string): Promise<Db> => {
  const kept = opening.get(name);
  if (kept) return kept;
  const made = (async () => {
    const { openDatabaseAsync } = await import('expo-sqlite');
    const db = fromExpo((await openDatabaseAsync(name)) as unknown as ExpoLike);
    await db.exec('PRAGMA busy_timeout = 8000');           // wait for a busy database instead of failing: first, before anything else
    // WAL lets reading go on during a write; if the phone will not switch (another opener, an old lock) the default mode works too
    await db.exec('PRAGMA journal_mode = WAL').catch(() => {});
    await db.exec('PRAGMA synchronous = NORMAL').catch(() => {});
    return db;
  })();
  opening.set(name, made);
  made.catch(() => opening.delete(name));
  return made;
};
