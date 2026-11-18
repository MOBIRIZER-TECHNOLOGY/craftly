import { beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { keepView, restoreKeptView } from "./keptView";

const s = () => useEditor.getState();

/** a design of two pages, the second with a box, opened on its first page */
function openTwoPages(): Design {
  const box = { ...createShape("rect"), id: "box" };
  const design = { ...createDesign({ width: 1000, height: 600, pages: [createPage({ id: "p1" }), createPage({ id: "p2", elements: [box] })] }), id: "d1" };
  s().actions.openDesign(structuredClone(design));
  return design;
}

beforeEach(() => {
  useEditor.setState(useEditor.getInitialState(), true);
  sessionStorage.clear();
});

describe("the view kept over a reload into another language (B12)", () => {
  it("opens the design again on the same page, with the same selection and zoom", () => {
    const design = openTwoPages();
    s().actions.setActivePage("p2");
    s().actions.select(["box"]);
    s().actions.setZoom(0.5);
    keepView();
    // the reload: the design is opened afresh, on its first page
    useEditor.setState(useEditor.getInitialState(), true);
    s().actions.openDesign(structuredClone(design));
    expect(s().activePageId).toBe("p1");
    restoreKeptView("d1");
    expect(s().activePageId).toBe("p2");
    expect(s().selection).toEqual(["box"]);
    expect(s().zoom).toBe(0.5);
    expect(s().zoomMode).toBe("custom");
  });

  it("is given back once, and only to the same design", () => {
    const design = openTwoPages();
    s().actions.setActivePage("p2");
    keepView();
    s().actions.openDesign(structuredClone({ ...design, id: "other" }));
    restoreKeptView("other");
    expect(s().activePageId).toBe("p1");
    // used up by the other design: nothing is left for this one
    s().actions.openDesign(structuredClone(design));
    restoreKeptView("d1");
    expect(s().activePageId).toBe("p1");
  });

  it("keeps a fitted zoom fitted, and leaves out what is no longer there", () => {
    const design = openTwoPages();
    s().actions.setActivePage("p2");
    s().actions.select(["box"]);
    keepView();
    s().actions.openDesign(structuredClone({ ...design, pages: [design.pages[0], { ...design.pages[1], elements: [] }] }));
    restoreKeptView("d1");
    expect(s().activePageId).toBe("p2");
    expect(s().selection).toEqual([]);
    expect(s().zoomMode).toBe("fit");
  });
});
