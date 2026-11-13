import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import { ExportError, cancelledError } from "./errors";
import { exportDesign, type ExportFile, type ExportOptions } from "./exporters";
import { exportSeveralSizes } from "./multiSize";
import { CURRENT_SIZE_ID, sizeChoices } from "./multiSizePlan";
import { openZip } from "./zipRead";

vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn() };
});

const designOf = (pages = 2): Design =>
  createDesign({
    title: "Menu",
    width: 400,
    height: 300,
    pages: Array.from({ length: pages }, () => createPage({ background: solid("#ffffff"), elements: [createShape("rect", { x: 100, y: 50, width: 200, height: 100 })] })),
  });

function deepFreeze<T>(value: T): T {
  if (typeof value === "object" && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}

/** What every call to the (mocked) exporter was given, copied at the time of the call. */
interface Call {
  design: Design;
  width: number;
  height: number;
  first: { x: number; y: number; width: number; height: number };
  options: ExportOptions;
}
let calls: Call[];

beforeEach(() => {
  calls = [];
  vi.mocked(exportDesign).mockReset();
  vi.mocked(exportDesign).mockImplementation(async (design, options, onProgress) => {
    const el = design.pages[0].elements[0];
    calls.push({ design, width: design.width, height: design.height, first: { x: el.x, y: el.y, width: el.width, height: el.height }, options });
    options.pages.forEach((_p, i) => onProgress?.(i + 1, options.pages.length));
    return { name: "ignored", blob: new Blob([`${design.width}x${design.height}:${options.pages.join(",")}:${options.format}`]) } satisfies ExportFile;
  });
});

const names = async (file: ExportFile) => (await openZip(file.blob)).entries.map((e) => e.name);

describe("exportSeveralSizes", () => {
  it("puts every chosen page at every chosen size into one archive, each file named after its size", async () => {
    const file = await exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID, "instagram-story"], pages: [0, 1], format: "png", quality: 0.8 });
    expect(file.name).toBe("Menu - 2 sizes.zip");
    expect(file.blob.type).toBe("application/zip");
    expect(await names(file)).toEqual([
      "Menu - Original size 400x300 - 1.png",
      "Menu - Original size 400x300 - 2.png",
      "Menu - Instagram Story 1080x1920 - 1.png",
      "Menu - Instagram Story 1080x1920 - 2.png",
    ]);
    // the files are what the exporter made of each size and page
    const zip = await openZip(file.blob);
    expect(await zip.text(zip.entries[3])).toBe("1080x1920:1:png");
    expect(file.note).toBeUndefined();
  });

  it("leaves the page number out of the name when one page is exported", async () => {
    const file = await exportSeveralSizes(designOf(), { sizeIds: ["youtube-thumbnail"], pages: [1], format: "jpg", quality: 0.8 });
    expect(file.name).toBe("Menu - 1 size.zip");
    expect(await names(file)).toEqual(["Menu - YouTube Thumbnail 1280x720.jpg"]);
    expect(calls[0].options).toMatchObject({ format: "jpg", quality: 0.8, scale: 1, pages: [1] });
  });

  it("refits a copy of the design to each size, scaled to fit and centred as the Resize dialog does", async () => {
    await exportSeveralSizes(designOf(1), { sizeIds: [CURRENT_SIZE_ID, "instagram-story"], pages: [0], format: "png", quality: 1 });
    expect(calls.map((c) => [c.width, c.height])).toEqual([
      [400, 300],
      [1080, 1920],
    ]);
    expect(calls[0].first).toEqual({ x: 100, y: 50, width: 200, height: 100 });
    // 400 x 300 in 1080 x 1920: 2.7 times as large, moved down to the middle
    expect(calls[1].first.width).toBeCloseTo(540);
    expect(calls[1].first.x).toBeCloseTo(270);
    expect(calls[1].first.y).toBeCloseTo(135 + (1920 - 810) / 2);
  });

  it("never touches the design it was given, not even for its own size", async () => {
    const design = deepFreeze(designOf());
    const before = JSON.stringify(design);
    await exportSeveralSizes(design, {
      sizeIds: sizeChoices(design)
        .slice(0, 4)
        .map((c) => c.id),
      pages: [0, 1],
      format: "png",
      quality: 1,
    });
    expect(JSON.stringify(design)).toBe(before);
    expect(calls.length).toBe(8);
    for (const call of calls) {
      expect(call.design).not.toBe(design);
      expect(call.design.pages[0]).not.toBe(design.pages[0]);
      expect(call.design.id).toBe(design.id);
    }
  });

  it("makes one PDF of all chosen pages for each size", async () => {
    const file = await exportSeveralSizes(designOf(3), { sizeIds: [CURRENT_SIZE_ID, "facebook-post"], pages: [0, 2], format: "pdf", quality: 0.3 });
    expect(await names(file)).toEqual(["Menu - Original size 400x300.pdf", "Menu - Facebook Post 940x788.pdf"]);
    expect(calls).toHaveLength(2);
    expect(calls[0].options).toMatchObject({ format: "pdf", pdfMode: "standard", pages: [0, 2] });
  });

  it("counts every page of every size as it is done", async () => {
    for (const format of ["png", "pdf"] as const) {
      const seen: Array<[number, number]> = [];
      await exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID, "facebook-post"], pages: [0, 1], format, quality: 1 }, (done, total) => seen.push([done, total]));
      expect(seen[0]).toEqual([0, 4]);
      expect(seen[seen.length - 1]).toEqual([4, 4]);
      expect(seen.map((s) => s[0])).toEqual([...seen.map((s) => s[0])].sort((a, b) => a - b));
      expect(new Set(seen.map((s) => s[0]))).toEqual(new Set([0, 1, 2, 3, 4]));
    }
  });

  it("tells once what the exporter had to say about any of the files", async () => {
    vi.mocked(exportDesign).mockImplementation(async () => ({ name: "x", blob: new Blob(["x"]), note: "An image could not be loaded." }));
    const file = await exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID, "facebook-post"], pages: [0, 1], format: "png", quality: 1 });
    expect(file.note).toBe("An image could not be loaded.");
    const pdfs = await exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID, "facebook-post"], pages: [0, 1], format: "pdf", quality: 1 });
    expect(pdfs.note).toBe("An image could not be loaded.");
  });

  it("stops between files when it is cancelled, and makes no archive", async () => {
    const controller = new AbortController();
    vi.mocked(exportDesign).mockImplementation(async () => {
      controller.abort();
      return { name: "x", blob: new Blob(["x"]) };
    });
    const run = exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID, "facebook-post"], pages: [0, 1], format: "png", quality: 1 }, undefined, controller.signal);
    await expect(run).rejects.toMatchObject({ code: "cancelled" });
    expect(exportDesign).toHaveBeenCalledTimes(1);
  });

  it("does not start when it is cancelled already", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID], pages: [0], format: "png", quality: 1 }, undefined, controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
    expect(exportDesign).not.toHaveBeenCalled();
  });

  it("passes the signal on, and reports a cancellation inside a file as a cancellation", async () => {
    const controller = new AbortController();
    vi.mocked(exportDesign).mockImplementation(async (_d, _o, _p, signal) => {
      expect(signal).toBe(controller.signal);
      throw cancelledError();
    });
    await expect(exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID], pages: [0], format: "png", quality: 1 }, undefined, controller.signal)).rejects.toMatchObject({
      code: "cancelled",
    });
  });

  it("gives up with the exporter's own error when a size cannot be made", async () => {
    vi.mocked(exportDesign).mockRejectedValue(new ExportError("too-large", "This design is too large to export at this size - try a smaller size."));
    await expect(exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID, "facebook-post"], pages: [0], format: "png", quality: 1 })).rejects.toMatchObject({
      code: "too-large",
    });
    expect(exportDesign).toHaveBeenCalledTimes(1);
  });

  it("refuses what the plan refuses, in the plan's words, before anything is made", async () => {
    await expect(exportSeveralSizes(designOf(), { sizeIds: [], pages: [0], format: "png", quality: 1 })).rejects.toMatchObject({
      code: "no-pages",
      message: "Tick at least one size.",
    });
    await expect(exportSeveralSizes(designOf(), { sizeIds: [CURRENT_SIZE_ID], pages: [], format: "png", quality: 1 })).rejects.toMatchObject({ code: "no-pages" });
    const all = sizeChoices(designOf()).map((c) => c.id);
    await expect(exportSeveralSizes(designOf(), { sizeIds: all, pages: [0], format: "png", quality: 1 })).rejects.toMatchObject({
      code: "too-large",
      message: expect.stringContaining("one download holds 10 at most"),
    });
    expect(exportDesign).not.toHaveBeenCalled();
  });
});
