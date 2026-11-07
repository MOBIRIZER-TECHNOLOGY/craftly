/**
 * IndexedDB helpers for the tests of src/core and src/render that do not need the editor: the same wipe as
 * `clearLibrary()` in helpers.tsx, without pulling the whole editor into the import graph.
 */
import { openDb } from "@/core/persistence";

/** Empty every store of the (fake) IndexedDB. */
export async function wipeDatabase(): Promise<void> {
  const db = await openDb();
  await Promise.all(
    Array.from(db.objectStoreNames).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = db.transaction(name, "readwrite").objectStore(name).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
}

/** A small file for the upload paths. */
export function fakeFile(name: string, type: string, content = "x"): File {
  return new File([content], name, { type });
}
