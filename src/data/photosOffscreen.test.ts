/**
 * In a worker or on a server there is no `document`: photos are then painted on an OffscreenCanvas. This runs the
 * photo module without a DOM, against a fake OffscreenCanvas that records what it is asked.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockContext, type MockContext2D } from "@/test/canvasMock";

interface FakeOffscreen {
  width: number;
  height: number;
  context: MockContext2D;
  getContext(kind: string): MockContext2D;
  transferToImageBitmap(): { width: number; height: number; close(): void };
  convertToBlob(options: { type: string; quality: number }): Promise<Blob>;
}

const created: FakeOffscreen[] = [];

function stubOffscreenCanvas() {
  created.length = 0;
  class Canvas implements FakeOffscreen {
    readonly context = createMockContext();
    constructor(
      public width: number,
      public height: number,
    ) {
      created.push(this);
    }
    getContext() {
      return this.context;
    }
    transferToImageBitmap() {
      return { width: this.width, height: this.height, close() {} };
    }
    convertToBlob = vi.fn(async (options: { type: string; quality: number }) => new Blob(["jpeg"], { type: options.type }));
  }
  vi.stubGlobal("OffscreenCanvas", Canvas);
}

async function load() {
  vi.resetModules();
  return import("./photos");
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("photos without a document", () => {
  it("paints on an OffscreenCanvas and hands out an image bitmap", async () => {
    stubOffscreenCanvas();
    const { getPhotoImage } = await load();
    const bitmap = (await getPhotoImage("sunset-hills", 256)) as unknown as { width: number; height: number };
    expect(bitmap.width).toBe(256);
    expect(bitmap.height).toBe(171);
    // the first canvas made is the picture itself (painters make more for their own layers)
    expect([created[0].width, created[0].height]).toEqual([256, 171]);
    expect(created[0].context.calls.length).toBeGreaterThan(20);
  });

  it("makes a preview by converting the canvas to a JPEG blob", async () => {
    stubOffscreenCanvas();
    const { getPhotoThumb } = await load();
    const url = await getPhotoThumb("ocean-waves", 200);
    expect(url).toMatch(/^blob:/);
    expect(created[0].width).toBe(200);
    expect((created[0] as unknown as { convertToBlob: ReturnType<typeof vi.fn> }).convertToBlob).toHaveBeenCalledWith({ type: "image/jpeg", quality: 0.86 });
  });

  it("composes the photo on a scratch canvas when the context carries transparency", async () => {
    stubOffscreenCanvas();
    const { drawPhoto } = await load();
    const target = createMockContext();
    target.globalAlpha = 0.4;
    drawPhoto(target, "sunset-hills", 90, 60);
    expect([created[0].width, created[0].height]).toEqual([90, 60]);
    const [scratch, x, y, w, h] = target.callsTo("drawImage")[0];
    expect(scratch).toBe(created[0]);
    expect([x, y, w, h]).toEqual([0, 0, 90, 60]);
  });

  it("fails clearly when there is no way to make a canvas at all", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const { getPhotoImage, getPhotoThumb } = await load();
    await expect(getPhotoImage("sunset-hills", 64)).rejects.toThrow("Craftly photos need a canvas implementation");
    await expect(getPhotoThumb("sunset-hills", 64)).rejects.toThrow("Craftly photos need a canvas implementation");
  });
});
