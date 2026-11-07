import { afterEach, describe, expect, it, vi } from "vitest";
import { uid } from "./ids";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("uid", () => {
  it("makes ten lower-case letters and digits", () => {
    expect(uid()).toMatch(/^[a-z0-9]{10}$/);
  });

  it("puts the prefix in front to help reading the document", () => {
    expect(uid("t")).toMatch(/^t_[a-z0-9]{10}$/);
    expect(uid("")).toMatch(/^[a-z0-9]{10}$/);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 2000 }, () => uid("e")));
    expect(seen.size).toBe(2000);
  });

  it("maps random bytes onto the alphabet", () => {
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(36) });
    // 36 wraps around to the first character of the 36 letter alphabet
    expect(uid()).toBe("aaaaaaaaaa");
    vi.stubGlobal("crypto", { getRandomValues: (bytes: Uint8Array) => bytes.fill(35) });
    expect(uid()).toBe("9999999999");
  });

  it("falls back to Math.random where there is no crypto", () => {
    vi.stubGlobal("crypto", undefined);
    const random = vi.spyOn(Math, "random").mockReturnValue(0.5);
    // 0.5 x 256 = byte 128; 128 % 36 = 20 = "u"
    expect(uid("x")).toBe("x_uuuuuuuuuu");
    expect(random).toHaveBeenCalledTimes(10);
  });

  it("falls back to Math.random when crypto has no getRandomValues", () => {
    vi.stubGlobal("crypto", {});
    vi.spyOn(Math, "random").mockReturnValue(0);
    expect(uid()).toBe("aaaaaaaaaa");
  });
});
