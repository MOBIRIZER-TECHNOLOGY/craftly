import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFile, wipeDatabase } from "@/test/logicDb";
import {
  ACCEPTED_IMAGE_TYPES,
  addAssetFromBlob,
  addAssetFromFile,
  assetSrc,
  deleteAsset,
  getAsset,
  getAssetUrl,
  isAcceptedImage,
  listAssets,
  renameAsset,
  subscribeAssets,
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

  it("tells subscribers about a new upload", async () => {
    const heard = vi.fn();
    const stop = subscribeAssets(heard);
    await addAssetFromFile(fakeFile("a.png", "image/png"));
    stop();
    await addAssetFromFile(fakeFile("b.png", "image/png"));
    expect(heard).toHaveBeenCalledTimes(1);
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
