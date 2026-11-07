import { describe, expect, it } from "vitest";
import { asMlError, MlError } from "./errors";

describe("asMlError", () => {
  it("passes an MlError through untouched", () => {
    const original = new MlError("hash");
    expect(asMlError(original, "runtime")).toBe(original);
  });

  it("recognises a cancelled fetch or an aborted signal as 'aborted', whatever the fallback says", () => {
    expect(asMlError(new DOMException("The operation was aborted.", "AbortError"), "network").code).toBe("aborted");
  });

  it("wraps anything else with the fallback code and keeps the original as the cause", () => {
    const boom = new Error("boom");
    const wrapped = asMlError(boom, "runtime");
    expect(wrapped).toBeInstanceOf(MlError);
    expect(wrapped.code).toBe("runtime");
    expect(wrapped.cause).toBe(boom);
  });

  it("never shows a raw technical message to the person using the app", () => {
    expect(asMlError(new Error("Aborted(OOM). Build with -sASSERTIONS"), "runtime").message).not.toContain("OOM");
    expect(asMlError("a string was thrown", "runtime").message.length).toBeGreaterThan(10);
  });
});

describe("MlError", () => {
  it("carries its code and a plain sentence", () => {
    const error = new MlError("offline");
    expect(error.code).toBe("offline");
    expect(error.name).toBe("MlError");
    expect(error.message).toMatch(/[a-z]/i);
  });

  it("lets the caller write the sentence when it knows more", () => {
    expect(new MlError("size", "Expected 100 bytes, got 50.").message).toBe("Expected 100 bytes, got 50.");
  });

  it("says what to do about a picture that is too large to enlarge", () => {
    const { message } = new MlError("too-large");
    expect(message).toContain("25 megapixels");
    expect(message).toMatch(/smaller|crop/i);
  });
});
