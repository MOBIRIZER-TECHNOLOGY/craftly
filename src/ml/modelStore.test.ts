import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deleteStoredModel, getStoredModel, isIntact, listInstalled, putStoredModel, requestPersistence, storageError, storageStatus } from "./modelStore";
import { getModelSpec } from "./registry";

const spec = { ...getModelSpec("isnet-general")!, bytes: 5, sha256: "a".repeat(64) };

beforeEach(async () => {
  for (const model of await listInstalled()) await deleteStoredModel(model.id);
});

describe("the model store", () => {
  it("starts empty", async () => {
    expect(await listInstalled()).toEqual([]);
    expect(await getStoredModel("isnet-general")).toBeUndefined();
  });

  it("keeps the bytes together with what the registry said about them", async () => {
    await putStoredModel(spec, new Blob([new Uint8Array([1, 2, 3, 4, 5])]), 1_700_000_000_000);
    const stored = await getStoredModel("isnet-general");
    expect(stored).toMatchObject({ id: "isnet-general", sha256: "a".repeat(64), bytes: 5, revision: spec.revision, installedAt: 1_700_000_000_000 });
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
  });

  it("lists installed models without their bytes", async () => {
    await putStoredModel(spec, new Blob(["12345"]));
    const [only] = await listInstalled();
    expect(only).toMatchObject({ id: "isnet-general", bytes: 5 });
    expect(only).not.toHaveProperty("blob");
  });

  it("replaces an older copy of the same model", async () => {
    await putStoredModel(spec, new Blob(["old!!"]));
    await putStoredModel({ ...spec, sha256: "b".repeat(64) }, new Blob(["new!!"]));
    expect(await listInstalled()).toHaveLength(1);
    expect((await getStoredModel("isnet-general"))?.sha256).toBe("b".repeat(64));
  });

  it("removes a model, and removing one that is not there is fine", async () => {
    await putStoredModel(spec, new Blob(["12345"]));
    await deleteStoredModel("isnet-general");
    expect(await getStoredModel("isnet-general")).toBeUndefined();
    await expect(deleteStoredModel("isnet-general")).resolves.toBeUndefined();
  });
});

describe("isIntact", () => {
  const record = (sha256: string, size: number | undefined) => ({ sha256, blob: { size } });

  it("accepts the pinned file", () => {
    expect(isIntact(record(spec.sha256, spec.bytes), spec)).toBe(true);
  });

  it("refuses a record made for another file, or whose bytes are not the pinned size", () => {
    expect(isIntact(record("0".repeat(64), spec.bytes), spec)).toBe(false);
    expect(isIntact(record(spec.sha256, spec.bytes - 1), spec)).toBe(false);
  });

  it("does not insist on a size the environment cannot give (jsdom loses it in fake IndexedDB)", () => {
    expect(isIntact(record(spec.sha256, undefined), spec)).toBe(true);
  });
});

describe("storageError", () => {
  it("says 'quota' when the disk is full and 'storage' for anything else", () => {
    expect(storageError(new DOMException("full", "QuotaExceededError")).code).toBe("quota");
    expect(storageError(new Error("boom")).code).toBe("storage");
  });
});

describe("storage status", () => {
  it("reports usage, quota and whether the data is protected from clean-up", async () => {
    const storage = { estimate: async () => ({ usage: 10, quota: 100 }), persisted: async () => true } as unknown as StorageManager;
    expect(await storageStatus(storage)).toEqual({ usage: 10, quota: 100, persisted: true });
  });

  it("copes with a browser that has no storage API", async () => {
    expect(await storageStatus(undefined)).toEqual({});
  });

  it("asks the browser to keep the data, once", async () => {
    let asked = 0;
    const storage = {
      persisted: async () => asked > 0,
      persist: async () => {
        asked++;
        return true;
      },
    } as unknown as StorageManager;
    expect(await requestPersistence(storage)).toBe(true);
    expect(await requestPersistence(storage)).toBe(true);
    expect(asked).toBe(1);
  });

  it("says no when the browser cannot promise anything", async () => {
    expect(await requestPersistence(undefined)).toBe(false);
    const refusing = { persisted: async () => false, persist: async () => false } as unknown as StorageManager;
    expect(await requestPersistence(refusing)).toBe(false);
  });
});

describe("when the browser cannot keep the model", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("says 'storage' instead of failing in some other way when there is no IndexedDB", async () => {
    vi.resetModules();
    vi.stubGlobal("indexedDB", undefined);
    const fresh = await import("./modelStore");
    await expect(fresh.listInstalled()).rejects.toMatchObject({ code: "storage" });
  });

  it("says 'quota' when the disk is full, so the person is told to free some space", async () => {
    vi.resetModules();
    const full = new DOMException("The quota has been exceeded.", "QuotaExceededError");
    // a database that opens fine and then aborts every write the way a full disk does
    vi.stubGlobal("indexedDB", {
      open() {
        const request: Record<string, unknown> = {};
        const db = {
          transaction() {
            const transaction: Record<string, unknown> = { error: full };
            const store = {
              put() {
                queueMicrotask(() => (transaction.onabort as () => void)());
                return {};
              },
            };
            transaction.objectStore = () => store;
            return transaction;
          },
        };
        request.result = db;
        queueMicrotask(() => (request.onsuccess as () => void)());
        return request;
      },
    });
    const fresh = await import("./modelStore");
    await expect(fresh.putStoredModel(spec, new Blob(["12345"]))).rejects.toMatchObject({ code: "quota" });
  });

  it("keeps the bytes of a model in a browser whose database refuses a Blob (WebKit in a private window), and gives a Blob back", async () => {
    vi.resetModules();
    const kept = new Map<string, { id: string; blob: unknown }>();
    // a database that refuses every value holding a Blob the way WebKit does, and keeps anything else
    vi.stubGlobal("indexedDB", {
      open() {
        const request: Record<string, unknown> = {};
        request.result = {
          transaction() {
            const transaction: Record<string, unknown> = { error: null };
            const done = (ok: boolean) => queueMicrotask(() => (transaction[ok ? "oncomplete" : "onabort"] as () => void)());
            transaction.objectStore = () => ({
              put(value: { id: string; blob: unknown }) {
                const refused = value.blob instanceof Blob;
                if (refused) transaction.error = new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError");
                else kept.set(value.id, value);
                done(!refused);
                return {};
              },
              get(id: string) {
                const req = { result: kept.get(id) };
                done(true);
                return req;
              },
            });
            return transaction;
          },
        };
        queueMicrotask(() => (request.onsuccess as () => void)());
        return request;
      },
    });
    const fresh = await import("./modelStore");
    await fresh.putStoredModel(spec, new Blob([new Uint8Array([1, 2, 3, 4, 5])], { type: "application/octet-stream" }));
    expect(kept.get(spec.id)?.blob).not.toBeInstanceOf(Blob);
    const stored = await fresh.getStoredModel(spec.id);
    expect(stored!.blob).toBeInstanceOf(Blob);
    expect(stored!.blob.type).toBe("application/octet-stream");
    expect(new Uint8Array(await stored!.blob.arrayBuffer())).toEqual(new Uint8Array([1, 2, 3, 4, 5]));
    expect(fresh.isIntact(stored!, spec)).toBe(true);
  });
});
