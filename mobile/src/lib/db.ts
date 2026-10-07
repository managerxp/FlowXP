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

type ExpoLike = {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: (string | number | null)[]): Promise<unknown>;
  getAllAsync<T>(sql: string, params: (string | number | null)[]): Promise<T[]>;
  withExclusiveTransactionAsync(task: (txn: ExpoLike) => Promise<void>): Promise<void>;
};

export const fromExpo = (db: ExpoLike): Db => ({
  exec: (sql) => db.execAsync(sql),
  run: async (sql, params = []) => { await db.runAsync(sql, params); },
  all: (sql, params = []) => db.getAllAsync(sql, params),
  tx: (work) => db.withExclusiveTransactionAsync((txn) => work(fromExpo(txn)))
});

/** Open (or create) a database file on the phone. Imported on demand so the tests, which never call this, need no phone libraries. */
export const openOnPhone = async (name: string): Promise<Db> => {
  const { openDatabaseAsync } = await import('expo-sqlite');
  return fromExpo((await openDatabaseAsync(name)) as unknown as ExpoLike);
};
