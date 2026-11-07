import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, deleteAsset, listAssets } from "@/core/assets";
import { createImage, createShape, solid } from "@/core/factory";
import { getBrandKit, setBrandKit } from "@/core/library";
import { getActivePage, useEditor } from "@/core/store";
import type { Asset, ShapeElement } from "@/core/types";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { emptyDesign, imageFile, mountPanels, stubCanvasPixels, svgFile } from "@/test/tabsHarness";
import { useAppsNav } from "./appKit";
import { extractPalette } from "./quantize";

/* The real asset store and brand kit (fake IndexedDB), with the three calls a test wants to steer wrapped. */
vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  return { ...real, addAssetFromFile: vi.fn(real.addAssetFromFile), listAssets: vi.fn(real.listAssets) };
});
vi.mock("./quantize", async (importOriginal) => {
  const real = await importOriginal<typeof import("./quantize")>();
  return { ...real, extractPalette: vi.fn(real.extractPalette) };
});

const PALETTE = ["#e11d48", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0e1318"];

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  useAppsNav.setState({ app: "palette", query: "" });
  // no leftovers (queued answers, calls) from the test before
  vi.mocked(extractPalette).mockReset();
  vi.mocked(extractPalette).mockImplementation(async () => PALETTE);
  vi.mocked(addAssetFromFile).mockClear();
});

async function seed(...names: string[]): Promise<Asset[]> {
  const made: Asset[] = [];
  for (const name of names) {
    made.push(await addAssetFromFile(name.endsWith(".svg") ? svgFile(name) : imageFile(name)));
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  return made;
}

async function openPalette(...uploads: string[]) {
  const assets = await seed(...uploads);
  const user = userEvent.setup();
  mountPanels({ tab: "apps", design: emptyDesign() });
  await screen.findByRole("heading", { name: "Colour palette from image" });
  return { user, assets };
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const swatches = () => within(screen.getByRole("group", { name: "Palette colours" })).getAllByRole("button");
const choice = (name: string) => screen.getByRole("option", { name });

describe("Colour palette from image app", () => {
  describe("without any upload", () => {
    it("asks for an image first", async () => {
      const { user } = await openPalette();
      expect(await screen.findByText("Upload an image first")).toBeTruthy();
      expect(screen.getByText("Choose a photo or logo and Craftly pulls its six main colours out of it.")).toBeTruthy();
      expect(screen.queryByRole("listbox", { name: "Your uploads" })).toBeNull();
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await user.click(screen.getByRole("button", { name: "Upload an image" }));
      expect(click.mock.contexts).toContain(fileInput());
    });

    it("moves on to the palette once an image is uploaded here", async () => {
      const { user } = await openPalette();
      await screen.findByText("Upload an image first");
      await user.upload(fileInput(), imageFile("first-photo.png"));
      expect(await screen.findByRole("listbox", { name: "Your uploads" })).toBeTruthy();
      expect(choice("first-photo").getAttribute("aria-selected")).toBe("true");
      await waitFor(() => expect(swatches()).toHaveLength(6));
    });

    it("explains an image that cannot be read", async () => {
      const { user } = await openPalette();
      await screen.findByText("Upload an image first");
      vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("bad"));
      await user.upload(fileInput(), imageFile("bad.png"));
      expect(await screen.findByText("That image could not be read. Try a different file.")).toBeTruthy();
      expect(screen.getByText("Upload an image first")).toBeTruthy();
    });

    it("ignores a file that is not an image", async () => {
      await openPalette();
      await screen.findByText("Upload an image first");
      fireEvent.change(fileInput(), { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
      await Promise.resolve();
      expect(screen.getByText("Upload an image first")).toBeTruthy();
      expect(screen.queryByRole("alert")).toBeNull();
    });

    it("holds a placeholder while the uploads are being read", async () => {
      let release!: (list: Asset[]) => void;
      vi.mocked(listAssets).mockImplementationOnce(() => new Promise<Asset[]>((resolve) => (release = resolve)));
      mountPanels({ tab: "apps", design: emptyDesign() });
      await screen.findByRole("heading", { name: "Colour palette from image" });
      expect(screen.getByText("Pick an image").parentElement?.querySelector(".cf-skeleton")).toBeTruthy();
      expect(screen.queryByText("Upload an image first")).toBeNull();
      await act(async () => release([]));
      expect(await screen.findByText("Upload an image first")).toBeTruthy();
    });
  });

  describe("with uploads", () => {
    it("picks the newest upload and shows its six colours", async () => {
      await openPalette("old.png", "new.png");
      await waitFor(() => expect(swatches()).toHaveLength(6));
      expect(choice("new").getAttribute("aria-selected")).toBe("true");
      expect(choice("old").getAttribute("aria-selected")).toBe("false");
      expect(swatches().map((s) => s.getAttribute("aria-label"))).toEqual(PALETTE.map((c) => `${c.toUpperCase()} - click to apply`));
      expect(screen.getByText("E11D48")).toBeTruthy();
      expect(document.querySelectorAll(".cf-pal__bar span")).toHaveLength(6);
      expect(vi.mocked(extractPalette)).toHaveBeenCalledWith(expect.stringMatching(/^blob:test\//), 6);
    });

    it("shows placeholders for the colours until they are found", async () => {
      let release!: (colours: string[]) => void;
      vi.mocked(extractPalette).mockImplementationOnce(() => new Promise<string[]>((resolve) => (release = resolve)));
      await openPalette("photo.png");
      await waitFor(() => expect(vi.mocked(extractPalette)).toHaveBeenCalledTimes(1));
      expect(document.querySelectorAll(".cf-pal__swatches[aria-busy='true'] .cf-skeleton")).toHaveLength(6);
      expect(screen.getByRole("button", { name: "Save to brand kit" }).hasAttribute("disabled")).toBe(true);
      expect(document.querySelector(".cf-pal__bar")).toBeNull();
      await act(async () => release(PALETTE));
      await waitFor(() => expect(swatches()).toHaveLength(6));
      expect(screen.getByRole("button", { name: "Save to brand kit" }).hasAttribute("disabled")).toBe(false);
    });

    it("finds the colours of another upload when it is chosen", async () => {
      const { user } = await openPalette("old.png", "new.png");
      await waitFor(() => expect(swatches()).toHaveLength(6));
      vi.mocked(extractPalette).mockImplementation(async () => ["#111111", "#222222"]);
      await user.click(choice("old"));
      expect(choice("old").getAttribute("aria-selected")).toBe("true");
      await waitFor(() => expect(swatches().map((s) => s.getAttribute("aria-label"))).toEqual(["#111111 - click to apply", "#222222 - click to apply"]));
    });

    it("ignores colours that arrive after another upload was chosen", async () => {
      let first!: (colours: string[]) => void;
      vi.mocked(extractPalette).mockImplementationOnce(() => new Promise<string[]>((resolve) => (first = resolve)));
      const { user } = await openPalette("old.png", "new.png");
      await waitFor(() => expect(vi.mocked(extractPalette)).toHaveBeenCalledTimes(1));
      vi.mocked(extractPalette).mockImplementation(async () => ["#abcdef"]);
      await user.click(choice("old"));
      await waitFor(() => expect(swatches()).toHaveLength(1));
      await act(async () => first(PALETTE));
      expect(swatches()).toHaveLength(1);
      expect(swatches()[0].getAttribute("aria-label")).toBe("#ABCDEF - click to apply");
    });

    it("lists vector logos too", async () => {
      await openPalette("mark.svg");
      expect(await screen.findByRole("option", { name: "mark" })).toBeTruthy();
    });

    it("shows at most eleven uploads", async () => {
      await openPalette(...Array.from({ length: 12 }, (_, i) => `pic-${i}.png`));
      await waitFor(() => expect(within(screen.getByRole("listbox", { name: "Your uploads" })).getAllByRole("option")).toHaveLength(11));
    });

    it("shows each upload's picture", async () => {
      await openPalette("photo.png");
      await waitFor(() => expect(choice("photo").querySelector("img")?.getAttribute("src")).toMatch(/^blob:test\//));
    });

    describe("when the colours cannot be found", () => {
      it("says so for an image without any", async () => {
        vi.mocked(extractPalette).mockImplementation(async () => []);
        await openPalette("blank.png");
        expect(await screen.findByText("We could not read colours from that image. Try a different one.")).toBeTruthy();
        expect(screen.getByRole("button", { name: "Save to brand kit" }).hasAttribute("disabled")).toBe(true);
      });

      it("says so for an image that cannot be read", async () => {
        vi.mocked(extractPalette).mockImplementation(async () => {
          throw new Error("cannot decode");
        });
        await openPalette("broken.png");
        expect(await screen.findByText("We could not read colours from that image. Try a different one.")).toBeTruthy();
      });

      it("finds nothing in the harness's blank canvas, as a real transparent picture would", async () => {
        const real = await vi.importActual<typeof import("./quantize")>("./quantize");
        vi.mocked(extractPalette).mockImplementation(real.extractPalette);
        await openPalette("transparent.png");
        expect(await screen.findByText("We could not read colours from that image. Try a different one.")).toBeTruthy();
      });

      it("reads real pixels when there are some", async () => {
        const real = await vi.importActual<typeof import("./quantize")>("./quantize");
        vi.mocked(extractPalette).mockImplementation(real.extractPalette);
        const stub = stubCanvasPixels(
          [
            [220, 40, 60],
            [30, 120, 220],
            [250, 200, 20],
          ],
          300,
        );
        try {
          await openPalette("flag.png");
          // three equally common colours: found in whatever order, but all three
          await waitFor(() =>
            expect(
              swatches()
                .map((s) => s.getAttribute("aria-label")?.split(" ")[0])
                .sort(),
            ).toEqual(["#1E78DC", "#DC283C", "#FAC814"]),
          );
        } finally {
          stub.restore();
        }
      });
    });

    describe("using a colour", () => {
      it("colours the selected shape", async () => {
        const shape = createShape("rect");
        const design = emptyDesign();
        design.pages[0].elements = [shape];
        const assets = await seed("photo.png");
        const user = userEvent.setup();
        mountPanels({ tab: "apps", design });
        await screen.findByRole("heading", { name: "Colour palette from image" });
        useEditor.getState().actions.select([shape.id]);
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(swatches()[1]);
        expect((getActivePage(useEditor.getState())!.elements[0] as ShapeElement).fill).toEqual(solid("#2563eb"));
        expect(assets).toHaveLength(1);
      });

      it("colours the page when nothing is selected", async () => {
        const { user } = await openPalette("photo.png");
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(swatches()[0]);
        expect(getActivePage(useEditor.getState())?.background).toEqual(solid("#e11d48"));
      });

      it("explains when the selection cannot take a colour", async () => {
        const photo = createImage({ src: "builtin:sunset-hills" });
        const design = emptyDesign();
        design.pages[0].elements = [photo];
        await seed("photo.png");
        const user = userEvent.setup();
        mountPanels({ tab: "apps", design });
        await screen.findByRole("heading", { name: "Colour palette from image" });
        useEditor.getState().actions.select([photo.id]);
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(swatches()[0]);
        expect(await screen.findByText(/Select some text, a shape or a line first/)).toBeTruthy();
      });
    });

    describe("saving to the brand kit", () => {
      it("adds the colours that are new to the kit", async () => {
        const { user } = await openPalette("photo.png");
        await setBrandKit({ colors: ["#E11D48", "#ffffff"], fonts: [], logos: [] });
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(screen.getByRole("button", { name: "Save to brand kit" }));
        expect(await screen.findByText("5 colours added to your brand kit")).toBeTruthy();
        expect((await getBrandKit()).colors).toEqual(["#E11D48", "#ffffff", "#2563eb", "#16a34a", "#f59e0b", "#7c3aed", "#0e1318"]);
      });

      it("says '1 colour' for a single new one", async () => {
        const { user } = await openPalette("photo.png");
        await setBrandKit({ colors: PALETTE.slice(1), fonts: [], logos: [] });
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(screen.getByRole("button", { name: "Save to brand kit" }));
        expect(await screen.findByText("1 colour added to your brand kit")).toBeTruthy();
      });

      it("says when they are all in the kit already", async () => {
        const { user } = await openPalette("photo.png");
        await setBrandKit({ colors: PALETTE.map((c) => c.toUpperCase()), fonts: [], logos: [] });
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(screen.getByRole("button", { name: "Save to brand kit" }));
        expect(await screen.findByText("Those colours are already in your brand kit.")).toBeTruthy();
        expect((await getBrandKit()).colors).toHaveLength(6);
      });

      it("keeps the kit to 24 colours", async () => {
        const { user } = await openPalette("photo.png");
        const full = Array.from({ length: 22 }, (_, i) => `#${(i + 16).toString(16).padStart(2, "0")}1111`);
        await setBrandKit({ colors: full, fonts: [], logos: [] });
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await user.click(screen.getByRole("button", { name: "Save to brand kit" }));
        await screen.findByText("6 colours added to your brand kit");
        const colors = (await getBrandKit()).colors;
        expect(colors).toHaveLength(24);
        expect(colors.slice(0, 22)).toEqual(full);
        expect(colors.slice(22)).toEqual(PALETTE.slice(0, 2));
      });
    });

    describe("adding another image", () => {
      it("uploads it, chooses it and finds its colours", async () => {
        const { user } = await openPalette("first.png");
        await waitFor(() => expect(swatches()).toHaveLength(6));
        vi.mocked(extractPalette).mockImplementation(async () => ["#010203"]);
        const click = vi.spyOn(HTMLInputElement.prototype, "click");
        await user.click(screen.getByRole("button", { name: "Upload another image" }));
        expect(click.mock.contexts).toContain(fileInput());
        await user.upload(fileInput(), imageFile("second.png"));
        await waitFor(() => expect(choice("second").getAttribute("aria-selected")).toBe("true"));
        await waitFor(() => expect(swatches().map((s) => s.getAttribute("aria-label"))).toEqual(["#010203 - click to apply"]));
        expect(fileInput().value).toBe("");
      });

      it("explains an image that cannot be read and keeps the current one", async () => {
        const { user } = await openPalette("first.png");
        await waitFor(() => expect(swatches()).toHaveLength(6));
        vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("bad"));
        await user.upload(fileInput(), imageFile("bad.png"));
        expect(await screen.findByText("That image could not be read. Try a different file.")).toBeTruthy();
        expect(choice("first").getAttribute("aria-selected")).toBe("true");
        expect((screen.getByRole("button", { name: "Upload another image" }) as HTMLButtonElement).disabled).toBe(false);
      });

      it("disables the button while the image is being stored", async () => {
        const { user } = await openPalette("first.png");
        let release!: () => void;
        vi.mocked(addAssetFromFile).mockImplementationOnce(async (file) => {
          await new Promise<void>((resolve) => (release = resolve));
          return (await vi.importActual<typeof import("@/core/assets")>("@/core/assets")).addAssetFromFile(file);
        });
        await user.upload(fileInput(), imageFile("second.png"));
        await waitFor(() => expect((screen.getByRole("button", { name: "Upload another image" }) as HTMLButtonElement).disabled).toBe(true));
        await act(async () => release());
        await waitFor(() => expect((screen.getByRole("button", { name: "Upload another image" }) as HTMLButtonElement).disabled).toBe(false));
      });
    });

    describe("when the chosen upload is deleted", () => {
      it("moves on to the next newest", async () => {
        const { assets } = await openPalette("old.png", "new.png");
        await waitFor(() => expect(choice("new").getAttribute("aria-selected")).toBe("true"));
        await act(async () => deleteAsset(assets[1].id));
        await waitFor(() => expect(choice("old").getAttribute("aria-selected")).toBe("true"));
        expect(screen.queryByRole("option", { name: "new" })).toBeNull();
      });

      it("asks for an image again when the last one is gone", async () => {
        const { assets } = await openPalette("only.png");
        await waitFor(() => expect(swatches()).toHaveLength(6));
        await act(async () => deleteAsset(assets[0].id));
        expect(await screen.findByText("Upload an image first")).toBeTruthy();
      });
    });
  });
});
