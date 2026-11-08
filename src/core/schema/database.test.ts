import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DATABASE_NEWER_MESSAGE, openDatabase, type DbStep } from "./database";
import { MigrationError } from "./migrator";

let counter = 0;
const nameOfTest = () => `migration-test-${++counter}`;
const open: IDBDatabase[] = [];
const names: string[] = [];

/** A database name of its own, deleted afterwards. */
function freshName(): string {
  const name = nameOfTest();
  names.push(name);
  return name;
}

async function opened(promise: Promise<IDBDatabase>): Promise<IDBDatabase> {
  const db = await promise;
  open.push(db);
  return db;
}

afterEach(async () => {
  vi.unstubAllGlobals();
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

const read = (db: IDBDatabase, store: string) => done(db.transaction(store).objectStore(store).getAll());
const write = (db: IDBDatabase, store: string, value: unknown) => done(db.transaction(store, "readwrite").objectStore(store).put(value));
const storesOf = (db: IDBDatabase) => Array.from(db.objectStoreNames).sort();
const later = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const createA: DbStep = (db) => {
  db.createObjectStore("a", { keyPath: "id" });
};
const createB: DbStep = (db) => {
  db.createObjectStore("b", { keyPath: "id" });
};
/** copies every record of "a" into "b" with a flag, inside the upgrade transaction */
const copyAToB: DbStep = (_db, tx) => {
  tx.objectStore("a").getAll().onsuccess = (event) => {
    for (const record of (event.target as IDBRequest<Array<{ id: string }>>).result) tx.objectStore("b").put({ ...record, copied: true });
  };
};

async function failureOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected the open to fail");
}

describe("a new database", () => {
  it("runs every step, in order, and is at the version of the last one", async () => {
    const order: string[] = [];
    const steps: DbStep[] = [
      (db) => {
        order.push("1");
        db.createObjectStore("a", { keyPath: "id" });
      },
      (db) => {
        order.push("2");
        db.createObjectStore("b", { keyPath: "id" });
      },
    ];
    const db = await opened(openDatabase({ name: freshName(), steps }));
    expect(order).toEqual(["1", "2"]);
    expect(db.version).toBe(2);
    expect(storesOf(db)).toEqual(["a", "b"]);
  });
});

describe("an existing database", () => {
  it("runs only the steps after the version it has, and keeps its data", async () => {
    const name = freshName();
    const first = vi.fn(createA);
    const db1 = await opened(openDatabase({ name, steps: [first] }));
    await write(db1, "a", { id: "x", text: "kept" });
    db1.close();

    const second = vi.fn(createB);
    const third = vi.fn(copyAToB);
    const db2 = await opened(openDatabase({ name, steps: [first, second, third] }));
    expect(db2.version).toBe(3);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(third).toHaveBeenCalledTimes(1);
    expect(await read(db2, "a")).toEqual([{ id: "x", text: "kept" }]);
    expect(await read(db2, "b")).toEqual([{ id: "x", text: "kept", copied: true }]);
  });

  it("opens as it is when it is already at the newest version, running nothing", async () => {
    const name = freshName();
    const step = vi.fn(createA);
    (await opened(openDatabase({ name, steps: [step] }))).close();
    const db = await opened(openDatabase({ name, steps: [step] }));
    expect(step).toHaveBeenCalledTimes(1);
    expect(db.version).toBe(1);
  });
});

describe("a step that throws", () => {
  it("cancels the whole upgrade, keeps the database as it was, and says which step it was", async () => {
    const name = freshName();
    const db1 = await opened(openDatabase({ name, steps: [createA] }));
    await write(db1, "a", { id: "x" });
    db1.close();

    const boom = new Error("boom");
    const broken: DbStep = () => {
      throw boom;
    };
    const error = await failureOf(openDatabase({ name, steps: [createA, createB, broken] }));
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ code: "failed", kind: "library", step: 3, cause: boom });
    expect((error as Error).message).toContain("up to date");

    // nothing of the second step is left, and the data is as it was
    const db2 = await opened(openDatabase({ name, steps: [createA] }));
    expect(db2.version).toBe(1);
    expect(storesOf(db2)).toEqual(["a"]);
    expect(await read(db2, "a")).toEqual([{ id: "x" }]);
  });
});

describe("a database that a newer Craftly upgraded", () => {
  it("is not opened, and the message says why", async () => {
    const name = freshName();
    (await opened(openDatabase({ name, steps: [createA, createB] }))).close();
    const error = await failureOf(openDatabase({ name, steps: [createA] }));
    expect(error).toBeInstanceOf(MigrationError);
    expect(error).toMatchObject({ code: "newer", kind: "library" });
    expect((error as Error).message).toBe(DATABASE_NEWER_MESSAGE);
    // and it was not touched
    const db = await opened(openDatabase({ name, steps: [createA, createB] }));
    expect(db.version).toBe(2);
  });
});

describe("another tab with an older connection", () => {
  it("keeps the upgrade waiting; the opener is told, and goes ahead when that connection closes", async () => {
    const name = freshName();
    // a connection that does not give way: what a tab of a release without the handler does
    const stubborn = await new Promise<IDBDatabase>((resolve) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore("a", { keyPath: "id" });
      request.onsuccess = () => resolve(request.result);
    });
    const onBlocked = vi.fn();
    const pending = opened(openDatabase({ name, steps: [createA, createB], onBlocked }));
    await later(60);
    expect(onBlocked).toHaveBeenCalledTimes(1);
    stubborn.close();
    const db = await pending;
    expect(db.version).toBe(2);
    expect(storesOf(db)).toEqual(["a", "b"]);
  });
});

describe("this connection when another tab upgrades", () => {
  it("lets the app write what it has, then closes so the upgrade can go ahead", async () => {
    const name = freshName();
    const events: string[] = [];
    const onClosed = vi.fn(() => events.push("closed"));
    const old = await opened(
      openDatabase({
        name,
        steps: [createA],
        onClosed,
        onReplaced: async () => {
          events.push("replaced");
          await write(old, "a", { id: "last", text: "written while the other tab waited" });
          events.push("written");
        },
      }),
    );
    const upgraded = await opened(openDatabase({ name, steps: [createA, createB] }));
    expect(events).toEqual(["replaced", "written", "closed"]);
    expect(upgraded.version).toBe(2);
    expect(await read(upgraded, "a")).toEqual([{ id: "last", text: "written while the other tab waited" }]);
    expect(() => old.transaction("a")).toThrow(); // closed
  });

  it("does not wait for ever for the app", async () => {
    const name = freshName();
    const started = Date.now();
    await opened(openDatabase({ name, steps: [createA], graceMs: 80, onReplaced: () => new Promise<void>(() => undefined) }));
    const upgraded = await opened(openDatabase({ name, steps: [createA, createB] }));
    expect(upgraded.version).toBe(2);
    expect(Date.now() - started).toBeGreaterThanOrEqual(70);
  });

  it("closes even when the app's handler fails", async () => {
    const name = freshName();
    const onClosed = vi.fn();
    await opened(
      openDatabase({
        name,
        steps: [createA],
        onClosed,
        onReplaced: () => Promise.reject(new Error("no")),
      }),
    );
    const upgraded = await opened(openDatabase({ name, steps: [createA, createB] }));
    expect(upgraded.version).toBe(2);
    expect(onClosed).toHaveBeenCalledTimes(1);
  });

  it("closes at once when there is no handler", async () => {
    const name = freshName();
    const old = await opened(openDatabase({ name, steps: [createA] }));
    const upgraded = await opened(openDatabase({ name, steps: [createA, createB] }));
    expect(upgraded.version).toBe(2);
    expect(() => old.transaction("a")).toThrow();
  });

  it("is told when the browser closes the connection by itself", async () => {
    const onClosed = vi.fn();
    const db = await opened(openDatabase({ name: freshName(), steps: [createA], onClosed }));
    db.onclose?.(new Event("close"));
    expect(onClosed).toHaveBeenCalledTimes(1);
  });
});

describe("when the browser cannot open the database", () => {
  it("says so when there is no IndexedDB at all", async () => {
    vi.stubGlobal("indexedDB", undefined);
    expect(await failureOf(openDatabase({ name: "x", steps: [createA] }))).toEqual(new Error("IndexedDB is not available in this browser."));
  });

  it("passes the browser's own error on, or a plain one when it gave none", async () => {
    const answers: Array<DOMException | null> = [new DOMException("denied", "SecurityError"), null];
    vi.stubGlobal("indexedDB", {
      open: () => {
        const request = {} as IDBOpenDBRequest;
        const error = answers.shift() ?? null;
        queueMicrotask(() => {
          Object.defineProperty(request, "error", { value: error });
          request.onerror?.(new Event("error"));
        });
        return request;
      },
    });
    const first = await failureOf(openDatabase({ name: "x", steps: [createA] }));
    expect((first as DOMException).name).toBe("SecurityError");
    expect(await failureOf(openDatabase({ name: "x", steps: [createA] }))).toEqual(new Error("Could not open the local database."));
  });
});
