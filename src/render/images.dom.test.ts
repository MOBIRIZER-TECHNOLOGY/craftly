import { beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, assetSrc, deleteAsset, getAssetUrl } from "@/core/assets";
import { getPhotoImage, getPhotoThumb } from "@/data/photos";
import { fakeFile, wipeDatabase } from "@/test/logicDb";
import { drawableSize, getImage, getSvgImage, imageUrl, imagesEpoch, loadImage, loadSvgImage, onImagesChange } from "./images";

// painting a whole built-in photo on a recording canvas is slow and says nothing about image loading: the photo module has
// its own tests, here only the hand-over to it matters
vi.mock("@/data/photos", () => ({
  getPhotoImage: vi.fn(async (id: string) => {
    if (id === "missing") throw new Error(`Unknown builtin photo "${id}"`);
    const canvas = document.createElement("canvas");
    canvas.width = 160;
    canvas.height = 90;
    return canvas;
  }),
  getPhotoThumb: vi.fn(async (id: string) => `blob:thumb/${id}`),
}));

let serial = 0;
const url = (name = "img") => `https://example.test/${name}-${++serial}.png`;
const svg = (name = "g") => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" data-id="${name}-${++serial}"><rect width="10" height="10"/></svg>`;

beforeEach(async () => {
  await wipeDatabase();
});

describe("loadImage", () => {
  it("loads a picture from a web address and decodes it", async () => {
    const src = url();
    const image = (await loadImage(src)) as HTMLImageElement;
    expect(image).toBeInstanceOf(HTMLImageElement);
    expect(image.getAttribute("src")).toBe(src);
    expect(drawableSize(image)).toEqual({ width: 64, height: 48 });
    expect(image.decoding).toBe("async");
  });

  it("asks for cross-origin access only for web addresses", async () => {
    const web = (await loadImage(url())) as HTMLImageElement;
    expect(web.crossOrigin).toBe("anonymous");
    const inline = (await loadImage(`data:image/png;base64,AAAA${++serial}`)) as HTMLImageElement;
    expect(inline.crossOrigin).not.toBe("anonymous");
  });

  it("keeps what it loaded: the same picture is not fetched twice", async () => {
    const src = url();
    const first = await loadImage(src);
    expect(await loadImage(src)).toBe(first);
    expect(getImage(src)).toBe(first);
  });

  it("shares one load between callers that ask at the same time", async () => {
    const src = url();
    const done = vi.fn();
    const stop = onImagesChange(done);
    const [a, b, c] = await Promise.all([loadImage(src), loadImage(src), loadImage(src)]);
    stop();
    expect(a).toBe(b);
    expect(b).toBe(c);
    expect(done).toHaveBeenCalledTimes(1);
  });

  it("answers null for a picture that cannot be loaded, and remembers that", async () => {
    const src = url("broken");
    const before = imagesEpoch();
    expect(await loadImage(src)).toBeNull();
    expect(imagesEpoch()).toBe(before + 1);
    expect(await loadImage(src)).toBeNull();
    expect(imagesEpoch()).toBe(before + 1);
    expect(getImage(src)).toBeNull();
    expect(imagesEpoch()).toBe(before + 1);
  });

  it("loads a built-in photo from the photo module at up to 1600 px", async () => {
    const photo = (await loadImage("builtin:sunset")) as HTMLCanvasElement;
    expect(getPhotoImage).toHaveBeenCalledWith("sunset", 1600);
    expect(photo).toBeInstanceOf(HTMLCanvasElement);
    expect(drawableSize(photo)).toEqual({ width: 160, height: 90 });
    expect(await loadImage("builtin:sunset")).toBe(photo);
  });

  it("answers null for a built-in photo that does not exist", async () => {
    expect(await loadImage("builtin:missing")).toBeNull();
    expect(getImage("builtin:missing")).toBeNull();
  });

  it("loads an uploaded file from the library", async () => {
    const asset = await addAssetFromFile(fakeFile("holiday.png", "image/png"));
    const image = (await loadImage(assetSrc(asset.id))) as HTMLImageElement;
    expect(image.getAttribute("src")).toBe(await getAssetUrl(asset.id));
    expect(drawableSize(image)).toEqual({ width: 64, height: 48 });
  });

  it("answers null for an upload that has been deleted", async () => {
    const asset = await addAssetFromFile(fakeFile("gone.png", "image/png"));
    await deleteAsset(asset.id);
    expect(await loadImage(assetSrc(asset.id))).toBeNull();
  });

  it("keeps at most 500 pictures, dropping the oldest first", async () => {
    const run = ++serial;
    const sources = Array.from({ length: 503 }, (_, i) => `https://example.test/cache-${run}-${i}.png`);
    await Promise.all(sources.map((src) => loadImage(src)));
    // (reading is safe: asking for a dropped picture only starts loading it again)
    const kept = sources.filter((src) => getImage(src) !== null);
    expect(kept.length).toBeLessThanOrEqual(500);
    expect(kept.length).toBeGreaterThan(480);
    expect(kept).toContain(sources[502]);
    expect(kept).not.toContain(sources[0]);
  });
});

describe("getImage", () => {
  it("answers null at once, starts the load and tells subscribers when the picture is ready", async () => {
    const src = url();
    const ready = vi.fn();
    const stop = onImagesChange(ready);
    const before = imagesEpoch();
    expect(getImage(src)).toBeNull();
    expect(ready).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    stop();
    expect(imagesEpoch()).toBe(before + 1);
    expect(getImage(src)).toBeInstanceOf(HTMLImageElement);
  });

  it("does not start a second load while one is running", async () => {
    const src = url();
    const ready = vi.fn();
    const stop = onImagesChange(ready);
    getImage(src);
    getImage(src);
    getImage(src);
    await vi.waitFor(() => expect(ready).toHaveBeenCalled());
    stop();
    expect(ready).toHaveBeenCalledTimes(1);
  });

  it("does not try a failed picture again", async () => {
    const src = url("broken");
    getImage(src);
    await vi.waitFor(() => expect(imagesEpoch()).toBeGreaterThan(0));
    const settled = imagesEpoch();
    expect(getImage(src)).toBeNull();
    await Promise.resolve();
    expect(imagesEpoch()).toBe(settled);
  });
});

describe("onImagesChange", () => {
  it("stops calling once unsubscribed, and tells every subscriber otherwise", async () => {
    const a = vi.fn();
    const b = vi.fn();
    const stopA = onImagesChange(a);
    const stopB = onImagesChange(b);
    await loadImage(url());
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 1]);
    stopA();
    await loadImage(url());
    expect([a.mock.calls.length, b.mock.calls.length]).toEqual([1, 2]);
    stopB();
  });

  it("is told about failures too, so a caller can stop waiting", async () => {
    const seen = vi.fn();
    const stop = onImagesChange(seen);
    await loadImage(url("broken"));
    stop();
    expect(seen).toHaveBeenCalledTimes(1);
  });
});

describe("SVG graphics", () => {
  it("loads markup as an image through a data address", async () => {
    const markup = svg();
    const image = (await loadSvgImage(markup)) as HTMLImageElement;
    expect(image.getAttribute("src")).toMatch(/^data:image\/svg\+xml;charset=utf-8,/);
    expect(decodeURIComponent(image.getAttribute("src")!.split(",").slice(1).join(","))).toBe(markup);
    expect(await loadSvgImage(markup)).toBe(image);
    expect(getSvgImage(markup)).toBe(image);
  });

  it("answers null at once from getSvgImage, loads in the background and then has the image", async () => {
    const markup = svg();
    const ready = vi.fn();
    const stop = onImagesChange(ready);
    expect(getSvgImage(markup)).toBeNull();
    await vi.waitFor(() => expect(ready).toHaveBeenCalledTimes(1));
    stop();
    expect(getSvgImage(markup)).toBeInstanceOf(HTMLImageElement);
  });

  it("treats markup that does not load as a failure it remembers", async () => {
    const markup = `${svg()}<!-- broken -->`;
    expect(await loadSvgImage(markup)).toBeNull();
    const settled = imagesEpoch();
    expect(await loadSvgImage(markup)).toBeNull();
    expect(getSvgImage(markup)).toBeNull();
    expect(imagesEpoch()).toBe(settled);
  });

  it("keeps SVG pictures apart from raster pictures that share the text", async () => {
    const markup = svg();
    const image = await loadSvgImage(markup);
    expect(getImage(markup)).not.toBe(image);
  });
});

describe("imageUrl", () => {
  it("returns web and data addresses unchanged", async () => {
    expect(await imageUrl("https://example.test/a.png")).toBe("https://example.test/a.png");
    expect(await imageUrl("data:image/png;base64,AAAA")).toBe("data:image/png;base64,AAAA");
  });

  it("turns a built-in photo into an address an <img> can show", async () => {
    expect(await imageUrl("builtin:sunset")).toBe("blob:thumb/sunset");
    expect(getPhotoThumb).toHaveBeenCalledWith("sunset", 1600);
  });

  it("turns an upload into its object address, or null when it is gone", async () => {
    const asset = await addAssetFromFile(fakeFile("logo.png", "image/png"));
    expect(await imageUrl(assetSrc(asset.id))).toBe(await getAssetUrl(asset.id));
    expect(await imageUrl("asset:missing")).toBeNull();
  });
});

describe("drawableSize", () => {
  it("reads a canvas, an image bitmap and a decoded image", () => {
    const canvas = document.createElement("canvas");
    canvas.width = 30;
    canvas.height = 20;
    expect(drawableSize(canvas)).toEqual({ width: 30, height: 20 });
    expect(drawableSize({ width: 7, height: 9, close() {} } as unknown as ImageBitmap)).toEqual({ width: 7, height: 9 });
    expect(drawableSize(new Image())).toEqual({ width: 64, height: 48 });
  });
});
