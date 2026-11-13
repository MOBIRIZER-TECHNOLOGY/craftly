/**
 * Minimal promise based IndexedDB wrapper. Stores:
 *  designs    full documents                (key: id)
 *  summaries  dashboard records             (key: id)
 *  folders    project folders               (key: id)
 *  assets     uploaded files as Blobs       (key: id)
 *  versions   design snapshots              (key: id = `${designId}:${ts}`)
 *  meta       small key/value settings      (key: string)
 *
 * Every store here is part of the library backup (src/export/backup.ts, docs/BACKUP.md), or is left out of it there on
 * purpose: when a store or a `meta` key is added, decide which.
 */

import { openDatabase, type DbStep } from "./schema/database";

export type StoreName = "designs" | "summaries" | "folders" | "assets" | "versions" | "meta";

const DB_NAME = "craftly";
const STORES: StoreName[] = ["designs", "summaries", "folders", "assets", "versions", "meta"];

/**
 * One step per version of the database: step n takes it from version n - 1 to n, and the version is the number of steps
 * (src/core/schema/database.ts runs them, all in one upgrade transaction). A step that has shipped is never edited: a new
 * store, an index, or records that have to move is the NEXT step, with a test that builds the database as the step before
 * it left it (docs/MIGRATIONS.md). Changes to what is inside a design are not made here but by a design migration.
 */
export const DB_STEPS: readonly DbStep[] = [
  // 1: the first release
  (db) => {
    for (const name of STORES) {
      if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, name === "meta" ? undefined : { keyPath: "id" });
    }
  },
];
export const DB_VERSION = DB_STEPS.length;

/** What the app wants to hear about a database that other tabs share (src/databaseNotices.ts shows it to the person). */
export interface DatabaseWatcher {
  /** a tab of an older release keeps an upgrade of the database waiting */
  blocked?(): void;
  /** that wait is over */
  unblocked?(): void;
  /** another tab upgrades the database: write what is unsaved now, this tab's connection is closed afterwards */
  replaced?(): Promise<void> | void;
}

const watchers = new Set<DatabaseWatcher>();

export function watchDatabase(watcher: DatabaseWatcher): () => void {
  watchers.add(watcher);
  return () => watchers.delete(watcher);
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  let waited = false;
  const opening: Promise<IDBDatabase> = openDatabase({
    name: DB_NAME,
    steps: DB_STEPS,
    onBlocked: () => {
      waited = true;
      watchers.forEach((watcher) => watcher.blocked?.());
    },
    onReplaced: () => Promise.all([...watchers].map((watcher) => watcher.replaced?.())).then(() => undefined),
    // the next call opens a new connection (and finds out whether the database is still one this release can use)
    onClosed: () => {
      if (dbPromise === opening) dbPromise = null;
    },
  });
  const finished = () => {
    if (waited) watchers.forEach((watcher) => watcher.unblocked?.());
  };
  opening.then(finished, finished);
  opening.catch(() => {
    dbPromise = null;
  });
  dbPromise = opening;
  return opening;
}

export function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function writeTransaction<T>(stores: StoreName[], write: (tx: IDBTransaction) => Promise<T>): Promise<T> {
  const tx = (await openDb()).transaction(stores, "readwrite");
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("The storage transaction was aborted."));
  });
  try {
    const [result] = await Promise.all([write(tx), done]);
    return result;
  } catch (error) {
    try {
      tx.abort();
    } catch {
      // The browser may already have ended the transaction.
    }
    throw error;
  }
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return wrap<T | undefined>(db.transaction(store, "readonly").objectStore(store).get(key));
}

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap<T[]>(db.transaction(store, "readonly").objectStore(store).getAll());
}

/** The keys of a store, without reading the values (a store of pictures stays on disk). */
export async function dbGetAllKeys(store: StoreName): Promise<string[]> {
  const db = await openDb();
  const keys = await wrap<IDBValidKey[]>(db.transaction(store, "readonly").objectStore(store).getAllKeys());
  return keys.map(String);
}

/**
 * Settles when the transaction does, not when a write in it was taken: a browser that has no room left takes the write and says
 * so only when the transaction ends, so until then nothing is stored. It always rejects with an error: the transaction's own, or
 * that of the write that failed (reported on the transaction first, while the transaction itself has none yet), or one that says
 * no more than that it was given up.
 */
function committed(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let failed: DOMException | null = null;
    tx.oncomplete = () => resolve();
    tx.onerror = (event) => {
      failed = (event.target as IDBRequest | null)?.error ?? failed;
    };
    // a write that fails gives the whole transaction up, so this is where every failure ends
    tx.onabort = () => reject(tx.error ?? failed ?? new Error("The storage transaction was aborted."));
  });
}

/** `key` is only used by the out-of-line `meta` store. */
export async function dbPut<T>(store: StoreName, value: T, key?: string): Promise<void> {
  const tx = (await openDb()).transaction(store, "readwrite");
  tx.objectStore(store).put(value as never, key);
  await committed(tx);
}

export async function dbPutMany(writes: Array<{ store: StoreName; value: unknown }>): Promise<void> {
  const tx = (await openDb()).transaction([...new Set(writes.map((w) => w.store))], "readwrite");
  for (const w of writes) tx.objectStore(w.store).put(w.value as never);
  await committed(tx);
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const tx = (await openDb()).transaction(store, "readwrite");
  tx.objectStore(store).delete(key);
  await committed(tx);
}

export async function dbDeleteMany(store: StoreName, keys: string[]): Promise<void> {
  const tx = (await openDb()).transaction(store, "readwrite");
  for (const k of keys) tx.objectStore(store).delete(k);
  await committed(tx);
}

export async function metaGet<T>(key: string, fallback: T): Promise<T> {
  const v = await dbGet<T>("meta", key);
  return v === undefined ? fallback : v;
}

export const metaSet = <T>(key: string, value: T) => dbPut("meta", value, key);
