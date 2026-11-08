import "fake-indexeddb/auto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { metaGet } from "./persistence";
import { wipeDatabase } from "@/test/logicDb";
import { requestPersistence, storageIsNearlyFull, storageStatus, type StorageStatus } from "./storage";

type Stub = { estimate?: () => Promise<{ usage?: number; quota?: number }>; persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };
const manager = (stub: Stub) => stub as unknown as StorageManager;

beforeEach(async () => {
  await wipeDatabase();
});

describe("storageStatus", () => {
  it("reports how much is used, how much is allowed and whether the browser promised not to clear it", async () => {
    const status = await storageStatus(manager({ estimate: async () => ({ usage: 5, quota: 100 }), persisted: async () => true }));
    expect(status).toEqual({ usage: 5, quota: 100, persisted: true });
  });

  it("says nothing it does not know: no storage API, or calls that fail", async () => {
    expect(await storageStatus(undefined)).toEqual({});
    const failing = await storageStatus(
      manager({
        estimate: () => Promise.reject(new Error("no")),
        persisted: () => Promise.reject(new Error("no")),
      }),
    );
    expect(failing).toEqual({ usage: undefined, quota: undefined, persisted: undefined });
    expect(await storageStatus(manager({}))).toEqual({ usage: undefined, quota: undefined, persisted: undefined });
  });
});

describe("requestPersistence", () => {
  it("asks the browser, and reports its answer", async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistence(manager({ persisted: async () => false, persist }))).toBe(true);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await requestPersistence(manager({ persist: async () => false }))).toBe(false);
  });

  it("does not ask again when the browser already promised", async () => {
    const persist = vi.fn(async () => true);
    expect(await requestPersistence(manager({ persisted: async () => true, persist }))).toBe(true);
    expect(persist).not.toHaveBeenCalled();
  });

  it("says no when the browser cannot be asked", async () => {
    expect(await requestPersistence(undefined)).toBe(false);
    expect(await requestPersistence(manager({}))).toBe(false);
  });
});

describe("storageIsNearlyFull", () => {
  const status = (usage?: number, quota?: number): StorageStatus => ({ usage, quota });
  it("is true from four fifths of what the browser allows", () => {
    expect(storageIsNearlyFull(status(80, 100))).toBe(true);
    expect(storageIsNearlyFull(status(99, 100))).toBe(true);
    expect(storageIsNearlyFull(status(79, 100))).toBe(false);
  });
  it("cannot tell without both numbers", () => {
    expect(storageIsNearlyFull(status(undefined, 100))).toBe(false);
    expect(storageIsNearlyFull(status(100, undefined))).toBe(false);
    expect(storageIsNearlyFull(status(100, 0))).toBe(false);
    expect(storageIsNearlyFull({})).toBe(false);
  });
});

describe("askForPersistentStorageOnce", () => {
  /** a fresh copy of the module, as after a reload of the page: it forgets that it asked, the database does not */
  async function freshPage() {
    vi.resetModules();
    return import("./storage");
  }

  it("asks the browser to keep the library the first time, and remembers that it did", async () => {
    const persist = vi.fn(async () => true);
    const storage = manager({ persisted: async () => false, persist });
    const page = await freshPage();
    await page.askForPersistentStorageOnce(storage);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(await metaGet("persistenceAsked", false)).toBe(true);

    await page.askForPersistentStorageOnce(storage); // the same visit
    expect(persist).toHaveBeenCalledTimes(1);

    await (await freshPage()).askForPersistentStorageOnce(storage); // a later visit
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("does not ask while the browser cannot be asked, so it can ask the next time", async () => {
    const page = await freshPage();
    await page.askForPersistentStorageOnce(undefined);
    await page.askForPersistentStorageOnce(manager({}));
    expect(await metaGet("persistenceAsked", false)).toBe(false);
    const persist = vi.fn(async () => true);
    await page.askForPersistentStorageOnce(manager({ persisted: async () => false, persist }));
    expect(persist).toHaveBeenCalledTimes(1);
  });

  it("never lets an answer the browser will not give get in the way of saving", async () => {
    const persist = vi.fn(async () => {
      throw new Error("not allowed");
    });
    const page = await freshPage();
    await expect(page.askForPersistentStorageOnce(manager({ persisted: async () => false, persist }))).resolves.toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
  });
});
