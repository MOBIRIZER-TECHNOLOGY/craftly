import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, createText, solid } from "./factory";
import { useEditor } from "./store";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
const page = () => s().design!.pages.find((p) => p.id === s().activePageId)!;

function fresh() {
  const p1 = createPage({
    elements: [createShape("rect", { id: "r1", x: 100, y: 100, width: 200, height: 100 }), createShape("rect", { id: "r2", x: 400, y: 100, width: 200, height: 100 })],
  });
  a().openDesign(createDesign({ width: 1000, height: 600, pages: [p1] }));
}

describe("editor store", () => {
  beforeEach(fresh);

  it("opens a design on its first page with nothing selected", () => {
    expect(s().design!.pages).toHaveLength(1);
    expect(s().selection).toEqual([]);
    expect(s().canUndo).toBe(false);
  });

  it("adds an element centred on the page, selects it, and undoes/redoes", () => {
    const id = a().addElement(createShape("ellipse", { width: 100, height: 100 }));
    const el = page().elements.find((e) => e.id === id)!;
    expect(el.x).toBe(450);
    expect(el.y).toBe(250);
    expect(s().selection).toEqual([id]);
    a().undo();
    expect(page().elements.find((e) => e.id === id)).toBeUndefined();
    expect(s().canRedo).toBe(true);
    a().redo();
    expect(page().elements.find((e) => e.id === id)).toBeDefined();
  });

  it("clears redo history after a new edit", () => {
    a().updateElements(["r1"], { x: 5 });
    a().undo();
    expect(s().canRedo).toBe(true);
    a().updateElements(["r1"], { x: 7 });
    expect(s().canRedo).toBe(false);
  });

  it("coalesces rapid edits with the same key into one undo step", () => {
    a().updateElements(["r1"], { opacity: 0.9 }, { coalesce: "opacity" });
    a().updateElements(["r1"], { opacity: 0.8 }, { coalesce: "opacity" });
    a().updateElements(["r1"], { opacity: 0.7 }, { coalesce: "opacity" });
    expect(s().past).toHaveLength(1);
    a().undo();
    expect(page().elements[0].opacity).toBe(1);
  });

  it("merges edits with the same key less than 1.2 s apart, and starts a new step after a longer pause", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 0));
      a().updateElements(["r1"], { opacity: 0.9 }, { coalesce: "opacity" });
      vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 1)); // a second later: still the same gesture
      a().updateElements(["r1"], { opacity: 0.8 }, { coalesce: "opacity" });
      expect(s().past).toHaveLength(1);
      vi.setSystemTime(new Date(2026, 10, 7, 12, 0, 4)); // three seconds after that: a new step
      a().updateElements(["r1"], { opacity: 0.7 }, { coalesce: "opacity" });
      expect(s().past).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("different coalesce keys stay separate steps", () => {
    a().updateElements(["r1"], { opacity: 0.5 }, { coalesce: "opacity" });
    a().updateElements(["r1"], { rotation: 10 }, { coalesce: "rotation" });
    expect(s().past).toHaveLength(2);
  });

  it("a transaction is one undo step however many updates it holds", () => {
    a().beginTransaction();
    for (let i = 1; i <= 20; i++) a().updateElements(["r1"], { x: 100 + i });
    expect(s().past).toHaveLength(0);
    a().endTransaction();
    expect(s().past).toHaveLength(1);
    expect(page().elements[0].x).toBe(120);
    a().undo();
    expect(page().elements[0].x).toBe(100);
  });

  it("an empty transaction leaves no history", () => {
    a().beginTransaction();
    a().endTransaction();
    expect(s().past).toHaveLength(0);
  });

  it("deletes the selection and keeps locked elements", () => {
    a().setLocked(["r2"], true);
    a().select(["r1", "r2"]);
    a().deleteElements();
    expect(page().elements.map((e) => e.id)).toEqual(["r2"]);
  });

  it("groups, then ungroups, through the draft-safe path", () => {
    a().select(["r1", "r2"]);
    a().groupSelection();
    expect(page().elements).toHaveLength(1);
    expect(page().elements[0].type).toBe("group");
    a().ungroupSelection();
    expect(
      page()
        .elements.map((e) => e.id)
        .sort(),
    ).toEqual(["r1", "r2"]);
  });

  it("duplicates and pastes without sharing ids", () => {
    a().select(["r1"]);
    a().duplicateSelection();
    a().copy();
    a().paste();
    const ids = page().elements.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(4);
  });

  it("manages pages: add, duplicate, move, delete (never the last one)", () => {
    const first = s().activePageId;
    const second = a().addPage();
    expect(s().design!.pages).toHaveLength(2);
    expect(s().activePageId).toBe(second);
    a().duplicatePage(first);
    expect(s().design!.pages).toHaveLength(3);
    a().movePage(second, 0);
    expect(s().design!.pages[0].id).toBe(second);
    a().deletePage();
    a().deletePage();
    expect(s().design!.pages).toHaveLength(1);
    a().deletePage();
    expect(s().design!.pages).toHaveLength(1);
  });

  describe("a text box that grows as wide as its text", () => {
    const text = (id: string) => page().elements.find((e) => e.id === id)! as Extract<ReturnType<typeof page>["elements"][number], { type: "text" }>;
    const long = "The quick brown fox jumps over the lazy dog and keeps running far past the right hand edge of this page";
    const say = (id: string, words: string) => a().updateElements([id], { paragraphs: [{ runs: [{ text: words }] }] });

    it("stays one line while the line fits on the page", () => {
      const id = a().addElement(createText({ text: "Hi", fontSize: 40 }));
      say(id, "Hello there");
      expect(text(id).autoWidth).toBe(true);
      expect(text(id).x + text(id).width).toBeLessThanOrEqual(1000);
    });

    it("wraps at the edge of the page instead of running past it, and keeps its left edge", () => {
      const id = a().addElement(createText({ text: "Hi", fontSize: 40 }), { center: false });
      a().updateElements([id], { x: 300, y: 100 });
      const oneLine = text(id).height;
      say(id, long);
      const el = text(id);
      expect(el.autoWidth).toBe(false);
      expect(el.x).toBe(300);
      expect(el.width).toBe(700);
      expect(el.y).toBe(100);
      expect(el.height).toBeGreaterThan(oneLine * 1.5);
    });

    it("keeps the right edge of right-aligned text and the middle of centred text", () => {
      const right = a().addElement(createText({ text: "Hi", fontSize: 40, align: "right" }), { center: false });
      a().updateElements([right], { x: 800 - text(right).width, y: 50 });
      say(right, long);
      expect(text(right).autoWidth).toBe(false);
      expect(text(right).x).toBe(0);
      expect(text(right).width).toBeCloseTo(800, 0);

      const mid = a().addElement(createText({ text: "Hi", fontSize: 40, align: "center" }), { center: false });
      a().updateElements([mid], { x: 400 - text(mid).width / 2, y: 300 });
      say(mid, long);
      expect(text(mid).autoWidth).toBe(false);
      expect(text(mid).x).toBeCloseTo(0, 0);
      expect(text(mid).width).toBeCloseTo(800, 0);
    });

    it("is one step to undo, and the box grows with its text again afterwards", () => {
      const id = a().addElement(createText({ text: "Hi", fontSize: 40 }));
      say(id, long);
      expect(text(id).autoWidth).toBe(false);
      a().undo();
      expect(text(id).autoWidth).toBe(true);
      expect(text(id).paragraphs[0].runs[0].text).toBe("Hi");
    });

    it("also wraps when a larger font size is what makes the line too long", () => {
      const id = a().addElement(createText({ text: "A line of ordinary length here", fontSize: 20 }));
      a().updateElements([id], { fontSize: 200 });
      expect(text(id).autoWidth).toBe(false);
      expect(text(id).x + text(id).width).toBeLessThanOrEqual(1000.5);
    });

    it("leaves a box alone that already reached past the page, one that is turned, and one inside a group", () => {
      const bleed = a().addElement(createText({ text: "Hi", fontSize: 40 }), { center: false });
      a().updateElements([bleed], { x: 990, y: 10 });
      say(bleed, long);
      expect(text(bleed).autoWidth).toBe(true);

      const turned = a().addElement(createText({ text: "Hi", fontSize: 40, rotation: 30 }));
      say(turned, long);
      expect(text(turned).autoWidth).toBe(true);

      const g1 = a().addElement(createText({ text: "one", fontSize: 40 }), { center: false });
      const g2 = a().addElement(createText({ text: "two", fontSize: 40 }), { center: false });
      a().updateElements([g2], { x: 200, y: 200 });
      a().select([g1, g2]);
      a().groupSelection();
      const group = page().elements.find((e) => e.type === "group")! as Extract<ReturnType<typeof page>["elements"][number], { type: "group" }>;
      a().updateElements([group.children[0].id], { paragraphs: [{ runs: [{ text: long }] }] });
      const inner = (page().elements.find((e) => e.type === "group")! as typeof group).children[0];
      expect(inner.type === "text" && inner.autoWidth).toBe(true);
    });

    it("does not touch the text boxes of a design that is opened", () => {
      const wide = createText({ id: "wide", text: long, fontSize: 60, x: 10, y: 10 });
      a().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ elements: [wide] })] }));
      expect(text("wide").autoWidth).toBe(true);
      expect(text("wide").width).toBeGreaterThan(1000);
    });
  });

  it("re-measures text boxes after edits (auto height)", () => {
    const id = a().addElement(createText({ text: "Hello", fontSize: 40, width: 300, autoWidth: false }));
    const h1 = page().elements.find((e) => e.id === id)!.height;
    a().setTextParagraphs(id, [{ runs: [{ text: "Hello" }] }, { runs: [{ text: "world" }] }, { runs: [{ text: "again" }] }]);
    const h2 = page().elements.find((e) => e.id === id)!.height;
    expect(h2).toBeGreaterThan(h1 * 2);
  });

  it("clearing run overrides when a whole-element style is applied", () => {
    const id = a().addElement(createText({ paragraphs: [{ runs: [{ text: "a", bold: true }, { text: "b" }] }] }));
    a().setTextProps([id], { fontWeight: 800 });
    const el = page().elements.find((e) => e.id === id)!;
    expect(el.type === "text" && el.paragraphs[0].runs.every((r) => r.bold === undefined)).toBe(true);
  });

  it("protects locked elements from edits but still lets them be unlocked", () => {
    a().setLocked(["r1"], true);
    a().updateElements(["r1"], { x: 999 });
    a().updateElements(["r1"], (e) => {
      e.y = 999;
    });
    a().setTextProps(["r1"], { fontSize: 10 });
    expect(page().elements[0].x).toBe(100);
    expect(page().elements[0].y).toBe(100);
    a().setHidden(["r1"], true);
    expect(page().elements[0].hidden).toBe(true);
    a().setLocked(["r1"], false);
    a().updateElements(["r1"], { x: 5 });
    expect(page().elements[0].x).toBe(5);
  });

  it("resizes the design and scales content to fit", () => {
    a().resizeDesign(2000, 1200, true);
    expect(s().design!.width).toBe(2000);
    expect(page().elements[0].width).toBe(400);
  });

  it("blocks edits in view mode", () => {
    a().setMode("view");
    a().updateElements(["r1"], { x: 1 });
    expect(page().elements[0].x).toBe(100);
    a().setMode("edit");
    a().updateElements(["r1"], { x: 1 });
    expect(page().elements[0].x).toBe(1);
  });

  it("applies and replaces a template page", () => {
    const tpl = createPage({ background: solid("#000000"), elements: [createShape("star", { width: 50, height: 50 })] });
    a().applyTemplatePage(tpl, "replace");
    expect(page().elements).toHaveLength(1);
    expect(page().background).toEqual(solid("#000000"));
    a().applyTemplatePage(tpl, "add");
    expect(s().design!.pages).toHaveLength(2);
  });
});
