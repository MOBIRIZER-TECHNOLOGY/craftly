/**
 * The maths of a two-finger pinch: where the fingers are, what zoom their distance asks for, and where the view has to
 * scroll so that a point of the design stays under them.
 */
import { describe, expect, it } from "vitest";
import { fingerSpan, pinchZoom, scrollToKeep } from "./pinch";
import { screenToDesign, type ViewMetrics } from "./viewStore";

describe("where two fingers are", () => {
  it("gives the point half way between them and how far apart they are", () => {
    expect(fingerSpan({ x: 100, y: 100 }, { x: 400, y: 500 })).toEqual({ mid: { x: 250, y: 300 }, dist: 500 });
  });

  it("does not care which finger is which", () => {
    expect(fingerSpan({ x: 400, y: 500 }, { x: 100, y: 100 })).toEqual(fingerSpan({ x: 100, y: 100 }, { x: 400, y: 500 }));
  });
});

describe("the zoom a pinch asks for", () => {
  it("grows and shrinks with the distance between the fingers", () => {
    expect(pinchZoom(1, 200, 400, 0.05, 4)).toBe(2);
    expect(pinchZoom(1.5, 200, 100, 0.05, 4)).toBe(0.75);
  });

  it("is the zoom the pinch began with while the distance is the same", () => {
    expect(pinchZoom(0.8, 240, 240, 0.05, 4)).toBe(0.8);
  });

  it("stays within the limits", () => {
    expect(pinchZoom(1, 10, 900, 0.05, 4)).toBe(4);
    expect(pinchZoom(1, 900, 10, 0.05, 4)).toBe(0.05);
  });

  it("stays a number when the fingers began, or now are, on the same spot", () => {
    expect(pinchZoom(1, 0, 3, 0.05, 4)).toBe(3);
    expect(pinchZoom(1, 2, 0, 0.05, 4)).toBe(0.5);
    expect(pinchZoom(1, 0, 0, 0.05, 4)).toBe(1);
  });
});

describe("the scroll position that keeps a design point under the fingers", () => {
  it("is the one at which the screen point reads back as that design point", () => {
    const page = { pageLeft: 72, pageTop: 48 };
    const scroll = scrollToKeep({ x: 300, y: 200 }, { x: 500, y: 350 }, page, 2);
    expect(scroll).toEqual({ left: 172, top: 98 });
    const metrics = { ...page, zoom: 2, scrollLeft: scroll.left, scrollTop: scroll.top } as ViewMetrics;
    expect(screenToDesign(metrics, 500, 350)).toEqual({ x: 300, y: 200 });
  });
});
