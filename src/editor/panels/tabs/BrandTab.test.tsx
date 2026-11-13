import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, listAssets } from "@/core/assets";
import { createImage, createShape, createText, solid, textPresetSizes } from "@/core/factory";
import { getBrandKit, setBrandKit } from "@/core/library";
import { getActivePage, useEditor } from "@/core/store";
import type { BrandKit, ImageElement, ShapeElement, TextElement } from "@/core/types";
import { DRAG_MIME } from "@/editor/insert";
import { ensureFont } from "@/render/fonts";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { emptyDesign, fakeDataTransfer, imageFile, lastElement, mountPanels, pageElements } from "@/test/tabsHarness";

/* The real asset store and brand kit (fake IndexedDB), wrapped so a test can hold back or fail one call. */
vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  return { ...real, addAssetFromFile: vi.fn(real.addAssetFromFile) };
});
vi.mock("@/render/fonts", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/render/fonts")>();
  return { ...real, ensureFont: vi.fn(real.ensureFont) };
});
vi.mock("@/core/library", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/library")>();
  return { ...real, getBrandKit: vi.fn(real.getBrandKit) };
});

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

const state = () => useEditor.getState();
const DEFAULT_KIT: BrandKit = { colors: ["#7c3aed", "#14b8a6", "#0e1318", "#f59e0b", "#ffffff"], fonts: ["Plus Jakarta Sans", "Playfair Display"], logos: [] };

async function openBrand(kit?: BrandKit, design = emptyDesign()) {
  if (kit) await setBrandKit(kit);
  const user = userEvent.setup();
  mountPanels({ tab: "brand", design });
  await screen.findByRole("heading", { name: "Brand kit" });
  await screen.findByRole("heading", { name: /^Brand colours/ });
  return user;
}

const section = (title: RegExp | string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const savedKit = () => getBrandKit();
const swatch = (hex: string) => screen.getByRole("button", { name: `${hex.toUpperCase()} - click to apply, right-click for more` });

describe("the font picker (first: the fonts are only warmed up once per page load)", () => {
  it("starts loading every catalogue font the first time the picker is approached", async () => {
    const user = await openBrand();
    const asked = () => new Set(vi.mocked(ensureFont).mock.calls.map((call) => call[0]));
    // only the two fonts of the kit are drawn so far
    expect(asked().has("Cinzel")).toBe(false);
    await user.hover(screen.getByRole("combobox", { name: "Add a font to your brand kit" }));
    expect(asked().has("Cinzel")).toBe(true);
    expect(asked().size).toBeGreaterThan(40);

    // approaching it again asks for nothing more
    vi.mocked(ensureFont).mockClear();
    await user.unhover(screen.getByRole("combobox", { name: "Add a font to your brand kit" }));
    await user.hover(screen.getByRole("combobox", { name: "Add a font to your brand kit" }));
    expect(vi.mocked(ensureFont)).not.toHaveBeenCalled();
  });
});

describe("Brand tab", () => {
  it("shows the logos, colours and fonts of the kit", async () => {
    await openBrand();
    expect(screen.getByText("Logos, colours and fonts you use again and again")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Logos", "Brand colours (5)", "Brand fonts (2)", "Your fonts"]);
  });

  it("holds placeholders while the kit is read", async () => {
    let release!: (kit: BrandKit) => void;
    vi.mocked(getBrandKit).mockImplementationOnce(() => new Promise<BrandKit>((resolve) => (release = resolve)));
    mountPanels({ tab: "brand", design: emptyDesign() });
    await screen.findByRole("heading", { name: "Brand kit" });
    expect(document.querySelectorAll(".cf-brandtab__loading .cf-skeleton")).toHaveLength(4);
    expect(screen.queryByRole("heading", { name: "Logos" })).toBeNull();
    await act(async () => release(DEFAULT_KIT));
    expect(await screen.findByRole("heading", { name: "Logos" })).toBeTruthy();
  });

  describe("logos", () => {
    it("invites you to upload the first one", async () => {
      const user = await openBrand();
      const drop = within(section("Logos")).getByRole("button", { name: /Upload your logo/ });
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await user.click(drop);
      expect(click.mock.contexts).toContain(fileInput());
      expect(fileInput().accept).toBe("image/*");
      expect(within(section("Logos")).queryByRole("button", { name: "Upload" })).toBeNull();
    });

    it("saves an uploaded logo to the kit and to the uploads, and shows it", async () => {
      const user = await openBrand();
      await user.upload(fileInput(), imageFile("Mark One.png"));
      expect(await screen.findByText("Logo added to your brand kit")).toBeTruthy();
      expect(await within(section("Logos")).findByRole("button", { name: "Add logo Mark One" })).toBeTruthy();
      const kit = await savedKit();
      expect(kit.logos).toHaveLength(1);
      expect((await listAssets()).map((a) => a.id)).toEqual(kit.logos);
      // with a logo, the drop zone gives way to an upload button in the heading
      expect(within(section("Logos")).getByRole("button", { name: "Upload" })).toBeTruthy();
      expect(within(section("Logos")).queryByText("Upload your logo")).toBeNull();
    });

    it("adds several logos at once", async () => {
      const user = await openBrand();
      await user.upload(fileInput(), [imageFile("One.png"), imageFile("Two.png")]);
      expect(await screen.findByText("2 logos added to your brand kit")).toBeTruthy();
      expect((await savedKit()).logos).toHaveLength(2);
    });

    it("keeps only the pictures when something else is chosen with them", async () => {
      await openBrand();
      fireEvent.change(fileInput(), { target: { files: [imageFile("Real.png"), new File(["x"], "notes.txt", { type: "text/plain" })] } });
      expect(await screen.findByText("Logo added to your brand kit")).toBeTruthy();
      expect((await savedKit()).logos).toHaveLength(1);
    });

    it("explains that a logo has to be an image", async () => {
      await openBrand();
      fireEvent.change(fileInput(), { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
      expect(await screen.findByText("Logos must be images: PNG, JPG, WebP, GIF or SVG.")).toBeTruthy();
      expect((await savedKit()).logos).toEqual([]);
    });

    it("does nothing when the chooser is closed without a file", async () => {
      await openBrand();
      fireEvent.change(fileInput(), { target: { files: [] } });
      await Promise.resolve();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("says it is saving, and says so when the logo cannot be saved", async () => {
      await openBrand();
      let fail!: (e: Error) => void;
      vi.mocked(addAssetFromFile).mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)));
      fireEvent.change(fileInput(), { target: { files: [imageFile("Huge.png")] } });
      const drop = await within(section("Logos")).findByRole("button", { name: /Saving your logo/ });
      expect((drop as HTMLButtonElement).disabled).toBe(true);
      await act(async () => fail(new Error("quota")));
      expect(await screen.findByText("The logo could not be saved. Try a smaller file.")).toBeTruthy();
      expect(await within(section("Logos")).findByRole("button", { name: /Upload your logo/ })).toBeTruthy();
      expect((await savedKit()).logos).toEqual([]);
    });

    describe("with a logo in the kit", () => {
      async function withLogo() {
        const user = await openBrand();
        await user.upload(fileInput(), imageFile("Wordmark.png"));
        const card = await within(section("Logos")).findByRole("button", { name: "Add logo Wordmark" });
        return { user, card };
      }

      it("puts the logo on the page when it is clicked", async () => {
        const { user, card } = await withLogo();
        const before = pageElements().length;
        await user.click(card);
        const el = lastElement() as ImageElement;
        expect(pageElements()).toHaveLength(before + 1);
        expect(el.src).toMatch(/^asset:/);
        expect([el.naturalWidth, el.naturalHeight]).toEqual([64, 48]);
      });

      it("hands the logo to the canvas when dragged", async () => {
        const { card } = await withLogo();
        const dt = fakeDataTransfer();
        fireEvent.dragStart(card, { dataTransfer: dt });
        const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
        expect(payload).toMatchObject({ type: "image", naturalWidth: 64, naturalHeight: 48, name: "Wordmark" });
        expect(payload.src).toMatch(/^asset:/);
      });

      it("shows the picture of the logo once it has been read", async () => {
        const { card } = await withLogo();
        await waitFor(() => expect(card.querySelector("img")).toBeTruthy());
        expect(card.querySelector("img")?.getAttribute("src")).toMatch(/^blob:test\//);
      });

      it("takes the logo out of the kit but keeps the upload", async () => {
        const { user } = await withLogo();
        await user.click(screen.getByRole("button", { name: "Remove Wordmark from the brand kit" }));
        await waitFor(async () => expect((await savedKit()).logos).toEqual([]));
        expect(await within(section("Logos")).findByRole("button", { name: /Upload your logo/ })).toBeTruthy();
        expect(await listAssets()).toHaveLength(1);
      });

      it("adds more logos with the Upload button", async () => {
        const { user } = await withLogo();
        const click = vi.spyOn(HTMLInputElement.prototype, "click");
        await user.click(within(section("Logos")).getByRole("button", { name: "Upload" }));
        expect(click.mock.contexts).toContain(fileInput());
      });
    });

    it("leaves out a logo whose upload has been deleted", async () => {
      await openBrand({ ...DEFAULT_KIT, logos: ["a_gone"] });
      expect(within(section("Logos")).getByRole("button", { name: /Upload your logo/ })).toBeTruthy();
      expect(screen.queryByRole("button", { name: /^Add logo/ })).toBeNull();
    });
  });

  describe("colours", () => {
    it("lists the colours of the kit", async () => {
      await openBrand();
      expect(
        within(screen.getByRole("group", { name: "Brand colours" }))
          .getAllByRole("button")
          .map((b) => b.getAttribute("aria-label"))
          .slice(0, 5),
      ).toEqual(DEFAULT_KIT.colors.map((c) => `${c.toUpperCase()} - click to apply, right-click for more`));
    });

    it("has a heading without a count when the kit has no colours", async () => {
      await openBrand({ ...DEFAULT_KIT, colors: [] });
      expect(screen.getByRole("heading", { name: "Brand colours" })).toBeTruthy();
    });

    it("colours the selected shape", async () => {
      const shape = createShape("rect");
      const design = emptyDesign();
      design.pages[0].elements = [shape];
      const user = await openBrand(undefined, design);
      state().actions.select([shape.id]);
      await user.click(swatch("#14b8a6"));
      expect((pageElements()[0] as ShapeElement).fill).toEqual(solid("#14b8a6"));
    });

    it("colours the page when nothing is selected", async () => {
      const user = await openBrand();
      await user.click(swatch("#f59e0b"));
      expect(getActivePage(state())?.background).toEqual(solid("#f59e0b"));
    });

    it("explains when the selection cannot take a colour", async () => {
      const photo = createImage({ src: "builtin:sunset-hills" });
      const design = emptyDesign();
      design.pages[0].elements = [photo];
      const user = await openBrand(undefined, design);
      state().actions.select([photo.id]);
      await user.click(swatch("#f59e0b"));
      expect(await screen.findByText(/Select some text, a shape or a line first/)).toBeTruthy();
    });

    it("applies a colour to the selected text", async () => {
      const text = createText({ text: "Words" });
      const design = emptyDesign();
      design.pages[0].elements = [text];
      const user = await openBrand(undefined, design);
      state().actions.select([text.id]);
      await user.click(swatch("#0e1318"));
      expect((pageElements()[0] as TextElement).color).toBe("#0e1318");
    });

    describe("the colour menu", () => {
      async function openMenu(hex = "#14b8a6") {
        const user = await openBrand();
        fireEvent.contextMenu(swatch(hex), { clientX: 120, clientY: 160 });
        const menu = await screen.findByRole("menu");
        return { user, menu };
      }

      it("opens on right-click with apply, copy and remove", async () => {
        const { menu } = await openMenu();
        expect(
          within(menu)
            .getAllByRole("menuitem")
            .map((i) => i.textContent),
        ).toEqual(["Apply colour", "Copy #14B8A6", "Remove from brand kit"]);
      });

      it("applies the colour", async () => {
        const { user, menu } = await openMenu("#f59e0b");
        await user.click(within(menu).getByRole("menuitem", { name: "Apply colour" }));
        expect(getActivePage(state())?.background).toEqual(solid("#f59e0b"));
      });

      it("copies the colour code", async () => {
        const { user, menu } = await openMenu();
        const writeText = vi.spyOn(navigator.clipboard, "writeText");
        await user.click(within(menu).getByRole("menuitem", { name: "Copy #14B8A6" }));
        expect(writeText).toHaveBeenCalledWith("#14b8a6");
        expect(await screen.findByText("Copied #14B8A6")).toBeTruthy();
      });

      it("removes the colour from the kit", async () => {
        const { user, menu } = await openMenu();
        await user.click(within(menu).getByRole("menuitem", { name: "Remove from brand kit" }));
        await waitFor(async () => expect((await savedKit()).colors).toEqual(["#7c3aed", "#0e1318", "#f59e0b", "#ffffff"]));
        expect(screen.queryByRole("button", { name: /#14B8A6/ })).toBeNull();
        expect(screen.getByRole("heading", { name: "Brand colours (4)" })).toBeTruthy();
      });
    });

    it("removes a colour with the Delete or Backspace key", async () => {
      const user = await openBrand();
      swatch("#14b8a6").focus();
      await user.keyboard("{Delete}");
      await waitFor(async () => expect((await savedKit()).colors).not.toContain("#14b8a6"));
      swatch("#0e1318").focus();
      await user.keyboard("{Backspace}");
      await waitFor(async () => expect((await savedKit()).colors).toEqual(["#7c3aed", "#f59e0b", "#ffffff"]));
    });

    it("ignores other keys on a colour", async () => {
      const user = await openBrand();
      swatch("#14b8a6").focus();
      await user.keyboard("a");
      expect((await savedKit()).colors).toHaveLength(5);
    });

    describe("adding a colour", () => {
      async function openPicker() {
        const user = await openBrand();
        await user.click(screen.getByRole("button", { name: "Add a brand colour" }));
        const dialog = await screen.findByRole("dialog", { name: "Add a brand colour" });
        return { user, dialog };
      }

      it("takes the colour typed into the picker", async () => {
        const { user, dialog } = await openPicker();
        const hex = within(dialog).getByRole("textbox", { name: "Hex colour" });
        await user.clear(hex);
        await user.type(hex, "112233");
        await user.click(within(dialog).getByRole("button", { name: "Add colour" }));
        await waitFor(async () => expect((await savedKit()).colors.map((c) => c.toLowerCase())).toEqual([...DEFAULT_KIT.colors, "#112233"]));
        expect(screen.queryByRole("dialog", { name: "Add a brand colour" })).toBeNull();
        expect(await screen.findByRole("button", { name: "#112233 - click to apply, right-click for more" })).toBeTruthy();
      });

      it("says when the colour is already there", async () => {
        const { user, dialog } = await openPicker();
        // the picker starts on the purple of the kit
        await user.click(within(dialog).getByRole("button", { name: "Add colour" }));
        expect(await screen.findByText("That colour is already in your brand kit.")).toBeTruthy();
        expect((await savedKit()).colors).toHaveLength(5);
        expect(screen.queryByRole("dialog", { name: "Add a brand colour" })).toBeNull();
      });

      it("closes on Escape", async () => {
        const { user } = await openPicker();
        await user.keyboard("{Escape}");
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a brand colour" })).toBeNull());
        expect((await savedKit()).colors).toHaveLength(5);
      });

      it("closes without adding on Cancel, and with the plus button again", async () => {
        const { user, dialog } = await openPicker();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("dialog", { name: "Add a brand colour" })).toBeNull();
        expect((await savedKit()).colors).toHaveLength(5);

        const plus = screen.getByRole("button", { name: "Add a brand colour" });
        await user.click(plus);
        expect(plus.getAttribute("aria-expanded")).toBe("true");
        fireEvent.click(plus);
        await waitFor(() => expect(screen.queryByRole("dialog", { name: "Add a brand colour" })).toBeNull());
      });
    });

    it("stops offering to add colours once the kit holds 24", async () => {
      const colors = Array.from({ length: 24 }, (_, i) => `#${(i + 16).toString(16).padStart(2, "0")}${(i * 7 + 16).toString(16).padStart(2, "0")}aa`);
      await openBrand({ ...DEFAULT_KIT, colors });
      expect(screen.getByRole("heading", { name: "Brand colours (24)" })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Add a brand colour" })).toBeNull();
    });
  });

  describe("fonts", () => {
    it("lists the fonts of the kit", async () => {
      await openBrand();
      expect(
        within(section(/^Brand fonts/))
          .getAllByRole("button", { name: /^Use / })
          .map((b) => b.getAttribute("aria-label")),
      ).toEqual(["Use Plus Jakarta Sans", "Use Playfair Display"]);
    });

    it("adds a bold heading in the font when no text is selected", async () => {
      const user = await openBrand();
      await user.click(screen.getByRole("button", { name: "Use Playfair Display" }));
      await waitFor(() => expect((lastElement() as TextElement)?.fontFamily).toBe("Playfair Display"));
      const el = lastElement() as TextElement;
      expect(el.fontWeight).toBe(700);
      expect(el.fontSize).toBe(textPresetSizes(1280, 720).heading);
      expect(state().editingTextId).toBe(el.id);
    });

    it("changes the font of the selected text instead of adding a heading", async () => {
      const text = createText({ text: "Words" });
      const design = emptyDesign();
      design.pages[0].elements = [text];
      const user = await openBrand(undefined, design);
      state().actions.select([text.id]);
      await user.click(screen.getByRole("button", { name: "Use Playfair Display" }));
      expect(pageElements()).toHaveLength(1);
      expect((pageElements()[0] as TextElement).fontFamily).toBe("Playfair Display");
    });

    it("has no page to add a heading to once the design is closed", async () => {
      const user = await openBrand();
      act(() => state().actions.closeDesign());
      await user.click(screen.getByRole("button", { name: "Use Playfair Display" }));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(state().design).toBeNull();
      expect(state().editingTextId).toBeNull();
    });

    it("takes a font out of the kit", async () => {
      const user = await openBrand();
      await user.click(screen.getByRole("button", { name: "Remove Playfair Display from the brand kit" }));
      await waitFor(async () => expect((await savedKit()).fonts).toEqual(["Plus Jakarta Sans"]));
      expect(screen.queryByRole("button", { name: "Use Playfair Display" })).toBeNull();
    });

    it("says there are none, and offers any font of the catalogue to add", async () => {
      const user = await openBrand({ ...DEFAULT_KIT, fonts: [] });
      expect(screen.getByText("No brand fonts yet")).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Brand fonts" })).toBeTruthy();
      const select = screen.getByRole("combobox", { name: "Add a font to your brand kit" });
      expect(select.textContent).toBe("Add a font to your kit");
      await user.click(select);
      const list = await screen.findByRole("listbox");
      expect(within(list).getByRole("option", { name: "Lora" })).toBeTruthy();
      await user.click(within(list).getByRole("option", { name: "Lora" }));
      await waitFor(async () => expect((await savedKit()).fonts).toEqual(["Lora"]));
      expect(await screen.findByRole("button", { name: "Use Lora" })).toBeTruthy();
    });

    it("leaves the fonts that are in the kit out of the list to add", async () => {
      const user = await openBrand();
      await user.click(screen.getByRole("combobox", { name: "Add a font to your brand kit" }));
      const list = await screen.findByRole("listbox");
      expect(within(list).queryByRole("option", { name: "Playfair Display" })).toBeNull();
      expect(within(list).getByRole("option", { name: "Inter" })).toBeTruthy();
    });
  });
});
