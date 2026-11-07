import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createDesign, createGraphic, createGroup, createImage, createLine, createPage, createShape, createTable, createText, solid } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { DesignElement, Fill, GraphicElement, GroupElement, TextElement } from "@/core/types";
import { takeSelectAllOnEdit } from "@/editor/canvas/controller";
import { registerTextEditor, type TextEditorHandle } from "@/editor/canvas/textEditing";
import { resetEditor } from "@/test/helpers";
import { addTextAndEdit, addTextInFont, applyColorToSelection, applyFontToSelection, designMin, fillToCss, newText, sameFill } from "./panelActions";

const state = () => useEditor.getState();
const elements = () => getActivePage(state())?.elements ?? [];
const byId = <T extends DesignElement>(id: string) => elements().find((e) => e.id === id) as T;

/** A design with the given elements on its only page, opened in the store. */
function open(els: DesignElement[], size = { width: 1280, height: 720 }) {
  state().actions.openDesign(createDesign({ title: "Panel actions", ...size, pages: [createPage({ elements: els })] }));
}

const select = (...els: DesignElement[]) => state().actions.select(els.map((e) => e.id));

/** An editor stand-in that formats the selected characters (or reports a bare caret). */
function textEditor(applies: boolean): TextEditorHandle & { applyInline: ReturnType<typeof vi.fn> } {
  const handle = { applyInline: vi.fn(() => applies), hasSelection: () => applies, focus: vi.fn() };
  registerTextEditor(handle);
  return handle;
}

beforeEach(() => {
  resetEditor();
  takeSelectAllOnEdit();
});

afterEach(() => {
  registerTextEditor(null);
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("designMin", () => {
  it("is the shorter side of the open design", () => {
    open([], { width: 1280, height: 720 });
    expect(designMin()).toBe(720);
    open([], { width: 600, height: 900 });
    expect(designMin()).toBe(600);
  });

  it("is 1000 when no design is open", () => {
    expect(designMin()).toBe(1000);
  });
});

describe("newText", () => {
  it("makes a text box with the words and the given look", () => {
    const el = newText("Hello", { fontSize: 80, fontWeight: 700 });
    expect(el.type).toBe("text");
    expect(el.paragraphs[0].runs[0].text).toBe("Hello");
    expect(el.fontSize).toBe(80);
    expect(el.fontWeight).toBe(700);
  });
});

describe("addTextAndEdit", () => {
  it("puts the text on the page, selects it and opens it for typing with everything selected", () => {
    open([]);
    const id = addTextAndEdit(newText("Fresh"));
    expect(id).not.toBe("");
    expect(elements().map((e) => e.id)).toEqual([id]);
    expect(state().selection).toEqual([id]);
    expect(state().editingTextId).toBe(id);
    expect(takeSelectAllOnEdit()).toBe(true);
  });

  it("does nothing when there is no design to put it on", () => {
    expect(addTextAndEdit(newText("Nowhere"))).toBe("");
    expect(state().editingTextId).toBeNull();
    expect(takeSelectAllOnEdit()).toBe(false);
  });

  describe("selecting the text once the editor is on screen", () => {
    function editorRoot(text: string, editable = true): HTMLElement {
      const root = document.createElement("div");
      root.setAttribute("data-cf-text-editor", "");
      root.textContent = text;
      // jsdom does not know contenteditable
      Object.defineProperty(root, "isContentEditable", { value: editable });
      document.body.append(root);
      return root;
    }

    beforeEach(() => {
      vi.useFakeTimers();
      open([]);
    });

    it("completes a selection that is only a caret", () => {
      const root = editorRoot("Add text");
      const range = document.createRange();
      range.setStart(root.firstChild as Text, 0);
      range.collapse(true);
      window.getSelection()?.addRange(range);
      addTextAndEdit(newText("Add text"));
      vi.advanceTimersByTime(20);
      expect(window.getSelection()?.toString()).toBe("Add text");
    });

    it("selects everything when nothing is selected yet", () => {
      editorRoot("Add text");
      addTextAndEdit(newText("Add text"));
      vi.advanceTimersByTime(20);
      expect(window.getSelection()?.toString()).toBe("Add text");
    });

    it("keeps a selection the editor made itself", () => {
      const root = editorRoot("Add text");
      const range = document.createRange();
      range.setStart(root.firstChild as Text, 0);
      range.setEnd(root.firstChild as Text, 3);
      window.getSelection()?.addRange(range);
      addTextAndEdit(newText("Add text"));
      vi.advanceTimersByTime(20);
      expect(window.getSelection()?.toString()).toBe("Add");
    });

    it("leaves the page alone when the editor is not there or not editable", () => {
      addTextAndEdit(newText("No editor yet"));
      vi.advanceTimersByTime(20);
      expect(window.getSelection()?.rangeCount).toBe(0);

      editorRoot("read only", false);
      addTextAndEdit(newText("Read only"));
      vi.advanceTimersByTime(20);
      expect(window.getSelection()?.rangeCount).toBe(0);
    });

    it("gives up when typing was already finished", () => {
      editorRoot("Add text");
      addTextAndEdit(newText("Add text"));
      state().actions.endTextEdit();
      vi.advanceTimersByTime(20);
      expect(window.getSelection()?.rangeCount).toBe(0);
    });
  });
});

describe("addTextInFont", () => {
  it("adds a text box in the font and opens it for typing", async () => {
    open([]);
    const id = await addTextInFont("Add a heading", "Lora", { fontSize: 96, fontWeight: 700 });
    const el = byId<TextElement>(id);
    expect(el.fontFamily).toBe("Lora");
    expect(el.fontSize).toBe(96);
    expect(el.fontWeight).toBe(700);
    expect(el.paragraphs[0].runs[0].text).toBe("Add a heading");
    expect(state().editingTextId).toBe(id);
  });

  it("works for an upright regular face with no extra options", async () => {
    open([]);
    const id = await addTextInFont("Body", "Inter");
    expect(byId<TextElement>(id).fontFamily).toBe("Inter");
    expect(byId<TextElement>(id).fontWeight).toBe(400);
  });
});

describe("applyColorToSelection", () => {
  it("colours the selected characters while a text box is being edited", () => {
    const text = createText({ text: "Edit me" });
    open([text]);
    select(text);
    state().actions.startTextEdit(text.id);
    const editor = textEditor(true);
    expect(applyColorToSelection("#ff0000")).toBe("text");
    expect(editor.applyInline).toHaveBeenCalledWith({ color: "#ff0000" });
    expect(byId<TextElement>(text.id).color).not.toBe("#ff0000");
  });

  it("colours the whole text box when the editor only has a caret", () => {
    const text = createText({ text: "Edit me" });
    open([text]);
    select(text);
    state().actions.startTextEdit(text.id);
    textEditor(false);
    expect(applyColorToSelection("#00ff00")).toBe("elements");
    expect(byId<TextElement>(text.id).color).toBe("#00ff00");
  });

  it("colours the page background when nothing is selected", () => {
    open([createShape("rect")]);
    expect(applyColorToSelection("#123456")).toBe("background");
    expect(getActivePage(state())?.background).toEqual(solid("#123456"));
  });

  it("colours text, dropping any gradient it had", () => {
    const text = createText({
      text: "Gradient",
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#000000" },
          { offset: 1, color: "#ffffff" },
        ],
      },
    });
    open([text]);
    select(text);
    expect(applyColorToSelection("#abcdef")).toBe("elements");
    expect(byId<TextElement>(text.id).color).toBe("#abcdef");
    expect(byId<TextElement>(text.id).gradient).toBeNull();
  });

  it("fills shapes, strokes lines and tints tables and charts", () => {
    const shape = createShape("ellipse");
    const line = createLine();
    const table = createTable();
    const chart = createChart();
    open([shape, line, table, chart]);
    select(shape, line, table, chart);
    expect(applyColorToSelection("#ff00aa")).toBe("elements");
    expect((byId(shape.id) as typeof shape).fill).toEqual(solid("#ff00aa"));
    expect((byId(line.id) as typeof line).stroke.color).toBe("#ff00aa");
    expect((byId(table.id) as typeof table).headerFill).toBe("#ff00aa");
    const palette = (byId(chart.id) as typeof chart).palette;
    expect(palette[0]).toBe("#ff00aa");
    expect(palette.slice(1)).toEqual(chart.palette.slice(1));
  });

  it("recolours an icon with one colour but leaves a many-coloured illustration alone", () => {
    const icon = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0h10v10z" fill="#ff0000"/></svg>' });
    const art = createGraphic({ svg: '<svg viewBox="0 0 10 10"><path d="M0 0h5v10z" fill="#ff0000"/><path d="M5 0h5v10z" fill="#0000ff"/></svg>' });
    open([icon, art]);
    select(icon);
    expect(applyColorToSelection("#00aa00")).toBe("elements");
    expect(byId<GraphicElement>(icon.id).colors).toEqual({ "#ff0000": "#00aa00" });

    select(art);
    expect(applyColorToSelection("#00aa00")).toBe("none");
    expect(byId<GraphicElement>(art.id).colors).toEqual({});
  });

  it("recolours the stroke colour of a line icon drawn with currentColor", () => {
    const icon = createGraphic({ svg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M2 2l20 20"/></svg>' });
    open([icon]);
    select(icon);
    expect(applyColorToSelection("#0055ff")).toBe("elements");
    expect(byId<GraphicElement>(icon.id).colors).toEqual({ currentColor: "#0055ff" });
  });

  it("reaches into groups", () => {
    const inner = createText({ text: "Inside" });
    const dot = createShape("ellipse");
    const photo = createImage({ src: "builtin:sunset-hills" });
    const group = createGroup([inner, dot, photo]);
    open([group]);
    select(group);
    expect(applyColorToSelection("#222222")).toBe("elements");
    const children = byId<GroupElement>(group.id).children;
    expect((children[0] as TextElement).color).toBe("#222222");
    expect((children[1] as typeof dot).fill).toEqual(solid("#222222"));
  });

  it("says so when nothing selected can take a colour", () => {
    const photo = createImage({ src: "builtin:sunset-hills" });
    const emptyGroup = createGroup([createImage({ src: null })]);
    open([photo, emptyGroup]);
    select(photo);
    expect(applyColorToSelection("#222222")).toBe("none");
    select(emptyGroup);
    expect(applyColorToSelection("#222222")).toBe("none");
  });

  it("colours what can be coloured in a mixed selection", () => {
    const photo = createImage({ src: "builtin:sunset-hills" });
    const shape = createShape("rect");
    open([photo, shape]);
    select(photo, shape);
    expect(applyColorToSelection("#334455")).toBe("elements");
    expect((byId(shape.id) as typeof shape).fill).toEqual(solid("#334455"));
  });
});

describe("applyFontToSelection", () => {
  it("applies the font to the selected characters while a text box is being edited", () => {
    const text = createText({ text: "Edit me" });
    open([text]);
    select(text);
    state().actions.startTextEdit(text.id);
    const editor = textEditor(true);
    expect(applyFontToSelection("Lora")).toBe(true);
    expect(editor.applyInline).toHaveBeenCalledWith({ font: "Lora" });
    expect(byId<TextElement>(text.id).fontFamily).not.toBe("Lora");
  });

  it("changes the whole text box when the editor only has a caret", () => {
    const text = createText({ text: "Edit me" });
    open([text]);
    select(text);
    state().actions.startTextEdit(text.id);
    textEditor(false);
    expect(applyFontToSelection("Lora")).toBe(true);
    expect(byId<TextElement>(text.id).fontFamily).toBe("Lora");
  });

  it("changes the font of selected text", () => {
    const text = createText({ text: "Plain" });
    open([text]);
    select(text);
    expect(applyFontToSelection("Playfair Display")).toBe(true);
    expect(byId<TextElement>(text.id).fontFamily).toBe("Playfair Display");
  });

  it("changes the text inside a selected group", () => {
    const inner = createText({ text: "Inside" });
    const group = createGroup([createShape("rect"), inner]);
    open([group]);
    select(group);
    expect(applyFontToSelection("Lora")).toBe(true);
    const child = byId<GroupElement>(group.id).children[1] as TextElement;
    expect(child.fontFamily).toBe("Lora");
  });

  it("reports false when nothing selected has text", () => {
    const shape = createShape("rect");
    const group = createGroup([createShape("ellipse")]);
    open([shape, group]);
    expect(applyFontToSelection("Lora")).toBe(false);
    select(shape);
    expect(applyFontToSelection("Lora")).toBe(false);
    select(group);
    expect(applyFontToSelection("Lora")).toBe(false);
  });
});

describe("fillToCss", () => {
  it("is the colour itself for a solid fill", () => {
    expect(fillToCss(solid("#112233"))).toBe("#112233");
  });

  it("writes a linear gradient with rounded percentages", () => {
    const fill: Fill = {
      type: "linear",
      angle: 45,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 0.333, color: "#00ff00" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    expect(fillToCss(fill)).toBe("linear-gradient(45deg, #ff0000 0%, #00ff00 33%, #0000ff 100%)");
  });

  it("writes a radial gradient from the middle, or from its own centre", () => {
    const stops = [
      { offset: 0, color: "#ffffff" },
      { offset: 1, color: "#000000" },
    ];
    expect(fillToCss({ type: "radial", stops })).toBe("radial-gradient(circle at 50% 50%, #ffffff 0%, #000000 100%)");
    expect(fillToCss({ type: "radial", stops, cx: 0.2, cy: 0.9 })).toBe("radial-gradient(circle at 20% 90%, #ffffff 0%, #000000 100%)");
  });

  it("has no CSS for patterns and pictures", () => {
    expect(fillToCss({ type: "pattern", pattern: "dots", color: "#000000", background: "#ffffff", scale: 1 })).toBeNull();
    expect(fillToCss({ type: "image", src: "builtin:sunset-hills", fit: "cover" })).toBeNull();
  });
});

describe("sameFill", () => {
  it("compares fills by what they contain", () => {
    expect(sameFill(solid("#ffffff"), solid("#ffffff"))).toBe(true);
    expect(sameFill(solid("#ffffff"), solid("#fffffe"))).toBe(false);
    expect(sameFill(solid("#ffffff"), { type: "linear", angle: 0, stops: [] })).toBe(false);
  });
});
