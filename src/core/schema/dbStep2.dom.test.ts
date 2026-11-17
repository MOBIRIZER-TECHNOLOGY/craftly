/**
 * Database step 2 (docs/ACCOUNTS.md, docs/MIGRATIONS.md): a library as the first release left it, with records in every store,
 * is opened with the steps of this release. The `sync` store is made, nothing that was there moves or changes, and the records
 * read as they did, without a `space`.
 */
import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { DB_STEPS, DB_VERSION } from "../persistence";
import { openDatabase } from "./database";

const names: string[] = [];
const open: IDBDatabase[] = [];
let counter = 0;

afterEach(async () => {
  for (const db of open.splice(0)) db.close();
  for (const name of names.splice(0)) {
    await new Promise<void>((resolve) => {
      const request = indexedDB.deleteDatabase(name);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
});

const done = <T>(request: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

async function opened(name: string, steps = DB_STEPS) {
  const db = await openDatabase({ name, steps });
  open.push(db);
  return db;
}

const summary = {
  id: "d_old",
  title: "Old poster",
  typeId: "poster",
  width: 10,
  height: 10,
  pageCount: 1,
  createdAt: 1,
  updatedAt: 2,
  folderId: "f_old",
  starred: true,
  trashedAt: null,
  revision: "r1",
};
const folder = { id: "f_old", name: "Work", createdAt: 1, parentId: null };
const design = { id: "d_old", title: "Old poster", version: 1, pages: [] };

describe("database step 2", () => {
  it("is the last step: the database of this release is at version 2", () => {
    expect(DB_VERSION).toBe(2);
  });

  it("adds the sync store to a library of the first release and leaves every record where it was", async () => {
    const name = `step2-${++counter}`;
    names.push(name);
    const first = await opened(name, DB_STEPS.slice(0, 1));
    expect(Array.from(first.objectStoreNames)).not.toContain("sync");
    const tx = first.transaction(["summaries", "folders", "designs", "meta"], "readwrite");
    tx.objectStore("summaries").put(summary);
    tx.objectStore("folders").put(folder);
    tx.objectStore("designs").put(design);
    tx.objectStore("meta").put(["#ff0000"], "recentColors");
    await new Promise<void>((resolve) => (tx.oncomplete = () => resolve()));
    first.close();

    const db = await opened(name);
    expect(db.version).toBe(2);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(["assets", "designs", "folders", "meta", "summaries", "sync", "versions"]);
    const read = db.transaction(["summaries", "folders", "designs", "meta", "sync"]);
    expect(await done(read.objectStore("summaries").getAll())).toEqual([summary]);
    expect(await done(read.objectStore("folders").getAll())).toEqual([folder]);
    expect(await done(read.objectStore("designs").getAll())).toEqual([design]);
    expect(await done(read.objectStore("meta").get("recentColors"))).toEqual(["#ff0000"]);
    // nothing is on a server yet: the store is empty, and keyed by the design's id
    expect(await done(read.objectStore("sync").getAll())).toEqual([]);
    expect(read.objectStore("sync").keyPath).toBe("id");
  });

  it("makes a new library with every store at once", async () => {
    const name = `step2-${++counter}`;
    names.push(name);
    const db = await opened(name);
    expect(Array.from(db.objectStoreNames)).toContain("sync");
    const write = db.transaction("sync", "readwrite");
    write.objectStore("sync").put({ id: "d_1", space: "s", serverRev: 1, syncedRevision: "r", syncedMeta: null });
    await new Promise<void>((resolve) => (write.oncomplete = () => resolve()));
    expect(await done(db.transaction("sync").objectStore("sync").get("d_1"))).toMatchObject({ serverRev: 1 });
  });
});
