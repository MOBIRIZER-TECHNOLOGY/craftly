import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createChart, createShape, createTable, createText } from "@/core/factory";
import { setBrandKit } from "@/core/library";
import type { ChartElement, TableElement, TextElement } from "@/core/types";
import { registerTextEditor, useTextSelectionStyle } from "@/editor/canvas/textEditing";
import { ensureFont, FONT_CATALOG } from "@/render/fonts";
import { live, openElements, showPanel, store } from "@/test/ctxUtils";
import { clearLibrary, flush, resetEditor } from "@/test/helpers";

/* watch which faces the panel asks for; the real loader still runs */
vi.mock("@/render/fonts", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/render/fonts")>();
  return { ...mod, ensureFont: vi.fn(mod.ensureFont) };
});

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  vi.mocked(ensureFont).mockClear();
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
});
afterEach(() => {
  registerTextEditor(null);
  useTextSelectionStyle.setState({ active: false, collapsed: true, style: {} });
  vi.unstubAllGlobals();
});

const text = (extra: Partial<TextElement> = {}) => createText({ text: "Font me", fontFamily: "Inter", x: 50, y: 50, ...extra });
const openFont = async () => {
  const view = showPanel({ kind: "font" });
  await flush();
  return view;
};
const heading = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}`) });
const section = (title: string) => heading(title).parentElement as HTMLElement;
const row = (family: string) => screen.getAllByRole("button", { name: family })[0];
const familiesIn = (title: string) =>
  within(section(title))
    .getAllByRole("button")
    .filter((b) => b.classList.contains("cf-font__row"))
    .map((b) => b.getAttribute("aria-label"));
const inCategory = (category: string) => FONT_CATALOG.filter((f) => f.category === category).map((f) => f.family);

describe("Font panel", () => {
  it("asks for a text box, table or chart", async () => {
    const s = createShape("rect");
    openElements([s], { selected: [s] });
    await openFont();
    expect(screen.getByRole("region", { name: "Font" })).toBeTruthy();
    expect(screen.getByText("No text selected")).toBeTruthy();
    expect(screen.queryByRole("searchbox")).toBeNull();
  });

  it("lists every font of the catalogue by category and marks the one the text has", async () => {
    const t = text({ fontFamily: "Lora" });
    openElements([t], { selected: [t] });
    await openFont();
    const titles = ["Sans serif", "Serif", "Display", "Script", "Handwriting", "Monospace"];
    for (const title of titles) expect(heading(title)).toBeTruthy();
    expect(familiesIn("Serif")).toEqual(inCategory("serif"));
    expect(familiesIn("Monospace")).toEqual(inCategory("mono"));
    const current = screen.getAllByRole("button", { name: "Lora" }).filter((b) => b.getAttribute("aria-current") === "true");
    expect(current.length).toBeGreaterThan(0);
    expect(row("Inter").getAttribute("aria-current")).toBeNull();
  });

  it("changes the font of the text once its face has loaded", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    await user.click(within(section("Serif")).getByRole("button", { name: "Playfair Display" }));
    await waitFor(() => expect(live<TextElement>(t).fontFamily).toBe("Playfair Display"));
    // the face was requested for the weight and style the text has
    expect(ensureFont).toHaveBeenCalledWith("Playfair Display", 400, false);
    expect(within(section("Serif")).getByRole("button", { name: "Playfair Display" }).getAttribute("aria-current")).toBe("true");
  });

  it("changes the font of a table and a chart together with the text", async () => {
    const user = userEvent.setup();
    const [t, table, chart] = [text(), createTable(), createChart()];
    openElements([t, table, chart], { selected: [t, table, chart] });
    await openFont();
    await user.click(within(section("Monospace")).getAllByRole("button")[0]);
    const mono = inCategory("mono")[0];
    await waitFor(() => expect(live<TextElement>(t).fontFamily).toBe(mono));
    expect(live<TableElement>(table).fontFamily).toBe(mono);
    expect(live<ChartElement>(chart).fontFamily).toBe(mono);
  });

  it("shows the font of a selected table when there is no text", async () => {
    const table = createTable({ fontFamily: "Lora" });
    openElements([table], { selected: [table] });
    await openFont();
    expect(screen.getAllByRole("button", { name: "Lora" }).some((b) => b.getAttribute("aria-current") === "true")).toBe(true);
  });

  it("lists the fonts the document already uses, most used first", async () => {
    const [a, b, c] = [text({ fontFamily: "Pacifico" }), text({ fontFamily: "Lora" }), text({ fontFamily: "Lora" })];
    openElements([a, b, c], { selected: [a] });
    await openFont();
    expect(familiesIn("Document fonts")).toEqual(["Lora", "Pacifico"]);
  });

  it("lists the brand fonts, and sends you to the Brand tab to change them", async () => {
    const user = userEvent.setup();
    await setBrandKit({ colors: [], fonts: ["Lobster", "Anton"], logos: [] });
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    await waitFor(() => expect(familiesIn("Brand fonts")).toEqual(["Lobster", "Anton"]));
    await user.click(within(section("Brand fonts")).getByRole("button", { name: "Edit" }));
    expect(store().leftTab).toBe("brand");
    expect(store().context).toBeNull();
  });

  it("invites you to add brand fonts when there are none", async () => {
    const user = userEvent.setup();
    await setBrandKit({ colors: [], fonts: [], logos: [] });
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    await user.click(await screen.findByRole("button", { name: "Add your brand fonts" }));
    expect(store().leftTab).toBe("brand");
  });

  it("filters by name and by category chip, and hides the shortcuts while filtering", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    await user.type(screen.getByRole("searchbox", { name: "Search fonts" }), "mono");
    expect(screen.queryByRole("heading", { name: /^Document fonts/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Brand fonts/ })).toBeNull();
    expect(screen.queryByRole("heading", { name: "Serif" })).toBeNull();
    expect(familiesIn("Monospace").length).toBeGreaterThan(0);
    expect(familiesIn("Monospace").every((f) => /mono/i.test(f ?? ""))).toBe(true);

    await user.clear(screen.getByRole("searchbox", { name: "Search fonts" }));
    const chips = within(screen.getByRole("group", { name: "Font categories" }));
    await user.click(chips.getByRole("button", { name: "Script" }));
    expect(chips.getByRole("button", { name: "Script" }).getAttribute("aria-pressed")).toBe("true");
    expect(chips.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("false");
    expect(heading("Script")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Serif" })).toBeNull();
    expect(screen.queryByRole("heading", { name: /^Document fonts/ })).toBeNull();
    // the chip is a toggle; "All" also clears it
    await user.click(chips.getByRole("button", { name: "Script" }));
    expect(heading("Serif")).toBeTruthy();
    await user.click(chips.getByRole("button", { name: "Serif" }));
    await user.click(chips.getByRole("button", { name: "All" }));
    expect(heading("Sans serif")).toBeTruthy();
  });

  it("says when no font matches", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    await user.type(screen.getByRole("searchbox", { name: "Search fonts" }), "qqqq");
    expect(screen.getByText(/No fonts match/)).toBeTruthy();
    expect(screen.queryAllByRole("heading", { level: 3 })).toHaveLength(0);
  });

  it("moves between the fonts with the arrow keys", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    const rows = Array.from(document.querySelectorAll<HTMLElement>(".cf-font__row"));
    rows[0].focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows[1]);
    await user.keyboard("{ArrowUp}{ArrowUp}");
    expect(document.activeElement).toBe(rows[0]);
    rows.at(-1)!.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(rows.at(-1));
    // other keys, and arrows pressed in the search field, are left to the field
    await user.click(screen.getByRole("searchbox", { name: "Search fonts" }));
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("searchbox", { name: "Search fonts" }));
    rows[0].focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(rows[0]);
  });

  it("formats only the selected characters while text is being edited", async () => {
    const user = userEvent.setup();
    const t = text();
    openElements([t], { selected: [t] });
    const applyInline = vi.fn(() => true);
    registerTextEditor({ applyInline, hasSelection: () => true, focus: () => undefined });
    act(() => useTextSelectionStyle.setState({ active: true, collapsed: false, style: { font: "Lora" } }));
    await openFont();
    // the font of the selected characters is the current one
    expect(screen.getAllByRole("button", { name: "Lora" }).some((b) => b.getAttribute("aria-current") === "true")).toBe(true);
    expect(row("Inter").getAttribute("aria-current")).toBeNull();
    await user.click(within(section("Display")).getAllByRole("button")[0]);
    await waitFor(() => expect(applyInline).toHaveBeenCalledWith({ font: inCategory("display")[0] }));
    expect(live<TextElement>(t).fontFamily).toBe("Inter");
  });

  it("asks for each font's face as its row comes into view, also without an observer", async () => {
    const t = text();
    openElements([t], { selected: [t] });
    const view = await openFont();
    expect(ensureFont).toHaveBeenCalledWith("Lora", 400);
    view.unmount();
    vi.mocked(ensureFont).mockClear();
    vi.stubGlobal("IntersectionObserver", undefined);
    await openFont();
    expect(ensureFont).toHaveBeenCalledWith("Lora", 400);
    expect(ensureFont).toHaveBeenCalledWith("Pacifico", 400);
  });

  it("loads the faces of the category chips so each is written in its own typeface", async () => {
    const t = text();
    openElements([t], { selected: [t] });
    await openFont();
    for (const sample of ["Inter", "Playfair Display", "Bebas Neue", "Pacifico", "Caveat", "JetBrains Mono"]) expect(ensureFont).toHaveBeenCalledWith(sample, 400);
  });
});

describe("Font panel: the weight of a family", () => {
  const weight = () => screen.getByRole("combobox", { name: "Weight" });

  it("offers every weight of a family that has more than regular and bold, and names the one in use", async () => {
    const t = text({ fontFamily: "Inter", fontWeight: 400 });
    openElements([t], { selected: [t] });
    await openFont();
    expect(weight().textContent).toContain("Regular (400)");
    const user = userEvent.setup();
    await user.click(weight());
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual([
      "Thin (100)",
      "Extra light (200)",
      "Light (300)",
      "Regular (400)",
      "Medium (500)",
      "Semibold (600)",
      "Bold (700)",
      "Extra bold (800)",
      "Black (900)",
    ]);
  });

  it("sets the weight of every selected text box as one step of undo, after the face was asked for", async () => {
    const a = text({ fontWeight: 400, italic: true });
    const b = text({ fontWeight: 400, y: 300 });
    openElements([a, b], { selected: [a, b] });
    await openFont();
    const user = userEvent.setup();
    await user.click(weight());
    await user.click(screen.getByRole("option", { name: "Light (300)" }));
    await waitFor(() => expect(live<TextElement>(a).fontWeight).toBe(300));
    expect(live<TextElement>(b).fontWeight).toBe(300);
    expect(ensureFont).toHaveBeenCalledWith("Inter", 300, true);
    expect(weight().textContent).toContain("Light (300)");
    act(() => store().actions.undo());
    expect([live<TextElement>(a).fontWeight, live<TextElement>(b).fontWeight]).toEqual([400, 400]);
  });

  it("sets the weight of only the selected characters when a range is open", async () => {
    const t = text({ fontWeight: 400 });
    const applyInline = vi.fn(() => true);
    registerTextEditor({ applyInline, hasSelection: () => true, focus: vi.fn() });
    useTextSelectionStyle.setState({ active: true, collapsed: false, style: { font: "Inter", weight: 400, italic: false } });
    openElements([t], { selected: [t] });
    await openFont();
    const user = userEvent.setup();
    await user.click(weight());
    await user.click(screen.getByRole("option", { name: "Light (300)" }));
    await waitFor(() => expect(applyInline).toHaveBeenCalledWith({ weight: 300 }));
    expect(live<TextElement>(t).fontWeight).toBe(400);
    expect(ensureFont).toHaveBeenCalledWith("Inter", 300, false);
  });

  it("says Several weights when the boxes differ", async () => {
    const a = text({ fontWeight: 300 });
    const b = text({ fontWeight: 800, y: 300 });
    openElements([a, b], { selected: [a, b] });
    await openFont();
    expect(weight().textContent).toContain("Several weights");
  });

  it("is not offered for a family with one or two weights, for boxes of different families, or for a table", async () => {
    const two = FONT_CATALOG.find((f) => f.weights.length <= 2)!;
    const t = text({ fontFamily: two.family });
    openElements([t], { selected: [t] });
    const first = await openFont();
    expect(screen.queryByRole("combobox", { name: "Weight" })).toBeNull();
    first.unmount();

    const a = text({ fontFamily: "Inter" });
    const b = text({ fontFamily: "Montserrat", y: 300 });
    openElements([a, b], { selected: [a, b] });
    const second = await openFont();
    expect(screen.queryByRole("combobox", { name: "Weight" })).toBeNull();
    second.unmount();

    const table = createTable();
    openElements([table], { selected: [table] });
    await openFont();
    expect(screen.queryByRole("combobox", { name: "Weight" })).toBeNull();
  });
});
