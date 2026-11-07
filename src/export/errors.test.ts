import { describe, expect, it } from "vitest";
import { ExportError, cancelledError, describeExportError, isCancelled, isExportError, throwIfAborted } from "./errors";

describe("ExportError", () => {
  it("is an error with a code and a name", () => {
    const error = new ExportError("no-pages", "Select a page.");
    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("ExportError");
    expect(error.code).toBe("no-pages");
    expect(error.message).toBe("Select a page.");
  });

  it("keeps the cause it is given, even a falsy one, and none otherwise", () => {
    const cause = new Error("inner");
    expect((new ExportError("encode-failed", "x", { cause }) as { cause?: unknown }).cause).toBe(cause);
    expect("cause" in new ExportError("encode-failed", "x", { cause: undefined })).toBe(true);
    expect("cause" in new ExportError("encode-failed", "x")).toBe(false);
    expect("cause" in new ExportError("encode-failed", "x", {})).toBe(false);
  });

  it("is recognised by isExportError", () => {
    expect(isExportError(new ExportError("cancelled", "x"))).toBe(true);
    expect(isExportError(new Error("x"))).toBe(false);
    expect(isExportError("x")).toBe(false);
    expect(isExportError(null)).toBe(false);
  });
});

describe("cancelling", () => {
  it("makes a cancelled error that says so", () => {
    const error = cancelledError();
    expect(error.code).toBe("cancelled");
    expect(error.message).toBe("The download was cancelled.");
  });

  it("recognises our own cancellation and a browser abort, and nothing else", () => {
    expect(isCancelled(cancelledError())).toBe(true);
    expect(isCancelled(new ExportError("too-large", "x"))).toBe(false);
    expect(isCancelled(Object.assign(new Error("aborted"), { name: "AbortError" }))).toBe(true);
    expect(isCancelled(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isCancelled(new Error("other"))).toBe(false);
    expect(isCancelled(null)).toBe(false);
    expect(isCancelled("AbortError")).toBe(false);
  });

  it("throws only for a signal that was aborted", () => {
    const controller = new AbortController();
    expect(() => throwIfAborted(controller.signal)).not.toThrow();
    expect(() => throwIfAborted(undefined)).not.toThrow();
    controller.abort();
    expect(() => throwIfAborted(controller.signal)).toThrow("The download was cancelled.");
    try {
      throwIfAborted(controller.signal);
    } catch (error) {
      expect(isCancelled(error)).toBe(true);
    }
  });
});

describe("describeExportError", () => {
  it("uses the message of an export error", () => {
    expect(describeExportError(new ExportError("no-pages", "Select at least one page to download."))).toBe("Select at least one page to download.");
  });

  it("names the size the user picked when it is too large", () => {
    const tooLarge = new ExportError("too-large", "generic");
    expect(describeExportError(tooLarge, { scale: 4 })).toBe("This design is too large to export at 4x - try a smaller size.");
    expect(describeExportError(tooLarge, { scale: 2.5 })).toBe("This design is too large to export at 2.5x - try a smaller size.");
    expect(describeExportError(tooLarge, { scale: 1.3333 })).toBe("This design is too large to export at 1.33x - try a smaller size.");
  });

  it("keeps the plain message when the size is 1x or unknown", () => {
    const tooLarge = new ExportError("too-large", "generic");
    expect(describeExportError(tooLarge, { scale: 1 })).toBe("generic");
    expect(describeExportError(tooLarge)).toBe("generic");
  });

  it("explains a browser that ran out of memory", () => {
    const quota = Object.assign(new Error("x"), { name: "QuotaExceededError" });
    expect(describeExportError(quota)).toBe("There is not enough free memory to export this design. Close other tabs or try a smaller size.");
    expect(describeExportError({ name: "QuotaExceededError" })).toMatch(/not enough free memory/);
  });

  it("recognises memory and size problems by their message", () => {
    expect(describeExportError(new Error("Array buffer allocation failed"), { scale: 3 })).toBe("This design is too large to export at 3x - try a smaller size.");
    expect(describeExportError(new Error("out of memory"))).toBe("This design is too large to export. Try fewer pages or a smaller size.");
    expect(describeExportError(new Error("Canvas area exceeds the maximum limit (too large)"), { scale: 1 })).toBe(
      "This design is too large to export. Try fewer pages or a smaller size.",
    );
  });

  it("falls back to a general sentence for anything else", () => {
    const general = "Something went wrong while preparing the download. Please try again.";
    expect(describeExportError(new Error("boom"))).toBe(general);
    expect(describeExportError("boom")).toBe(general);
    expect(describeExportError(null)).toBe(general);
    expect(describeExportError(undefined)).toBe(general);
  });
});
