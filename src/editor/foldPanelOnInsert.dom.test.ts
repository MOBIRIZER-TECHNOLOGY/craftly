import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { setMedia } from "@/test/media";
import { installFoldPanelOnInsert, SHEET_QUERY } from "./foldPanelOnInsert";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();
/** the panel is looked at when the action that changed the page is over */
const settled = () => new Promise<void>((resolve) => queueMicrotask(resolve)).then(() => new Promise<void>((resolve) => queueMicrotask(resolve)));

let stop: () => void;
beforeEach(async () => {
  resetEditor();
  a().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements: [createShape("rect", { id: "old" })] }), createPage({ id: "p2" })] }));
  await settled();
  stop = installFoldPanelOnInsert();
});
afterEach(() => stop());

describe("the side panel on a phone, when something is added from it", () => {
  beforeEach(() => setMedia(SHEET_QUERY, true));

  it("is folded away, so that what was added can be seen", async () => {
    await settled();
    expect(s().panelOpen).toBe(true);
    a().addElement(createText({ text: "New" }));
    await settled();
    expect(s().panelOpen).toBe(false);
  });

  it("stays folded away when more is added by other means, and can be opened again", async () => {
    a().addElement(createShape("ellipse"));
    a().addElement(createShape("star"));
    await settled();
    expect(s().panelOpen).toBe(false);
    a().setLeftTab("text");
    await settled();
    expect(s().panelOpen).toBe(true);
  });

  it("stays open for everything that adds nothing: moving, selecting, deleting, another page, undo", async () => {
    a().select(["old"]);
    a().updateElements(["old"], { x: 50 });
    a().setActivePage("p2");
    a().setActivePage("p1");
    await settled();
    expect(s().panelOpen).toBe(true);
    a().select(["old"]);
    a().deleteElements();
    a().undo();
    await settled();
    expect(s().panelOpen).toBe(true);
  });

  it("stays open when it shows the options of what is selected", async () => {
    a().select(["old"]);
    a().openContext({ kind: "position", tab: "arrange" });
    a().duplicateSelection();
    a().addElement(createShape("rect"));
    await settled();
    expect(s().panelOpen).toBe(true);
  });

  it("stays open for what someone else adds to a shared design", async () => {
    const design = s().design!;
    const theirs = { ...design, pages: design.pages.map((p) => (p.id === "p1" ? { ...p, elements: [...p.elements, createShape("rect", { id: "theirs" })] } : p)) };
    useEditor.setState({ design: theirs });
    await settled();
    expect(s().panelOpen).toBe(true);
  });

  it("stops when it is told to", async () => {
    stop();
    a().addElement(createText({ text: "New" }));
    await settled();
    expect(s().panelOpen).toBe(true);
  });
});

describe("the side panel on a wider screen", () => {
  it("stays open beside the page when something is added", async () => {
    a().addElement(createText({ text: "New" }));
    await settled();
    expect(s().panelOpen).toBe(true);
  });
});
