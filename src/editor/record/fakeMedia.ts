/**
 * Test doubles for recording (recorder.ts, RecordDialog.tsx): tracks and streams that can be stopped and ended, a MediaRecorder that
 * hands out what it was given to record, and the browser's mediaDevices. jsdom has none of these.
 */
import { vi } from "vitest";

export class FakeTrack extends EventTarget {
  stopped = false;
  constructor(readonly kind: "video" | "audio") {
    super();
  }
  stop() {
    this.stopped = true;
  }
  /** the browser ended it (the person stopped sharing the screen) */
  end() {
    this.dispatchEvent(new Event("ended"));
  }
}

export class FakeStream {
  constructor(readonly tracks: FakeTrack[]) {}
  getTracks() {
    return this.tracks;
  }
  getVideoTracks() {
    return this.tracks.filter((t) => t.kind === "video");
  }
  getAudioTracks() {
    return this.tracks.filter((t) => t.kind === "audio");
  }
}

export const fakeStream = (sound = true) => new FakeStream([new FakeTrack("video"), ...(sound ? [new FakeTrack("audio")] : [])]);

export class FakeRecorder {
  static supported = new Set(["video/webm;codecs=vp8,opus", "video/webm"]);
  static made: FakeRecorder[] = [];
  static isTypeSupported(type: string) {
    return FakeRecorder.supported.has(type);
  }
  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  timeslice = 0;
  /** what each piece holds, handed out at start and at stop */
  pieces: string[] = ["frames"];
  ondataavailable: ((e: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor(
    readonly stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeRecorder.made.push(this);
  }
  start(timeslice: number) {
    this.state = "recording";
    this.timeslice = timeslice;
  }
  stop() {
    this.state = "inactive";
    for (const p of this.pieces) this.ondataavailable?.({ data: new Blob([p]) });
    this.onstop?.();
  }
  /** the browser's recorder broke down */
  fail() {
    this.onerror?.();
  }
}

/** Puts the fakes in place: `getUserMedia` and `getDisplayMedia` give a fresh fake stream, or throw `refuse` when it is set. */
export function installMedia() {
  FakeRecorder.made = [];
  const asked = { user: [] as unknown[], display: [] as unknown[], refuse: null as null | { name: string }, refuseMic: false };
  const getUserMedia = vi.fn(async (constraints: { video?: unknown; audio?: unknown }) => {
    asked.user.push(constraints);
    if (asked.refuse) throw Object.assign(new Error(asked.refuse.name), asked.refuse);
    if (asked.refuseMic && !constraints.video) throw Object.assign(new Error("NotAllowedError"), { name: "NotAllowedError" });
    return constraints.video ? fakeStream(!!constraints.audio) : new FakeStream([new FakeTrack("audio")]);
  });
  const getDisplayMedia = vi.fn(async (constraints: unknown) => {
    asked.display.push(constraints);
    if (asked.refuse) throw Object.assign(new Error(asked.refuse.name), asked.refuse);
    return fakeStream(false);
  });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("MediaStream", FakeStream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia, getDisplayMedia } });
  return asked;
}

export function uninstallMedia() {
  vi.unstubAllGlobals();
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
}
