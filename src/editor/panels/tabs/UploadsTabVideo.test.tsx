import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, assetSrc, listAssets, restoreAssets, videoInfo } from "@/core/assets";
import type { Asset, VideoElement } from "@/core/types";
import { DRAG_MIME } from "@/editor/insert";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { emptyDesign, fakeDataTransfer, lastElement, mountPanels, pageElements } from "@/test/tabsHarness";

/* The real asset store (fake IndexedDB). jsdom cannot read a clip, so its length is made up, and a test can fail an upload. */
vi.mock("@/core/assets", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/assets")>();
  return { ...real, addAssetFromFile: vi.fn(real.addAssetFromFile), videoInfo: vi.fn(async () => ({ width: 1920, height: 1080, duration: 9 })) };
});

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(340, 700);
  vi.mocked(videoInfo).mockClear();
});
afterEach(() => restoreLayout());

const videoAsset = (name = "trip", extra: Partial<Asset> = {}): Asset => ({
  id: `a-${name}`,
  name,
  kind: "video",
  mime: "video/mp4",
  size: 4,
  width: 1920,
  height: 1080,
  createdAt: Date.now(),
  blob: new Blob([new Uint8Array([0, 0, 0, 24])], { type: "video/mp4" }),
  ...extra,
});
const clipFile = (name = "clip.mp4", type = "video/mp4") => new File([new Uint8Array([0, 0, 0, 24])], name, { type });

async function openUploads(...seeded: Asset[]) {
  await restoreAssets(seeded);
  const user = userEvent.setup();
  mountPanels({ tab: "uploads", design: emptyDesign() });
  await screen.findByRole("searchbox", { name: "Search uploads by name" });
  if (seeded.length) await screen.findByRole("button", { name: `Add ${seeded[0].name} to the page` });
  else await screen.findByText("Upload, store and organize");
  return user;
}

const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const cardNames = () => Array.from(document.querySelectorAll(".cf-uploads__name")).map((n) => n.textContent);
const thumbVideo = async () => {
  await waitFor(() => expect(document.querySelector(".cf-uploads__thumb video")).toBeTruthy());
  return document.querySelector(".cf-uploads__thumb video") as HTMLVideoElement;
};
const badge = () => document.querySelector(".cf-uploads__badge") as HTMLElement;
/** The card's <video> says how long the clip is, as a browser does once it has read the start of the file. */
const readLength = (video: HTMLVideoElement, seconds: number) => {
  Object.defineProperty(video, "duration", { configurable: true, value: seconds });
  fireEvent.loadedMetadata(video);
};

describe("Uploads tab: videos", () => {
  describe("a clip in the list", () => {
    it("shows a silent preview of the clip, marked as a video", async () => {
      await openUploads(videoAsset());
      const video = await thumbVideo();
      expect(video.getAttribute("src")).toMatch(/^blob:test\//);
      expect(video.muted).toBe(true);
      expect(video.getAttribute("preload")).toBe("metadata");
      expect(document.querySelector(".cf-uploads__thumb img")).toBeNull();
      expect(badge().getAttribute("aria-label")).toBe("Video");
      expect(badge().textContent).toBe("Video");
      expect((document.querySelector(".cf-uploads__thumb") as HTMLElement).style.aspectRatio).toBe("1920 / 1080");
    });

    it("shows the length of the clip once its preview knows it", async () => {
      await openUploads(videoAsset());
      readLength(await thumbVideo(), 75);
      await waitFor(() => expect(badge().textContent).toBe("1:15"));
    });

    it("keeps saying Video for a clip whose length cannot be read", async () => {
      await openUploads(videoAsset());
      const video = await thumbVideo();
      readLength(video, Number.POSITIVE_INFINITY);
      expect(badge().textContent).toBe("Video");
      readLength(video, 0);
      expect(badge().textContent).toBe("Video");
    });
  });

  describe("putting a clip on the page", () => {
    it("places the clip with the length its preview read, without reading the file again", async () => {
      const user = await openUploads(videoAsset());
      readLength(await thumbVideo(), 12.5);
      await waitFor(() => expect(badge().textContent).toBe("0:13"));
      const before = pageElements().length;
      await user.click(screen.getByRole("button", { name: "Add trip to the page" }));
      expect(pageElements()).toHaveLength(before + 1);
      const el = lastElement() as VideoElement;
      expect(el).toMatchObject({ type: "video", src: assetSrc("a-trip"), naturalWidth: 1920, naturalHeight: 1080, duration: 12.5, trimStart: 0, trimEnd: 12.5, name: "trip" });
      expect(videoInfo).not.toHaveBeenCalled();
    });

    it("reads the length of a clip whose preview does not know it yet", async () => {
      const user = await openUploads(videoAsset());
      await user.click(screen.getByRole("button", { name: "Add trip to the page" }));
      await waitFor(() => expect(lastElement()?.type).toBe("video"));
      expect((lastElement() as VideoElement).duration).toBe(9);
      expect(videoInfo).toHaveBeenCalledTimes(1);
    });

    it("places a clip whose length cannot be read as one second long", async () => {
      vi.mocked(videoInfo).mockResolvedValueOnce(null);
      const user = await openUploads(videoAsset());
      await user.click(screen.getByRole("button", { name: "Add trip to the page" }));
      await waitFor(() => expect(lastElement()?.type).toBe("video"));
      expect(lastElement() as VideoElement).toMatchObject({ duration: 1, trimEnd: 1 });
    });

    it("places a clip from the Insert entry of its menu", async () => {
      const user = await openUploads(videoAsset());
      readLength(await thumbVideo(), 4);
      await waitFor(() => expect(badge().textContent).toBe("0:04"));
      await user.click(screen.getByRole("button", { name: "More actions for trip" }));
      await user.click(within(await screen.findByRole("menu", { name: "Actions for trip" })).getByRole("menuitem", { name: "Insert" }));
      expect(lastElement() as VideoElement).toMatchObject({ type: "video", duration: 4 });
    });

    it("hands a clip to the canvas when dragged, with its length once that is known", async () => {
      await openUploads(videoAsset());
      const card = screen.getByRole("button", { name: "Add trip to the page" });
      const early = fakeDataTransfer();
      fireEvent.dragStart(card, { dataTransfer: early });
      expect(JSON.parse(early.data.get(DRAG_MIME) ?? "null")).toEqual({
        type: "video",
        src: assetSrc("a-trip"),
        naturalWidth: 1920,
        naturalHeight: 1080,
        duration: 1,
        name: "trip",
      });
      fireEvent.dragEnd(card, { dataTransfer: early });
      readLength(await thumbVideo(), 30);
      await waitFor(() => expect(badge().textContent).toBe("0:30"));
      const late = fakeDataTransfer();
      fireEvent.dragStart(card, { dataTransfer: late });
      expect(JSON.parse(late.data.get(DRAG_MIME) ?? "null")).toMatchObject({ type: "video", duration: 30 });
    });
  });

  describe("deleting a clip", () => {
    it("warns that designs using the clip will show an empty box", async () => {
      const user = await openUploads(videoAsset());
      await user.click(screen.getByRole("button", { name: "More actions for trip" }));
      await user.click(within(await screen.findByRole("menu", { name: "Actions for trip" })).getByRole("menuitem", { name: "Delete" }));
      const dialog = await screen.findByRole("dialog");
      expect(within(dialog).getByText('Delete "trip"?')).toBeTruthy();
      expect(within(dialog).getByText("Designs that use this video will show an empty box in its place. This cannot be undone.")).toBeTruthy();
      await user.click(within(dialog).getByRole("button", { name: "Delete" }));
      await waitFor(async () => expect(await listAssets()).toHaveLength(0));
    });
  });

  describe("uploading a clip", () => {
    it("stores a chosen clip and lists it", async () => {
      const user = await openUploads();
      vi.mocked(addAssetFromFile).mockImplementationOnce(async () => {
        const asset = videoAsset("clip");
        await restoreAssets([asset]);
        return asset;
      });
      await user.upload(fileInput(), clipFile());
      await waitFor(() => expect(cardNames()).toEqual(["clip"]));
      expect(vi.mocked(addAssetFromFile).mock.calls[0][0].name).toBe("clip.mp4");
      expect(await thumbVideo()).toBeTruthy();
    });

    it("takes a clip known only by its name", async () => {
      await openUploads();
      vi.mocked(addAssetFromFile).mockImplementationOnce(async () => videoAsset("untyped"));
      fireEvent.change(fileInput(), { target: { files: [clipFile("untyped.webm", "")] } });
      await waitFor(() => expect(addAssetFromFile).toHaveBeenCalledTimes(1));
      expect(screen.queryByText(/skipped/)).toBeNull();
    });

    it("says in its own words why a clip could not be stored", async () => {
      await openUploads();
      vi.mocked(addAssetFromFile).mockRejectedValueOnce(new Error("This video is larger than 250 MB, the most Craftly keeps. Try a shorter or smaller file."));
      fireEvent.change(fileInput(), { target: { files: [clipFile("huge.mp4")] } });
      expect(await screen.findByText("This video is larger than 250 MB, the most Craftly keeps. Try a shorter or smaller file.")).toBeTruthy();
      expect(screen.queryByText(/upload failed/)).toBeNull();
    });

    it("counts a clip that failed without saying why among the failed uploads", async () => {
      await openUploads();
      vi.mocked(addAssetFromFile).mockRejectedValueOnce("no reason");
      fireEvent.change(fileInput(), { target: { files: [clipFile("odd.mp4")] } });
      expect(await screen.findByText("1 upload failed. Try a smaller image.")).toBeTruthy();
    });
  });
});
