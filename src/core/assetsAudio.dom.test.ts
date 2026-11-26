import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeFile, wipeDatabase } from "@/test/logicDb";
import { AUDIO_TOO_BIG_MESSAGE, MAX_AUDIO_BYTES, UNPLAYABLE_AUDIO_MESSAGE, addAssetFromFile, audioInfo, audioType, checkUpload, isAcceptedAudio } from "./assets";

/** An <audio> that reads a sound's metadata the way a browser does, as the test says it should. */
class FakeAudio {
  static next: { duration: number; fail?: boolean; endsAt?: number; never?: boolean } = { duration: 95 };
  preload = "";
  duration = Number.NaN;
  onloadedmetadata: (() => void) | null = null;
  ondurationchange: (() => void) | null = null;
  onseeked: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set currentTime(_v: number) {
    const { endsAt } = FakeAudio.next;
    queueMicrotask(() => {
      if (endsAt !== undefined) {
        this.duration = endsAt;
        this.ondurationchange?.();
      } else this.onseeked?.();
    });
  }
  set src(_url: string) {
    const next = FakeAudio.next;
    if (next.never) return;
    queueMicrotask(() => {
      if (next.fail) return this.onerror?.();
      this.duration = next.duration;
      this.onloadedmetadata?.();
    });
  }
  removeAttribute() {}
  load() {}
}

const realCreate = document.createElement.bind(document);
beforeEach(async () => {
  await wipeDatabase();
  FakeAudio.next = { duration: 95 };
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "audio" ? (new FakeAudio() as unknown as HTMLAudioElement) : realCreate(tag)) as typeof document.createElement);
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:sound");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("which files are sounds", () => {
  it("knows them by their type, by the other names of their type, or by their name when they have no type", () => {
    expect(audioType(fakeFile("a", "audio/mpeg"))).toBe("audio/mpeg");
    expect(audioType(fakeFile("a", "Audio/X-WAV"))).toBe("audio/wav");
    expect(audioType(fakeFile("a", "audio/mp3"))).toBe("audio/mpeg");
    expect(audioType(fakeFile("a", "audio/x-m4a"))).toBe("audio/mp4");
    expect(audioType(fakeFile("a", "audio/ogg; codecs=opus"))).toBe("audio/ogg");
    expect(audioType(fakeFile("a", ""), "song.MP3")).toBe("audio/mpeg");
    expect(audioType(fakeFile("a", "application/octet-stream"), "voice.m4a")).toBe("audio/mp4");
    expect(audioType(fakeFile("a", ""), "song.flac")).toBe("audio/flac");
    // a type that is something else is not overruled by a name
    expect(audioType(fakeFile("a", "text/html"), "song.mp3")).toBeNull();
    expect(audioType(fakeFile("a", "audio/midi"))).toBeNull();
    expect(audioType(fakeFile("a", ""), "song.mid")).toBeNull();
    expect(isAcceptedAudio(fakeFile("Song.wav", ""))).toBe(true);
    expect(isAcceptedAudio(fakeFile("clip.mp4", "video/mp4"))).toBe(false);
  });

  it("keeps a sound under the usual name of its type, never as a page", async () => {
    const checked = await checkUpload(new Blob(["x"], { type: "audio/x-wav" }));
    expect(checked).toMatchObject({ kind: "audio", mime: "audio/wav" });
    expect(checked.blob.type).toBe("audio/wav");
    expect(await checkUpload(new Blob(["x"]), "song.ogg")).toMatchObject({ kind: "audio", mime: "audio/ogg" });
  });

  it("reads a sound's length from its first bytes, finds it at its end when it is not said, and lets go of its address", async () => {
    expect(await audioInfo(new Blob(["x"]))).toEqual({ duration: 95 });
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:sound");
    FakeAudio.next = { duration: Number.POSITIVE_INFINITY, endsAt: 4.5 };
    expect(await audioInfo(new Blob(["x"]))).toEqual({ duration: 4.5 });
  });

  it("gives nothing for a sound with no length, one that fails, or one that never answers", async () => {
    FakeAudio.next = { duration: Number.POSITIVE_INFINITY };
    expect(await audioInfo(new Blob(["x"]))).toBeNull();
    FakeAudio.next = { duration: 3, fail: true };
    expect(await audioInfo(new Blob(["x"]))).toBeNull();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    FakeAudio.next = { duration: 3, never: true };
    const waiting = audioInfo(new Blob(["x"]), 1000);
    vi.advanceTimersByTime(1000);
    expect(await waiting).toBeNull();
  });
});

describe("uploading a sound", () => {
  it("stores it under its own type, with no size", async () => {
    const asset = await addAssetFromFile(fakeFile("Theme song.mp3", "audio/mpeg"));
    expect(asset).toMatchObject({ name: "Theme song", kind: "audio", mime: "audio/mpeg", width: 0, height: 0 });
  });

  it("refuses one this browser cannot play, and one larger than Craftly keeps, with words that say so", async () => {
    FakeAudio.next = { duration: 1, fail: true };
    await expect(addAssetFromFile(fakeFile("broken.mp3", "audio/mpeg"))).rejects.toThrow(UNPLAYABLE_AUDIO_MESSAGE);
    FakeAudio.next = { duration: 1 };
    vi.spyOn(Blob.prototype, "size", "get").mockReturnValue(MAX_AUDIO_BYTES + 1);
    await expect(addAssetFromFile(fakeFile("long.wav", "audio/wav"))).rejects.toThrow(AUDIO_TOO_BIG_MESSAGE);
    expect(AUDIO_TOO_BIG_MESSAGE).toContain("250 MB");
  });
});
