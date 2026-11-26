import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, listAssets, restoreAssets } from "@/core/assets";
import { useEditor } from "@/core/store";
import { resetTimeline, useTimeline } from "@/editor/timeline/timelineStore";
import type { ImageElement } from "@/core/types";
import { DRAG_MIME } from "@/editor/insert";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { emptyDesign, fakeDataTransfer, imageFile, lastElement, mountPanels, pageElements, svgFile } from "@/test/tabsHarness";

/* The real asset store (fake IndexedDB), wrapped so a test can hold back or fail an upload. */
vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  // a sound's length: jsdom plays no media
  return { ...real, addAssetFromFile: vi.fn(real.addAssetFromFile), audioInfo: vi.fn(async () => ({ duration: 12 })) };
});

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

async function seed(...names: string[]) {
  const ids: string[] = [];
  for (const name of names) {
    ids.push((await addAssetFromFile(imageFile(name))).id);
    // newest first is by timestamp
    await new Promise((resolve) => setTimeout(resolve, 3));
  }
  return ids;
}

async function openUploads(...seeded: string[]) {
  await seed(...seeded);
  const user = userEvent.setup();
  mountPanels({ tab: "uploads", design: emptyDesign() });
  await screen.findByRole("searchbox", { name: "Search uploads by name" });
  // wait until the library has been read: the first upload is on show, or the empty library says so
  if (seeded.length) await screen.findByRole("button", { name: `Add ${seeded[0].replace(/\.[^.]+$/, "")} to the page` });
  else await screen.findByText("Upload, store and organize");
  return user;
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const zone = () => document.querySelector(".cf-uploads__zone") as HTMLElement;
const cardNames = () => Array.from(document.querySelectorAll(".cf-uploads__name")).map((n) => n.textContent);

describe("Uploads tab", () => {
  describe("an empty library", () => {
    it("explains what uploads are and invites a first one", async () => {
      const user = await openUploads();
      expect(await screen.findByText("Upload, store and organize")).toBeTruthy();
      expect(screen.getByText("Add your own photos and logos. They stay in this browser, ready for any design.")).toBeTruthy();
      expect(zone().classList.contains("is-empty")).toBe(true);
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await user.click(screen.getByRole("button", { name: /Drop images, videos or sounds here/ }));
      expect(click.mock.contexts).toContain(fileInput());
      expect(screen.queryByText("No uploads found")).toBeNull();
    });
  });

  describe("the list", () => {
    it("shows the uploads newest first, each named after its file", async () => {
      await openUploads("old.png", "middle.png", "new.png");
      // two columns, filled row by row from the newest: new | middle, then old under new
      const columns = Array.from(document.querySelectorAll(".cf-masonry__col")).map((col) => Array.from(col.querySelectorAll(".cf-uploads__name")).map((n) => n.textContent));
      expect(columns).toEqual([["new", "old"], ["middle"]]);
      expect(zone().classList.contains("is-empty")).toBe(false);
      expect(screen.queryByText("Upload, store and organize")).toBeNull();
      expect(screen.getByRole("button", { name: /Drop images, videos or sounds here/ })).toBeTruthy();
    });

    it("keeps each picture's proportions", async () => {
      await openUploads("one.png");
      const thumb = document.querySelector(".cf-uploads__thumb") as HTMLElement;
      expect(thumb.style.aspectRatio).toBe("64 / 48");
      await waitFor(() => expect(thumb.querySelector("img")?.getAttribute("src")).toMatch(/^blob:test\//));
    });

    it("finds uploads by part of their name and says when there are none", async () => {
      const user = await openUploads("holiday-beach.png", "holiday-city.png", "logo.png");
      await user.type(screen.getByRole("searchbox"), "HOLIDAY");
      await waitFor(() => expect(cardNames().sort()).toEqual(["holiday-beach", "holiday-city"]));
      await user.clear(screen.getByRole("searchbox"));
      await user.type(screen.getByRole("searchbox"), "zzz");
      expect(await screen.findByText("No uploads found")).toBeTruthy();
      expect(screen.getByText('No upload name contains "zzz".')).toBeTruthy();
    });

    it("puts an upload on the page when it is clicked", async () => {
      const user = await openUploads("poster.png");
      const before = pageElements().length;
      await user.click(screen.getByRole("button", { name: "Add poster to the page" }));
      const el = lastElement() as ImageElement;
      expect(pageElements()).toHaveLength(before + 1);
      expect(el.src).toMatch(/^asset:/);
      expect([el.naturalWidth, el.naturalHeight]).toEqual([64, 48]);
    });

    it("hands an upload to the canvas when dragged", async () => {
      await openUploads("poster.png");
      const dt = fakeDataTransfer();
      fireEvent.dragStart(screen.getByRole("button", { name: "Add poster to the page" }), { dataTransfer: dt });
      const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
      expect(payload).toMatchObject({ type: "image", naturalWidth: 64, naturalHeight: 48, name: "poster" });
      expect(payload.src).toMatch(/^asset:/);
    });

    it("opens the file chooser from the strip above the list too", async () => {
      const user = await openUploads("existing.png");
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await user.click(screen.getByRole("button", { name: /Drop images, videos or sounds here/ }));
      expect(click.mock.contexts).toContain(fileInput());
    });

    it("measures a vector logo from its viewBox", async () => {
      const user = userEvent.setup();
      mountPanels({ tab: "uploads", design: emptyDesign() });
      await screen.findByRole("searchbox", { name: "Search uploads by name" });
      await user.upload(fileInput(), svgFile("vector-logo.svg", 120, 60));
      await user.click(await screen.findByRole("button", { name: "Add vector-logo to the page" }));
      const el = lastElement() as ImageElement;
      expect(el.naturalWidth / el.naturalHeight).toBeCloseTo(2);
    });
  });

  describe("uploading", () => {
    it("opens the file chooser from the button", async () => {
      const user = await openUploads();
      const click = vi.spyOn(HTMLInputElement.prototype, "click");
      await user.click(screen.getByRole("button", { name: "Upload files" }));
      expect(click.mock.contexts).toContain(fileInput());
      expect(fileInput().accept).toBe("image/*,video/mp4,video/webm,video/ogg,audio/mpeg,audio/mp4,audio/aac,audio/wav,audio/ogg,audio/webm,audio/flac,.mp3,.m4a,.wav,.ogg,.flac");
      expect(fileInput().multiple).toBe(true);
    });

    it("adds the chosen pictures to the list", async () => {
      const user = await openUploads();
      await user.upload(fileInput(), [imageFile("a.png"), imageFile("b.jpg", "image/jpeg")]);
      await waitFor(() => expect(cardNames().sort()).toEqual(["a", "b"]));
      expect(fileInput().value).toBe("");
      expect(screen.queryByText("Upload, store and organize")).toBeNull();
    });

    it("shows the button as busy while pictures are being stored", async () => {
      const user = await openUploads();
      let release!: () => void;
      vi.mocked(addAssetFromFile).mockImplementationOnce(async (file) => {
        await new Promise<void>((resolve) => (release = resolve));
        return addAssetFromFile(file);
      });
      await user.upload(fileInput(), imageFile("slow.png"));
      const button = screen.getByRole("button", { name: "Upload files" });
      await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
      await act(async () => release());
      await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
      expect(cardNames()).toEqual(["slow"]);
    });

    it("explains when nothing chosen is an image", async () => {
      await openUploads();
      fireEvent.change(fileInput(), { target: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
      expect(await screen.findByText("Only images, videos and sounds can be uploaded: PNG, JPG, WebP, GIF, AVIF, BMP, SVG, MP4, WebM, Ogg, MP3, M4A, WAV or FLAC.")).toBeTruthy();
      expect(await listAssets()).toHaveLength(0);
    });

    it("stores the pictures and says how many other files were skipped", async () => {
      await openUploads();
      fireEvent.change(fileInput(), { target: { files: [imageFile("keep.png"), new File(["x"], "a.txt", { type: "text/plain" })] } });
      expect(await screen.findByText("1 file was skipped because it is not an image, a video or a sound.")).toBeTruthy();
      await waitFor(() => expect(cardNames()).toEqual(["keep"]));
    });

    it("counts several skipped files", async () => {
      await openUploads();
      fireEvent.change(fileInput(), {
        target: { files: [imageFile("keep.png"), new File(["x"], "a.txt", { type: "text/plain" }), new File(["y"], "b.doc", { type: "application/msword" })] },
      });
      expect(await screen.findByText("2 files were skipped because they are not images, videos or sounds.")).toBeTruthy();
    });

    it("reports the uploads that failed and keeps the ones that worked", async () => {
      await openUploads();
      vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("quota"));
      fireEvent.change(fileInput(), { target: { files: [imageFile("bad.png"), imageFile("good.png")] } });
      expect(await screen.findByText("1 upload failed. Try a smaller image.")).toBeTruthy();
      await waitFor(() => expect(cardNames()).toEqual(["good"]));
    });

    it("says 'uploads' when several failed", async () => {
      await openUploads();
      vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("quota")).mockRejectedValueOnce(new Error("quota"));
      fireEvent.change(fileInput(), { target: { files: [imageFile("a.png"), imageFile("b.png")] } });
      expect(await screen.findByText("2 uploads failed. Try a smaller image.")).toBeTruthy();
    });

    it("does nothing when the chooser is closed without a file", async () => {
      await openUploads();
      fireEvent.change(fileInput(), { target: { files: [] } });
      await Promise.resolve();
      expect(screen.queryByRole("status")).toBeNull();
      expect(screen.queryByRole("alert")).toBeNull();
    });
  });

  describe("dropping files on the panel", () => {
    const files = () => fakeDataTransfer({ files: [imageFile("dropped.png")], types: ["Files"] });

    it("shows where to drop while files are dragged over it, and stays so across nested elements", async () => {
      await openUploads("existing.png");
      expect(zone().classList.contains("is-over")).toBe(false);
      fireEvent.dragEnter(zone(), { dataTransfer: files() });
      expect(zone().classList.contains("is-over")).toBe(true);
      expect(within(zone()).getByText("Drop to upload")).toBeTruthy();
      // moving onto a child fires another enter before the leave of the parent
      fireEvent.dragEnter(zone(), { dataTransfer: files() });
      fireEvent.dragLeave(zone());
      expect(zone().classList.contains("is-over")).toBe(true);
      fireEvent.dragLeave(zone());
      expect(zone().classList.contains("is-over")).toBe(false);
      expect(within(zone()).getByText("Drop images, videos or sounds here")).toBeTruthy();
    });

    it("also shows it in the empty library", async () => {
      await openUploads();
      fireEvent.dragEnter(zone(), { dataTransfer: files() });
      expect(
        within(zone())
          .getByRole("button", { name: /Drop to upload/ })
          .classList.contains("is-over"),
      ).toBe(true);
    });

    it("lets files be dropped as a copy", async () => {
      await openUploads();
      const dt = files();
      const event = fireEvent.dragOver(zone(), { dataTransfer: dt });
      expect(event).toBe(false);
      expect(dt.dropEffect).toBe("copy");
    });

    it("ignores things that are not files", async () => {
      await openUploads();
      const text = fakeDataTransfer({ types: ["text/plain"] });
      expect(fireEvent.dragEnter(zone(), { dataTransfer: text })).toBe(true);
      expect(zone().classList.contains("is-over")).toBe(false);
      expect(fireEvent.dragOver(zone(), { dataTransfer: text })).toBe(true);
      expect(text.dropEffect).toBe("none");
    });

    it("uploads what is dropped", async () => {
      await openUploads();
      fireEvent.dragEnter(zone(), { dataTransfer: files() });
      fireEvent.drop(zone(), { dataTransfer: files() });
      expect(zone().classList.contains("is-over")).toBe(false);
      await waitFor(() => expect(cardNames()).toEqual(["dropped"]));
    });

    it("explains when a dropped file is not a picture", async () => {
      await openUploads();
      fireEvent.drop(zone(), { dataTransfer: fakeDataTransfer({ files: [new File(["x"], "a.txt", { type: "text/plain" })], types: ["Files"] }) });
      expect(await screen.findByText("Only images, videos and sounds can be uploaded: PNG, JPG, WebP, GIF, AVIF, BMP, SVG, MP4, WebM, Ogg, MP3, M4A, WAV or FLAC.")).toBeTruthy();
    });
  });

  describe("one upload's menu", () => {
    async function openMenu(name = "poster") {
      const user = await openUploads(`${name}.png`);
      await user.click(screen.getByRole("button", { name: `More actions for ${name}` }));
      const menu = await screen.findByRole("menu", { name: `Actions for ${name}` });
      return { user, menu };
    }

    it("offers insert, rename and delete", async () => {
      const { menu } = await openMenu();
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((i) => i.textContent),
      ).toEqual(["Insert", "Rename", "Delete"]);
      expect(screen.getByRole("button", { name: "More actions for poster" }).getAttribute("aria-expanded")).toBe("true");
    });

    it("inserts the picture on the page", async () => {
      const { user, menu } = await openMenu();
      const before = pageElements().length;
      await user.click(within(menu).getByRole("menuitem", { name: "Insert" }));
      expect(pageElements()).toHaveLength(before + 1);
      expect((lastElement() as ImageElement).src).toMatch(/^asset:/);
    });

    describe("renaming", () => {
      async function startRename() {
        const { user, menu } = await openMenu();
        await user.click(within(menu).getByRole("menuitem", { name: "Rename" }));
        const field = (await screen.findByRole("textbox", { name: "Upload name" })) as HTMLInputElement;
        return { user, field };
      }

      it("replaces the name with a field that starts with the current name", async () => {
        const { field } = await startRename();
        expect(field.value).toBe("poster");
        expect(document.activeElement).toBe(field);
        expect(cardNames()).toEqual([]);
      });

      it("saves the new name on Enter", async () => {
        const { user, field } = await startRename();
        await user.clear(field);
        await user.type(field, "Summer poster{Enter}");
        await waitFor(() => expect(cardNames()).toEqual(["Summer poster"]));
        expect((await listAssets())[0].name).toBe("Summer poster");
        expect(screen.queryByRole("textbox", { name: "Upload name" })).toBeNull();
      });

      it("saves the new name when the field loses focus", async () => {
        const { user, field } = await startRename();
        await user.clear(field);
        await user.type(field, "Blurred");
        await user.click(document.body);
        await waitFor(() => expect(cardNames()).toEqual(["Blurred"]));
      });

      it("keeps the name when Escape is pressed", async () => {
        const { user, field } = await startRename();
        await user.clear(field);
        await user.type(field, "Never saved{Escape}");
        expect(screen.queryByRole("textbox", { name: "Upload name" })).toBeNull();
        expect(cardNames()).toEqual(["poster"]);
        expect((await listAssets())[0].name).toBe("poster");
      });

      it("keeps the name when it is emptied or left unchanged", async () => {
        const { user, field } = await startRename();
        await user.clear(field);
        await user.type(field, "   {Enter}");
        await waitFor(() => expect(cardNames()).toEqual(["poster"]));
        await user.click(screen.getByRole("button", { name: "More actions for poster" }));
        await user.click(await screen.findByRole("menuitem", { name: "Rename" }));
        const again = (await screen.findByRole("textbox", { name: "Upload name" })) as HTMLInputElement;
        await user.type(again, "{Enter}");
        await waitFor(() => expect(cardNames()).toEqual(["poster"]));
        expect((await listAssets())[0].name).toBe("poster");
      });
    });

    describe("deleting", () => {
      it("asks first, and keeps the upload on Cancel", async () => {
        const { user, menu } = await openMenu();
        await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
        const dialog = await screen.findByRole("dialog");
        expect(within(dialog).getByText('Delete "poster"?')).toBeTruthy();
        expect(within(dialog).getByText("Designs that use this image will show an empty frame in its place. This cannot be undone.")).toBeTruthy();
        await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
        expect(cardNames()).toEqual(["poster"]);
        expect(await listAssets()).toHaveLength(1);
      });

      it("removes the upload once confirmed", async () => {
        const { user, menu } = await openMenu();
        await user.click(within(menu).getByRole("menuitem", { name: "Delete" }));
        await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete" }));
        expect(await screen.findByText("Upload deleted")).toBeTruthy();
        await waitFor(() => expect(cardNames()).toEqual([]));
        expect(await listAssets()).toHaveLength(0);
        expect(await screen.findByText("Upload, store and organize")).toBeTruthy();
      });
    });
  });

  describe("a sound", () => {
    const song = {
      id: "a_song",
      name: "Theme",
      kind: "audio" as const,
      mime: "audio/mpeg",
      size: 3,
      width: 0,
      height: 0,
      createdAt: 1,
      blob: new Blob(["mp3"], { type: "audio/mpeg" }),
    };
    afterEach(() => resetTimeline());

    it("is a card with its length that puts it on the timeline, not on the page", async () => {
      await restoreAssets([song]);
      const user = userEvent.setup();
      mountPanels({ tab: "uploads", design: emptyDesign() });
      const card = await screen.findByRole("button", { name: "Add Theme to the timeline" });
      expect(await within(card).findByText("0:12")).toBeTruthy();
      await user.click(card);
      await waitFor(() => expect(useEditor.getState().design!.audio).toHaveLength(1));
      expect(useEditor.getState().design!.audio![0]).toMatchObject({ src: "asset:a_song", name: "Theme", duration: 12, startAt: 0 });
      expect(pageElements()).toHaveLength(0);
      expect(useTimeline.getState().open).toBe(true);
    });

    it("says what deleting it does", async () => {
      await restoreAssets([song]);
      const user = userEvent.setup();
      mountPanels({ tab: "uploads", design: emptyDesign() });
      await screen.findByRole("button", { name: "Add Theme to the timeline" });
      await user.click(screen.getByRole("button", { name: "More actions for Theme" }));
      expect(screen.getByRole("menuitem", { name: "Add Theme to the timeline" })).toBeTruthy();
      await user.click(screen.getByRole("menuitem", { name: "Delete" }));
      expect(await screen.findByText("Designs that use this sound will be silent where it played. This cannot be undone.")).toBeTruthy();
    });
  });
});
