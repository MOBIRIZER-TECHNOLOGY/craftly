/**
 * Crop mode: the maths that keeps a picture covering its frame, and the overlay where the picture is panned inside
 * its frame, the frame is trimmed with the eight handles, the wheel zooms and Done leaves crop mode.
 */
import { act, configure, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { createImage, createShape } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { canvasDesign, elementOf, mountWorkspace, type CanvasRig } from "@/test/canvasUtils";
import { CROP_RATIOS, clampCrop, cropRatioOf, currentCropRatio, getCropScale, resetCrop, setCropRatio, setCropRotation, setCropScale } from "./CropOverlay";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const photo = (extra: Partial<ImageElement> = {}) =>
  createImage({ id: "img", src: "blob:test/p.jpg", x: 500, y: 300, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200, ...extra });
const img = () => elementOf<ImageElement>("img");

/** Open the picture for cropping, optionally zoomed in so there is something to pan. */
async function crop(extra: Partial<ImageElement> = {}, scale = 1) {
  const rig = await mountWorkspace(canvasDesign([photo(extra), createShape("rect", { id: "other", x: 100, y: 100, width: 100, height: 100 })]));
  if (scale !== 1) act(() => setCropScale("img", scale));
  act(() => getActions().startCrop("img"));
  await waitFor(() => expect(rig.container.querySelector(".cf-crop__live")).toBeTruthy());
  return rig;
}
const frame = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>("[data-cf-crop]")!;
const windowOf = (rig: CanvasRig) => rig.container.querySelector<HTMLElement>(".cf-crop__window")!;
const handle = (rig: CanvasRig, name: string) => rig.container.querySelector<HTMLElement>(`.cf-crop__handle--${name}`)!;
/** press at client (0, 0), move by (dx, dy) and release */
function dragBy(target: HTMLElement, dx: number, dy: number, rig: CanvasRig) {
  rig.pointerAt("pointerDown", 0, 0, { target });
  rig.pointerAt("pointerMove", dx / 2, dy / 2, { target });
  rig.pointerAt("pointerMove", dx, dy, { target });
  rig.pointerAt("pointerUp", dx, dy, { target });
}

describe("clampCrop", () => {
  it("keeps the picture covering the frame", () => {
    expect(clampCrop({ x: 0.2, y: -0.9, w: 1.5, h: 1.25 })).toEqual({ x: 0, y: -0.25, w: 1.5, h: 1.25 });
    expect(clampCrop({ x: -3, y: 0.3, w: 1.5, h: 1.25 })).toEqual({ x: -0.5, y: 0, w: 1.5, h: 1.25 });
  });

  it("leaves a valid crop untouched", () => {
    expect(clampCrop({ x: -0.25, y: -0.125, w: 1.5, h: 1.25 })).toEqual({ x: -0.25, y: -0.125, w: 1.5, h: 1.25 });
  });
});

describe("zooming the picture inside its frame", () => {
  const open = () => getActions().openDesign(canvasDesign([photo(), createShape("rect", { id: "other", x: 0, y: 0, width: 10, height: 10 })]));

  it("starts at scale 1, where the picture just covers the frame", () => {
    open();
    expect(getCropScale(img())).toBe(1);
    const wide = createImage({ src: "blob:test/x.jpg", width: 100, height: 100, naturalWidth: 400, naturalHeight: 200, crop: { x: 0, y: 0, w: 2, h: 1 } });
    expect(getCropScale(wide)).toBe(1);
  });

  it("zooms into the middle of what is visible", () => {
    open();
    setCropScale("img", 2);
    expect(img().crop).toEqual({ x: -0.5, y: -0.5, w: 2, h: 2 });
    expect(getCropScale(img())).toBe(2);
    setCropScale("img", 4);
    expect(getCropScale(img())).toBe(4);
    expect(img().crop.x).toBe(-1.5);
  });

  it("zooms around the visible centre when the picture was panned", () => {
    open();
    setCropScale("img", 2);
    getActions().updateElements(["img"], (d) => {
      if (d.type === "image") d.crop = { x: -1, y: 0, w: 2, h: 2 };
    });
    setCropScale("img", 1);
    expect(img().crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("stays between 1x and 8x", () => {
    open();
    setCropScale("img", 100);
    expect(getCropScale(img())).toBe(8);
    setCropScale("img", 0.2);
    expect(getCropScale(img())).toBe(1);
  });

  it("ignores elements that are not pictures and ids that do not exist", () => {
    open();
    const before = state().design;
    setCropScale("other", 2);
    setCropScale("nope", 2);
    expect(state().design).toBe(before);
  });

  it("merges quick successive zooms into one undo step", () => {
    open();
    setCropScale("img", 1.5);
    setCropScale("img", 2);
    expect(state().past).toHaveLength(1);
  });

  it("goes back to the plain cover crop when reset, also after panning", () => {
    open();
    setCropScale("img", 3);
    getActions().updateElements(["img"], (d) => {
      if (d.type === "image") d.crop = { ...d.crop, x: -0.3, y: -1.9 };
    });
    resetCrop("img");
    expect(img().crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });
});

describe("the crop overlay", () => {
  it("shows the picture over its frame with a Done button", async () => {
    const rig = await crop();
    const overlay = frame(rig);
    expect(overlay.style.left).toBe("500px");
    expect(overlay.style.width).toBe("200px");
    expect(overlay.style.height).toBe("100px");
    expect(rig.container.querySelectorAll(".cf-crop__ghost, .cf-crop__live")).toHaveLength(2);
    expect(rig.container.querySelector(".cf-crop__live")?.getAttribute("src")).toBe("blob:test/p.jpg");
    expect(rig.getByRole("button", { name: "Done" })).toBeTruthy();
    expect(rig.container.querySelectorAll("[class*='cf-crop__handle--']")).toHaveLength(8);
    // the selection handles give way to the crop handles
    expect(rig.container.querySelector(".cf-sel")).toBeNull();
  });

  it("turns with the picture", async () => {
    const rig = await crop({ rotation: 30 });
    expect(frame(rig).style.transform).toBe("rotate(30deg)");
  });

  it("sizes the picture inside the frame from the crop", async () => {
    const rig = await crop({}, 2);
    const live = rig.container.querySelector<HTMLElement>(".cf-crop__live")!;
    expect([live.style.left, live.style.top, live.style.width, live.style.height]).toEqual(["-100px", "-50px", "400px", "200px"]);
  });

  it("is not shown for an empty frame, a missing picture or a different kind of element", async () => {
    const rig = await mountWorkspace(canvasDesign([photo({ id: "empty", src: null }), createShape("rect", { id: "box", x: 0, y: 0, width: 50, height: 50 })]));
    for (const id of ["empty", "box", "gone"]) {
      act(() => useEditor.setState({ croppingId: id }));
      expect(rig.container.querySelector("[data-cf-crop]")).toBeNull();
    }
  });

  it("leaves crop mode when Done is pressed", async () => {
    const rig = await crop();
    rig.pointerAt("pointerDown", 0, 0, { target: rig.getByRole("button", { name: "Done" }) });
    expect(state().croppingId).toBe("img");
    fireEvent.click(rig.getByRole("button", { name: "Done" }));
    expect(state().croppingId).toBeNull();
    expect(rig.container.querySelector("[data-cf-crop]")).toBeNull();
  });
});

describe("panning the picture", () => {
  it("moves the picture inside the frame, one undo step per drag", async () => {
    const rig = await crop({}, 2);
    const before = state().past.length;
    dragBy(windowOf(rig), 40, 25, rig);
    expect(img().crop.x).toBeCloseTo(-0.3);
    expect(img().crop.y).toBeCloseTo(-0.25);
    expect(img().crop.w).toBe(2);
    expect([img().x, img().y, img().width, img().height]).toEqual([500, 300, 200, 100]);
    expect(state().past).toHaveLength(before + 1);
    act(() => getActions().undo());
    expect(img().crop.x).toBe(-0.5);
  });

  it("never moves the picture off the frame", async () => {
    const rig = await crop({}, 2);
    dragBy(windowOf(rig), 500, 500, rig);
    expect(img().crop).toMatchObject({ x: 0, y: 0 });
    dragBy(windowOf(rig), -900, -900, rig);
    expect(img().crop).toMatchObject({ x: -1, y: -1 });
  });

  it("follows the pointer in design pixels at any zoom", async () => {
    const rig = await crop({}, 2);
    act(() => getActions().setZoom(0.5));
    dragBy(windowOf(rig), 20, 0, rig);
    // 20 screen px at 50 % zoom are 40 design px, a fifth of the 200 px wide frame
    expect(img().crop.x).toBeCloseTo(-0.3);
  });

  it("pans along the picture's own axes when it is turned", async () => {
    const rig = await crop({ rotation: 90 }, 2);
    dragBy(windowOf(rig), 0, 40, rig);
    // the picture's own x axis points down once it is turned by 90 degrees: a downward drag moves it along that axis
    expect(img().crop.x).toBeCloseTo(-0.3);
    expect(img().crop.y).toBeCloseTo(-0.5);
  });

  it("stops following the pointer once it is released or cancelled", async () => {
    const rig = await crop({}, 2);
    const target = windowOf(rig);
    rig.pointerAt("pointerDown", 0, 0, { target });
    rig.pointerAt("pointerMove", 20, 0, { target });
    rig.pointerAt("pointerUp", 20, 0, { target });
    const after = img().crop.x;
    rig.pointerAt("pointerMove", 100, 0, { target });
    expect(img().crop.x).toBe(after);
    rig.pointerAt("pointerDown", 0, 0, { target });
    rig.pointerAt("pointerMove", 20, 0, { target });
    fireEvent.pointerCancel(target, { pointerId: 1 });
    const cancelled = img().crop.x;
    rig.pointerAt("pointerMove", 100, 0, { target });
    expect(img().crop.x).toBe(cancelled);
  });

  it("closes the drag's undo step when crop mode ends before the pointer is released, so undo still works", async () => {
    const rig = await crop({}, 2);
    const before = state().past.length;
    const target = windowOf(rig);
    rig.pointerAt("pointerDown", 0, 0, { target });
    rig.pointerAt("pointerMove", 40, 25, { target });
    // Esc, or anything else that ends crop mode, while the picture is held: the overlay goes and its pointerup never comes
    act(() => getActions().endCrop());
    await waitFor(() => expect(rig.container.querySelector("[data-cf-crop]")).toBeNull());
    expect(state().past).toHaveLength(before + 1);
    act(() => getActions().undo());
    expect(img().crop.x).toBe(-0.5);
  });

  it("does not start a canvas gesture while the picture is pressed", async () => {
    const rig = await crop({}, 2);
    rig.down(600, 350, { target: windowOf(rig) });
    expect(state().croppingId).toBe("img");
    expect(state().selection).toEqual(["img"]);
    rig.pointerAt("pointerUp", 0, 0, { target: windowOf(rig) });
  });
});

describe("trimming the frame", () => {
  // after zooming to 2x the picture is 400 x 200 and starts 100 px left of and 50 px above the 200 x 100 frame

  it("trims from the east handle while the picture stays where it is", async () => {
    const rig = await crop({}, 2);
    dragBy(handle(rig, "e"), -50, 0, rig);
    expect([img().x, img().y, img().width, img().height]).toEqual([500, 300, 150, 100]);
    expect(img().crop.x).toBeCloseTo(-100 / 150);
    expect(img().crop.w).toBeCloseTo(400 / 150);
    expect(img().crop.y).toBeCloseTo(-0.5);
    expect(img().crop.h).toBe(2);
  });

  it("trims from the south handle", async () => {
    const rig = await crop({}, 2);
    dragBy(handle(rig, "s"), 0, -40, rig);
    expect([img().width, img().height]).toEqual([200, 60]);
    expect(img().crop.y).toBeCloseTo(-50 / 60);
  });

  it("trims from the west and north handles, moving the frame's origin with them", async () => {
    const rig = await crop({}, 2);
    dragBy(handle(rig, "w"), 60, 0, rig);
    expect([img().x, img().width]).toEqual([560, 140]);
    expect(img().crop.x).toBeCloseTo(-160 / 140);
    dragBy(handle(rig, "n"), 0, 30, rig);
    expect([img().y, img().height]).toEqual([330, 70]);
    expect(img().crop.y).toBeCloseTo(-80 / 70);
  });

  it("can widen the frame up to the edge of the picture and no further", async () => {
    const rig = await crop({}, 2);
    dragBy(handle(rig, "w"), -80, 0, rig);
    expect([img().x, img().width]).toEqual([420, 280]);
    dragBy(handle(rig, "w"), -500, 0, rig);
    expect(img().x).toBeCloseTo(400);
    expect(img().width).toBeCloseTo(300);
    dragBy(handle(rig, "e"), 900, 0, rig);
    expect(img().width).toBeCloseTo(400);
  });

  it("trims two sides at once from a corner", async () => {
    const rig = await crop({}, 2);
    dragBy(handle(rig, "nw"), 20, 10, rig);
    expect([img().x, img().y, img().width, img().height]).toEqual([520, 310, 180, 90]);
    dragBy(handle(rig, "se"), -30, -20, rig);
    expect([img().width, img().height]).toEqual([150, 70]);
    dragBy(handle(rig, "ne"), -10, 10, rig);
    expect([img().width, img().y, img().height]).toEqual([140, 320, 60]);
    dragBy(handle(rig, "sw"), 10, -10, rig);
    expect([img().x, img().width, img().height]).toEqual([530, 130, 50]);
  });

  it("keeps the frame at least 24 pixels wide and high", async () => {
    const rig = await crop({}, 2);
    dragBy(handle(rig, "e"), -500, 0, rig);
    expect(img().width).toBe(24);
    dragBy(handle(rig, "s"), 0, -500, rig);
    expect(img().height).toBe(24);
  });

  it("trims along the picture's own axes when it is turned", async () => {
    const rig = await crop({ rotation: 90 }, 2);
    // the east edge of a picture turned by 90 degrees faces down: dragging it up by 50 trims 50 px from the width
    dragBy(handle(rig, "e"), 0, -50, rig);
    expect(img().width).toBeCloseTo(150);
    expect(img().rotation).toBe(90);
    // the west edge stays where it was, so the centre moves half the change up the screen
    expect(img().x + img().width / 2).toBeCloseTo(600);
    expect(img().y + img().height / 2).toBeCloseTo(325);
  });

  it("is one undo step per drag", async () => {
    const rig = await crop({}, 2);
    const before = state().past.length;
    dragBy(handle(rig, "e"), -50, 0, rig);
    expect(state().past).toHaveLength(before + 1);
    act(() => getActions().undo());
    expect(img().width).toBe(200);
  });
});

describe("zooming with the wheel in crop mode", () => {
  it("zooms the picture, not the page, and merges the steps into one undo step", async () => {
    const rig = await crop();
    const before = state().past.length;
    fireEvent.wheel(frame(rig), { deltaY: -200 });
    fireEvent.wheel(frame(rig), { deltaY: -200 });
    expect(getCropScale(img())).toBeCloseTo(Math.exp(0.6), 6);
    expect(state().zoom).toBe(1);
    expect(state().past).toHaveLength(before + 1);
  });

  it("zooms back out and stops at the frame size", async () => {
    const rig = await crop({}, 2);
    fireEvent.wheel(frame(rig), { deltaY: 3000 });
    expect(getCropScale(img())).toBe(1);
    fireEvent.wheel(frame(rig), { deltaY: -9000 });
    expect(getCropScale(img())).toBe(8);
  });
});

describe("giving the frame a fixed shape", () => {
  /** where the picture is on the page, whatever the frame shows of it */
  const pictureOnPage = (el: ImageElement) => ({ x: el.x + el.crop.x * el.width, y: el.y + el.crop.y * el.height, w: el.crop.w * el.width, h: el.crop.h * el.height });
  const open = (extra: Partial<ImageElement> = {}) => act(() => getActions().openDesign(canvasDesign([photo(extra)])));

  it("offers the shape of the picture and seven named ones", () => {
    expect(CROP_RATIOS.map((r) => r.id)).toEqual(["original", "1:1", "4:3", "3:2", "16:9", "3:4", "2:3", "9:16"]);
    expect(cropRatioOf(photo(), "16:9")).toBeCloseTo(16 / 9);
    expect(cropRatioOf(photo(), "original")).toBe(2);
    expect(cropRatioOf(photo({ naturalWidth: 300, naturalHeight: 400 }), "original")).toBe(0.75);
  });

  it("makes the largest frame of that shape the picture covers, around the middle, and leaves the picture where it is", () => {
    // a 400 x 200 picture that just covers its 200 x 100 frame at (500, 300)
    open();
    const before = pictureOnPage(img());
    act(() => setCropRatio("img", 1));
    expect(img()).toMatchObject({ x: 550, y: 300, width: 100, height: 100 });
    const after = pictureOnPage(img());
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
    expect(after.w).toBeCloseTo(before.w);
    expect(after.h).toBeCloseTo(before.h);
    expect(img().crop).toEqual({ x: -0.5, y: 0, w: 2, h: 1 });
    // one step of undo
    act(() => getActions().undo());
    expect(img()).toMatchObject({ x: 500, y: 300, width: 200, height: 100, crop: { x: 0, y: 0, w: 1, h: 1 } });
  });

  it("can make the frame larger again, up to the whole picture", () => {
    open();
    act(() => setCropRatio("img", 1));
    act(() => setCropRatio("img", 2));
    expect(img()).toMatchObject({ x: 500, y: 300, width: 200, height: 100 });
    expect(img().crop.x).toBeCloseTo(0);
    expect(img().crop.w).toBeCloseTo(1);
  });

  it("uses what the zoom shows: a picture zoomed to twice its size gives a frame of twice the size", () => {
    open();
    act(() => setCropScale("img", 2));
    // the picture is 400 x 200 on the page now, around the middle of the frame
    act(() => setCropRatio("img", 16 / 9));
    expect(img().width).toBeCloseTo((200 * 16) / 9);
    expect(img().height).toBeCloseTo(200);
    // the middle of the frame is where it was
    expect(img().x + img().width / 2).toBeCloseTo(600);
    expect(img().y + img().height / 2).toBeCloseTo(350);
  });

  it("stays inside the picture when the picture was panned to one side", () => {
    // the picture is twice the frame and pushed all the way left: its right edge is the frame's right edge
    open({ crop: { x: -1, y: -1, w: 2, h: 2 } });
    act(() => setCropRatio("img", 2));
    const el = img();
    // the whole picture: 400 x 200 on the page, from (300, 200)
    expect(el).toMatchObject({ x: 300, y: 200, width: 400, height: 200 });
    expect(el.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
  });

  it("keeps the middle of a turned picture where it was", () => {
    open({ rotation: 90 });
    act(() => setCropRatio("img", 1));
    expect(img().x + img().width / 2).toBeCloseTo(600);
    expect(img().y + img().height / 2).toBeCloseTo(350);
    expect(img()).toMatchObject({ width: 100, height: 100, rotation: 90 });
  });

  it("does nothing for a ratio that is none, for another kind of element and for an id that does not exist", () => {
    act(() => getActions().openDesign(canvasDesign([photo(), createShape("rect", { id: "other", x: 100, y: 100, width: 100, height: 100 })])));
    const before = JSON.stringify(state().design);
    act(() => setCropRatio("img", 0));
    act(() => setCropRatio("img", Number.NaN));
    act(() => setCropRatio("img", Number.POSITIVE_INFINITY));
    act(() => setCropRatio("other", 1));
    act(() => setCropRatio("nobody", 1));
    expect(JSON.stringify(state().design)).toBe(before);
  });

  it("says which shape the frame has now", () => {
    expect(currentCropRatio(photo())).toBe("original");
    expect(currentCropRatio(photo({ width: 100, height: 100 }))).toBe("1:1");
    expect(currentCropRatio(photo({ width: 160, height: 90 }))).toBe("16:9");
    expect(currentCropRatio(photo({ width: 90, height: 160 }))).toBe("9:16");
    expect(currentCropRatio(photo({ width: 200, height: 133.4 }))).toBe("3:2");
    expect(currentCropRatio(photo({ width: 200, height: 77 }))).toBeNull();
    // a square picture in a square frame is 1:1, not "original"
    expect(currentCropRatio(photo({ width: 100, height: 100, naturalWidth: 300, naturalHeight: 300 }))).toBe("1:1");
    // a picture of an unusual shape in a frame of that shape
    expect(currentCropRatio(photo({ width: 210, height: 100, naturalWidth: 420, naturalHeight: 200 }))).toBe("original");
  });
});

describe("straightening", () => {
  it("turns the picture inside its frame, clamps the angle and resets it", async () => {
    const rig = await crop({ crop: { x: 0, y: 0, w: 1, h: 1, rotation: 12 } });
    expect(rig.container.querySelector<HTMLElement>(".cf-crop__live")?.style.transform).toBe("rotate(12deg)");
    act(() => setCropRotation("img", 99));
    expect(img().crop.rotation).toBe(45);
    act(() => resetCrop("img"));
    expect(img().crop.rotation).toBeUndefined();
  });
});
