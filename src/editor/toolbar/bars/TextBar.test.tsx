import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGroup, createShape, createText } from "@/core/factory";
import type { GroupElement, TextElement } from "@/core/types";
import { registerTextEditor, useTextSelectionStyle } from "@/editor/canvas/textEditing";
import { ContextHost, live, openElements, store, typeNumber } from "@/test/ctxUtils";
import { resetEditor, stubLayout } from "@/test/helpers";
import { FloatingToolbar } from "../FloatingToolbar";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout();
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
});
afterEach(() => {
  restoreLayout();
  registerTextEditor(null);
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
});

const word = (extra: Parameters<typeof createText>[0] = {}) => createText({ text: "Hello world", fontSize: 40, fontFamily: "Inter", x: 50, y: 50, ...extra });
const mount = (elements: TextElement[], selected: TextElement[] = elements) => {
  openElements(elements, { selected });
  return render(
    <>
      <FloatingToolbar />
      <ContextHost />
    </>,
  );
};
const bar = () => screen.getByRole("toolbar", { name: "Selected element common controls" });
const btn = (name: string | RegExp) => within(bar()).getByRole("button", { name }) as HTMLButtonElement;
const size = () => within(bar()).getByRole("spinbutton", { name: "Font size" }) as HTMLInputElement;
const pressed = (el: HTMLElement) => el.getAttribute("aria-pressed");

describe("Text toolbar: font and size", () => {
  it("shows the font and opens the font panel from it", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const font = btn("Toggle font selector, current font: Inter");
    expect(font.textContent).toContain("Inter");
    expect(pressed(font)).toBe("false");
    await user.click(font);
    expect(store().context).toEqual({ kind: "font" });
    expect(pressed(btn(/Toggle font selector/))).toBe("true");
    expect(screen.getByRole("region", { name: "Font" })).toBeTruthy();
    await user.click(btn(/Toggle font selector/));
    expect(store().context).toBeNull();
  });

  it("says 'Multiple fonts' when the selection uses several", () => {
    const a = word({ fontFamily: "Lora" });
    const b = word({ fontFamily: "Inter" });
    mount([a, b]);
    expect(btn(/Toggle font selector/).textContent).toContain("Multiple fonts");
    expect(btn(/Toggle font selector/).getAttribute("aria-label")).toBe("Toggle font selector, current font: multiple fonts");
  });

  it("steps the font size with + and -, and types a size", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    expect(size().value).toBe("40");
    await user.click(btn("Increase Font size"));
    expect(live<TextElement>(t).fontSize).toBe(41);
    await user.click(btn("Decrease Font size"));
    await user.click(btn("Decrease Font size"));
    expect(live<TextElement>(t).fontSize).toBe(39);
    await typeNumber(user, size(), "80");
    expect(live<TextElement>(t).fontSize).toBe(80);
    await typeNumber(user, size(), "9999");
    expect(live<TextElement>(t).fontSize).toBe(1500);
    await typeNumber(user, size(), "0");
    expect(live<TextElement>(t).fontSize).toBe(1);
  });

  it("groups quick size steps into one undo step", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const before = store().past.length;
    await user.click(btn("Increase Font size"));
    await user.click(btn("Increase Font size"));
    await user.click(btn("Increase Font size"));
    expect(live<TextElement>(t).fontSize).toBe(43);
    expect(store().past.length).toBe(before + 1);
  });

  it("leaves the size blank for texts of different sizes and steps from the first one", async () => {
    const user = userEvent.setup();
    const [a, b] = [word({ fontSize: 40 }), word({ fontSize: 60 })];
    mount([a, b]);
    expect(size().value).toBe("");
    await user.click(btn("Increase Font size"));
    expect(live<TextElement>(a).fontSize).toBe(41);
    expect(live<TextElement>(b).fontSize).toBe(41);
    expect(size().value).toBe("41");
  });

  it("steps down from a mixed size too", async () => {
    const user = userEvent.setup();
    const [a, b] = [word({ fontSize: 40 }), word({ fontSize: 60 })];
    mount([a, b]);
    await user.click(btn("Decrease Font size"));
    expect(live<TextElement>(a).fontSize).toBe(39);
    expect(live<TextElement>(b).fontSize).toBe(39);
  });

  it("ignores a size that is not a number", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    await user.click(size());
    await user.clear(size());
    await user.type(size(), "abc{Enter}");
    expect(live<TextElement>(t).fontSize).toBe(40);
  });
});

describe("Text toolbar: colour", () => {
  it("opens the colour panel and paints the bar under the A with the text colour", async () => {
    const user = userEvent.setup();
    const t = word({ color: "#aa3300" });
    mount([t]);
    const colour = btn("Text color");
    expect((colour.querySelector(".cf-tb__tbar") as HTMLElement).style.getPropertyValue("--cf-sw")).toBe("#aa3300");
    await user.click(colour);
    expect(store().context).toEqual({ kind: "color", target: "text" });
    expect(pressed(btn("Text color"))).toBe("true");
  });

  it("shows a gradient, and a rainbow bar when the colours differ", () => {
    const gradient = word({
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    const view = mount([gradient]);
    expect((btn("Text color").querySelector(".cf-tb__tbar") as HTMLElement).style.getPropertyValue("--cf-sw")).toContain("linear-gradient(90deg");
    view.unmount();
    resetEditor();
    mount([word({ color: "#ff0000" }), word({ color: "#00ff00" })]);
    // the bar shows every colour of the palette instead of one of them
    expect((btn("Text color").querySelector(".cf-tb__tbar") as HTMLElement).style.getPropertyValue("--cf-sw")).toContain("var(--c-danger), var(--c-warning)");
  });
});

describe("Text toolbar: character styles", () => {
  it("toggles bold, italic, underline and strikethrough", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough"]) expect(pressed(btn(name))).toBe("false");
    await user.click(btn("Bold"));
    await user.click(btn("Italic"));
    await user.click(btn("Underline"));
    await user.click(btn("Strikethrough"));
    expect(live<TextElement>(t)).toMatchObject({ fontWeight: 700, italic: true, underline: true, strike: true });
    for (const name of ["Bold", "Italic", "Underline", "Strikethrough"]) expect(pressed(btn(name))).toBe("true");
    await user.click(btn("Bold"));
    await user.click(btn("Italic"));
    await user.click(btn("Underline"));
    await user.click(btn("Strikethrough"));
    expect(live<TextElement>(t)).toMatchObject({ fontWeight: 400, italic: false, underline: false, strike: false });
  });

  it("reads a half-bold text as mixed and makes all of it bold on the next click", async () => {
    const user = userEvent.setup();
    const t = word({ paragraphs: [{ runs: [{ text: "Hello ", bold: true }, { text: "world" }] }] });
    mount([t]);
    expect(pressed(btn("Bold"))).toBe("mixed");
    await user.click(btn("Bold"));
    expect(live<TextElement>(t).fontWeight).toBe(700);
    expect(pressed(btn("Bold"))).toBe("true");
  });

  it("answers Ctrl+B, Ctrl+I and Ctrl+U on a selected text, but not while typing in a field", () => {
    const t = word();
    mount([t]);
    const key = (init: KeyboardEventInit, target: Window | Element = window) => fireEvent.keyDown(target, init);
    key({ key: "b", ctrlKey: true });
    key({ key: "i", metaKey: true });
    key({ key: "U", ctrlKey: true });
    expect(live<TextElement>(t)).toMatchObject({ fontWeight: 700, italic: true, underline: true });
    // other combinations do nothing
    key({ key: "b", ctrlKey: true, shiftKey: true });
    key({ key: "b", ctrlKey: true, altKey: true });
    key({ key: "k", ctrlKey: true });
    key({ key: "b" });
    expect(live<TextElement>(t).fontWeight).toBe(700);
    key({ key: "b", ctrlKey: true }, size());
    expect(live<TextElement>(t).fontWeight).toBe(700);
  });

  it("cycles the text case and starts from upper case when the cases differ", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const cycle: Array<[string, TextElement["textCase"]]> = [
      ["Text case: Normal case", "upper"],
      ["Text case: Uppercase", "lower"],
      ["Text case: Lowercase", "title"],
      ["Text case: Title case", "none"],
    ];
    for (const [label, next] of cycle) {
      await user.click(btn(label));
      expect(live<TextElement>(t).textCase).toBe(next);
    }
  });

  it("applies upper case to texts with different cases", async () => {
    const user = userEvent.setup();
    const [a, b] = [word({ textCase: "lower" }), word({ textCase: "none" })];
    mount([a, b]);
    expect(pressed(btn("Text case: Normal case"))).toBe("mixed");
    await user.click(btn("Text case: Normal case"));
    expect(live<TextElement>(a).textCase).toBe("upper");
    expect(live<TextElement>(b).textCase).toBe("upper");
  });
});

describe("Text toolbar: paragraph", () => {
  it("cycles the alignment through left, center, right and justified", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    for (const [now, next] of [
      ["Left", "center"],
      ["Center", "right"],
      ["Right", "justify"],
      ["Justified", "left"],
    ] as const) {
      await user.click(btn(`Toggle text alignment, current alignment: ${now}`));
      expect(live<TextElement>(t).align).toBe(next);
    }
  });

  it("sets one alignment for every paragraph when they differ", async () => {
    const user = userEvent.setup();
    const t = word({ text: "one\ntwo", align: "left" });
    t.paragraphs[1].align = "right";
    mount([t]);
    expect(pressed(btn("Toggle text alignment, current alignment: mixed"))).toBe("mixed");
    await user.click(btn("Toggle text alignment, current alignment: mixed"));
    expect(live<TextElement>(t).align).toBe("center");
    expect(live<TextElement>(t).paragraphs.every((p) => p.align === undefined)).toBe(true);
  });

  it("cycles the list style: none, bullets, numbers", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    await user.click(btn("List: No list"));
    expect(live<TextElement>(t).list).toBe("bullet");
    expect(pressed(btn("List: Bulleted list"))).toBe("true");
    await user.click(btn("List: Bulleted list"));
    expect(live<TextElement>(t).list).toBe("number");
    await user.click(btn("List: Numbered list"));
    expect(live<TextElement>(t).list).toBeNull();
  });

  it("starts a bulleted list when the paragraphs disagree", async () => {
    const user = userEvent.setup();
    const t = word({ text: "one\ntwo" });
    t.paragraphs[1].list = "number";
    mount([t]);
    await user.click(btn("List (mixed)"));
    expect(live<TextElement>(t).list).toBe("bullet");
    expect(live<TextElement>(t).paragraphs.every((p) => p.list === undefined)).toBe(true);
  });

  it("sets letter and line spacing from the advanced settings", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    await user.click(btn("Advanced settings"));
    const dialog = screen.getByRole("dialog", { name: "Advanced settings" });
    expect(btn("Advanced settings").getAttribute("aria-expanded")).toBe("true");
    await typeNumber(user, within(dialog).getByRole("spinbutton", { name: "Letter spacing value" }), "120");
    expect(live<TextElement>(t).letterSpacing).toBe(120);
    within(dialog).getByRole("slider", { name: "Line spacing" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(live<TextElement>(t).lineHeight).toBeCloseTo(1.3);
    await typeNumber(user, within(dialog).getByRole("spinbutton", { name: "Line spacing value" }), "2");
    expect(live<TextElement>(t).lineHeight).toBe(2);
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Advanced settings" })).toBeNull();
  });

  it("leaves the spacing fields blank when the texts differ", async () => {
    const user = userEvent.setup();
    mount([word({ letterSpacing: 0 }), word({ letterSpacing: 50 })]);
    await user.click(btn("Advanced settings"));
    expect((screen.getByRole("spinbutton", { name: "Letter spacing value" }) as HTMLInputElement).value).toBe("");
  });
});

describe("Text toolbar: shared controls", () => {
  it("changes the transparency", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    await user.click(btn("Transparency"));
    const dialog = screen.getByRole("dialog", { name: "Transparency" });
    await typeNumber(user, within(dialog).getByRole("spinbutton", { name: "Transparency value" }), "40");
    expect(live<TextElement>(t).opacity).toBe(0.4);
    within(dialog).getByRole("slider", { name: "Transparency" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(live<TextElement>(t).opacity).toBe(0.41);
  });

  it("opens Effects, Animate and Position, each toggling its panel", async () => {
    const user = userEvent.setup();
    mount([word()]);
    for (const [name, context] of [
      ["Effects", { kind: "effects" }],
      ["Animate", { kind: "animate", tab: "element" }],
      ["Position", { kind: "position", tab: "arrange" }],
    ] as const) {
      await user.click(btn(name));
      expect(store().context).toEqual(context);
      expect(pressed(btn(name))).toBe("true");
    }
    await user.click(btn("Position"));
    expect(store().context).toBeNull();
    expect(pressed(btn("Position"))).toBe("false");
  });

  it("copies the style of a text and pastes it on another one", async () => {
    const user = userEvent.setup();
    const [source, target] = [word({ color: "#aa0000", fontSize: 90, fontFamily: "Lora" }), word()];
    mount([source, target], [source]);
    await user.click(btn("Copy style"));
    expect(store().styleClipboard).toMatchObject({ __type: "text", fontSize: 90, fontFamily: "Lora" });
    act(() => store().actions.select([target.id]));
    await user.click(btn("Paste style"));
    expect(live<TextElement>(target)).toMatchObject({ fontSize: 90, color: "#aa0000", fontFamily: "Lora" });
    // pasting once clears the clipboard, like a format painter
    expect(store().styleClipboard).toBeNull();
    expect(screen.queryByRole("button", { name: "Paste style" })).toBeNull();
    expect(btn("Copy style")).toBeTruthy();
  });

  it("offers the same actions as a right click behind '...'", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    await user.click(btn("More actions"));
    const menu = screen.getByRole("menu", { name: "More actions" });
    expect(within(menu).getByRole("menuitem", { name: /^Duplicate/ })).toBeTruthy();
    await user.click(within(menu).getByRole("menuitem", { name: /^Duplicate/ }));
    expect(store().design!.pages[0].elements).toHaveLength(2);
  });

  it("groups and aligns several texts", async () => {
    const user = userEvent.setup();
    const [a, b] = [word({ x: 100, y: 100 }), word({ x: 400, y: 300 })];
    mount([a, b]);
    expect(btn("Group")).toBeTruthy();
    await user.click(btn("Align"));
    await user.click(screen.getByRole("menuitem", { name: "Left" }));
    expect(live<TextElement>(b).x).toBe(live<TextElement>(a).x);
    // distributing needs three
    await user.click(btn("Align"));
    expect(screen.getByRole("menuitem", { name: /Distribute horizontally/ }).getAttribute("aria-disabled")).toBe("true");
    await user.keyboard("{Escape}");
    await user.click(btn("Group"));
    expect(store().selection).toHaveLength(1);
    expect(live<GroupElement>(store().selection[0]).children).toHaveLength(2);
  });
});

describe("Text toolbar: a box that is being edited", () => {
  const editor = () => {
    const root = document.createElement("div");
    root.setAttribute("data-cf-text-editor", "");
    root.setAttribute("contenteditable", "true");
    root.tabIndex = 0;
    const block = document.createElement("div");
    block.setAttribute("data-list", "");
    block.textContent = "Hello world";
    root.appendChild(block);
    document.body.appendChild(root);
    return root;
  };
  const startEditing = (t: TextElement, style: Partial<{ bold: boolean; italic: boolean; size: number; font: string; color: string }> = {}, collapsed = false) => {
    act(() => {
      store().actions.startTextEdit(t.id);
      useTextSelectionStyle.setState({ active: true, collapsed, style });
    });
  };

  it("formats only the selected characters and shows their style", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const applyInline = vi.fn(() => true);
    registerTextEditor({ applyInline, hasSelection: () => true, focus: () => undefined });
    startEditing(t, { bold: true, size: 64, font: "Lora", color: "#cc0000" });
    expect(btn("Toggle font selector, current font: Lora")).toBeTruthy();
    expect(size().value).toBe("64");
    expect(pressed(btn("Bold"))).toBe("true");
    expect((btn("Text color").querySelector(".cf-tb__tbar") as HTMLElement).style.getPropertyValue("--cf-sw")).toBe("#cc0000");

    await user.click(btn("Bold"));
    expect(applyInline).toHaveBeenLastCalledWith({ bold: false });
    await user.click(btn("Italic"));
    expect(applyInline).toHaveBeenLastCalledWith({ italic: true });
    await user.click(btn("Underline"));
    expect(applyInline).toHaveBeenLastCalledWith({ underline: true });
    await user.click(btn("Strikethrough"));
    expect(applyInline).toHaveBeenLastCalledWith({ strike: true });
    await user.click(btn("Increase Font size"));
    expect(applyInline).toHaveBeenLastCalledWith({ size: 65 });
    // the box itself is untouched
    expect(live<TextElement>(t)).toMatchObject({ fontWeight: 400, italic: false, fontSize: 40 });
  });

  it("styles the whole box when the editor only has a caret", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const applyInline = vi.fn(() => false);
    registerTextEditor({ applyInline, hasSelection: () => false, focus: () => undefined });
    startEditing(t, {}, true);
    await user.click(btn("Bold"));
    expect(live<TextElement>(t).fontWeight).toBe(700);
    expect(applyInline).not.toHaveBeenCalled();
  });

  it("falls back to the whole box when the selection cannot be formatted", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    registerTextEditor({ applyInline: () => false, hasSelection: () => true, focus: () => undefined });
    startEditing(t, { size: 30 });
    await user.click(btn("Increase Font size"));
    expect(live<TextElement>(t).fontSize).toBe(31);
  });

  it("selects the same characters again after a size change so + can be repeated", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const root = editor();
    const text = root.firstChild!.firstChild as Text;
    document.getSelection()!.setBaseAndExtent(text, 0, text, 5);
    document.dispatchEvent(new Event("selectionchange"));
    registerTextEditor({
      applyInline: () => {
        // formatting swaps the DOM nodes and loses the selection
        document.getSelection()!.removeAllRanges();
        return true;
      },
      hasSelection: () => true,
      focus: () => undefined,
    });
    startEditing(t, { size: 40 });
    await user.click(btn("Increase Font size"));
    expect(document.getSelection()!.toString()).toBe("Hello");
  });

  it("gives the editor its focus back after the number field took it", () => {
    vi.useFakeTimers();
    const t = word();
    mount([t]);
    const root = editor();
    const focus = vi.fn();
    registerTextEditor({ applyInline: () => true, hasSelection: () => true, focus });
    startEditing(t, { size: 40 });
    root.focus();
    expect(document.activeElement).toBe(root);
    fireEvent.click(btn("Increase Font size"));
    // the number field re-selects its text a frame later and grabs the focus
    size().focus();
    act(() => void vi.advanceTimersByTime(100));
    expect(focus).toHaveBeenCalledTimes(1);
    // a second quick press while the first is pending only restarts the timer
    root.focus();
    fireEvent.click(btn("Increase Font size"));
    fireEvent.click(btn("Increase Font size"));
    size().focus();
    act(() => void vi.advanceTimersByTime(100));
    expect(focus).toHaveBeenCalledTimes(2);
    // when focus is somewhere else by then, the editor is left alone
    root.focus();
    fireEvent.click(btn("Increase Font size"));
    root.focus();
    act(() => void vi.advanceTimersByTime(100));
    expect(focus).toHaveBeenCalledTimes(2);
  });

  it("keeps the paragraph marks of the open editor in step with list and alignment changes", async () => {
    const user = userEvent.setup();
    const t = word();
    mount([t]);
    const root = editor();
    const block = root.firstElementChild as HTMLElement;
    block.style.textAlign = "right";
    startEditing(t, {}, true);
    await user.click(btn("List: No list"));
    expect(block.getAttribute("data-list")).toBe("bullet");
    await user.click(btn("List: Bulleted list"));
    await user.click(btn("List: Numbered list"));
    expect(block.hasAttribute("data-list")).toBe(false);
    await user.click(btn("Toggle text alignment, current alignment: Left"));
    expect(block.style.textAlign).toBe("");
  });

  it("formats the text that is being edited inside a group", async () => {
    const user = userEvent.setup();
    const inner = word({ text: "In a group" });
    const g = createGroup([createShape("rect"), inner], { x: 0, y: 0, width: 400, height: 200 });
    openElements([g], { selected: [g] });
    render(<FloatingToolbar />);
    act(() => {
      store().actions.startTextEdit(inner.id, g.id);
    });
    // the group stays selected while its text is edited: the text toolbar is shown, without copy style
    expect(bar()).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Copy style" })).toBeNull();
    await user.click(btn("Bold"));
    expect(live<TextElement>(inner).fontWeight).toBe(700);
  });
});
