/** A video element in an SVG download: a still picture, the clip's frame at the start of its trim, framed as a picture is. */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGroup, createPage, createVideo, defaultFilter } from "@/core/factory";
import type { DesignElement, VideoElement } from "@/core/types";
import { designPageToSvg } from "./svg";

const posters = vi.hoisted(() => ({ asked: [] as string[], missing: new Set<string>() }));

// the poster of a clip is read from a <video> (src/render/videos.ts), which jsdom cannot play: the frame is a canvas made here
vi.mock("@/render/images", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/render/images")>();
  return {
    ...actual,
    loadImage: vi.fn(async (src: string) => {
      if (!src.startsWith("video:")) return actual.loadImage(src);
      posters.asked.push(src);
      if (posters.missing.has(src)) return null;
      const canvas = document.createElement("canvas");
      canvas.width = 320;
      canvas.height = 180;
      return canvas;
    }),
  };
});

const clip = (init: Partial<VideoElement> = {}) =>
  createVideo({ src: "asset:clip", x: 10, y: 10, width: 160, height: 90, naturalWidth: 320, naturalHeight: 180, duration: 8, ...init });
const toSvg = (elements: DesignElement[]) => designPageToSvg({ width: 400, height: 300 }, createPage({ elements }), { embedFonts: false });
const defsOf = (svg: string) => svg.match(/<defs>([\s\S]*)<\/defs>/)?.[1] ?? "";

afterEach(() => {
  posters.asked.length = 0;
  posters.missing.clear();
});

describe("a clip in an SVG", () => {
  it("bakes the clip's filter into its frame, as a filtered picture's is", async () => {
    const { svg, warnings } = await toSvg([clip({ filter: { ...defaultFilter(), brightness: 30 } })]);
    expect(warnings).toEqual([]);
    expect(posters.asked).toContain("video:asset:clip@0");
    // the filtered raster is drawn in the box, not a <use> of the plain frame
    expect(svg).not.toContain("<use ");
    expect(svg).toContain('<image width="160" height="90" preserveAspectRatio="none" xlink:href="data:image/');
  });

  it("is its frame at the start of the trim, saved once as a JPEG and placed like a picture", async () => {
    const { svg, warnings } = await toSvg([clip({ trimStart: 2.5, trimEnd: 6 }), clip({ x: 200, trimStart: 2.5, trimEnd: 6 })]);
    expect(warnings).toEqual([]);
    expect(new Set(posters.asked)).toEqual(new Set(["video:asset:clip@2.5"]));
    expect(defsOf(svg)).toMatch(/<image id="cf-img\d+" width="320" height="180" preserveAspectRatio="none" xlink:href="data:image\/jpeg;base64,AAAA"\/>/);
    expect(svg.split("<use ").length - 1).toBe(2);
  });

  it("asks for a different frame for a clip trimmed to start elsewhere", async () => {
    await toSvg([clip(), clip({ trimStart: 1 })]);
    expect(new Set(posters.asked)).toEqual(new Set(["video:asset:clip@0", "video:asset:clip@1"]));
  });

  it("is drawn inside a group, and a hidden clip is left out without its frame being read", async () => {
    const { svg } = await toSvg([createGroup([clip({ id: "in-group", src: "asset:grouped" })]), clip({ src: "asset:hidden", hidden: true })]);
    expect(new Set(posters.asked)).toEqual(new Set(["video:asset:grouped@0"]));
    expect(svg).toContain("<use ");
  });

  it("keeps the frame shape, rounded corners and outline of the element", async () => {
    const { svg } = await toSvg([clip({ radius: 12, stroke: { color: "#ff0000", width: 3, style: "solid" } }), clip({ x: 200, mask: "ellipse" })]);
    expect(defsOf(svg)).toContain('rx="12"');
    expect(defsOf(svg)).toContain("<ellipse");
    expect(svg.indexOf("<use ")).toBeLessThan(svg.indexOf('fill="none" stroke="#ff0000"'));
  });

  it("is a grey box where its frame cannot be read", async () => {
    posters.missing.add("video:asset:clip@0");
    const { svg, warnings } = await toSvg([clip()]);
    expect(warnings).toEqual([]);
    expect(svg).toContain('<rect width="160" height="90" fill="#eceef3"/>');
    expect(svg).not.toContain("<use");
  });
});
