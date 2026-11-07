import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createImage, createPage, createShape, solid } from "./factory";
import { pageOf, useEditor } from "./store";
import type { ImageElement } from "./types";

const a = () => useEditor.getState().actions;
const s = () => useEditor.getState();

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState(), true);
  a().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements: [createShape("rect", { id: "r1", x: 10, y: 10 })] })] }));
});

describe("a current page that is not in the document", () => {
  beforeEach(() => {
    useEditor.setState({ activePageId: "ghost" });
  });

  it("changes nothing when asked to edit elements", () => {
    const before = s().design;
    a().updateElements(["r1"], { x: 5 });
    a().setLocked(["r1"], true);
    a().deleteElements(["r1"]);
    expect(s().design).toBe(before);
    expect(s().canUndo).toBe(false);
  });

  it("selects nothing, since there is no page to select from", () => {
    a().select(["r1"]);
    expect(s().selection).toEqual([]);
  });

  it("does not replace the content of a page that does not exist with a template", () => {
    const before = s().design;
    a().applyTemplatePage(createPage({ elements: [createShape("star")] }), "replace");
    expect(s().design).toBe(before);
  });
});

describe("history across pages", () => {
  it("goes back to the first page when redo removes the page being edited", () => {
    const second = a().addPage();
    a().deletePage();
    expect(s().design!.pages.map((p) => p.id)).toEqual(["p1"]);
    a().undo();
    expect(s().design!.pages.map((p) => p.id)).toEqual(["p1", second]);
    a().setActivePage(second);
    a().redo();
    expect(s().design!.pages.map((p) => p.id)).toEqual(["p1"]);
    expect(s().activePageId).toBe("p1");
  });
});

describe("pictures from older documents", () => {
  it("fills in `isFrame` when a picture is replaced", () => {
    const old = { ...createImage({ id: "old", src: "a.png", width: 100, height: 100 }), isFrame: undefined } as unknown as ImageElement;
    useEditor.setState(useEditor.getInitialState(), true);
    a().openDesign(createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1", elements: [old] })] }));
    a().replaceImage("old", "b.png", 50, 50);
    const image = pageOf(s().design, "p1")!.elements[0] as ImageElement;
    expect(image.src).toBe("b.png");
    expect(image.isFrame).toBe(false);
  });
});

describe("guides on either axis", () => {
  it("removes a vertical guide and leaves the horizontal ones", () => {
    a().addGuide("v", 10);
    a().addGuide("v", 20);
    a().addGuide("h", 30);
    a().removeGuide("v", 0);
    expect(s().design!.guides).toEqual({ vertical: [20], horizontal: [30] });
  });
});

describe("pages keep their background when the page is not the current one", () => {
  it("leaves other pages alone while editing the current one", () => {
    const second = a().addPage();
    a().setPageBackground(solid("#abcdef"));
    expect(pageOf(s().design, "p1")!.background).toEqual(solid("#ffffff"));
    expect(pageOf(s().design, second)!.background).toEqual(solid("#abcdef"));
  });
});
