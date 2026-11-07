import { afterEach, describe, expect, it } from "vitest";
import { designToScreen, getMetrics, initialMetrics, layoutFor, MARGIN_X, MARGIN_Y, screenToDesign, setZoomAnchor, takeZoomAnchor, useView } from "./viewStore";

afterEach(() => {
  useView.setState({ ...initialMetrics });
  takeZoomAnchor();
});

describe("the view store", () => {
  it("merges partial updates and exposes them as metrics", () => {
    useView.getState().set({ scrollLeft: 40, zoom: 2 });
    expect(getMetrics()).toMatchObject({ scrollLeft: 40, zoom: 2, width: initialMetrics.width });
  });
});

describe("the zoom anchor", () => {
  it("is handed over once and then forgotten", () => {
    setZoomAnchor({ sx: 10, sy: 20, dx: 30, dy: 40 });
    expect(takeZoomAnchor()).toEqual({ sx: 10, sy: 20, dx: 30, dy: 40 });
    expect(takeZoomAnchor()).toBeNull();
  });

  it("can be cancelled", () => {
    setZoomAnchor({ sx: 1, sy: 2, dx: 3, dy: 4 });
    setZoomAnchor(null);
    expect(takeZoomAnchor()).toBeNull();
  });
});

describe("layoutFor", () => {
  it("keeps the margins around a page that fills the workspace", () => {
    const l = layoutFor(2000, 1000, 1, 800, 600);
    expect(l.contentW).toBe(2000 + MARGIN_X * 2);
    expect(l.contentH).toBe(1000 + MARGIN_Y * 2);
    expect(l.pageLeft).toBe(MARGIN_X);
    expect(l.pageTop).toBe(MARGIN_Y);
  });

  it("leaves room below the page for the extra strip", () => {
    const l = layoutFor(400, 200, 1, 1000, 700, 100);
    expect(l.contentH).toBe(700);
    expect(l.pageTop).toBe((700 - 100 - 200) / 2);
  });
});

describe("coordinates", () => {
  const m = { ...initialMetrics, pageLeft: 100, pageTop: 50, zoom: 2, scrollLeft: 30, scrollTop: 10 };

  it("converts design pixels to workspace pixels and back", () => {
    expect(designToScreen(m, 20, 5)).toEqual({ x: 100 + 40 - 30, y: 50 + 10 - 10 });
    expect(screenToDesign(m, 110, 50)).toEqual({ x: 20, y: 5 });
  });
});
