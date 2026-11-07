import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  darken,
  fadedInk,
  hexToHsv,
  hslToHex,
  hsvToHex,
  hsvToRgb,
  isLight,
  lighten,
  luminance,
  mix,
  normalizeHex,
  parseColor,
  readableOn,
  rgbToHsv,
  rgba,
  toHex,
} from "./color";

describe("parseColor", () => {
  it("reads short and long hex colours, with or without alpha", () => {
    expect(parseColor("#fff")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("#abc")).toEqual({ r: 170, g: 187, b: 204, a: 1 });
    expect(parseColor("#112233")).toEqual({ r: 17, g: 34, b: 51, a: 1 });
    expect(parseColor("#11223380")?.a).toBeCloseTo(128 / 255);
    expect(parseColor("#abcd")?.a).toBeCloseTo(0xdd / 255);
  });

  it("ignores case and surrounding spaces", () => {
    expect(parseColor("  #AbCdEf ")).toEqual({ r: 171, g: 205, b: 239, a: 1 });
    expect(parseColor("RGB(1, 2, 3)")).toEqual({ r: 1, g: 2, b: 3, a: 1 });
  });

  it("reads rgb() and rgba() in comma, space and slash notation", () => {
    expect(parseColor("rgb(10, 20, 30)")).toEqual({ r: 10, g: 20, b: 30, a: 1 });
    expect(parseColor("rgba(10,20,30,0.5)")).toEqual({ r: 10, g: 20, b: 30, a: 0.5 });
    expect(parseColor("rgb(10 20 30 / 0.25)")).toEqual({ r: 10, g: 20, b: 30, a: 0.25 });
  });

  it("knows white, black and transparent by name", () => {
    expect(parseColor("white")).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor("black")).toEqual({ r: 0, g: 0, b: 0, a: 1 });
    expect(parseColor("transparent")).toEqual({ r: 0, g: 0, b: 0, a: 0 });
  });

  it("answers null for what it cannot read", () => {
    for (const bad of ["", "red", "#12", "#12345", "#1234567", "rgb(1,2)", "rgb(a,b,c)", "hsl(0,0%,0%)", "not a colour"]) {
      expect(parseColor(bad), bad).toBeNull();
    }
  });
});

describe("toHex and normalizeHex", () => {
  it("writes six hex digits, clamping and rounding each channel", () => {
    expect(toHex({ r: 255, g: 0, b: 128, a: 1 })).toBe("#ff0080");
    expect(toHex({ r: 300, g: -5, b: 127.6, a: 1 })).toBe("#ff0080");
  });

  it("adds the alpha only when asked to and only when it is not opaque", () => {
    expect(toHex({ r: 1, g: 2, b: 3, a: 0.5 })).toBe("#010203");
    expect(toHex({ r: 1, g: 2, b: 3, a: 0.5 }, true)).toBe("#01020380");
    expect(toHex({ r: 1, g: 2, b: 3, a: 1 }, true)).toBe("#010203");
  });

  it("turns any readable colour into #rrggbb and leaves the rest alone", () => {
    expect(normalizeHex("rgb(1, 2, 3)")).toBe("#010203");
    expect(normalizeHex("#abc")).toBe("#aabbcc");
    expect(normalizeHex("#11223380")).toBe("#112233");
    expect(normalizeHex("papayawhip")).toBe("papayawhip");
  });
});

describe("rgba", () => {
  it("makes a CSS colour with the given opacity", () => {
    expect(rgba("#ff0000", 0.5)).toBe("rgba(255,0,0,0.5)");
    expect(rgba("rgb(10, 20, 30)", 1)).toBe("rgba(10,20,30,1)");
  });

  it("multiplies the opacity the colour already has", () => {
    expect(rgba("rgba(0,0,0,0.5)", 0.5)).toBe("rgba(0,0,0,0.25)");
  });

  it("rounds the channels and the opacity", () => {
    expect(rgba("rgb(10.6, 20.4, 30)", 1 / 3)).toBe("rgba(11,20,30,0.333)");
  });

  it("falls back to black for a colour it cannot read", () => {
    expect(rgba("no colour", 0.3)).toBe("rgba(0,0,0,0.3)");
  });
});

describe("hue, saturation and value", () => {
  it.each([
    ["#ff0000", 0, 1, 1],
    ["#ffff00", 60, 1, 1],
    ["#00ff00", 120, 1, 1],
    ["#00ffff", 180, 1, 1],
    ["#0000ff", 240, 1, 1],
    ["#ff00ff", 300, 1, 1],
    ["#ff0080", 329.88, 1, 1],
    ["#ffffff", 0, 0, 1],
    ["#000000", 0, 0, 0],
    ["#808080", 0, 0, 128 / 255],
  ])("%s is hue %s, saturation %s, value %s", (hex, h, s, v) => {
    const hsv = hexToHsv(hex);
    expect(hsv.h).toBeCloseTo(h);
    expect(hsv.s).toBeCloseTo(s);
    expect(hsv.v).toBeCloseTo(v);
  });

  it("covers every sector of the colour wheel going back to RGB", () => {
    const expected: Array<[number, string]> = [
      [0, "#ff0000"],
      [60, "#ffff00"],
      [120, "#00ff00"],
      [180, "#00ffff"],
      [240, "#0000ff"],
      [300, "#ff00ff"],
      [330, "#ff0080"],
    ];
    for (const [h, hex] of expected) expect(hsvToHex({ h, s: 1, v: 1 }), `${h}`).toBe(hex);
  });

  it("wraps hues outside 0..360", () => {
    expect(hsvToHex({ h: -60, s: 1, v: 1 })).toBe(hsvToHex({ h: 300, s: 1, v: 1 }));
    expect(hsvToHex({ h: 420, s: 1, v: 1 })).toBe(hsvToHex({ h: 60, s: 1, v: 1 }));
  });

  it("gives grey for no saturation and darkens with the value", () => {
    expect(hsvToRgb({ h: 200, s: 0, v: 0.5 })).toEqual({ r: 127.5, g: 127.5, b: 127.5, a: 1 });
    expect(hsvToHex({ h: 10, s: 1, v: 0 })).toBe("#000000");
  });

  it("goes there and back for colours in between", () => {
    for (const hex of ["#123456", "#abcdef", "#fedcba", "#7c3aed", "#14b8a6", "#f59e0b"]) {
      expect(hsvToHex(hexToHsv(hex)), hex).toBe(hex);
    }
    expect(rgbToHsv({ r: 0, g: 0, b: 0, a: 1 })).toEqual({ h: 0, s: 0, v: 0 });
  });

  it("treats a colour it cannot read as black", () => {
    expect(hexToHsv("nonsense")).toEqual({ h: 0, s: 0, v: 0 });
  });
});

describe("mixing", () => {
  it("blends linearly between two colours", () => {
    expect(mix("#000000", "#ffffff", 0)).toBe("#000000");
    expect(mix("#000000", "#ffffff", 1)).toBe("#ffffff");
    expect(mix("#ff0000", "#0000ff", 0.5)).toBe("#800080");
  });

  it("treats colours it cannot read as black", () => {
    expect(mix("x", "#ffffff", 0.5)).toBe("#808080");
    expect(mix("#ffffff", "y", 0.5)).toBe("#808080");
  });

  it("lightens towards white and darkens towards black, keeping the amount between 0 and 1", () => {
    expect(lighten("#000000", 0.5)).toBe("#808080");
    expect(lighten("#336699", 2)).toBe("#ffffff");
    expect(lighten("#336699", -1)).toBe("#336699");
    expect(darken("#ffffff", 0.5)).toBe("#808080");
    expect(darken("#336699", 5)).toBe("#000000");
    expect(darken("#336699", -1)).toBe("#336699");
  });
});

describe("contrast", () => {
  it("measures the relative luminance from 0 (black) to 1 (white)", () => {
    expect(luminance("#000000")).toBe(0);
    expect(luminance("#ffffff")).toBeCloseTo(1);
    expect(luminance("#808080")).toBeCloseTo(0.2159, 3);
    expect(luminance("#ff0000")).toBeCloseTo(0.2126, 4);
    expect(luminance("not a colour")).toBe(0);
  });

  it("gives 21 for black on white and 1 for the same colour twice, in either order", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21);
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21);
    expect(contrastRatio("#336699", "#336699")).toBe(1);
  });

  it("decides what is light and which text colour reads on a background", () => {
    expect(isLight("#ffffff")).toBe(true);
    expect(isLight("#ffff00")).toBe(true);
    expect(isLight("#222222")).toBe(false);
    expect(readableOn("#000000")).toBe("#ffffff");
    expect(readableOn("#ffffff")).toBe("#0b0b12");
    expect(readableOn("#7c3aed")).toBe("#ffffff");
    expect(readableOn("#f59e0b")).toBe("#0b0b12");
  });
});

describe("hue, saturation and lightness", () => {
  it("turns degrees and percentages into #rrggbb", () => {
    expect(hslToHex(0, 100, 50)).toBe("#ff0000");
    expect(hslToHex(60, 100, 50)).toBe("#ffff00");
    expect(hslToHex(120, 100, 50)).toBe("#00ff00");
    expect(hslToHex(180, 100, 50)).toBe("#00ffff");
    expect(hslToHex(240, 100, 50)).toBe("#0000ff");
    expect(hslToHex(300, 100, 50)).toBe("#ff00ff");
    expect(hslToHex(0, 0, 50)).toBe("#808080");
    expect(hslToHex(167, 58, 33)).toBe("#238570");
  });

  it("wraps hues outside 0..360 and keeps saturation and lightness between 0 and 100", () => {
    expect(hslToHex(-120, 100, 50)).toBe(hslToHex(240, 100, 50));
    expect(hslToHex(480, 100, 50)).toBe(hslToHex(120, 100, 50));
    expect(hslToHex(0, 150, 50)).toBe("#ff0000");
    expect(hslToHex(0, 100, -5)).toBe("#000000");
    expect(hslToHex(0, 100, 120)).toBe("#ffffff");
  });
});

describe("fadedInk", () => {
  it("fades the ink towards the background by the strength asked for while that is readable", () => {
    expect(fadedInk("#000000", "#ffffff", 0.82)).toBe(mix("#ffffff", "#000000", 0.82));
    expect(contrastRatio(fadedInk("#000000", "#ffffff", 0.82), "#ffffff")).toBeGreaterThanOrEqual(4.5);
  });

  it("strengthens the ink, a little at a time, until it reaches the contrast asked for", () => {
    // white at 82 % on this purple is 4.35:1
    expect(contrastRatio(mix("#7c3aed", "#ffffff", 0.82), "#7c3aed")).toBeLessThan(4.5);
    const soft = fadedInk("#ffffff", "#7c3aed", 0.82);
    expect(contrastRatio(soft, "#7c3aed")).toBeGreaterThanOrEqual(4.5);
    expect(soft).not.toBe("#ffffff");
    // a strength that is readable already is kept as it is
    expect(fadedInk("#ffffff", "#7c3aed", 0.95)).toBe(mix("#7c3aed", "#ffffff", 0.95));
  });

  it("gives the ink itself when even that is short of the contrast, as on some mid-tones", () => {
    expect(contrastRatio("#ffffff", "#808080")).toBeLessThan(4.5);
    expect(fadedInk("#ffffff", "#808080", 0.8)).toBe("#ffffff");
  });

  it("takes another contrast to reach, and a strength beyond 0..1 as its nearest end", () => {
    expect(contrastRatio(fadedInk("#ffffff", "#7c3aed", 0.3, 3), "#7c3aed")).toBeGreaterThanOrEqual(3);
    expect(fadedInk("#ffffff", "#7c3aed", 2)).toBe("#ffffff");
    expect(fadedInk("#000000", "#ffffff", -1, 1)).toBe("#ffffff");
  });
});
