import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { firstRunKey, isFirstRunDone, markFirstRunDone, resetFirstRun, useFirstRunDone } from "./firstRun";

beforeEach(() => resetFirstRun());
afterEach(() => {
  vi.restoreAllMocks();
  resetFirstRun();
});

describe("what a first visit has been shown", () => {
  it("starts with nothing done", () => {
    expect(isFirstRunDone("welcome")).toBe(false);
    expect(isFirstRunDone("canvasHint")).toBe(false);
  });

  it("remembers a step on the device, and only that step", () => {
    markFirstRunDone("welcome");
    expect(localStorage.getItem(firstRunKey("welcome"))).toBe("1");
    expect(isFirstRunDone("welcome")).toBe(true);
    expect(isFirstRunDone("canvasHint")).toBe(false);
  });

  it("reads what an earlier visit kept", () => {
    localStorage.setItem(firstRunKey("canvasHint"), "1");
    expect(isFirstRunDone("canvasHint")).toBe(true);
  });

  it("tells the screens that show it, once", () => {
    const { result } = renderHook(() => useFirstRunDone("welcome"));
    expect(result.current).toBe(false);
    act(() => markFirstRunDone("welcome"));
    expect(result.current).toBe(true);
  });

  it("still holds for this visit when the browser refuses storage", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("blocked", "SecurityError");
    });
    expect(isFirstRunDone("welcome")).toBe(false);
    expect(() => markFirstRunDone("welcome")).not.toThrow();
    expect(isFirstRunDone("welcome")).toBe(true);
  });
});
