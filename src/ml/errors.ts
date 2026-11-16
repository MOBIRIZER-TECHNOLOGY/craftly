import { m } from "@/i18n";

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

/**
 * An error whose message is fit to show to the person using the app, in the language of the page (`m.ml.errors`). The
 * technical cause rides along in `cause`. Only the page makes these: the worker cannot read the catalog, so it sends just
 * the code (engine.ts) and `client.ts` turns that into an MlError.
 */
export class MlError extends Error {
  readonly code: MlErrorCode;

  constructor(code: MlErrorCode, message?: string, options?: { cause?: unknown }) {
    super(message ?? m.ml.errors[code], options);
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
