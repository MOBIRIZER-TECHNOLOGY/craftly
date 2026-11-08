/**
 * What the browser says about the storage it gives this site (how much is used, how much is allowed, whether it
 * promised not to clear it) and the one request Craftly can make about it: please keep my data.
 */
import { metaGet, metaSet } from "./persistence";

export interface StorageStatus {
  usage?: number;
  quota?: number;
  persisted?: boolean;
}

const browserStorage = (): StorageManager | undefined => (typeof navigator === "undefined" ? undefined : navigator.storage);

export async function storageStatus(storage: StorageManager | undefined = browserStorage()): Promise<StorageStatus> {
  if (!storage) return {};
  const [estimate, persisted] = await Promise.all([storage.estimate?.().catch(() => undefined), storage.persisted?.().catch(() => undefined)]);
  return { usage: estimate?.usage, quota: estimate?.quota, persisted };
}

/** Asks the browser not to clear our data when space runs low (Safari drops script-written data after a week otherwise). */
export async function requestPersistence(storage: StorageManager | undefined = browserStorage()): Promise<boolean> {
  if (!storage?.persist) return false;
  if (await storage.persisted?.()) return true;
  return storage.persist();
}

/** From this share of the allowed space on, saving is close to failing and a warning is due. */
const NEARLY_FULL = 0.8;

export function storageIsNearlyFull(status: StorageStatus): boolean {
  return status.usage !== undefined && status.quota !== undefined && status.quota > 0 && status.usage / status.quota >= NEARLY_FULL;
}

const ASKED_KEY = "persistenceAsked";
let askedThisVisit = false;

/**
 * Asks the browser, the first time something is saved, to keep the library: that is the moment there is something to
 * lose, and the moment a browser that wants to ask the person (Firefox) has a reason to. Once per browser, and never
 * while the browser has no way to be asked, so a later visit from a better one still can. A failure is no reason to
 * fail a save.
 */
export async function askForPersistentStorageOnce(storage: StorageManager | undefined = browserStorage()): Promise<void> {
  if (askedThisVisit || !storage?.persist) return;
  askedThisVisit = true;
  try {
    if (await metaGet<boolean>(ASKED_KEY, false)) return;
    await metaSet(ASKED_KEY, true);
    await requestPersistence(storage);
  } catch {
    /* the browser decides; the Back up & restore dialog shows the outcome and can ask again */
  }
}
