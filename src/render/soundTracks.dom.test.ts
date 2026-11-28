import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AudioTrack } from "@/core/types";

vi.mock("@/core/assets", () => ({ getAssetUrl: vi.fn(async (id: string) => (id === "gone" ? null : `blob:${id}`)) }));

/** An <audio> that is ready at once and does what it is told, writing it down. */
class FakeAudio {
  static made: FakeAudio[] = [];
  preload = "";
  paused = true;
  seeking = false;
  readyState = 4;
  volume = 1;
  currentTime = 0;
  src = "";
  onerror: (() => void) | null = null;
  plays = 0;
  seeks: number[] = [];
  constructor() {
    FakeAudio.made.push(this);
    return new Proxy(this, {
      set(target, key, value) {
        if (key === "currentTime") target.seeks.push(value as number);
        (target as unknown as Record<string | symbol, unknown>)[key] = value;
        return true;
      },
    });
  }
  play() {
    this.plays++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
  removeAttribute() {
    this.src = "";
  }
  load() {}
}

const { playSoundsAt, releaseSounds, soundPlayerOf, stopSounds } = await import("./soundTracks");

const track = (over: Partial<AudioTrack> = {}): AudioTrack => ({ id: "au", src: "asset:song", duration: 10, trimStart: 1, trimEnd: 5, startAt: 2, ...over });
const realCreate = document.createElement.bind(document);
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  FakeAudio.made = [];
  vi.spyOn(document, "createElement").mockImplementation(((tag: string) =>
    tag === "audio" ? (new FakeAudio() as unknown as HTMLAudioElement) : realCreate(tag)) as typeof document.createElement);
});
afterEach(() => {
  releaseSounds();
  vi.restoreAllMocks();
});

describe("playing the sounds of a design", () => {
  it("plays a sound from its trimmed part at its moment, and lets it play on while it keeps up", async () => {
    playSoundsAt([track()], 0);
    await flush();
    const audio = soundPlayerOf("au") as unknown as FakeAudio;
    expect(audio.src).toBe("blob:song");
    // before it starts: quiet
    playSoundsAt([track()], 1);
    expect(audio.paused).toBe(true);
    playSoundsAt([track()], 3);
    expect(audio.seeks).toEqual([2]);
    expect(audio.paused).toBe(false);
    // it plays on by itself: a moment close to where it is changes nothing
    audio.currentTime = 2.1;
    audio.seeks = [];
    playSoundsAt([track()], 3.2);
    expect(audio.seeks).toEqual([]);
    expect(audio.plays).toBe(1);
    // far off: sought
    playSoundsAt([track()], 5);
    expect(audio.seeks).toEqual([4]);
  });

  it("goes quiet after a single play, round again for one that plays over and over, and from the end of the design", async () => {
    playSoundsAt([track()], 3);
    await flush();
    const audio = soundPlayerOf("au") as unknown as FakeAudio;
    playSoundsAt([track()], 3);
    playSoundsAt([track()], 6.5);
    expect(audio.paused).toBe(true);
    playSoundsAt([track({ loop: true })], 6.5);
    expect(audio.paused).toBe(false);
    expect(audio.seeks.at(-1)).toBe(1.5);
    playSoundsAt([track({ loop: true })], 6.5, 6);
    expect(audio.paused).toBe(true);
  });

  it("sets the loudness from its volume and fades", async () => {
    playSoundsAt([track()], 3);
    await flush();
    const audio = soundPlayerOf("au") as unknown as FakeAudio;
    playSoundsAt([track({ volume: 0.5, fadeIn: 2 })], 3);
    expect(audio.volume).toBeCloseTo(0.25);
  });

  it("waits for a sound that is not ready, gives up on one that is gone or broken, and lets go of one taken out", async () => {
    playSoundsAt([track({ id: "gone", src: "asset:gone" }), track()], 3);
    await flush();
    const audio = soundPlayerOf("au") as unknown as FakeAudio;
    audio.pause();
    audio.seeks = [];
    // not ready: neither sought nor started
    audio.readyState = 0;
    playSoundsAt([track()], 4);
    expect(audio.seeks).toEqual([]);
    expect(audio.paused).toBe(true);
    // broken: left alone
    audio.readyState = 4;
    audio.onerror?.();
    playSoundsAt([track()], 4);
    expect(audio.paused).toBe(true);
    playSoundsAt([], 3);
    expect(soundPlayerOf("au")).toBeUndefined();
    expect(soundPlayerOf("gone")).toBeUndefined();
    // a sound whose file is not one of the uploads gets no player
    playSoundsAt([track({ id: "web", src: "https://example.test/x.mp3" })], 3);
    expect(soundPlayerOf("web")).toBeUndefined();
  });

  it("takes a new player when a sound's file changes, and pauses every sound when the playback stops", async () => {
    playSoundsAt([track()], 3);
    await flush();
    const first = soundPlayerOf("au");
    playSoundsAt([track({ src: "asset:other" })], 3);
    await flush();
    expect(soundPlayerOf("au")).not.toBe(first);
    playSoundsAt([track({ src: "asset:other" })], 3);
    const second = soundPlayerOf("au") as unknown as FakeAudio;
    expect(second.paused).toBe(false);
    stopSounds();
    expect(second.paused).toBe(true);
  });
});
