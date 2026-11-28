/** A video element in the context panel: sized and framed as a picture is, with an outline, a shadow and a name of its own. */
import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createLine, createPage, createShape, createVideo } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { DesignElement, VideoElement } from "@/core/types";
import { defaultRatioLock, resizeSingle } from "./boxEdit";
import { applySolid, describeTarget } from "./colorTargets";
import { layerKind } from "./layerInfo";
import { supportsShadow, supportsStroke } from "./selectionKinds";

const clip = (init: Partial<VideoElement> = {}) => createVideo({ src: "asset:clip", naturalWidth: 1000, naturalHeight: 1000, width: 400, height: 400, ...init });

describe("the size of a clip", () => {
  it("starts with the ratio lock on for one clip, as for a picture", () => {
    expect(defaultRatioLock([clip()])).toBe(true);
    expect(defaultRatioLock([createShape("rect")])).toBe(false);
  });

  it("scales the clip, its corners with it, and keeps its crop when the ratio is locked", () => {
    const el = clip({ radius: 20 });
    const before = structuredClone(el.crop);
    resizeSingle(el, 200, 200, true);
    expect(el).toMatchObject({ width: 200, height: 200, radius: 10 });
    expect(el.crop).toEqual(before);
  });

  it("moves the frame over the clip without the ratio lock: the clip keeps its size and still covers the frame", () => {
    const el = clip({ radius: 20 });
    resizeSingle(el, 200, 400, false);
    expect(el).toMatchObject({ width: 200, height: 400, radius: 20 });
    // the clip is still 400 wide inside a frame 200 wide
    expect(el.crop.w * el.width).toBeCloseTo(400);
    expect(el.crop.x).toBeLessThanOrEqual(0);
    expect(el.crop.x + el.crop.w).toBeGreaterThanOrEqual(1 - 1e-9);
    // a frame larger than the clip zooms it just enough
    resizeSingle(el, 800, 400, false);
    expect(el.crop.w * el.width).toBeGreaterThanOrEqual(800 - 1e-6);
  });
});

describe("what a clip supports", () => {
  it("has a shadow and an outline, and is called a video in the layers", () => {
    expect(supportsShadow(clip())).toBe(true);
    expect(supportsStroke(clip())).toBe(true);
    expect(layerKind(clip())).toBe("Video");
  });
});

describe("the outline colour of a clip", () => {
  beforeEach(() => useEditor.setState(useEditor.getInitialState(), true));

  const load = (elements: DesignElement[]) => {
    const { actions } = useEditor.getState();
    actions.openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ elements })] }));
    actions.select(elements.map((e) => e.id));
  };
  const find = (el: DesignElement) => getActivePage(useEditor.getState())!.elements.find((e) => e.id === el.id) as VideoElement;

  it("is read from its outline, and is nothing while it has none", () => {
    const page = createPage();
    expect(describeTarget("stroke", undefined, [clip({ stroke: { color: "#445566", width: 3, style: "dashed" } })], page)).toMatchObject({
      supported: true,
      current: { type: "solid", color: "#445566" },
    });
    expect(describeTarget("stroke", undefined, [clip()], page)).toMatchObject({ supported: true, current: null });
    // beside a line, the first of the two that has an outline is the one read
    const line = createLine({ stroke: { color: "#112233", width: 2, style: "solid" } });
    expect(describeTarget("stroke", undefined, [line, clip()], page).current).toEqual({ type: "solid", color: "#112233" });
  });

  it("recolours an outline and keeps its width and style", () => {
    const el = clip({ stroke: { color: "#445566", width: 3, style: "dashed" } });
    load([el]);
    applySolid("stroke", undefined, "#ff0000");
    expect(find(el).stroke).toEqual({ color: "#ff0000", width: 3, style: "dashed" });
  });

  it("gives a clip without an outline one of the colour, as wide as the design asks", () => {
    const el = clip();
    load([el]);
    applySolid("stroke", undefined, "#00ff00");
    expect(find(el).stroke).toEqual({ color: "#00ff00", width: 2, style: "solid" });
  });
});
