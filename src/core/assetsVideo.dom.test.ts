import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFile, wipeDatabase } from "@/test/logicDb";
import { addAssetFromFile, checkUpload, isAcceptedVideo, MAX_VIDEO_BYTES, UNPLAYABLE_VIDEO_MESSAGE, VIDEO_TOO_BIG_MESSAGE, videoInfo, videoType } from "./assets";

/** A <video> that reads a clip's metadata the way a browser does, as the test says it should. */
class FakeVideo {
  static next: { width: number; height: number; duration: number; fail?: boolean; endsAt?: number; never?: boolean } = { width: 1280, height: 720, duration: 8 };
  muted = false;
  preload = "";
  videoWidth = 0;
  videoHeight = 0;
  duration = Number.NaN;
  onloadedmetadata: (() => void) | null = null;
  ondurationchange: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  removed = false;
  private at = 0;
  get currentTime() {
    return this.at;
  }
  set currentTime(v: number) {
    this.at = v;
    const { endsAt } = FakeVideo.next;
    queueMicrotask(() => {
      // a browser that finds the end of a recording says so with durationchange; one that cannot, only with seeked
      if (endsAt !== undefined) {
        this.duration = endsAt;
        this.ondurationchange?.();
      } else this.onseeked?.();
    });
  }
  set src(_url: string) {
    const next = FakeVideo.next;
    if (next.never) return;
    queueMicrotask(() => {
      if (next.fail) return this.onerror?.();
      this.videoWidth = next.width;
      this.videoHeight = next.height;
      this.duration = next.duration;
      this.onloadedmetadata?.();
    });
  }
  removeAttribute() {
    this.removed = true;
  }
  load() {}
}

const realCreate = document.createElement.bind(document);
beforeEach(async () => {
  await wipeDatabase();
  FakeVideo.next = { width: 1280, height: 720, duration: 8 };
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "video" ? (new FakeVideo() as unknown as HTMLVideoElement) : realCreate(tag)) as typeof document.createElement);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:clip");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which files are clips", () => {
  it("knows a clip by its type, the type's parameters and case aside", () => {
    expect(videoType(fakeFile("a", "video/mp4"))).toBe("video/mp4");
    expect(videoType(fakeFile("a", "Video/WebM; codecs=vp9"))).toBe("video/webm");
    expect(videoType(fakeFile("a", "video/ogg"))).toBe("video/ogg");
  });

  it("knows a clip by its name only when the browser gave no type, or a vague one", () => {
    expect(videoType(fakeFile("a.MP4", ""), "a.MP4")).toBe("video/mp4");
    expect(videoType(fakeFile("a.m4v", "application/octet-stream"), "a.m4v")).toBe("video/mp4");
    expect(videoType(fakeFile("a.ogv", ""), "a.ogv")).toBe("video/ogg");
    expect(videoType(fakeFile("a.webm", "text/html"), "a.webm")).toBeNull();
    expect(videoType(fakeFile("a.mov", ""), "a.mov")).toBeNull();
    expect(videoType(fakeFile("a", ""))).toBeNull();
  });

  it("refuses a kind of video browsers do not all play", () => {
    expect(videoType(fakeFile("a.mov", "video/quicktime"), "a.mov")).toBeNull();
    expect(isAcceptedVideo(fakeFile("clip.webm", ""))).toBe(true);
    expect(isAcceptedVideo(fakeFile("photo.png", "image/png"))).toBe(false);
  });

  it("keeps a clip under its own type, never as a picture", async () => {
    const checked = await checkUpload(new Blob(["x"], { type: "" }), "holiday.webm");
    expect(checked.kind).toBe("video");
    expect(checked.mime).toBe("video/webm");
    expect(checked.blob.type).toBe("video/webm");
  });
});

describe("reading a clip's size and length", () => {
  it("reads them from the clip's first bytes, and lets go of its address", async () => {
    expect(await videoInfo(new Blob(["x"]))).toEqual({ width: 1280, height: 720, duration: 8 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:clip");
  });

  it("finds the length of a recording that does not say it, by looking for its end", async () => {
    FakeVideo.next = { width: 640, height: 480, duration: Number.POSITIVE_INFINITY, endsAt: 12.5 };
    expect(await videoInfo(new Blob(["x"]))).toEqual({ width: 640, height: 480, duration: 12.5 });
  });

  it("reads a length that cannot be found as unknown", async () => {
    FakeVideo.next = { width: 640, height: 480, duration: Number.POSITIVE_INFINITY };
    expect(await videoInfo(new Blob(["x"]))).toEqual({ width: 640, height: 480, duration: 0 });
    FakeVideo.next = { width: 640, height: 480, duration: 0 };
    expect(await videoInfo(new Blob(["x"]))).toEqual({ width: 640, height: 480, duration: 0 });
  });

  it("gives nothing for a clip without a picture, one that fails, or one that never answers", async () => {
    FakeVideo.next = { width: 0, height: 0, duration: 3 };
    expect(await videoInfo(new Blob(["x"]))).toBeNull();
    FakeVideo.next = { width: 1, height: 1, duration: 3, fail: true };
    expect(await videoInfo(new Blob(["x"]))).toBeNull();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    FakeVideo.next = { width: 1, height: 1, duration: 3, never: true };
    const waiting = videoInfo(new Blob(["x"]), 1000);
    vi.advanceTimersByTime(1000);
    expect(await waiting).toBeNull();
  });
});

describe("uploading a clip", () => {
  it("stores it with its size, under its own type", async () => {
    const asset = await addAssetFromFile(fakeFile("Beach day.mp4", "video/mp4"));
    expect(asset).toMatchObject({ name: "Beach day", kind: "video", mime: "video/mp4", width: 1280, height: 720 });
  });

  it("refuses one this browser cannot play, with words that say so", async () => {
    FakeVideo.next = { width: 1, height: 1, duration: 1, fail: true };
    await expect(addAssetFromFile(fakeFile("broken.mp4", "video/mp4"))).rejects.toThrow(UNPLAYABLE_VIDEO_MESSAGE);
  });

  it("refuses one larger than Craftly keeps", async () => {
    // the stored copy of the clip is what is weighed
    vi.spyOn(Blob.prototype, "size", "get").mockReturnValue(MAX_VIDEO_BYTES + 1);
    await expect(addAssetFromFile(fakeFile("long.mp4", "video/mp4"))).rejects.toThrow(VIDEO_TOO_BIG_MESSAGE);
    expect(VIDEO_TOO_BIG_MESSAGE).toContain("250 MB");
  });
});
