/**
 * Recording a clip in the browser: the camera, or the screen (a window, a tab), with the microphone or without, through the
 * browser's own `getUserMedia`, `getDisplayMedia` and `MediaRecorder`. Nothing leaves the device: the recording becomes an upload
 * of this browser like a clip from a file (RecordDialog.tsx).
 */

export type RecordSource = "camera" | "screen";

/** The longest a recording runs before it stops by itself, in seconds (a clip of the uploads is at most 250 MB). */
export const MAX_RECORDING_SECONDS = 10 * 60;

/** What this browser can record: the camera, the screen; neither in a page that is not secure or a browser without them. */
export function recordingSupport(): { camera: boolean; screen: boolean } {
  const devices = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
  const recorder = typeof MediaRecorder !== "undefined";
  const secure = typeof window !== "undefined" && window.isSecureContext !== false;
  return {
    camera: secure && recorder && typeof devices?.getUserMedia === "function",
    screen: secure && recorder && typeof devices?.getDisplayMedia === "function",
  };
}

/** The formats tried, best first: WebM is what Chrome and Firefox record; MP4 what Safari does. */
const TYPES = ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm", "video/mp4;codecs=avc1,mp4a", "video/mp4"];

/** The first format of TYPES this browser records, or "" to let it choose. */
export function recorderType(): string {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return "";
  return TYPES.find((t) => MediaRecorder.isTypeSupported(t)) ?? "";
}

/** The type a recording is stored under: the format without its codecs ("video/webm"), as an upload of a clip is. */
export const fileTypeOf = (type: string): string => (type.split(";")[0].trim() || "video/webm").toLowerCase();

/** "Recording 2026-11-26 14.05.webm": the name of a recording made at `when`, with the extension of its type. */
export function recordingName(when: Date, type: string): string {
  const two = (n: number) => String(n).padStart(2, "0");
  const ext = fileTypeOf(type) === "video/mp4" ? "mp4" : "webm";
  return `Recording ${when.getFullYear()}-${two(when.getMonth() + 1)}-${two(when.getDate())} ${two(when.getHours())}.${two(when.getMinutes())}.${ext}`;
}

/** Why a recording could not start, in words the dialog can show. */
export type RecordProblem = "denied" | "missing" | "busy" | "unsupported" | "failed";

/** The problem a refused `getUserMedia` / `getDisplayMedia` stands for. */
export function problemOf(error: unknown): RecordProblem {
  const name = error instanceof Error || (typeof error === "object" && error !== null) ? String((error as { name?: unknown }).name ?? "") : "";
  if (name === "NotAllowedError" || name === "SecurityError" || name === "PermissionDeniedError") return "denied";
  if (name === "NotFoundError" || name === "OverconstrainedError" || name === "DevicesNotFoundError") return "missing";
  if (name === "NotReadableError" || name === "AbortError" || name === "TrackStartError") return "busy";
  if (name === "TypeError" || name === "NotSupportedError") return "unsupported";
  return "failed";
}

/** Stops every track of `stream`: the camera's light goes out, the browser stops saying the screen is shared. */
export function stopStream(stream: MediaStream | null | undefined): void {
  stream?.getTracks().forEach((t) => t.stop());
}

/**
 * The stream to record from `source`: the camera (with the microphone when `sound`), or the screen the person chooses (with the
 * microphone mixed in when `sound`; a screen's own sound is not asked for, since most browsers only give a tab's). A microphone
 * that is refused for a screen leaves the screen without sound rather than failing.
 */
export async function openStream(source: RecordSource, sound: boolean): Promise<MediaStream> {
  const devices = navigator.mediaDevices;
  if (source === "camera") {
    return devices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: sound });
  }
  const screen = await devices.getDisplayMedia({ video: { frameRate: { ideal: 30 } }, audio: false });
  if (!sound) return screen;
  try {
    const mic = await devices.getUserMedia({ audio: true, video: false });
    return new MediaStream([...screen.getVideoTracks(), ...mic.getAudioTracks()]);
  } catch {
    return screen;
  }
}

export interface Recording {
  /** stops it; the promise of `done` then gives the clip */
  stop(): void;
  /** the recorded clip, with the type it was recorded in; rejects when the recorder broke down */
  done: Promise<Blob>;
}

/**
 * Records `stream` until `stop()`, until its picture ends (a shared screen whose sharing was stopped in the browser), or for
 * MAX_RECORDING_SECONDS (`limitMs` in tests). The stream itself is left running: the dialog shows it again for another take.
 */
export function record(stream: MediaStream, limitMs = MAX_RECORDING_SECONDS * 1000): Recording {
  const type = recorderType();
  const recorder = new MediaRecorder(stream, type ? { mimeType: type } : undefined);
  const chunks: Blob[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const video = stream.getVideoTracks()[0];
  const stop = () => {
    if (timer) clearTimeout(timer);
    timer = undefined;
    video?.removeEventListener("ended", stop);
    if (recorder.state !== "inactive") recorder.stop();
  };
  const done = new Promise<Blob>((resolve, reject) => {
    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size) chunks.push(e.data);
    };
    recorder.onstop = () => resolve(new Blob(chunks, { type: fileTypeOf(recorder.mimeType || type) }));
    // a recorder that broke down fails the recording before it is stopped: what it gave out when stopping is not a clip
    recorder.onerror = () => {
      reject(new Error("recorder"));
      stop();
    };
  });
  video?.addEventListener("ended", stop);
  // pieces of a second: a recording that is stopped suddenly loses little
  recorder.start(1000);
  timer = setTimeout(stop, limitMs);
  return { stop, done };
}
