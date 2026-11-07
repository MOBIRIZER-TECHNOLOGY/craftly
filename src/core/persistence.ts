/**
 * Minimal promise based IndexedDB wrapper. Stores:
 *  designs    full documents                (key: id)
 *  summaries  dashboard records             (key: id)
 *  folders    project folders               (key: id)
 *  assets     uploaded files as Blobs       (key: id)
 *  versions   design snapshots              (key: id = `${designId}:${ts}`)
 *  meta       small key/value settings      (key: string)
 */

export type StoreName = "designs" | "summaries" | "folders" | "assets" | "versions" | "meta";

const DB_NAME = "craftly";
const DB_VERSION = 1;
const STORES: StoreName[] = ["designs", "summaries", "folders", "assets", "versions", "meta"];

let dbPromise: Promise<IDBDatabase> | null = null;

export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const name of STORES) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, name === "meta" ? undefined : { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("Could not open the local database."));
  });
  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function dbGet<T>(store: StoreName, key: string): Promise<T | undefined> {
  const db = await openDb();
  return wrap<T | undefined>(db.transaction(store, "readonly").objectStore(store).get(key));
}

export async function dbGetAll<T>(store: StoreName): Promise<T[]> {
  const db = await openDb();
  return wrap<T[]>(db.transaction(store, "readonly").objectStore(store).getAll());
}

/** `key` is only used by the out-of-line `meta` store. */
export async function dbPut<T>(store: StoreName, value: T, key?: string): Promise<void> {
  const db = await openDb();
  await wrap(
    db
      .transaction(store, "readwrite")
      .objectStore(store)
      .put(value as never, key),
  );
}

export async function dbPutMany(writes: Array<{ store: StoreName; value: unknown }>): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction([...new Set(writes.map((w) => w.store))], "readwrite");
    for (const w of writes) tx.objectStore(w.store).put(w.value as never);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function dbDelete(store: StoreName, key: string): Promise<void> {
  const db = await openDb();
  await wrap(db.transaction(store, "readwrite").objectStore(store).delete(key));
}

export async function dbDeleteMany(store: StoreName, keys: string[]): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    for (const k of keys) tx.objectStore(store).delete(k);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function metaGet<T>(key: string, fallback: T): Promise<T> {
  const v = await dbGet<T>("meta", key);
  return v === undefined ? fallback : v;
}

export const metaSet = <T>(key: string, value: T) => dbPut("meta", value, key);
