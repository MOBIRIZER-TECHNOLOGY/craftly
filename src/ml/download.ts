/** Fetching a model file and proving it is the file the registry pins. Nothing is kept unless size and SHA-256 match. */
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
}

const browserIsOnline = () => typeof navigator === "undefined" || navigator.onLine !== false;

export async function sha256Hex(data: Blob): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", await data.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Throws `size` or `hash` unless the bytes are exactly the pinned file. */
export async function verifyModelBlob(spec: ModelSpec, blob: Blob): Promise<void> {
  if (blob.size !== spec.bytes) throw new MlError("size");
  if ((await sha256Hex(blob)) !== spec.sha256) throw new MlError("hash");
}

/**
 * Downloads the model. The request carries no cookies and no referrer. Reading stops as soon as more bytes arrive than
 * the registry pins, so a wrong file cannot fill the memory.
 */
export async function downloadModel(spec: ModelSpec, options: DownloadOptions = {}): Promise<Blob> {
  const { signal, onProgress, fetchImpl = fetch, isOnline = browserIsOnline, url = modelUrl(spec) } = options;

  let response: Response;
  try {
    response = await fetchImpl(url, { signal, credentials: "omit", referrerPolicy: "no-referrer" });
  } catch (error) {
    throw asMlError(error, isOnline() ? "network" : "offline");
  }
  if (!response.ok || !response.body) {
    void response.body?.cancel().catch(() => undefined);
    throw new MlError("http");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
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
    throw asMlError(error, "network");
  }

  const blob = new Blob(chunks as BlobPart[], { type: "application/octet-stream" });
  await verifyModelBlob(spec, blob);
  return blob;
}
