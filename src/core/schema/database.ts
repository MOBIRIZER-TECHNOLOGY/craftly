/**
 * Opens an IndexedDB database and brings it to the newest version by running the steps it has not had yet. Step n takes
 * the database from version n - 1 to n (version 0 is "no database"), so the database version is the number of steps. IndexedDB
 * runs all the steps of one open in a single upgrade transaction: when a step throws, the transaction is cancelled and the
 * database stays exactly as it was.
 *
 * Two things only show when a second tab is open, and both are handled here (docs/MIGRATIONS.md):
 *   - a tab that upgrades the database waits until every other connection has closed. A tab that runs this code closes its
 *     own connection when it is asked to (after the app had a moment to write what it holds), so the upgrade never hangs on it.
 *     A tab of an older release has no such handler: `onBlocked` tells the one that waits.
 *   - a database that a newer release upgraded cannot be opened by an older one (the browser refuses, "VersionError"). That
 *     is the protection against older code writing over newer data; it becomes a `MigrationError` with a message to show.
 */
import { MigrationError } from "./migrator";

/** A step of a database upgrade: create a store or an index, or move records with `transaction`. Never edit a step that has shipped. */
export type DbStep = (db: IDBDatabase, transaction: IDBTransaction) => void;

export const DATABASE_NEWER_MESSAGE = "Your designs were saved by a newer version of Craftly than this one. Reload the page to get the newest version.";

export interface OpenDatabaseOptions {
  name: string;
  steps: readonly DbStep[];
  /** another connection (a tab of an older release) keeps the upgrade waiting; the open goes ahead when it closes */
  onBlocked?: () => void;
  /** another tab wants to upgrade (or delete) the database: called, and awaited for at most `graceMs`, before this connection is closed */
  onReplaced?: () => Promise<void> | void;
  /** this connection was closed, by `onReplaced` or by the browser; whatever holds it should open a new one the next time */
  onClosed?: () => void;
  /** how long the app may take in `onReplaced`; default 3 s */
  graceMs?: number;
}

export function openDatabase(options: OpenDatabaseOptions): Promise<IDBDatabase> {
  const { name, steps, onBlocked, onReplaced, onClosed, graceMs = 3000 } = options;
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined" || !indexedDB) {
      reject(new Error("IndexedDB is not available in this browser."));
      return;
    }
    const request = indexedDB.open(name, steps.length);
    let failure: MigrationError | null = null;

    request.onupgradeneeded = (event) => {
      const transaction = request.transaction as IDBTransaction;
      let version = event.oldVersion;
      try {
        for (; version < steps.length; version++) steps[version](request.result, transaction);
      } catch (cause) {
        failure = new MigrationError("failed", "library", "Craftly could not bring your saved designs up to date. They have not been changed.", { step: version + 1, cause });
        transaction.abort();
      }
    };
    request.onblocked = () => onBlocked?.();
    request.onerror = () => {
      const error = request.error;
      if (failure) reject(failure);
      else if (error?.name === "VersionError") reject(new MigrationError("newer", "library", DATABASE_NEWER_MESSAGE));
      else reject(error ?? new Error("Could not open the local database."));
    };
    request.onsuccess = () => {
      const db = request.result;
      db.onclose = () => onClosed?.();
      db.onversionchange = () => {
        const close = () => {
          db.close();
          onClosed?.();
        };
        if (!onReplaced) return close();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const gaveUp = new Promise<void>((resolveTimer) => {
          timer = setTimeout(resolveTimer, graceMs);
        });
        void Promise.race([Promise.resolve().then(onReplaced), gaveUp])
          .catch(() => undefined)
          .then(() => {
            clearTimeout(timer);
            close();
          });
      };
      resolve(db);
    };
  });
}
