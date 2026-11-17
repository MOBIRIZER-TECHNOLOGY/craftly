import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { contextOf } from "@/test/canvasMock";
import { fakeFile, wipeDatabase } from "@/test/logicDb";
import {
  ACCEPTED_IMAGE_TYPES,
  addAssetFromBlob,
  addAssetFromFile,
  assetSrc,
  checkUpload,
  deleteAsset,
  getAsset,
  getAssetUrl,
  isAcceptedImage,
  listAssets,
  renameAsset,
  subscribeAssets,
  subscribeFlattenedSvg,
  UNDRAWABLE_SVG_MESSAGE,
} from "./assets";

beforeEach(async () => {
  await wipeDatabase();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("which files are pictures", () => {
  it("accepts any file with an image type", () => {
    expect(isAcceptedImage(fakeFile("a.bin", "image/png"))).toBe(true);
    expect(isAcceptedImage(fakeFile("a", "image/whatever"))).toBe(true);
  });

  it("accepts a file with a picture extension when the browser gave no type", () => {
    for (const name of ["a.png", "A.JPG", "a.jpeg", "a.webp", "a.gif", "a.svg", "a.avif", "a.bmp"]) {
      expect(isAcceptedImage(fakeFile(name, "")), name).toBe(true);
    }
  });

  it("refuses everything else", () => {
    expect(isAcceptedImage(fakeFile("notes.txt", "text/plain"))).toBe(false);
    expect(isAcceptedImage(fakeFile("doc.pdf", "application/pdf"))).toBe(false);
    expect(isAcceptedImage(fakeFile("png", ""))).toBe(false);
    expect(isAcceptedImage(fakeFile("a.png.exe", ""))).toBe(false);
  });

  it("lists the types an upload field can ask for", () => {
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/svg+xml");
    expect(ACCEPTED_IMAGE_TYPES).toContain("image/png");
  });
});

describe("adding an upload", () => {
  it("stores a picture with its name, size and measured dimensions", async () => {
    const file = fakeFile("holiday photo.png", "image/png", "12345");
    const asset = await addAssetFromFile(file);
    expect(asset).toMatchObject({ name: "holiday photo", kind: "image", mime: "image/png", size: 5, width: 64, height: 48 });
    expect(asset.id).toMatch(/^a_/);
    expect(asset.createdAt).toBeGreaterThan(0);
    expect(asset.blob).toBe(file);
    const stored = await getAsset(asset.id);
    expect(stored?.name).toBe("holiday photo");
    // (the fake database cannot keep a real Blob, so the stored copy is only checked by its description)
    expect(stored).toMatchObject({ size: 5, mime: "image/png", kind: "image" });
  });

  it("measures an SVG from its viewBox instead of decoding it", async () => {
    const asset = await addAssetFromFile(fakeFile("logo.svg", "image/svg+xml", `<svg viewBox="0 0 120 40"><rect/></svg>`));
    expect(asset).toMatchObject({ kind: "svg", mime: "image/svg+xml", width: 120, height: 40 });
  });

  it("measures an SVG from its width and height when it has no viewBox", async () => {
    const asset = await addAssetFromFile(fakeFile("logo.svg", "image/svg+xml", `<svg width="300" height="150"/>`));
    expect([asset.width, asset.height]).toEqual([300, 150]);
  });

  it("falls back to decoding an SVG that has no size at all", async () => {
    const asset = await addAssetFromFile(fakeFile("shapeless.svg", "image/svg+xml", `<svg><rect/></svg>`));
    expect([asset.width, asset.height]).toEqual([64, 48]);
  });

  it("knows an SVG by its extension when the browser gave no type", async () => {
    const asset = await addAssetFromFile(fakeFile("logo.SVG", "", `<svg viewBox="0 0 10 20"/>`));
    expect(asset).toMatchObject({ kind: "svg", mime: "image/svg+xml", width: 10, height: 20 });
  });

  it("assumes PNG for a picture with no type", async () => {
    expect((await addAssetFromFile(fakeFile("mystery.bmp", ""))).mime).toBe("image/png");
  });

  it("calls a file with nothing but an extension an upload", async () => {
    expect((await addAssetFromFile(fakeFile(".png", "image/png"))).name).toBe("Upload");
    expect((await addAssetFromFile(fakeFile("archive.tar.gz", "image/png"))).name).toBe("archive.tar");
  });

  it("assumes 800 x 600 when the picture reports no size", async () => {
    const width = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    const height = vi.spyOn(HTMLImageElement.prototype, "naturalHeight", "get").mockReturnValue(0);
    const asset = await addAssetFromFile(fakeFile("empty.png", "image/png"));
    width.mockRestore();
    height.mockRestore();
    expect([asset.width, asset.height]).toEqual([800, 600]);
  });

  it("gives back the temporary address it made for measuring", async () => {
    const make = vi.spyOn(URL, "createObjectURL");
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await addAssetFromFile(fakeFile("a.png", "image/png"));
    expect(make).toHaveBeenCalledTimes(1);
    expect(revoke).toHaveBeenCalledWith(make.mock.results[0].value);
  });

  it("gives it back when the picture cannot be decoded, and says why", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("corrupt image"));
    await expect(addAssetFromFile(fakeFile("bad.png", "image/png"))).rejects.toThrow("corrupt image");
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(await listAssets()).toEqual([]);
  });

  it("fails, and tells nobody of a new upload, when the browser takes the picture and then has no room to keep it", async () => {
    const full = Object.assign(new Error("full"), { name: "QuotaExceededError" });
    // every write is taken, and the transaction is given up when it ends: the way a browser that is out of room behaves
    vi.spyOn(IDBDatabase.prototype, "transaction").mockImplementation(() => {
      const request = {} as IDBRequest;
      const tx = { error: full, objectStore: () => ({ put: () => request }) } as unknown as IDBTransaction;
      setTimeout(() => {
        request.onsuccess?.call(request, new Event("success"));
        setTimeout(() => tx.onabort?.call(tx, new Event("abort")), 0);
      }, 0);
      return tx;
    });
    const heard = vi.fn();
    const stop = subscribeAssets(heard);
    await expect(addAssetFromFile(fakeFile("big.png", "image/png"))).rejects.toBe(full);
    stop();
    expect(heard).not.toHaveBeenCalled();
  });

  it("tells subscribers about a new upload", async () => {
    const heard = vi.fn();
    const stop = subscribeAssets(heard);
    await addAssetFromFile(fakeFile("a.png", "image/png"));
    stop();
    await addAssetFromFile(fakeFile("b.png", "image/png"));
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

describe("an SVG that is more than plain drawing", () => {
  const STYLED = `<?xml version="1.0"?><svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><style>rect{fill:red}</style><rect width="120" height="40"/></svg>`;
  const SCRIPTED = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><script>alert(document.domain)</script></svg>`;
  /** The canvas the picture was drawn on: the only one the upload made. */
  const drawnOn = (make: { mock: { results: Array<{ value: unknown }> } }) =>
    make.mock.results.map((r) => r.value).find((el): el is HTMLCanvasElement => el instanceof HTMLCanvasElement) as HTMLCanvasElement;

  it("keeps a plain drawing as the SVG it is, under the SVG type and no other", async () => {
    const file = fakeFile("logo.svg", "image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><rect width="120" height="40"/></svg>`);
    const asset = await addAssetFromFile(file);
    expect(asset.blob).toBe(file);
    expect((await addAssetFromFile(fakeFile("logo.svg", "", `<svg viewBox="0 0 10 20"/>`))).blob.type).toBe("image/svg+xml");
    expect((await addAssetFromFile(fakeFile("logo.svg", "image/svg+xml;charset=utf-8", `<svg viewBox="0 0 10 20"/>`))).blob.type).toBe("image/svg+xml");
  });

  it.each([
    ["a style sheet and an XML declaration", STYLED],
    ["a script", SCRIPTED],
    ["a handler", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40" onload="alert(1)"/>`],
    ["a picture from the web", `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 40"><image href="https://example.test/a.png"/></svg>`],
  ])("stores an SVG with %s as a PNG picture, not as an SVG", async (_what, markup) => {
    const asset = await addAssetFromFile(fakeFile("badge.svg", "image/svg+xml", markup));
    expect(asset).toMatchObject({ name: "badge", kind: "image", mime: "image/png", width: 1024, height: 341 });
    expect(asset.blob.type).toBe("image/png");
    expect(asset.size).toBe(asset.blob.size);
    expect(await asset.blob.text()).not.toContain("<svg");
    expect(await listAssets()).toMatchObject([{ kind: "image", mime: "image/png" }]);
  });

  it("draws it through an image element onto a canvas of the size it is stored at", async () => {
    const make = vi.spyOn(document, "createElement");
    const asset = await addAssetFromFile(fakeFile("badge.svg", "image/svg+xml", STYLED));
    const canvas = drawnOn(make);
    expect([canvas.width, canvas.height]).toEqual([asset.width, asset.height]);
    const [[image, x, y, w, h]] = contextOf(canvas)!.callsTo("drawImage");
    expect(image).toBeInstanceOf(HTMLImageElement);
    expect([x, y, w, h]).toEqual([0, 0, 1024, 341]);
  });

  it("draws a very large one no bigger than 2048 pixels a side, and a small one at 1024", async () => {
    const big = await addAssetFromFile(fakeFile("big.svg", "image/svg+xml", STYLED.replace("0 0 120 40", "0 0 20000 10000")));
    expect([big.width, big.height]).toEqual([2048, 1024]);
    const thin = await addAssetFromFile(fakeFile("thin.svg", "image/svg+xml", STYLED.replace("0 0 120 40", "0 0 30000 1")));
    expect([thin.width, thin.height]).toEqual([2048, 1]);
    const medium = await addAssetFromFile(fakeFile("medium.svg", "image/svg+xml", STYLED.replace("0 0 120 40", "0 0 800 600")));
    expect([medium.width, medium.height]).toEqual([1600, 1200]);
  });

  it("takes the size the browser found when the markup states none", async () => {
    const asset = await addAssetFromFile(fakeFile("shapeless.svg", "image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"><style/></svg>`));
    expect([asset.width, asset.height]).toEqual([1024, 768]);
  });

  it("knows an SVG by its extension or by a type with more words in it, whatever the other says", async () => {
    expect((await addAssetFromFile(fakeFile("a.svg", "text/html", SCRIPTED))).blob.type).toBe("image/png");
    expect((await addAssetFromFile(fakeFile("a.png", "image/svg+xml; charset=utf-8", SCRIPTED))).blob.type).toBe("image/png");
    expect((await addAssetFromBlob(new Blob([SCRIPTED], { type: "image/svg+xml" }))).mime).toBe("image/png");
  });

  it("stores a picture that came with a type that is no picture type as a PNG, never under that type", async () => {
    const asset = await addAssetFromFile(fakeFile("page.png", "text/html", "<script>alert(1)</script>"));
    expect(asset).toMatchObject({ kind: "image", mime: "image/png" });
    expect(asset.blob.type).toBe("image/png");
  });

  it("refuses one that cannot be drawn, in plain words, stores nothing and gives its temporary address back", async () => {
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    vi.spyOn(HTMLImageElement.prototype, "decode").mockRejectedValue(new Error("not an image"));
    await expect(addAssetFromFile(fakeFile("bad.svg", "image/svg+xml", SCRIPTED))).rejects.toThrow(UNDRAWABLE_SVG_MESSAGE);
    expect(revoke).toHaveBeenCalledTimes(1);
    expect(await listAssets()).toEqual([]);
  });

  it("refuses one that has no size at all", async () => {
    vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(0);
    await expect(addAssetFromFile(fakeFile("empty.svg", "image/svg+xml", `<svg xmlns="http://www.w3.org/2000/svg"><style/></svg>`))).rejects.toThrow(UNDRAWABLE_SVG_MESSAGE);
    expect(await listAssets()).toEqual([]);
  });

  it("refuses one whose drawing the browser will not hand out", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    await expect(addAssetFromFile(fakeFile("locked.svg", "image/svg+xml", SCRIPTED))).rejects.toThrow(UNDRAWABLE_SVG_MESSAGE);
    expect(await listAssets()).toEqual([]);
  });

  it("tells whoever listens each time an SVG was stored as a picture, and not for a plain one", async () => {
    const heard = vi.fn();
    const stop = subscribeFlattenedSvg(heard);
    await addAssetFromFile(fakeFile("plain.svg", "image/svg+xml", `<svg viewBox="0 0 10 20"/>`));
    await addAssetFromFile(fakeFile("photo.png", "image/png"));
    expect(heard).not.toHaveBeenCalled();
    await addAssetFromFile(fakeFile("styled.svg", "image/svg+xml", STYLED));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    await addAssetFromFile(fakeFile("styled.svg", "image/svg+xml", STYLED));
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it("checks a picture without measuring it, for a backup that already knows the size", async () => {
    const decode = vi.spyOn(HTMLImageElement.prototype, "decode");
    const png = new Blob(["x"], { type: "image/png" });
    expect(await checkUpload(png)).toEqual({ blob: png, kind: "image", mime: "image/png" });
    const plain = await checkUpload(new Blob([`<svg viewBox="0 0 10 20"/>`], { type: "image/svg+xml" }));
    expect(plain).toMatchObject({ kind: "svg", mime: "image/svg+xml" });
    expect(decode).not.toHaveBeenCalled();
    expect(await checkUpload(new Blob([STYLED], { type: "image/svg+xml" }))).toMatchObject({ kind: "image", mime: "image/png", drawn: { width: 1024, height: 341 } });
  });
});

describe("pasted and dropped images", () => {
  it("stores a blob under a name made from its type", async () => {
    const asset = await addAssetFromBlob(new Blob(["x"], { type: "image/jpeg" }));
    expect(asset).toMatchObject({ name: "Pasted image", mime: "image/jpeg", kind: "image" });
  });

  it("uses the name it is given, and svg for an svg blob", async () => {
    const asset = await addAssetFromBlob(new Blob([`<svg viewBox="0 0 5 5"/>`], { type: "image/svg+xml" }), "Clipboard");
    expect(asset).toMatchObject({ name: "Clipboard", kind: "svg", width: 5, height: 5 });
  });

  it("treats a blob without a type as a PNG", async () => {
    const asset = await addAssetFromBlob(new Blob(["x"]));
    expect(asset.mime).toBe("image/png");
    expect(asset.kind).toBe("image");
  });
});

describe("the library of uploads", () => {
  it("lists the newest upload first", async () => {
    const old = await addAssetFromFile(fakeFile("old.png", "image/png"));
    await new Promise((r) => setTimeout(r, 5));
    const recent = await addAssetFromFile(fakeFile("recent.png", "image/png"));
    expect((await listAssets()).map((a) => a.id)).toEqual([recent.id, old.id]);
  });

  it("finds an upload by id, and answers null for an unknown one", async () => {
    const asset = await addAssetFromFile(fakeFile("a.png", "image/png"));
    expect((await getAsset(asset.id))?.id).toBe(asset.id);
    expect(await getAsset("nope")).toBeNull();
  });

  it("makes the reference a document stores", () => {
    expect(assetSrc("a_123")).toBe("asset:a_123");
  });

  it("renames an upload, keeping the old name for a blank one", async () => {
    const asset = await addAssetFromFile(fakeFile("a.png", "image/png"));
    await renameAsset(asset.id, "  Logo  ");
    expect((await getAsset(asset.id))?.name).toBe("Logo");
    await renameAsset(asset.id, "   ");
    expect((await getAsset(asset.id))?.name).toBe("Logo");
  });

  it("ignores renaming an upload that is not there", async () => {
    const heard = vi.fn();
    const stop = subscribeAssets(heard);
    await renameAsset("nope", "x");
    stop();
    expect(heard).not.toHaveBeenCalled();
    expect(await listAssets()).toEqual([]);
  });

  it("tells subscribers about renames and deletes", async () => {
    const asset = await addAssetFromFile(fakeFile("a.png", "image/png"));
    const heard = vi.fn();
    const stop = subscribeAssets(heard);
    await renameAsset(asset.id, "b");
    await deleteAsset(asset.id);
    stop();
    expect(heard).toHaveBeenCalledTimes(2);
    expect(await getAsset(asset.id)).toBeNull();
  });
});

describe("object addresses", () => {
  it("makes an address for an upload once and keeps it", async () => {
    const asset = await addAssetFromFile(fakeFile("a.png", "image/png"));
    const make = vi.spyOn(URL, "createObjectURL");
    const first = await getAssetUrl(asset.id);
    expect(first).toMatch(/^blob:/);
    expect(await getAssetUrl(asset.id)).toBe(first);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it("answers null for an upload that is not there", async () => {
    expect(await getAssetUrl("nope")).toBeNull();
  });

  it("gives the address back when the upload is deleted, and makes a new one if it returns", async () => {
    const asset = await addAssetFromFile(fakeFile("a.png", "image/png"));
    const url = await getAssetUrl(asset.id);
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await deleteAsset(asset.id);
    expect(revoke).toHaveBeenCalledWith(url);
    expect(await getAssetUrl(asset.id)).toBeNull();
  });

  it("deletes an upload nobody asked an address for", async () => {
    const asset = await addAssetFromFile(fakeFile("a.png", "image/png"));
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    await deleteAsset(asset.id);
    expect(revoke).not.toHaveBeenCalled();
    expect(await listAssets()).toEqual([]);
  });
});

describe("a browser whose database will not keep a Blob (WebKit in a private window)", () => {
  /** Makes the database refuse every value that holds a Blob, as WebKit does, and gives a fresh copy of the uploads module. */
  async function refusingBlobs() {
    const refuse = (value: unknown) => {
      if (value && typeof value === "object" && (value as { blob?: unknown }).blob instanceof Blob)
        throw new DOMException("Error preparing Blob/File data to be stored in object store", "UnknownError");
    };
    const put = IDBObjectStore.prototype.put;
    const add = IDBObjectStore.prototype.add;
    vi.spyOn(IDBObjectStore.prototype, "put").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      refuse(value);
      return put.call(this, value, key);
    });
    vi.spyOn(IDBObjectStore.prototype, "add").mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      refuse(value);
      return add.call(this, value, key);
    });
    vi.resetModules();
    return import("./assets");
  }

  it("stores the bytes of an upload instead, and gives a Blob of the same bytes and type back", async () => {
    const fresh = await refusingBlobs();
    const asset = await fresh.addAssetFromFile(fakeFile("logo.png", "image/png", "12345"));
    const stored = await fresh.getAsset(asset.id);
    expect(stored!.blob).toBeInstanceOf(Blob);
    expect(stored!.blob.type).toBe("image/png");
    expect(await stored!.blob.text()).toBe("12345");
    const [listed] = await fresh.listAssets();
    expect(await listed.blob.text()).toBe("12345");
    await fresh.renameAsset(asset.id, "Logo");
    expect((await fresh.getAsset(asset.id))!.name).toBe("Logo");
    expect(await (await fresh.getAsset(asset.id))!.blob.text()).toBe("12345");
  });

  it("keeps a restored or shared upload the same way", async () => {
    const fresh = await refusingBlobs();
    const asset = { ...(await fresh.prepareAssetFromFile(fakeFile("a.png", "image/png", "abc"), "a_restored")) };
    await fresh.restoreAssets([asset]);
    await fresh.cacheSharedAsset({ ...asset, id: "a_shared" });
    expect(await (await fresh.getAsset("a_restored"))!.blob.text()).toBe("abc");
    expect(await (await fresh.getAsset("a_shared"))!.blob.text()).toBe("abc");
  });
});

describe("asking the database whether it keeps a Blob", () => {
  it("leaves nothing behind in a browser that keeps one: the upload is the only record", async () => {
    vi.resetModules();
    const fresh = await import("./assets");
    const file = fakeFile("a.png", "image/png");
    const asset = await fresh.addAssetFromFile(file);
    expect((await fresh.listAssets()).map((a) => a.id)).toEqual([asset.id]);
  });
});
