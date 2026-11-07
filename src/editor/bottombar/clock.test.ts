import { describe, expect, it } from "vitest";
import { formatClock } from "./clock";

describe("formatClock", () => {
  it("shows minutes and seconds", () => {
    expect(formatClock(0)).toBe("00:00");
    expect(formatClock(7_400)).toBe("00:07");
    expect(formatClock(754_000)).toBe("12:34");
  });

  it("adds hours only once an hour has passed", () => {
    expect(formatClock(59 * 60_000 + 59_999)).toBe("59:59");
    expect(formatClock(3_723_000)).toBe("1:02:03");
  });

  it("never goes negative", () => {
    expect(formatClock(-5000)).toBe("00:00");
  });
});
