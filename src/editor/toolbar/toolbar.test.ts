import { describe, expect, it, vi } from "vitest";
import { createDesign, createGroup, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import type { EditorState } from "@/core/store";
import type { DesignElement, TextElement } from "@/core/types";
import type { MenuEntry, MenuItemEntry } from "@/ui";
import { buildContextMenuItems } from "./contextMenuItems";
import { MIXED_BAR_CSS, NO_FILL_CSS, fillCss, parasUniform, runsUniform, textPaint, uniform } from "./selection";

/** A minimal editor state: one page with `elements`, the given selection and the actions as spies. */
function stateOf(elements: DesignElement[], selection: string[], extra: Partial<EditorState> = {}) {
  const page = createPage({ elements });
  const design = createDesign({ width: 1000, height: 600, pages: [page] });
  const actions = {
    copy: vi.fn(),
    copyStyle: vi.fn(),
    pasteStyle: vi.fn(),
    paste: vi.fn(),
    duplicateSelection: vi.fn(),
    arrange: vi.fn(),
    align: vi.fn(),
    groupSelection: vi.fn(),
    ungroupSelection: vi.fn(),
    setLocked: vi.fn(),
    setHidden: vi.fn(),
    deleteElements: vi.fn(),
    selectAll: vi.fn(),
    addPage: vi.fn(),
    openContext: vi.fn(),
  };
  const state = { design, activePageId: page.id, selection, mode: "edit", clipboard: null, styleClipboard: null, actions, ...extra } as unknown as EditorState;
  return { state, actions };
}

const labels = (items: MenuEntry[]) => items.map((i) => (i.type === "divider" ? "-" : i.type === "label" ? i.label : i.label));
const item = (items: MenuEntry[], label: string) => items.find((i): i is MenuItemEntry => (i.type === undefined || i.type === "item") && i.label === label);
const sub = (items: MenuEntry[], label: string) => (item(items, label)?.submenu ?? []).filter((i): i is MenuItemEntry => i.type === undefined || i.type === "item");

describe("uniform / mixed values", () => {
  it("reads the first value and flags disagreement", () => {
    expect(uniform([1, 1, 1], (n) => n)).toEqual({ value: 1, mixed: false });
    expect(uniform([1, 2], (n) => n)).toEqual({ value: 1, mixed: true });
    expect(uniform([], (n: number) => n)).toEqual({ value: undefined, mixed: false });
  });

  it("looks at every run of a text element", () => {
    const t = createText({ text: "Hello world", fontSize: 40 });
    t.paragraphs = [{ runs: [{ text: "Hello " }, { text: "world", bold: true }] }];
    expect(runsUniform([t], (el, r) => r.bold ?? el.fontWeight >= 600).mixed).toBe(true);
    expect(runsUniform([t], (el, r) => r.size ?? el.fontSize)).toEqual({ value: 40, mixed: false });
    const u = createText({ text: "x", fontSize: 12 });
    expect(runsUniform([t, u], (el, r) => r.size ?? el.fontSize).mixed).toBe(true);
  });

  it("paragraph level properties fall back to the element", () => {
    const t = createText({ text: "a\nb", align: "center" });
    t.paragraphs[1].align = "right";
    expect(parasUniform([t], (el, p) => p.align ?? el.align).mixed).toBe(true);
    delete t.paragraphs[1].align;
    expect(parasUniform([t], (el, p) => p.align ?? el.align)).toEqual({ value: "center", mixed: false });
  });
});

describe("paint previews", () => {
  it("previews fills as CSS", () => {
    expect(fillCss(solid("#ff0000"))).toBe("#ff0000");
    expect(fillCss(null)).toBe(NO_FILL_CSS);
    expect(
      fillCss({
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      }),
    ).toBe("linear-gradient(90deg, #000000 0%, #ffffff 100%)");
  });

  it("text paint is a colour, a gradient or mixed", () => {
    const a = createText({ text: "a", color: "#112233" });
    const b = createText({ text: "b", color: "#112233" });
    expect(textPaint([a, b])).toEqual({ kind: "solid", color: "#112233" });
    b.color = "#445566";
    expect(textPaint([a, b])).toEqual({ kind: "mixed" });
    const g: TextElement = createText({
      text: "g",
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    expect(textPaint([g]).kind).toBe("gradient");
    expect(MIXED_BAR_CSS).toContain("linear-gradient");
  });
});

describe("buildContextMenuItems", () => {
  it("builds the page menu when nothing is selected", () => {
    const { state, actions } = stateOf([createShape("rect")], []);
    const items = buildContextMenuItems(state);
    expect(labels(items)).toEqual(["Paste", "Select all", "-", "Add page", "Page background"]);
    expect(item(items, "Paste")?.disabled).toBe(true);
    item(items, "Add page")?.onSelect?.();
    expect(actions.addPage).toHaveBeenCalled();
    item(items, "Page background")?.onSelect?.();
    expect(actions.openContext).toHaveBeenCalledWith({ kind: "background" });
  });

  it("enables Paste once something was copied and pastes at the pointer", () => {
    const { state, actions } = stateOf([createShape("rect")], [], { clipboard: { elements: [createShape("rect")], pasted: 0 } });
    const items = buildContextMenuItems(state, { at: { x: 10, y: 20 } });
    expect(item(items, "Paste")?.disabled).toBeFalsy();
    item(items, "Paste")?.onSelect?.();
    expect(actions.paste).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it("builds the element menu with shortcuts", () => {
    const t = createText({ text: "Hi" });
    const { state } = stateOf([t], [t.id]);
    const items = buildContextMenuItems(state);
    expect(labels(items)).toEqual([
      "Copy",
      "Copy style",
      "Paste style",
      "Paste",
      "Duplicate",
      "-",
      "Layer",
      "Align to page",
      "Group",
      // a text can be turned into the outlines of its letters (text to points)
      "Convert to shapes",
      "-",
      "Lock",
      "Hide",
      "Alternative text",
      "Link",
      "-",
      "Delete",
    ]);
    expect(item(items, "Copy")?.shortcut).toBe("Ctrl+C");
    expect(item(items, "Copy style")?.shortcut).toBe("Ctrl+Alt+C");
    expect(item(items, "Paste style")?.shortcut).toBe("Ctrl+Alt+V");
    expect(item(items, "Duplicate")?.shortcut).toBe("Ctrl+D");
    expect(item(items, "Lock")?.shortcut).toBe("Alt+Shift+L");
    expect(item(items, "Delete")?.danger).toBe(true);
    expect(sub(items, "Align to page").map((i) => i.label)).toEqual(["Top", "Middle", "Bottom", "Left", "Center", "Right"]);
  });

  it("disables what cannot work", () => {
    const t = createText({ text: "Hi" });
    const img = createImage({ src: "builtin:x", naturalWidth: 10, naturalHeight: 10 });
    const g = createGroup([createShape("rect")]);

    // single element: no Group, no Paste, no Paste style
    let items = buildContextMenuItems(stateOf([t], [t.id]).state);
    expect(item(items, "Group")?.disabled).toBe(true);
    expect(item(items, "Paste")?.disabled).toBe(true);
    expect(item(items, "Paste style")?.disabled).toBe(true);
    expect(item(items, "Replace image")).toBeUndefined();

    // a copied text style can be pasted onto text but not onto an image
    const clip = { __type: "text" };
    items = buildContextMenuItems(stateOf([t], [t.id], { styleClipboard: clip }).state);
    expect(item(items, "Paste style")?.disabled).toBe(false);
    items = buildContextMenuItems(stateOf([img], [img.id], { styleClipboard: clip }).state);
    expect(item(items, "Paste style")?.disabled).toBe(true);
    expect(item(items, "Replace image")).toBeDefined();

    // two elements can be grouped; a group can be ungrouped
    items = buildContextMenuItems(stateOf([t, img], [t.id, img.id]).state);
    expect(item(items, "Group")?.disabled).toBe(false);
    expect(item(items, "Copy style")?.disabled).toBe(true);
    items = buildContextMenuItems(stateOf([g], [g.id]).state);
    expect(item(items, "Ungroup")).toBeDefined();
    expect(item(items, "Group")).toBeUndefined();
  });

  it("disables layer moves the element cannot make", () => {
    const a = createShape("rect");
    const b = createShape("rect");
    const c = createShape("rect");
    const els = [a, b, c];
    const disabled = (id: string) => {
      const layer = sub(buildContextMenuItems(stateOf(els, [id]).state), "Layer");
      return Object.fromEntries(layer.map((i) => [i.label, !!i.disabled]));
    };
    expect(disabled(c.id)).toEqual({ "Bring forward": true, "Bring to front": true, "Send backward": false, "Send to back": false });
    expect(disabled(a.id)).toEqual({ "Bring forward": false, "Bring to front": false, "Send backward": true, "Send to back": true });
    expect(disabled(b.id)).toEqual({ "Bring forward": false, "Bring to front": false, "Send backward": false, "Send to back": false });
  });

  it("runs the matching action", () => {
    const a = createShape("rect");
    const b = createShape("rect");
    const { state, actions } = stateOf([a, b], [a.id]);
    const items = buildContextMenuItems(state);
    sub(items, "Layer")
      .find((i) => i.label === "Bring to front")
      ?.onSelect?.();
    expect(actions.arrange).toHaveBeenCalledWith("front");
    sub(items, "Align to page")
      .find((i) => i.label === "Center")
      ?.onSelect?.();
    expect(actions.align).toHaveBeenCalledWith("center", "page");
    item(items, "Duplicate")?.onSelect?.();
    expect(actions.duplicateSelection).toHaveBeenCalled();
    item(items, "Hide")?.onSelect?.();
    expect(actions.setHidden).toHaveBeenCalledWith([a.id], true);
    item(items, "Lock")?.onSelect?.();
    expect(actions.setLocked).toHaveBeenCalledWith([a.id], true);
    item(items, "Delete")?.onSelect?.();
    expect(actions.deleteElements).toHaveBeenCalled();
  });

  it("offers Unlock for locked elements and no deleting", () => {
    const a = createShape("rect", { locked: true });
    const { state, actions } = stateOf([a], [a.id]);
    const items = buildContextMenuItems(state);
    expect(item(items, "Lock")).toBeUndefined();
    expect(item(items, "Unlock")).toBeDefined();
    expect(item(items, "Delete")?.disabled).toBe(true);
    item(items, "Unlock")?.onSelect?.();
    expect(actions.setLocked).toHaveBeenCalledWith([a.id], false);
  });

  it("is empty in view mode", () => {
    const a = createShape("rect");
    expect(buildContextMenuItems(stateOf([a], [a.id], { mode: "view" }).state)).toEqual([]);
  });
});
