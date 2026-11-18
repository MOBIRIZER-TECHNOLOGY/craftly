import { describe, expect, it } from "vitest";
import { checkSizeDraft } from "./sizeDraft";

const px = (text: string) => checkSizeDraft(text, "px", 40, 8000);

describe("checkSizeDraft", () => {
  it("accepts a size between the limits", () => {
    expect(px("40")).toBe("ok");
    expect(px("1080")).toBe("ok");
    expect(px("8000")).toBe("ok");
    expect(px(" 500 ")).toBe("ok");
  });

  it("refuses at once what no more typing can make a size", () => {
    expect(px("9000")).toBe("invalid");
    expect(px("8001")).toBe("invalid");
    expect(px("abc")).toBe("invalid");
    expect(px("-5")).toBe("invalid");
    expect(px("20.5")).toBe("invalid");
    expect(px("12px")).toBe("invalid");
  });

  it("waits while the person may still be typing a size", () => {
    expect(px("")).toBe("pending");
    expect(px("2")).toBe("pending");
    expect(px("20")).toBe("pending");
    expect(px("0")).toBe("pending");
    // after the decimal point, more digits can no longer reach 40
    expect(px("39.")).toBe("invalid");
    expect(px("39.5")).toBe("invalid");
  });

  it("measures in the unit of the field", () => {
    // 40 px is 0.42 in, 8000 px is 83.33 in
    expect(checkSizeDraft("0.", "in", 40, 8000)).toBe("pending");
    expect(checkSizeDraft("0.4", "in", 40, 8000)).toBe("pending");
    expect(checkSizeDraft("0.3", "in", 40, 8000)).toBe("invalid");
    expect(checkSizeDraft("10", "in", 40, 8000)).toBe("ok");
    expect(checkSizeDraft("90", "in", 40, 8000)).toBe("invalid");
    expect(checkSizeDraft("10,5", "cm", 40, 8000)).toBe("ok");
  });
});
