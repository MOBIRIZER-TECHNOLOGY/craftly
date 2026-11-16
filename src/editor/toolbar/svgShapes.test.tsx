/**
 * "Convert to shapes" as the person at the editor meets it: a picture that is a drawing, a graphic, or a text becomes shapes
 * where it is, in one step of undo; what they are told when it does not, and where the menu offers it.
 */
import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAsset } from "@/core/assets";
import { createDesign, createGraphic, createGroup, createImage, createPage, createShape, createText } from "@/core/factory";
import { getActivePage, useEditor, type EditorState } from "@/core/store";
import { MAX_SHAPES } from "@/core/svgImport";
import type { Asset, DesignElement, GroupElement, ShapeElement } from "@/core/types";
import { textToShapes, type TextShapes } from "@/render/textOutline";
import { resetEditor } from "@/test/helpers";
import { clearToasts } from "@/test/tabsHarness";
import { ToastHost, type MenuEntry, type MenuItemEntry } from "@/ui";
import { buildContextMenuItems } from "./contextMenuItems";
import { canConvertToShapes, convertToShapes } from "./svgShapes";

// the library of uploads, with the files a test puts into it
vi.mock("@/core/assets", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/core/assets")>()), getAsset: vi.fn() }));
// What a text becomes is the business of src/render/textOutline.ts, which is tested there with a real font file. Here the
// editor's side is tested: the menu, the replacement in one step of undo, and what the person is told.
vi.mock("@/render/textOutline", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/render/textOutline")>()), textToShapes: vi.fn() }));

const svg = (body: string) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100">${body}</svg>`;
const TWO = svg('<rect x="10" y="10" width="30" height="30" fill="#ff0000"/><circle cx="70" cy="70" r="20" fill="#0000ff"/>');

/** Puts files into the library: the id of an upload and its markup, or a photo. */
function uploads(files: Record<string, string | "photo">): void {
  vi.mocked(getAsset).mockImplementation((id: string) => {
    const file = files[id];
    if (file === undefined) return Promise.resolve(null);
    const blob = { text: () => Promise.resolve(file) } as unknown as Blob;
    return Promise.resolve({ id, kind: file === "photo" ? "image" : "svg", blob } as Asset);
  });
}

const s = () => useEditor.getState();
const page = () => getActivePage(s())!;
const picture = (id = "pic", over: Partial<Parameters<typeof createImage>[0]> = {}) =>
  createImage({ id, src: "asset:logo", x: 100, y: 200, width: 200, height: 200, naturalWidth: 100, naturalHeight: 100, ...over });

function open(elements: DesignElement[]) {
  resetEditor();
  s().actions.openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements })] }));
}

beforeEach(() => {
  clearToasts();
  uploads({ logo: TWO });
  render(<ToastHost />);
});

describe("converting a picture that is a drawing", () => {
  it("puts a group of shapes where the picture was, selects it, says how many, and is one step to undo", async () => {
    open([createShape("rect", { id: "below" }), picture(), createShape("rect", { id: "above" })]);
    expect(await convertToShapes("pic")).toBe(true);
    const [below, group, above] = page().elements;
    expect([below.id, above.id]).toEqual(["below", "above"]);
    expect(group).toMatchObject({ type: "group", x: 120, y: 220, width: 160, height: 160 });
    expect((group as GroupElement).children.map((c) => (c as ShapeElement).shape)).toEqual(["path", "path"]);
    expect(s().selection).toEqual([group.id]);
    expect(await screen.findByText("Converted to 2 shapes.")).toBeTruthy();
    expect(s().past).toHaveLength(1);
    s().actions.undo();
    expect(page().elements.map((e) => e.id)).toEqual(["below", "pic", "above"]);
  });

  it("puts the one shape itself there when the drawing is one shape", async () => {
    uploads({ logo: svg('<rect width="100" height="100" fill="#ff0000"/>') });
    open([picture()]);
    expect(await convertToShapes("pic")).toBe(true);
    expect(page().elements[0]).toMatchObject({ type: "shape", shape: "path", x: 100, y: 200, width: 200, height: 200 });
    expect(await screen.findByText("Converted to 1 shape.")).toBeTruthy();
  });

  it("says what was left out and what was made simpler", async () => {
    const pattern = '<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs>';
    uploads({ logo: svg(`${pattern}<rect width="50" height="50"/><rect width="9" height="9" fill="url(#p)"/><g filter="url(#f)"><rect x="60" width="9" height="9"/></g>`) });
    open([picture()]);
    expect(await convertToShapes("pic")).toBe(true);
    expect(
      await screen.findByText(
        "Converted to 2 shapes. 1 part could not be converted and was left out. 1 part was made simpler: clipping, masks, effects and patterns are not kept.",
      ),
    ).toBeTruthy();
  });

  it("counts several parts in the plural", async () => {
    const pattern = '<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs>';
    const lost = '<rect width="9" height="9" fill="url(#p)"/>';
    const simpler = '<g mask="url(#m)"><rect x="60" width="9" height="9"/></g>';
    uploads({ logo: svg(`${pattern}${lost}${lost}${simpler}${simpler}`) });
    open([picture()]);
    expect(await convertToShapes("pic")).toBe(true);
    expect(
      await screen.findByText(
        "Converted to 2 shapes. 2 parts could not be converted and were left out. 2 parts were made simpler: clipping, masks, effects and patterns are not kept.",
      ),
    ).toBeTruthy();
  });

  it("leaves a photo as it is and says why", async () => {
    uploads({ logo: "photo" });
    open([picture()]);
    const before = s().design;
    expect(await convertToShapes("pic")).toBe(false);
    expect(s().design).toBe(before);
    expect(await screen.findByText("Only a picture that is an SVG drawing can be converted to shapes. This one is made of pixels.")).toBeTruthy();
  });

  it("says the same for a picture whose file is no longer in the library", async () => {
    uploads({});
    open([picture()]);
    expect(await convertToShapes("pic")).toBe(false);
    expect(await screen.findByText("Only a picture that is an SVG drawing can be converted to shapes. This one is made of pixels.")).toBeTruthy();
  });

  it("says so when the file cannot be read", async () => {
    vi.mocked(getAsset).mockRejectedValueOnce(new Error("no database"));
    open([picture()]);
    const before = s().design;
    expect(await convertToShapes("pic")).toBe(false);
    expect(s().design).toBe(before);
    expect(await screen.findByText("The picture could not be read, so nothing was changed. Try again.")).toBeTruthy();
  });

  it("changes nothing for a drawing over the limit, and says what the limit is", async () => {
    uploads({ logo: svg(Array.from({ length: MAX_SHAPES + 1 }, (_unused, i) => `<rect x="${i}" width="1" height="1"/>`).join("")) });
    open([picture()]);
    const before = s().design;
    expect(await convertToShapes("pic")).toBe(false);
    expect(s().design).toBe(before);
    expect(await screen.findByText("This drawing is too large to convert: it has more than 500 shapes or 20,000 points. Nothing was changed.")).toBeTruthy();
  });

  it("leaves the picture as it is when nothing in the drawing could be converted", async () => {
    uploads({ logo: svg('<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs><rect width="9" height="9" fill="url(#p)"/>') });
    open([picture()]);
    const before = s().design;
    expect(await convertToShapes("pic")).toBe(false);
    expect(s().design).toBe(before);
    expect(await screen.findByText("Nothing in this drawing could be converted to shapes, so it stays a picture.")).toBeTruthy();
  });

  it("says so for markup that is more than plain drawing, and for markup that cannot be read", async () => {
    uploads({ logo: '<svg xmlns="http://www.w3.org/2000/svg"><text>Hello</text></svg>' });
    open([picture()]);
    expect(await convertToShapes("pic")).toBe(false);
    expect(await screen.findByText("This drawing has parts that cannot become shapes (text, pictures or styles), so it stays as it is.")).toBeTruthy();
    // a picture without a size has no box to lay the drawing over
    uploads({ logo: TWO });
    open([picture("pic", { width: 0 })]);
    expect(await convertToShapes("pic")).toBe(false);
    expect(await screen.findByText("The drawing could not be read, so nothing was changed.")).toBeTruthy();
  });

  it("leaves the page as the person made it when the picture was changed while the file was read", async () => {
    open([picture()]);
    const job = convertToShapes("pic");
    s().actions.updateElements(["pic"], { x: 300 });
    expect(await job).toBe(false);
    expect(page().elements[0]).toMatchObject({ id: "pic", type: "image", x: 300 });
    expect(await screen.findByText("The picture changed in the meantime, so nothing was changed.")).toBeTruthy();
  });

  it("asks for a picture inside a group to be taken out first", async () => {
    open([createGroup([picture()], { id: "g" })]);
    const before = s().design;
    expect(await convertToShapes("pic")).toBe(false);
    expect(s().design).toBe(before);
    expect(await screen.findByText("Take it out of its group first: inside a group it cannot be converted to shapes.")).toBeTruthy();
  });

  it("does nothing for what it is not offered for", async () => {
    open([picture("locked", { locked: true }), picture("web", { src: "builtin:photo-1" }), picture("frame", { src: null }), createShape("rect", { id: "shape" })]);
    const before = s().design;
    for (const id of ["locked", "web", "frame", "shape", "nope"]) expect(await convertToShapes(id)).toBe(false);
    expect(s().design).toBe(before);
    expect(getAsset).not.toHaveBeenCalled();
    resetEditor();
    expect(await convertToShapes("pic")).toBe(false);
  });
});

describe("converting a graphic", () => {
  it("makes shapes of an illustration with the colours it has in the editor, without asking the library", async () => {
    open([createGraphic({ id: "art", svg: TWO, x: 0, y: 0, width: 100, height: 100, colors: { "#ff0000": "#00ff00" } })]);
    expect(await convertToShapes("art")).toBe(true);
    const group = page().elements[0] as GroupElement;
    expect((group.children[0] as ShapeElement).fill).toEqual({ type: "solid", color: "#00ff00" });
    expect(getAsset).not.toHaveBeenCalled();
  });

  it("says so for a graphic that is more than plain drawing", async () => {
    open([createGraphic({ id: "emoji", svg: '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><text>x</text></svg>' })]);
    expect(await convertToShapes("emoji")).toBe(false);
    expect(await screen.findByText("This drawing has parts that cannot become shapes (text, pictures or styles), so it stays as it is.")).toBeTruthy();
  });
});

describe("converting a text (text to points)", () => {
  const letters = (n: number): GroupElement =>
    createGroup(
      Array.from({ length: n }, (_unused, i) => createShape("path", { id: `l${i}`, x: i * 20, y: 0, width: 18, height: 30, path: "M0 0L100 0L100 100Z" })),
      { id: "letters", x: 110, y: 210, width: n * 20, height: 30 },
    );
  const outcome = (over: Partial<TextShapes>): TextShapes => ({ element: null, count: 0, missing: 0, effectDropped: false, problem: null, noFont: [], ...over });
  const words = (id = "words", over: Parameters<typeof createText>[0] = {}) => createText({ id, text: "Hello", x: 100, y: 200, ...over });

  it("puts the letters where the text was, selects them, says what happened, and is one step to undo", async () => {
    vi.mocked(textToShapes).mockResolvedValue(outcome({ element: letters(5), count: 5 }));
    open([createShape("rect", { id: "below" }), words(), createShape("rect", { id: "above" })]);
    expect(await convertToShapes("words")).toBe(true);
    const [below, group, above] = page().elements;
    // the store places a copy with ids of its own, so the group is known by what it is, not by the id it was made with
    expect([below.id, group.type, (group as GroupElement).children.length, above.id]).toEqual(["below", "group", 5, "above"]);
    expect(s().selection).toEqual([group.id]);
    expect(await screen.findByText("Converted to 5 shapes. The text can no longer be edited as text; Undo brings it back.")).toBeTruthy();
    expect(s().past).toHaveLength(1);
    s().actions.undo();
    expect(page().elements.map((e) => e.id)).toEqual(["below", "words", "above"]);
  });

  it("says what was left out: letters the font does not have, and an effect", async () => {
    vi.mocked(textToShapes).mockResolvedValue(outcome({ element: letters(3), count: 3, missing: 2, effectDropped: true }));
    open([words()]);
    expect(await convertToShapes("words")).toBe(true);
    expect(
      await screen.findByText(
        "Converted to 3 shapes. The text can no longer be edited as text; Undo brings it back. 2 letters are not in the font and were left out. The text effect is not kept.",
      ),
    ).toBeTruthy();
  });

  it.each<[string, Partial<TextShapes>, string]>([
    ["curved text", { problem: "curved" }, "Curved text cannot be converted to shapes yet. Set Curve to 0 first, then convert."],
    [
      "a font with no file",
      { problem: "no-font", noFont: ["Comic Sans MS"] },
      'Craftly does not have the font file of "Comic Sans MS", so the letters cannot be converted. Choose a font from the list, or upload this one under Brand kit > Your fonts.',
    ],
    [
      "too many letters",
      { problem: "too-large" },
      `This text is too long to convert: it has more than ${MAX_SHAPES.toLocaleString("en-US")} letters or 20,000 points. Nothing was changed.`,
    ],
    ["only spaces", { problem: "empty" }, "This text has no letters to convert, so it stays as it is."],
  ])("leaves the text as it is and says why, for %s", async (_what, made, message) => {
    vi.mocked(textToShapes).mockResolvedValue(outcome(made));
    open([words()]);
    expect(await convertToShapes("words")).toBe(false);
    expect(await screen.findByText(message)).toBeTruthy();
    expect(page().elements[0].id).toBe("words");
    expect(s().past).toHaveLength(0);
  });

  it("changes nothing when a font file cannot be read", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(textToShapes).mockRejectedValue(new Error("offline"));
    open([words()]);
    expect(await convertToShapes("words")).toBe(false);
    expect(await screen.findByText("The font could not be read, so nothing was changed. Try again.")).toBeTruthy();
    expect(page().elements[0].id).toBe("words");
  });

  it("changes nothing when the text was edited while its fonts were read: what the person did wins", async () => {
    let finish!: (made: TextShapes) => void;
    vi.mocked(textToShapes).mockReturnValue(new Promise((resolve) => (finish = resolve)));
    open([words()]);
    const converting = convertToShapes("words");
    s().actions.updateElements(["words"], { x: 300 });
    finish(outcome({ element: letters(5), count: 5 }));
    expect(await converting).toBe(false);
    expect(await screen.findByText("The text changed in the meantime, so nothing was changed.")).toBeTruthy();
    expect(page().elements[0]).toMatchObject({ id: "words", x: 300 });
  });
});

describe("where it is offered", () => {
  it("knows what it can work on: a graphic, an uploaded picture or a text that is not locked", () => {
    expect(canConvertToShapes(createGraphic({ svg: TWO }))).toBe(true);
    expect(canConvertToShapes(picture())).toBe(true);
    expect(canConvertToShapes(createText({ text: "Hi" }))).toBe(true);
    expect(canConvertToShapes(createText({ text: "Hi", locked: true }))).toBe(false);
    expect(canConvertToShapes(picture("p", { locked: true }))).toBe(false);
    expect(canConvertToShapes(picture("p", { src: "builtin:photo-1" }))).toBe(false);
    expect(canConvertToShapes(picture("p", { src: null }))).toBe(false);
    expect(canConvertToShapes(createShape("rect"))).toBe(false);
    expect(canConvertToShapes(null)).toBe(false);
  });

  const item = (items: MenuEntry[]) => items.find((i): i is MenuItemEntry => (i.type === undefined || i.type === "item") && i.label === "Convert to shapes");
  const menuFor = (elements: DesignElement[], selection: string[]) => {
    open(elements);
    s().actions.select(selection);
    return buildContextMenuItems(s() as EditorState);
  };

  it("is in the menu of one graphic and of one uploaded picture, and runs from there", async () => {
    expect(item(menuFor([createGraphic({ id: "art", svg: TWO })], ["art"]))).toMatchObject({ id: "convert-to-shapes", disabled: false });
    const entry = item(menuFor([picture()], ["pic"]));
    expect(entry).toMatchObject({ disabled: false });
    expect(entry?.icon).toBeTruthy();
    entry?.onSelect?.();
    expect(await screen.findByText("Converted to 2 shapes.")).toBeTruthy();
    expect(page().elements[0].type).toBe("group");
  });

  it("is in the menu of one text box", () => {
    expect(item(menuFor([createText({ id: "t", text: "Hi" })], ["t"]))).toMatchObject({ id: "convert-to-shapes", disabled: false });
  });

  it("is switched off for a locked one, and not there for anything else", () => {
    expect(item(menuFor([picture("pic", { locked: true })], ["pic"]))).toMatchObject({ disabled: true });
    expect(item(menuFor([picture("pic", { src: "builtin:photo-1" })], ["pic"]))).toBeUndefined();
    expect(item(menuFor([createShape("rect", { id: "a" })], ["a"]))).toBeUndefined();
    expect(item(menuFor([picture("a"), picture("b")], ["a", "b"]))).toBeUndefined();
  });
});
