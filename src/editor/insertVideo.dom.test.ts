/** Putting clips on the page: a dragged clip from the uploads, checked like any drop, and a video file dropped or picked. */
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { getActions, getActivePage, useEditor } from "@/core/store";
import { createDesign, createPage } from "@/core/factory";
import type { Asset, ImageElement, VideoElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { insertImageFiles, insertPayload, insertVideo, readDragPayload, videoElementFor } from "./insert";

// jsdom plays no clip: storing one and reading its length are answered here
vi.mock("@/core/assets", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/core/assets")>()), addAssetFromFile: vi.fn(), videoInfo: vi.fn() }));

const addAssetFromFile = vi.mocked(assets.addAssetFromFile);
const videoInfo = vi.mocked(assets.videoInfo);

const state = () => useEditor.getState();
const elements = () => getActivePage(state())!.elements;
const open = () => getActions().openDesign(createDesign({ title: "Clips", width: 1000, height: 600, pages: [createPage()] }));
const stored = (file: File, over: Partial<Asset> = {}): Asset => ({
  id: `a_${file.name.replace(/\W/g, "")}`,
  name: file.name,
  kind: assets.videoType(file, file.name) ? "video" : "image",
  mime: assets.videoType(file, file.name) ?? file.type,
  size: file.size,
  width: 1920,
  height: 1080,
  createdAt: 1,
  blob: file,
  ...over,
});
const dropped = (payload: unknown) => readDragPayload({ dataTransfer: { getData: () => JSON.stringify(payload) } } as unknown as DragEvent);
const clipPayload = { type: "video", src: "asset:a_clip", naturalWidth: 1280, naturalHeight: 720, duration: 12.5 };

beforeEach(() => {
  resetEditor();
  addAssetFromFile.mockReset();
  addAssetFromFile.mockImplementation(async (file) => stored(file));
  videoInfo.mockReset();
  videoInfo.mockResolvedValue({ width: 1920, height: 1080, duration: 9 });
});

describe("a dragged clip", () => {
  it("is read back with its size, its length and its name", () => {
    expect(dropped({ ...clipPayload, name: "Holiday" })).toEqual({ ...clipPayload, name: "Holiday" });
    expect(dropped(clipPayload)).toEqual(clipPayload);
  });

  it("drops a name that is not text", () => {
    expect(dropped({ ...clipPayload, name: 5 })).toEqual(clipPayload);
  });

  it.each([
    ["a picture on the web", { src: "https://example.test/clip.mp4" }],
    ["a built-in photo", { src: "builtin:nebula" }],
    ["an upload with a strange id", { src: "asset:../x" }],
    ["no source", { src: undefined }],
    ["no width", { naturalWidth: 0 }],
    ["no height", { naturalHeight: Number.NaN }],
    ["no length", { duration: undefined }],
    ["a length of nothing", { duration: 0 }],
  ])("is refused when it is %s", (_, over) => {
    expect(dropped({ ...clipPayload, ...over })).toBeNull();
  });
});

describe("videoElementFor", () => {
  it("sizes a clip as a picture is, to half the page width, playing the whole clip", () => {
    const el = videoElementFor({ width: 1000, height: 600 }, "asset:a_clip", 1280, 720, 12.5, "Holiday");
    expect(el).toMatchObject({
      type: "video",
      src: "asset:a_clip",
      width: 500,
      height: 281,
      naturalWidth: 1280,
      naturalHeight: 720,
      duration: 12.5,
      trimStart: 0,
      trimEnd: 12.5,
      name: "Holiday",
    });
  });

  it("limits a portrait clip to 70 % of the page height, and gives no name when it has none", () => {
    const el = videoElementFor({ width: 1000, height: 600 }, "asset:a_clip", 720, 1280, 3);
    expect(el.height).toBe(420);
    expect(el.width).toBe(236);
    expect(el.name).toBeUndefined();
  });
});

describe("insertVideo", () => {
  it("does nothing without an open design", () => {
    expect(insertVideo("asset:a_clip", 1280, 720, 4)).toBe("");
  });

  it("adds a clip in the middle of the page, or centred on the drop point, and selects it", () => {
    open();
    const middle = insertVideo("asset:a_clip", 1280, 720, 4);
    const dropped = insertVideo("asset:a_clip", 1280, 720, 4, { x: 300, y: 200 }, "Dropped");
    const [a, b] = elements() as VideoElement[];
    expect([a.id, b.id]).toEqual([middle, dropped]);
    expect(a.x + a.width / 2).toBeCloseTo(500);
    expect(a.y + a.height / 2).toBeCloseTo(300);
    expect(b.x + b.width / 2).toBeCloseTo(300);
    expect(b.y + b.height / 2).toBeCloseTo(200);
    expect(b.name).toBe("Dropped");
    expect(state().selection).toEqual([dropped]);
  });
});

describe("insertPayload with a clip", () => {
  it("places the dragged clip at the drop point with its name", () => {
    open();
    insertPayload({ type: "video", src: "asset:a_clip", naturalWidth: 1280, naturalHeight: 720, duration: 12.5, name: "Holiday" }, { x: 250, y: 150 });
    const [el] = elements() as VideoElement[];
    expect(el).toMatchObject({ type: "video", src: "asset:a_clip", duration: 12.5, trimEnd: 12.5, name: "Holiday" });
    expect(el.x + el.width / 2).toBeCloseTo(250);
  });
});

describe("insertImageFiles with a clip", () => {
  const mp4 = (name = "holiday.mp4") => new File(["x"], name, { type: "video/mp4" });

  it("stores the clip as an upload and adds a video element of its size and length", async () => {
    open();
    const ids = await insertImageFiles([mp4()]);
    expect(addAssetFromFile).toHaveBeenCalledTimes(1);
    expect(videoInfo).toHaveBeenCalledWith(addAssetFromFile.mock.calls[0][0]);
    const [el] = elements() as VideoElement[];
    expect(ids).toEqual([el.id]);
    expect(el).toMatchObject({ type: "video", src: "asset:a_holidaymp4", naturalWidth: 1920, naturalHeight: 1080, duration: 9, trimEnd: 9 });
  });

  it("gives a clip whose length cannot be read a length of one second", async () => {
    open();
    videoInfo.mockResolvedValueOnce(null).mockResolvedValueOnce({ width: 1, height: 1, duration: 0 });
    await insertImageFiles([mp4("one.mp4"), mp4("two.mp4")]);
    expect((elements() as VideoElement[]).map((e) => e.duration)).toEqual([1, 1]);
  });

  it("takes a clip by its name when it has no type, and puts clips and pictures down 32 pixels apart", async () => {
    open();
    const ids = await insertImageFiles([new File(["x"], "clip.webm"), new File(["x"], "photo.png", { type: "image/png" }), mp4()], { x: 400, y: 300 });
    expect(ids).toHaveLength(3);
    const [a, b, c] = elements();
    expect(a.type).toBe("video");
    expect((b as ImageElement).type).toBe("image");
    expect(c.type).toBe("video");
    expect(b.x + b.width / 2 - (a.x + a.width / 2)).toBeCloseTo(32);
    expect(c.y + c.height / 2 - (b.y + b.height / 2)).toBeCloseTo(32);
  });

  it("keeps the upload but places nothing when no design is open", async () => {
    expect(await insertImageFiles([mp4()])).toEqual([]);
    expect(addAssetFromFile).toHaveBeenCalledTimes(1);
  });
});
