import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { wipeDatabase } from "@/test/logicDb";
import { dbDelete, dbDeleteMany, dbGet, dbGetAll, dbPut, dbPutMany, metaGet, metaSet, openDb } from "./persistence";

describe("the local database", () => {
  beforeEach(async () => {
    await wipeDatabase();
  });

  it("has a store for each kind of data, named craftly", async () => {
    const db = await openDb();
    expect(db.name).toBe("craftly");
    expect(db.version).toBe(1);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(["assets", "designs", "folders", "meta", "summaries", "versions"]);
  });

  it("keys every store by id except the settings store, which takes its keys from the caller", async () => {
    const db = await openDb();
    const keyPath = (name: string) => db.transaction(name, "readonly").objectStore(name).keyPath;
    expect(keyPath("designs")).toBe("id");
    expect(keyPath("summaries")).toBe("id");
    expect(keyPath("folders")).toBe("id");
    expect(keyPath("assets")).toBe("id");
    expect(keyPath("versions")).toBe("id");
    expect(keyPath("meta")).toBeNull();
  });

  it("opens the database once and hands the same connection to everyone", async () => {
    const first = openDb();
    expect(openDb()).toBe(first);
    expect(await first).toBe(await openDb());
  });

  it("stores a value and gets it back, or undefined when there is none", async () => {
    await dbPut("designs", { id: "d1", title: "One" });
    expect(await dbGet("designs", "d1")).toEqual({ id: "d1", title: "One" });
    expect(await dbGet("designs", "missing")).toBeUndefined();
  });

  it("replaces a value stored under the same id", async () => {
    await dbPut("folders", { id: "f", name: "Old" });
    await dbPut("folders", { id: "f", name: "New" });
    expect(await dbGetAll("folders")).toEqual([{ id: "f", name: "New" }]);
  });

  it("lists everything in a store, and nothing for an empty one", async () => {
    expect(await dbGetAll("folders")).toEqual([]);
    await dbPut("folders", { id: "a" });
    await dbPut("folders", { id: "b" });
    expect((await dbGetAll<{ id: string }>("folders")).map((f) => f.id).sort()).toEqual(["a", "b"]);
  });

  it("deletes one value, quietly when it is not there", async () => {
    await dbPut("folders", { id: "a" });
    await dbDelete("folders", "a");
    await dbDelete("folders", "never-existed");
    expect(await dbGetAll("folders")).toEqual([]);
  });

  it("deletes several values at once, and does nothing for an empty list", async () => {
    for (const id of ["a", "b", "c"]) await dbPut("versions", { id });
    await dbDeleteMany("versions", ["a", "c", "missing"]);
    expect(await dbGetAll("versions")).toEqual([{ id: "b" }]);
    await expect(dbDeleteMany("versions", [])).resolves.toBeUndefined();
    expect(await dbGetAll("versions")).toEqual([{ id: "b" }]);
  });

  it("writes to several stores in one transaction", async () => {
    await dbPutMany([
      { store: "designs", value: { id: "d" } },
      { store: "summaries", value: { id: "d", title: "T" } },
      { store: "designs", value: { id: "e" } },
    ]);
    expect((await dbGetAll<{ id: string }>("designs")).map((d) => d.id).sort()).toEqual(["d", "e"]);
    expect(await dbGet("summaries", "d")).toEqual({ id: "d", title: "T" });
  });

  it("refuses a value that has no id, saying so", async () => {
    await expect(dbPut("designs", { title: "no id" })).rejects.toThrow();
    await expect(dbPutMany([{ store: "designs", value: { title: "no id" } }])).rejects.toThrow();
  });

  it("keeps settings under keys of its own, and hands back the fallback for a setting never saved", async () => {
    expect(await metaGet("theme", "light")).toBe("light");
    await metaSet("theme", "dark");
    expect(await metaGet("theme", "light")).toBe("dark");
    expect(await dbGet("meta", "theme")).toBe("dark");
  });

  it("does not mistake a saved falsy setting for a missing one", async () => {
    await metaSet("zero", 0);
    await metaSet("empty", "");
    await metaSet("off", false);
    await metaSet("none", null);
    expect(await metaGet("zero", 5)).toBe(0);
    expect(await metaGet("empty", "x")).toBe("");
    expect(await metaGet("off", true)).toBe(false);
    expect(await metaGet("none", "x")).toBeNull();
  });

  it("stores structured settings", async () => {
    await metaSet("kit", { colors: ["#fff"], logos: [] });
    expect(await metaGet("kit", null)).toEqual({ colors: ["#fff"], logos: [] });
  });
});

describe("when the database misbehaves", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  /** a fresh copy of the module, because it keeps its connection in module state */
  async function fresh() {
    vi.resetModules();
    return import("./persistence");
  }

  type Handler = (() => void) | null | undefined;
  const fire = (target: Record<string, unknown>, ...names: string[]) => {
    for (const name of names) (target[name] as Handler)?.();
  };

  it("says so when IndexedDB is not there, and tries again next time", async () => {
    vi.stubGlobal("indexedDB", undefined);
    const { openDb: open } = await fresh();
    await expect(open()).rejects.toThrow("IndexedDB is not available in this browser.");
    vi.unstubAllGlobals();
    await expect(open()).resolves.toBeDefined();
  });

  it("passes on the error the browser reports when the database cannot be opened", async () => {
    const reason = new Error("blocked by another tab");
    vi.stubGlobal("indexedDB", {
      open() {
        const request: Record<string, unknown> = { error: reason };
        queueMicrotask(() => fire(request, "onerror"));
        return request;
      },
    });
    const { openDb: open } = await fresh();
    await expect(open()).rejects.toBe(reason);
  });

  it("has a message of its own when the browser gives no reason", async () => {
    vi.stubGlobal("indexedDB", {
      open() {
        const request: Record<string, unknown> = { error: null };
        queueMicrotask(() => fire(request, "onerror"));
        return request;
      },
    });
    const { openDb: open } = await fresh();
    await expect(open()).rejects.toThrow("Could not open the local database.");
  });

  it("opens again after a failure instead of remembering it", async () => {
    let attempts = 0;
    const database = { objectStoreNames: { contains: () => true }, createObjectStore: vi.fn() };
    vi.stubGlobal("indexedDB", {
      open() {
        attempts++;
        const request: Record<string, unknown> = { error: new Error("first try fails") };
        queueMicrotask(() => {
          if (attempts === 1) fire(request, "onerror");
          else {
            request.result = database;
            fire(request, "onsuccess");
          }
        });
        return request;
      },
    });
    const { openDb: open } = await fresh();
    await expect(open()).rejects.toThrow("first try fails");
    await expect(open()).resolves.toBe(database);
    expect(attempts).toBe(2);
  });

  describe("a database whose reads and writes all fail", () => {
    const reason = new Error("disk full");

    function brokenDatabase() {
      const request = () => {
        const r: Record<string, unknown> = { error: reason };
        queueMicrotask(() => fire(r, "onerror"));
        return r;
      };
      const store = { get: request, getAll: request, put: request, delete: request };
      const database = {
        createObjectStore: vi.fn(),
        objectStoreNames: { contains: () => true },
        transaction: () => {
          const t: Record<string, unknown> = { error: reason, objectStore: () => store };
          queueMicrotask(() => fire(t, "onerror", "onabort"));
          return t;
        },
      };
      vi.stubGlobal("indexedDB", {
        open() {
          const r: Record<string, unknown> = {};
          queueMicrotask(() => {
            r.result = database;
            fire(r, "onupgradeneeded", "onsuccess");
          });
          return r;
        },
      });
      return database;
    }

    it("rejects every kind of read and write with the reason", async () => {
      const database = brokenDatabase();
      const db = await fresh();
      await expect(db.dbGet("designs", "d")).rejects.toBe(reason);
      await expect(db.dbGetAll("designs")).rejects.toBe(reason);
      await expect(db.dbPut("designs", { id: "d" })).rejects.toBe(reason);
      await expect(db.dbDelete("designs", "d")).rejects.toBe(reason);
      await expect(db.dbPutMany([{ store: "designs", value: { id: "d" } }])).rejects.toBe(reason);
      await expect(db.dbDeleteMany("designs", ["d"])).rejects.toBe(reason);
      await expect(db.metaGet("k", 1)).rejects.toBe(reason);
      await expect(db.metaSet("k", 1)).rejects.toBe(reason);
      // an upgrade that finds every store already there does not create them again
      expect(database.createObjectStore).not.toHaveBeenCalled();
    });
  });
});
