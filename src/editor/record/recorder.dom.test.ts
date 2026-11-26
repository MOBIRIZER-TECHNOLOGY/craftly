/** Recording the camera or the screen (recorder.ts), on fakes of the browser's devices and recorder. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { FakeRecorder, FakeStream, FakeTrack, installMedia, uninstallMedia } from "./fakeMedia";
import { MAX_RECORDING_SECONDS, fileTypeOf, openStream, problemOf, record, recorderType, recordingName, recordingSupport, stopStream } from "./recorder";

let asked: ReturnType<typeof installMedia>;
beforeEach(() => {
  asked = installMedia();
  FakeRecorder.supported = new Set(["video/webm;codecs=vp8,opus", "video/webm"]);
});
afterEach(() => {
  uninstallMedia();
  vi.useRealTimers();
});

describe("what this browser can record", () => {
  it("is the camera and the screen where it has both and a recorder", () => {
    expect(recordingSupport()).toEqual({ camera: true, screen: true });
  });

  it("is neither without a recorder, without the devices, or on a page that is not secure", () => {
    vi.stubGlobal("MediaRecorder", undefined);
    expect(recordingSupport()).toEqual({ camera: false, screen: false });
    installMedia();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: async () => null } });
    expect(recordingSupport()).toEqual({ camera: true, screen: false });
    vi.stubGlobal("isSecureContext", false);
    expect(recordingSupport()).toEqual({ camera: false, screen: false });
  });
});

describe("the format of a recording", () => {
  it("is the best one the browser records, or the browser's choice", () => {
    expect(recorderType()).toBe("video/webm;codecs=vp8,opus");
    FakeRecorder.supported = new Set(["video/mp4"]);
    expect(recorderType()).toBe("video/mp4");
    FakeRecorder.supported = new Set();
    expect(recorderType()).toBe("");
    vi.stubGlobal("MediaRecorder", undefined);
    expect(recorderType()).toBe("");
  });

  it("is stored without its codecs, under a name with the time and the extension", () => {
    expect(fileTypeOf("video/webm;codecs=vp9,opus")).toBe("video/webm");
    expect(fileTypeOf("Video/MP4")).toBe("video/mp4");
    expect(fileTypeOf("")).toBe("video/webm");
    const when = new Date(2026, 10, 26, 9, 5);
    expect(recordingName(when, "video/webm;codecs=vp8")).toBe("Recording 2026-11-26 09.05.webm");
    expect(recordingName(when, "video/mp4")).toBe("Recording 2026-11-26 09.05.mp4");
  });
});

describe("why a recording could not start", () => {
  it("is told apart by the error the browser gives", () => {
    expect(problemOf({ name: "NotAllowedError" })).toBe("denied");
    expect(problemOf(Object.assign(new Error("x"), { name: "SecurityError" }))).toBe("denied");
    expect(problemOf({ name: "NotFoundError" })).toBe("missing");
    expect(problemOf({ name: "OverconstrainedError" })).toBe("missing");
    expect(problemOf({ name: "NotReadableError" })).toBe("busy");
    expect(problemOf({ name: "AbortError" })).toBe("busy");
    expect(problemOf(new TypeError("no"))).toBe("unsupported");
    expect(problemOf({ name: "Odd" })).toBe("failed");
    expect(problemOf("nothing")).toBe("failed");
    expect(problemOf(null)).toBe("failed");
  });
});

describe("opening what is recorded", () => {
  it("asks for the camera, with the microphone when there is to be sound", async () => {
    const stream = (await openStream("camera", true)) as unknown as FakeStream;
    expect(asked.user[0]).toMatchObject({ video: { width: { ideal: 1280 } }, audio: true });
    expect(stream.getAudioTracks()).toHaveLength(1);
    await openStream("camera", false);
    expect(asked.user[1]).toMatchObject({ audio: false });
  });

  it("asks for the screen, and mixes the microphone in when there is to be sound", async () => {
    const silent = (await openStream("screen", false)) as unknown as FakeStream;
    expect(asked.display).toHaveLength(1);
    expect(asked.user).toHaveLength(0);
    expect(silent.getAudioTracks()).toHaveLength(0);
    const loud = (await openStream("screen", true)) as unknown as FakeStream;
    expect(asked.user[0]).toEqual({ audio: true, video: false });
    expect(loud.getVideoTracks()).toHaveLength(1);
    expect(loud.getAudioTracks()).toHaveLength(1);
  });

  it("records the screen without sound when the microphone is refused, and passes on a refused screen", async () => {
    asked.refuseMic = true;
    const stream = (await openStream("screen", true)) as unknown as FakeStream;
    expect(stream.getAudioTracks()).toHaveLength(0);
    asked.refuse = { name: "NotAllowedError" };
    await expect(openStream("screen", false)).rejects.toMatchObject({ name: "NotAllowedError" });
  });

  it("stops every track of a stream, and nothing when there is none", () => {
    const tracks = [new FakeTrack("video"), new FakeTrack("audio")];
    stopStream(new FakeStream(tracks) as unknown as MediaStream);
    expect(tracks.every((t) => t.stopped)).toBe(true);
    expect(() => stopStream(null)).not.toThrow();
  });
});

describe("a recording", () => {
  const stream = () => new FakeStream([new FakeTrack("video"), new FakeTrack("audio")]);

  it("records in pieces of a second, in the best format, and gives the clip when stopped, the stream left running", async () => {
    const s = stream();
    const r = record(s as unknown as MediaStream);
    const rec = FakeRecorder.made[0];
    expect(rec.mimeType).toBe("video/webm;codecs=vp8,opus");
    expect(rec.timeslice).toBe(1000);
    rec.pieces = ["one", "", "two"];
    r.stop();
    const blob = await r.done;
    expect(blob.type).toBe("video/webm");
    expect(await blob.text()).toBe("onetwo");
    expect(s.tracks.some((t) => t.stopped)).toBe(false);
    // stopping again does nothing
    r.stop();
  });

  it("stops when its picture ends (sharing stopped in the browser)", async () => {
    const s = stream();
    const r = record(s as unknown as MediaStream);
    s.tracks[0].end();
    expect(FakeRecorder.made[0].state).toBe("inactive");
    expect((await r.done).size).toBeGreaterThan(0);
  });

  it("stops by itself at the longest a recording may run", async () => {
    vi.useFakeTimers();
    const r = record(stream() as unknown as MediaStream);
    vi.advanceTimersByTime(MAX_RECORDING_SECONDS * 1000 - 1);
    expect(FakeRecorder.made[0].state).toBe("recording");
    vi.advanceTimersByTime(1);
    expect(FakeRecorder.made[0].state).toBe("inactive");
    await r.done;
  });

  it("fails when the recorder breaks down, and lets the browser choose a format it names", async () => {
    FakeRecorder.supported = new Set();
    const r = record(stream() as unknown as MediaStream, 5000);
    const rec = FakeRecorder.made[0];
    expect(rec.mimeType).toBe("");
    rec.fail();
    await expect(r.done).rejects.toThrow("recorder");
    // a format the recorder names itself is what the clip is stored as
    const again = record(stream() as unknown as MediaStream, 5000);
    FakeRecorder.made[1].mimeType = "video/mp4;codecs=avc1";
    again.stop();
    expect((await again.done).type).toBe("video/mp4");
  });
});
