import { describe, expect, it } from "vitest";
import { MAX_EXPORT_SIDE, planBands } from "./options";
import { DEFAULT_DOWNLOAD_SETTINGS, SIZE_MAX, SIZE_MIN, pagesFor, readStoredSettings, serializeSettings, toExportOptions, type DownloadSettings } from "./settings";

const base = (over: Partial<DownloadSettings> = {}): DownloadSettings => ({ ...DEFAULT_DOWNLOAD_SETTINGS, ...over });

describe("readStoredSettings", () => {
  it("returns the defaults for missing or broken data", () => {
    for (const raw of [null, undefined, "", "not json", "null", "[]", "42", '"x"']) {
      expect(readStoredSettings(raw), String(raw)).toEqual(DEFAULT_DOWNLOAD_SETTINGS);
    }
  });

  it("round-trips valid settings", () => {
    const s = base({ format: "pdf", pdfMode: "print", scale: 2.5, quality: 0.7, transparent: true, compress: true, embedFonts: false, pagesMode: "custom" });
    expect(readStoredSettings(serializeSettings(s))).toEqual(s);
    const animated = base({ format: "gif", resolution: 1080, gifFps: 20, pagesMode: "current" });
    expect(readStoredSettings(serializeSettings(animated))).toEqual(animated);
    expect(readStoredSettings(serializeSettings(base({ format: "webm", resolution: 480 }))).format).toBe("webm");
  });

  it("keeps settings saved before animated exports existed working", () => {
    // exactly what an earlier version wrote: no resolution, no gifFps
    const old = '{"format":"jpg","pdfMode":"print","scale":2,"quality":0.8,"transparent":true,"compress":true,"embedFonts":false,"pagesMode":"current"}';
    expect(readStoredSettings(old)).toEqual({
      ...DEFAULT_DOWNLOAD_SETTINGS,
      format: "jpg",
      pdfMode: "print",
      scale: 2,
      quality: 0.8,
      transparent: true,
      compress: true,
      embedFonts: false,
      pagesMode: "current",
    });
    expect(readStoredSettings(old).resolution).toBe(720);
    expect(readStoredSettings(old).gifFps).toBe(15);
  });

  it("only accepts the resolutions and frame rates the panel offers", () => {
    expect(readStoredSettings('{"resolution":480,"gifFps":10}')).toMatchObject({ resolution: 480, gifFps: 10 });
    expect(readStoredSettings('{"resolution":1000,"gifFps":12}')).toMatchObject({ resolution: 720, gifFps: 15 });
    expect(readStoredSettings('{"resolution":"1080","gifFps":"20"}')).toMatchObject({ resolution: 720, gifFps: 15 });
    expect(readStoredSettings('{"resolution":null,"gifFps":null}')).toMatchObject({ resolution: 720, gifFps: 15 });
  });

  it("starts without bleed or crop marks, and reads them back within their limits", () => {
    expect(DEFAULT_DOWNLOAD_SETTINGS).toMatchObject({ bleed: false, bleedMm: 3, cropMarks: false });
    const s = base({ format: "pdf", pdfMode: "print", bleed: true, bleedMm: 4.5, cropMarks: true });
    expect(readStoredSettings(serializeSettings(s))).toEqual(s);
    expect(readStoredSettings('{"bleed":true,"bleedMm":99,"cropMarks":true}')).toMatchObject({ bleed: true, bleedMm: 10, cropMarks: true });
    expect(readStoredSettings('{"bleed":"yes","bleedMm":-1,"cropMarks":1}')).toMatchObject({ bleed: false, bleedMm: 0, cropMarks: false });
    expect(readStoredSettings('{"bleedMm":"wide"}').bleedMm).toBe(3);
    expect(readStoredSettings('{"bleedMm":2.26}').bleedMm).toBe(2.3);
  });

  it("clamps numbers and snaps the size to the slider's quarter steps", () => {
    expect(readStoredSettings('{"scale":99,"quality":7}')).toMatchObject({ scale: SIZE_MAX, quality: 1 });
    expect(readStoredSettings('{"scale":0.01,"quality":-1}')).toMatchObject({ scale: SIZE_MIN, quality: 0.1 });
    expect(readStoredSettings('{"scale":1.3}').scale).toBe(1.25);
    expect(readStoredSettings('{"scale":"abc","quality":"x"}')).toMatchObject({ scale: 1, quality: 0.92 });
  });

  it("ignores unknown formats, modes and wrongly typed flags", () => {
    const s = readStoredSettings('{"format":"bmp","pdfMode":"huge","pagesMode":"some","transparent":"yes","compress":1,"embedFonts":false}');
    expect(s).toMatchObject({ format: "png", pdfMode: "standard", pagesMode: "all", transparent: false, compress: false, embedFonts: false });
    expect(readStoredSettings('{"format":"mp4"}').format).toBe("png");
    expect(readStoredSettings('{"format":"gif"}').format).toBe("gif");
    expect(readStoredSettings('{"format":"webm"}').format).toBe("webm");
  });

  it("never hands out the shared defaults object (callers may mutate their copy)", () => {
    const a = readStoredSettings(null);
    a.scale = 3;
    expect(readStoredSettings(null).scale).toBe(1);
  });
});

describe("toExportOptions", () => {
  it("passes size, quality and transparency through for PNG and JPG", () => {
    expect(toExportOptions(base({ scale: 2, transparent: true }), [0, 2])).toMatchObject({ format: "png", pages: [0, 2], scale: 2, transparent: true, quality: 0.92 });
    expect(toExportOptions(base({ format: "jpg", scale: 3, quality: 0.5, transparent: true }), [1])).toMatchObject({ format: "jpg", scale: 3, quality: 0.5, transparent: false });
  });

  it("derives the PDF image size and quality from the preset and the Compress switch", () => {
    expect(toExportOptions(base({ format: "pdf" }), [0])).toMatchObject({ format: "pdf", pdfMode: "standard", scale: 1.5, quality: 0.92 });
    expect(toExportOptions(base({ format: "pdf", compress: true }), [0])).toMatchObject({ scale: 1, quality: 0.6 });
    expect(toExportOptions(base({ format: "pdf", pdfMode: "print" }), [0])).toMatchObject({ pdfMode: "print", quality: 0.92 });
    // the size slider does not apply to PDFs
    expect(toExportOptions(base({ format: "pdf", scale: 4 }), [0]).scale).toBe(1.5);
  });

  it("hands the bleed and the crop marks to a print PDF only", () => {
    const print = base({ format: "pdf", pdfMode: "print" });
    expect(toExportOptions(print, [0])).toMatchObject({ bleedMm: 0, cropMarks: false });
    expect(toExportOptions({ ...print, bleed: true }, [0])).toMatchObject({ bleedMm: 3, cropMarks: false });
    expect(toExportOptions({ ...print, bleed: true, bleedMm: 5, cropMarks: true }, [0])).toMatchObject({ bleedMm: 5, cropMarks: true });
    // the size is remembered while the switch is off, and not used
    expect(toExportOptions({ ...print, bleed: false, bleedMm: 5 }, [0]).bleedMm).toBe(0);
    for (const other of [base({ format: "pdf", bleed: true, cropMarks: true }), base({ format: "png", pdfMode: "print", bleed: true, cropMarks: true })]) {
      const o = toExportOptions(other, [0]);
      expect(o).not.toHaveProperty("bleedMm");
      expect(o).not.toHaveProperty("cropMarks");
    }
  });

  it("gives a GIF its resolution and frame rate", () => {
    expect(toExportOptions(base({ format: "gif", resolution: 1080, gifFps: 20 }), [0, 1])).toMatchObject({ format: "gif", pages: [0, 1], resolution: 1080, fps: 20 });
  });

  it("records a video at 30 fps whatever the GIF frame rate says", () => {
    expect(toExportOptions(base({ format: "webm", resolution: 480, gifFps: 10 }), [0])).toMatchObject({ format: "webm", resolution: 480, fps: 30 });
  });

  it("leaves the animation options out of the other formats", () => {
    for (const format of ["png", "jpg", "pdf", "svg"] as const) {
      const o = toExportOptions(base({ format, resolution: 1080, gifFps: 20 }), [0]);
      expect(o, format).not.toHaveProperty("resolution");
      expect(o, format).not.toHaveProperty("fps");
    }
  });

  it("forwards the SVG font switch", () => {
    expect(toExportOptions(base({ format: "svg", embedFonts: false }), [0]).embedFonts).toBe(false);
    expect(toExportOptions(base({ format: "svg" }), [0]).embedFonts).toBe(true);
  });
});

describe("pagesFor", () => {
  it("covers all, current and custom selections", () => {
    expect(pagesFor("all", 3, 1, null)).toEqual([0, 1, 2]);
    expect(pagesFor("current", 3, 1, null)).toEqual([1]);
    expect(pagesFor("custom", 4, 0, new Set([3, 1]))).toEqual([1, 3]);
    expect(pagesFor("custom", 4, 0, new Set())).toEqual([]);
  });

  it("starts a custom selection with every page", () => {
    expect(pagesFor("custom", 3, 0, null)).toEqual([0, 1, 2]);
  });

  it("clamps the current page and drops stale custom indices", () => {
    expect(pagesFor("current", 2, 9, null)).toEqual([1]);
    expect(pagesFor("current", 2, -4, null)).toEqual([0]);
    expect(pagesFor("custom", 2, 0, new Set([0, 1, 5, -1]))).toEqual([0, 1]);
    expect(pagesFor("all", 0, 0, null)).toEqual([]);
  });
});

describe("planBands", () => {
  it("paints everything up to 4K UHD in one pass, like the editor canvas", () => {
    expect(planBands(1920, 1080)).toEqual([{ y: 0, rows: 1080 }]);
    expect(planBands(3840, 2160)).toEqual([{ y: 0, rows: 2160 }]);
    expect(planBands(1, 1)).toEqual([{ y: 0, rows: 1 }]);
  });

  it("splits huge canvases into bands that cover every row exactly once", () => {
    for (const [w, h] of [
      [MAX_EXPORT_SIDE, 4608],
      [4800, 3200],
      [3961, 2641],
      [100, 120000],
      [8192, 8192],
    ] as const) {
      const bands = planBands(w, h);
      expect(bands.length, `${w}x${h}`).toBeGreaterThan(1);
      let next = 0;
      for (const b of bands) {
        expect(b.y).toBe(next);
        expect(b.rows).toBeGreaterThan(0);
        expect(b.rows * w).toBeLessThanOrEqual(4_000_000 + w); // never meaningfully above the budget
        next += b.rows;
      }
      expect(next).toBe(h);
    }
  });

  it("respects custom limits and never returns a single band above the single-pass size", () => {
    expect(planBands(1000, 1000, 250_000, 500_000)).toHaveLength(4);
    expect(planBands(1000, 1000, 5_000_000, 500_000).length).toBeGreaterThanOrEqual(2);
    expect(planBands(1000, 1000, 250_000, 1_000_000)).toHaveLength(1);
  });
});
