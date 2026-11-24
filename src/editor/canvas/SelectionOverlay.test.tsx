/**
 * What is drawn over the page for the selection: the outline and handles, the hover outline, the pink snap guides,
 * the marquee and freehand preview, and the size / angle label that follows the pointer.
 */
import { act } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createLine, createShape, createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import { canvasDesign, mountWorkspace, selectIds, type CanvasRig } from "@/test/canvasUtils";
import { useGesture } from "./gestureStore";

const handles = (rig: CanvasRig) => Array.from(rig.host.querySelectorAll("[data-cf-handle]")).map((h) => h.getAttribute("data-cf-handle"));
const frame = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>(".cf-sel")!;
const box = (id: string, extra: Record<string, unknown> = {}) => createShape("rect", { id, x: 100, y: 100, width: 200, height: 100, ...extra });

describe("the selection outline", () => {
  it("draws nothing while nothing is selected", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    expect(frame(rig)).toBeNull();
    expect(handles(rig)).toEqual([]);
  });

  it("frames a shape with eight resize handles, a rotate handle and a move handle", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    selectIds("a");
    expect(handles(rig)).toEqual(["resize:nw", "resize:n", "resize:ne", "resize:e", "resize:se", "resize:s", "resize:sw", "resize:w", "rotate", "move"]);
    expect([frame(rig).style.left, frame(rig).style.top, frame(rig).style.width, frame(rig).style.height]).toEqual(["100px", "100px", "200px", "100px"]);
    expect(rig.getByTitle("Rotate")).toBe(rig.handle("rotate"));
    expect(rig.getByTitle("Move")).toBe(rig.handle("move"));
  });

  it("places each handle on the box and gives it the matching cursor", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    selectIds("a");
    const se = rig.handle("resize:se");
    expect([se.style.left, se.style.top, se.style.cursor]).toEqual(["100%", "100%", "nwse-resize"]);
    const n = rig.handle("resize:n");
    expect([n.style.left, n.style.top, n.style.cursor]).toEqual(["50%", "0%", "ns-resize"]);
    expect(rig.handle("resize:ne").style.cursor).toBe("nesw-resize");
    expect(rig.handle("resize:w").style.cursor).toBe("ew-resize");
  });

  it("follows the zoom and the rotation of the element", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a", { rotation: 30 })]));
    selectIds("a");
    act(() => getActions().setZoom(0.5));
    expect([frame(rig).style.left, frame(rig).style.width, frame(rig).style.height]).toEqual(["50px", "100px", "50px"]);
    expect(frame(rig).style.transform).toBe("rotate(30deg)");
  });

  it("gives a text box only the handles that change its width and size", async () => {
    const rig = await mountWorkspace(canvasDesign([createText({ id: "t", text: "Hello", x: 100, y: 100, width: 300, fontSize: 40 })]));
    selectIds("t");
    expect(handles(rig)).toEqual(["resize:nw", "resize:ne", "resize:se", "resize:sw", "resize:e", "resize:w", "rotate", "move"]);
  });

  it("outlines each of several elements and frames them together", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a"), box("b", { x: 400 })]));
    selectIds("a", "b");
    expect(rig.container.querySelectorAll(".cf-outline--item")).toHaveLength(2);
    expect([frame(rig).style.left, frame(rig).style.width]).toEqual(["100px", "500px"]);
    expect(handles(rig)).toHaveLength(10);
  });

  it("shows a locked element's outline without handles", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a", { locked: true })]));
    selectIds("a");
    expect(frame(rig).className).toContain("cf-sel--locked");
    expect(handles(rig)).toEqual([]);
  });

  it("keeps the handles of the others when only one of several is locked", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a", { locked: true }), box("b", { x: 400 })]));
    selectIds("a", "b");
    expect(frame(rig).className).toContain("cf-sel--locked");
    expect(handles(rig).filter((h) => h?.startsWith("resize"))).toHaveLength(8);
    expect(handles(rig)).not.toContain("rotate");
  });

  it("drops the handles while the text is being edited, and marks the box", async () => {
    const rig = await mountWorkspace(canvasDesign([createText({ id: "t", text: "Hello", x: 100, y: 100, width: 300, fontSize: 40 })]));
    act(() => getActions().startTextEdit("t"));
    expect(frame(rig).className).toContain("cf-sel--editing");
    expect(handles(rig)).toEqual([]);
  });

  it("gives way to the crop frame while a picture is cropped", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    selectIds("a");
    act(() => useEditor.setState({ croppingId: "a" }));
    expect(frame(rig)).toBeNull();
  });

  it("offers no handles while a drawing tool is active", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    selectIds("a");
    act(() => useEditor.setState({ tool: "shape" }));
    expect(handles(rig).filter((h) => h?.startsWith("resize"))).toEqual([]);
    expect(handles(rig)).not.toContain("rotate");
  });

  it("shows nothing in view mode", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    selectIds("a");
    act(() => getActions().setMode("view"));
    expect(frame(rig)).toBeNull();
    expect(rig.container.querySelector(".cf-outline")).toBeNull();
  });
});

describe("lines", () => {
  it("get a handle at each end instead of a box", async () => {
    const rig = await mountWorkspace(canvasDesign([createLine({ id: "ln", x: 100, y: 300, width: 300 })]));
    selectIds("ln");
    expect(handles(rig)).toEqual(["line:0", "line:1"]);
    expect(rig.container.querySelector(".cf-sel--line")).toBeTruthy();
    expect(rig.handle("line:1").style.left).toBe("100%");
  });

  it("get no handles when locked", async () => {
    const rig = await mountWorkspace(canvasDesign([createLine({ id: "ln", x: 100, y: 300, width: 300, locked: true })]));
    selectIds("ln");
    expect(handles(rig)).toEqual([]);
  });

  it("are not outlined on hover", async () => {
    const rig = await mountWorkspace(canvasDesign([createLine({ id: "ln", x: 100, y: 300, width: 300 })]));
    act(() => getActions().setHover("ln"));
    expect(rig.container.querySelector(".cf-outline--hover")).toBeNull();
  });
});

describe("the hover outline", () => {
  it("outlines the element under the pointer, scaled with the zoom", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    act(() => getActions().setHover("a"));
    const outline = rig.container.querySelector<HTMLElement>(".cf-outline--hover")!;
    expect([outline.style.left, outline.style.top, outline.style.width, outline.style.height]).toEqual(["100px", "100px", "200px", "100px"]);
    act(() => getActions().setZoom(2));
    expect(rig.container.querySelector<HTMLElement>(".cf-outline--hover")!.style.width).toBe("400px");
  });

  it("is hidden while a gesture is in progress", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    act(() => getActions().setHover("a"));
    act(() => useGesture.getState().set({ active: true }));
    expect(rig.container.querySelector(".cf-outline--hover")).toBeNull();
  });

  it("ignores a highlighted id that is no longer on the page", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    act(() => getActions().setHover("ghost"));
    expect(rig.container.querySelector(".cf-outline--hover")).toBeNull();
  });
});

describe("snap guides", () => {
  it("draw a pink line for each guide at the zoomed position", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a")]));
    act(() => getActions().setZoom(2));
    act(() =>
      getActions().setGuides([
        { axis: "v", pos: 100, from: 10, to: 60, kind: "edge" },
        { axis: "h", pos: 50, from: 20, to: 120, kind: "center" },
      ]),
    );
    const v = rig.container.querySelector<HTMLElement>(".cf-guide--v")!;
    expect([v.style.left, v.style.top, v.style.height]).toEqual(["200px", "20px", "100px"]);
    const h = rig.container.querySelector<HTMLElement>(".cf-guide--h")!;
    expect([h.style.top, h.style.left, h.style.width]).toEqual(["100px", "40px", "200px"]);
    act(() => getActions().setGuides([]));
    expect(rig.container.querySelector(".cf-guide")).toBeNull();
  });
});

describe("the marquee, the freehand preview and the size label", () => {
  it("draws the marquee rectangle at the zoomed position", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => useGesture.getState().set({ marquee: { x: 10, y: 20, w: 100, h: 50 } }));
    const marquee = rig.container.querySelector<HTMLElement>(".cf-marquee")!;
    expect([marquee.style.left, marquee.style.top, marquee.style.width, marquee.style.height]).toEqual(["10px", "20px", "100px", "50px"]);
  });

  it("draws the freehand stroke as a polyline once it has two points", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => useGesture.getState().set({ drawPath: [{ x: 5, y: 5 }] }));
    expect(rig.container.querySelector(".cf-drawpreview")).toBeNull();
    act(() =>
      useGesture.getState().set({
        drawPath: [
          { x: 5, y: 5 },
          { x: 15, y: 25 },
        ],
      }),
    );
    expect(rig.container.querySelector(".cf-drawpreview polyline")?.getAttribute("points")).toBe("5,5 15,25");
  });

  it("draws the connector being dragged out of an anchor as a straight line at the zoom of the view", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(rig.container.querySelector("[data-cf-connector-preview]")).toBeNull();
    act(() => getActions().setZoom(2));
    act(() => useGesture.getState().set({ connector: { start: { x: 10, y: 20 }, end: { x: 110, y: 70 } } }));
    const line = rig.container.querySelector("[data-cf-connector-preview] line")!;
    expect(["x1", "y1", "x2", "y2"].map((name) => line.getAttribute(name))).toEqual(["20", "40", "220", "140"]);
  });

  it("shows the label that follows the pointer", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(rig.container.querySelector(".cf-hud")).toBeNull();
    act(() => useGesture.getState().set({ hud: { x: 120, y: 80, text: "300 × 200" } }));
    const hud = rig.container.querySelector<HTMLElement>(".cf-hud")!;
    expect([hud.textContent, hud.style.left, hud.style.top]).toEqual(["300 × 200", "120px", "80px"]);
  });
});

describe("the link mark", () => {
  const mark = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>("[data-cf-linkmark]");

  it("marks the top left corner of a selected element that links somewhere, naming the address", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a", { link: "https://example.test/more" })]));
    expect(mark(rig)).toBeNull();
    selectIds("a");
    expect(mark(rig)?.getAttribute("aria-label")).toBe("https://example.test/more");
    expect(mark(rig)?.title).toBe("https://example.test/more");
    // the mark is 22 px wide and centred on the corner of the box
    const zoom = useEditor.getState().zoom;
    expect([mark(rig)?.style.left, mark(rig)?.style.top]).toEqual([`${100 * zoom - 11}px`, `${100 * zoom - 11}px`]);
  });

  it("shows no mark for a link of only spaces, nor while several elements are selected", async () => {
    const rig = await mountWorkspace(canvasDesign([box("a", { link: "   " }), box("b", { x: 400, link: "https://example.test" })]));
    selectIds("a");
    expect(mark(rig)).toBeNull();
    selectIds("a", "b");
    expect(mark(rig)).toBeNull();
  });
});
