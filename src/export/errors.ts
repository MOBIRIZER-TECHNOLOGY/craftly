/**
 * Errors thrown by the export package. Every error carries a stable `code` and a message that already
 * explains what happened and how to fix it, so the UI can show `error.message` as it is.
 */
import { m } from "@/i18n";

export type ExportErrorCode =
  /** nothing selected / the design has no such pages */
  | "no-pages"
  /** the browser could not allocate or encode a canvas that big */
  | "too-large"
  /** `canvas.toBlob` / the PDF writer produced nothing */
  | "encode-failed"
  /** the caller aborted the export */
  | "cancelled"
  /** a browser capability is missing (clipboard, popups ...) */
  | "unsupported"
  /** the design itself could not be turned into the format */
  | "invalid-design";

export class ExportError extends Error {
  readonly code: ExportErrorCode;

  constructor(code: ExportErrorCode, message: string, options?: { cause?: unknown }) {
    super(message);
    this.name = "ExportError";
    this.code = code;
    if (options && "cause" in options) (this as { cause?: unknown }).cause = options.cause;
  }
}

export const isExportError = (e: unknown): e is ExportError => e instanceof ExportError;

/** True for `AbortController` aborts and for our own "cancelled" errors. */
export function isCancelled(e: unknown): boolean {
  if (e instanceof ExportError) return e.code === "cancelled";
  return typeof e === "object" && e !== null && (e as { name?: string }).name === "AbortError";
}

export function cancelledError(): ExportError {
  return new ExportError("cancelled", m.exporting.errors.cancelled);
}

/** Throws a "cancelled" error when the signal has been aborted. */
export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancelledError();
}

/**
 * A human sentence for any error raised while exporting. `scale` lets the "too large" message name the
 * size the user picked ("This design is too large to export at 4x - try a smaller size").
 */
export function describeExportError(e: unknown, ctx: { scale?: number } = {}): string {
  if (e instanceof ExportError) {
    if (e.code === "too-large" && ctx.scale && ctx.scale > 1) return m.exporting.errors.tooLargeAt(roundScale(ctx.scale));
    return e.message;
  }
  if (typeof e === "object" && e !== null && (e as { name?: string }).name === "QuotaExceededError") {
    return m.exporting.errors.noMemory;
  }
  if (e instanceof Error && /memory|allocation|too large/i.test(e.message)) {
    return ctx.scale && ctx.scale > 1 ? m.exporting.errors.tooLargeAt(roundScale(ctx.scale)) : m.exporting.errors.tooLarge;
  }
  return m.exporting.errors.generic;
}

/** The size multiplier as the message names it: 4, 2.5, 1.33. */
function roundScale(scale: number): number {
  return Number.isInteger(scale) ? scale : Math.round(scale * 100) / 100;
}
