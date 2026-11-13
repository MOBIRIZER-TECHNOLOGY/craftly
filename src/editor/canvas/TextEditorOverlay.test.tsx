/**
 * The in-place text editor: a contentEditable box over the text element. jsdom has no editing engine, so these tests
 * do what the browser would do to the box (replace its DOM, fire `input`) and check what ends up in the document;
 * `document.execCommand` is replaced by a small stand-in that wraps the selection the way the browser's would.
 */
import { act, configure, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createShape, createText } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import type { TextElement } from "@/core/types";
import { canvasDesign, currentPage, elementOf, mountWorkspace } from "@/test/canvasUtils";
import { markSelectAllOnEdit } from "./controller";
import { registerTextEditor, textEditing, useTextSelectionStyle } from "./textEditing";

// the machine may be busy: give waitFor more than its default second
configure({ asyncUtilTimeout: 20_000 });

const state = () => useEditor.getState();
const text = (extra: Partial<TextElement> = {}) => createText({ id: "t", text: "Hello world", x: 100, y: 100, width: 400, fontSize: 40, ...extra });
const model = () => elementOf<TextElement>("t");
const paragraphs = () => model().paragraphs;

async function openEditor(extra: Partial<TextElement> = {}, others: ReturnType<typeof createShape>[] = []) {
  const rig = await mountWorkspace(canvasDesign([text(extra), ...others]));
  act(() => getActions().startTextEdit("t"));
  const editor = rig.container.querySelector<HTMLElement>("[data-cf-text-editor]")!;
  return { rig, editor };
}

/** What the browser leaves in the box after the user typed or formatted: new markup, then an `input` event. */
function browserSets(editor: HTMLElement, html: string) {
  editor.innerHTML = html;
  fireEvent.input(editor);
}

/** Select characters `from`..`to` of the first text node found under `node`. */
function select(node: Node, from: number, to: number) {
  const walker = document.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode() as Text;
  const range = document.createRange();
  range.setStart(textNode, from);
  range.setEnd(textNode, to);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  return range;
}

/** Formats the selection the way the toolbar does (inside act: the document changes and React re-renders). */
function applyInline(format: Parameters<typeof textEditing.applyInline>[0]): boolean {
  let applied = false;
  act(() => {
    applied = textEditing.applyInline(format);
  });
  return applied;
}

type Doc = Record<string, unknown>;
const doc = document as unknown as Doc;

beforeEach(() => {
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
});

afterEach(() => {
  delete doc.caretPositionFromPoint;
  delete doc.caretRangeFromPoint;
  delete doc.queryCommandState;
  registerTextEditor(null);
});

describe("opening the editor", () => {
  it("lays an editable box over the text, styled like it", async () => {
    const { editor } = await openEditor({ fontWeight: 700, italic: true, align: "center", opacity: 0.5, letterSpacing: 100, color: "#336699" });
    expect(editor.getAttribute("contenteditable")).toBe("true");
    expect(editor.textContent).toBe("Hello world");
    expect(editor.style.left).toBe("100px");
    expect(editor.style.top).toBe("100px");
    expect(editor.style.width).toBe("400px");
    expect(editor.style.fontSize).toBe("40px");
    expect(editor.style.fontWeight).toBe("700");
    expect(editor.style.fontStyle).toBe("italic");
    expect(editor.style.textAlign).toBe("center");
    expect(editor.style.opacity).toBe("0.5");
    expect(editor.style.letterSpacing).toBe("0.1em");
    expect(editor.style.color).toBe("rgb(51, 102, 153)");
    expect(editor.style.whiteSpace).toBe("pre-wrap");
    expect(editor.getAttribute("spellcheck")).toBe("false");
  });

  it("follows the zoom", async () => {
    const { rig, editor } = await openEditor();
    act(() => getActions().setZoom(2));
    expect(editor.style.left).toBe("200px");
    expect(editor.style.fontSize).toBe("80px");
    expect(editor.style.width).toBe("800px");
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBe(editor);
  });

  it("lets an auto-width box grow with its text and keeps its lines together", async () => {
    const { editor } = await openEditor({ autoWidth: true });
    expect(editor.style.width).toBe("max-content");
    expect(editor.style.whiteSpace).toBe("pre");
  });

  it("applies upper, lower and title case, underline and strike, a gradient colour and a turn", async () => {
    const { editor } = await openEditor({
      textCase: "upper",
      underline: true,
      strike: true,
      rotation: 20,
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    expect(editor.style.textTransform).toBe("uppercase");
    expect(editor.style.textDecoration).toContain("underline");
    expect(editor.style.textDecoration).toContain("line-through");
    expect(editor.style.transform).toBe("rotate(20deg)");
    expect(editor.style.color).toBe("rgb(255, 0, 0)");
    expect(editor.style.caretColor).toBe("rgb(255, 0, 0)");
  });

  it.each([
    ["lower", "lowercase"],
    ["title", "capitalize"],
    ["none", "none"],
  ] as const)("shows %s case as %s", async (textCase, css) => {
    const { editor } = await openEditor({ textCase });
    expect(editor.style.textTransform).toBe(css);
  });

  it("keeps the list marker of a listed text box", async () => {
    const { editor } = await openEditor({ list: "bullet" });
    expect(editor.getAttribute("data-list")).toBe("bullet");
    expect(editor.style.getPropertyValue("--cf-list")).toBe("bullet");
    expect(editor.querySelector("div")?.getAttribute("data-list")).toBe("bullet");
  });

  it("builds paragraphs, soft breaks and styled runs from the document", async () => {
    const { editor } = await openEditor({
      paragraphs: [
        {
          runs: [
            { text: "Bold ", bold: true, italic: false },
            { text: "red", bold: false, italic: true, color: "#ff0000", size: 80, font: "Playfair Display", underline: true, strike: true },
          ],
          align: "right",
          list: "number",
        },
        { runs: [{ text: "one\ntwo" }] },
        { runs: [{ text: "" }] },
      ],
    });
    const lines = Array.from(editor.children) as HTMLElement[];
    expect(lines).toHaveLength(3);
    expect(lines[0].getAttribute("data-list")).toBe("number");
    expect(lines[0].style.textAlign).toBe("right");
    const [bold, red] = Array.from(lines[0].children) as HTMLElement[];
    expect(bold.style.fontWeight).toBe("700");
    expect(bold.style.fontStyle).toBe("normal");
    expect(red.style.fontWeight).toBe("400");
    expect(red.style.fontStyle).toBe("italic");
    expect(red.style.color).toBe("rgb(255, 0, 0)");
    expect(red.style.fontSize).toBe("80px");
    expect(red.style.fontFamily).toContain("Playfair Display");
    expect(red.style.textDecoration).toBe("underline line-through");
    expect(Array.from(lines[1].childNodes).map((n) => n.nodeName)).toEqual(["SPAN", "BR", "SPAN"]);
    expect(lines[1].textContent).toBe("onetwo");
    expect(Array.from(lines[2].childNodes).map((n) => n.nodeName)).toEqual(["BR"]);
  });

  it("keeps nothing for the empty part after a trailing line break", async () => {
    const { editor } = await openEditor({ paragraphs: [{ runs: [{ text: "ends here\n" }] }] });
    expect(Array.from(editor.firstElementChild!.childNodes).map((n) => n.nodeName)).toEqual(["SPAN", "BR"]);
  });

  it("shows a run without underline or strike as undecorated", async () => {
    const { editor } = await openEditor({ paragraphs: [{ runs: [{ text: "plain", underline: false, strike: false }] }] });
    expect(editor.querySelector("span")?.style.textDecoration).toBe("none");
  });

  it("starts with every character selected for a freshly added text box", async () => {
    markSelectAllOnEdit();
    const { editor } = await openEditor();
    expect(window.getSelection()?.toString()).toBe("Hello world");
    expect(editor.contains(window.getSelection()!.anchorNode)).toBe(true);
  });

  it("starts with the caret at the end otherwise", async () => {
    const { editor } = await openEditor();
    const selection = window.getSelection()!;
    expect(selection.isCollapsed).toBe(true);
    expect(editor.contains(selection.anchorNode)).toBe(true);
    expect(selection.toString()).toBe("");
    expect(selection.anchorOffset).toBe(selection.anchorNode === editor ? editor.childNodes.length : 11);
  });

  it("puts the caret where the text was double-clicked (caretPositionFromPoint)", async () => {
    doc.caretPositionFromPoint = () => {
      const node = document.querySelector("[data-cf-text-editor] span")!.firstChild!;
      return { offsetNode: node, offset: 5 };
    };
    const rig = await mountWorkspace(canvasDesign([text()]));
    rig.dblclick(150, 120);
    expect(state().editingTextId).toBe("t");
    expect(window.getSelection()?.anchorOffset).toBe(5);
  });

  it("falls back to the end when the click point is not inside the box", async () => {
    doc.caretRangeFromPoint = () => {
      const range = document.createRange();
      range.setStart(document.body, 0);
      return range;
    };
    const rig = await mountWorkspace(canvasDesign([text()]));
    rig.dblclick(150, 120);
    const editor = rig.container.querySelector("[data-cf-text-editor]")!;
    expect(editor.contains(window.getSelection()!.anchorNode)).toBe(true);
  });

  it("opens over a text inside a group, in page coordinates", async () => {
    const group = createGroup([createText({ id: "inner", text: "Inside", x: 10, y: 20, width: 200, fontSize: 30 })], { id: "grp", x: 300, y: 200, width: 300, height: 100 });
    const rig = await mountWorkspace(canvasDesign([group]));
    act(() => getActions().startTextEdit("inner", "grp"));
    const editor = rig.container.querySelector<HTMLElement>("[data-cf-text-editor]")!;
    expect(editor.textContent).toBe("Inside");
    expect(editor.style.left).toBe("310px");
    expect(editor.style.top).toBe("220px");
  });

  it("shows nothing when the edited element is not text, or when nothing is edited", async () => {
    const rig = await mountWorkspace(canvasDesign([text(), createShape("rect", { id: "box", x: 0, y: 0, width: 10, height: 10 })]));
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeNull();
    act(() => useEditor.setState({ editingTextId: "box" }));
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeNull();
    act(() => useEditor.setState({ editingTextId: "gone" }));
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeNull();
  });
});

describe("turning the typed text back into runs", () => {
  it("makes a paragraph of every line", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>First line</div><div>Second line</div>");
    expect(paragraphs().map((p) => p.runs.map((r) => r.text))).toEqual([["First line"], ["Second line"]]);
    expect(model().autoWidth).toBe(false);
  });

  it("keeps a blank line as an empty paragraph", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>One</div><div><br></div><div>Three</div>");
    expect(paragraphs().map((p) => p.runs[0].text)).toEqual(["One", "", "Three"]);
  });

  it("keeps a soft line break inside its paragraph", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>One<br>Two</div>");
    expect(paragraphs()).toHaveLength(1);
    expect(
      paragraphs()[0]
        .runs.map((r) => r.text)
        .join(""),
    ).toBe("One\nTwo");
  });

  it("keeps a soft line break that sits straight in the box, between loose words", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "One<br>Two");
    expect(paragraphs()).toHaveLength(1);
    expect(
      paragraphs()[0]
        .runs.map((r) => r.text)
        .join(""),
    ).toBe("One\nTwo");
  });

  it("keeps a soft line break between the words of a line that also holds a nested line", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>Top<br>bottom<div>Nested</div></div>");
    expect(paragraphs().map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["Top\nbottom", "Nested"]);
  });

  it("reads a box that holds nothing but a line break as one empty line", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<br>");
    expect(paragraphs()).toHaveLength(1);
    expect(paragraphs()[0].runs.map((r) => r.text)).toEqual([""]);
  });

  it("reads text that sits straight in the box, before the first line", async () => {
    const { editor } = await openEditor();
    browserSets(editor, 'Loose <span style="font-weight: 700">words</span><div>Next</div>');
    expect(paragraphs()).toHaveLength(2);
    expect(paragraphs()[0].runs).toEqual([{ text: "Loose " }, { text: "words", bold: true }]);
    expect(paragraphs()[1].runs).toEqual([{ text: "Next" }]);
  });

  it("splits nested blocks into paragraphs and starts a new one after loose text", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>before<div>inner one</div><div>inner two</div>after</div>");
    expect(paragraphs().map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["before", "inner one", "inner two", "after"]);
  });

  it("ignores comments and other markup that carries no text inside a line", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>kept<!-- a note --></div>");
    expect(paragraphs()).toEqual([{ runs: [{ text: "kept" }] }]);
  });

  it("keeps consecutive loose pieces of a line together when a block follows them", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>a<span>b</span><div>c</div></div>");
    expect(paragraphs().map((p) => p.runs.map((r) => r.text).join(""))).toEqual(["ab", "c"]);
  });

  it("finds a block that sits inside an inline wrapper", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div><span>before<div>inside</div></span></div>");
    expect(
      paragraphs()
        .map((p) => p.runs.map((r) => r.text).join(""))
        .sort(),
    ).toEqual(["before", "inside"]);
  });

  it("reads list items and other block tags as paragraphs", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<ul><li>Apples</li><li>Pears</li></ul><p>Done</p><h2>Title</h2>");
    expect(paragraphs().map((p) => p.runs[0].text)).toEqual(["Apples", "Pears", "Done", "Title"]);
  });

  it("reads the list type and alignment of a paragraph, and ignores an unknown list type", async () => {
    const { editor } = await openEditor();
    browserSets(editor, '<div data-list="bullet" style="text-align: center">Item</div><div data-list="number">Two</div><div data-list="bogus">Three</div>');
    expect(paragraphs()[0]).toMatchObject({ list: "bullet", align: "center" });
    expect(paragraphs()[1].list).toBe("number");
    expect(paragraphs()[2].list).toBeUndefined();
  });

  it("drops zero width spaces and ignores comments", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>a​b</div><div>​</div>");
    editor.append(document.createComment("note"));
    fireEvent.input(editor);
    expect(paragraphs().map((p) => p.runs[0].text)).toEqual(["ab", ""]);
  });

  it("leaves one empty paragraph when the box is emptied", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "");
    expect(paragraphs()).toEqual([{ runs: [{ text: "" }] }]);
  });

  it("detects bold, italic, underline and strike-through from the computed style", async () => {
    const { editor } = await openEditor();
    browserSets(
      editor,
      '<div><span style="font-weight: 700">b</span><span style="font-style: italic">i</span><span style="text-decoration-line: underline">u</span><span style="text-decoration-line: line-through">s</span></div>',
    );
    expect(paragraphs()[0].runs).toEqual([
      { text: "b", bold: true },
      { text: "i", italic: true },
      { text: "u", underline: true },
      { text: "s", strike: true },
    ]);
  });

  it("carries a decoration down from an outer span to the text inside it", async () => {
    const { editor } = await openEditor();
    browserSets(editor, '<div><span style="text-decoration-line: underline"><span style="font-style: italic">both</span></span></div>');
    expect(paragraphs()[0].runs).toEqual([{ text: "both", italic: true, underline: true }]);
  });

  it("detects colour, size and font", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div><span style=\"color: rgb(255, 0, 0); font-size: 80px; font-family: 'Playfair Display', serif\">big</span></div>");
    expect(paragraphs()[0].runs).toEqual([{ text: "big", color: "#ff0000", size: 80, font: "Playfair Display" }]);
  });

  it("reads a font that is not in the catalogue by its CSS name", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div><span style=\"font-family: 'Papyrus', fantasy\">odd</span></div>");
    expect(paragraphs()[0].runs[0].font).toBe("Papyrus");
  });

  it("measures sizes at the current zoom", async () => {
    const { editor } = await openEditor();
    act(() => getActions().setZoom(2));
    browserSets(editor, '<div><span style="font-size: 160px">big</span></div>');
    expect(paragraphs()[0].runs[0].size).toBe(80);
  });

  it("ignores size differences smaller than a pixel", async () => {
    const { editor } = await openEditor();
    browserSets(editor, '<div><span style="font-size: 40.4px">same</span></div>');
    expect(paragraphs()[0].runs[0].size).toBeUndefined();
  });

  it("notes when a run is not bold in a bold text, or has a colour other than the gradient's", async () => {
    const { editor } = await openEditor({ fontWeight: 700 });
    browserSets(editor, '<div><span style="font-weight: 400">light</span></div>');
    expect(paragraphs()[0].runs[0].bold).toBe(false);
  });

  it("measures runs against the first stop of a gradient", async () => {
    const { editor } = await openEditor({
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    browserSets(editor, '<div><span style="color: rgb(255, 0, 0)">same</span><span style="color: rgb(0, 0, 255)">other</span></div>');
    expect(paragraphs()[0].runs).toEqual([{ text: "same" }, { text: "other", color: "#0000ff" }]);
  });

  it("merges neighbouring runs that look the same", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div><span>one </span><span>two </span>three</div>");
    expect(paragraphs()[0].runs).toEqual([{ text: "one two three" }]);
  });

  it("re-measures the box while typing", async () => {
    const { editor } = await openEditor({ autoWidth: true, width: 100 });
    const before = model().width;
    browserSets(editor, "<div>A considerably longer line of text</div>");
    expect(model().width).toBeGreaterThan(before);
  });

  it("makes typing one undo step per burst", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>a</div>");
    browserSets(editor, "<div>ab</div>");
    browserSets(editor, "<div>abc</div>");
    expect(state().past).toHaveLength(1);
    act(() => getActions().undo());
    expect(paragraphs()[0].runs[0].text).toBe("Hello world");
  });
});

describe("keys and pointer", () => {
  it("keeps typed keys away from the editor's shortcuts", async () => {
    const { rig, editor } = await openEditor();
    act(() => getActions().select(["t"]));
    const seen = vi.fn();
    window.addEventListener("keydown", seen);
    fireEvent.keyDown(editor, { key: "Delete" });
    fireEvent.keyDown(editor, { key: "t" });
    window.removeEventListener("keydown", seen);
    expect(seen).not.toHaveBeenCalled();
    expect(state().editingTextId).toBe("t");
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBe(editor);
  });

  it("Escape saves the text and leaves editing", async () => {
    const { rig, editor } = await openEditor();
    editor.innerHTML = "<div>Changed</div>";
    expect(fireEvent.keyDown(editor, { key: "Escape" })).toBe(false);
    expect(paragraphs()[0].runs[0].text).toBe("Changed");
    expect(state().editingTextId).toBeNull();
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeNull();
  });

  it("Tab does not move the focus out of the box", async () => {
    const { editor } = await openEditor();
    expect(fireEvent.keyDown(editor, { key: "Tab" })).toBe(false);
    expect(state().editingTextId).toBe("t");
  });

  it("pastes plain text only", async () => {
    const { editor } = await openEditor();
    const exec = vi.spyOn(document, "execCommand").mockReturnValue(true);
    expect(fireEvent.paste(editor, { clipboardData: { getData: (type: string) => (type === "text/plain" ? "from outside" : "<b>from outside</b>") } })).toBe(false);
    expect(exec).toHaveBeenCalledWith("insertText", false, "from outside");
    exec.mockClear();
    fireEvent.paste(editor, { clipboardData: { getData: () => "" } });
    expect(exec).not.toHaveBeenCalled();
  });

  it("keeps pointer presses inside the box from reaching the rest of the page", async () => {
    const { editor } = await openEditor();
    const seen = vi.fn();
    document.body.addEventListener("pointerdown", seen);
    fireEvent.pointerDown(editor, { pointerId: 1 });
    document.body.removeEventListener("pointerdown", seen);
    expect(seen).not.toHaveBeenCalled();
  });

  it("refuses dropped content", async () => {
    const { editor } = await openEditor();
    expect(fireEvent.drop(editor)).toBe(false);
  });
});

describe("following the selection", () => {
  it("tells the toolbar about the formatting at the caret and whether text is selected", async () => {
    const { editor } = await openEditor({ fontWeight: 700 });
    expect(useTextSelectionStyle.getState()).toMatchObject({ active: true, collapsed: true });
    expect(useTextSelectionStyle.getState().style).toMatchObject({
      bold: true,
      italic: false,
      underline: false,
      strike: false,
      color: "#0e1318",
      size: 40,
      font: "Plus Jakarta Sans",
    });
    editor.innerHTML = '<div><span style="font-weight: 400; font-style: italic; color: rgb(255, 0, 0); font-size: 20px; text-decoration-line: underline">small red</span></div>';
    select(editor, 0, 5);
    await waitFor(() => expect(useTextSelectionStyle.getState().collapsed).toBe(false));
    expect(useTextSelectionStyle.getState().style).toMatchObject({ bold: false, italic: true, underline: true, color: "#ff0000", size: 20 });
    expect(textEditing.hasSelection()).toBe(true);
  });

  it("ignores a selection somewhere else on the page", async () => {
    await openEditor();
    const elsewhere = document.body.appendChild(document.createElement("p"));
    elsewhere.textContent = "outside";
    const before = useTextSelectionStyle.getState();
    select(elsewhere, 0, 3);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(useTextSelectionStyle.getState()).toBe(before);
  });

  it("is switched off again when editing ends", async () => {
    await openEditor();
    expect(textEditing.isActive()).toBe(true);
    act(() => getActions().endTextEdit());
    expect(textEditing.isActive()).toBe(false);
    expect(useTextSelectionStyle.getState()).toMatchObject({ active: false, collapsed: true, style: {} });
  });
});

describe("formatting the selected characters", () => {
  /** A stand-in for the browser's editing commands: wraps the current selection in a span carrying the style. */
  function fakeBrowser() {
    const queries = new Map<string, boolean>();
    const wrap = (style: (span: HTMLElement) => void, tag = "span") => {
      const range = window.getSelection()!.getRangeAt(0);
      const el = document.createElement(tag);
      style(el);
      el.appendChild(range.extractContents());
      range.insertNode(el);
      window.getSelection()!.removeAllRanges();
      const after = document.createRange();
      after.selectNodeContents(el);
      window.getSelection()!.addRange(after);
      return el;
    };
    const exec = vi.spyOn(document, "execCommand").mockImplementation((name: string, _ui?: boolean, value?: string) => {
      if (name === "bold") wrap((s) => (s.style.fontWeight = "700"));
      else if (name === "italic") wrap((s) => (s.style.fontStyle = "italic"));
      else if (name === "underline") wrap((s) => (s.style.textDecorationLine = "underline"));
      else if (name === "strikeThrough") wrap((s) => (s.style.textDecorationLine = "line-through"));
      else if (name === "foreColor") wrap((s) => (s.style.color = value ?? ""));
      else if (name === "fontName") wrap((s) => (s.style.fontFamily = value ?? ""));
      else if (name === "fontSize") wrap((s) => s.setAttribute("size", "7"), "font");
      return true;
    });
    Object.defineProperty(document, "queryCommandState", { configurable: true, writable: true, value: vi.fn((name: string) => queries.get(name) ?? false) });
    return { exec, queries };
  }

  async function withSelection(extra: Partial<TextElement> = {}) {
    const { rig, editor } = await openEditor(extra);
    select(editor, 0, 5);
    await waitFor(() => expect(textEditing.hasSelection()).toBe(true));
    return { rig, editor };
  }

  it("does nothing while only a caret is placed", async () => {
    const { exec } = fakeBrowser();
    await openEditor();
    expect(textEditing.hasSelection()).toBe(false);
    expect(applyInline({ bold: true })).toBe(false);
    expect(exec).not.toHaveBeenCalled();
  });

  it("makes the selected characters bold and stores them as a bold run", async () => {
    const { exec } = fakeBrowser();
    await withSelection();
    expect(applyInline({ bold: true })).toBe(true);
    expect(exec).toHaveBeenCalledWith("styleWithCSS", false, "true");
    expect(exec).toHaveBeenCalledWith("bold", false, undefined);
    expect(paragraphs()[0].runs).toEqual([{ text: "Hello", bold: true }, { text: " world" }]);
  });

  it("toggles only the styles that differ from what is selected now", async () => {
    const { exec, queries } = fakeBrowser();
    await withSelection();
    queries.set("italic", true);
    applyInline({ bold: false, italic: true, underline: true, strike: true });
    const names = exec.mock.calls.map((c) => c[0]);
    expect(names).not.toContain("bold");
    expect(names).not.toContain("italic");
    expect(names).toEqual(expect.arrayContaining(["underline", "strikeThrough"]));
  });

  it("applies colour and font", async () => {
    const { exec } = fakeBrowser();
    await withSelection();
    applyInline({ color: "#ff0000", font: "Playfair Display" });
    expect(exec).toHaveBeenCalledWith("foreColor", false, "#ff0000");
    expect(exec).toHaveBeenCalledWith("fontName", false, expect.stringContaining("Playfair Display"));
    expect(paragraphs()[0].runs[0]).toMatchObject({ text: "Hello", color: "#ff0000", font: "Playfair Display" });
  });

  it("sizes the selection in design pixels at the current zoom and keeps it selected", async () => {
    fakeBrowser();
    const { editor } = await withSelection();
    expect(applyInline({ size: 90 })).toBe(true);
    expect(editor.querySelector("font")).toBeNull();
    expect(editor.querySelector<HTMLElement>("span span")!.style.fontSize).toBe("90px");
    expect(paragraphs()[0].runs[0]).toEqual({ text: "Hello", size: 90 });
    expect(window.getSelection()?.toString()).toBe("Hello");
    // zooming leaves the box and its selection as they are, so the next size goes to the same characters
    act(() => getActions().setZoom(2));
    expect(editor.querySelector<HTMLElement>("span span")!.style.fontSize).toBe("180px");
    expect(window.getSelection()?.toString()).toBe("Hello");
    expect(applyInline({ size: 50 })).toBe(true);
    // 50 design pixels are 100 on screen at this zoom (the stand-in browser wraps the old span instead of restyling it)
    expect(Array.from(editor.querySelectorAll<HTMLElement>("span")).some((span) => span.style.fontSize === "100px")).toBe(true);
    expect(window.getSelection()?.toString()).toBe("Hello");
  });

  it("does not touch the box when the browser leaves no sized fragment behind", async () => {
    const { exec } = fakeBrowser();
    exec.mockImplementation(() => true);
    const { editor } = await withSelection();
    const before = editor.innerHTML;
    expect(applyInline({ size: 90 })).toBe(true);
    expect(editor.innerHTML).toBe(before);
  });

  it("brings the box back into focus when the toolbar had taken it", async () => {
    fakeBrowser();
    const { editor } = await withSelection();
    const outside = document.body.appendChild(document.createElement("button"));
    outside.focus();
    textEditing.focus();
    expect(document.activeElement).toBe(editor);
    textEditing.focus();
    expect(document.activeElement).toBe(editor);
    outside.focus();
    applyInline({ bold: true });
    expect(document.activeElement).toBe(editor);
  });
});

describe("keeping the editor and the document in step", () => {
  it("rescales the sizes in the box when the zoom changes", async () => {
    const { editor } = await openEditor({ paragraphs: [{ runs: [{ text: "Big", size: 80 }] }] });
    expect(editor.querySelector<HTMLElement>("span")!.style.fontSize).toBe("80px");
    act(() => getActions().setZoom(2));
    expect(editor.querySelector<HTMLElement>("span")!.style.fontSize).toBe("160px");
    expect(editor.textContent).toBe("Big");
  });

  it("keeps the selected characters selected when the zoom changes, so the next format still applies to them", async () => {
    const { editor } = await openEditor({ paragraphs: [{ runs: [{ text: "Hello", size: 80 }, { text: " bold", bold: true }, { text: " world" }] }] });
    const [sized, bold] = Array.from(editor.querySelectorAll<HTMLElement>("span"));
    select(editor, 1, 4);
    await waitFor(() => expect(textEditing.hasSelection()).toBe(true));
    act(() => getActions().setZoom(2));
    expect(window.getSelection()?.toString()).toBe("ell");
    expect(textEditing.hasSelection()).toBe(true);
    // the very same nodes are still in the box: the sized one is rescaled, the others are left as they were
    expect(editor.contains(sized)).toBe(true);
    expect(sized.style.fontSize).toBe("160px");
    expect(bold.style.fontSize).toBe("");
    expect(bold.style.fontWeight).toBe("700");
  });

  it("does not let a size drift when the zoom goes back and forth", async () => {
    const { editor } = await openEditor({ paragraphs: [{ runs: [{ text: "Big", size: 80 }] }] });
    for (const zoom of [0.37, 1.13, 0.61, 3.3, 1]) act(() => getActions().setZoom(zoom));
    expect(editor.querySelector<HTMLElement>("span")!.style.fontSize).toBe("80px");
    fireEvent.input(editor);
    expect(paragraphs()[0].runs[0].size).toBe(80);
  });

  it("follows list and alignment changes made from the toolbar", async () => {
    const { editor } = await openEditor();
    act(() => getActions().setTextProps(["t"], { list: "bullet" }));
    expect(Array.from(editor.children).every((c) => c.getAttribute("data-list") === "bullet")).toBe(true);
    act(() => getActions().setTextProps(["t"], { list: null }));
    expect(editor.querySelector("[data-list]")).toBeNull();
    (editor.firstElementChild as HTMLElement).style.textAlign = "right";
    act(() => getActions().setTextProps(["t"], { align: "center" }));
    expect((editor.firstElementChild as HTMLElement).style.textAlign).toBe("");
    expect(editor.style.textAlign).toBe("center");
  });

  it("does not rebuild or re-sync when nothing relevant changed", async () => {
    const { editor } = await openEditor();
    const first = editor.firstElementChild;
    act(() => getActions().setTextProps(["t"], { color: "#ff0000" }));
    expect(editor.firstElementChild).toBe(first);
  });
});

describe("leaving the editor", () => {
  it("removes a text box that was left empty", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "");
    act(() => getActions().endTextEdit());
    expect(currentPage().elements.find((e) => e.id === "t")).toBeUndefined();
  });

  it("removes a text box that only holds blanks", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>  ​ </div>");
    act(() => getActions().endTextEdit());
    expect(currentPage().elements.find((e) => e.id === "t")).toBeUndefined();
  });

  it("keeps a text box that has text", async () => {
    const { editor } = await openEditor();
    browserSets(editor, "<div>Still here</div>");
    act(() => getActions().endTextEdit());
    expect(model().paragraphs[0].runs[0].text).toBe("Still here");
  });

  it("copes with the element having been deleted meanwhile", async () => {
    const { rig, editor } = await openEditor();
    browserSets(editor, "");
    act(() => getActions().deleteElements(["t"]));
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeNull();
    expect(currentPage().elements).toHaveLength(0);
  });

  it("is replaced when another text is edited", async () => {
    const rig = await mountWorkspace(canvasDesign([text(), createText({ id: "t2", text: "Second", x: 100, y: 300, width: 300, fontSize: 30 })]));
    act(() => getActions().startTextEdit("t"));
    act(() => getActions().startTextEdit("t2"));
    const editors = rig.container.querySelectorAll("[data-cf-text-editor]");
    expect(editors).toHaveLength(1);
    expect(editors[0].textContent).toBe("Second");
  });
});

describe("under React's strict mode", () => {
  it("still selects all the text of a new text box although the opening effect runs twice", async () => {
    markSelectAllOnEdit();
    const rig = await mountWorkspace(canvasDesign([text()]), undefined, { strict: true });
    act(() => getActions().startTextEdit("t"));
    expect(rig.container.querySelector("[data-cf-text-editor]")).toBeTruthy();
    expect(window.getSelection()?.toString()).toBe("Hello world");
  });
});
