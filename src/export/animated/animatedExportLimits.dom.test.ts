import { afterEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import type { ExportOptions } from "../exporters";
import { resolveExportOptions } from "../options";
import { exportAnimated } from "./animatedExport";

// The real encoder is tested on its own. Here it is replaced by one whose output is chosen, to see what the exporter
// does with a GIF that is very large: a real one of that size would take minutes and gigabytes to make.
const gifOutput = vi.hoisted(() => ({ chunk: (): unknown => new Uint8Array(0) }));

vi.mock("./gif", () => ({
  GifEncoder: class {
    private pending: unknown[] = [];
    addFrame() {
      this.pending.push(gifOutput.chunk());
    }
    takeChunks() {
      const out = this.pending;
      this.pending = [];
      return out;
    }
    finish() {
      return [Uint8Array.of(0x3b)];
    }
  },
}));

const MB = 1024 * 1024;
const design = (): Design =>
  createDesign({
    title: "Big",
    width: 100,
    height: 100,
    pages: [0, 1].map(() => createPage({ duration: 1, background: solid("#ffffff"), elements: [createShape("rect", { width: 20, height: 20 })] })),
  });
const options: ExportOptions = { format: "gif", pages: [0, 1], scale: 1, quality: 0.92, transparent: false, pdfMode: "standard", embedFonts: false, resolution: 480, fps: 2 };
const run = (onProgress?: (done: number, total: number) => void) => exportAnimated(design(), resolveExportOptions(design(), options), onProgress, undefined);

afterEach(() => {
  gifOutput.chunk = () => new Uint8Array(0);
});

describe("a GIF of many megabytes", () => {
  it("is put together without losing a byte, however the pieces pile up", async () => {
    gifOutput.chunk = () => new Uint8Array(5 * MB);
    const file = await run();
    // four frames of five megabytes, and the one byte that ends a GIF
    expect(file.blob.size).toBe(4 * 5 * MB + 1);
    expect(file.blob.type).toBe("image/gif");
    expect(new Uint8Array(await file.blob.slice(file.blob.size - 1).arrayBuffer())[0]).toBe(0x3b);
  });

  it("is given up on past 400 megabytes, with a hint on how to make it smaller", async () => {
    gifOutput.chunk = () => ({ length: 401 * MB });
    const progress = vi.fn();
    const error = await run(progress).catch((e) => e);
    expect(error).toMatchObject({ code: "too-large", message: "This GIF is getting too big (over 400 MB). Try a lower resolution or frame rate, or fewer pages." });
    // the frame that broke the limit is not counted as done
    expect(progress.mock.calls).toEqual([[0, 4]]);
  });
});
