import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, createText, solid } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { Page, Template } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { applyAllTemplatePages, applyTemplatePage, fitTemplatePage } from "./applyTemplate";

/** `confirm()` has no dialog host in these tests, so it asks the browser: `window.confirm` receives the message. */
let asked: string[];
function answer(yes: boolean) {
  asked = [];
  vi.spyOn(window, "confirm").mockImplementation((message?: string) => {
    asked.push(String(message));
    return yes;
  });
}

const state = () => useEditor.getState();
const page = () => getActivePage(state()) as Page;

/** A template of `pages` pages; page n holds n text boxes so the pages can be told apart. */
function template(pages: number, size = { width: 1280, height: 720 }): Template {
  return {
    id: `tpl-${pages}`,
    name: `Deck of ${pages}`,
    category: "presentation",
    typeId: "presentation",
    ...size,
    tags: [],
    accent: "#7c3aed",
    pages: Array.from({ length: pages }, (_, i) =>
      createPage({
        background: solid(`#00000${i + 1}`),
        elements: Array.from({ length: i + 1 }, (_e, k) => createText({ text: `Page ${i + 1} text ${k + 1}`, x: 40, y: 40 + k * 100, width: 400 })),
      }),
    ),
  };
}

function openDesign(withContent: boolean, size = { width: 1280, height: 720 }) {
  const elements = withContent ? [createShape("rect", { x: 10, y: 10, width: 100, height: 100 })] : [];
  state().actions.openDesign(createDesign({ title: "Apply template", ...size, pages: [createPage({ elements })] }));
}

beforeEach(() => {
  resetEditor();
  answer(true);
});

describe("applyTemplatePage", () => {
  it("does nothing when no design is open", async () => {
    const tpl = template(1);
    expect(await applyTemplatePage(tpl, tpl.pages[0], "replace")).toBe(false);
    expect(await applyTemplatePage(tpl, tpl.pages[0], "add")).toBe(false);
    expect(asked).toEqual([]);
  });

  it("puts the template page on an empty page without asking", async () => {
    openDesign(false);
    const tpl = template(2);
    expect(await applyTemplatePage(tpl, tpl.pages[1], "replace")).toBe(true);
    expect(asked).toEqual([]);
    expect(page().elements.map((e) => e.type)).toEqual(["text", "text"]);
    expect(page().background).toEqual(solid("#000002"));
    expect(state().design?.pages).toHaveLength(1);
    expect(state().selection).toEqual([]);
  });

  it("asks before it replaces a page that has content, and replaces it on yes", async () => {
    openDesign(true);
    const tpl = template(1);
    expect(await applyTemplatePage(tpl, tpl.pages[0], "replace")).toBe(true);
    expect(asked).toEqual(["The content on this page will be swapped for the template. You can undo this with Ctrl+Z."]);
    expect(page().elements.map((e) => e.type)).toEqual(["text"]);
  });

  it("keeps the page when the answer is no", async () => {
    openDesign(true);
    answer(false);
    const tpl = template(1);
    expect(await applyTemplatePage(tpl, tpl.pages[0], "replace")).toBe(false);
    expect(page().elements.map((e) => e.type)).toEqual(["shape"]);
    expect(state().canUndo).toBe(false);
  });

  it("adds the page after the current one without asking, whatever is on the page", async () => {
    openDesign(true);
    const tpl = template(3);
    expect(await applyTemplatePage(tpl, tpl.pages[2], "add")).toBe(true);
    expect(asked).toEqual([]);
    const pages = state().design?.pages ?? [];
    expect(pages).toHaveLength(2);
    expect(pages[0].elements.map((e) => e.type)).toEqual(["shape"]);
    expect(pages[1].elements).toHaveLength(3);
  });

  it("scales the page to a design of another size", async () => {
    openDesign(false, { width: 640, height: 360 });
    const tpl = template(1, { width: 1280, height: 720 });
    await applyTemplatePage(tpl, tpl.pages[0], "replace");
    const el = page().elements[0];
    expect(el.x).toBeCloseTo(20);
    expect(el.width).toBeCloseTo(200);
  });

  it("can be undone in one step", async () => {
    openDesign(true);
    const tpl = template(1);
    await applyTemplatePage(tpl, tpl.pages[0], "replace");
    state().actions.undo();
    expect(page().elements.map((e) => e.type)).toEqual(["shape"]);
  });
});

describe("applyAllTemplatePages", () => {
  it("does nothing without a design or without pages", async () => {
    expect(await applyAllTemplatePages(template(2))).toBe(false);
    openDesign(false);
    expect(await applyAllTemplatePages({ ...template(2), pages: [] })).toBe(false);
    expect(state().design?.pages).toHaveLength(1);
  });

  it("replaces an empty page with the first template page and adds the rest after it", async () => {
    openDesign(false);
    const firstId = state().activePageId;
    expect(await applyAllTemplatePages(template(3))).toBe(true);
    expect(asked).toEqual([]);
    const pages = state().design?.pages ?? [];
    expect(pages.map((p) => p.elements.length)).toEqual([1, 2, 3]);
    expect(pages[0].id).toBe(firstId);
    expect(pages.map((p) => p.background)).toEqual([solid("#000001"), solid("#000002"), solid("#000003")]);
    // the editor stays on the first page
    expect(state().activePageId).toBe(firstId);
  });

  it("explains how many pages are added when the page has content", async () => {
    openDesign(true);
    await applyAllTemplatePages(template(3));
    expect(asked).toEqual(["The first template page replaces the content of this page, and 2 more pages are added after it. You can undo this with Ctrl+Z."]);
    expect(state().design?.pages).toHaveLength(3);
  });

  it("says 'page is' for a single extra page", async () => {
    openDesign(true);
    await applyAllTemplatePages(template(2));
    expect(asked).toEqual(["The first template page replaces the content of this page, and 1 more page is added after it. You can undo this with Ctrl+Z."]);
  });

  it("uses the short message for a template of one page", async () => {
    openDesign(true);
    await applyAllTemplatePages(template(1));
    expect(asked).toEqual(["The content on this page will be swapped for the template. You can undo this with Ctrl+Z."]);
    expect(state().design?.pages).toHaveLength(1);
  });

  it("changes nothing when the answer is no", async () => {
    openDesign(true);
    answer(false);
    expect(await applyAllTemplatePages(template(3))).toBe(false);
    expect(state().design?.pages).toHaveLength(1);
    expect(page().elements.map((e) => e.type)).toEqual(["shape"]);
  });
});

describe("fitTemplatePage (re-exported)", () => {
  it("is the same function the template tab uses to preview pages", () => {
    const tpl = template(1);
    expect(fitTemplatePage(tpl, tpl.pages[0], { width: 1280, height: 720 })).toEqual(tpl.pages[0]);
  });
});
