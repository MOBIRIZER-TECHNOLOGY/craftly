import { describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import type { Fill, Page } from "@/core/types";
import { estimateExportBytes } from "../options";
import { DEFAULT_DOWNLOAD_SETTINGS, toExportOptions } from "../settings";

const sky: Fill = {
  type: "linear",
  angle: 90,
  stops: [
    { offset: 0, color: "#0ea5e9" },
    { offset: 1, color: "#1e1b4b" },
  ],
};

/** Two gradient pages of three seconds, joined by a one second transition of the given kind. */
function gifBytes(kind: string, format: "gif" | "webm" = "gif"): number {
  const first: Page = { ...createPage({ elements: [createShape("rect", { x: 20, y: 20, width: 100, height: 100 })] }), background: sky, duration: 3 };
  const second: Page = {
    ...createPage({ elements: [createShape("rect", { x: 20, y: 20, width: 100, height: 100 })] }),
    background: sky,
    duration: 3,
    transition: { kind, duration: 1 },
  };
  const design = createDesign({ title: "Transitions", width: 1280, height: 720, pages: [first, second] });
  const options = toExportOptions({ ...DEFAULT_DOWNLOAD_SETTINGS, format, resolution: 720, gifFps: 15 }, [0, 1]);
  return estimateExportBytes(design, options);
}

describe("what a transition adds to the size of a GIF", () => {
  it("is most for a push or a zoom, which move the whole picture", () => {
    expect(gifBytes("push")).toBe(gifBytes("zoom"));
    expect(gifBytes("push")).toBeGreaterThan(gifBytes("none"));
  });

  it("is about half as much for a slide, which moves only the new page", () => {
    const base = gifBytes("none");
    const push = gifBytes("push") - base;
    const slide = gifBytes("slide") - base;
    expect(slide).toBeGreaterThan(0);
    expect(slide).toBeCloseTo(push / 2, -3);
  });

  it("is almost nothing for a wipe, which reveals the new page without changing either", () => {
    const base = gifBytes("none");
    const wipe = gifBytes("wipe") - base;
    expect(wipe).toBeGreaterThan(0);
    expect(wipe).toBeLessThan((gifBytes("slide") - base) / 5);
  });

  it("is worked out by blending for the rest, from what the pages have in common", () => {
    const base = gifBytes("none");
    expect(gifBytes("dissolve")).toBeGreaterThan(base);
    expect(gifBytes("dissolve")).not.toBe(gifBytes("push"));
  });

  it("is a matter of recording time, not of what moves, for a video", () => {
    // a video's size follows its length and bitrate: a transition of any kind keeps the recorder busy for the same time
    expect(gifBytes("push", "webm")).toBe(gifBytes("wipe", "webm"));
  });
});
