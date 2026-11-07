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
