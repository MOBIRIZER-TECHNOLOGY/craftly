import { describe, expect, it } from "vitest";
import { createDesign, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import { describeExportError, ExportError, isCancelled, cancelledError } from "./errors";
import type { ExportOptions } from "./exporters";
import {
  FORMAT_EXTENSION,
  FORMAT_MIME,
  MAX_EXPORT_SIDE,
  PRINT_SCALE,
  clampNote,
  clampNumber,
  estimateExportBytes,
  exportFileName,
  exportPixelSize,
  fitScaleToLimit,
  formatBytes,
  formatScale,
  jpegQualityFactor,
  normalizePages,
  pageFileName,
  pagesLabel,
  planRaster,
  resolveExportOptions,
  safeFileName,
  weighPage,
} from "./options";

const base: ExportOptions = { format: "png", pages: [0], scale: 1, quality: 0.92, transparent: false, pdfMode: "standard", embedFonts: true };
const design = (width = 1920, height = 1080, pages = 1) => createDesign({ width, height, pages: Array.from({ length: pages }, () => createPage()) });

describe("clampNumber", () => {
  it("clamps and falls back for non-finite input", () => {
    expect(clampNumber(5, 1, 3)).toBe(3);
    expect(clampNumber(-1, 1, 3)).toBe(1);
    expect(clampNumber(Number.NaN, 1, 3, 2)).toBe(2);
    expect(clampNumber(Infinity, 1, 3, 2)).toBe(2);
    expect(clampNumber("x" as unknown as number, 1, 3)).toBe(1);
  });
});

describe("pixel sizes and the 8192 px cap", () => {
  it("rounds to whole pixels and never returns 0", () => {
    expect(exportPixelSize(1920, 1080, 2)).toEqual({ width: 3840, height: 2160 });
    expect(exportPixelSize(100, 101, 0.25)).toEqual({ width: 25, height: 25 });
    expect(exportPixelSize(1, 1, 0.25)).toEqual({ width: 1, height: 1 });
  });

  it("keeps a scale that fits", () => {
    expect(fitScaleToLimit(1920, 1080, 4)).toEqual({ scale: 4, clamped: false });
    expect(fitScaleToLimit(2048, 1000, 4)).toEqual({ scale: 4, clamped: false }); // exactly 8192
  });

  it("lowers the scale so the longest side is exactly 8192", () => {
    const r = fitScaleToLimit(3000, 2000, 4);
    expect(r.clamped).toBe(true);
    expect(exportPixelSize(3000, 2000, r.scale)).toEqual({ width: MAX_EXPORT_SIDE, height: 5461 });
  });

  it("looks at the longer side, whichever it is", () => {
    const r = fitScaleToLimit(1080, 5000, 4);
    expect(r.clamped).toBe(true);
    expect(Math.round(5000 * r.scale)).toBe(MAX_EXPORT_SIDE);
  });

  it("plans print PDFs at 300 dpi and still caps them", () => {
    const small = planRaster(1920, 1080, { format: "pdf", scale: 1, pdfMode: "print" });
    expect(small.requested).toBe(PRINT_SCALE);
    expect(PRINT_SCALE).toBe(3.125);
    expect(small).toMatchObject({ clamped: false, width: 6000, height: 3375 });
    const big = planRaster(4000, 3000, { format: "pdf", scale: 1, pdfMode: "print" });
    expect(big.clamped).toBe(true);
    expect(big.width).toBe(MAX_EXPORT_SIDE);
  });

  it("ignores the scale for standard PDFs only when it is invalid", () => {
    expect(planRaster(1000, 1000, { format: "pdf", scale: 2, pdfMode: "standard" }).scale).toBe(2);
    expect(planRaster(1000, 1000, { format: "png", scale: Number.NaN, pdfMode: "standard" }).scale).toBe(1);
    expect(planRaster(1000, 1000, { format: "png", scale: 99, pdfMode: "standard" }).requested).toBe(4);
    expect(planRaster(1000, 1000, { format: "png", scale: 0.01, pdfMode: "standard" }).requested).toBe(0.25);
  });

  it("explains a clamp and stays silent otherwise", () => {
    expect(clampNote(planRaster(1920, 1080, { ...base, scale: 2 }))).toBeUndefined();
    const note = clampNote(planRaster(3000, 2000, { ...base, scale: 4 }));
    expect(note).toContain("8192");
    expect(note).toContain("x4");
    expect(formatScale(2.84375)).toBe("x2.84");
  });
});

describe("normalizePages / resolveExportOptions", () => {
  it("sorts, de-duplicates and drops invalid indices", () => {
    expect(normalizePages([2, 0, 2, -1, 9, 1.5, Number.NaN, 1], 3)).toEqual([0, 1, 2]);
    expect(normalizePages([], 3)).toEqual([]);
  });

  it("clamps quality and flags, and only allows transparency for PNG", () => {
    const d = design(1920, 1080, 3);
    const r = resolveExportOptions(d, { ...base, pages: [2, 1], quality: 5, transparent: true });
    expect(r.pages).toEqual([1, 2]);
    expect(r.quality).toBe(1);
    expect(r.transparent).toBe(true);
    expect(resolveExportOptions(d, { ...base, format: "jpg", transparent: true }).transparent).toBe(false);
    expect(resolveExportOptions(d, { ...base, quality: -3 }).quality).toBe(0.1);
    expect(resolveExportOptions(d, { ...base, quality: Number.NaN }).quality).toBe(0.92);
  });

  it("rejects unknown formats", () => {
    expect(() => resolveExportOptions(design(), { ...base, format: "bmp" as never })).toThrow(/Unknown export format/);
    expect(() => resolveExportOptions(design(), { ...base, format: "mp4" as never })).toThrow(/Unknown export format/);
  });

  it("accepts gif and webm and plans the animation for them only", () => {
    const d = design(1920, 1080, 3);
    expect(resolveExportOptions(d, base).animation).toBeNull();
    expect(resolveExportOptions(d, { ...base, format: "pdf" }).animation).toBeNull();
    const gif = resolveExportOptions(d, { ...base, format: "gif", pages: [2, 0], resolution: 480, fps: 10 });
    expect(gif.format).toBe("gif");
    expect(gif.pages).toEqual([0, 2]);
    expect(gif.animation).toMatchObject({ format: "gif", pages: [0, 2], fps: 10, resolution: 480, width: 854, height: 480, total: 10 });
    // the raster plan describes the picture the animation is painted at
    expect(gif.plan).toMatchObject({ width: 854, height: 480, clamped: false });
    expect(gif.plan.scale).toBeCloseTo(854 / 1920, 10);
    const webm = resolveExportOptions(d, { ...base, format: "webm", fps: 5 });
    expect(webm.animation).toMatchObject({ format: "webm", fps: 30, resolution: 720, width: 1280, height: 720 });
  });

  it("defaults and clamps the animation options", () => {
    const d = design(1920, 1080, 1);
    expect(resolveExportOptions(d, { ...base, format: "gif" }).animation).toMatchObject({ resolution: 720, fps: 15 });
    expect(resolveExportOptions(d, { ...base, format: "gif", fps: 999, resolution: 1000 as never }).animation).toMatchObject({ resolution: 1080, fps: 30 });
    expect(resolveExportOptions(d, { ...base, format: "gif", fps: Number.NaN }).animation?.fps).toBe(15);
    // an empty selection is still a plan (with nothing in it), so the caller can report "select a page"
    expect(resolveExportOptions(d, { ...base, format: "gif", pages: [] }).animation).toMatchObject({ pages: [], frames: 0, total: 0 });
  });
});

describe("animated formats", () => {
  it("has an extension and a mime type for every format", () => {
    expect(FORMAT_EXTENSION.gif).toBe("gif");
    expect(FORMAT_EXTENSION.webm).toBe("webm");
    expect(FORMAT_MIME.gif).toBe("image/gif");
    expect(FORMAT_MIME.webm).toBe("video/webm");
    expect(Object.keys(FORMAT_EXTENSION).sort()).toEqual(Object.keys(FORMAT_MIME).sort());
    expect(exportFileName("My / design", FORMAT_EXTENSION.gif)).toBe("My design.gif");
    expect(exportFileName("Launch: v2", FORMAT_EXTENSION.webm)).toBe("Launch v2.webm");
  });
});

describe("file names", () => {
  it("removes characters Windows and macOS reject", () => {
    expect(safeFileName('Q1: "Plan" / v2?')).toBe("Q1 Plan v2");
    expect(safeFileName("  spaced   out  ")).toBe("spaced out");
    expect(safeFileName("..hidden.")).toBe("hidden");
    expect(safeFileName("")).toBe("Untitled design");
    expect(safeFileName(undefined)).toBe("Untitled design");
    expect(safeFileName("???")).toBe("Untitled design");
  });

  it("avoids reserved device names and over-long titles", () => {
    expect(safeFileName("CON")).toBe("_CON");
    expect(safeFileName("lpt1.txt")).toBe("_lpt1.txt");
    expect(Array.from(safeFileName("x".repeat(300))).length).toBe(100);
    expect(safeFileName("日本語のデザイン")).toBe("日本語のデザイン");
  });

  it("builds single and numbered page names", () => {
    expect(exportFileName("My / design", "png")).toBe("My design.png");
    expect(pageFileName("My design", 3, "svg")).toBe("My design - 3.svg");
  });
});

describe("labels", () => {
  it("formats counts and sizes", () => {
    expect(pagesLabel(1)).toBe("1 page");
    expect(pagesLabel(3)).toBe("3 pages");
    expect(formatBytes(0)).toBe("0 KB");
    expect(formatBytes(1500)).toBe("1 KB");
    expect(formatBytes(300 * 1024)).toBe("300 KB");
    expect(formatBytes(2.4 * 1024 * 1024)).toBe("2.4 MB");
    expect(formatBytes(48 * 1024 * 1024)).toBe("48 MB");
  });
});

describe("estimateExportBytes", () => {
  const photoDesign = () => {
    const page = createPage({ background: solid("#ffffff") });
    page.elements.push(createImage({ src: "builtin:sunset-hills", x: 0, y: 0, width: 1920, height: 1080, naturalWidth: 1600, naturalHeight: 1067 }));
    page.elements.push(createText({ text: "Hi" }));
    return createDesign({ width: 1920, height: 1080, pages: [page, createPage(), createPage()] });
  };

  it("is bigger for photos than for flat pages and grows with the scale", () => {
    const d = photoDesign();
    const photo = estimateExportBytes(d, { ...base, pages: [0] });
    const flat = estimateExportBytes(d, { ...base, pages: [1] });
    expect(photo).toBeGreaterThan(flat * 3);
    expect(estimateExportBytes(d, { ...base, pages: [0], scale: 2 })).toBeGreaterThan(photo * 3);
  });

  it("adds up the selected pages and reacts to JPEG quality", () => {
    const d = photoDesign();
    const one = estimateExportBytes(d, { ...base, format: "jpg", pages: [0] });
    const two = estimateExportBytes(d, { ...base, format: "jpg", pages: [0, 0, 1] });
    expect(two).toBeGreaterThan(one);
    expect(estimateExportBytes(d, { ...base, format: "jpg", pages: [0], quality: 0.5 })).toBeLessThan(one);
    expect(estimateExportBytes(d, { ...base, pages: [] })).toBe(0);
  });

  it("estimates SVG from embedded images and fonts, not from pixels", () => {
    const d = photoDesign();
    const withFonts = estimateExportBytes(d, { ...base, format: "svg", pages: [0], scale: 4 });
    const without = estimateExportBytes(d, { ...base, format: "svg", pages: [0], scale: 1, embedFonts: false });
    expect(withFonts).toBeGreaterThan(without);
    // one font family on the page (the default one, used by the "Hi" text) = one embedded font
    expect(withFonts - without).toBe(43000);
  });

  it("charges SVG fonts per family", () => {
    const page = createPage();
    page.elements.push(createText({ text: "a", fontFamily: "Lora" }), createText({ text: "b", fontFamily: "Poppins" }), createText({ text: "c", fontFamily: "Lora" }));
    const d = createDesign({ width: 800, height: 600, pages: [page] });
    const fonts = estimateExportBytes(d, { ...base, format: "svg" }) - estimateExportBytes(d, { ...base, format: "svg", embedFonts: false });
    expect(fonts).toBe(2 * 43000);
  });

  it("knows smooth gradients are heavy as PNG and patterns are heavy as JPEG", () => {
    const flat = createDesign({ width: 1000, height: 1000, pages: [createPage({ background: solid("#ffffff") })] });
    const gradient = createDesign({
      width: 1000,
      height: 1000,
      pages: [
        createPage({
          background: {
            type: "radial",
            stops: [
              { offset: 0, color: "#fef3c7" },
              { offset: 1, color: "#fb7185" },
            ],
          },
        }),
      ],
    });
    const subtle = createDesign({
      width: 1000,
      height: 1000,
      pages: [
        createPage({
          background: {
            type: "linear",
            angle: 90,
            stops: [
              { offset: 0, color: "#f8fafc" },
              { offset: 1, color: "#f1f5f9" },
            ],
          },
        }),
      ],
    });
    const pattern = createDesign({
      width: 1000,
      height: 1000,
      pages: [createPage({ background: { type: "pattern", pattern: "waves", color: "#000", background: "#fff", scale: 1 } })],
    });
    const png = (d: typeof flat) => estimateExportBytes(d, base);
    const jpg = (d: typeof flat) => estimateExportBytes(d, { ...base, format: "jpg" });
    expect(png(gradient)).toBeGreaterThan(png(flat) * 5);
    expect(png(subtle)).toBeLessThan(png(gradient) / 3);
    expect(jpg(pattern)).toBeGreaterThan(jpg(flat) * 3);
    expect(png(pattern)).toBeLessThan(png(gradient) / 4);
  });

  it("leaves the background out of a transparent PNG", () => {
    const photoBg = createDesign({ width: 1000, height: 1000, pages: [createPage({ background: { type: "image", src: "asset:x", fit: "cover" } })] });
    expect(estimateExportBytes(photoBg, { ...base, transparent: true })).toBeLessThan(estimateExportBytes(photoBg, base) / 10);
    // JPEG has no alpha channel: the flag changes nothing there
    expect(estimateExportBytes(photoBg, { ...base, format: "jpg", transparent: true })).toBe(estimateExportBytes(photoBg, { ...base, format: "jpg" }));
  });

  it("grows slower than the pixel count and follows the measured quality curve", () => {
    const d = createDesign({ width: 1000, height: 1000, pages: [createPage()] });
    const png1 = estimateExportBytes(d, base);
    const png2 = estimateExportBytes(d, { ...base, scale: 2 });
    expect(png2 / png1).toBeGreaterThan(2.5);
    expect(png2 / png1).toBeLessThan(3.6);
    const jpg = (quality: number) => estimateExportBytes(d, { ...base, format: "jpg", quality });
    expect(jpg(0.3)).toBeLessThan(jpg(0.6));
    expect(jpg(0.6)).toBeLessThan(jpg(0.92));
    expect(jpg(0.92)).toBeLessThan(jpg(1) / 2);
    // print PDFs are rendered at 300 dpi whatever the scale says
    const digital = estimateExportBytes(d, { ...base, format: "pdf", scale: 1.5 });
    const print = estimateExportBytes(d, { ...base, format: "pdf", pdfMode: "print", scale: 1.5 });
    expect(print).toBeGreaterThan(digital * 2);
  });
});

describe("estimateExportBytes for animations", () => {
  const moving = () => {
    const first = createPage({ duration: 4 });
    first.elements.push(createText({ text: "Hello", animation: { in: { kind: "rise", duration: 0.8, delay: 0 } } }));
    const second = createPage({ duration: 4, transition: { kind: "dissolve", duration: 1 } });
    return createDesign({ width: 1920, height: 1080, pages: [first, second, createPage({ duration: 4 })] });
  };

  it("estimates a GIF and a video, grows with the resolution and ignores the raster scale", () => {
    const d = moving();
    const gif = (over: Partial<ExportOptions> = {}) => estimateExportBytes(d, { ...base, format: "gif", pages: [0, 1, 2], ...over });
    expect(gif()).toBeGreaterThan(1000);
    expect(gif({ resolution: 1080 })).toBeGreaterThan(gif({ resolution: 480 }));
    expect(gif({ fps: 20 })).toBeGreaterThan(gif({ fps: 10 }));
    expect(gif({ scale: 4 })).toBe(gif({ scale: 0.5 }));
    const webm = (over: Partial<ExportOptions> = {}) => estimateExportBytes(d, { ...base, format: "webm", pages: [0, 1, 2], ...over });
    expect(webm()).toBeGreaterThan(10_000);
    expect(webm({ resolution: 1080 })).toBeGreaterThan(webm({ resolution: 480 }));
    expect(webm({ fps: 5 })).toBe(webm());
  });

  it("covers only the chosen pages and is zero for none", () => {
    const d = moving();
    const some = (pages: number[]) => estimateExportBytes(d, { ...base, format: "webm", pages });
    expect(some([0])).toBeLessThan(some([0, 1, 2]));
    expect(some([])).toBe(0);
    expect(estimateExportBytes(d, { ...base, format: "gif", pages: [] })).toBe(0);
  });
});

describe("jpegQualityFactor", () => {
  it("is 1 at the default quality and monotonic", () => {
    expect(jpegQualityFactor(0.92)).toBe(1);
    let last = 0;
    for (let q = 0.1; q <= 1.0001; q += 0.05) {
      const f = jpegQualityFactor(q);
      expect(f).toBeGreaterThanOrEqual(last);
      last = f;
    }
    expect(jpegQualityFactor(5)).toBe(jpegQualityFactor(1));
    expect(jpegQualityFactor(-2)).toBe(jpegQualityFactor(0.1));
  });
});

describe("weighPage", () => {
  it("measures photo coverage, elements, fonts and the background kind", () => {
    const page = createPage({
      background: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ff8000" },
        ],
      },
    });
    page.elements.push(
      createImage({ src: "asset:x", x: 0, y: 0, width: 500, height: 500, naturalWidth: 1, naturalHeight: 1 }),
      createImage({ src: null, x: 0, y: 0, width: 100, height: 100 }),
      createText({ text: "x", fontFamily: "Lora" }),
      createShape("rect", { hidden: true }),
    );
    const w = weighPage({ width: 1000, height: 1000 }, page);
    expect(w).toMatchObject({ photo: 0.25, images: 1, elements: 3, families: 1, busyBackground: true, patterned: false });
    expect(w.gradientSpan).toBeCloseTo(1, 5);
  });
});

describe("export errors", () => {
  it("names the chosen size in the too-large message", () => {
    const msg = describeExportError(new ExportError("too-large", "x"), { scale: 4 });
    expect(msg).toBe("This design is too large to export at 4x - try a smaller size.");
    expect(describeExportError(new ExportError("no-pages", "Select at least one page."))).toBe("Select at least one page.");
  });

  it("turns unknown failures into a friendly sentence", () => {
    expect(describeExportError(new Error("boom"))).toMatch(/Something went wrong/);
    expect(describeExportError(new Error("Array buffer allocation failed"), { scale: 3 })).toMatch(/too large to export at 3x/);
  });

  it("recognises cancellations", () => {
    expect(isCancelled(cancelledError())).toBe(true);
    expect(isCancelled(new DOMException("x", "AbortError"))).toBe(true);
    expect(isCancelled(new Error("x"))).toBe(false);
  });
});
