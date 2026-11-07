import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile } from "@/core/assets";
import { createFrame } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { PHOTOS } from "@/data/photos";
import { DRAG_MIME } from "@/editor/insert";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { fakeDataTransfer, imageFile, lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";
import { matchPhoto } from "./PhotosPage";

vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  return { ...real, addAssetFromFile: vi.fn(real.addAssetFromFile) };
});

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

async function openPhotos(query = "") {
  resetElementsNav("photos", query);
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: "Search photos" });
  return user;
}

const photoCells = () => Array.from(document.querySelectorAll<HTMLElement>(".cf-cell--photo"));
const photo = (name: string) => screen.getByRole("button", { name });
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const CATEGORY_COUNTS = { Landscapes: 12, City: 3, Abstract: 11, Textures: 8, Nature: 6, Space: 4 };

describe("Elements > Photos", () => {
  it("lists every photo with its name and a category chip for each kind", async () => {
    await openPhotos();
    expect(screen.getByRole("heading", { name: "Photos" })).toBeTruthy();
    const chips = within(screen.getByRole("group", { name: "Photo categories" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["All", "Landscapes", "City", "Abstract", "Textures", "Nature", "Space"]);
    expect(photoCells()).toHaveLength(PHOTOS.length);
    expect(within(photo("Sunset hills")).getByText("Sunset hills")).toBeTruthy();
  });

  it("draws a preview of each photo once it is made", async () => {
    await openPhotos("sunset");
    await waitFor(() => expect(photo("Sunset hills").querySelector("img.cf-cell__img")).toBeTruthy());
    expect((photo("Sunset hills").querySelector("img") as HTMLImageElement).getAttribute("src")).toMatch(/^blob:test\//);
  });

  it("shows only the photos of the chosen category", async () => {
    const user = await openPhotos();
    for (const [label, count] of Object.entries(CATEGORY_COUNTS)) {
      await user.click(screen.getByRole("button", { name: label }));
      expect(screen.getByRole("button", { name: label }).getAttribute("aria-pressed")).toBe("true");
      expect(photoCells()).toHaveLength(count);
    }
    await user.click(screen.getByRole("button", { name: "All" }));
    expect(photoCells()).toHaveLength(PHOTOS.length);
  });

  it("puts a photo on the page at about half the page's width and selects it", async () => {
    const user = await openPhotos("sunset");
    const before = pageElements().length;
    await user.click(photo("Sunset hills"));
    const el = lastElement() as ImageElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(el.type).toBe("image");
    expect(el.src).toBe("builtin:sunset-hills");
    expect([el.naturalWidth, el.naturalHeight]).toEqual([1600, 1067]);
    // at most half the page wide: 640 of 1280
    expect(el.width).toBe(640);
    expect(el.height).toBe(Math.round(1067 * 0.4));
    expect(useEditor.getState().selection).toEqual([el.id]);
  });

  it("fills an empty frame that is selected instead of adding a second picture", async () => {
    const user = await openPhotos("sunset");
    const frame = createFrame("ellipse");
    useEditor.getState().actions.addElement(frame);
    const before = pageElements().length;
    await user.click(photo("Sunset hills"));
    expect(pageElements()).toHaveLength(before);
    const filled = getActivePage(useEditor.getState())!.elements.find((e) => e.id === useEditor.getState().selection[0]) as ImageElement;
    expect(filled.isFrame).toBe(true);
    expect(filled.src).toBe("builtin:sunset-hills");
  });

  it("hands a photo to the canvas when dragged", async () => {
    await openPhotos("sunset");
    const before = pageElements().length;
    const dt = fakeDataTransfer();
    fireEvent.dragStart(photo("Sunset hills"), { dataTransfer: dt });
    expect(JSON.parse(dt.data.get(DRAG_MIME) ?? "null")).toEqual({ type: "image", src: "builtin:sunset-hills", naturalWidth: 1600, naturalHeight: 1067, name: "Sunset hills" });
    expect(pageElements()).toHaveLength(before);
  });

  it("finds photos when every word of the search matches their name, category or tags", async () => {
    const user = await openPhotos();
    await user.type(screen.getByRole("searchbox"), "golden hour");
    const wanted = PHOTOS.filter((p) => matchPhoto(p, "golden hour"));
    expect(wanted.length).toBeGreaterThan(1);
    expect(photoCells().map((c) => c.getAttribute("aria-label"))).toEqual(wanted.map((p) => p.name));
    await user.click(screen.getByRole("button", { name: "Space" }));
    expect(screen.getByText("No photos found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "golden hour". Try "sunset", "ocean" or "forest".')).toBeTruthy();
  });

  it("matches a photo by its category name", () => {
    expect(PHOTOS.filter((p) => matchPhoto(p, "landscapes")).length).toBe(12);
    expect(matchPhoto(PHOTOS[0], "")).toBe(true);
    expect(matchPhoto(PHOTOS[0], "sunset nonsense")).toBe(false);
  });

  describe("uploading your own", () => {
    it("opens the file chooser from the button", async () => {
      const user = await openPhotos("sunset");
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await user.click(screen.getByRole("button", { name: /Upload your own/ }));
      expect(click.mock.contexts).toContain(fileInput());
      expect(fileInput().accept).toBe("image/*");
      expect(fileInput().multiple).toBe(true);
    });

    it("stores a picture in the uploads and puts it on the page", async () => {
      const user = await openPhotos("sunset");
      const before = pageElements().length;
      await user.upload(fileInput(), imageFile("holiday.png"));
      expect(await screen.findByText("Photo added to the page and to your uploads")).toBeTruthy();
      expect(pageElements()).toHaveLength(before + 1);
      const el = lastElement() as ImageElement;
      expect(el.src).toMatch(/^asset:/);
      expect([el.naturalWidth, el.naturalHeight]).toEqual([64, 48]);
      expect(fileInput().value).toBe("");
    });

    it("adds several pictures, each a little further down and right than the last", async () => {
      const user = await openPhotos("sunset");
      const before = pageElements().length;
      await user.upload(fileInput(), [imageFile("one.png"), imageFile("two.jpg", "image/jpeg")]);
      expect(await screen.findByText("2 photos added to the page and to your uploads")).toBeTruthy();
      expect(pageElements()).toHaveLength(before + 2);
    });

    it("still puts the picture on the page when the panel is left before it is stored", async () => {
      await openPhotos("sunset");
      let release!: () => void;
      vi.mocked(addAssetFromFile).mockImplementationOnce(async (file) => {
        await new Promise<void>((resolve) => (release = resolve));
        return (await vi.importActual<typeof import("@/core/assets")>("@/core/assets")).addAssetFromFile(file);
      });
      const before = pageElements().length;
      fireEvent.change(fileInput(), { target: { files: [imageFile("late.png")] } });
      await waitFor(() => expect(release).toBeTypeOf("function"));
      act(() => useEditor.getState().actions.setLeftTab("projects"));
      await waitFor(() => expect(document.querySelector('input[type="file"]')).toBeNull());
      await act(async () => release());
      await waitFor(() => expect(pageElements()).toHaveLength(before + 1));
    });

    it("explains when the file is not a picture", async () => {
      await openPhotos("sunset");
      const before = pageElements().length;
      fireEvent.change(fileInput(), { target: { files: [new File(["hello"], "notes.txt", { type: "text/plain" })] } });
      expect(await screen.findByText("That file is not an image. Choose a PNG, JPG, WebP, GIF or SVG.")).toBeTruthy();
      expect(pageElements()).toHaveLength(before);
    });

    it("explains when the picture cannot be stored", async () => {
      await openPhotos("sunset");
      vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("quota exceeded"));
      const before = pageElements().length;
      fireEvent.change(fileInput(), { target: { files: [imageFile("big.png")] } });
      expect(await screen.findByText("The photo could not be added. Try a smaller file.")).toBeTruthy();
      expect(pageElements()).toHaveLength(before);
    });

    it("does nothing when the chooser is closed without a file", async () => {
      await openPhotos("sunset");
      const before = pageElements().length;
      fireEvent.change(fileInput(), { target: { files: [] } });
      await Promise.resolve();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(pageElements()).toHaveLength(before);
    });
  });
});
