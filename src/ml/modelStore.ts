/**
 * Where installed models live: their own IndexedDB, so the designs and uploads database is never touched. One record per
 * model holds the bytes next to the facts the registry pinned when they were stored.
 */
import { MlError } from "./errors";
import type { InstalledModel, ModelId, ModelSpec } from "./types";

const DB_NAME = "craftly-models";
const STORE = "models";

interface StoredModel extends InstalledModel {
  blob: Blob;
}

/** The disk being full is something the person can fix; every other storage failure is "the browser refused". */
export function storageError(error: unknown): MlError {
  if (error instanceof MlError) return error;
  const full = typeof error === "object" && error !== null && (error as { name?: unknown }).name === "QuotaExceededError";
  return new MlError(full ? "quota" : "storage", undefined, { cause: error });
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise<IDBDatabase>((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new MlError("storage"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE, { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  opening.catch(() => {
    opening = null;
  });
  return opening;
}

/** Runs one request and resolves once its transaction has committed, so a resolved write is on disk. */
async function run<T>(mode: IDBTransactionMode, make: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const transaction = db.transaction(STORE, mode);
      const request = make(transaction.objectStore(STORE));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error ?? request.error);
      transaction.onabort = () => reject(transaction.error ?? request.error);
    });
  } catch (error) {
    throw storageError(error);
  }
}

/**
 * The bytes of a model as they are stored by a browser whose database will not keep a Blob: WebKit in a private window refuses
 * one ("Error preparing Blob/File data to be stored in object store"), but keeps an ArrayBuffer.
 */
interface StoredBytes {
  data: ArrayBuffer;
  type: string;
}
type StoredRecord = Omit<StoredModel, "blob"> & { blob: Blob | StoredBytes };

const withBlob = (record: StoredRecord): StoredModel =>
  record.blob instanceof Blob || !record.blob || !("data" in record.blob) ? (record as StoredModel) : { ...record, blob: new Blob([record.blob.data], { type: record.blob.type }) };

export async function putStoredModel(spec: ModelSpec, blob: Blob, now: number = Date.now()): Promise<void> {
  const record: StoredModel = { id: spec.id, sha256: spec.sha256, bytes: spec.bytes, revision: spec.revision, installedAt: now, blob };
  try {
    await run("readwrite", (store) => store.put(record));
  } catch (error) {
    // a full disk stays full; a refused Blob is stored as its bytes
    if (!(error instanceof MlError) || error.code !== "storage") throw error;
    const bytes: StoredRecord = { ...record, blob: { data: await blob.arrayBuffer(), type: blob.type } };
    await run("readwrite", (store) => store.put(bytes));
  }
}

/** The stored copy is the file `spec` pins: made for it, and (where the environment can say) of the pinned size. */
export function isIntact(stored: { sha256: string; blob: { size?: number } }, spec: ModelSpec): boolean {
  if (stored.sha256 !== spec.sha256) return false;
  const size = stored.blob?.size;
  return size === undefined || size === spec.bytes;
}

export async function getStoredModel(id: ModelId): Promise<StoredModel | undefined> {
  const record = await run("readonly", (store) => store.get(id) as IDBRequest<StoredRecord | undefined>);
  return record && withBlob(record);
}

/** The installed models, without their bytes. */
export async function listInstalled(): Promise<InstalledModel[]> {
  const all = await run("readonly", (store) => store.getAll() as IDBRequest<StoredModel[]>);
  return all.map(({ id, sha256, bytes, revision, installedAt }) => ({ id, sha256, bytes, revision, installedAt }));
}

export async function deleteStoredModel(id: ModelId): Promise<void> {
  await run("readwrite", (store) => store.delete(id));
}

/* ---------------- how much room there is, and whether the browser may clear it ---------------- */

// what the browser says about the storage it gives this site, and the request to keep it, are shared with the library backup
export { requestPersistence, storageStatus, type StorageStatus } from "@/core/storage";
