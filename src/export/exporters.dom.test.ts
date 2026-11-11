import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import type { Design } from "@/core/types";

// the GIF and video encoders are a chunk of their own; here only the hand-over to them matters
vi.mock("./animated/animatedExport", () => ({
  exportAnimated: vi.fn(async (design: Design, resolved: { format: string }) => ({
    name: `${design.title}.${resolved.format}`,
    blob: new Blob(["animated"], { type: "image/gif" }),
  })),
}));

import { exportAnimated } from "./animated/animatedExport";
import { ExportError, MAX_EXPORT_SIDE, copyPageAsImage, downloadBlob, exportDesign, isCancelled, pagePngBlob, printDesign, type ExportOptions } from "./exporters";
import { printDesign as printFromPrintModule } from "./print";

/** A structurally valid JPEG skeleton: SOI, SOF0 with the size, EOI. */
function fakeJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
}

const options = (over: Partial<ExportOptions> = {}): ExportOptions => ({
  format: "png",
  pages: [0],
  scale: 1,
  quality: 0.92,
  transparent: false,
  pdfMode: "standard",
  embedFonts: false,
  ...over,
});

function twoPageDesign(title = "Trip: day 1"): Design {
  return createDesign({
    title,
    width: 200,
    height: 100,
    pages: [
      createPage({ background: solid("#ffffff"), elements: [createShape("rect", { x: 10, y: 10, width: 40, height: 40, fill: solid("#ff0000") })] }),
      createPage({ background: solid("#eeeeee"), elements: [createText({ text: "Second page", link: "https://example.com/next", x: 10, y: 10 })] }),
    ],
  });
}

const read = async (blob: Blob) => Buffer.from(await blob.arrayBuffer()).toString("latin1");

beforeEach(() => {
  vi.mocked(exportAnimated).mockClear();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("exportDesign", () => {
  it("needs at least one page to export, however the pages are chosen", async () => {
    const design = twoPageDesign();
    for (const pages of [[], [5], [-1], [1.5]]) {
      await expect(exportDesign(design, options({ pages }))).rejects.toMatchObject({ code: "no-pages", message: "Select at least one page to download." });
    }
  });

  it("refuses a format it does not know", async () => {
    await expect(exportDesign(twoPageDesign(), options({ format: "tiff" as never }))).rejects.toThrow('Unknown export format "tiff"');
  });

  it("is cancelled before it starts by a signal that is already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const error = await exportDesign(twoPageDesign(), options(), undefined, controller.signal).catch((e) => e);
    expect(isCancelled(error)).toBe(true);
    expect(error).toBeInstanceOf(ExportError);
  });

  describe("PNG and JPG", () => {
    it("makes one PNG for one page, named after the design, and reports progress", async () => {
      const progress = vi.fn();
      const file = await exportDesign(twoPageDesign(), options(), progress);
      expect(file.name).toBe("Trip day 1.png");
      expect(file.blob.type).toBe("image/png");
      expect(file.note).toBeUndefined();
      expect(progress.mock.calls).toEqual([
        [0, 1],
        [1, 1],
      ]);
    });

    it("paints at the scale asked for and keeps the page background out of a transparent PNG", async () => {
      const sizes: number[][] = [];
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type) {
        sizes.push([this.width, this.height]);
        callback(new Blob(["x"], { type }));
      });
      await exportDesign(twoPageDesign(), options({ scale: 3 }));
      expect(sizes).toEqual([[600, 300]]);
    });

    it("makes a JPG at the quality asked for, clamped, flattened onto white", async () => {
      const toBlob = vi.spyOn(HTMLCanvasElement.prototype, "toBlob");
      const file = await exportDesign(twoPageDesign(), options({ format: "jpg", quality: 0.5 }));
      expect(file.name).toBe("Trip day 1.jpg");
      expect(file.blob.type).toBe("image/jpeg");
      expect(toBlob.mock.calls[0].slice(1)).toEqual(["image/jpeg", 0.5]);
      await exportDesign(twoPageDesign(), options({ format: "jpg", quality: 7 }));
      expect(toBlob.mock.calls[1][2]).toBe(1);
      await exportDesign(twoPageDesign(), options({ format: "png", quality: 0.3 }));
      expect(toBlob.mock.calls[2][2]).toBeUndefined();
    });

    it("tells the user when the size had to be reduced", async () => {
      const design = createDesign({ title: "Huge", width: 10000, height: 100, pages: [createPage()] });
      const file = await exportDesign(design, options({ scale: 4 }));
      expect(file.note).toContain("Scaled down");
      expect(file.note).toContain(`${MAX_EXPORT_SIDE} px`);
    });

    it("zips several pages, one file each named with the page number", async () => {
      const progress = vi.fn();
      const file = await exportDesign(twoPageDesign("Deck"), options({ pages: [1, 0] }), progress);
      expect(file.name).toBe("Deck.zip");
      const bytes = await read(file.blob);
      expect(bytes.startsWith("PK")).toBe(true);
      expect(bytes).toContain("Deck - 1.png");
      expect(bytes).toContain("Deck - 2.png");
      expect(progress.mock.calls).toEqual([
        [0, 2],
        [1, 2],
        [2, 2],
      ]);
    });

    it("fails with the reason when the browser cannot encode the picture", async () => {
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
      await expect(exportDesign(twoPageDesign(), options())).rejects.toMatchObject({ code: "too-large" });
    });

    it("stops between pages when the export is cancelled, saying so", async () => {
      const controller = new AbortController();
      const error = await exportDesign(twoPageDesign(), options({ pages: [0, 1] }), (done) => done === 1 && controller.abort(), controller.signal).catch((e) => e);
      expect(isCancelled(error)).toBe(true);
      expect(error.code).toBe("cancelled");
    });
  });

  describe("SVG", () => {
    it("makes one SVG document for one page, with the title of the design", async () => {
      const file = await exportDesign(twoPageDesign(), options({ format: "svg" }));
      expect(file.name).toBe("Trip day 1.svg");
      expect(file.blob.type).toBe("image/svg+xml;charset=utf-8");
      const svg = await file.blob.text();
      expect(svg).toContain("<svg");
      expect(svg).toContain("<title>Trip: day 1</title>");
      expect(file.note).toBeUndefined();
    });

    it("zips several pages, titling each document with its page number", async () => {
      const file = await exportDesign(twoPageDesign("Deck"), options({ format: "svg", pages: [0, 1] }));
      expect(file.name).toBe("Deck.zip");
      const bytes = await read(file.blob);
      expect(bytes).toContain("Deck - 1.svg");
      expect(bytes).toContain("Deck - 2.svg");
      expect(bytes).toContain("<title>Deck - 2</title>");
    });

    it("collects what could not be embedded into one note", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(async () => {
          throw new Error("offline");
        }),
      );
      vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
        throw new Error("tainted canvas");
      });
      const design = createDesign({
        title: "Remote",
        width: 200,
        height: 100,
        pages: [
          createPage({ elements: [createImage({ src: "blob:test/svg-export.png", width: 50, height: 50 })] }),
          createPage({ elements: [createImage({ src: "blob:test/svg-export-2.png", width: 50, height: 50 })] }),
        ],
      });
      const file = await exportDesign(design, options({ format: "svg", pages: [0, 1] }));
      expect(file.note).toBe("Some images could not be embedded, so they are shown as grey boxes.");
    });
  });

  describe("PDF", () => {
    beforeEach(() => {
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback, type) => callback(new Blob([fakeJpeg(200, 100) as BlobPart], { type })));
    });

    it("makes one page of the size of the design in points, with a JPEG on it", async () => {
      const file = await exportDesign(twoPageDesign(), options({ format: "pdf", quality: 0.8 }));
      expect(file.name).toBe("Trip day 1.pdf");
      expect(file.blob.type).toBe("application/pdf");
      const pdf = await read(file.blob);
      expect(pdf.startsWith("%PDF-1.4")).toBe(true);
      expect(pdf).toContain("/MediaBox [0 0 150 75]");
      expect(pdf).toContain("/Count 1");
      expect(pdf).toContain("/Filter /DCTDecode");
      expect(pdf).toContain("/Title (Trip: day 1)");
    });

    it("makes one page per chosen page and turns links into annotations in points", async () => {
      const progress = vi.fn();
      const file = await exportDesign(twoPageDesign(), options({ format: "pdf", pages: [0, 1] }), progress);
      const pdf = await read(file.blob);
      expect(pdf).toContain("/Count 2");
      expect(pdf).toContain("/URI (https://example.com/next)");
      expect(progress).toHaveBeenLastCalledWith(2, 2);
    });

    it("renders print quality PDFs at 300 dpi", async () => {
      const sizes: number[][] = [];
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type) {
        sizes.push([this.width, this.height]);
        callback(new Blob([fakeJpeg(200, 100) as BlobPart], { type }));
      });
      await exportDesign(twoPageDesign(), options({ format: "pdf", pdfMode: "print" }));
      expect(sizes).toEqual([[625, 313]]);
    });

    it("lets the canvas go when encoding fails", async () => {
      vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => callback(null));
      await expect(exportDesign(twoPageDesign(), options({ format: "pdf" }))).rejects.toMatchObject({ code: "too-large" });
    });
  });

  describe("GIF and video", () => {
    it.each(["gif", "webm"] as const)("hands a %s to the animation exporter, which is loaded only then", async (format) => {
      const progress = vi.fn();
      const controller = new AbortController();
      const file = await exportDesign(twoPageDesign(), options({ format, pages: [1, 0], resolution: 480, fps: 10 }), progress, controller.signal);
      expect(exportAnimated).toHaveBeenCalledTimes(1);
      const [design, resolved, onProgress, signal] = vi.mocked(exportAnimated).mock.calls[0];
      expect(design.title).toBe("Trip: day 1");
      expect(resolved.format).toBe(format);
      expect(resolved.pages).toEqual([0, 1]);
      expect(resolved.animation).not.toBeNull();
      expect(onProgress).toBe(progress);
      expect(signal).toBe(controller.signal);
      expect(file.name).toBe(`Trip: day 1.${format}`);
    });

    it("turns a cancellation from the animation exporter into a cancelled export", async () => {
      vi.mocked(exportAnimated).mockRejectedValueOnce(new DOMException("stopped", "AbortError"));
      const error = await exportDesign(twoPageDesign(), options({ format: "gif" })).catch((e) => e);
      expect(error).toBeInstanceOf(ExportError);
      expect(error.code).toBe("cancelled");
    });

    it("lets any other failure of the animation exporter through", async () => {
      const failure = new Error("encoder crashed");
      vi.mocked(exportAnimated).mockRejectedValueOnce(failure);
      await expect(exportDesign(twoPageDesign(), options({ format: "webm" }))).rejects.toBe(failure);
    });
  });
});

describe("pagePngBlob", () => {
  it("makes a PNG of one page", async () => {
    const blob = await pagePngBlob(twoPageDesign(), 1);
    expect(blob.type).toBe("image/png");
  });

  it("paints at the scale asked for, within the size limit", async () => {
    const sizes: number[][] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (this: HTMLCanvasElement, callback, type) {
      sizes.push([this.width, this.height]);
      callback(new Blob(["x"], { type }));
    });
    await pagePngBlob(twoPageDesign(), 0, 2);
    await pagePngBlob(twoPageDesign(), 0);
    await pagePngBlob(createDesign({ width: 9000, height: 100, pages: [createPage()] }), 0, 4);
    expect(sizes).toEqual([
      [400, 200],
      [200, 100],
      [MAX_EXPORT_SIDE, 91],
    ]);
  });

  it("says so when the page does not exist", async () => {
    await expect(pagePngBlob(twoPageDesign(), 7)).rejects.toMatchObject({ code: "no-pages", message: "That page does not exist." });
    await expect(pagePngBlob(twoPageDesign(), -1)).rejects.toMatchObject({ code: "no-pages" });
  });
});

describe("copyPageAsImage", () => {
  class FakeClipboardItem {
    constructor(readonly data: Record<string, Promise<Blob>>) {}
  }

  it("says so when the browser cannot copy images", async () => {
    vi.stubGlobal("ClipboardItem", undefined);
    await expect(copyPageAsImage(twoPageDesign(), 0)).rejects.toMatchObject({ code: "unsupported", message: "Your browser cannot copy images. Download the page instead." });
  });

  it("says so when there is no clipboard at all", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const original = Object.getOwnPropertyDescriptor(navigator, "clipboard")!;
    Object.defineProperty(navigator, "clipboard", { value: undefined, configurable: true });
    try {
      await expect(copyPageAsImage(twoPageDesign(), 0)).rejects.toMatchObject({ code: "unsupported" });
    } finally {
      Object.defineProperty(navigator, "clipboard", original);
    }
  });

  it("hands the clipboard a PNG of the page, as a promise so Safari keeps the click", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const write = vi.mocked(navigator.clipboard.write);
    write.mockClear();
    await copyPageAsImage(twoPageDesign(), 0);
    expect(write).toHaveBeenCalledTimes(1);
    const item = write.mock.calls[0][0][0] as unknown as FakeClipboardItem;
    expect(Object.keys(item.data)).toEqual(["image/png"]);
    expect((await item.data["image/png"]).type).toBe("image/png");
  });

  it("explains a clipboard that refuses", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    const denied = new DOMException("denied", "NotAllowedError");
    vi.mocked(navigator.clipboard.write).mockRejectedValueOnce(denied);
    const error = await copyPageAsImage(twoPageDesign(), 0).catch((e) => e);
    expect(error).toBeInstanceOf(ExportError);
    expect(error.code).toBe("unsupported");
    expect(error.message).toContain("Allow clipboard access");
    expect(error.cause).toBe(denied);
  });

  it("passes on the export error when the page cannot be rendered", async () => {
    vi.stubGlobal("ClipboardItem", FakeClipboardItem);
    vi.mocked(navigator.clipboard.write).mockImplementationOnce(async (items) => {
      await (items[0] as unknown as FakeClipboardItem).data["image/png"];
    });
    await expect(copyPageAsImage(twoPageDesign(), 9)).rejects.toMatchObject({ code: "no-pages", message: "That page does not exist." });
  });
});

describe("downloadBlob", () => {
  it("saves a blob through a hidden link and gives the address back later", () => {
    vi.useFakeTimers();
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
      // the link is in the page while it is clicked
      expect(document.body.contains(this)).toBe(true);
      expect(this.style.display).toBe("none");
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL");
    const create = vi.spyOn(URL, "createObjectURL");
    downloadBlob(new Blob(["data"]), "My file.png");
    expect(click).toHaveBeenCalledTimes(1);
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.download).toBe("My file.png");
    expect(anchor.rel).toBe("noopener");
    expect(anchor.href).toBe(create.mock.results[0].value);
    expect(document.body.contains(anchor)).toBe(false);
    expect(revoke).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30_000);
    expect(revoke).toHaveBeenCalledWith(create.mock.results[0].value);
  });
});

describe("re-exports", () => {
  it("offers printing, the size limit and the error helpers from one place", () => {
    expect(printDesign).toBe(printFromPrintModule);
    expect(MAX_EXPORT_SIDE).toBe(8192);
    expect(isCancelled(new ExportError("cancelled", "x"))).toBe(true);
  });
});
