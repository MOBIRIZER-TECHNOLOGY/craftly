/**
 * Pointer controller: changing what is already on the page. Moving (with snapping and the shift / ctrl modifiers),
 * the eight resize handles for every kind of element, rotating, and dragging the end points of a line. Each gesture
 * must change the document as the user expects and leave exactly one undo step.
 */
import { act, fireEvent, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createChart, createGroup, createImage, createLine, createShape, createTable, createText } from "@/core/factory";
import type { GroupElement, ImageElement, LineElement, TableElement, TextElement } from "@/core/types";
import { getActions, useEditor } from "@/core/store";
import { boxOf, canvasDesign, elementOf, mountWorkspace, selectIds } from "@/test/canvasUtils";
import { useGesture } from "./gestureStore";

const state = () => useEditor.getState();
const noSnap = () => act(() => getActions().toggle("snapEnabled"));

const shapes = () => [
  createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 }),
  createShape("ellipse", { id: "b", x: 400, y: 100, width: 200, height: 100 }),
  createShape("rect", { id: "locked", x: 100, y: 300, width: 200, height: 100, locked: true }),
];

describe("moving", () => {
  it("drags the element with the pointer and leaves one undo step", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    rig.drag([200, 150], [260, 190]);
    expect(boxOf("a")).toEqual([160, 140, 200, 100]);
    expect(state().past).toHaveLength(1);
    act(() => getActions().undo());
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
  });

  it("only starts after the pointer has travelled three pixels, then follows from the original press point", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    rig.down(200, 150);
    rig.move(202, 151);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(useGesture.getState().active).toBe(false);
    expect(rig.host.style.cursor).toBe("");
    rig.move(260, 150);
    expect(boxOf("a")).toEqual([160, 100, 200, 100]);
    expect(useGesture.getState().active).toBe(true);
    expect(rig.host.style.cursor).toBe("move");
    rig.up(260, 150);
    expect(useGesture.getState().active).toBe(false);
    expect(rig.host.style.cursor).toBe("");
  });

  it("moves every selected element by the same amount", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds("a", "b");
    rig.drag([200, 150], [230, 250]);
    expect(boxOf("a")).toEqual([130, 200, 200, 100]);
    expect(boxOf("b")).toEqual([430, 200, 200, 100]);
    expect(state().past).toHaveLength(1);
  });

  it("moves a whole group", async () => {
    const group = createGroup([createShape("rect", { x: 0, y: 0, width: 100, height: 100 })], { id: "g", x: 300, y: 300, width: 100, height: 100 });
    const rig = await mountWorkspace(canvasDesign([group]));
    noSnap();
    rig.drag([350, 350], [400, 380]);
    expect(boxOf("g")).toEqual([350, 330, 100, 100]);
  });

  it("moves a child inside a group and fits the group around its children", async () => {
    const group = createGroup([createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 100 }), createShape("rect", { id: "b", x: 120, y: 0, width: 100, height: 100 })], {
      id: "g",
      x: 100,
      y: 100,
      width: 220,
      height: 100,
    });
    const rig = await mountWorkspace(canvasDesign([group]));
    noSnap();
    rig.dblclick(150, 150);
    expect(state().focusGroupId).toBe("g");
    expect(state().selection).toEqual(["a"]);
    rig.drag([150, 150], [200, 180]);
    expect(boxOf("g")).toEqual([150, 100, 170, 130]);
    expect(boxOf("a")).toEqual([0, 30, 100, 100]);
    expect(boxOf("b")).toEqual([70, 0, 100, 100]);
    expect(state().past).toHaveLength(1);
  });

  it("resizes a child inside a group with its ordinary handles", async () => {
    const group = createGroup([createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 100 })], { id: "g", x: 100, y: 100, width: 100, height: 100 });
    const rig = await mountWorkspace(canvasDesign([group]));
    noSnap();
    rig.dblclick(150, 150);
    rig.down(200, 200, { target: rig.handle("resize:se") });
    rig.move(250, 260);
    rig.up(250, 260);
    expect(boxOf("a")).toEqual([0, 0, 150, 160]);
    expect(boxOf("g")).toEqual([100, 100, 150, 160]);
  });

  it("moves a child in the coordinate space of a rotated group", async () => {
    const group = createGroup([createShape("rect", { id: "a", x: 0, y: 0, width: 100, height: 100 })], { id: "g", x: 100, y: 100, width: 100, height: 100, rotation: 90 });
    const rig = await mountWorkspace(canvasDesign([group]));
    noSnap();
    rig.dblclick(150, 150);
    rig.drag([150, 150], [200, 150]);
    expect(boxOf("a")).toEqual([0, 0, 100, 100]);
    expect(boxOf("g")).toEqual([150, 100, 100, 100]);
  });

  it("drags from the Move handle even when the pointer starts away from the element", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds("a");
    rig.down(300, 260, { target: rig.handle("move") });
    rig.move(340, 280);
    rig.up(340, 280);
    expect(boxOf("a")).toEqual([140, 120, 200, 100]);
  });

  it("holds the movement to one axis while shift is down", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    rig.down(200, 150);
    rig.move(300, 170, { shift: true });
    rig.up(300, 170, { shift: true });
    expect(boxOf("a")).toEqual([200, 100, 200, 100]);
    rig.down(300, 150);
    rig.move(310, 250, { shift: true });
    rig.up(310, 250, { shift: true });
    expect(boxOf("a")).toEqual([200, 200, 200, 100]);
  });

  it("snaps the centre to the middle of the page and shows a guide until the pointer is released", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150);
    rig.move(300, 150);
    rig.move(425, 150); // centre at 425, three pixels from the page centre (428)
    expect(boxOf("a")[0]).toBe(328);
    expect(state().snapGuides).toContainEqual(expect.objectContaining({ axis: "v", pos: 428, kind: "page" }));
    expect(rig.container.querySelector(".cf-guide--v")).toBeTruthy();
    rig.up(425, 150);
    expect(state().snapGuides).toEqual([]);
    expect(rig.container.querySelector(".cf-guide--v")).toBeNull();
  });

  it("snaps to the edges of other elements", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150);
    rig.move(300, 250);
    rig.move(603, 250); // a's left edge lands at 503: three pixels from b's centre line (500)
    expect(boxOf("a")[0]).toBe(500);
    rig.up(603, 250);
  });

  it("snaps to guides dragged out of the rulers", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes(), { guides: { vertical: [700], horizontal: [250] } }));
    rig.down(200, 150);
    rig.move(300, 150);
    rig.move(800, 150); // a's left edge lands at 702
    expect(boxOf("a")[0]).toBe(700);
    rig.up(800, 150);
  });

  it("snaps to the custom page margin while margins are shown", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 })], { margin: 150 }));
    act(() => getActions().toggle("showMargins"));
    rig.down(200, 150);
    rig.move(300, 150);
    rig.move(249, 150); // a's left edge lands at 149, one pixel from the margin
    expect(boxOf("a")[0]).toBe(150);
    expect(state().snapGuides).toContainEqual(expect.objectContaining({ axis: "v", pos: 150, kind: "page" }));
    rig.up(249, 150);
  });

  it("does not snap while ctrl is held", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150, { ctrl: true });
    rig.move(300, 150, { ctrl: true });
    rig.move(425, 150, { ctrl: true });
    expect(boxOf("a")[0]).toBe(325);
    expect(state().snapGuides).toEqual([]);
    rig.up(425, 150, { ctrl: true });
  });

  it("does not snap when snapping is turned off", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    rig.drag([200, 150], [425, 150]);
    expect(boxOf("a")[0]).toBe(325);
  });

  it("snaps along the direction of travel only while shift locks the other axis", async () => {
    const lone = () => createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 });
    // sideways: the top edge would snap to the guide at 104, but the vertical axis is locked
    let rig = await mountWorkspace(canvasDesign([lone()], { guides: { vertical: [], horizontal: [104] } }));
    rig.down(200, 150);
    rig.move(300, 152, { shift: true });
    rig.move(425, 152, { shift: true });
    expect(boxOf("a")).toEqual([328, 100, 200, 100]);
    rig.up(425, 152, { shift: true });
    // downwards: the left edge would snap to the guide at 103, but the horizontal axis is locked
    rig.unmount();
    rig = await mountWorkspace(canvasDesign([lone()], { guides: { vertical: [103], horizontal: [] } }));
    rig.down(200, 150);
    rig.move(202, 250, { shift: true });
    rig.move(202, 330, { shift: true });
    expect(boxOf("a")).toEqual([100, 280, 200, 100]);
    rig.up(202, 330, { shift: true });
  });

  it("does snap to the same guide without shift", async () => {
    const lone = createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 });
    const rig = await mountWorkspace(canvasDesign([lone], { guides: { vertical: [], horizontal: [104] } }));
    rig.down(200, 150);
    rig.move(260, 152);
    expect(boxOf("a")).toEqual([160, 104, 200, 100]);
    rig.up(260, 152);
  });

  it("keeps the step already made when the gesture is cancelled", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    rig.down(200, 150);
    rig.move(260, 150);
    rig.cancel(260, 150);
    expect(boxOf("a")).toEqual([160, 100, 200, 100]);
    expect(state().past).toHaveLength(1);
    expect(useGesture.getState().active).toBe(false);
    expect(rig.host.style.cursor).toBe("");
    rig.move(400, 150);
    expect(boxOf("a")).toEqual([160, 100, 200, 100]);
  });

  it("records nothing when a cancelled press never moved", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.down(200, 150);
    rig.cancel(200, 150);
    expect(state().past).toHaveLength(0);
    expect(state().selection).toEqual(["a"]);
  });

  it("ignores a cancel when nothing is going on", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.cancel(200, 150);
    expect(state().past).toHaveLength(0);
  });

  it("releases pointer capture even when the browser already released it", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    rig.host.hasPointerCapture = () => true;
    let released = 0;
    rig.host.releasePointerCapture = () => {
      released++;
      throw new Error("already released");
    };
    rig.drag([200, 150], [260, 150]);
    expect(released).toBe(1);
    expect(useGesture.getState().active).toBe(false);
  });
});

describe("resizing a shape", () => {
  const start = async (id = "a") => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds(id);
    return rig;
  };

  it("drags the south-east corner and keeps the north-west corner in place", async () => {
    const rig = await start();
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(350, 220);
    expect(boxOf("a")).toEqual([100, 100, 250, 120]);
    expect(screen.getByText("250 × 120")).toBeTruthy();
    rig.up(350, 220);
    expect(useGesture.getState().hud).toBeNull();
    expect(state().past).toHaveLength(1);
    act(() => getActions().undo());
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
  });

  it("drags the north-west corner and keeps the south-east corner in place", async () => {
    const rig = await start();
    rig.down(100, 100, { target: rig.handle("resize:nw") });
    rig.move(50, 70);
    rig.up(50, 70);
    expect(boxOf("a")).toEqual([50, 70, 250, 130]);
  });

  it.each([
    ["e", [400, 999], [100, 100, 300, 100]],
    ["w", [60, -50], [60, 100, 240, 100]],
    ["n", [999, 60], [100, 60, 200, 140]],
    ["s", [-10, 260], [100, 100, 200, 160]],
  ] as const)("the %s side handle changes only one dimension", async (side, to, expected) => {
    const rig = await start();
    rig.down(200, 150, { target: rig.handle(`resize:${side}`) });
    rig.move(to[0], to[1]);
    rig.up(to[0], to[1]);
    expect(boxOf("a")).toEqual(expected);
  });

  it("keeps the proportions of a shape when shift is held on a corner", async () => {
    const rig = await start();
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(400, 150, { shift: true });
    expect(boxOf("a")).toEqual([100, 100, 300, 150]);
    rig.up(400, 150, { shift: true });
  });

  it("resizes symmetrically around the centre while alt is held", async () => {
    const rig = await start();
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(400, 150, { alt: true });
    expect(boxOf("a")).toEqual([0, 100, 400, 100]);
    rig.up(400, 150, { alt: true });
  });

  it("never shrinks below the minimum size", async () => {
    const rig = await start();
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(0, 150);
    expect(boxOf("a")).toEqual([100, 100, 6, 100]);
    rig.up(0, 150);
  });

  it("scales the corner radius with the shape", async () => {
    const round = createShape("rect", { id: "round", x: 100, y: 100, width: 200, height: 100, radius: 20 });
    const rig = await mountWorkspace(canvasDesign([round]));
    noSnap();
    selectIds("round");
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(500, 250);
    rig.up(500, 250);
    expect(boxOf("round")).toEqual([100, 100, 400, 150]);
    expect(elementOf<ReturnType<typeof createShape>>("round").radius).toBe(30);
  });

  it("snaps the dragged edge to the page edge and shows a guide", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(852, 150);
    expect(boxOf("a")).toEqual([100, 100, 756, 100]);
    expect(state().snapGuides).toContainEqual(expect.objectContaining({ axis: "v", pos: 856 }));
    rig.up(852, 150);
    expect(state().snapGuides).toEqual([]);
  });

  it("does not snap when ctrl is held", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(852, 150, { ctrl: true });
    expect(boxOf("a")).toEqual([100, 100, 752, 100]);
    expect(state().snapGuides).toEqual([]);
    rig.up(852, 150, { ctrl: true });
  });

  it("resizes a rotated shape along its own axes without snapping", async () => {
    const turned = createShape("rect", { id: "turned", x: 100, y: 100, width: 200, height: 100, rotation: 90 });
    const rig = await mountWorkspace(canvasDesign([turned]));
    selectIds("turned");
    rig.down(200, 200, { target: rig.handle("resize:e") });
    rig.move(200, 300);
    const el = elementOf("turned");
    expect(el.width).toBeCloseTo(250);
    expect(el.height).toBe(100);
    expect(el.rotation).toBe(90);
    // the west edge (the top of the turned box) stays where it was
    expect(el.x + el.width / 2).toBeCloseTo(200);
    expect(el.y + el.height / 2).toBeCloseTo(175);
    expect(state().snapGuides).toEqual([]);
    rig.up(200, 300);
  });

  it("ignores a handle press while any of the selected elements is locked", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a", "locked");
    rig.down(300, 400, { target: rig.handle("resize:se") });
    rig.move(500, 500);
    rig.up(500, 500);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(boxOf("locked")).toEqual([100, 300, 200, 100]);
    expect(state().past).toHaveLength(0);
  });

  it("keeps the step already made when the gesture is cancelled", async () => {
    const rig = await start();
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(350, 250);
    rig.cancel(350, 250);
    expect(boxOf("a")).toEqual([100, 100, 250, 150]);
    expect(state().past).toHaveLength(1);
    expect(useGesture.getState().active).toBe(false);
  });

  it("does nothing when a handle is pressed without a selection", async () => {
    const rig = await start();
    const stray = document.createElement("div");
    stray.setAttribute("data-cf-handle", "resize:se");
    rig.host.appendChild(stray);
    act(() => getActions().clearSelection());
    rig.down(300, 200, { target: stray });
    rig.move(350, 250);
    rig.up(350, 250);
    expect(state().past).toHaveLength(0);
  });
});

describe("resizing other kinds of element", () => {
  it("scales a text box from a corner: the font size follows the width", async () => {
    const text = createText({ id: "t", text: "Hello", x: 100, y: 400, width: 300, fontSize: 40 });
    const rig = await mountWorkspace(canvasDesign([text]));
    noSnap();
    selectIds("t");
    rig.down(400, 450, { target: rig.handle("resize:se") });
    rig.move(500, 480);
    const t = elementOf<TextElement>("t");
    expect(t.width).toBeCloseTo(480);
    expect(t.fontSize).toBeCloseTo(64);
    expect(t.x).toBe(100);
    expect(t.y).toBe(400);
    rig.up(500, 480);
    expect(state().past).toHaveLength(1);
  });

  it("scales the sizes of styled runs along with the text box", async () => {
    const text = createText({
      id: "t",
      x: 100,
      y: 400,
      width: 300,
      fontSize: 40,
      paragraphs: [{ runs: [{ text: "Big ", size: 80 }, { text: "plain" }] }],
    });
    const rig = await mountWorkspace(canvasDesign([text]));
    noSnap();
    selectIds("t");
    rig.down(400, 450, { target: rig.handle("resize:se") });
    rig.move(700, 500);
    rig.up(700, 500);
    const t = elementOf<TextElement>("t");
    expect(t.fontSize).toBeCloseTo(80);
    expect(t.paragraphs[0].runs[0].size).toBeCloseTo(160);
    expect(t.paragraphs[0].runs[1].size).toBeUndefined();
  });

  it("changes only the width of a text box from a side handle", async () => {
    const text = createText({ id: "t", text: "Hello", x: 100, y: 400, width: 300, fontSize: 40, autoWidth: true });
    const rig = await mountWorkspace(canvasDesign([text]));
    noSnap();
    selectIds("t");
    rig.down(400, 420, { target: rig.handle("resize:e") });
    rig.move(600, 500);
    rig.up(600, 500);
    const t = elementOf<TextElement>("t");
    expect(t.width).toBe(500);
    expect(t.fontSize).toBe(40);
    expect(t.autoWidth).toBe(false);
  });

  it("does not shrink a text box below 24 pixels", async () => {
    const text = createText({ id: "t", text: "Hello", x: 100, y: 400, width: 300, fontSize: 40 });
    const rig = await mountWorkspace(canvasDesign([text]));
    noSnap();
    selectIds("t");
    rig.down(400, 420, { target: rig.handle("resize:e") });
    rig.move(0, 420);
    rig.up(0, 420);
    expect(elementOf<TextElement>("t").width).toBe(24);
  });

  it("keeps an image in proportion when a corner is dragged and scales its radius", async () => {
    const photo = createImage({ id: "img", src: "https://example.test/p.jpg", x: 500, y: 300, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300, radius: 10 });
    const rig = await mountWorkspace(canvasDesign([photo]));
    noSnap();
    selectIds("img");
    rig.down(700, 450, { target: rig.handle("resize:se") });
    rig.move(800, 500);
    rig.up(800, 500);
    const img = elementOf<ImageElement>("img");
    expect([img.x, img.y, img.width, img.height]).toEqual([500, 300, 300, 225]);
    expect(img.radius).toBe(15);
    expect(img.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("crops an image from the east handle: the picture keeps its size and position", async () => {
    const photo = createImage({ id: "img", src: "https://example.test/p.jpg", x: 500, y: 300, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300 });
    const rig = await mountWorkspace(canvasDesign([photo]));
    noSnap();
    selectIds("img");
    rig.down(700, 375, { target: rig.handle("resize:e") });
    rig.move(600, 375);
    rig.up(600, 375);
    const img = elementOf<ImageElement>("img");
    expect([img.x, img.y, img.width, img.height]).toEqual([500, 300, 100, 150]);
    expect(img.crop).toEqual({ x: 0, y: 0, w: 2, h: 1 });
  });

  it("crops an image from the west and north handles: the picture stays put under the moving edge", async () => {
    const photo = createImage({ id: "img", src: "https://example.test/p.jpg", x: 500, y: 300, width: 200, height: 150, naturalWidth: 400, naturalHeight: 300 });
    const rig = await mountWorkspace(canvasDesign([photo]));
    noSnap();
    selectIds("img");
    rig.down(500, 375, { target: rig.handle("resize:w") });
    rig.move(600, 375);
    rig.up(600, 375);
    let img = elementOf<ImageElement>("img");
    expect([img.x, img.width]).toEqual([600, 100]);
    expect(img.crop.x).toBe(-1);
    expect(img.crop.w).toBe(2);
    rig.down(650, 300, { target: rig.handle("resize:n") });
    rig.move(650, 375);
    rig.up(650, 375);
    img = elementOf<ImageElement>("img");
    expect([img.y, img.height]).toEqual([375, 75]);
    expect(img.crop.y).toBe(-1);
    expect(img.crop.h).toBe(2);
  });

  it("scales the children of a group along with it", async () => {
    const group = createGroup([createShape("rect", { id: "kid", x: 0, y: 0, width: 100, height: 50 })], { id: "g", x: 100, y: 100, width: 200, height: 100 });
    const rig = await mountWorkspace(canvasDesign([group]));
    noSnap();
    selectIds("g");
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(500, 300);
    rig.up(500, 300);
    const g = elementOf<GroupElement>("g");
    expect([g.width, g.height]).toEqual([400, 200]);
    expect([g.children[0].width, g.children[0].height]).toEqual([200, 100]);
  });

  it("stretches a group freely from a side handle, and from a corner with shift", async () => {
    const group = createGroup([createShape("rect", { id: "kid", x: 0, y: 0, width: 100, height: 50 })], { id: "g", x: 100, y: 100, width: 200, height: 100 });
    const rig = await mountWorkspace(canvasDesign([group]));
    noSnap();
    selectIds("g");
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(500, 150);
    rig.up(500, 150);
    let g = elementOf<GroupElement>("g");
    expect([g.width, g.height]).toEqual([400, 100]);
    expect([g.children[0].width, g.children[0].height]).toEqual([200, 50]);
    rig.down(500, 200, { target: rig.handle("resize:se") });
    rig.move(500, 400, { shift: true });
    rig.up(500, 400, { shift: true });
    g = elementOf<GroupElement>("g");
    expect([g.width, g.height]).toEqual([400, 300]);
    expect(g.children[0].height).toBe(150);
  });

  it("scales table columns and rows with the table", async () => {
    const table = createTable({ id: "tbl", x: 100, y: 100, width: 600, height: 240 });
    const rig = await mountWorkspace(canvasDesign([table]));
    noSnap();
    selectIds("tbl");
    rig.down(700, 340, { target: rig.handle("resize:se") });
    rig.move(400, 300);
    rig.up(400, 300);
    const t = elementOf<TableElement>("tbl");
    expect([t.width, t.height]).toEqual([300, 200]);
    expect(t.colWidths).toEqual([100, 100, 100]);
    t.rowHeights.forEach((h) => expect(h).toBeCloseTo(66.667, 2));
  });

  it("resizes a chart freely, and in proportion with shift", async () => {
    const chart = createChart({ id: "chart", x: 100, y: 100, width: 600, height: 400 });
    const rig = await mountWorkspace(canvasDesign([chart]));
    noSnap();
    selectIds("chart");
    rig.down(700, 500, { target: rig.handle("resize:se") });
    rig.move(400, 400);
    rig.up(400, 400);
    expect(boxOf("chart")).toEqual([100, 100, 300, 300]);
    rig.down(400, 400, { target: rig.handle("resize:se") });
    rig.move(700, 500, { shift: true });
    rig.up(700, 500, { shift: true });
    expect(boxOf("chart")).toEqual([100, 100, 600, 600]);
  });

  it("resizes several elements together and scales their positions about the common corner", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes().slice(0, 2)));
    noSnap();
    selectIds("a", "b");
    rig.down(600, 200, { target: rig.handle("resize:se") });
    rig.move(700, 200);
    const a = boxOf("a");
    const b = boxOf("b");
    expect(a[0]).toBeCloseTo(100);
    expect(a[2]).toBeCloseTo(240);
    expect(a[3]).toBeCloseTo(120);
    expect(b[0]).toBeCloseTo(460);
    expect(b[1]).toBeCloseTo(100);
    expect(b[2]).toBeCloseTo(240);
    rig.up(700, 200);
    expect(state().past).toHaveLength(1);
    act(() => getActions().undo());
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(boxOf("b")).toEqual([400, 100, 200, 100]);
  });

  it("lets several elements stretch freely with shift or from a side handle", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes().slice(0, 2)));
    noSnap();
    selectIds("a", "b");
    rig.down(600, 200, { target: rig.handle("resize:se") });
    rig.move(700, 300, { shift: true });
    rig.up(700, 300, { shift: true });
    expect(boxOf("a")).toEqual([100, 100, 240, 200]);
    expect(boxOf("b")[2]).toBeCloseTo(240);
    rig.down(700, 150, { target: rig.handle("resize:e") });
    rig.move(900, 150);
    rig.up(900, 150);
    expect(boxOf("a")[2]).toBeCloseTo(240 * (800 / 600));
    expect(boxOf("a")[3]).toBe(200);
  });
});

describe("rotating", () => {
  const rotated = (id = "a") => elementOf(id).rotation;
  const start = async (ids = ["a"]) => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds(...ids);
    return rig;
  };

  it("turns the element to follow the pointer around its centre", async () => {
    const rig = await start();
    rig.down(200, 230, { target: rig.handle("rotate") });
    rig.move(100, 150);
    expect(rotated()).toBeCloseTo(90);
    expect(screen.getByText("90°")).toBeTruthy();
    rig.move(300, 150);
    expect(rotated()).toBeCloseTo(270);
    rig.up(300, 150);
    expect(useGesture.getState().hud).toBeNull();
    expect(state().past).toHaveLength(1);
    act(() => getActions().undo());
    expect(rotated()).toBe(0);
  });

  it("clicks to the nearest 45 degrees when the pointer is within three degrees", async () => {
    const rig = await start();
    rig.down(200, 230, { target: rig.handle("rotate") });
    rig.move(102, 153); // about 88 degrees
    expect(rotated()).toBe(90);
    rig.up(102, 153);
  });

  it("follows the pointer freely between the snap angles", async () => {
    const rig = await start();
    rig.down(200, 230, { target: rig.handle("rotate") });
    const rad = (20 * Math.PI) / 180;
    rig.move(200 - 100 * Math.sin(rad), 150 + 100 * Math.cos(rad));
    expect(rotated()).toBeCloseTo(20, 5);
    rig.up(200, 230);
  });

  it("steps in 15 degree increments while shift is held", async () => {
    const rig = await start();
    rig.down(200, 230, { target: rig.handle("rotate") });
    const rad = (22 * Math.PI) / 180;
    rig.move(200 - 100 * Math.sin(rad), 150 + 100 * Math.cos(rad), { shift: true });
    expect(rotated()).toBe(15);
    rig.up(200, 230, { shift: true });
  });

  it("adds to the rotation the element already has", async () => {
    const tilted = createShape("rect", { id: "tilted", x: 100, y: 100, width: 200, height: 100, rotation: 30 });
    const rig = await mountWorkspace(canvasDesign([tilted]));
    selectIds("tilted");
    rig.down(200, 230, { target: rig.handle("rotate") });
    rig.move(100, 150);
    expect(rotated("tilted")).toBeCloseTo(120);
    rig.up(100, 150);
  });

  it("keeps the angle between 0 and 360", async () => {
    const rig = await start();
    rig.down(200, 230, { target: rig.handle("rotate") });
    rig.move(200 + 100, 150);
    expect(rotated()).toBeCloseTo(270);
    rig.up(300, 150);
  });

  it("turns several elements around their common centre", async () => {
    const rig = await start(["a", "b"]);
    rig.down(350, 230, { target: rig.handle("rotate") });
    rig.move(250, 150);
    const a = elementOf("a");
    const b = elementOf("b");
    expect(a.rotation).toBeCloseTo(90);
    expect(b.rotation).toBeCloseTo(90);
    expect(a.x).toBeCloseTo(250);
    expect(a.y).toBeCloseTo(-50);
    expect(b.x).toBeCloseTo(250);
    expect(b.y).toBeCloseTo(250);
    expect(screen.getByText("90°")).toBeTruthy();
    rig.up(250, 150);
    expect(state().past).toHaveLength(1);
  });

  it("steps several elements in 15 degree increments while shift is held", async () => {
    const rig = await start(["a", "b"]);
    rig.down(350, 230, { target: rig.handle("rotate") });
    const rad = (22 * Math.PI) / 180;
    rig.move(350 - 100 * Math.sin(rad), 150 + 100 * Math.cos(rad), { shift: true });
    expect(elementOf("a").rotation).toBeCloseTo(15);
    expect(elementOf("b").rotation).toBeCloseTo(15);
    rig.up(350, 230);
  });

  it("keeps the step already made when the gesture is cancelled", async () => {
    const rig = await start();
    rig.down(200, 230, { target: rig.handle("rotate") });
    rig.move(100, 150);
    rig.cancel(100, 150);
    expect(rotated()).toBeCloseTo(90);
    expect(state().past).toHaveLength(1);
  });

  it("is not offered for locked elements", async () => {
    const rig = await start(["locked"]);
    expect(rig.host.querySelector('[data-cf-handle="rotate"]')).toBeNull();
    expect(rig.host.querySelector(".cf-sel--locked")).toBeTruthy();
  });
});

describe("dragging the ends of a line", () => {
  const line = () => createLine({ id: "ln", x: 100, y: 400, width: 300 });
  const start = async () => {
    const rig = await mountWorkspace(canvasDesign([...shapes(), line()]));
    noSnap();
    selectIds("ln");
    return rig;
  };

  it("moves the end point and keeps the start point fixed", async () => {
    const rig = await start();
    rig.down(400, 400, { target: rig.handle("line:1") });
    rig.move(400, 500);
    const ln = elementOf<LineElement>("ln");
    const len = Math.hypot(300, 100);
    expect(ln.width).toBeCloseTo(len);
    expect(ln.rotation).toBeCloseTo((Math.atan2(100, 300) * 180) / Math.PI);
    expect(ln.x + ln.width / 2).toBeCloseTo(250);
    expect(ln.y).toBeCloseTo(450);
    expect(screen.getByText(String(Math.round(len)))).toBeTruthy();
    rig.up(400, 500);
    expect(state().past).toHaveLength(1);
  });

  it("moves the start point and keeps the end point fixed", async () => {
    const rig = await start();
    rig.down(100, 400, { target: rig.handle("line:0") });
    rig.move(100, 300);
    const ln = elementOf<LineElement>("ln");
    expect(ln.width).toBeCloseTo(Math.hypot(300, 100));
    // the end point (400, 400) did not move: from the centre, half the line away
    const c = { x: ln.x + ln.width / 2, y: ln.y };
    const rad = (ln.rotation * Math.PI) / 180;
    expect(c.x + (ln.width / 2) * Math.cos(rad)).toBeCloseTo(400);
    expect(c.y + (ln.width / 2) * Math.sin(rad)).toBeCloseTo(400);
    rig.up(100, 300);
  });

  it("snaps the angle to 15 degrees while shift is held", async () => {
    const rig = await start();
    rig.down(400, 400, { target: rig.handle("line:1") });
    rig.move(400, 450, { shift: true });
    const ln = elementOf<LineElement>("ln");
    expect(ln.rotation).toBeCloseTo(15);
    expect(ln.width).toBeCloseTo(Math.hypot(300, 50));
    rig.up(400, 450, { shift: true });
  });

  it("never collapses to less than two pixels", async () => {
    const rig = await start();
    rig.down(400, 400, { target: rig.handle("line:1") });
    rig.move(100, 400);
    expect(elementOf<LineElement>("ln").width).toBe(2);
    rig.up(100, 400);
  });

  it("follows a line that is already turned", async () => {
    const turned = createLine({ id: "turned", x: 100, y: 400, width: 300, rotation: 90 });
    const rig = await mountWorkspace(canvasDesign([turned]));
    noSnap();
    selectIds("turned");
    // a 90 degree line through its centre (250, 400) runs from (250, 250) down to (250, 550)
    rig.down(250, 550, { target: rig.handle("line:1") });
    rig.move(450, 250);
    const ln = elementOf<LineElement>("turned");
    expect(ln.width).toBeCloseTo(Math.hypot(200, 0));
    expect(ln.rotation).toBeCloseTo(0, 5);
    rig.up(450, 250);
  });

  it("keeps the step already made when the gesture is cancelled", async () => {
    const rig = await start();
    rig.down(400, 400, { target: rig.handle("line:1") });
    rig.move(400, 500);
    rig.cancel(400, 500);
    expect(state().past).toHaveLength(1);
    expect(useGesture.getState().active).toBe(false);
  });

  it("is not offered for locked lines, and a stray line handle does nothing to other elements", async () => {
    const locked = createLine({ id: "lockedline", x: 100, y: 500, width: 300, locked: true });
    const rig = await mountWorkspace(canvasDesign([...shapes(), locked]));
    selectIds("lockedline");
    expect(rig.host.querySelector('[data-cf-handle="line:1"]')).toBeNull();
    selectIds("a");
    const stray = document.createElement("div");
    stray.setAttribute("data-cf-handle", "line:1");
    rig.host.appendChild(stray);
    rig.down(300, 150, { target: stray });
    rig.move(400, 250);
    rig.up(400, 250);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
    expect(state().past).toHaveLength(0);
  });
});

describe("gestures with several moves, and handles that are only pressed", () => {
  it("resizes continuously while the pointer keeps moving", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds("a");
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(320, 210);
    rig.move(340, 230);
    rig.move(360, 260);
    expect(boxOf("a")).toEqual([100, 100, 260, 160]);
    rig.up(360, 260);
    expect(state().past).toHaveLength(1);
  });

  it("drags a line end through several moves as one step", async () => {
    const rig = await mountWorkspace(canvasDesign([createLine({ id: "ln", x: 100, y: 400, width: 300 })]));
    noSnap();
    selectIds("ln");
    rig.down(400, 400, { target: rig.handle("line:1") });
    rig.move(420, 420);
    rig.move(440, 400);
    rig.up(440, 400);
    expect(elementOf<LineElement>("ln").width).toBeCloseTo(340);
    expect(state().past).toHaveLength(1);
  });

  it.each([
    ["resize", "resize:se"],
    ["rotate", "rotate"],
  ])("records nothing when the %s handle is pressed and released without moving", async (_name, handle) => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(300, 200, { target: rig.handle(handle) });
    expect(useGesture.getState().active).toBe(true);
    rig.up(300, 200);
    expect(state().past).toHaveLength(0);
    expect(useGesture.getState().active).toBe(false);
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
  });

  it("records nothing when a line end is pressed and released without moving", async () => {
    const rig = await mountWorkspace(canvasDesign([createLine({ id: "ln", x: 100, y: 400, width: 300 })]));
    selectIds("ln");
    rig.down(400, 400, { target: rig.handle("line:1") });
    rig.up(400, 400);
    expect(state().past).toHaveLength(0);
  });
});

describe("a second pointer, and a drag that loses its pointer", () => {
  const resizing = async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    selectIds("a");
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(350, 220);
    return rig;
  };

  it("ignores a second finger that touches the canvas while a handle is dragged, so the resize ends as one undo step", async () => {
    const rig = await resizing();
    rig.down(500, 450, { pointerId: 2 });
    expect(state().selection).toEqual(["a"]);
    expect(useGesture.getState().marquee).toBeNull();
    rig.move(360, 230);
    expect(boxOf("a")).toEqual([100, 100, 260, 130]);
    rig.up(360, 230);
    rig.up(500, 450, { pointerId: 2 });
    expect(state().past).toHaveLength(1);
    expect(useGesture.getState().active).toBe(false);
    act(() => getActions().undo());
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
  });

  it("ignores a second finger on another element while the first one is being moved", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    noSnap();
    rig.down(200, 150);
    rig.move(260, 150);
    rig.down(500, 150, { pointerId: 2 });
    expect(state().selection).toEqual(["a"]);
    rig.move(280, 150);
    rig.up(280, 150);
    expect(boxOf("a")).toEqual([180, 100, 200, 100]);
    expect(boxOf("b")).toEqual([400, 100, 200, 100]);
    expect(state().past).toHaveLength(1);
  });

  it("closes the step of a drag whose release never arrived when the same pointer presses again", async () => {
    const rig = await resizing();
    rig.down(500, 150);
    expect(state().past).toHaveLength(1);
    expect(useGesture.getState().hud).toBeNull();
    expect(state().selection).toEqual(["b"]);
    rig.move(540, 150);
    rig.up(540, 150);
    expect(boxOf("a")).toEqual([100, 100, 250, 120]);
    expect(boxOf("b")).toEqual([440, 100, 200, 100]);
    expect(state().past).toHaveLength(2);
  });

  it("ends a drag that loses its pointer capture the way a cancelled one ends", async () => {
    const rig = await mountWorkspace(canvasDesign(shapes()));
    selectIds("a");
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(852, 150);
    expect(state().snapGuides).not.toEqual([]);
    expect(useGesture.getState().hud).not.toBeNull();
    fireEvent.lostPointerCapture(rig.host, { pointerId: 1 });
    expect(boxOf("a")).toEqual([100, 100, 756, 100]);
    expect(state().past).toHaveLength(1);
    expect(state().snapGuides).toEqual([]);
    expect(useGesture.getState().hud).toBeNull();
    expect(useGesture.getState().active).toBe(false);
    rig.move(600, 150);
    expect(boxOf("a")).toEqual([100, 100, 756, 100]);
    act(() => getActions().undo());
    expect(boxOf("a")).toEqual([100, 100, 200, 100]);
  });

  it("goes on with the drag when another pointer loses its capture, and ignores a lost capture when nothing is going on", async () => {
    const rig = await resizing();
    fireEvent.lostPointerCapture(rig.host, { pointerId: 2 });
    expect(useGesture.getState().active).toBe(true);
    rig.move(360, 230);
    expect(boxOf("a")).toEqual([100, 100, 260, 130]);
    rig.up(360, 230);
    fireEvent.lostPointerCapture(rig.host, { pointerId: 1 });
    expect(state().past).toHaveLength(1);
  });
});

describe("snapping while resizing", () => {
  const alone = () => canvasDesign([createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 })]);

  it("snaps the bottom edge when the south handle is dragged", async () => {
    const rig = await mountWorkspace(alone());
    selectIds("a");
    rig.down(200, 200, { target: rig.handle("resize:s") });
    rig.move(200, 600);
    expect(boxOf("a")).toEqual([100, 100, 200, 504]);
    expect(state().snapGuides).toContainEqual(expect.objectContaining({ axis: "h", pos: 604 }));
    rig.up(200, 600);
  });

  it("snaps the left edge when the west handle is dragged", async () => {
    const rig = await mountWorkspace(alone());
    selectIds("a");
    rig.down(100, 150, { target: rig.handle("resize:w") });
    rig.move(4, 150);
    expect(boxOf("a")).toEqual([0, 100, 300, 100]);
    rig.up(4, 150);
  });

  it("snaps a corner on both axes at once", async () => {
    const rig = await mountWorkspace(alone());
    selectIds("a");
    rig.down(300, 200, { target: rig.handle("resize:se") });
    rig.move(852, 600);
    expect(boxOf("a")).toEqual([100, 100, 756, 504]);
    rig.up(852, 600);
  });

  it("leaves the edge where the pointer put it when no guide is near", async () => {
    const rig = await mountWorkspace(alone());
    selectIds("a");
    rig.down(300, 150, { target: rig.handle("resize:e") });
    rig.move(600, 150);
    expect(boxOf("a")).toEqual([100, 100, 500, 100]);
    expect(state().snapGuides).toEqual([]);
    rig.up(600, 150);
  });
});
