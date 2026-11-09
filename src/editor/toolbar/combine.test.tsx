/**
 * Combining shapes and turning shapes into paths, as the person at the editor meets them: what happens to the page, to the
 * selection and to undo, what they are told when there is nothing to do, and the menu that offers it all.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { combineShapes, shapeAsPath } from "@/core/combine";
import { createDesign, createGroup, createPage, createShape, createText, solid } from "@/core/factory";
import { parsePath } from "@/core/pen";
import { getActivePage, useEditor } from "@/core/store";
import type { DesignElement, ShapeElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { clearToasts } from "@/test/tabsHarness";
import { ToastHost, type MenuItemEntry } from "@/ui";
import { canConvertToPath, combineElements, combineMenuItems, convertToPath } from "./combine";

// the real geometry, wrapped so that a test can make it fail once
vi.mock("@/core/combine", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/combine")>();
  return { ...actual, combineShapes: vi.fn(actual.combineShapes), shapeAsPath: vi.fn(actual.shapeAsPath) };
});

const s = () => useEditor.getState();
const a = () => s().actions;
const page = () => getActivePage(s())!;
const ids = () => page().elements.map((e) => e.id);
const el = (id: string) => page().elements.find((e) => e.id === id) as ShapeElement;
const square = (id: string, x: number, y: number, size = 100, over: Partial<ShapeElement> = {}) => createShape("rect", { id, x, y, width: size, height: size, ...over });

function open(elements: DesignElement[]) {
  resetEditor();
  a().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements })] }));
}

beforeEach(() => {
  clearToasts();
  vi.mocked(combineShapes).mockClear();
  vi.mocked(shapeAsPath).mockClear();
});

describe("combining shapes", () => {
  // a and b overlap in a square of 50; c is far away
  beforeEach(() => open([square("a", 0, 0), square("b", 50, 50), square("c", 400, 0)]));

  it("replaces the shapes with one path where the front one was, selects it, and is one step to undo", async () => {
    a().select(["a", "b"]);
    expect(await combineElements("union", ["a", "b"])).toBe(true);
    expect(page().elements).toHaveLength(2);
    const made = page().elements[0] as ShapeElement;
    expect(made).toMatchObject({ type: "shape", shape: "path", x: 0, y: 0, width: 150, height: 150 });
    expect(parsePath(made.path!)).not.toBeNull(); // one piece, so Edit points works on it
    expect(ids()[1]).toBe("c");
    expect(s().selection).toEqual([made.id]);
    expect(s().past).toHaveLength(1);
    a().undo();
    expect(ids()).toEqual(["a", "b", "c"]);
  });

  it("takes the look of the shape behind, whatever the order the shapes were named in", async () => {
    open([square("a", 0, 0, 100, { fill: solid("#ff0000") }), square("m", 300, 0), square("b", 50, 50, 100, { fill: solid("#0000ff") })]);
    expect(await combineElements("subtract", ["b", "a"])).toBe(true);
    const made = page().elements[1] as ShapeElement;
    expect(ids()).toEqual(["m", made.id]);
    expect(made.fill).toEqual(solid("#ff0000"));
    expect(made).toMatchObject({ x: 0, y: 0, width: 100, height: 100 }); // a with b cut out of it
  });

  it("tells the person when nothing is left, and changes nothing", async () => {
    render(<ToastHost />);
    const before = s().design;
    expect(await combineElements("intersect", ["a", "c"])).toBe(false);
    expect(await screen.findByText("These shapes do not overlap, so there is nothing to keep.")).toBeTruthy();
    expect(s().design).toBe(before);
  });

  it("says what is left of nothing for each way of combining", async () => {
    render(<ToastHost />);
    open([square("a", 0, 0), square("b", 0, 0)]);
    expect(await combineElements("subtract", ["a", "b"])).toBe(false);
    expect(await screen.findByText("Nothing is left of the shape behind once the others are cut out of it.")).toBeTruthy();
    expect(await combineElements("exclude", ["a", "b"])).toBe(false);
    expect(await screen.findByText("Nothing is left: the shapes cover exactly the same area.")).toBeTruthy();
  });

  it("does nothing, and does not even start, for a selection that cannot be combined", async () => {
    open([square("a", 0, 0), createText({ id: "t" }), square("lock", 200, 0, 100, { locked: true })]);
    const before = s().design;
    for (const selection of [[], ["a"], ["a", "t"], ["a", "lock"], ["a", "nope"]]) expect(await combineElements("union", selection)).toBe(false);
    expect(combineShapes).not.toHaveBeenCalled();
    expect(s().design).toBe(before);
  });

  it("leaves the page as the person made it when the shapes were changed while the job ran", async () => {
    render(<ToastHost />);
    const job = combineElements("union", ["a", "b"]);
    a().updateElements(["b"], { x: 80 }); // the job is waiting for the geometry library
    expect(await job).toBe(false);
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(el("b").x).toBe(80);
    expect(await screen.findByText("The shapes changed in the meantime, so nothing was changed.")).toBeTruthy();
  });

  it("gives up, and says so, when the page of the shapes was deleted while the geometry was loading", async () => {
    render(<ToastHost />);
    const job = combineElements("union", ["a", "b"]);
    a().addPage();
    a().deletePage("p1");
    expect(await job).toBe(false);
    expect(s().design!.pages).toHaveLength(1);
    expect(await screen.findByText("The shapes changed in the meantime, so nothing was changed.")).toBeTruthy();
  });

  it("finishes on the page the shapes are on when the person has turned to another page meanwhile", async () => {
    const job = combineElements("union", ["a", "b"]);
    const other = a().addPage();
    expect(await job).toBe(true);
    expect(s().activePageId).toBe(other);
    expect(s().selection).toEqual([]);
    expect(s().design!.pages[0].elements.map((e) => e.type)).toEqual(["shape", "shape"]);
    expect(s().design!.pages[0].elements[0]).toMatchObject({ shape: "path" });
  });

  it("says so when the geometry cannot be loaded, and can be tried again", async () => {
    render(<ToastHost />);
    vi.mocked(combineShapes).mockRejectedValueOnce(new Error("chunk"));
    expect(await combineElements("union", ["a", "b"])).toBe(false);
    expect(await screen.findByText("The shapes could not be combined. Check your connection and try again.")).toBeTruthy();
    expect(ids()).toEqual(["a", "b", "c"]);
    expect(await combineElements("union", ["a", "b"])).toBe(true);
  });

  it("does nothing while the document is only being viewed", async () => {
    a().setMode("view");
    const before = s().design;
    expect(await combineElements("union", ["a", "b"])).toBe(false);
    expect(s().design).toBe(before);
  });
});

describe("the keyboard focus after combining", () => {
  const nextFrame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  let workspace: HTMLElement;
  beforeEach(() => {
    workspace = document.createElement("div");
    workspace.tabIndex = 0;
    workspace.setAttribute("data-cf-workspace", "");
    document.body.append(workspace);
    open([square("a", 0, 0), square("b", 50, 50)]);
  });
  afterEach(() => {
    workspace.remove();
    (document.activeElement as HTMLElement | null)?.blur();
  });

  it("goes to the canvas when the button that was used has gone with the shapes", async () => {
    expect(await combineElements("union", ["a", "b"])).toBe(true);
    await nextFrame();
    expect(document.activeElement).toBe(workspace);
  });

  it("stays where the person has put it in the meantime", async () => {
    const field = document.createElement("input");
    document.body.append(field);
    expect(await combineElements("union", ["a", "b"])).toBe(true);
    field.focus();
    await nextFrame();
    expect(document.activeElement).toBe(field);
    field.remove();
  });

  it("is not moved when nothing was combined", async () => {
    expect(await combineElements("intersect", ["a", "nope"])).toBe(false);
    await nextFrame();
    expect(document.activeElement).toBe(document.body);
  });
});

describe("with no design open", () => {
  it("there is nothing to combine or to convert", async () => {
    resetEditor();
    expect(await combineElements("union", ["a", "b"])).toBe(false);
    expect(await convertToPath(["a"])).toBe(false);
    expect(combineMenuItems(null, ["a", "b"]).every((item) => item.type !== "divider" && item.type !== "label" && item.disabled)).toBe(true);
    expect(canConvertToPath(null, ["a"])).toBe(false);
  });
});

describe("the Combine menu", () => {
  const items = (selection: string[]) => combineMenuItems(page(), selection) as MenuItemEntry[];
  beforeEach(() => open([square("a", 0, 0), square("b", 50, 50), createText({ id: "t" })]));

  it("offers the four ways, each with a few words on what it does", () => {
    expect(items(["a", "b"]).map((i) => [i.label, i.hint])).toEqual([
      ["Union", "Join into one"],
      ["Subtract", "Cut out the front"],
      ["Intersect", "Keep the overlap"],
      ["Exclude", "Remove the overlap"],
    ]);
    expect(items(["a", "b"]).every((i) => !i.disabled && i.icon)).toBe(true);
  });

  it("runs the way that is chosen", async () => {
    items(["a", "b"])[1].onSelect!();
    await waitFor(() => expect(page().elements).toHaveLength(2));
    expect(page().elements[0]).toMatchObject({ shape: "path", x: 0, y: 0, width: 100, height: 100 });
  });

  it("is switched off when the selection cannot be combined", () => {
    for (const selection of [["a"], ["a", "t"], []]) expect(items(selection).every((i) => i.disabled)).toBe(true);
  });
});

describe("converting shapes to paths", () => {
  beforeEach(() =>
    open([
      createShape("ellipse", { id: "e", x: 10, y: 20, width: 200, height: 100, rotation: 20, fill: solid("#00ff00") }),
      square("r", 300, 0, 100, { radius: 20 }),
      square("p", 500, 0, 100, { shape: "path", path: "M0 0 L100 0 L100 100 Z" } as Partial<ShapeElement>),
      square("lock", 700, 0, 100, { locked: true }),
      createText({ id: "t" }),
    ]),
  );

  it("writes each selected shape as a path where it is: same id, box, turn and look, one step to undo", async () => {
    a().select(["e", "r"]);
    expect(await convertToPath(["e", "r"])).toBe(true);
    expect(el("e")).toMatchObject({ shape: "path", x: 10, y: 20, width: 200, height: 100, rotation: 20, fill: solid("#00ff00"), radius: 0 });
    expect(parsePath(el("e").path!)!.nodes).toHaveLength(4);
    expect(el("r")).toMatchObject({ shape: "path", radius: 0 });
    expect(parsePath(el("r").path!)!.nodes.length).toBeGreaterThanOrEqual(8); // the rounded corners are curves now
    expect(s().selection).toEqual(["e", "r"]);
    expect(s().past).toHaveLength(1);
    a().undo();
    expect([el("e").shape, el("r").shape]).toEqual(["ellipse", "rect"]);
    expect(el("r").radius).toBe(20);
  });

  it("converts a shape inside a group too", async () => {
    open([createGroup([square("in", 0, 0, 50)], { id: "g" })]);
    expect(await convertToPath(["in"])).toBe(true);
    const group = page().elements[0];
    expect(group.type === "group" && group.children[0]).toMatchObject({ id: "in", shape: "path" });
  });

  it("knows what it can convert: shapes that are not paths yet and not locked", () => {
    expect(canConvertToPath(page(), ["e"])).toBe(true);
    expect(canConvertToPath(page(), ["p", "lock", "t", "nope"])).toBe(false);
    expect(canConvertToPath(page(), ["p", "r"])).toBe(true);
    expect(canConvertToPath(page(), [])).toBe(false);
  });

  it("leaves paths, locked shapes and other elements alone, and does not even start for them", async () => {
    const before = s().design;
    expect(await convertToPath(["p", "lock", "t", "nope"])).toBe(false);
    expect(shapeAsPath).not.toHaveBeenCalled();
    expect(s().design).toBe(before);
  });

  it("converts the ones it can when the selection holds others as well", async () => {
    expect(await convertToPath(["e", "p", "t"])).toBe(true);
    expect(shapeAsPath).toHaveBeenCalledTimes(1);
    expect(el("e").shape).toBe("path");
  });

  it("leaves the page as the person made it when a shape was changed while the job ran", async () => {
    render(<ToastHost />);
    const job = convertToPath(["e", "r"]);
    a().updateElements(["r"], { width: 150 });
    expect(await job).toBe(false);
    expect([el("e").shape, el("r").shape]).toEqual(["ellipse", "rect"]);
    expect(await screen.findByText("The shapes changed in the meantime, so nothing was changed.")).toBeTruthy();
  });

  it("says so when the geometry cannot be loaded", async () => {
    render(<ToastHost />);
    vi.mocked(shapeAsPath).mockRejectedValueOnce(new Error("chunk"));
    expect(await convertToPath(["e"])).toBe(false);
    expect(await screen.findByText("The shapes could not be converted to paths. Check your connection and try again.")).toBeTruthy();
    expect(el("e").shape).toBe("ellipse");
  });

  it("converts the shapes that have an outline and leaves the one that has none", async () => {
    open([createShape("ellipse", { id: "e", x: 0, y: 0, width: 100, height: 50 }), square("flat", 300, 0, 0)]);
    expect(await convertToPath(["e", "flat"])).toBe(true);
    expect([el("e").shape, el("flat").shape]).toEqual(["path", "rect"]);
  });

  it("says that nothing came of it for a shape that has no outline", async () => {
    render(<ToastHost />);
    open([square("flat", 0, 0, 0)]);
    expect(await convertToPath(["flat"])).toBe(false);
    expect(await screen.findByText("These shapes have no outline to convert.")).toBeTruthy();
  });
});
