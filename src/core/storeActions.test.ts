import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createGroup, createImage, createLine, createPage, createShape, createTable, createText, createVideo, solid } from "./factory";
import { getActions, getActivePage, getSelectedElements, pageOf, useEditor } from "./store";
import type { DesignElement, GroupElement, ImageElement, TextElement, VideoElement } from "./types";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const page = () => pageOf(s().design, s().activePageId)!;
const el = (id: string) => page().elements.find((e) => e.id === id)!;
const rect = (id: string, x = 0, y = 0, w = 100, h = 50, over: Partial<DesignElement> = {}) => createShape("rect", { id, x, y, width: w, height: h, ...over });

function open(elements: DesignElement[] = [rect("r1", 100, 100), rect("r2", 400, 100)], size = { width: 1000, height: 600 }) {
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(createDesign({ ...size, pages: [createPage({ id: "p1", elements })] }));
}

beforeEach(() => open());

describe("the document", () => {
  it("opens a design on a clean slate", () => {
    expect(s().saveState).toBe("saved");
    expect(s().activePageId).toBe("p1");
    expect(s().past).toEqual([]);
    expect(s().zoomMode).toBe("fit");
    expect(s().zoom).toBeCloseTo(0.856);
  });

  it("closes the design and forgets its history and selection", () => {
    a().select(["r1"]);
    a().updateElements(["r1"], { x: 5 });
    a().closeDesign();
    expect(s().design).toBeNull();
    expect(s().selection).toEqual([]);
    expect(s().past).toEqual([]);
    expect(s().canUndo).toBe(false);
    expect(s().canRedo).toBe(false);
    expect(getActivePage(s())).toBeNull();
  });

  it("renames the design, with an undo step, and falls back to the default for a blank title", () => {
    a().setTitle("  My poster  ");
    expect(s().design!.title).toBe("My poster");
    expect(s().saveState).toBe("unsaved");
    expect(s().canUndo).toBe(true);
    a().setTitle("   ");
    expect(s().design!.title).toBe("Untitled design");
    a().undo();
    expect(s().design!.title).toBe("My poster");
  });

  it("changes the library data kept on the document", () => {
    a().updateMeta({ starred: true, folderId: "f1", trashedAt: 123 });
    expect(s().design).toMatchObject({ starred: true, folderId: "f1", trashedAt: 123 });
    expect(s().canUndo).toBe(true);
  });

  it("does nothing when there is no design", () => {
    a().closeDesign();
    a().setTitle("x");
    a().updateMeta({ starred: true });
    a().resizeDesign(100, 100, false);
    expect(s().design).toBeNull();
    expect(s().docVersion).toBeGreaterThan(0);
  });

  it("counts every change of the document", () => {
    const before = s().docVersion;
    a().updateElements(["r1"], { x: 1 });
    a().updateElements(["r1"], { x: 2 });
    expect(s().docVersion).toBe(before + 2);
    a().updateElements(["r1"], { x: 2 });
    expect(s().docVersion).toBe(before + 2);
  });

  describe("resizing", () => {
    it("rounds the size, keeps it at least 16 px, marks the design custom and refits the zoom", () => {
      a().resizeDesign(500.4, 8, false, "mm");
      expect(s().design).toMatchObject({ width: 500, height: 16, typeId: "custom", unit: "mm" });
      expect(el("r1").x).toBe(100);
      expect(s().zoom).toBeCloseTo(856 / 500);
    });

    it("keeps the unit when none is given and scales the content when asked", () => {
      a().resizeDesign(2000, 1200, true);
      expect(s().design!.unit).toBe("px");
      expect(el("r1")).toMatchObject({ x: 200, width: 200 });
    });

    it("leaves a zoom the user chose alone", () => {
      a().setZoom(2);
      a().resizeDesign(500, 500, false);
      expect(s().zoom).toBe(2);
    });
  });

  describe("replacing the content (restoring a version)", () => {
    it("swaps the pages and size, selects nothing and can be undone", () => {
      const other = createDesign({ width: 300, height: 200, pages: [createPage({ id: "old-1" }), createPage({ id: "old-2" })] });
      a().select(["r1"]);
      a().replaceDesign(other);
      expect(s().design!.pages.map((p) => p.id)).toEqual(["old-1", "old-2"]);
      expect([s().design!.width, s().design!.height]).toEqual([300, 200]);
      expect(s().design!.id).not.toBe(other.id);
      expect(s().activePageId).toBe("old-1");
      expect(s().selection).toEqual([]);
      a().undo();
      expect(s().design!.pages.map((p) => p.id)).toEqual(["p1"]);
    });
  });
});

describe("pages", () => {
  it("switches pages, clearing what belonged to the old one", () => {
    const second = a().addPage();
    a().setActivePage("p1");
    a().select(["r1"]);
    a().setHover("r1");
    a().startTextEdit("r1");
    a().setActivePage(second);
    expect(s().activePageId).toBe(second);
    expect(s()).toMatchObject({ selection: [], hoverId: null, editingTextId: null, croppingId: null, focusGroupId: null });
  });

  it("ignores switching to the page it is on or to one that does not exist", () => {
    a().select(["r1"]);
    a().setActivePage("p1");
    a().setActivePage("nope");
    expect(s().selection).toEqual(["r1"]);
    expect(s().activePageId).toBe("p1");
  });

  it("adds a blank page after the current one and goes to it", () => {
    const id = a().addPage();
    expect(s().design!.pages.map((p) => p.id)).toEqual(["p1", id]);
    expect(s().activePageId).toBe(id);
    expect(page().elements).toEqual([]);
  });

  it("adds a page at a chosen place, or a copy of a page with new ids", () => {
    const first = a().addPage();
    const template = createPage({ id: "tpl", elements: [rect("t1")] });
    const placed = a().addPage({ index: 0, page: template });
    expect(s().design!.pages.map((p) => p.id)).toEqual([placed, "p1", first]);
    expect(placed).not.toBe("tpl");
    expect(page().elements[0].id).not.toBe("t1");
  });

  it("does not add a page without a design", () => {
    a().closeDesign();
    expect(a().addPage()).toBe("");
  });

  it("duplicates a page after itself and goes to the copy", () => {
    a().select(["r1"]);
    a().duplicatePage();
    expect(s().design!.pages).toHaveLength(2);
    expect(s().activePageId).toBe(s().design!.pages[1].id);
    expect(page().elements.map((e) => e.id)).not.toContain("r1");
    expect(page().elements).toHaveLength(2);
    expect(s().selection).toEqual([]);
  });

  it("duplicates another page by id and ignores one that does not exist", () => {
    const second = a().addPage();
    a().duplicatePage("p1");
    const ids = s().design!.pages.map((p) => p.id);
    expect(ids).toHaveLength(3);
    expect([ids[0], ids[2]]).toEqual(["p1", second]);
    expect(ids[1]).not.toBe("p1");
    expect(s().activePageId).toBe(ids[1]);
    const before = s().design;
    a().duplicatePage("nope");
    expect(s().design).toBe(before);
    expect(second).toBeTruthy();
  });

  it("deletes a page that is not the current one without changing the current page", () => {
    const second = a().addPage();
    a().deletePage("p1");
    expect(s().design!.pages.map((p) => p.id)).toEqual([second]);
    expect(s().activePageId).toBe(second);
  });

  it("moves to the next page when the current one is deleted, or the previous one at the end", () => {
    const second = a().addPage();
    const third = a().addPage();
    a().setActivePage(second);
    a().deletePage();
    expect(s().activePageId).toBe(third);
    a().deletePage();
    expect(s().activePageId).toBe("p1");
  });

  it("ignores deleting a page that does not exist, or the only page", () => {
    a().addPage();
    const before = s().design;
    a().deletePage("nope");
    expect(s().design).toBe(before);
    open();
    a().deletePage();
    expect(s().design!.pages).toHaveLength(1);
  });

  it("changes a page background by id or on the current page", () => {
    const second = a().addPage();
    a().setPageBackground(solid("#ff0000"));
    a().setPageBackground(solid("#00ff00"), "p1");
    a().setPageBackground(solid("#0000ff"), "nope");
    const [one, two] = s().design!.pages;
    expect(one.background).toEqual(solid("#00ff00"));
    expect(two.id).toBe(second);
    expect(two.background).toEqual(solid("#ff0000"));
  });

  it("names pages, trimming, and clears the name when it is blank", () => {
    a().setPageName("p1", "  Cover ");
    expect(page().name).toBe("Cover");
    a().setPageName("p1", "  ");
    expect(page().name).toBeUndefined();
    const before = s().design;
    a().setPageName("nope", "x");
    expect(s().design).toBe(before);
  });

  it("keeps presenter notes and joins quick edits of the same page's notes into one undo step", () => {
    const second = a().addPage();
    a().setPageNotes("p1", "he");
    a().setPageNotes("p1", "hello");
    expect(s().past).toHaveLength(2);
    a().setPageNotes(second, "other page");
    expect(s().past).toHaveLength(3);
    expect(s().design!.pages[0].notes).toBe("hello");
    a().undo();
    expect(s().design!.pages[1].notes).toBeUndefined();
    a().undo();
    expect(s().design!.pages[0].notes).toBeUndefined();
    a().setPageNotes("nope", "x");
    expect(s().canUndo).toBe(true);
  });

  it("moves a page", () => {
    const second = a().addPage();
    a().movePage(second, 0);
    expect(s().design!.pages.map((p) => p.id)).toEqual([second, "p1"]);
  });
});

describe("page timing", () => {
  it("sets how long a page stays, between one and sixty seconds in tenths", () => {
    a().setPageDuration(7.26);
    expect(page().duration).toBe(7.3);
    a().setPageDuration(0);
    expect(page().duration).toBe(1);
    a().setPageDuration(500);
    expect(page().duration).toBe(60);
  });

  it("sets it on one page by id, or on all pages", () => {
    const second = a().addPage();
    a().setPageDuration(3, "page", "p1");
    expect(s().design!.pages.map((p) => p.duration)).toEqual([3, undefined]);
    a().setPageDuration(4, "all");
    expect(s().design!.pages.map((p) => p.duration)).toEqual([4, 4]);
    expect(second).toBeTruthy();
  });

  it("joins a drag across the duration slider into one undo step", () => {
    for (const value of [2, 3, 4, 5]) a().setPageDuration(value);
    expect(s().past).toHaveLength(1);
  });

  it("sets the transition into the current page, or into a page by id, and removes it again", () => {
    const second = a().addPage();
    a().setPageTransition({ kind: "slide", duration: 0.6, direction: "left" });
    expect(s().design!.pages[1].transition).toEqual({ kind: "slide", duration: 0.6, direction: "left" });
    a().setPageTransition({ kind: "wipe", duration: 1 }, "page", "p1");
    expect(s().design!.pages[0].transition).toEqual({ kind: "wipe", duration: 1 });
    a().setPageTransition(null, "page", "p1");
    expect(s().design!.pages[0]).not.toHaveProperty("transition");
    expect(s().design!.pages[1].id).toBe(second);
  });

  it("sets the same transition on every page but the first", () => {
    a().addPage();
    a().addPage();
    a().setPageTransition({ kind: "dissolve", duration: 0.7 }, "all");
    expect(s().design!.pages.map((p) => p.transition?.kind)).toEqual([undefined, "dissolve", "dissolve"]);
    a().setPageTransition(null, "all");
    expect(s().design!.pages.map((p) => p.transition)).toEqual([undefined, undefined, undefined]);
  });
});

describe("animation", () => {
  it("adds, changes and removes the phases of an element's animation", () => {
    const entrance = { kind: "fade", duration: 1, delay: 0 };
    a().setAnimation(["r1"], "in", entrance);
    a().setAnimation(["r1"], "loop", { kind: "spin", duration: 3, delay: 0 });
    expect(el("r1").animation).toEqual({ in: entrance, loop: { kind: "spin", duration: 3, delay: 0 } });
    expect(el("r1").animation!.in).not.toBe(entrance);
    a().setAnimation(["r1"], "in", null);
    expect(el("r1").animation).toEqual({ loop: { kind: "spin", duration: 3, delay: 0 } });
    a().setAnimation(["r1"], "loop", null);
    expect(el("r1")).not.toHaveProperty("animation");
  });

  it("leaves locked elements alone", () => {
    a().setLocked(["r1"], true);
    a().setAnimation(["r1"], "in", { kind: "fade", duration: 1, delay: 0 });
    expect(el("r1").animation).toBeUndefined();
  });

  it("changes some settings of a phase, merging a drag into one undo step", () => {
    a().setAnimation(["r1"], "in", { kind: "rise", duration: 1, delay: 0, direction: "up" });
    const steps = s().past.length;
    for (const duration of [1.1, 1.2, 1.3]) a().patchAnimation(["r1"], "in", { duration });
    expect(el("r1").animation!.in).toEqual({ kind: "rise", duration: 1.3, delay: 0, direction: "up" });
    expect(s().past).toHaveLength(steps + 1);
    a().patchAnimation(["r1"], "in", { delay: 2 });
    expect(s().past).toHaveLength(steps + 2);
  });

  it("ignores changing a phase the element does not have", () => {
    const before = s().design;
    a().patchAnimation(["r1"], "out", { duration: 3 });
    expect(s().design).toBe(before);
  });

  describe("page animation", () => {
    beforeEach(() =>
      open([
        rect("bg", 0, 0, 1000, 600),
        rect("a", 10, 10),
        rect("hidden", 10, 10, 100, 50, { hidden: true }),
        rect("locked", 10, 10, 100, 50, { locked: true }),
        rect("b", 200, 10),
      ]),
    );

    it("gives the visible elements an entrance one after the other, leaving the backdrop and locked ones", () => {
      a().setPageAnimation("rise");
      expect(el("bg").animation).toBeUndefined();
      expect(el("hidden").animation).toBeUndefined();
      expect(el("locked").animation).toBeUndefined();
      expect(el("a").animation).toEqual({ in: { kind: "rise", duration: 0.8, delay: 0, direction: "up" } });
      expect(el("b").animation!.in!.delay).toBe(0.14);
    });

    it("keeps an element's other phases when it gets an entrance", () => {
      a().setAnimation(["a"], "loop", { kind: "spin", duration: 3, delay: 0 });
      a().setPageAnimation("fade");
      expect(el("a").animation).toMatchObject({ in: { kind: "fade" }, loop: { kind: "spin" } });
    });

    it("applies to another page by id", () => {
      const second = a().addPage({ page: createPage({ elements: [rect("c", 0, 0)] }) });
      a().setActivePage("p1");
      a().setPageAnimation("pop", second);
      expect(pageOf(s().design, second)!.elements[0].animation).toMatchObject({ in: { kind: "pop" } });
      expect(el("a").animation).toBeUndefined();
    });

    it("removes the entrances again, keeping other phases and skipping locked elements", () => {
      a().setAnimation(["a"], "out", { kind: "fade", duration: 1, delay: 0 });
      a().setPageAnimation("rise");
      a().setPageAnimation(null);
      expect(el("a").animation).toEqual({ out: { kind: "fade", duration: 1, delay: 0 } });
      expect(el("b")).not.toHaveProperty("animation");
      a().setLocked(["b"], true);
      a().setPageAnimation("rise");
      expect(el("b").animation).toBeUndefined();
    });

    it("does nothing for a page that does not exist", () => {
      const before = s().design;
      a().setPageAnimation("rise", "nope");
      expect(s().design).toBe(before);
    });
  });
});

describe("template pages", () => {
  const template = () => createPage({ id: "tpl", background: solid("#112233"), elements: [rect("t1", 5, 5), createShape("star", { id: "t2" })] });

  it("replaces the content and background of the current page with fresh copies", () => {
    a().select(["r1"]);
    a().applyTemplatePage(template(), "replace");
    expect(page().id).toBe("p1");
    expect(page().background).toEqual(solid("#112233"));
    expect(page().elements).toHaveLength(2);
    expect(page().elements.map((e) => e.id)).not.toContain("t1");
    expect(s().selection).toEqual([]);
    a().undo();
    expect(page().elements.map((e) => e.id)).toEqual(["r1", "r2"]);
  });

  it("adds the template as a new page after the current one", () => {
    a().applyTemplatePage(template(), "add");
    expect(s().design!.pages).toHaveLength(2);
    expect(s().activePageId).toBe(s().design!.pages[1].id);
    expect(page().background).toEqual(solid("#112233"));
  });

  it("does nothing without a design", () => {
    a().closeDesign();
    a().applyTemplatePage(template(), "replace");
    a().applyTemplatePage(template(), "add");
    expect(s().design).toBeNull();
  });
});

describe("adding elements", () => {
  it("centres new elements on the page by default and selects them", () => {
    const [id] = a().addElements([rect("new", 0, 0, 100, 100)]);
    expect(id).not.toBe("new");
    expect(el(id)).toMatchObject({ x: 450, y: 250 });
    expect(s().selection).toEqual([id]);
  });

  it("keeps the position of elements when asked not to centre them", () => {
    const [id] = a().addElements([rect("new", 30, 40)], { center: false });
    expect(el(id)).toMatchObject({ x: 30, y: 40 });
  });

  it("centres the group of new elements on a point", () => {
    const [i1, i2] = a().addElements([rect("n1", 0, 0, 100, 100), rect("n2", 100, 0, 100, 100)], { at: { x: 500, y: 300 } });
    expect(el(i1)).toMatchObject({ x: 400, y: 250 });
    expect(el(i2)).toMatchObject({ x: 500, y: 250 });
  });

  it("can leave the selection alone", () => {
    a().select(["r1"]);
    a().addElements([rect("n1")], { select: false });
    expect(s().selection).toEqual(["r1"]);
  });

  it("can add to another page, which then becomes the current one", () => {
    const second = a().addPage();
    a().setActivePage("p1");
    const [id] = a().addElements([rect("n1")], { pageId: second });
    expect(s().activePageId).toBe(second);
    expect(page().elements.map((e) => e.id)).toEqual([id]);
  });

  it("measures new text boxes", () => {
    const text = createText({ text: "Hello", fontSize: 40, id: "tx", x: 0, y: 0 });
    text.width = 1;
    text.height = 1;
    const [id] = a().addElements([text], { center: false });
    expect(el(id)).toMatchObject({ width: Math.ceil(5 * 40 * 0.55), height: 50 });
  });

  it("copies what it is given, so the caller's elements are not shared", () => {
    const source = rect("src", 0, 0);
    const [id] = a().addElements([source]);
    expect(el(id)).not.toBe(source);
    expect(source.x).toBe(0);
  });

  it("adds nothing for an empty list or without a design, and addElement says so with an empty id", () => {
    expect(a().addElements([])).toEqual([]);
    a().closeDesign();
    expect(a().addElements([rect("x")])).toEqual([]);
    expect(a().addElement(rect("x"))).toBe("");
  });
});

describe("editing elements", () => {
  it("updates the elements of the selection", () => {
    a().select(["r1", "r2"]);
    a().updateSelection({ opacity: 0.5 });
    expect([el("r1").opacity, el("r2").opacity]).toEqual([0.5, 0.5]);
    a().updateSelection((e) => {
      e.y = 7;
    });
    expect([el("r1").y, el("r2").y]).toEqual([7, 7]);
  });

  it("deletes the given elements, or the selection, and drops them from the selection", () => {
    a().select(["r1", "r2"]);
    a().deleteElements(["r1"]);
    expect(page().elements.map((e) => e.id)).toEqual(["r2"]);
    expect(s().selection).toEqual(["r2"]);
    a().deleteElements();
    expect(page().elements).toEqual([]);
    expect(s().selection).toEqual([]);
  });

  it("stops editing or cropping an element that is deleted", () => {
    open([createText({ id: "t", text: "x" }), createImage({ id: "im", src: "a.png" })]);
    a().startTextEdit("t");
    a().deleteElements(["t"]);
    expect(s().editingTextId).toBeNull();
    a().startCrop("im");
    a().deleteElements(["im"]);
    expect(s().croppingId).toBeNull();
  });

  it("does nothing when there is nothing to delete", () => {
    const before = s().design;
    a().deleteElements();
    a().deleteElements([]);
    expect(s().design).toBe(before);
  });

  it("duplicates the selection above the originals and selects the copies", () => {
    a().select(["r1"]);
    a().duplicateSelection();
    expect(page().elements).toHaveLength(3);
    expect(s().selection).toHaveLength(1);
    expect(s().selection[0]).not.toBe("r1");
    expect(el(s().selection[0])).toMatchObject({ x: 124, y: 124 });
    const before = s().design;
    a().clearSelection();
    a().duplicateSelection();
    expect(s().design).toBe(before);
  });

  it("groups two or more elements, and needs at least two", () => {
    a().select(["r1"]);
    a().groupSelection();
    expect(page().elements).toHaveLength(2);
    a().select(["r1", "r2"]);
    a().groupSelection();
    expect(page().elements).toHaveLength(1);
    expect(s().selection).toEqual([page().elements[0].id]);
  });

  it("leaves the selection alone when the elements to group do not share a parent", () => {
    open([createGroup([rect("in", 0, 0)], { id: "g" }), rect("out", 300, 0)]);
    a().select(["in", "out"]);
    a().groupSelection();
    expect(page().elements.map((e) => e.id)).toEqual(["g", "out"]);
    expect(s().selection).toEqual(["in", "out"]);
  });

  it("ungroups groups and keeps the other selected elements selected", () => {
    open([createGroup([rect("c1", 0, 0), rect("c2", 100, 0)], { id: "g", x: 50, y: 50 }), rect("solo", 400, 400)]);
    a().select(["g", "solo"]);
    a().ungroupSelection();
    expect(page().elements.map((e) => e.id)).toHaveLength(3);
    expect(page().elements.some((e) => e.type === "group")).toBe(false);
    expect(s().selection).toHaveLength(3);
    expect(s().selection).toContain("solo");
  });

  it("arranges the selection or the given elements in the stack", () => {
    a().select(["r1"]);
    a().arrange("front");
    expect(page().elements.map((e) => e.id)).toEqual(["r2", "r1"]);
    a().arrange("back", ["r1"]);
    expect(page().elements.map((e) => e.id)).toEqual(["r1", "r2"]);
    const before = s().design;
    a().clearSelection();
    a().arrange("front");
    expect(s().design).toBe(before);
  });

  it("aligns a single element to the page and several to the page or to each other", () => {
    a().select(["r1"]);
    a().align("right");
    expect(el("r1").x).toBe(900);
    a().select(["r1", "r2"]);
    a().align("left", "selection");
    expect([el("r1").x, el("r2").x]).toEqual([400, 400]);
    a().align("left");
    expect([el("r1").x, el("r2").x]).toEqual([0, 0]);
    const before = s().design;
    a().clearSelection();
    a().align("left");
    expect(s().design).toBe(before);
  });

  it("distributes three elements and flips the selection", () => {
    open([rect("a", 0, 0, 100, 50), rect("b", 150, 100, 100, 50), rect("c", 900, 200, 100, 50)]);
    a().select(["a", "b", "c"]);
    a().distribute("horizontal");
    expect(el("b").x).toBe(450);
    a().flip("horizontal");
    expect(el("a").flipH).toBe(true);
    expect(el("a").x).toBe(900);
  });

  it("locks and unlocks, hides and shows, taking hidden elements out of the selection", () => {
    a().select(["r1", "r2"]);
    a().setLocked(["r1"], true);
    expect(el("r1").locked).toBe(true);
    a().setHidden(["r2"], true);
    expect(el("r2").hidden).toBe(true);
    expect(s().selection).toEqual(["r1"]);
    a().setHidden(["r2"], false);
    expect(el("r2").hidden).toBe(false);
    expect(s().selection).toEqual(["r1"]);
  });

  it("nudges the selection, joining quick nudges into one undo step", () => {
    a().select(["r1"]);
    a().nudge(1, 0);
    a().nudge(1, 0);
    a().nudge(0, 10);
    expect(el("r1")).toMatchObject({ x: 102, y: 110 });
    expect(s().past).toHaveLength(1);
    a().clearSelection();
    a().nudge(5, 5);
    expect(el("r1").x).toBe(102);
  });

  it("moves an element to a place in the stack and renames it", () => {
    a().moveToIndex("r2", 0);
    expect(page().elements.map((e) => e.id)).toEqual(["r2", "r1"]);
    a().renameElement("r1", "  Hero  ");
    expect(el("r1").name).toBe("Hero");
    a().renameElement("r1", "   ");
    expect(el("r1").name).toBeUndefined();
  });

  describe("updating elements of another page", () => {
    beforeEach(() => {
      useEditor.setState(useEditor.getInitialState(), true);
      a().openDesign(
        createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements: [rect("r1")] }), createPage({ id: "p2", elements: [rect("far", 5, 5)] })] }),
      );
    });
    const farPage = () => pageOf(s().design, "p2")!;

    it("changes an element on a page that is not open, without opening it", () => {
      a().updateElementsOnPage("p2", ["far"], { x: 77 });
      expect((farPage().elements[0] as DesignElement).x).toBe(77);
      expect(s().activePageId).toBe("p1");
      expect(page().elements[0].x).toBe(0);
    });

    it("is one undo step", () => {
      a().updateElementsOnPage("p2", ["far"], (e) => {
        e.x = 77;
        e.y = 88;
      });
      a().undo();
      expect(farPage().elements[0]).toMatchObject({ x: 5, y: 5 });
    });

    it("ignores a page that does not exist", () => {
      const before = s().design;
      a().updateElementsOnPage("nope", ["far"], { x: 1 });
      expect(s().design).toBe(before);
    });
  });

  describe("replacing a picture", () => {
    beforeEach(() => open([createImage({ id: "im", src: "old.png", width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 }), rect("r")]));

    it("keeps the box and covers it with the new picture", () => {
      a().replaceImage("im", "new.png", 400, 400);
      const image = el("im") as ImageElement;
      expect(image).toMatchObject({ src: "new.png", naturalWidth: 400, naturalHeight: 400, width: 200, height: 100, isFrame: false });
      expect(image.crop.x).toBeCloseTo(0);
      expect(image.crop.y).toBeCloseTo(-0.5);
      expect(image.crop.w).toBeCloseTo(1);
      expect(image.crop.h).toBeCloseTo(2);
    });

    it("forgets the picture a cut-out came from, because there is no cut-out any more", () => {
      open([createImage({ id: "cut", src: "asset:cutout", originalSrc: "asset:original", width: 200, height: 100, naturalWidth: 200, naturalHeight: 100 })]);
      a().replaceImage("cut", "asset:other", 200, 100);
      expect((el("cut") as ImageElement).originalSrc).toBeUndefined();
    });

    it("keeps a frame a frame", () => {
      open([createImage({ id: "fr", src: null, width: 100, height: 100, isFrame: true })]);
      a().replaceImage("fr", "photo.png", 100, 100);
      expect((el("fr") as ImageElement).isFrame).toBe(true);
    });

    it("ignores elements that are not pictures, and unknown ones", () => {
      const before = s().design;
      a().replaceImage("r", "x.png", 10, 10);
      a().replaceImage("nope", "x.png", 10, 10);
      expect(s().design).toBe(before);
    });
  });

  describe("replacing elements with one", () => {
    beforeEach(() => open([rect("a", 0, 0), rect("b", 200, 0), rect("c", 400, 0)]));

    it("puts it where the top-most of them was, selects it and gives it an id of its own", () => {
      const id = a().replaceElements(["a", "c"], rect("made", 10, 10, 30, 30));
      expect(id).not.toBe("");
      expect(id).not.toBe("made");
      expect(page().elements.map((e) => e.id)).toEqual(["b", id]);
      expect(el(id)).toMatchObject({ x: 10, y: 10, width: 30, height: 30 });
      expect(s().selection).toEqual([id]);
      expect(s().focusGroupId).toBeNull();
    });

    it("is one step of history", () => {
      a().replaceElements(["a", "b"], rect("made"));
      expect(s().past).toHaveLength(1);
      a().undo();
      expect(page().elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
    });

    it("works on a page that is not the open one, and leaves the open page and its selection alone", () => {
      const other = a().addPage({ page: createPage({ elements: [rect("x", 0, 0), rect("y", 50, 0)] }) }); // pages get new ids when added
      const [x, y] = pageOf(s().design, other)!.elements.map((e) => e.id);
      a().setActivePage("p1");
      a().select(["b"]);
      const id = a().replaceElements([x, y], rect("made"), other);
      expect(pageOf(s().design, other)!.elements.map((e) => e.id)).toEqual([id]);
      expect(page().elements.map((e) => e.id)).toEqual(["a", "b", "c"]);
      expect(s().activePageId).toBe("p1");
      expect(s().selection).toEqual(["b"]);
    });

    it("does nothing when there is nothing to replace, an element is missing, locked or inside a group, or the page is not there", () => {
      const check = (ids: string[], pageId?: string) => {
        const before = s().design;
        expect(a().replaceElements(ids, rect("made"), pageId)).toBe("");
        expect(s().design).toBe(before);
        expect(s().past).toEqual([]);
      };
      check([]);
      check(["a", "nope"]);
      check(["a", "b"], "nope");
      open([rect("a", 0, 0, 100, 50, { locked: true }), rect("b", 200, 0)]);
      check(["a", "b"]);
      open([createGroup([rect("in", 0, 0)], { id: "g" }), rect("out", 300, 0)]);
      check(["in", "out"]);
    });

    it("does nothing while the document is only being viewed", () => {
      a().setMode("view");
      const before = s().design;
      expect(a().replaceElements(["a", "b"], rect("made"))).toBe("");
      expect(s().design).toBe(before);
    });
  });
});

describe("guides", () => {
  it("adds ruler guides, rounded to a tenth", () => {
    a().addGuide("v", 100.04);
    a().addGuide("v", 250);
    a().addGuide("h", 33.36);
    expect(s().design!.guides).toEqual({ vertical: [100, 250], horizontal: [33.4] });
  });

  it("moves a guide, ignoring an index that is out of range or a missing guide list", () => {
    a().addGuide("v", 100);
    a().moveGuide("v", 0, 120.06);
    expect(s().design!.guides!.vertical).toEqual([120.1]);
    const before = s().design;
    a().moveGuide("v", 5, 1);
    a().moveGuide("v", -1, 1);
    a().moveGuide("h", 0, 1);
    expect(s().design).toBe(before);
  });

  it("removes a guide and clears all of them", () => {
    a().addGuide("h", 10);
    a().addGuide("h", 20);
    a().addGuide("v", 5);
    a().removeGuide("h", 0);
    expect(s().design!.guides!.horizontal).toEqual([20]);
    a().clearGuides();
    expect(s().design!.guides).toEqual({ vertical: [], horizontal: [] });
  });

  it("has nothing to clear or remove before a guide was ever added", () => {
    const before = s().design;
    a().clearGuides();
    a().removeGuide("v", 0);
    expect(s().design).toBe(before);
  });
});

describe("selection", () => {
  it("selects the elements that exist on the page and ignores the rest", () => {
    a().select(["r1", "nope"]);
    expect(s().selection).toEqual(["r1"]);
    a().select(["r2"], { additive: true });
    expect(s().selection).toEqual(["r1", "r2"]);
    a().select(["r2"], { additive: true });
    expect(s().selection).toEqual(["r1", "r2"]);
    a().select([]);
    expect(s().selection).toEqual([]);
  });

  it("selects elements inside a group too", () => {
    open([createGroup([rect("in", 0, 0)], { id: "g" })]);
    a().select(["in"]);
    expect(s().selection).toEqual(["in"]);
  });

  it("keeps editing or cropping only while that one element stays the whole selection", () => {
    open([createText({ id: "t", text: "x" }), createImage({ id: "im", src: "a.png" }), rect("r")]);
    a().startTextEdit("t");
    a().select(["t"]);
    expect(s().editingTextId).toBe("t");
    a().select(["t", "r"]);
    expect(s().editingTextId).toBeNull();
    a().startCrop("im");
    a().select(["im"]);
    expect(s().croppingId).toBe("im");
    a().select(["r"]);
    expect(s().croppingId).toBeNull();
  });

  it("toggles one element in and out of the selection", () => {
    a().toggleSelect("r1");
    a().toggleSelect("r2");
    expect(s().selection).toEqual(["r1", "r2"]);
    a().toggleSelect("r1");
    expect(s().selection).toEqual(["r2"]);
  });

  it("selects every visible element of the page", () => {
    open([rect("a"), rect("b", 0, 0, 10, 10, { hidden: true }), rect("c")]);
    a().selectAll();
    expect(s().selection).toEqual(["a", "c"]);
    a().closeDesign();
    a().selectAll();
    expect(s().selection).toEqual([]);
  });

  it("clears the selection, and everything tied to it, only if there is something to clear", () => {
    a().select(["r1"]);
    a().enterGroup("g");
    a().clearSelection();
    expect(s()).toMatchObject({ selection: [], focusGroupId: null });
    a().enterGroup("g");
    a().clearSelection();
    expect(s().focusGroupId).toBe("g");
  });

  it("clears an editing session even with nothing selected", () => {
    open([createText({ id: "t", text: "x" })]);
    a().startTextEdit("t");
    useEditor.setState({ selection: [] });
    a().clearSelection();
    expect(s().editingTextId).toBeNull();
  });

  it("remembers the hovered element and the group being edited", () => {
    a().setHover("r1");
    expect(s().hoverId).toBe("r1");
    const state = s();
    a().setHover("r1");
    expect(s()).toBe(state);
    a().setHover(null);
    expect(s().hoverId).toBeNull();
    a().enterGroup("g");
    expect(s().focusGroupId).toBe("g");
    a().enterGroup(null);
    expect(s().focusGroupId).toBeNull();
  });

  it("finds the selected elements and the active page from the state", () => {
    a().select(["r2", "r1"]);
    expect(getSelectedElements(s()).map((e) => e.id)).toEqual(["r2", "r1"]);
    useEditor.setState({ selection: ["r1", "ghost"] });
    expect(getSelectedElements(s()).map((e) => e.id)).toEqual(["r1"]);
    a().clearSelection();
    expect(getSelectedElements(s())).toEqual([]);
    expect(getActivePage(s())?.id).toBe("p1");
    a().closeDesign();
    expect(getSelectedElements(s())).toEqual([]);
    expect(getActions()).toBe(s().actions);
    expect(pageOf(null, "p1")).toBeNull();
  });
});

describe("text", () => {
  it("styles the text inside a group, however deep, and skips what is not text or is locked", () => {
    open([
      createGroup([createText({ id: "t1", text: "a" }), createGroup([createText({ id: "t2", text: "b" })], { id: "inner" }), rect("shape")], { id: "g" }),
      createText({ id: "t3", text: "c", locked: true }),
      rect("plain"),
    ]);
    a().setTextProps(["g", "t3", "plain"], { color: "#ff0000", fontSize: 30 });
    const group = el("g") as GroupElement;
    expect((group.children[0] as TextElement).color).toBe("#ff0000");
    expect(((group.children[1] as GroupElement).children[0] as TextElement).fontSize).toBe(30);
    expect((el("t3") as TextElement).color).not.toBe("#ff0000");
    expect(el("plain")).not.toHaveProperty("color");
  });

  it("styles the selected text when no ids are given", () => {
    open([createText({ id: "t", text: "x" })]);
    a().select(["t"]);
    a().setTextProps(null, { align: "center" });
    expect((el("t") as TextElement).align).toBe("center");
  });

  it("rewrites the paragraphs of a text box, merging identical runs and joining quick typing into one step", () => {
    open([createText({ id: "t", text: "x", fontSize: 40 })]);
    a().setTextParagraphs("t", [{ runs: [{ text: "He" }, { text: "llo" }] }]);
    a().setTextParagraphs("t", [{ runs: [{ text: "Hello" }, { text: "" }] }]);
    expect((el("t") as TextElement).paragraphs).toEqual([{ runs: [{ text: "Hello" }] }]);
    expect(s().past).toHaveLength(1);
    expect(el("t").width).toBe(Math.ceil(5 * 40 * 0.55));
    a().setTextParagraphs("nope", [{ runs: [{ text: "x" }] }]);
    a().setTextParagraphs("t", [{ runs: [{ text: "Hi" }] }]);
    expect(s().past).toHaveLength(1);
  });

  it("ignores new paragraphs for an element that is not text", () => {
    const before = s().design;
    a().setTextParagraphs("r1", [{ runs: [{ text: "x" }] }]);
    expect(s().design).toBe(before);
  });

  describe("editing sessions", () => {
    beforeEach(() =>
      open([
        createText({ id: "t", text: "x" }),
        createText({ id: "locked", text: "y", locked: true }),
        rect("r"),
        createImage({ id: "im", src: "a.png" }),
        createImage({ id: "frame", src: null }),
      ]),
    );

    it("starts editing a text and selects it", () => {
      a().startTextEdit("t");
      expect(s()).toMatchObject({ editingTextId: "t", selection: ["t"], croppingId: null });
    });

    it("can keep another element, such as the group around the text, as the visible selection", () => {
      a().startTextEdit("t", "g");
      expect(s().selection).toEqual(["g"]);
      expect(s().editingTextId).toBe("t");
    });

    it("refuses to edit text that is locked, missing, not text, or in view mode", () => {
      a().startTextEdit("locked");
      a().startTextEdit("r");
      a().startTextEdit("nope");
      expect(s().editingTextId).toBeNull();
      a().setMode("view");
      a().startTextEdit("t");
      expect(s().editingTextId).toBeNull();
    });

    it("ends editing", () => {
      a().startTextEdit("t");
      a().endTextEdit();
      expect(s().editingTextId).toBeNull();
      const state = s();
      a().endTextEdit();
      expect(s()).toBe(state);
    });

    it("starts cropping a picture, and only a picture with an image that is not locked", () => {
      a().startCrop("im");
      expect(s()).toMatchObject({ croppingId: "im", selection: ["im"], editingTextId: null });
      a().endCrop();
      expect(s().croppingId).toBeNull();
      const state = s();
      a().endCrop();
      expect(s()).toBe(state);
      a().startCrop("frame");
      a().startCrop("r");
      a().startCrop("nope");
      expect(s().croppingId).toBeNull();
      a().setLocked(["im"], true);
      a().startCrop("im");
      expect(s().croppingId).toBeNull();
    });
  });
});

describe("clipboard", () => {
  it("copies the top-level selection and pastes it offset from the original, a little further each time", () => {
    a().select(["r1"]);
    a().copy();
    a().paste();
    a().paste();
    const pasted = page().elements.filter((e) => !["r1", "r2"].includes(e.id));
    expect(pasted.map((e) => [e.x, e.y])).toEqual([
      [124, 124],
      [148, 148],
    ]);
    expect(s().selection).toEqual([pasted[1].id]);
    expect(s().clipboard!.pasted).toBe(2);
  });

  it("pastes at a point", () => {
    a().select(["r1"]);
    a().copy();
    a().paste({ x: 600, y: 400 });
    const pasted = page().elements[2];
    expect(pasted.x + pasted.width / 2).toBe(600);
    expect(pasted.y + pasted.height / 2).toBe(400);
  });

  it("gives pasted elements new ids and unlocks them", () => {
    a().setLocked(["r1"], true);
    a().select(["r1"]);
    a().copy();
    a().paste();
    const pasted = page().elements[2];
    expect(pasted.id).not.toBe("r1");
    expect(pasted.locked).toBe(false);
  });

  it("keeps the copy as it was when the original changes afterwards", () => {
    a().select(["r1"]);
    a().copy();
    a().updateElements(["r1"], { width: 999 });
    a().paste();
    expect(page().elements[2].width).toBe(100);
  });

  it("cuts: copies and deletes", () => {
    a().select(["r1"]);
    a().cut();
    expect(page().elements.map((e) => e.id)).toEqual(["r2"]);
    a().paste();
    expect(page().elements).toHaveLength(2);
  });

  it("has nothing to copy or paste when nothing is selected or copied", () => {
    a().copy();
    expect(s().clipboard).toBeNull();
    const before = s().design;
    a().paste();
    expect(s().design).toBe(before);
    a().closeDesign();
    useEditor.setState({ clipboard: { elements: [rect("x")], pasted: 0 } });
    a().paste();
    expect(s().design).toBeNull();
  });

  it("does not copy an element and its own group twice", () => {
    open([createGroup([rect("in", 0, 0)], { id: "g" })]);
    a().select(["g", "in"]);
    a().copy();
    expect(s().clipboard!.elements).toHaveLength(1);
  });

  describe("styles", () => {
    beforeEach(() =>
      open([
        createText({ id: "t1", text: "a", color: "#ff0000", fontSize: 30, fontWeight: 700, paragraphs: [{ runs: [{ text: "a", color: "#00ff00" }] }] }),
        createText({ id: "t2", text: "b", paragraphs: [{ runs: [{ text: "b", color: "#0000ff" }] }] }),
        rect("s1", 0, 0, 10, 10, { fill: solid("#123456"), radius: 8 }),
        rect("s2", 50, 0, 10, 10),
        createGroup([rect("c")], { id: "g" }),
      ]),
    );

    it("copies the look of one text and pastes it onto others, replacing run colours", () => {
      a().select(["t1"]);
      a().copyStyle();
      a().select(["t2"]);
      a().pasteStyle();
      const t2 = el("t2") as TextElement;
      expect(t2).toMatchObject({ color: "#ff0000", fontSize: 30, fontWeight: 700 });
      expect(t2.paragraphs[0].runs[0].color).toBeUndefined();
    });

    it("copies the look of a shape", () => {
      a().select(["s1"]);
      a().copyStyle();
      a().select(["s2"]);
      a().pasteStyle();
      expect(el("s2")).toMatchObject({ fill: solid("#123456"), radius: 8 });
    });

    it("only changes elements of the kind it copied from", () => {
      a().select(["s1"]);
      a().copyStyle();
      a().select(["t2", "s2"]);
      a().pasteStyle();
      expect((el("t2") as TextElement).color).not.toBe("#123456");
      expect(el("s2")).toMatchObject({ fill: solid("#123456") });
    });

    it("copies line and picture styles too", () => {
      open([
        createLine({ id: "l1", stroke: { color: "#ff00ff", width: 3, style: "dashed" }, endArrow: "arrow" }),
        createLine({ id: "l2" }),
        createImage({ id: "i1", src: "a.png", radius: 9 }),
        createImage({ id: "i2", src: "b.png" }),
      ]);
      a().select(["l1"]);
      a().copyStyle();
      a().select(["l2"]);
      a().pasteStyle();
      expect(el("l2")).toMatchObject({ stroke: { color: "#ff00ff", width: 3, style: "dashed" }, endArrow: "arrow" });
      a().select(["i1"]);
      a().copyStyle();
      a().select(["i2"]);
      a().pasteStyle();
      expect((el("i2") as ImageElement).radius).toBe(9);
    });

    it("copies the corners, outline, speed and sound of a clip onto another clip, and nothing else of it", () => {
      const stroke = { color: "#ff00ff", width: 4, style: "dotted" as const };
      open([
        createVideo({ id: "v1", src: "asset:one", radius: 12, stroke, speed: 2, muted: true, trimStart: 1, trimEnd: 2, duration: 3 }),
        createVideo({ id: "v2", src: "asset:two", duration: 8 }),
        createImage({ id: "i1", src: "a.png" }),
      ]);
      a().select(["v1"]);
      a().copyStyle();
      expect(s().styleClipboard).toEqual({ __type: "video", radius: 12, stroke, speed: 2, muted: true });
      a().select(["v2", "i1"]);
      a().pasteStyle();
      expect(el("v2")).toMatchObject({ src: "asset:two", radius: 12, stroke, speed: 2, muted: true, trimStart: 0, trimEnd: 8 });
      // the outline is a copy, not the clip's own
      expect((el("v2") as VideoElement).stroke).not.toBe((el("v1") as VideoElement).stroke);
      expect((el("i1") as ImageElement).stroke).toBeNull();
    });

    it("copies only from a single element that has a style to copy", () => {
      a().select(["t1", "t2"]);
      a().copyStyle();
      expect(s().styleClipboard).toBeNull();
      a().select(["g"]);
      a().copyStyle();
      expect(s().styleClipboard).toBeNull();
      a().clearSelection();
      a().copyStyle();
      expect(s().styleClipboard).toBeNull();
      open([createTable({ id: "table" })]);
      a().select(["table"]);
      a().copyStyle();
      expect(s().styleClipboard).toBeNull();
    });

    it("has nothing to paste before a style was copied", () => {
      const before = s().design;
      a().select(["t2"]);
      a().pasteStyle();
      expect(s().design).toBe(before);
    });

    it("keeps the copied style as it was when its source changes", () => {
      a().select(["s1"]);
      a().copyStyle();
      a().updateElements(["s1"], { fill: solid("#000000") });
      a().select(["s2"]);
      a().pasteStyle();
      expect(el("s2")).toMatchObject({ fill: solid("#123456") });
    });
  });
});

describe("history", () => {
  it("has nothing to undo or redo at first", () => {
    const state = s();
    a().undo();
    a().redo();
    expect(s()).toBe(state);
  });

  it("undoes and redoes, moving the selection along and dropping what no longer exists", () => {
    const added = a().addElement(rect("n", 0, 0));
    expect(s().selection).toEqual([added]);
    a().undo();
    expect(s().selection).toEqual([]);
    expect(s()).toMatchObject({ canUndo: false, canRedo: true });
    a().redo();
    expect(page().elements.some((e) => e.id === added)).toBe(true);
    expect(s()).toMatchObject({ canUndo: true, canRedo: false });
  });

  it("returns to the first page when undo removes the page being edited", () => {
    const second = a().addPage();
    expect(s().activePageId).toBe(second);
    a().undo();
    expect(s().activePageId).toBe("p1");
    a().redo();
    expect(s().activePageId).toBe("p1");
    a().setActivePage(second);
    a().undo();
    expect(s().activePageId).toBe("p1");
  });

  it("does not undo or redo in the middle of a drag", () => {
    a().updateElements(["r1"], { x: 1 });
    a().undo();
    a().beginTransaction();
    a().undo();
    a().redo();
    expect(s().canRedo).toBe(true);
    expect(el("r1").x).toBe(100);
    a().endTransaction();
  });

  it("keeps at most 120 steps", () => {
    for (let i = 0; i < 130; i++) a().setTitle(`Title ${i}`);
    expect(s().past).toHaveLength(120);
    for (let i = 0; i < 130; i++) a().undo();
    expect(s().design!.title).toBe("Title 9");
    expect(s().future).toHaveLength(120);
  });

  it("makes one step of a whole drag, however deeply the begin and end calls are nested", () => {
    a().beginTransaction();
    a().beginTransaction();
    a().updateElements(["r1"], { x: 1 });
    a().endTransaction();
    expect(s().past).toHaveLength(0);
    a().updateElements(["r1"], { x: 2 });
    a().endTransaction();
    expect(s().past).toHaveLength(1);
    a().undo();
    expect(el("r1").x).toBe(100);
  });

  it("ignores an end without a begin, and a drag that changed nothing", () => {
    a().endTransaction();
    a().beginTransaction();
    a().updateElements(["r1"], { x: 100 });
    a().endTransaction();
    expect(s().past).toHaveLength(0);
  });

  it("empties the future when something new is done after an undo", () => {
    a().setTitle("one");
    a().undo();
    expect(s().canRedo).toBe(true);
    a().setTitle("two");
    expect(s()).toMatchObject({ canRedo: false, future: [] });
  });
});

describe("view", () => {
  it("zooms between 5 % and 400 % and remembers that the zoom is the user's own", () => {
    a().setZoom(2);
    expect(s()).toMatchObject({ zoom: 2, zoomMode: "custom" });
    a().setZoom(99);
    expect(s().zoom).toBe(4);
    a().setZoom(0.001, "fill");
    expect(s()).toMatchObject({ zoom: 0.05, zoomMode: "fill" });
  });

  it("zooms by a factor", () => {
    a().setZoom(1);
    a().zoomBy(1.5);
    expect(s().zoom).toBe(1.5);
    a().zoomBy(100);
    expect(s().zoom).toBe(4);
    a().zoomBy(0.0001);
    expect(s().zoom).toBe(0.05);
    expect(s().zoomMode).toBe("custom");
  });

  it("fits or fills the page to the workspace", () => {
    a().setZoomMode("fill");
    expect(s().zoom).toBeCloseTo(604 / 600);
    a().setZoomMode("fit");
    expect(s().zoom).toBeCloseTo(0.856);
    expect(s().zoomMode).toBe("fit");
    a().closeDesign();
    a().setZoomMode("fill");
    expect(s().zoomMode).toBe("fit");
  });

  it("refits when the workspace changes size, unless the zoom is custom, and ignores sub-pixel changes", () => {
    a().setViewport(1500, 900);
    expect(s().viewport).toEqual({ w: 1500, h: 900 });
    expect(s().zoom).toBeCloseTo(Math.min((1500 - 144) / 1000, (900 - 96) / 600));
    const state = s();
    a().setViewport(1500.4, 900.4);
    expect(s()).toBe(state);
    a().setZoom(2);
    a().setViewport(1000, 700);
    expect(s().zoom).toBe(2);
    a().closeDesign();
    a().setViewport(800, 600);
    expect(s().viewport).toEqual({ w: 800, h: 600 });
  });

  it("fits a page to most of the width of a phone (B13)", () => {
    open([rect("r")], { width: 1080, height: 1080 });
    // the workspace of the editor on a 375 x 812 phone
    a().setViewport(375, 552);
    const shown = s().zoom * 1080;
    expect(shown).toBeGreaterThanOrEqual(0.85 * 375);
    expect(shown).toBeLessThanOrEqual(0.9 * 375);
    // a wide screen keeps its margin of 72 px
    a().setViewport(1500, 1500);
    expect(s().zoom).toBeCloseTo((1500 - 144) / 1080);
  });

  it("never fits the page into a workspace smaller than 120 px", () => {
    a().setViewport(50, 50);
    expect(s().zoom).toBeCloseTo(0.12);
  });

  it("limits the fit zoom to a sensible range", () => {
    open([rect("r")], { width: 10, height: 10 });
    a().setViewport(1000, 700);
    expect(s().zoom).toBe(4);
    open([rect("r")], { width: 100000, height: 100000 });
    expect(s().zoom).toBe(0.05);
  });

  it("shows the snap guides it is told about, and stays quiet when there are none to clear", () => {
    const guide = { axis: "v" as const, pos: 10, from: 0, to: 100 };
    a().setGuides([guide]);
    expect(s().snapGuides).toEqual([guide]);
    a().setGuides([]);
    expect(s().snapGuides).toEqual([]);
    const state = s();
    a().setGuides([]);
    expect(s()).toBe(state);
  });

  it("toggles the view options", () => {
    const keys = ["showRulers", "snapEnabled", "showPageStrip", "gridView", "notesOpen", "panelOpen"] as const;
    for (const key of keys) {
      const before = s()[key];
      a().toggle(key);
      expect(s()[key], key).toBe(!before);
      a().toggle(key);
      expect(s()[key], key).toBe(before);
    }
  });

  it("clears the selection when the presentation starts, and keeps it when it ends", () => {
    a().select(["r1"]);
    a().setPresenting(true);
    expect(s()).toMatchObject({ presenting: true, selection: [] });
    a().select(["r1"]);
    a().setPresenting(false);
    expect(s()).toMatchObject({ presenting: false, selection: ["r1"] });
  });
});

describe("the interface around the canvas", () => {
  it("opens a tab of the left panel, closing the context panel", () => {
    a().openContext({ kind: "effects" });
    a().setLeftTab("uploads");
    expect(s()).toMatchObject({ leftTab: "uploads", context: null, panelOpen: true });
  });

  it("opens and closes the context panel", () => {
    useEditor.setState({ panelOpen: false });
    a().openContext({ kind: "color", target: "fill" });
    expect(s()).toMatchObject({ context: { kind: "color", target: "fill" }, panelOpen: true });
    a().closeContext();
    expect(s().context).toBeNull();
    const state = s();
    a().closeContext();
    expect(s()).toBe(state);
  });

  it("opens and closes dialogs", () => {
    a().openDialog("download");
    expect(s().dialog).toBe("download");
    a().closeDialog();
    expect(s().dialog).toBeNull();
  });

  it("picks a tool, keeping the selection only for the select tool", () => {
    a().select(["r1"]);
    a().setTool("select");
    expect(s().selection).toEqual(["r1"]);
    a().setTool("shape", "star");
    expect(s()).toMatchObject({ tool: "shape", toolShape: "star", selection: [] });
    a().setTool("text");
    expect(s()).toMatchObject({ tool: "text", toolShape: "star" });
  });

  it("switches between editing and viewing, clearing the selection when viewing", () => {
    a().select(["r1"]);
    a().setMode("view");
    expect(s()).toMatchObject({ mode: "view", selection: [] });
    a().select(["r2"]);
    a().setMode("edit");
    expect(s()).toMatchObject({ mode: "edit", selection: ["r2"] });
  });

  it("remembers when the design was last saved, and only then", () => {
    const stamp = s().lastSavedAt;
    a().setSaveState("saving");
    expect(s()).toMatchObject({ saveState: "saving", lastSavedAt: stamp });
    a().setSaveState("error");
    expect(s().lastSavedAt).toBe(stamp);
    a().setSaveState("saved");
    expect(s().lastSavedAt).toBeGreaterThan(stamp);
  });

  it("blocks every document change in view mode", () => {
    a().setMode("view");
    const before = s().design;
    a().setTitle("nope");
    a().addElements([rect("x")]);
    a().deleteElements(["r1"]);
    a().addGuide("v", 5);
    expect(s().design).toBe(before);
  });
});
