export type MlErrorCode =
  | "aborted" // the person cancelled
  | "unsupported" // no WebGPU, no worker, no storage
  | "not-installed" // the model has to be downloaded first
  | "engine" // the ONNX runtime itself could not be loaded (its file is missing or the network failed)
  | "locked" // the photo is locked or the design is view-only: nothing can be written to it
  | "offline" // no connection and the model is not on the device
  | "network" // the download broke off
  | "http" // the host answered with an error
  | "size" // the file is not the size the registry says
  | "hash" // the file is not the one the registry pins
  | "quota" // not enough disk space
  | "storage" // IndexedDB refused
  | "runtime" // the runtime or the model failed
  | "out-of-memory" // the GPU ran out of memory
  | "worker-crashed"
  | "image" // the picture could not be read
  | "stale" // the photo changed while the model ran
  | "no-subject" // nothing to cut out
  | "too-large" // the enlarged picture would be more than the app can keep
  | "busy"; // another job is running

const MESSAGES: Record<MlErrorCode, string> = {
  aborted: "Cancelled.",
  unsupported: "This browser can't run the model. Try the latest Chrome, Edge or Safari.",
  "not-installed": "The model isn't on this device yet.",
  engine: "The tool's engine could not be loaded. If you are offline, connect once so it can be stored.",
  locked: "This photo is locked, or the design is view-only. Unlock it or switch to editing, then try again.",
  offline: "You're offline and the model isn't on this device yet. Connect once to download it.",
  network: "The download was interrupted. Check your connection and try again.",
  http: "The model host didn't send the file. Try again in a moment.",
  size: "The file is not the expected size, so it was not used.",
  hash: "The file does not match the expected checksum, so it was not used.",
  quota: "There isn't enough free space on this device to store the model.",
  storage: "The browser would not store the model. Private windows often block this.",
  runtime: "The model could not run on this device.",
  "out-of-memory": "This device ran out of graphics memory. Close other tabs and try again.",
  "worker-crashed": "The background process stopped unexpectedly. Try again.",
  image: "That picture could not be read.",
  stale: "The photo changed while it was being processed, so nothing was applied.",
  "no-subject": "No subject was found in this photo.",
  "too-large": "This picture is too large to enlarge: the result would be over 25 megapixels. Choose a smaller factor, or crop the picture first.",
  busy: "Another photo is being processed. Wait for it to finish.",
};

/** An error whose message is fit to show to the person using the app. The technical cause rides along in `cause`. */
export class MlError extends Error {
  readonly code: MlErrorCode;

  constructor(code: MlErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? MESSAGES[code], options);
    this.name = "MlError";
    this.code = code;
  }
}

const isAbort = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AbortError";

/** Any thrown value as an MlError: its own code, `aborted` for a cancelled fetch, or the fallback code. */
export function asMlError(error: unknown, fallback: MlErrorCode): MlError {
  if (error instanceof MlError) return error;
  return new MlError(isAbort(error) ? "aborted" : fallback, undefined, { cause: error });
}
