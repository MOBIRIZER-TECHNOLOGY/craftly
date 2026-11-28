/**
 * Pointer controller: making new things and moving the view. The Tools palette (text box, shape, line, freehand
 * pen), the hand tool, Space-drag and middle-button panning, Ctrl + wheel zooming and dropping files or panel items
 * onto the canvas.
 */
import { act, configure, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { createImage, createShape } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import type { ImageElement, LineElement, ShapeElement, TextElement } from "@/core/types";
import { setDrawSettings } from "@/editor/panels/shared/drawSettings";
import { canvasDesign, currentPage, mountWorkspace } from "@/test/canvasUtils";
import { DRAG_MIME } from "../insert";
import { takeSelectAllOnEdit } from "./controller";
import { useGesture } from "./gestureStore";
import { screenToDesign, useView } from "./viewStore";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const useTool = (tool: Parameters<ReturnType<typeof getActions>["setTool"]>[0], shape?: string) => act(() => getActions().setTool(tool, shape));
const added = <T extends { type: string }>(type: T["type"]) => currentPage().elements.filter((e) => e.type === type) as unknown as T[];

afterEach(() => {
  setDrawSettings({ color: "#0e1318", width: null });
});

describe("the text tool", () => {
  it("places a text box where the canvas is clicked and starts editing with the text selected", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("text");
    expect(rig.host.className).toContain("cf-workspace--tool-text");
    expect(rig.down(200, 450)).toBe(false);
    expect(useGesture.getState().active).toBe(true);
    rig.up(200, 450);
    const [text] = added<TextElement>("text");
    expect(text.paragraphs[0].runs[0].text).toBe("Text");
    expect([text.x, text.y]).toEqual([200, 450]);
    expect(text.fontSize).toBe(30);
    expect(text.autoWidth).toBe(true);
    expect(state().tool).toBe("select");
    expect(state().editingTextId).toBe(text.id);
    expect(state().selection).toEqual([text.id]);
    expect(useGesture.getState().active).toBe(false);
    const editor = rig.container.querySelector("[data-cf-text-editor]") as HTMLElement;
    expect(editor.textContent).toBe("Text");
    expect(window.getSelection()?.toString()).toBe("Text");
    expect(takeSelectAllOnEdit()).toBe(false);
    expect(rig.host.className).not.toContain("cf-workspace--tool");
  });

  it("makes a text box as wide as the dragged rectangle, which then wraps its text", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("text");
    rig.down(100, 450);
    rig.move(250, 500);
    expect(useGesture.getState().marquee).toEqual({ x: 100, y: 450, w: 150, h: 50 });
    expect(rig.container.querySelector(".cf-hud")?.textContent).toBe("150 × 50");
    rig.up(250, 500);
    const [text] = added<TextElement>("text");
    expect([text.x, text.y, text.width]).toEqual([100, 450, 150]);
    expect(text.autoWidth).toBe(false);
    expect(useGesture.getState().marquee).toBeNull();
  });

  it("treats a drag narrower than 20 pixels as a click", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("text");
    rig.down(300, 450);
    rig.move(310, 480);
    rig.up(310, 480);
    const [text] = added<TextElement>("text");
    expect([text.x, text.y]).toEqual([300, 450]);
    expect(text.autoWidth).toBe(true);
  });

  it("drags a rectangle in any direction", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("text");
    rig.down(400, 500);
    rig.move(250, 450);
    rig.up(250, 450);
    const [text] = added<TextElement>("text");
    expect([text.x, text.y, text.width]).toEqual([250, 450, 150]);
  });
});

describe("the shape tool", () => {
  it("drops a default sized shape centred on the click", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(300, 300);
    rig.up(300, 300);
    const [shape] = added<ShapeElement>("shape");
    expect(shape.shape).toBe("rect");
    expect([shape.width, shape.height]).toEqual([133, 133]);
    expect([shape.x, shape.y]).toEqual([300 - 66.5, 300 - 66.5]);
    expect(state().tool).toBe("select");
    expect(state().selection).toEqual([shape.id]);
  });

  it("fills the dragged rectangle and shows its size while dragging", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(100, 100);
    rig.move(150, 130);
    expect(useGesture.getState().marquee).toEqual({ x: 100, y: 100, w: 50, h: 30 });
    expect(rig.container.querySelector(".cf-marquee")).toBeTruthy();
    rig.move(400, 250);
    expect(rig.container.querySelector(".cf-hud")?.textContent).toBe("300 × 150");
    rig.up(400, 250);
    const [shape] = added<ShapeElement>("shape");
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([100, 100, 300, 150]);
    expect(rig.container.querySelector(".cf-marquee")).toBeNull();
  });

  it("makes a square while shift is held, growing away from the start in every direction", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(400, 400);
    rig.move(300, 380, { shift: true });
    rig.move(250, 380, { shift: true });
    rig.up(250, 380, { shift: true });
    const [shape] = added<ShapeElement>("shape");
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([250, 250, 150, 150]);
  });

  it("makes a square to the lower right when shift is held and the drag goes that way", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(100, 100);
    rig.move(200, 130, { shift: true });
    rig.up(200, 130, { shift: true });
    const [shape] = added<ShapeElement>("shape");
    expect([shape.x, shape.y, shape.width, shape.height]).toEqual([100, 100, 100, 100]);
  });

  it("uses the shape chosen in the palette", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape", "ellipse");
    rig.down(100, 100);
    rig.move(200, 180);
    rig.up(200, 180);
    expect(added<ShapeElement>("shape")[0].shape).toBe("ellipse");
  });

  it("falls back to the default size on a side that was barely dragged", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(300, 450);
    rig.move(302, 520);
    rig.up(302, 520);
    const [shape] = added<ShapeElement>("shape");
    expect(shape.width).toBe(133);
    expect(shape.x).toBe(300 - 66.5);
    expect([shape.y, shape.height]).toEqual([450, 70]);
    useTool("shape");
    rig.down(100, 100);
    rig.move(240, 103);
    rig.up(240, 103);
    const second = added<ShapeElement>("shape")[1];
    expect([second.x, second.width]).toEqual([100, 140]);
    expect(second.height).toBe(133);
    expect(second.y).toBe(100 - 66.5);
  });

  it("creates nothing when the press is cancelled", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(100, 100);
    rig.move(200, 200);
    rig.cancel(200, 200);
    expect(currentPage().elements).toHaveLength(0);
    expect(useGesture.getState().active).toBe(false);
    expect(useGesture.getState().marquee).toBeNull();
  });
});

describe("the line tool", () => {
  it("draws a horizontal line of 300 pixels around a plain click", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("line");
    rig.down(400, 300);
    rig.up(400, 300);
    const [line] = added<LineElement>("line");
    expect([line.x, line.y, line.width, line.rotation]).toEqual([250, 300, 300, 0]);
    expect(state().tool).toBe("select");
  });

  it("draws from the press to the release point and previews it while dragging", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("line");
    rig.down(100, 400);
    rig.move(300, 500);
    expect(useGesture.getState().drawPath).toEqual([
      { x: 100, y: 400 },
      { x: 300, y: 500 },
    ]);
    expect(rig.container.querySelector(".cf-drawpreview polyline")).toBeTruthy();
    rig.up(300, 500);
    const [line] = added<LineElement>("line");
    const len = Math.hypot(200, 100);
    expect(line.width).toBeCloseTo(len);
    expect(line.rotation).toBeCloseTo((Math.atan2(100, 200) * 180) / Math.PI);
    expect(line.x + line.width / 2).toBeCloseTo(200);
    expect(line.y).toBeCloseTo(450);
    expect(useGesture.getState().drawPath).toBeNull();
    expect(rig.container.querySelector(".cf-drawpreview")).toBeNull();
  });

  it("snaps the angle to 15 degrees while shift is held", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("line");
    rig.down(100, 400);
    rig.move(300, 450, { shift: true });
    rig.up(300, 450, { shift: true });
    const [line] = added<LineElement>("line");
    expect(line.rotation).toBeCloseTo(15);
    expect(line.width).toBeCloseTo(Math.hypot(200, 50));
  });
});

describe("the freehand pen", () => {
  const scribble = (rig: Awaited<ReturnType<typeof mountWorkspace>>, points: Array<[number, number]>, opts = {}) => {
    rig.down(points[0][0], points[0][1], opts);
    for (const [x, y] of points.slice(1)) rig.move(x, y, opts);
    const last = points[points.length - 1];
    rig.up(last[0], last[1], opts);
  };

  it("turns a stroke into an unfilled path with the pen's colour and width", async () => {
    setDrawSettings({ color: "#ff0000", width: 9 });
    const rig = await mountWorkspace(canvasDesign());
    useTool("draw");
    scribble(rig, [
      [100, 100],
      [140, 160],
      [180, 120],
      [220, 200],
      [300, 150],
    ]);
    const [path] = added<ShapeElement>("shape");
    expect(path.shape).toBe("path");
    expect(path.fill).toBeNull();
    expect(path.stroke).toEqual({ color: "#ff0000", width: 9, style: "solid", cap: "round", join: "round" });
    expect([path.x, path.y, path.width, path.height]).toEqual([100, 100, 200, 100]);
    expect(path.path).toMatch(/^M0\.00 0\.00Q/);
    expect(path.path).toMatch(/L100\.00 50\.00$/);
    // the pen stays selected so the next stroke can follow at once
    expect(state().tool).toBe("draw");
    expect(state().selection).toEqual([path.id]);
  });

  it("uses an automatic width when the pen has none", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("draw");
    scribble(rig, [
      [100, 100],
      [140, 160],
      [180, 120],
    ]);
    expect(added<ShapeElement>("shape")[0].stroke?.width).toBe(4);
  });

  it("shows the stroke while it is drawn", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("draw");
    rig.down(100, 100);
    rig.move(150, 150);
    rig.move(200, 120);
    expect(useGesture.getState().drawPath).toHaveLength(3);
    expect(rig.container.querySelector(".cf-drawpreview polyline")?.getAttribute("points")).toBe("100,100 150,150 200,120");
    rig.up(200, 120);
    expect(useGesture.getState().drawPath).toBeNull();
  });

  it("keeps a nearly straight stroke as one straight segment", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("draw");
    scribble(rig, [
      [10, 300],
      [14.5, 300],
      [850, 300],
    ]);
    const [path] = added<ShapeElement>("shape");
    expect(path.path).toBe("M0.00 0.00L100.00 0.00");
    expect([path.width, path.height]).toEqual([840, 4]);
  });

  it("ignores a stroke that is too short to be a line and stays on the pen", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("draw");
    scribble(rig, [
      [100, 100],
      [160, 160],
    ]);
    expect(currentPage().elements).toHaveLength(0);
    expect(state().tool).toBe("draw");
    rig.down(300, 300);
    rig.up(300, 300);
    expect(currentPage().elements).toHaveLength(0);
    expect(state().tool).toBe("draw");
  });
});

describe("panning", () => {
  it("drags the view with the hand tool", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("hand");
    expect(rig.pointerAt("pointerDown", 400, 300)).toBe(false);
    expect(rig.host.style.cursor).toBe("grabbing");
    rig.pointerAt("pointerMove", 350, 280);
    expect([rig.scroller.scrollLeft, rig.scroller.scrollTop]).toEqual([50, 20]);
    rig.pointerAt("pointerMove", 500, 400);
    expect([rig.scroller.scrollLeft, rig.scroller.scrollTop]).toEqual([-100, -100]);
    rig.pointerAt("pointerUp", 500, 400);
    expect(rig.host.style.cursor).toBe("");
    expect(state().selection).toEqual([]);
  });

  it("drags the view with the middle mouse button whatever the tool", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 })]));
    rig.down(200, 150, { button: 1 });
    rig.move(180, 130, { button: 1 });
    rig.up(180, 130, { button: 1 });
    expect([rig.scroller.scrollLeft, rig.scroller.scrollTop]).toEqual([20, 20]);
    expect(state().selection).toEqual([]);
  });

  it("drags the view while Space is held, and only then", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 })]));
    expect(fireEvent.keyDown(document.body, { code: "Space", key: " " })).toBe(false);
    expect(rig.host.style.cursor).toBe("grab");
    expect(fireEvent.keyDown(document.body, { code: "Space", key: " ", repeat: true })).toBe(false);
    rig.down(200, 150);
    expect(state().selection).toEqual([]);
    rig.move(230, 170);
    expect([rig.scroller.scrollLeft, rig.scroller.scrollTop]).toEqual([-30, -20]);
    // letting go of Space during the drag keeps the grab cursor until the button is released
    fireEvent.keyUp(document.body, { code: "Space", key: " " });
    expect(rig.host.style.cursor).toBe("grabbing");
    rig.up(230, 170);
    expect(rig.host.style.cursor).toBe("");
    rig.down(200, 150);
    expect(state().selection).toEqual(["a"]);
  });

  it("puts the grab cursor away when Space is released without dragging", async () => {
    const rig = await mountWorkspace(canvasDesign());
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    fireEvent.keyUp(document.body, { code: "Space", key: " " });
    expect(rig.host.style.cursor).toBe("");
  });

  it("stops panning with Space when the window loses focus while the key is held", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 })]));
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    // the key is released in another window: this one never hears of it
    fireEvent.blur(window);
    expect(rig.host.style.cursor).toBe("");
    rig.down(200, 150);
    expect(state().selection).toEqual(["a"]);
    rig.move(230, 170);
    rig.up(230, 170);
    expect([rig.scroller.scrollLeft, rig.scroller.scrollTop]).toEqual([0, 0]);
  });

  it("stops panning with Space when the page is hidden while the key is held", async () => {
    const rig = await mountWorkspace(canvasDesign([createShape("rect", { id: "a", x: 100, y: 100, width: 200, height: 100 })]));
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    fireEvent(document, new Event("visibilitychange"));
    expect(rig.host.style.cursor).toBe("");
    rig.down(200, 150);
    expect(state().selection).toEqual(["a"]);
  });

  it("keeps the grabbing cursor of a drag that is under way when the window loses focus", async () => {
    const rig = await mountWorkspace(canvasDesign());
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    rig.down(200, 150);
    fireEvent.blur(window);
    expect(rig.host.style.cursor).toBe("grabbing");
    rig.up(200, 150);
    expect(rig.host.style.cursor).toBe("");
  });

  it("no longer listens for the window losing focus once the workspace is unmounted", async () => {
    const rig = await mountWorkspace(canvasDesign());
    fireEvent.keyDown(document.body, { code: "Space", key: " " });
    rig.unmount();
    fireEvent.blur(window);
    fireEvent(document, new Event("visibilitychange"));
    expect(rig.host.style.cursor).toBe("grab");
  });

  it("leaves Space alone in text fields and on buttons", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const input = document.body.appendChild(document.createElement("input"));
    const button = document.body.appendChild(document.createElement("button"));
    expect(fireEvent.keyDown(input, { code: "Space", key: " " })).toBe(true);
    expect(fireEvent.keyDown(button, { code: "Space", key: " " })).toBe(true);
    expect(rig.host.style.cursor).toBe("");
  });

  it("does not pan with other keys", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(fireEvent.keyDown(document.body, { code: "KeyA", key: "a" })).toBe(true);
    expect(rig.host.style.cursor).toBe("");
  });
});

describe("zooming with the wheel", () => {
  it("zooms in on Ctrl + wheel up and keeps the point under the pointer in place", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const at = { x: 600, y: 400 };
    const screen = rig.client(at.x, at.y);
    const metrics = () => ({ ...useView.getState(), scrollLeft: rig.scroller.scrollLeft, scrollTop: rig.scroller.scrollTop });
    const before = screenToDesign(metrics(), screen.clientX, screen.clientY);
    expect(rig.wheel(at.x, at.y, -100, { ctrl: true })).toBe(false);
    expect(state().zoom).toBeCloseTo(Math.exp(0.22), 6);
    expect(state().zoomMode).toBe("custom");
    const after = screenToDesign(metrics(), screen.clientX, screen.clientY);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("zooms out on Ctrl + wheel down, also with the Cmd key", async () => {
    const rig = await mountWorkspace(canvasDesign());
    rig.wheel(300, 300, 100, { meta: true });
    expect(state().zoom).toBeCloseTo(Math.exp(-0.22), 6);
  });

  it("measures line based wheels in larger steps", async () => {
    const rig = await mountWorkspace(canvasDesign());
    rig.wheel(300, 300, -3, { ctrl: true, deltaMode: 1 });
    expect(state().zoom).toBeCloseTo(Math.exp(0.15), 6);
  });

  it("stops at 5 % and 400 %", async () => {
    const rig = await mountWorkspace(canvasDesign());
    rig.wheel(300, 300, -5000, { ctrl: true });
    expect(state().zoom).toBe(4);
    rig.wheel(300, 300, 5000, { ctrl: true });
    expect(state().zoom).toBe(0.05);
  });

  it("leaves ordinary scrolling to the browser", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(rig.wheel(300, 300, -100)).toBe(true);
    expect(state().zoom).toBe(1);
  });

  it("does not zoom without an open design", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().closeDesign());
    const zoom = state().zoom;
    rig.wheel(300, 300, -100, { ctrl: true });
    expect(state().zoom).toBe(zoom);
  });
});

describe("dropping things on the canvas", () => {
  const png = (name = "picture.png") => new File(["x"], name, { type: "image/png" });
  const drop = (rig: Awaited<ReturnType<typeof mountWorkspace>>, x: number, y: number, dataTransfer: Record<string, unknown>) => rig.drop(x, y, dataTransfer);
  const payload = (value: unknown) => ({ types: [DRAG_MIME], getData: (type: string) => (type === DRAG_MIME ? JSON.stringify(value) : "") });

  it("accepts files and panel items being dragged over, and nothing else", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const files = { types: ["Files"], dropEffect: "none" };
    expect(rig.dragOver(400, 300, files)).toBe(false);
    expect(files.dropEffect).toBe("copy");
    expect(rig.dragOver(400, 300, { types: [DRAG_MIME] })).toBe(false);
    expect(rig.dragOver(400, 300, { types: ["text/plain"] })).toBe(true);
  });

  it("adds a dropped image file centred on the drop point and selects it", async () => {
    const rig = await mountWorkspace(canvasDesign());
    drop(rig, 400, 300, { types: ["Files"], files: [png()] });
    await waitFor(() => expect(added<ImageElement>("image")).toHaveLength(1));
    const [image] = added<ImageElement>("image");
    expect(image.src).toMatch(/^asset:/);
    expect(image.x + image.width / 2).toBeCloseTo(400);
    expect(image.y + image.height / 2).toBeCloseTo(300);
    expect(state().selection).toEqual([image.id]);
  });

  it("lays several dropped files out one after another", async () => {
    const rig = await mountWorkspace(canvasDesign());
    drop(rig, 400, 300, { types: ["Files"], files: [png("one.png"), png("two.png")] });
    await waitFor(() => expect(added<ImageElement>("image")).toHaveLength(2));
    const [first, second] = added<ImageElement>("image");
    expect(first.src).not.toBe(second.src);
    expect(second.x - first.x).toBeCloseTo(32);
    expect(second.y - first.y).toBeCloseTo(32);
  });

  it("puts a dropped photo into the empty frame under it", async () => {
    const frame = createImage({ id: "frame", src: null, x: 500, y: 100, width: 200, height: 150, naturalWidth: 1, naturalHeight: 1, isFrame: true });
    const rig = await mountWorkspace(canvasDesign([frame]));
    drop(rig, 600, 175, { types: ["Files"], files: [png()] });
    await waitFor(() => expect(added<ImageElement>("image")[0].src).toMatch(/^asset:/));
    expect(added<ImageElement>("image")).toHaveLength(1);
    expect(added<ImageElement>("image")[0].id).toBe("frame");
  });

  it("ignores dropped files that are not pictures", async () => {
    const rig = await mountWorkspace(canvasDesign());
    drop(rig, 400, 300, { types: ["Files"], files: [new File(["x"], "notes.txt", { type: "text/plain" })] });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(currentPage().elements).toHaveLength(0);
  });

  it("adds the elements of a dragged panel item centred on the drop point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    const item = createShape("rect", { id: "tpl", x: 0, y: 0, width: 100, height: 60 });
    drop(rig, 400, 300, payload({ type: "elements", elements: [item] }));
    expect(currentPage().elements).toHaveLength(1);
    const [el] = currentPage().elements;
    expect(el.x + el.width / 2).toBe(400);
    expect(el.y + el.height / 2).toBe(300);
    expect(el.id).not.toBe("tpl");
  });

  it("places a dragged panel photo as a new image at the drop point", async () => {
    const rig = await mountWorkspace(canvasDesign());
    drop(rig, 300, 200, payload({ type: "image", src: "builtin:nebula", naturalWidth: 400, naturalHeight: 300 }));
    const [image] = added<ImageElement>("image");
    expect(image.src).toBe("builtin:nebula");
    expect(image.x + image.width / 2).toBeCloseTo(300);
    expect(image.y + image.height / 2).toBeCloseTo(200);
  });

  it("sets the page background from a dragged background tile", async () => {
    const rig = await mountWorkspace(canvasDesign());
    drop(rig, 300, 200, payload({ type: "background", fill: { type: "solid", color: "#ff8800" } }));
    expect(currentPage().background).toEqual({ type: "solid", color: "#ff8800" });
    expect(state().past).toHaveLength(1);
  });

  it("ignores payloads it cannot read and drops of unrelated things", async () => {
    const rig = await mountWorkspace(canvasDesign());
    expect(drop(rig, 300, 200, { types: [DRAG_MIME], getData: () => "{broken" })).toBe(false);
    expect(drop(rig, 300, 200, { types: ["Files"], files: [], getData: () => "" })).toBe(false);
    expect(drop(rig, 300, 200, { types: ["text/plain"], getData: () => "hello" })).toBe(true);
    expect(currentPage().elements).toHaveLength(0);
    expect(state().past).toHaveLength(0);
  });

  it("adds nothing in view mode or without an open design, but takes the drop, so that a file never opens in the tab", async () => {
    const rig = await mountWorkspace(canvasDesign());
    act(() => getActions().setMode("view"));
    // (false: the browser's own handling of the drop was prevented)
    expect(drop(rig, 300, 200, payload({ type: "background", fill: { type: "solid", color: "#ff8800" } }))).toBe(false);
    const photo = new File([new Uint8Array([137, 80, 78, 71])], "photo.png", { type: "image/png" });
    expect(drop(rig, 300, 200, { types: ["Files"], files: [photo], getData: () => "" })).toBe(false);
    expect(currentPage().background).toEqual({ type: "solid", color: "#ffffff" });
    expect(currentPage().elements).toHaveLength(0);
    act(() => getActions().closeDesign());
    expect(drop(rig, 300, 200, payload({ type: "background", fill: { type: "solid", color: "#ff8800" } }))).toBe(false);
  });
});

describe("small slips with the creation tools", () => {
  it("treats a press that barely moves as a click", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape");
    rig.down(300, 300);
    rig.move(301, 301);
    expect(useGesture.getState().marquee).toBeNull();
    rig.up(301, 301);
    const [shape] = added<ShapeElement>("shape");
    expect([shape.width, shape.height]).toEqual([133, 133]);
    expect([shape.x, shape.y]).toEqual([300 - 66.5, 300 - 66.5]);
  });

  it("falls back to a rectangle when the palette names no shape", async () => {
    const rig = await mountWorkspace(canvasDesign());
    useTool("shape", "");
    rig.down(300, 300);
    rig.up(300, 300);
    expect(added<ShapeElement>("shape")[0].shape).toBe("rect");
  });
});
