import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockContext } from "@/test/canvasMock";

/** Fresh copy of the photo module: it caches bitmaps, thumbnails and warnings in module state. */
async function load() {
  vi.resetModules();
  return import("./photos");
}

const ctxOf = () => createMockContext(document.createElement("canvas"));

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("getPhotoImage", () => {
  it("paints the photo on a canvas whose longest side is the size asked for", async () => {
    const { getPhotoImage, getPhotoDef } = await load();
    const def = getPhotoDef("sunset-hills")!;
    const canvas = (await getPhotoImage("sunset-hills", 256)) as HTMLCanvasElement;
    expect(canvas).toBeInstanceOf(HTMLCanvasElement);
    expect(canvas.width).toBe(256);
    expect(canvas.height).toBe(Math.round((256 * def.height) / def.width));
  });

  it("rejects an unknown photo", async () => {
    const { getPhotoImage } = await load();
    await expect(getPhotoImage("nope")).rejects.toThrow('Unknown builtin photo "nope"');
  });

  it("hands the same picture to everyone who asks for the same photo at the same size", async () => {
    const { getPhotoImage } = await load();
    const first = getPhotoImage("sunset-hills", 128);
    const bigger = getPhotoImage("sunset-hills", 192);
    const other = getPhotoImage("ocean-waves", 128);
    expect(getPhotoImage("sunset-hills", 128)).toBe(first);
    expect(bigger).not.toBe(first);
    expect(other).not.toBe(first);
    const pictures = await Promise.all([first, bigger, other]);
    expect(await getPhotoImage("sunset-hills", 128)).toBe(pictures[0]);
  });

  it("rounds the size down to one of a few standard sizes so the cache stays small", async () => {
    const { getPhotoImage } = await load();
    const standard = getPhotoImage("sunset-hills", 96);
    const next = getPhotoImage("sunset-hills", 128);
    expect(getPhotoImage("sunset-hills", 100)).toBe(standard);
    expect(getPhotoImage("sunset-hills", 127)).toBe(standard);
    expect(next).not.toBe(standard);
    await Promise.all([standard, next]);
    // below the smallest standard size the size is kept, but never under 16 px
    const small = (await getPhotoImage("sunset-hills", 40)) as HTMLCanvasElement;
    expect(small.width).toBe(40);
    const tiny = (await getPhotoImage("sunset-hills", 5)) as HTMLCanvasElement;
    expect(tiny.width).toBe(16);
  });

  it("gives the same picture again when it is asked for after another photo", async () => {
    const { getPhotoImage } = await load();
    const a = getPhotoImage("sunset-hills", 64);
    const b = getPhotoImage("ocean-waves", 64);
    expect(getPhotoImage("sunset-hills", 64)).toBe(a);
    expect(getPhotoImage("ocean-waves", 64)).toBe(b);
    await Promise.all([a, b]);
  });

  it("forgets a picture it could not paint, so the next request tries again", async () => {
    const { getPhotoImage } = await load();
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementationOnce(() => {
      throw new Error("out of canvases");
    });
    const failed = getPhotoImage("sunset-hills", 64);
    await expect(failed).rejects.toThrow("out of canvases");
    vi.spyOn(document, "createElement").mockImplementation(create);
    const again = getPhotoImage("sunset-hills", 64);
    expect(again).not.toBe(failed);
    expect(await again).toBeInstanceOf(HTMLCanvasElement);
  });

  it("drops the oldest pictures once the cache holds more than about 150 MB", async () => {
    const { getPhotoImage } = await load();
    const ids = ["sunset-hills", "ocean-waves", "nebula", "starfield"];
    // every one of these is a 4096 px picture of about 11 million pixels; the budget is 36 million
    const requests = ids.map((id) => getPhotoImage(id, 4096));
    await Promise.all(requests);
    expect(getPhotoImage(ids[3], 4096)).toBe(requests[3]);
    expect(getPhotoImage(ids[1], 4096)).toBe(requests[1]);
    expect(getPhotoImage(ids[0], 4096)).not.toBe(requests[0]);
  });
});

describe("getPhotoThumb", () => {
  it("makes a small preview as an address an <img> can show", async () => {
    const { getPhotoThumb } = await load();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    const url = await getPhotoThumb("sunset-hills");
    expect(url).toMatch(/^blob:/);
    const canvas = toBlob.mock.contexts[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(360);
    expect(toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.86]);
  });

  it("makes the preview as large as asked", async () => {
    const { getPhotoThumb } = await load();
    const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
    await getPhotoThumb("ocean-waves", 120);
    expect((toBlob.mock.contexts[0] as HTMLCanvasElement).width).toBe(120);
    await getPhotoThumb("ocean-waves", 3);
    expect((toBlob.mock.contexts[1] as HTMLCanvasElement).width).toBe(16);
  });

  it("makes each preview once", async () => {
    const { getPhotoThumb } = await load();
    const first = getPhotoThumb("sunset-hills", 100);
    expect(getPhotoThumb("sunset-hills", 100.4)).toBe(first);
    expect(getPhotoThumb("sunset-hills", 101)).not.toBe(first);
    expect(await getPhotoThumb("sunset-hills", 100)).toBe(await first);
  });

  it("rejects an unknown photo", async () => {
    const { getPhotoThumb } = await load();
    await expect(getPhotoThumb("nope")).rejects.toThrow('Unknown builtin photo "nope"');
  });

  it("falls back to a data address when the canvas gives no blob", async () => {
    const { getPhotoThumb } = await load();
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
    expect(await getPhotoThumb("sunset-hills", 64)).toBe("data:image/jpeg;base64,AAAA");
  });

  it("falls back to a data address where there is no toBlob", async () => {
    const { getPhotoThumb } = await load();
    const original = Object.getOwnPropertyDescriptor(HTMLCanvasElement.prototype, "toBlob")!;
    Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", { value: undefined, configurable: true, writable: true });
    try {
      expect(await getPhotoThumb("sunset-hills", 64)).toBe("data:image/jpeg;base64,AAAA");
    } finally {
      Object.defineProperty(HTMLCanvasElement.prototype, "toBlob", original);
    }
  });

  it("falls back to a data address where there are no object addresses", async () => {
    const { getPhotoThumb } = await load();
    const original = URL.createObjectURL;
    (URL as unknown as { createObjectURL?: unknown }).createObjectURL = undefined;
    try {
      expect(await getPhotoThumb("sunset-hills", 64)).toBe("data:image/jpeg;base64,AAAA");
    } finally {
      URL.createObjectURL = original;
    }
  });

  it("forgets a preview it could not make, so the next request tries again", async () => {
    const { getPhotoThumb } = await load();
    const create = document.createElement.bind(document);
    vi.spyOn(document, "createElement").mockImplementationOnce(() => {
      throw new Error("out of canvases");
    });
    const failed = getPhotoThumb("sunset-hills", 64);
    await expect(failed).rejects.toThrow("out of canvases");
    vi.spyOn(document, "createElement").mockImplementation(create);
    const again = getPhotoThumb("sunset-hills", 64);
    expect(again).not.toBe(failed);
    expect(await again).toMatch(/^blob:/);
  });
});

describe("drawPhoto", () => {
  it("paints straight onto a plain context", async () => {
    const { drawPhoto } = await load();
    const ctx = ctxOf();
    drawPhoto(ctx, "sunset-hills", 120, 80);
    expect(ctx.calls.length).toBeGreaterThan(20);
    expect(ctx.callsTo("save")).toHaveLength(ctx.callsTo("restore").length);
    // painted inside a clip to its own box
    expect(ctx.callsTo("rect")[0]).toEqual([0, 0, 120, 80]);
  });

  it("paints nothing into an empty box", async () => {
    const { drawPhoto } = await load();
    for (const [w, h] of [[0, 50], [50, 0], [-5, 50]]) {
      const ctx = ctxOf();
      drawPhoto(ctx, "sunset-hills", w, h);
      expect(ctx.calls).toEqual([]);
    }
  });

  it("paints a plain placeholder for a photo it does not know", async () => {
    const { drawPhoto } = await load();
    const ctx = ctxOf();
    drawPhoto(ctx, "nope", 40, 30);
    expect(ctx.callsTo("fillRect")).toEqual([[0, 0, 40, 30]]);
    expect(ctx.callsTo("createLinearGradient")).toHaveLength(1);
  });

  describe("when the context has transparency, a blend mode, a shadow or a filter set", () => {
    it.each([
      ["globalAlpha", 0.5],
      ["globalCompositeOperation", "multiply"],
      ["shadowBlur", 4],
      ["shadowOffsetX", 3],
      ["shadowOffsetY", 3],
      ["filter", "blur(2px)"],
    ])("paints the whole photo first, then draws that with %s applied", async (property, value) => {
      const { drawPhoto } = await load();
      const ctx = ctxOf();
      (ctx as unknown as Record<string, unknown>)[property] = value;
      drawPhoto(ctx, "sunset-hills", 120, 80);
      const draws = ctx.callsTo("drawImage");
      expect(draws).toHaveLength(1);
      const [scratch, x, y, w, h] = draws[0] as [HTMLCanvasElement, number, number, number, number];
      expect([x, y, w, h]).toEqual([0, 0, 120, 80]);
      expect([scratch.width, scratch.height]).toEqual([120, 80]);
      // none of the photo itself was painted on the context that carries the state
      expect(ctx.callsTo("clip")).toHaveLength(0);
    });

    it("renders at the resolution of the screen", async () => {
      const { drawPhoto } = await load();
      const ctx = ctxOf();
      ctx.globalAlpha = 0.5;
      (ctx as unknown as { getTransform: () => unknown }).getTransform = () => ({ a: 2, b: 0, c: 0, d: 3 });
      drawPhoto(ctx, "sunset-hills", 100, 50);
      const [scratch] = ctx.callsTo("drawImage")[0] as [HTMLCanvasElement];
      expect([scratch.width, scratch.height]).toEqual([200, 150]);
    });

    it("never makes the scratch picture larger than 4096 px", async () => {
      const { drawPhoto } = await load();
      const ctx = ctxOf();
      ctx.globalAlpha = 0.5;
      (ctx as unknown as { getTransform: () => unknown }).getTransform = () => ({ a: 100, b: 0, c: 0, d: 100 });
      drawPhoto(ctx, "sunset-hills", 100, 50);
      const [scratch] = ctx.callsTo("drawImage")[0] as [HTMLCanvasElement];
      expect(scratch.width).toBe(4096);
      expect(scratch.height).toBe(2048);
    });

    it("copes with a transform that has collapsed to nothing", async () => {
      const { drawPhoto } = await load();
      const ctx = ctxOf();
      ctx.globalAlpha = 0.5;
      (ctx as unknown as { getTransform: () => unknown }).getTransform = () => ({ a: 0, b: 0, c: 0, d: 0 });
      drawPhoto(ctx, "sunset-hills", 60, 40);
      const [scratch] = ctx.callsTo("drawImage")[0] as [HTMLCanvasElement];
      expect([scratch.width, scratch.height]).toEqual([60, 40]);
    });
  });

  describe("a painter that fails", () => {
    it("is reported once and leaves a plain gradient where the photo should be", async () => {
      const { drawPhoto } = await load();
      const broken = () => {
        const ctx = ctxOf();
        (ctx as unknown as { beginPath: () => void }).beginPath = () => {
          throw new Error("canvas lost");
        };
        return ctx;
      };
      const first = broken();
      expect(() => drawPhoto(first, "sunset-hills", 100, 60)).not.toThrow();
      expect(console.warn).toHaveBeenCalledTimes(1);
      expect(String((console.warn as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toContain('photo "sunset-hills" failed to paint');
      expect(first.callsTo("fillRect")).toEqual([[0, 0, 100, 60]]);
      expect(first.callsTo("save")).toHaveLength(first.callsTo("restore").length);
      drawPhoto(broken(), "sunset-hills", 100, 60);
      expect(console.warn).toHaveBeenCalledTimes(1);
      drawPhoto(broken(), "ocean-waves", 100, 60);
      expect(console.warn).toHaveBeenCalledTimes(2);
    });
  });
});

describe("photo metadata", () => {
  it("looks a photo up by id", async () => {
    const { getPhotoDef, PHOTOS } = await load();
    expect(getPhotoDef(PHOTOS[0].id)).toBe(PHOTOS[0]);
    expect(getPhotoDef("nope")).toBeUndefined();
  });
});
