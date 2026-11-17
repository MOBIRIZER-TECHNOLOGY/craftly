import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OpenDatabaseOptions } from "./schema/database";

/** How `openDb` uses the opener, with the opener replaced: every call is kept, and the test decides how it ends. */
const calls: OpenDatabaseOptions[] = [];
let outcomes: Array<() => Promise<IDBDatabase>> = [];
const fakeDb = (): IDBDatabase => ({ name: "fake" }) as unknown as IDBDatabase;

vi.mock("./schema/database", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./schema/database")>();
  return {
    ...actual,
    openDatabase: vi.fn((options: OpenDatabaseOptions) => {
      calls.push(options);
      return (outcomes.shift() ?? (() => Promise.resolve(fakeDb())))();
    }),
  };
});

/** A promise that the test settles by hand. */
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function load() {
  vi.resetModules();
  return import("./persistence");
}

beforeEach(() => {
  calls.length = 0;
  outcomes = [];
});

describe("the steps of the database", () => {
  it("are the whole history: the version is the number of steps, and the first one makes the stores", async () => {
    const { DB_STEPS, DB_VERSION, openDb } = await load();
    expect(DB_VERSION).toBe(DB_STEPS.length);
    expect(DB_VERSION).toBe(2);
    await openDb();
    expect(calls[0]).toMatchObject({ name: "craftly", steps: DB_STEPS });

    const created: Array<[string, unknown]> = [];
    const db = { objectStoreNames: { contains: (name: string) => name === "assets" }, createObjectStore: (name: string, options: unknown) => created.push([name, options]) };
    DB_STEPS[0](db as unknown as IDBDatabase, undefined as unknown as IDBTransaction);
    expect(created).toEqual([
      ["designs", { keyPath: "id" }],
      ["summaries", { keyPath: "id" }],
      ["folders", { keyPath: "id" }],
      ["versions", { keyPath: "id" }],
      ["meta", undefined],
    ]);

    // the second makes the store of sync (docs/ACCOUNTS.md), and only when it is not there
    const second: Array<[string, unknown]> = [];
    const without = { objectStoreNames: { contains: () => false }, createObjectStore: (name: string, options: unknown) => second.push([name, options]) };
    DB_STEPS[1](without as unknown as IDBDatabase, undefined as unknown as IDBTransaction);
    expect(second).toEqual([["sync", { keyPath: "id" }]]);
  });
});

describe("openDb", () => {
  it("hands out one connection while it is open, and opens another after it was closed", async () => {
    const { openDb } = await load();
    const first = openDb();
    expect(openDb()).toBe(first);
    await first;
    expect(calls).toHaveLength(1);
    calls[0].onClosed?.();
    const second = openDb();
    expect(second).not.toBe(first);
    expect(calls).toHaveLength(2);
    // a late word from the old connection does not close the new one
    calls[0].onClosed?.();
    expect(openDb()).toBe(second);
    expect(calls).toHaveLength(2);
  });

  it("forgets an open that failed, so the next call tries again", async () => {
    const { openDb } = await load();
    outcomes.push(() => Promise.reject(new Error("no")));
    await expect(openDb()).rejects.toThrow("no");
    await expect(openDb()).resolves.toBeTruthy();
    expect(calls).toHaveLength(2);
  });
});

describe("watchDatabase", () => {
  it("tells a watcher that an upgrade is waiting for another tab, and that the wait is over", async () => {
    const { openDb, watchDatabase } = await load();
    const watcher = { blocked: vi.fn(), unblocked: vi.fn() };
    watchDatabase(watcher);
    const open = deferred<IDBDatabase>();
    outcomes.push(() => open.promise);
    const opening = openDb();
    calls[0].onBlocked?.();
    expect(watcher.blocked).toHaveBeenCalledTimes(1);
    expect(watcher.unblocked).not.toHaveBeenCalled();
    open.resolve(fakeDb());
    await opening;
    expect(watcher.unblocked).toHaveBeenCalledTimes(1);
  });

  it("also ends the wait when the open fails", async () => {
    const { openDb, watchDatabase } = await load();
    const watcher = { blocked: vi.fn(), unblocked: vi.fn() };
    watchDatabase(watcher);
    const open = deferred<IDBDatabase>();
    outcomes.push(() => open.promise);
    const opening = openDb();
    calls[0].onBlocked?.();
    open.reject(new Error("no"));
    await expect(opening).rejects.toThrow("no");
    expect(watcher.unblocked).toHaveBeenCalledTimes(1);
  });

  it("says nothing about a wait that never happened", async () => {
    const { openDb, watchDatabase } = await load();
    const watcher = { blocked: vi.fn(), unblocked: vi.fn() };
    watchDatabase(watcher);
    await openDb();
    expect(watcher.blocked).not.toHaveBeenCalled();
    expect(watcher.unblocked).not.toHaveBeenCalled();
  });

  it("lets every watcher settle before the connection is closed", async () => {
    const { openDb, watchDatabase } = await load();
    const slow = deferred<void>();
    const order: string[] = [];
    watchDatabase({
      replaced: async () => {
        await slow.promise;
        order.push("slow");
      },
    });
    watchDatabase({ replaced: () => void order.push("quick") });
    watchDatabase({}); // one that does not care
    await openDb();
    let finished = false;
    const settled = Promise.resolve(calls[0].onReplaced?.()).then(() => (finished = true));
    await Promise.resolve();
    expect(finished).toBe(false);
    slow.resolve();
    await settled;
    expect(order).toEqual(["quick", "slow"]);
  });

  it("stops telling a watcher that left", async () => {
    const { openDb, watchDatabase } = await load();
    const watcher = { blocked: vi.fn(), replaced: vi.fn() };
    const stop = watchDatabase(watcher);
    stop();
    await openDb();
    calls[0].onBlocked?.();
    await calls[0].onReplaced?.();
    expect(watcher.blocked).not.toHaveBeenCalled();
    expect(watcher.replaced).not.toHaveBeenCalled();
  });
});
