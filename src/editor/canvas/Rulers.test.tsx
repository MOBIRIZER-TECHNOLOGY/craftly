/**
 * The rulers along the top and left edge of the workspace and the guides dragged out of them: painting the scale,
 * dropping a guide on the page, moving a guide and dragging it back onto the ruler to remove it.
 */
import { act, configure, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createShape } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { contextOf } from "@/test/canvasMock";
import { canvasDesign, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { RULER } from "./Rulers";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const guides = () => state().design!.guides;
const showRulers = () => act(() => getActions().toggle("showRulers"));
const top = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>(".cf-ruler--top")!;
const left = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>(".cf-ruler--left")!;
const labels = (canvas: HTMLCanvasElement) =>
  contextOf(canvas)!
    .callsTo("fillText")
    .map((c) => c[0]);

afterEach(() => {
  Object.defineProperty(window, "devicePixelRatio", { value: 1, configurable: true, writable: true });
});

/** Page point (x, y) in design px as client coordinates: the page sits 72 px from the left and 48 px from the top. */
const page = (x: number, y: number): [number, number] => [x + 72, y + 48];

describe("showing the rulers", () => {
  it("draws no rulers until they are switched on", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(top(rig)).toBeNull();
    expect(left(rig)).toBeNull();
    showRulers();
    expect(top(rig)).toBeTruthy();
    expect(left(rig)).toBeTruthy();
    expect(rig.container.querySelector(".cf-ruler__corner")).toBeTruthy();
    showRulers();
    expect(top(rig)).toBeNull();
  });

  it("labels the scale in design pixels", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const canvas = top(rig).querySelector("canvas")!;
    await waitFor(() => expect(labels(canvas).length).toBeGreaterThan(5));
    expect(labels(canvas)).toEqual(expect.arrayContaining(["0", "100", "500", "800"]));
    expect(canvas.width).toBe(1000 - RULER);
    expect(canvas.height).toBe(RULER);
    const side = left(rig).querySelector("canvas")!;
    await waitFor(() => expect(labels(side)).toEqual(expect.arrayContaining(["0", "100", "500"])));
    expect([side.width, side.height]).toEqual([RULER, 700 - RULER]);
  });

  it("paints the page extent lighter than the rest of the ruler", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const canvas = top(rig).querySelector("canvas")!;
    await waitFor(() => expect(contextOf(canvas)?.callsTo("fillRect").length).toBeGreaterThan(0));
    // the page starts 72 px in, the ruler starts 22 px in: design 0 is at 50 and the page is 856 wide
    expect(contextOf(canvas)!.callsTo("fillRect")[0]).toEqual([50, 0, 856, RULER]);
  });

  it("is repainted with a finer scale when the view is zoomed in", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const canvas = top(rig).querySelector("canvas")!;
    await waitFor(() => expect(labels(canvas).length).toBeGreaterThan(0));
    const step = (list: unknown[]) => Number(list[1]) - Number(list[0]);
    expect(step(labels(canvas))).toBe(100);
    contextOf(canvas)!.reset();
    act(() => getActions().setZoom(2));
    await waitFor(() => expect(labels(canvas).length).toBeGreaterThan(0));
    expect(step(labels(canvas))).toBe(50);
  });
});

describe("rulers on unusual screens", () => {
  it("assume one device pixel per pixel when the browser reports no ratio", async () => {
    Object.defineProperty(window, "devicePixelRatio", { value: 0, configurable: true, writable: true });
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const canvas = top(rig).querySelector("canvas")!;
    await waitFor(() => expect(labels(canvas).length).toBeGreaterThan(0));
    expect(canvas.width).toBe(1000 - RULER);
  });

  it("stay blank, without errors, when the canvas has no 2D context", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const getContext = vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    showRulers();
    await waitFor(() => expect(getContext).toHaveBeenCalled());
    // the canvases are sized but never painted
    const canvas = top(rig).querySelector("canvas")!;
    expect(canvas.width).toBe(1000 - RULER);
    expect(contextOf(canvas)).toBeUndefined();
  });
});

describe("dragging a guide out of a ruler", () => {
  it("drops a horizontal guide from the top ruler and previews it with its position", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const ruler = top(rig);
    rig.pointerAt("pointerDown", 300, 10, { target: ruler });
    expect(rig.container.querySelector(".cf-gline--h.cf-gline--draft")).toBeTruthy();
    rig.pointerAt("pointerMove", 300, 200, { target: ruler });
    expect(rig.container.querySelector(".cf-gline--draft")?.getAttribute("style")).toContain("top: 200px");
    expect(rig.container.querySelector(".cf-hud")?.textContent).toBe("152");
    rig.pointerAt("pointerUp", 300, 200, { target: ruler });
    expect(guides()).toEqual({ vertical: [], horizontal: [152] });
    expect(rig.container.querySelector(".cf-gline--draft")).toBeNull();
    expect(rig.container.querySelector(".cf-gline--h")).toBeTruthy();
    expect(state().past).toHaveLength(1);
  });

  it("drops a vertical guide from the left ruler", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const ruler = left(rig);
    rig.pointerAt("pointerDown", 10, 300, { target: ruler });
    expect(rig.container.querySelector(".cf-gline--v.cf-gline--draft")).toBeTruthy();
    rig.pointerAt("pointerMove", 372, 300, { target: ruler });
    expect(rig.container.querySelector(".cf-hud")?.textContent).toBe("300");
    rig.pointerAt("pointerUp", 372, 300, { target: ruler });
    expect(guides()).toEqual({ vertical: [300], horizontal: [] });
  });

  it("adds no guide when the pointer is released over the ruler again", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const ruler = top(rig);
    rig.pointerAt("pointerDown", 300, 10, { target: ruler });
    rig.pointerAt("pointerMove", 300, 100, { target: ruler });
    rig.pointerAt("pointerUp", 300, 15, { target: ruler });
    expect(guides()).toBeUndefined();
    expect(rig.container.querySelector(".cf-gline--draft")).toBeNull();
    expect(state().past).toHaveLength(0);
  });

  it("drops no guide and takes the preview away when the drag is cancelled", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    const ruler = top(rig);
    rig.pointerAt("pointerDown", 300, 10, { target: ruler });
    rig.pointerAt("pointerMove", 300, 200, { target: ruler });
    fireEvent.pointerCancel(ruler, { pointerId: 1, clientX: 300, clientY: 200 });
    expect(rig.container.querySelector(".cf-gline--draft")).toBeNull();
    expect(rig.container.querySelector(".cf-hud")).toBeNull();
    expect(guides()).toBeUndefined();
    // the drag is over: what the pointer does next is not part of it
    rig.pointerAt("pointerMove", 300, 250, { target: ruler });
    expect(rig.container.querySelector(".cf-gline--draft")).toBeNull();
    rig.pointerAt("pointerUp", 300, 250, { target: ruler });
    expect(guides()).toBeUndefined();
    expect(state().past).toHaveLength(0);
  });

  it("does not start a canvas gesture when a ruler is pressed", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 0, y: 0, width: 400, height: 400 })]));
    showRulers();
    rig.down(100, 100, { target: left(rig) });
    expect(state().selection).toEqual([]);
  });

  it("rounds the position to a tenth of a pixel", async () => {
    const rig = await mountWorkspace(canvasDesign());
    showRulers();
    rig.pointerAt("pointerDown", 300, 10, { target: top(rig) });
    rig.pointerAt("pointerUp", 300, 100.26, { target: top(rig) });
    expect(guides()?.horizontal).toEqual([52.3]);
  });
});

describe("page margins", () => {
  it("draws the default margin and then the custom size saved on the design", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(rig.container.querySelector("[data-cf-margins]")).toBeNull();
    act(() => getActions().toggle("showMargins"));
    expect(rig.container.querySelector<HTMLElement>("[data-cf-margins]")?.style.inset).toBe("30px");
    act(() => getActions().setMargin(75));
    expect(rig.container.querySelector<HTMLElement>("[data-cf-margins]")?.style.inset).toBe("75px");
  });
});

describe("guides on the page", () => {
  const withGuides = () => canvasDesign([], { guides: { vertical: [300], horizontal: [200] } });
  const line = (rig: CanvasRig, axis: "v" | "h") => rig.container.querySelector<HTMLElement>(`.cf-gline--${axis}:not(.cf-gline--draft)`)!;

  it("draws each guide across the page at its position", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    expect(line(rig, "v").style.left).toBe("300px");
    expect(line(rig, "h").style.top).toBe("200px");
  });

  it("scales the guides with the zoom", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    act(() => getActions().setZoom(0.5));
    expect(line(rig, "v").style.left).toBe("150px");
  });

  it("hides the guides together with the rulers", async () => {
    const rig = await mountWorkspace(withGuides());
    expect(rig.container.querySelector(".cf-gline")).toBeNull();
    showRulers();
    expect(rig.container.querySelector(".cf-gline")).toBeTruthy();
  });

  it("draws nothing when the design has no guides", async () => {
    const rig = await mountWorkspace(canvasDesign([], { guides: { vertical: [], horizontal: [] } }));
    showRulers();
    expect(rig.container.querySelector(".cf-gline")).toBeNull();
  });

  it("moves a guide with the pointer as one undo step", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    const guide = line(rig, "v");
    rig.pointerAt("pointerDown", ...page(300, 100), { target: guide });
    rig.pointerAt("pointerMove", ...page(350, 100), { target: guide });
    expect(guides()!.vertical).toEqual([350]);
    rig.pointerAt("pointerMove", ...page(420, 100), { target: guide });
    rig.pointerAt("pointerUp", ...page(420, 100), { target: guide });
    expect(guides()!.vertical).toEqual([420]);
    expect(state().past).toHaveLength(1);
    act(() => getActions().undo());
    expect(guides()!.vertical).toEqual([300]);
  });

  it("moves a horizontal guide up and down", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    const guide = line(rig, "h");
    rig.pointerAt("pointerDown", ...page(100, 200), { target: guide });
    rig.pointerAt("pointerMove", ...page(100, 260), { target: guide });
    rig.pointerAt("pointerUp", ...page(100, 260), { target: guide });
    expect(guides()!.horizontal).toEqual([260]);
  });

  it("removes a guide that is dragged back onto its ruler", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    const vertical = line(rig, "v");
    rig.pointerAt("pointerDown", ...page(300, 100), { target: vertical });
    rig.pointerAt("pointerMove", 10, 148, { target: vertical });
    rig.pointerAt("pointerUp", 10, 148, { target: vertical });
    expect(guides()!.vertical).toEqual([]);
    expect(guides()!.horizontal).toEqual([200]);
    const horizontal = line(rig, "h");
    rig.pointerAt("pointerDown", ...page(100, 200), { target: horizontal });
    rig.pointerAt("pointerUp", 200, 10, { target: horizontal });
    expect(guides()!.horizontal).toEqual([]);
    expect(state().past).toHaveLength(2);
  });

  it("keeps a guide where it was when the move is cancelled, as one undo step, and leaves undo working", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    const guide = line(rig, "v");
    rig.pointerAt("pointerDown", ...page(300, 100), { target: guide });
    rig.pointerAt("pointerMove", ...page(350, 100), { target: guide });
    fireEvent.pointerCancel(guide, { pointerId: 1, clientX: 10, clientY: 148 });
    // cancelled over the ruler: the guide is not removed, it stays where the pointer last put it
    expect(guides()!.vertical).toEqual([350]);
    expect(state().past).toHaveLength(1);
    rig.pointerAt("pointerMove", ...page(420, 100), { target: guide });
    expect(guides()!.vertical).toEqual([350]);
    act(() => getActions().undo());
    expect(guides()!.vertical).toEqual([300]);
  });

  it("cannot be moved in view mode", async () => {
    const rig = await mountWorkspace(withGuides());
    showRulers();
    act(() => getActions().setMode("view"));
    const guide = line(rig, "v");
    expect(rig.pointerAt("pointerDown", ...page(300, 100), { target: guide })).toBe(true);
    rig.pointerAt("pointerMove", ...page(400, 100), { target: guide });
    rig.pointerAt("pointerUp", ...page(400, 100), { target: guide });
    expect(guides()!.vertical).toEqual([300]);
  });

  it("does not start a canvas gesture when a guide is pressed", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 0, y: 0, width: 856, height: 604 })], { guides: { vertical: [300], horizontal: [] } }));
    showRulers();
    rig.down(300, 100, { target: line(rig, "v") });
    expect(state().selection).toEqual([]);
  });
});

describe("the margins of the page", () => {
  const margins = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>("[data-cf-margins]");

  it("are drawn only when they are switched on, a twentieth of the shorter side in from every edge, at the zoom of the view", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(margins(rig)).toBeNull();
    act(() => getActions().toggle("showMargins"));
    const d = state().design!;
    const inset = Math.round(Math.min(d.width, d.height) * 0.05) * state().zoom;
    expect(margins(rig)?.style.inset).toBe(`${inset}px`);
    expect(margins(rig)?.getAttribute("aria-hidden")).toBe("true");
    act(() => getActions().toggle("showMargins"));
    expect(margins(rig)).toBeNull();
  });
});
