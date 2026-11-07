import { describe, expect, it, vi } from "vitest";
import { rect, stubRects } from "@/test/dashuiLayout";
import {
  LAYER_ATTR,
  OVERLAY_ROOT_ID,
  anchorRect,
  findParentLayer,
  getOverlayRoot,
  layerContains,
  parsePlacement,
  placeFloating,
  registerLayer,
  zAbove,
  type PlaceOptions,
} from "./overlay";

const VIEWPORT = { width: 1000, height: 800 };

/** A 100 x 30 anchor at (100, 100) and a 120 x 80 panel, placed under it with an 8 px gap. */
function place(over: Partial<PlaceOptions> = {}) {
  return placeFloating({
    anchor: { left: 100, top: 100, right: 200, bottom: 130 },
    size: { width: 120, height: 80 },
    placement: { side: "bottom", align: "start" },
    offset: 8,
    viewport: VIEWPORT,
    ...over,
  });
}

describe("getOverlayRoot", () => {
  it("creates the overlay root once and keeps handing out the same element", () => {
    expect(document.getElementById(OVERLAY_ROOT_ID)).toBeNull();
    const first = getOverlayRoot();
    expect(first.id).toBe(OVERLAY_ROOT_ID);
    expect(first.parentElement).toBe(document.body);
    expect(getOverlayRoot()).toBe(first);
    expect(document.querySelectorAll(`#${OVERLAY_ROOT_ID}`)).toHaveLength(1);
  });
});

describe("registerLayer", () => {
  it("counts the open layers on the body and clears the mark when the last one goes", () => {
    const a = document.createElement("div");
    const b = document.createElement("div");
    const closeA = registerLayer(a, null);
    expect(document.body.dataset.cfOverlay).toBe("1");
    const closeB = registerLayer(b, a);
    expect(document.body.dataset.cfOverlay).toBe("2");
    closeB();
    expect(document.body.dataset.cfOverlay).toBe("1");
    closeA();
    expect(document.body.dataset.cfOverlay).toBeUndefined();
  });

  it("never lets the count go below zero", () => {
    const layer = document.createElement("div");
    const close = registerLayer(layer, null);
    close();
    close();
    expect(document.body.dataset.cfOverlay).toBeUndefined();
    const again = registerLayer(layer, null);
    expect(document.body.dataset.cfOverlay).toBe("1");
    again();
  });
});

describe("findParentLayer", () => {
  it("is null without an anchor", () => {
    expect(findParentLayer(null)).toBeNull();
  });

  it("finds the layer that contains an element anchor", () => {
    const layer = document.createElement("div");
    layer.setAttribute(LAYER_ATTR, "popover");
    const button = document.createElement("button");
    layer.append(button);
    document.body.append(layer);
    expect(findParentLayer(button)).toBe(layer);
    expect(findParentLayer(layer)).toBe(layer);
  });

  it("is null for an element that sits in no layer", () => {
    const button = document.createElement("button");
    document.body.append(button);
    expect(findParentLayer(button)).toBeNull();
  });

  it("asks the document what is under a point anchor", () => {
    const layer = document.createElement("div");
    layer.setAttribute(LAYER_ATTR, "modal");
    const inner = document.createElement("span");
    layer.append(inner);
    document.body.append(layer);
    const hit = vi.spyOn(document, "elementFromPoint").mockReturnValue(inner);
    expect(findParentLayer({ x: 12, y: 34 })).toBe(layer);
    expect(hit).toHaveBeenCalledWith(12, 34);
    hit.mockReturnValue(null);
    expect(findParentLayer({ x: 1, y: 2 })).toBeNull();
  });
});

describe("layerContains", () => {
  it("is true for the root itself and for anything inside it", () => {
    const root = document.createElement("div");
    const child = document.createElement("button");
    root.append(child);
    document.body.append(root);
    expect(layerContains(root, root)).toBe(true);
    expect(layerContains(root, child)).toBe(true);
  });

  it("is false for something elsewhere in the page, or for no target", () => {
    const root = document.createElement("div");
    const other = document.createElement("div");
    document.body.append(root, other);
    expect(layerContains(root, other)).toBe(false);
    expect(layerContains(root, null)).toBe(false);
    expect(layerContains(root, window)).toBe(false);
  });

  it("counts a layer that was opened from the root as inside it, however deep", () => {
    const root = document.createElement("div");
    const popover = document.createElement("div");
    const submenu = document.createElement("div");
    const item = document.createElement("button");
    submenu.append(item);
    document.body.append(root, popover, submenu);
    const closePopover = registerLayer(popover, root);
    const closeSubmenu = registerLayer(submenu, popover);
    expect(layerContains(root, item)).toBe(true);
    expect(layerContains(popover, item)).toBe(true);
    closeSubmenu();
    closePopover();
    expect(layerContains(root, item)).toBe(false);
  });

  it("gives up on parent loops instead of hanging", () => {
    const root = document.createElement("div");
    const a = document.createElement("div");
    const b = document.createElement("div");
    document.body.append(root, a, b);
    const closeA = registerLayer(a, b);
    const closeB = registerLayer(b, a);
    expect(layerContains(root, a)).toBe(false);
    closeA();
    closeB();
  });
});

describe("zAbove", () => {
  it("is null without a parent layer", () => {
    expect(zAbove(null)).toBeNull();
  });

  it("is one above the parent's z-index", () => {
    const parent = document.createElement("div");
    parent.style.zIndex = "250";
    document.body.append(parent);
    expect(zAbove(parent)).toBe(251);
  });

  it("is null when the parent has no numeric z-index", () => {
    const parent = document.createElement("div");
    document.body.append(parent);
    expect(zAbove(parent)).toBeNull();
    parent.style.zIndex = "auto";
    expect(zAbove(parent)).toBeNull();
  });
});

describe("parsePlacement", () => {
  it("splits the side from the alignment", () => {
    expect(parsePlacement("bottom-start")).toEqual({ side: "bottom", align: "start" });
    expect(parsePlacement("top-end")).toEqual({ side: "top", align: "end" });
    expect(parsePlacement("right-start")).toEqual({ side: "right", align: "start" });
  });

  it("centres when no alignment is given", () => {
    expect(parsePlacement("top")).toEqual({ side: "top", align: "center" });
  });
});

describe("anchorRect", () => {
  it("reads the box of an element anchor", () => {
    const el = document.createElement("button");
    document.body.append(el);
    const restore = stubRects(() => rect(10, 20, 30, 40));
    expect(anchorRect(el)).toEqual({ left: 10, top: 20, right: 40, bottom: 60 });
    restore();
  });

  it("turns a point into an empty box", () => {
    expect(anchorRect({ x: 5, y: 9 })).toEqual({ left: 5, top: 9, right: 5, bottom: 9 });
  });
});

describe("placeFloating", () => {
  it("puts the panel under the anchor, left edges aligned, and says how tall it may be", () => {
    expect(place()).toEqual({ x: 100, y: 138, side: "bottom", align: "start", maxHeight: 654 });
  });

  it("centres the panel on the anchor for the centre alignment", () => {
    const result = place({ placement: { side: "bottom", align: "center" }, size: { width: 60, height: 40 } });
    expect(result.x).toBe(120);
    expect(result.align).toBe("center");
  });

  it("aligns the right edges for the end alignment", () => {
    const result = place({ placement: { side: "bottom", align: "end" } });
    expect(result.x).toBe(80);
  });

  it("honours the cross-axis offset", () => {
    expect(place({ alignOffset: 12 }).x).toBe(112);
    expect(place({ placement: { side: "bottom", align: "end" }, alignOffset: 12 }).x).toBe(68);
  });

  it("flips above the anchor when it does not fit below and there is more room above", () => {
    const result = place({ anchor: { left: 100, top: 700, right: 200, bottom: 730 }, size: { width: 120, height: 200 } });
    expect(result.side).toBe("top");
    expect(result.y).toBe(700 - 8 - 200);
  });

  it("flips below when a top placement does not fit but the room below does", () => {
    const result = place({ placement: { side: "top", align: "start" }, anchor: { left: 100, top: 20, right: 200, bottom: 50 }, size: { width: 120, height: 100 } });
    expect(result.side).toBe("bottom");
    expect(result.y).toBe(58);
  });

  it("stays on its side when flipping is switched off, shifting the panel into view instead", () => {
    const result = place({ anchor: { left: 100, top: 700, right: 200, bottom: 730 }, size: { width: 120, height: 200 }, flip: false });
    expect(result.side).toBe("bottom");
    // the panel is squeezed to the minimum height (160) and pushed up until it ends at the viewport margin
    expect(result.maxHeight).toBe(160);
    expect(result.y).toBe(800 - 8 - 160);
  });

  it("does not flip when the other side is no roomier", () => {
    const result = place({ viewport: { width: 400, height: 300 }, anchor: { left: 50, top: 140, right: 100, bottom: 160 }, size: { width: 100, height: 250 } });
    expect(result.side).toBe("bottom");
  });

  it("shrinks a tall panel to the room left, but never below the minimum height", () => {
    const tight = { viewport: { width: 400, height: 300 }, anchor: { left: 50, top: 140, right: 100, bottom: 160 }, size: { width: 100, height: 250 } };
    expect(place(tight).maxHeight).toBe(160);
    const lowerMinimum = place({ ...tight, minHeight: 100 });
    expect(lowerMinimum.maxHeight).toBe(124);
    expect(lowerMinimum.y).toBe(168);
  });

  it("switches a start alignment to end when the panel would run off the right edge", () => {
    const result = place({ viewport: { width: 400, height: 800 }, anchor: { left: 350, top: 10, right: 390, bottom: 30 }, size: { width: 100, height: 50 } });
    expect(result.align).toBe("end");
    expect(result.x).toBe(290);
  });

  it("switches an end alignment to start when the panel would run off the left edge", () => {
    const result = place({
      placement: { side: "bottom", align: "end" },
      viewport: { width: 400, height: 800 },
      anchor: { left: 5, top: 10, right: 40, bottom: 30 },
      size: { width: 100, height: 50 },
    });
    expect(result.align).toBe("start");
    expect(result.x).toBe(8);
  });

  it("keeps the panel inside the viewport margin on every edge", () => {
    const left = place({ anchor: { left: -50, top: 100, right: -10, bottom: 130 } });
    expect(left.x).toBe(8);
    const right = place({ anchor: { left: 990, top: 100, right: 1030, bottom: 130 }, placement: { side: "bottom", align: "center" } });
    expect(right.x).toBe(1000 - 8 - 120);
    const margin = place({ margin: 20, anchor: { left: 0, top: 0, right: 10, bottom: 10 } });
    expect(margin.x).toBe(20);
  });

  it("limits the panel width to the viewport", () => {
    const result = place({ size: { width: 5000, height: 80 }, viewport: { width: 300, height: 800 } });
    expect(result.x).toBe(8);
  });

  it("places a panel to the right of the anchor, top edges aligned", () => {
    const result = place({ placement: { side: "right", align: "start" }, size: { width: 200, height: 100 } });
    expect(result).toEqual({ x: 208, y: 100, side: "right", align: "start", maxHeight: 784 });
    expect(place({ placement: { side: "right", align: "start" }, size: { width: 200, height: 100 }, alignOffset: -6 }).y).toBe(94);
  });

  it("flips a right placement to the left when it does not fit", () => {
    const result = place({ placement: { side: "right", align: "start" }, anchor: { left: 850, top: 100, right: 950, bottom: 130 }, size: { width: 200, height: 100 } });
    expect(result.side).toBe("left");
    expect(result.x).toBe(850 - 8 - 200);
  });

  it("supports the end and centre alignments on the sides", () => {
    const base = { placement: { side: "left" as const, align: "end" as const }, anchor: { left: 400, top: 100, right: 500, bottom: 160 }, size: { width: 100, height: 40 } };
    expect(place(base).y).toBe(160 - 40);
    expect(place({ ...base, placement: { side: "left", align: "center" } }).y).toBe(100 + (60 - 40) / 2);
  });

  it("limits the height of a side panel to the viewport", () => {
    const result = place({ placement: { side: "right", align: "start" }, size: { width: 100, height: 5000 } });
    expect(result.y).toBe(8);
    expect(result.maxHeight).toBe(784);
  });

  it("reads the window size when no viewport is given", () => {
    const result = placeFloating({
      anchor: { left: 100, top: 780, right: 200, bottom: 790 },
      size: { width: 100, height: 100 },
      placement: { side: "bottom", align: "start" },
      offset: 4,
    });
    expect(result.side).toBe("top");
    expect(result.y).toBe(780 - 4 - 100);
  });
});
