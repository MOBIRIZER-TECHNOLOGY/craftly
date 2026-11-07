import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { textPresetSizes } from "@/core/factory";
import { getBrandKit, setBrandKit } from "@/core/library";
import { useEditor } from "@/core/store";
import type { BrandKit, TextElement } from "@/core/types";
import { TEXT_COMBOS } from "@/data/textCombos";
import { TEXT_STYLE_PRESETS } from "@/data/textStyles";
import { DRAG_MIME } from "@/editor/insert";
import { takeSelectAllOnEdit } from "@/editor/canvas/controller";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements } from "@/test/tabsHarness";

/* The real brand kit in the fake IndexedDB; a test can hold the first read back. */
vi.mock("@/core/library", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/library")>();
  return { ...real, getBrandKit: vi.fn(real.getBrandKit) };
});

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  takeSelectAllOnEdit();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

const state = () => useEditor.getState();
const sizes = textPresetSizes(1280, 720);

async function openText(kit?: BrandKit) {
  if (kit) await setBrandKit(kit);
  const user = userEvent.setup();
  mountPanels({ tab: "text" });
  await screen.findByRole("searchbox", { name: "Search fonts and combinations" });
  return user;
}

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const COMBO_NAMES = TEXT_COMBOS.map((c) => `${c.name} font combination (${c.fonts.join(", ")})`);
const comboButtons = () => screen.getAllByRole("button").filter((b) => COMBO_NAMES.includes(b.getAttribute("aria-label") ?? ""));

describe("Text tab", () => {
  it("opens on the brand kit, the default styles, dynamic text and the font combinations", async () => {
    await openText();
    expect(screen.getByRole("button", { name: "Add a text box" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Brand kit", "Default text styles", "Dynamic text", "Font combinations"]);
  });

  it("adds an empty text box sized for the page and opens it for typing", async () => {
    const user = await openText();
    const before = pageElements().length;
    await user.click(screen.getByRole("button", { name: "Add a text box" }));
    const el = lastElement() as TextElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(el.type).toBe("text");
    expect(el.paragraphs[0].runs[0].text).toBe("Text");
    expect(el.fontSize).toBe(Math.round(720 * 0.05));
    expect(state().selection).toEqual([el.id]);
    expect(state().editingTextId).toBe(el.id);
    expect(takeSelectAllOnEdit()).toBe(true);
  });

  describe("default text styles", () => {
    it.each(TEXT_STYLE_PRESETS)("adds '$label' in its own face and size", async (preset) => {
      const user = await openText();
      await user.click(within(section("Default text styles")).getByRole("button", { name: preset.label }));
      const el = lastElement() as TextElement;
      expect(el.paragraphs[0].runs[0].text).toBe(preset.label);
      expect(el.fontFamily).toBe(preset.fontFamily);
      expect(el.fontWeight).toBe(preset.fontWeight);
      expect(el.fontSize).toBe(sizes[preset.id]);
      expect(state().editingTextId).toBe(el.id);
    });

    it("hands a style to the canvas when dragged, without adding it", async () => {
      await openText();
      const before = pageElements().length;
      const dt = fakeDataTransfer();
      fireEvent.dragStart(within(section("Default text styles")).getByRole("button", { name: "Add a subheading" }), { dataTransfer: dt });
      const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
      expect(payload.elements[0].fontSize).toBe(sizes.subheading);
      expect(pageElements()).toHaveLength(before);
    });

    it("sizes a style for a 1920 x 1080 page when no design is open", async () => {
      await openText();
      state().actions.closeDesign();
      const dt = fakeDataTransfer();
      fireEvent.dragStart(within(section("Default text styles")).getByRole("button", { name: "Add a heading" }), { dataTransfer: dt });
      expect(JSON.parse(dt.data.get(DRAG_MIME) ?? "null").elements[0].fontSize).toBe(textPresetSizes(1920, 1080).heading);
    });
  });

  describe("dynamic text", () => {
    it("adds the number of the page it is on", async () => {
      const user = await openText();
      const dynamic = section("Dynamic text");
      expect(within(dynamic).getByText("Adds this page's number (page 1) as text")).toBeTruthy();
      await user.click(within(dynamic).getByRole("button", { name: "Add page numbers" }));
      const el = lastElement() as TextElement;
      expect(el.paragraphs[0].runs[0].text).toBe("1");
      expect(el.fontSize).toBe(Math.round(720 * 0.045));
      expect(el.fontWeight).toBe(600);
      expect(state().selection).toEqual([el.id]);
    });

    it("follows the page that is open", async () => {
      const user = await openText();
      act(() => state().actions.setActivePage(state().design!.pages[1].id));
      const dynamic = section("Dynamic text");
      expect(await within(dynamic).findByText("Adds this page's number (page 2) as text")).toBeTruthy();
      await user.click(within(dynamic).getByRole("button", { name: "Add page numbers" }));
      expect((lastElement() as TextElement).paragraphs[0].runs[0].text).toBe("2");
    });

    it("can be dragged, and counts page 1 when no design is open", async () => {
      await openText();
      state().actions.closeDesign();
      const dt = fakeDataTransfer();
      fireEvent.dragStart(screen.getByRole("button", { name: "Add page numbers" }), { dataTransfer: dt });
      const el = JSON.parse(dt.data.get(DRAG_MIME) ?? "null").elements[0];
      expect(el.paragraphs[0].runs[0].text).toBe("1");
    });
  });

  describe("font combinations", () => {
    it("lists every ready-made combination with a preview", async () => {
      await openText();
      expect(comboButtons().map((b) => b.getAttribute("aria-label"))).toEqual(COMBO_NAMES);
      await waitFor(() => expect(document.querySelectorAll(".cf-text__combo canvas").length).toBe(TEXT_COMBOS.length));
      expect(within(comboButtons()[0]).getByText("Editorial")).toBeTruthy();
    });

    it("adds the text boxes of a combination to the page and selects them all", async () => {
      const user = await openText();
      const combo = TEXT_COMBOS.find((c) => c.id === "editorial")!;
      const wanted = combo.build({ width: 1280, height: 720 });
      const before = pageElements().length;
      await user.click(screen.getByRole("button", { name: "Editorial font combination (Playfair Display, Inter)" }));
      expect(pageElements()).toHaveLength(before + wanted.length);
      expect(state().selection).toHaveLength(wanted.length);
      const added = pageElements().slice(before) as TextElement[];
      expect(added.map((e) => e.fontFamily).sort()).toEqual(wanted.map((e) => (e as TextElement).fontFamily).sort());
    });

    it("hands a combination to the canvas when dragged", async () => {
      await openText();
      const before = pageElements().length;
      const dt = fakeDataTransfer();
      fireEvent.dragStart(screen.getByRole("button", { name: "Summer sale font combination (Anton, Pacifico)" }), { dataTransfer: dt });
      const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
      expect(payload.type).toBe("elements");
      expect(payload.elements.length).toBeGreaterThan(0);
      expect(pageElements()).toHaveLength(before);
    });

    it("does nothing when the design closes just as a combination is used", async () => {
      await openText();
      const button = screen.getByRole("button", { name: "Editorial font combination (Playfair Display, Inter)" });
      // the panel only disappears on the next render: a click or a drag in between finds no design
      state().actions.closeDesign();
      fireEvent.click(button);
      expect(state().design).toBeNull();
      const dt = fakeDataTransfer();
      const proceeded = fireEvent.dragStart(button, { dataTransfer: dt });
      expect(proceeded).toBe(false);
      expect(dt.data.size).toBe(0);
    });
  });

  describe("the brand kit", () => {
    it("shows the fonts of the kit and adds a heading in the one that is clicked", async () => {
      const user = await openText();
      const brand = section("Brand kit");
      expect((await within(brand).findAllByRole("button", { name: /^Add a heading in / })).map((b) => b.getAttribute("aria-label"))).toEqual([
        "Add a heading in Plus Jakarta Sans",
        "Add a heading in Playfair Display",
      ]);
      await user.click(within(brand).getByRole("button", { name: "Add a heading in Playfair Display" }));
      await waitFor(() => expect((lastElement() as TextElement).fontFamily).toBe("Playfair Display"));
      const el = lastElement() as TextElement;
      expect(el.fontSize).toBe(sizes.heading);
      expect(el.fontWeight).toBe(700);
      expect(state().editingTextId).toBe(el.id);
    });

    it("shows at most four brand fonts", async () => {
      await openText({ colors: [], fonts: ["Inter", "Lora", "Anton", "Caveat", "Cinzel"], logos: [] });
      const brand = section("Brand kit");
      await waitFor(() => expect(within(brand).getAllByRole("button", { name: /^Add a heading in / })).toHaveLength(4));
      expect(within(brand).queryByRole("button", { name: "Add a heading in Cinzel" })).toBeNull();
    });

    it("takes you to the Brand tab with 'Edit'", async () => {
      const user = await openText();
      await user.click(within(section("Brand kit")).getByRole("button", { name: "Edit" }));
      expect(state().leftTab).toBe("brand");
    });

    it("asks you to add brand fonts when the kit has none", async () => {
      const user = await openText({ colors: [], fonts: [], logos: [] });
      await user.click(await within(section("Brand kit")).findByRole("button", { name: "Add your brand fonts" }));
      expect(state().leftTab).toBe("brand");
    });

    it("holds a placeholder while the kit is read", async () => {
      let release!: (kit: BrandKit) => void;
      vi.mocked(getBrandKit).mockImplementationOnce(() => new Promise<BrandKit>((resolve) => (release = resolve)));
      mountPanels({ tab: "text" });
      await screen.findByRole("searchbox", { name: "Search fonts and combinations" });
      expect(section("Brand kit").querySelector(".cf-skeleton")).toBeTruthy();
      expect(within(section("Brand kit")).queryByRole("button", { name: /Add a heading in/ })).toBeNull();
      await act(async () => release({ colors: [], fonts: ["Lora"], logos: [] }));
      expect(await within(section("Brand kit")).findByRole("button", { name: "Add a heading in Lora" })).toBeTruthy();
      expect(section("Brand kit").querySelector(".cf-skeleton")).toBeNull();
    });
  });

  describe("searching", () => {
    async function find(text: string) {
      const user = await openText();
      await user.type(screen.getByRole("searchbox", { name: "Search fonts and combinations" }), text);
      return user;
    }

    it("lists every font that matches, each in its own face, and the combinations that match", async () => {
      await find("serif");
      expect(await screen.findByRole("heading", { name: "Fonts (8)" })).toBeTruthy();
      expect(screen.getByRole("button", { name: "Add text in Lora" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add text in Inter" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Brand kit" })).toBeNull();
      const row = screen.getByRole("button", { name: "Add text in Lora" });
      expect(row.textContent).toContain("Serif");
    });

    it("adds a heading in the font that is clicked, bold when the font has a bold face", async () => {
      const user = await find("lora");
      await user.click(await screen.findByRole("button", { name: "Add text in Lora" }));
      await waitFor(() => expect((lastElement() as TextElement).fontFamily).toBe("Lora"));
      const el = lastElement() as TextElement;
      expect(el.paragraphs[0].runs[0].text).toBe("Add a heading");
      expect(el.fontWeight).toBe(700);
      expect(el.fontSize).toBe(sizes.heading);
    });

    it("uses the heaviest face a font has when it has no bold one", async () => {
      const user = await find("anton");
      await user.click(await screen.findByRole("button", { name: "Add text in Anton" }));
      await waitFor(() => expect((lastElement() as TextElement).fontFamily).toBe("Anton"));
      expect((lastElement() as TextElement).fontWeight).toBe(400);
    });

    it("finds combinations by name", async () => {
      await find("wedding");
      await waitFor(() => expect(comboButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["Wedding script font combination (Great Vibes, Cormorant Garamond)"]));
      expect(screen.getByText("No fonts found")).toBeTruthy();
    });

    it("finds a combination by one of its fonts", async () => {
      await find("bebas");
      await waitFor(() => expect(comboButtons().map((b) => b.getAttribute("aria-label"))).toEqual(["Diner font combination (Lobster, Bebas Neue)"]));
    });

    it("says when no font matches and leaves the combinations out when none match either", async () => {
      await find("zzzz");
      expect(await screen.findByText('No font matches "zzzz". Try "serif", "script" or "mono".')).toBeTruthy();
      expect(screen.getByText("No fonts found")).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Font combinations" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Fonts" })).toBeTruthy();
    });

    it("goes back to the overview when the search is cleared", async () => {
      const user = await find("serif");
      await screen.findByRole("heading", { name: "Fonts (8)" });
      await user.click(screen.getByRole("button", { name: "Clear search" }));
      expect(await screen.findByRole("heading", { name: "Default text styles" })).toBeTruthy();
    });
  });

  it("shows nothing while no design is open", async () => {
    await openText();
    act(() => state().actions.closeDesign());
    await waitFor(() => expect(screen.queryByRole("searchbox", { name: "Search fonts and combinations" })).toBeNull());
  });
});
