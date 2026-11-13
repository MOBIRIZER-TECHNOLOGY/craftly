/**
 * The helpers that put pictures and dragged panel items on the page: drag payloads, sizing, drop targets, dropping
 * files (stored as assets) and filling picture frames.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAsset } from "@/core/assets";
import { createDesign, createImage, createPage, createShape } from "@/core/factory";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { DesignElement, ImageElement } from "@/core/types";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { DRAG_MIME, findDropTarget, imageElementFor, insertImage, insertImageFiles, insertPayload, readDragPayload, setDragPayload, type DragPayload } from "./insert";

const state = () => useEditor.getState();
const elements = () => getActivePage(state())!.elements;
const byId = (id: string) => elements().find((e) => e.id === id)!;

function open(list: DesignElement[] = []) {
  getActions().openDesign(createDesign({ title: "Insert", width: 1000, height: 600, pages: [createPage({ elements: list })] }));
}

const frame = (extra: Partial<ImageElement> = {}) =>
  createImage({ id: "frame", src: null, x: 100, y: 100, width: 200, height: 100, naturalWidth: 1, naturalHeight: 1, isFrame: true, ...extra });
const picture = (extra: Partial<ImageElement> = {}) =>
  createImage({ id: "pic", src: "https://example.test/old.jpg", x: 500, y: 100, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200, ...extra });
const png = (name = "photo.png") => new File(["x"], name, { type: "image/png" });

/** A DataTransfer that remembers what was stored in it. */
function fakeTransfer() {
  const data = new Map<string, string>();
  return {
    data,
    effectAllowed: "none",
    setData: vi.fn((type: string, value: string) => void data.set(type, value)),
    getData: (type: string) => data.get(type) ?? "",
    setDragImage: vi.fn(),
  };
}

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

describe("drag payloads", () => {
  it("writes the payload as JSON under Craftly's own type, plus a plain text hint", () => {
    const dt = fakeTransfer();
    const payload: DragPayload = { type: "background", fill: { type: "solid", color: "#123456" } };
    setDragPayload({ dataTransfer: dt as unknown as DataTransfer }, payload);
    expect(dt.setData).toHaveBeenCalledWith(DRAG_MIME, JSON.stringify(payload));
    expect(dt.data.get("text/plain")).toBe("background");
    expect(dt.effectAllowed).toBe("copy");
    expect(dt.setDragImage).not.toHaveBeenCalled();
  });

  it("centres the drag image on the cursor when one is given", () => {
    const dt = fakeTransfer();
    const image = { clientWidth: 120, clientHeight: 80 } as HTMLElement;
    setDragPayload({ dataTransfer: dt as unknown as DataTransfer }, { type: "background", fill: { type: "solid", color: "#fff" } }, image);
    expect(dt.setDragImage).toHaveBeenCalledWith(image, 60, 40);
  });

  it("does nothing when the browser gives no data transfer", () => {
    expect(() => setDragPayload({ dataTransfer: null }, { type: "background", fill: { type: "solid", color: "#fff" } })).not.toThrow();
  });

  it("reads back what was written", () => {
    const dt = fakeTransfer();
    const payload: DragPayload = { type: "image", src: "builtin:nebula", naturalWidth: 400, naturalHeight: 300, name: "A" };
    setDragPayload({ dataTransfer: dt as unknown as DataTransfer }, payload);
    expect(readDragPayload({ dataTransfer: dt } as unknown as DragEvent)).toEqual(payload);
  });

  // any page can put data of Craftly's type on a drag, so what is dropped is checked like a file or the clipboard
  const dropped = (payload: unknown) => readDragPayload({ dataTransfer: { getData: () => JSON.stringify(payload) } } as unknown as DragEvent);

  it("reads back elements and a background as they were written", () => {
    const shape = createShape("rect", { id: "s", x: 0, y: 0, width: 10, height: 10 });
    expect(dropped({ type: "elements", elements: [shape] })).toEqual({ type: "elements", elements: [shape] });
    expect(dropped({ type: "background", fill: { type: "solid", color: "#123456" } })).toEqual({ type: "background", fill: { type: "solid", color: "#123456" } });
    expect(dropped({ type: "background", fill: { type: "image", src: "builtin:nebula", fit: "cover" } })).not.toBeNull();
  });

  it("keeps only the usable elements of a drop, and takes pictures from the web out of them", () => {
    const shape = createShape("rect", { id: "s", x: 0, y: 0, width: 10, height: 10 });
    const read = dropped({ type: "elements", elements: [shape, { id: "t", type: "text" }, "junk", picture()] });
    expect(read).toMatchObject({ type: "elements", elements: [{ id: "s" }, { id: "pic", src: null }] });
  });

  it.each([
    ["no object", 5],
    ["of a kind it does not know", { type: "mystery" }],
    ["elements that are no list", { type: "elements", elements: "many" }],
    ["elements of which none is usable", { type: "elements", elements: [{ id: "t", type: "text" }] }],
    ["a picture from the web", { type: "image", src: "https://example.test/a.jpg", naturalWidth: 400, naturalHeight: 300 }],
    ["a picture with no address", { type: "image", src: "", naturalWidth: 400, naturalHeight: 300 }],
    ["a picture with no size", { type: "image", src: "builtin:nebula", naturalWidth: 0, naturalHeight: 300 }],
    ["a picture whose size is no number", { type: "image", src: "builtin:nebula", naturalWidth: 400, naturalHeight: "300" }],
    ["a background that is no fill", { type: "background", fill: { type: "mystery" } }],
    ["a background with a picture from the web", { type: "background", fill: { type: "image", src: "https://example.test/a.jpg", fit: "cover" } }],
  ])("reads nothing when the drop is %s", (_name, payload) => {
    expect(dropped(payload)).toBeNull();
  });

  it.each([
    ["nothing was dragged", { dataTransfer: fakeTransfer() }],
    ["there is no data transfer", { dataTransfer: null }],
    ["the data is not valid JSON", { dataTransfer: { getData: () => "{oops" } }],
  ])("reads nothing when %s", (_name, event) => {
    expect(readDragPayload(event as unknown as DragEvent)).toBeNull();
  });
});

describe("imageElementFor", () => {
  const page = { width: 1280, height: 720 };

  it("fits a landscape picture to half the page width", () => {
    const el = imageElementFor(page, "x.jpg", 4000, 3000);
    expect([el.width, el.height]).toEqual([640, 480]);
    expect([el.naturalWidth, el.naturalHeight, el.src]).toEqual([4000, 3000, "x.jpg"]);
  });

  it("limits a portrait picture to 70 % of the page height", () => {
    const el = imageElementFor(page, "x.jpg", 3000, 4000);
    expect([el.width, el.height]).toEqual([378, 504]);
  });

  it("scales a small picture up to a comfortable size", () => {
    const el = imageElementFor(page, "x.jpg", 100, 50);
    expect([el.width, el.height]).toEqual([640, 320]);
  });
});

describe("findDropTarget", () => {
  const page = (els: DesignElement[]) => createPage({ elements: els });

  it("finds the topmost picture under the point", () => {
    const lower = picture({ id: "lower", x: 100, y: 100 });
    const upper = picture({ id: "upper", x: 150, y: 120 });
    expect(findDropTarget(page([lower, upper]), { x: 200, y: 150 })?.id).toBe("upper");
    expect(findDropTarget(page([lower, upper]), { x: 110, y: 110 })?.id).toBe("lower");
  });

  it("finds nothing on empty canvas", () => {
    expect(findDropTarget(page([picture()]), { x: 10, y: 10 })).toBeNull();
  });

  it("skips hidden and locked pictures and everything that is not a picture", () => {
    const els = [picture({ id: "h", hidden: true }), picture({ id: "l", locked: true }), createShape("rect", { id: "s", x: 500, y: 100, width: 200, height: 100 })];
    expect(findDropTarget(page(els), { x: 600, y: 150 })).toBeNull();
  });

  it("respects the rotation of a picture", () => {
    // 200 x 100 turned by 90 degrees about (200, 150): it now covers x 150..250 and y 50..250
    const turned = picture({ id: "turned", x: 100, y: 100, rotation: 90 });
    expect(findDropTarget(page([turned]), { x: 200, y: 60 })?.id).toBe("turned");
    expect(findDropTarget(page([turned]), { x: 120, y: 150 })).toBeNull();
  });

  it("leaves out the pictures it is told to skip", () => {
    const els = [picture({ id: "a" })];
    expect(findDropTarget(page(els), { x: 600, y: 150 }, new Set(["a"]))).toBeNull();
    expect(findDropTarget(page(els), { x: 600, y: 150 }, new Set(["other"]))?.id).toBe("a");
  });
});

describe("insertImage", () => {
  it("does nothing without an open design", () => {
    expect(insertImage("x.jpg", 400, 300)).toBe("");
  });

  it("adds a picture in the middle of the page and selects it", () => {
    open();
    const id = insertImage("x.jpg", 400, 300);
    const el = byId(id) as ImageElement;
    expect([el.width, el.height]).toEqual([500, 375]);
    expect(el.x + el.width / 2).toBeCloseTo(500);
    expect(el.y + el.height / 2).toBeCloseTo(300);
    expect(state().selection).toEqual([id]);
  });

  it("adds a picture centred on the drop point", () => {
    open();
    const el = byId(insertImage("x.jpg", 400, 300, { x: 300, y: 200 })) as ImageElement;
    expect(el.x + el.width / 2).toBeCloseTo(300);
    expect(el.y + el.height / 2).toBeCloseTo(200);
  });

  it("fills the selected empty frame instead of adding a picture", () => {
    open([frame(), createShape("rect", { id: "s", x: 600, y: 300, width: 50, height: 50 })]);
    getActions().select(["frame"]);
    const id = insertImage("x.jpg", 400, 200);
    expect(id).toBe("frame");
    expect(elements()).toHaveLength(2);
    const el = byId("frame") as ImageElement;
    expect([el.src, el.naturalWidth, el.naturalHeight]).toEqual(["x.jpg", 400, 200]);
    expect(el.crop).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(state().selection).toEqual(["frame"]);
  });

  it("adds a new picture when the selection is a picture that already has an image or several elements", () => {
    open([frame(), picture()]);
    getActions().select(["pic"]);
    const first = insertImage("x.jpg", 400, 200);
    expect(first).not.toBe("pic");
    expect(elements()).toHaveLength(3);
    getActions().select(["frame", "pic"]);
    insertImage("y.jpg", 400, 200);
    expect(elements()).toHaveLength(4);
    expect((byId("frame") as ImageElement).src).toBeNull();
  });

  it("swaps the picture of the image under the drop point", () => {
    open([picture()]);
    const id = insertImage("new.jpg", 100, 100, { x: 600, y: 150 });
    expect(id).toBe("pic");
    expect(elements()).toHaveLength(1);
    expect((byId("pic") as ImageElement).src).toBe("new.jpg");
    expect(state().selection).toEqual(["pic"]);
  });

  it("does not use a selected frame when dropping somewhere else", () => {
    open([frame()]);
    getActions().select(["frame"]);
    insertImage("new.jpg", 100, 100, { x: 800, y: 500 });
    expect((byId("frame") as ImageElement).src).toBeNull();
    expect(elements()).toHaveLength(2);
  });
});

describe("insertImageFiles", () => {
  it("stores each picture as an asset and adds an element that points at it", async () => {
    open();
    const ids = await insertImageFiles([png("holiday.png")]);
    expect(ids).toHaveLength(1);
    const el = byId(ids[0]) as ImageElement;
    expect(el.src).toMatch(/^asset:/);
    const asset = await getAsset(el.src!.slice("asset:".length));
    expect(asset).toMatchObject({ name: "holiday", kind: "image", mime: "image/png", width: 64, height: 48 });
    expect(el.naturalWidth).toBe(64);
    expect(state().selection).toEqual(ids);
  });

  it("reads the size of an SVG file from its viewBox", async () => {
    open();
    const svg = new File(['<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 100"><rect width="200" height="100"/></svg>'], "logo.svg", { type: "image/svg+xml" });
    const [id] = await insertImageFiles([svg]);
    const el = byId(id) as ImageElement;
    expect([el.naturalWidth, el.naturalHeight]).toEqual([200, 100]);
    const asset = await getAsset(el.src!.slice("asset:".length));
    expect(asset?.kind).toBe("svg");
  });

  it("skips files that are not pictures", async () => {
    open();
    const ids = await insertImageFiles([new File(["x"], "notes.txt", { type: "text/plain" }), png("ok.png")]);
    expect(ids).toHaveLength(1);
    expect(elements()).toHaveLength(1);
    expect(await insertImageFiles([new File(["x"], "notes.txt", { type: "text/plain" })])).toEqual([]);
  });

  it("recognises pictures by their file extension when the type is missing", async () => {
    open();
    const ids = await insertImageFiles([new File(["x"], "scan.JPG")]);
    expect(ids).toHaveLength(1);
  });

  it("puts several files down one after another, each 32 pixels further", async () => {
    open();
    const ids = await insertImageFiles([png("one.png"), png("two.png"), png("three.png")], { x: 400, y: 300 });
    expect(new Set(ids).size).toBe(3);
    expect(elements()).toHaveLength(3);
    const [a, b, c] = ids.map((id) => byId(id));
    expect(b.x - a.x).toBeCloseTo(32);
    expect(c.y - b.y).toBeCloseTo(32);
    expect(elements().map((e) => (e as ImageElement).src)).toEqual([...new Set(elements().map((e) => (e as ImageElement).src))]);
  });

  it("fills the picture frame under the drop point with the first file and adds the rest beside it", async () => {
    open([frame()]);
    const ids = await insertImageFiles([png("one.png"), png("two.png")], { x: 200, y: 150 });
    expect(ids[0]).toBe("frame");
    expect(ids[1]).not.toBe("frame");
    expect(elements()).toHaveLength(2);
    expect((byId("frame") as ImageElement).src).toMatch(/^asset:/);
  });

  it("returns nothing for an empty list", async () => {
    open();
    expect(await insertImageFiles([])).toEqual([]);
  });

  it("keeps the uploads but places nothing when no design is open", async () => {
    const ids = await insertImageFiles([png("orphan.png")]);
    expect(ids).toEqual([]);
    expect(state().design).toBeNull();
  });
});

describe("insertPayload", () => {
  it("adds dragged elements centred on the drop point", () => {
    open();
    insertPayload({ type: "elements", elements: [createShape("rect", { id: "tpl", x: 0, y: 0, width: 100, height: 60 })] }, { x: 300, y: 200 });
    const [el] = elements();
    expect(el.x + el.width / 2).toBe(300);
    expect(el.y + el.height / 2).toBe(200);
    expect(el.id).not.toBe("tpl");
  });

  it("adds dragged elements to the middle of the page without a drop point", () => {
    open();
    insertPayload({ type: "elements", elements: [createShape("rect", { x: 0, y: 0, width: 100, height: 60 })] });
    const [el] = elements();
    expect(el.x + el.width / 2).toBe(500);
    expect(el.y + el.height / 2).toBe(300);
  });

  it("places a dragged photo, with or without a drop point", () => {
    open();
    insertPayload({ type: "image", src: "https://example.test/a.jpg", naturalWidth: 400, naturalHeight: 200 }, { x: 250, y: 150 });
    insertPayload({ type: "image", src: "https://example.test/b.jpg", naturalWidth: 400, naturalHeight: 200 });
    expect(elements().map((e) => (e as ImageElement).src)).toEqual(["https://example.test/a.jpg", "https://example.test/b.jpg"]);
  });

  it("ignores payloads of a kind it does not know", () => {
    open();
    const before = state().design;
    insertPayload({ type: "mystery" } as unknown as DragPayload);
    expect(state().design).toBe(before);
  });

  it("sets the page background from a dragged background", () => {
    open();
    insertPayload({ type: "background", fill: { type: "solid", color: "#abcdef" } });
    expect(getActivePage(state())!.background).toEqual({ type: "solid", color: "#abcdef" });
  });
});
