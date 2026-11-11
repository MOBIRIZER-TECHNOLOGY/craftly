/**
 * Fetching a model file and proving it is the file the registry pins. Nothing is kept unless size and SHA-256 match.
 *
 * A model is tens of megabytes, and a connection that breaks in the middle is common on a slow line. The download then carries on
 * from where it broke: it asks the server for the rest only (a `Range` request), a few times with a growing pause, and what
 * arrived is kept in memory for the next try of the person when those tries are used up. The file is still checked as a whole.
 */
import { asMlError, MlError } from "./errors";
import { modelUrl } from "./registry";
import type { ModelSpec } from "./types";

export interface DownloadOptions {
  signal?: AbortSignal;
  /** after every chunk: bytes received so far, and the size the registry pins */
  onProgress?: (received: number, total: number) => void;
  fetchImpl?: typeof fetch;
  /** tells "you are offline" from "the network failed" */
  isOnline?: () => boolean;
  /** replaces the registry URL */
  url?: string;
  /** the pause before the first new try after a broken connection; the second waits twice as long, and so on */
  retryDelayMs?: number;
  /** replaces the pause (tests) */
  wait?: (ms: number) => Promise<void>;
}

/** How often one download carries on by itself after a broken connection, before the person is told. */
export const MAX_RESUMES = 4;

const browserIsOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;
const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** What arrived of a file whose download failed, by the SHA-256 the registry pins for it: the next download carries on from it. */
const partials = new Map<string, { chunks: Uint8Array[]; received: number }>();

/** Forgets every part of a file that a failed download kept. */
export function forgetPartialDownloads(): void {
  partials.clear();
}

export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Throws `size` or `hash` unless the bytes are exactly the pinned file. */
export async function verifyModelBlob(spec: ModelSpec, blob: Blob): Promise<void> {
  if (blob.size !== spec.bytes) throw new MlError("size");
  if ((await sha256Hex(blob)) !== spec.sha256) throw new MlError("hash");
}

/** The first byte of the part a `206` answer holds ("bytes 16-39/40" is 16), or null when the answer does not say. */
function partStart(response: Response): number | null {
  const match = /^bytes (\d+)-/.exec(response.headers.get("content-range") ?? "");
  return match ? Number(match[1]) : null;
}

/**
 * Downloads the model. The request carries no cookies and no referrer. Reading stops as soon as more bytes arrive than
 * the registry pins, so a wrong file cannot fill the memory. A connection that breaks is taken up again where it broke
 * (see the top of this file); a download that the person cancels, and a file that is not the pinned one, keep nothing.
 */
export async function downloadModel(spec: ModelSpec, options: DownloadOptions = {}): Promise<Blob> {
  const { signal, onProgress, fetchImpl = fetch, isOnline = browserIsOnline, url = modelUrl(spec), retryDelayMs = 800, wait = pause } = options;

  const kept = partials.get(spec.sha256);
  partials.delete(spec.sha256);
  let chunks: Uint8Array[] = kept?.chunks ?? [];
  let received = kept?.received ?? 0;
  let resumes = 0;

  /** The failure to throw: what arrived is kept for the next download unless the person cancelled or the file is the wrong one. */
  const failed = (error: MlError): MlError => {
    if (received > 0 && (error.code === "network" || error.code === "offline" || error.code === "http")) partials.set(spec.sha256, { chunks, received });
    return error;
  };
  /** Whether there is another try for a broken connection; waits for it when there is. */
  const tryAgain = async (): Promise<boolean> => {
    if (resumes >= MAX_RESUMES) return false;
    resumes++;
    await wait(retryDelayMs * resumes);
    if (signal?.aborted) throw new MlError("aborted");
    return true;
  };
  const startOver = () => {
    chunks = [];
    received = 0;
  };

  for (;;) {
    let response: Response;
    try {
      response = await fetchImpl(url, { signal, credentials: "omit", referrerPolicy: "no-referrer", ...(received > 0 ? { headers: { Range: `bytes=${received}-` } } : {}) });
    } catch (error) {
      const failure = asMlError(error, isOnline() ? "network" : "offline");
      // being offline does not mend itself in a second or two: the person is told, and what arrived waits for them
      if (failure.code === "network" && (await tryAgain())) continue;
      throw failed(failure);
    }
    if (received > 0 && response.status === 416) {
      // the server has nothing after what arrived: its file is shorter than the pinned one
      void response.body?.cancel().catch(() => undefined);
      throw new MlError("size");
    }
    if (!response.ok || !response.body) {
      void response.body?.cancel().catch(() => undefined);
      throw failed(new MlError("http"));
    }
    if (received > 0) {
      if (response.status !== 206) {
        // the whole file instead of the rest: a server that does not do ranges. What arrived is of no use.
        startOver();
      } else if (partStart(response) !== received) {
        // another part than was asked for: ask again for the whole
        void response.body.cancel().catch(() => undefined);
        startOver();
        continue;
      }
    }

    const reader = response.body.getReader();
    const before = received;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        received += value.byteLength;
        if (received > spec.bytes) throw new MlError("size");
        chunks.push(value);
        onProgress?.(received, spec.bytes);
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      const failure = asMlError(error, "network");
      if (failure.code === "network" && (await tryAgain())) continue;
      throw failed(failure);
    }
    // A connection that closed early without an error is taken up again like a broken one, as long as it brought something:
    // a server whose file simply is shorter would otherwise be asked again and again.
    if (received < spec.bytes && received > before && (await tryAgain())) continue;
    break;
  }

  const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
  await verifyModelBlob(spec, blob);
  return blob;
}
