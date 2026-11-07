import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile } from "@/core/assets";
import { contrastRatio, readableOn } from "@/core/color";
import { getBrandKit, setBrandKit } from "@/core/library";
import type { BrandKit } from "@/core/types";
import * as fonts from "@/render/fonts";
import { FONT_CATALOG, cssFontFamily } from "@/render/fonts";
import { Hosts, dismissOpenDialogs, emptyLibrary, imageFile, resetDashboardStores, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { BrandPage } from "./BrandPage";
import * as data from "./data";

const DEFAULT_COLORS = ["#7c3aed", "#14b8a6", "#0e1318", "#f59e0b", "#ffffff"];
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mountBrand() {
  return render(
    <>
      <BrandPage />
      <Hosts />
    </>,
  );
}

async function withKit(kit: Partial<BrandKit>) {
  await setBrandKit({ colors: [], fonts: [], logos: [], ...kit });
  // the page paints what the live store holds and only then refreshes it ("instant paint, then a silent refresh"), so a
  // test that looks at once would see the kit of the test before: make the store hold this kit first
  data.brandStore.reload();
  const stored = await getBrandKit();
  await waitFor(() => expect(data.brandStore.getSnapshot().value).toEqual(stored));
}

const card = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section") as HTMLElement;
const hexLabels = () => Array.from(document.querySelectorAll(".cf-brand__hex")).map((el) => el.textContent);
const swatch = (hex: string) => screen.getByRole("button", { name: `Edit colour ${hex.toUpperCase()}` });
const preview = () => screen.getByRole("complementary", { name: "Brand kit preview" });
const previewVar = (name: string) => (preview().querySelector(".cf-brand__preview") as HTMLElement).style.getPropertyValue(name);
const fontRows = () => Array.from(document.querySelectorAll(".cf-brand__font-name")).map((el) => el.textContent);

async function ready() {
  await screen.findByRole("heading", { level: 2, name: "Brand colours" });
}

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<BrandPage>", () => {
  it("shows placeholders while the kit is read", async () => {
    // a freshly loaded page has not read the library yet (the stores of this file already have)
    vi.resetModules();
    const { BrandPage: FreshBrandPage } = await import("./BrandPage");
    render(<FreshBrandPage />);
    expect(screen.getByLabelText("Loading your brand kit").getAttribute("aria-busy")).toBe("true");
    await ready();
    expect(screen.queryByLabelText("Loading your brand kit")).toBeNull();
  });

  it("starts with the default colours and fonts and no logos", async () => {
    mountBrand();
    await ready();
    expect(screen.getByRole("heading", { level: 1, name: "Brand kit" })).toBeTruthy();
    expect(hexLabels()).toEqual(DEFAULT_COLORS.map((color) => color.toUpperCase()));
    expect(fontRows()).toEqual(["Plus Jakarta Sans", "Playfair Display"]);
    const meta = Array.from(document.querySelectorAll(".cf-brand__font-meta")).map((el) => el.textContent);
    expect(meta).toEqual(["Sans serif · Heading", "Serif · Body"]);
    expect(within(card("Logos")).getByText("No logos yet")).toBeTruthy();
  });

  it("asks the font loader to prepare the kit's fonts", async () => {
    const preload = vi.spyOn(fonts, "preloadFonts");
    await withKit({ fonts: ["Inter", "Lora"] });
    mountBrand();
    await ready();
    await waitFor(() => expect(preload).toHaveBeenCalledWith(["Inter", "Lora"]));
  });

  describe("the preview", () => {
    it("shows the kit's first colour as the background, the second as the accent and its fonts", async () => {
      await withKit({ colors: ["#112233", "#ffcc00", "#ffffff"], fonts: ["Inter", "Lora"] });
      mountBrand();
      await ready();
      await waitFor(() => expect(previewVar("--cf-brand-bg")).toBe("#112233"));
      expect(previewVar("--cf-brand-ink")).toBe(readableOn("#112233"));
      expect(previewVar("--cf-brand-accent")).toBe("#ffcc00");
      expect(previewVar("--cf-brand-accent-ink")).toBe(readableOn("#ffcc00"));
      expect((preview().querySelector(".cf-brand__preview-title") as HTMLElement).style.fontFamily).toBe(cssFontFamily("Inter"));
      expect((preview().querySelector(".cf-brand__preview-body") as HTMLElement).style.fontFamily).toBe(cssFontFamily("Lora"));
      expect(Array.from(preview().querySelectorAll(".cf-brand__preview-swatch")).map((el) => el.getAttribute("title"))).toEqual(["#112233", "#FFCC00", "#FFFFFF"]);
      // one picture with a name that lists the colours (a label on a plain div is ignored by screen readers)
      expect(within(preview()).getByRole("img", { name: "Brand colours: #112233, #FFCC00, #FFFFFF" })).toBeTruthy();
    });

    it("keeps the softer texts (the logo placeholder and the body copy) at 4.5:1 on the background, whatever colour the kit starts with", async () => {
      for (const color of ["#7c3aed", "#14b8a6", "#0e1318", "#f59e0b", "#ffffff", "#2563eb"]) {
        await withKit({ colors: [color] });
        const { unmount } = mountBrand();
        await ready();
        await waitFor(() => expect(previewVar("--cf-brand-bg")).toBe(color));
        const ink = previewVar("--cf-brand-ink");
        for (const name of ["--cf-brand-ink-soft", "--cf-brand-ink-faint"]) {
          expect(contrastRatio(previewVar(name), color), `${name} on ${color}`).toBeGreaterThanOrEqual(Math.min(4.5, contrastRatio(ink, color)));
        }
        unmount();
      }
    });

    it("still fades the softer texts where the background leaves room, so they stay softer than the heading", async () => {
      await withKit({ colors: ["#ffffff"] });
      mountBrand();
      await ready();
      await waitFor(() => expect(previewVar("--cf-brand-bg")).toBe("#ffffff"));
      const ink = previewVar("--cf-brand-ink");
      expect(previewVar("--cf-brand-ink-soft")).not.toBe(ink);
      expect(previewVar("--cf-brand-ink-faint")).not.toBe(ink);
      expect(contrastRatio(previewVar("--cf-brand-ink-faint"), "#ffffff")).toBeLessThan(contrastRatio(previewVar("--cf-brand-ink-soft"), "#ffffff"));
    });

    it("falls back to white, purple and the default font for an empty kit", async () => {
      await withKit({});
      mountBrand();
      await ready();
      await waitFor(() => expect(previewVar("--cf-brand-bg")).toBe("#ffffff"));
      expect(previewVar("--cf-brand-accent")).toBe("#7c3aed");
      expect((preview().querySelector(".cf-brand__preview-title") as HTMLElement).style.fontFamily).toBe(cssFontFamily("Plus Jakarta Sans"));
      expect(preview().querySelector(".cf-brand__preview-swatches")).toBeNull();
      expect(within(preview()).getByText("Your logo")).toBeTruthy();
    });

    it("uses the only colour as both background and accent, and the only font for both texts", async () => {
      await withKit({ colors: ["#334455"], fonts: ["Lora"] });
      mountBrand();
      await ready();
      await waitFor(() => expect(previewVar("--cf-brand-bg")).toBe("#334455"));
      expect(previewVar("--cf-brand-accent")).toBe("#334455");
      expect((preview().querySelector(".cf-brand__preview-body") as HTMLElement).style.fontFamily).toBe(cssFontFamily("Lora"));
    });

    it("shows the first logo of the kit", async () => {
      const asset = await addAssetFromFile(imageFile("mark.png"));
      await withKit({ logos: [asset.id] });
      mountBrand();
      await ready();
      await waitFor(() => expect(within(preview()).getByAltText("mark").getAttribute("src")).toMatch(/^blob:/));
    });
  });

  describe("logos", () => {
    it("adds the chosen images to the kit and says so", async () => {
      const user = userEvent.setup();
      const picker = stubFilePicker([imageFile("one.png")]);
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Upload logo" }));
      expect(await screen.findByText("Logo added to your brand kit")).toBeTruthy();
      expect(picker.lastMultiple()).toBe(true);
      const kit = await getBrandKit();
      expect(kit.logos).toHaveLength(1);
      expect(await within(card("Logos")).findByAltText("one")).toBeTruthy();
      expect(within(card("Logos")).getByText("one")).toBeTruthy();
    });

    it("counts several logos", async () => {
      const user = userEvent.setup();
      stubFilePicker([imageFile("one.png"), imageFile("two.png")]);
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Upload logo" }));
      expect(await screen.findByText("2 logos added to your brand kit")).toBeTruthy();
      expect((await getBrandKit()).logos).toHaveLength(2);
    });

    it("does nothing when the file dialog is cancelled or no file could be stored", async () => {
      const user = userEvent.setup();
      const picker = stubFilePicker([]);
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Upload logo" }));
      await sleep(30);
      expect((await getBrandKit()).logos).toEqual([]);
      picker.answer([new File(["x"], "notes.txt", { type: "text/plain" })]);
      await user.click(screen.getByRole("button", { name: "Upload logo" }));
      expect(await screen.findByText(/Couldn't upload notes\.txt/)).toBeTruthy();
      expect((await getBrandKit()).logos).toEqual([]);
      expect(screen.queryByText(/added to your brand kit/)).toBeNull();
    });

    it("removes a logo from the kit and offers to put it back where it was", async () => {
      const user = userEvent.setup();
      const first = await addAssetFromFile(imageFile("first.png"));
      const second = await addAssetFromFile(imageFile("second.png"));
      await withKit({ logos: [first.id, second.id] });
      mountBrand();
      await ready();
      await user.click(await screen.findByRole("button", { name: "Remove first from the brand kit" }));
      await waitFor(async () => expect((await getBrandKit()).logos).toEqual([second.id]));
      expect(await screen.findByText("Logo removed from your brand kit")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Undo" }));
      await waitFor(async () => expect((await getBrandKit()).logos).toEqual([first.id, second.id]));
    });

    it("does not put a logo back twice when it was added again before Undo is pressed", async () => {
      const user = userEvent.setup();
      const first = await addAssetFromFile(imageFile("first.png"));
      await withKit({ logos: [first.id] });
      mountBrand();
      await ready();
      await user.click(await screen.findByRole("button", { name: "Remove first from the brand kit" }));
      const undo = await screen.findByRole("button", { name: "Undo" });
      await waitFor(async () => expect((await getBrandKit()).logos).toEqual([]));
      await withKit({ logos: [first.id] });
      await user.click(undo);
      await sleep(50);
      expect((await getBrandKit()).logos).toEqual([first.id]);
    });

    it("ignores a logo in the kit whose image is gone", async () => {
      await withKit({ logos: ["a_missing"] });
      mountBrand();
      await ready();
      expect(within(card("Logos")).getByText("No logos yet")).toBeTruthy();
    });
  });

  describe("colours", () => {
    it("opens a colour in an editor and saves a new hex value", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(swatch("#14b8a6"));
      const editor = screen.getByRole("dialog", { name: "Edit colour #14B8A6" });
      const hex = within(editor).getByRole("textbox", { name: "Hex colour" });
      await user.clear(hex);
      await user.type(hex, "112233");
      await waitFor(async () => expect((await getBrandKit()).colors).toEqual(["#7c3aed", "#112233", "#0e1318", "#f59e0b", "#ffffff"]));
      await waitFor(() => expect(hexLabels()[1]).toBe("#112233"));
    });

    it("moves a colour earlier or later from its editor", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(swatch("#0e1318"));
      await user.click(within(screen.getByRole("dialog", { name: "Edit colour #0E1318" })).getByRole("button", { name: "Move earlier" }));
      await waitFor(async () => expect((await getBrandKit()).colors.slice(0, 3)).toEqual(["#7c3aed", "#0e1318", "#14b8a6"]));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(swatch("#7c3aed"));
      await user.click(within(screen.getByRole("dialog", { name: "Edit colour #7C3AED" })).getByRole("button", { name: "Move later" }));
      await waitFor(async () => expect((await getBrandKit()).colors.slice(0, 2)).toEqual(["#0e1318", "#7c3aed"]));
    });

    it("does not rewrite the kit when an edit leaves the colour as it was", async () => {
      const user = userEvent.setup();
      const write = vi.spyOn(data, "updateBrandKit");
      mountBrand();
      await ready();
      await user.click(swatch("#ffffff"));
      // white is already as bright as it gets: the key press changes nothing
      const square = within(screen.getByRole("dialog", { name: "Edit colour #FFFFFF" })).getByRole("slider", { name: "Saturation and brightness" });
      square.focus();
      await user.keyboard("{ArrowUp}");
      await sleep(50);
      expect(write).not.toHaveBeenCalled();
      expect((await getBrandKit()).colors).toEqual(DEFAULT_COLORS);
    });

    it("cannot move the first colour earlier or the last one later", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(swatch("#7c3aed"));
      const first = screen.getByRole("dialog", { name: "Edit colour #7C3AED" });
      expect(within(first).getByRole("button", { name: "Move earlier" }).getAttribute("aria-disabled")).toBe("true");
      expect(within(first).getByRole("button", { name: "Move later" }).getAttribute("aria-disabled")).toBeNull();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(swatch("#ffffff"));
      const last = screen.getByRole("dialog", { name: "Edit colour #FFFFFF" });
      expect(within(last).getByRole("button", { name: "Move later" }).getAttribute("aria-disabled")).toBe("true");
    });

    it("removes a colour from its editor", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(swatch("#f59e0b"));
      await user.click(within(screen.getByRole("dialog", { name: "Edit colour #F59E0B" })).getByRole("button", { name: "Remove" }));
      await waitFor(async () => expect((await getBrandKit()).colors).toEqual(["#7c3aed", "#14b8a6", "#0e1318", "#ffffff"]));
      await waitFor(() => expect(hexLabels()).toHaveLength(4));
    });

    it("adds a new colour from the picker", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Add a colour" }));
      const picker = screen.getByRole("dialog", { name: "Add a brand colour" });
      expect(within(picker).getByText("That colour is already in your kit.")).toBeTruthy();
      expect((within(picker).getByRole("button", { name: "Add colour" }) as HTMLButtonElement).disabled).toBe(true);
      const hex = within(picker).getByRole("textbox", { name: "Hex colour" });
      await user.clear(hex);
      await user.type(hex, "336699");
      expect(within(picker).queryByText("That colour is already in your kit.")).toBeNull();
      await user.click(within(picker).getByRole("button", { name: "Add colour" }));
      await waitFor(async () => expect((await getBrandKit()).colors).toEqual([...DEFAULT_COLORS, "#336699"]));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("closes the picker with Cancel without adding anything", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Add a colour" }));
      await user.click(within(screen.getByRole("dialog", { name: "Add a brand colour" })).getByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect((await getBrandKit()).colors).toEqual(DEFAULT_COLORS);
    });

    it("explains an empty palette", async () => {
      await withKit({ colors: [] });
      mountBrand();
      await ready();
      expect(screen.getByText("No colours yet. Add the colours your brand uses.")).toBeTruthy();
    });

    it("stops at 24 colours", async () => {
      await withKit({ colors: Array.from({ length: 24 }, (_unused, index) => `#${(index + 16).toString(16).padStart(2, "0")}0000`) });
      mountBrand();
      await ready();
      const add = screen.getByRole("button", { name: "You can keep up to 24 colours" });
      expect(add.getAttribute("aria-disabled")).toBe("true");
    });

    describe("reordering by dragging", () => {
      const transfer = () => ({ setData: vi.fn(), effectAllowed: "", dropEffect: "" });
      const items = () => Array.from(document.querySelectorAll<HTMLElement>(".cf-brand__color"));

      it("moves a colour to the place where it is dropped", async () => {
        mountBrand();
        await ready();
        const dataTransfer = transfer();
        fireEvent.dragStart(items()[0], { dataTransfer });
        expect(dataTransfer.setData).toHaveBeenCalledWith("text/plain", "#7c3aed");
        expect(items()[0].classList.contains("is-dragging")).toBe(true);
        fireEvent.dragOver(items()[2], { dataTransfer });
        expect(dataTransfer.dropEffect).toBe("move");
        expect(items()[2].classList.contains("is-over")).toBe(true);
        fireEvent.drop(items()[2], { dataTransfer });
        await waitFor(async () => expect((await getBrandKit()).colors).toEqual(["#14b8a6", "#0e1318", "#7c3aed", "#f59e0b", "#ffffff"]));
        await waitFor(() => expect(hexLabels()[2]).toBe("#7C3AED"));
        expect(items().some((item) => item.classList.contains("is-dragging"))).toBe(false);
      });

      it("forgets the drag when it ends without a drop", async () => {
        mountBrand();
        await ready();
        const dataTransfer = transfer();
        fireEvent.dragStart(items()[1], { dataTransfer });
        fireEvent.dragOver(items()[3], { dataTransfer });
        fireEvent.dragEnd(items()[1]);
        expect(items().some((item) => item.classList.contains("is-dragging") || item.classList.contains("is-over"))).toBe(false);
        expect((await getBrandKit()).colors).toEqual(DEFAULT_COLORS);
      });

      it("ignores things dragged over the colours that are not colours", async () => {
        mountBrand();
        await ready();
        const dataTransfer = transfer();
        fireEvent.dragOver(items()[2], { dataTransfer });
        expect(items()[2].classList.contains("is-over")).toBe(false);
        fireEvent.drop(items()[2], { dataTransfer });
        await sleep(30);
        expect((await getBrandKit()).colors).toEqual(DEFAULT_COLORS);
      });

      it("keeps the order when a colour is dropped where it was", async () => {
        mountBrand();
        await ready();
        const dataTransfer = transfer();
        fireEvent.dragStart(items()[1], { dataTransfer });
        fireEvent.dragOver(items()[1], { dataTransfer });
        expect(items()[1].classList.contains("is-over")).toBe(false);
        fireEvent.drop(items()[1], { dataTransfer });
        await sleep(30);
        expect((await getBrandKit()).colors).toEqual(DEFAULT_COLORS);
      });
    });
  });

  describe("fonts", () => {
    it("explains an empty list", async () => {
      await withKit({ fonts: [] });
      mountBrand();
      await ready();
      expect(within(card("Brand fonts")).getByText("No brand fonts yet")).toBeTruthy();
    });

    it("names the category of each font, and calls one outside the catalogue custom", async () => {
      await withKit({ fonts: ["Inter", "Lora", "Pacifico", "My Own Font"] });
      mountBrand();
      await ready();
      const meta = Array.from(document.querySelectorAll(".cf-brand__font-meta")).map((el) => el.textContent);
      expect(meta[0]).toBe("Sans serif · Heading");
      expect(meta[1]).toBe("Serif · Body");
      expect(meta[2]).not.toMatch(/·/);
      expect(meta[3]).toBe("Custom font");
    });

    it("removes a font from the kit", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Remove Playfair Display from the brand kit" }));
      await waitFor(async () => expect((await getBrandKit()).fonts).toEqual(["Plus Jakarta Sans"]));
    });

    it("lists every catalogue font in the picker, marking the ones in the kit", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Add font" }));
      const list = screen.getByRole("listbox", { name: "Fonts" });
      const options = within(list).getAllByRole("option");
      expect(options).toHaveLength(FONT_CATALOG.length);
      expect(
        within(list)
          .getByRole("option", { name: /Plus Jakarta Sans/ })
          .getAttribute("aria-selected"),
      ).toBe("true");
      expect(within(list).getByRole("option", { name: /Inter/ }).getAttribute("aria-selected")).toBe("false");
    });

    it("adds a font by clicking it, and takes it out again with a second click", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Add font" }));
      await user.click(within(screen.getByRole("listbox", { name: "Fonts" })).getByRole("option", { name: /^Lora/ }));
      await waitFor(async () => expect((await getBrandKit()).fonts).toEqual(["Plus Jakarta Sans", "Playfair Display", "Lora"]));
      await waitFor(() =>
        expect(
          within(screen.getByRole("listbox", { name: "Fonts" }))
            .getByRole("option", { name: /^Lora/ })
            .getAttribute("aria-selected"),
        ).toBe("true"),
      );
      await user.click(within(screen.getByRole("listbox", { name: "Fonts" })).getByRole("option", { name: /^Lora/ }));
      await waitFor(async () => expect((await getBrandKit()).fonts).toEqual(["Plus Jakarta Sans", "Playfair Display"]));
    });

    it("toggles a font from the keyboard with Enter and Space", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Add font" }));
      const option = within(screen.getByRole("listbox", { name: "Fonts" })).getByRole("option", { name: /^Lora/ });
      option.focus();
      await user.keyboard("{Enter}");
      await waitFor(async () => expect((await getBrandKit()).fonts).toContain("Lora"));
      // the option takes its state from the live store, which refreshes after the write: Space toggles what it shows
      await waitFor(() => expect(option.getAttribute("aria-selected")).toBe("true"));
      await user.keyboard(" ");
      await waitFor(async () => expect((await getBrandKit()).fonts).not.toContain("Lora"));
      expect(fireEvent.keyDown(option, { key: "a" })).toBe(true);
    });

    it("searches the fonts by name or by category", async () => {
      const user = userEvent.setup();
      mountBrand();
      await ready();
      await user.click(screen.getByRole("button", { name: "Add font" }));
      const search = screen.getByRole("searchbox", { name: "Search fonts" });
      await user.type(search, "mono");
      const names = within(screen.getByRole("listbox", { name: "Fonts" }))
        .getAllByRole("option")
        .map((el) => el.querySelector(".cf-brand__fontoption-name")?.textContent);
      expect(names.length).toBeGreaterThan(0);
      expect(names.length).toBeLessThan(FONT_CATALOG.length);
      for (const def of FONT_CATALOG.filter((item) => item.category === "mono")) expect(names).toContain(def.family);
      await user.clear(search);
      await user.type(search, "zzzqqq");
      expect(within(screen.getByRole("listbox", { name: "Fonts" })).getByText("No font matches “zzzqqq”.")).toBeTruthy();
    });

    it("loads a font's face when its row scrolls into view", async () => {
      const ensure = vi.spyOn(fonts, "ensureFont");
      const user = userEvent.setup();
      mountBrand();
      await ready();
      ensure.mockClear();
      await user.click(screen.getByRole("button", { name: "Add font" }));
      await waitFor(() => expect(ensure).toHaveBeenCalledWith(FONT_CATALOG[0].family, 400));
    });

    it("loads the faces at once in a browser that cannot tell what is visible", async () => {
      vi.stubGlobal("IntersectionObserver", undefined);
      const ensure = vi.spyOn(fonts, "ensureFont");
      const user = userEvent.setup();
      mountBrand();
      await ready();
      ensure.mockClear();
      await user.click(screen.getByRole("button", { name: "Add font" }));
      await waitFor(() => expect(ensure).toHaveBeenCalledWith(FONT_CATALOG[0].family, 400));
      vi.unstubAllGlobals();
    });
  });
});
