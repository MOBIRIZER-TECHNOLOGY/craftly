import { describe, expect, it } from "vitest";
import type { PatternFill } from "@/core/types";
import {
  PATTERN_TILE,
  SvgDoc,
  attrs,
  colorAttr,
  esc,
  escAttr,
  linearGradientVector,
  noiseTilePixels,
  num,
  paintAttr,
  patternTileMarkup,
  radialGradientCircle,
  rectPath,
  roundRectPath,
  splitColor,
  stopsMarkup,
  stripInvalidXml,
  svgFontFamily,
} from "./svgUtil";

describe("XML text", () => {
  it("drops characters XML cannot hold and keeps the ones it can", () => {
    expect(stripInvalidXml("a\u0000b\u0008c\u000Bd\u000Ce\u001Ff")).toBe("abcdef");
    expect(stripInvalidXml("tab\there\nnew\rline")).toBe("tab\there\nnew\rline");
    expect(stripInvalidXml("ok ￾￿")).toBe("ok ");
  });

  it("removes lone surrogates but keeps real pairs", () => {
    expect(stripInvalidXml("a\uD800b")).toBe("ab");
    expect(stripInvalidXml("a\uDC00b")).toBe("ab");
    expect(stripInvalidXml("smile \u{1F600}")).toBe("smile \u{1F600}");
  });

  it("escapes text content", () => {
    expect(esc(`a & b < c > d "q"`)).toBe(`a &amp; b &lt; c &gt; d "q"`);
  });

  it("escapes attribute values, whitespace controls included", () => {
    expect(escAttr(`say "hi" & <go>\n\r\tdone`)).toBe("say &quot;hi&quot; &amp; &lt;go&gt;&#10;&#13;&#9;done");
  });
});

describe("numbers and attributes", () => {
  it("rounds to three decimals without exponents or negative zero", () => {
    expect(num(1.23456)).toBe("1.235");
    expect(num(100)).toBe("100");
    expect(num(-0)).toBe("0");
    expect(num(-0.0004)).toBe("0");
    expect(num(0.0004)).toBe("0");
    expect(num(1e-9)).toBe("0");
    expect(num(-2.5)).toBe("-2.5");
  });

  it("turns numbers that are not numbers into zero", () => {
    expect(num(Number.NaN)).toBe("0");
    expect(num(Number.POSITIVE_INFINITY)).toBe("0");
    expect(num(Number.NEGATIVE_INFINITY)).toBe("0");
  });

  it("writes attributes for the values that exist, escaping text and rounding numbers", () => {
    expect(attrs({ x: 1.23456, name: `a"b`, empty: "", none: undefined, nothing: null, off: false, zero: 0 })).toBe(` x="1.235" name="a&quot;b" zero="0"`);
    expect(attrs({})).toBe("");
  });

  it("writes font families in single quotes so they fit inside a double quoted attribute", () => {
    expect(svgFontFamily(`"Plus Jakarta Sans Variable", "Plus Jakarta Sans", sans-serif`)).toBe("'Plus Jakarta Sans Variable', 'Plus Jakarta Sans', sans-serif");
    expect(svgFontFamily(`"It's \\"odd\\""`)).toBe(`'It\\'s "odd"'`.replace(/"/g, "&quot;"));
    expect(svgFontFamily("monospace")).toBe("monospace");
  });
});

describe("colours", () => {
  it("splits a colour into an opaque colour and an opacity", () => {
    expect(splitColor("#112233")).toEqual({ hex: "#112233", a: 1, parsed: true });
    expect(splitColor("rgba(255,0,0,0.5)")).toEqual({ hex: "#ff0000", a: 0.5, parsed: true });
    expect(splitColor("rgba(0,0,0,7)").a).toBe(1);
    expect(splitColor("rgba(0,0,0,-2)").a).toBe(0);
  });

  it("keeps plain colour keywords and refuses anything that could carry markup", () => {
    expect(splitColor("papayawhip")).toEqual({ hex: "papayawhip", a: 1, parsed: false });
    expect(splitColor("  currentColor ")).toEqual({ hex: "currentColor", a: 1, parsed: false });
    expect(splitColor("url(#evil)").hex).toBe("#000000");
    expect(splitColor('red" onload="x').hex).toBe("#000000");
    expect(splitColor("").hex).toBe("#000000");
    expect(splitColor("ab").hex).toBe("#000000");
  });

  it("writes a colour attribute with its opacity only when it is not 1", () => {
    expect(colorAttr("fill", "#ff0000")).toBe(` fill="#ff0000"`);
    expect(colorAttr("fill", "rgba(255,0,0,0.5)")).toBe(` fill="#ff0000" fill-opacity="0.5"`);
    expect(colorAttr("stroke", "#00ff00", 0.25)).toBe(` stroke="#00ff00" stroke-opacity="0.25"`);
    expect(colorAttr("stop-color", "rgba(0,0,0,0.5)")).toBe(` stop-color="#000000" stop-opacity="0.5"`);
    expect(colorAttr("flood-color", "#000000", 0.4)).toBe(` flood-color="#000000" flood-opacity="0.4"`);
  });

  it("writes none for a fill or stroke that cannot be seen, but keeps transparent stops", () => {
    expect(colorAttr("fill", "rgba(0,0,0,0)")).toBe(` fill="none"`);
    expect(colorAttr("stroke", "#ff0000", 0)).toBe(` stroke="none"`);
    expect(colorAttr("stop-color", "rgba(0,0,0,0)")).toBe(` stop-color="#000000" stop-opacity="0"`);
  });

  it("writes a paint as a colour or as a reference, with the opacity of the element", () => {
    expect(paintAttr("fill", { kind: "color", color: "#ff0000" }, 0.5)).toBe(` fill="#ff0000" fill-opacity="0.5"`);
    expect(paintAttr("stroke", { kind: "url", id: "g1" })).toBe(` stroke="url(#g1)"`);
    expect(paintAttr("fill", { kind: "url", id: "g1" }, 0.5)).toBe(` fill="url(#g1)" fill-opacity="0.5"`);
  });
});

describe("gradient geometry", () => {
  it("runs a gradient across the box at the angle, 0 pointing up", () => {
    const up = linearGradientVector(0, 100, 100);
    expect([up.x1, up.y1, up.x2, up.y2].map((v) => Math.round(v))).toEqual([50, 100, 50, 0]);
    const right = linearGradientVector(90, 200, 100);
    expect([right.x1, right.y1, right.x2, right.y2].map((v) => Math.round(v))).toEqual([0, 50, 200, 50]);
    expect(linearGradientVector(90, 0, 0)).toEqual({ x1: -1, y1: 0, x2: 1, y2: 0 });
  });

  it("puts a radial gradient at the centre by default and reaches the farthest corner", () => {
    expect(radialGradientCircle({ type: "radial", stops: [] }, 200, 100)).toEqual({ cx: 100, cy: 50, r: Math.hypot(100, 50) });
    expect(radialGradientCircle({ type: "radial", stops: [], cx: 0, cy: 1 }, 200, 100)).toEqual({ cx: 0, cy: 100, r: Math.hypot(200, 100) });
  });

  it("writes gradient stops clamped to 0..1 and in order, equal offsets keeping their order", () => {
    const markup = stopsMarkup([
      { offset: 2, color: "#0000ff" },
      { offset: -1, color: "#ff0000" },
      { offset: 0.5, color: "#00ff00" },
      { offset: 0.5, color: "#ffff00" },
    ]);
    expect(markup).toBe(
      `<stop offset="0" stop-color="#ff0000"/><stop offset="0.5" stop-color="#00ff00"/><stop offset="0.5" stop-color="#ffff00"/><stop offset="1" stop-color="#0000ff"/>`,
    );
  });
});

describe("pattern tiles", () => {
  const fill = (pattern: PatternFill["pattern"], over: Partial<PatternFill> = {}): PatternFill => ({
    type: "pattern",
    pattern,
    color: "#112233",
    background: "#ffeedd",
    scale: 1,
    ...over,
  });

  it("agrees with the size of the canvas tiles", () => {
    for (const kind of Object.keys(PATTERN_TILE) as Array<PatternFill["pattern"]>) {
      if (kind === "noise") continue;
      const tile = patternTileMarkup(fill(kind));
      expect([tile.width, tile.height], kind).toEqual(PATTERN_TILE[kind]);
      expect(tile.body.startsWith(`<rect width="${tile.width}" height="${tile.height}" fill="#ffeedd"/>`), kind).toBe(true);
    }
  });

  it("scales the tile and snaps it to whole pixels, at least two", () => {
    expect(patternTileMarkup(fill("dots", { scale: 2 }))).toMatchObject({ width: 52, height: 52 });
    expect(patternTileMarkup(fill("waves", { scale: 1.5 }))).toMatchObject({ width: 96, height: 42 });
    expect(patternTileMarkup(fill("dots", { scale: 0.01 }))).toMatchObject({ width: 2, height: 2 });
  });

  it("draws the marks of each kind in the ink colour", () => {
    expect(patternTileMarkup(fill("dots")).body).toContain(`<circle cx="13" cy="13" r="2.6" fill="#112233"/>`);
    expect(patternTileMarkup(fill("grid")).body).toContain(`<path d="M0 0H44M0 0V44" stroke="#112233" stroke-width="1.6"`);
    expect(patternTileMarkup(fill("lines")).body).toContain(`<rect width="24" height="5" fill="#112233"/>`);
    expect((patternTileMarkup(fill("diagonal")).body.match(/L/g) ?? []).length).toBe(3);
    expect((patternTileMarkup(fill("checker")).body.match(/<rect/g) ?? []).length).toBe(3);
    expect((patternTileMarkup(fill("waves")).body.match(/C/g) ?? []).length).toBe(2);
    expect((patternTileMarkup(fill("zigzag")).body.match(/L/g) ?? []).length).toBe(4);
    expect(patternTileMarkup(fill("plus")).body).toContain(`M14 20H26M20 14V26`);
  });

  it("scatters bubbles as rings and discs, with copies across the edges so the tile repeats", () => {
    const body = patternTileMarkup(fill("bubbles")).body;
    const circles = body.match(/<circle/g) ?? [];
    expect(circles.length).toBeGreaterThanOrEqual(7);
    expect(circles.length).toBeLessThanOrEqual(63);
    expect(body).toContain(`fill="none"`);
    expect(body).toContain(`stroke-width="2.4"`);
    expect(patternTileMarkup(fill("bubbles")).body).toBe(body);
  });

  it("has no vector marks for noise: it is a raster", () => {
    expect(patternTileMarkup(fill("noise"))).toMatchObject({ width: 180, height: 180 });
  });

  it("makes the noise raster from the ink and paper colours, opaque and repeatable", () => {
    const data = noiseTilePixels(fill("noise", { color: "rgb(200, 100, 50)", background: "#101010" }), 20, 10);
    expect(data).toBeInstanceOf(Uint8ClampedArray);
    expect(data).toHaveLength(20 * 10 * 4);
    for (let i = 0; i < data.length; i += 4) {
      expect(data[i]).toBeGreaterThanOrEqual(16);
      expect(data[i]).toBeLessThanOrEqual(200);
      expect(data[i + 3]).toBe(255);
    }
    expect(noiseTilePixels(fill("noise", { color: "rgb(200, 100, 50)", background: "#101010" }), 20, 10)).toEqual(data);
  });

  it("falls back to black ink on white paper for colours it cannot read", () => {
    const data = noiseTilePixels(fill("noise", { color: "nonsense", background: "also nonsense" }), 40, 40);
    let darkest = 255;
    for (let i = 0; i < data.length; i += 4) darkest = Math.min(darkest, data[i]);
    expect(darkest).toBeLessThan(120);
    expect(data[3]).toBe(255);
  });
});

describe("SvgDoc", () => {
  it("hands out ids in sequence with a prefix", () => {
    const doc = new SvgDoc();
    expect(doc.id("a")).toBe("cf-a1");
    expect(doc.id("b")).toBe("cf-b2");
  });

  it("notes each warning once", () => {
    const doc = new SvgDoc();
    doc.warn("one");
    doc.warn("two");
    doc.warn("one");
    expect(doc.warnings).toEqual(["one", "two"]);
  });

  it("defines a gradient once however often it is asked for", () => {
    const doc = new SvgDoc();
    const g = {
      type: "linear" as const,
      angle: 90,
      stops: [
        { offset: 0, color: "#000000" },
        { offset: 1, color: "#ffffff" },
      ],
    };
    const a = doc.linearGradient(g, 100, 50);
    expect(doc.linearGradient(g, 100, 50)).toBe(a);
    expect(doc.linearGradient(g, 100, 60)).not.toBe(a);
    expect(doc.defs).toHaveLength(2);
    expect(doc.defs[0]).toContain(`<linearGradient id="${a}" gradientUnits="userSpaceOnUse"`);
    const r = doc.radialGradient({ type: "radial", stops: g.stops }, 100, 50);
    expect(doc.defs.at(-1)).toContain(`<radialGradient id="${r}"`);
    expect(doc.defs.at(-1)).toContain(`r="${num(Math.hypot(50, 25))}"`);
  });

  it("defines a vector pattern with its tile", () => {
    const doc = new SvgDoc();
    const id = doc.pattern({ type: "pattern", pattern: "dots", color: "#000000", background: "#ffffff", scale: 1 });
    expect(doc.defs[0]).toContain(`<pattern id="${id}" patternUnits="userSpaceOnUse" width="26" height="26">`);
    expect(doc.pattern({ type: "pattern", pattern: "dots", color: "#000000", background: "#ffffff", scale: 1 })).toBe(id);
  });

  it("defines the noise pattern with the raster the caller makes, or with paper alone", () => {
    const noise: PatternFill = { type: "pattern", pattern: "noise", color: "#000000", background: "#ffffff", scale: 2 };
    const withRaster = new SvgDoc();
    withRaster.pattern(noise, () => "data:image/png;base64,AAAA");
    expect(withRaster.defs[0]).toContain(`width="360" height="360"`);
    expect(withRaster.defs[0]).toContain(`<image width="360" height="360" preserveAspectRatio="none" image-rendering="pixelated" xlink:href="data:image/png;base64,AAAA"/>`);
    const paperOnly = new SvgDoc();
    paperOnly.pattern(noise);
    expect(paperOnly.defs[0]).not.toContain("<image");
    expect(paperOnly.defs[0]).toContain(`fill="#ffffff"`);
    const empty = new SvgDoc();
    empty.pattern({ ...noise, scale: 0.001 }, () => "");
    expect(empty.defs[0]).toContain(`width="2" height="2"`);
    expect(empty.defs[0]).not.toContain("<image");
  });

  it("gives every kind of fill a paint", () => {
    const doc = new SvgDoc();
    expect(doc.paint({ type: "solid", color: "#123456" }, 10, 10)).toEqual({ kind: "color", color: "#123456" });
    const stops = [
      { offset: 0, color: "#000000" },
      { offset: 1, color: "#ffffff" },
    ];
    expect(doc.paint({ type: "linear", angle: 0, stops }, 10, 10)).toMatchObject({ kind: "url" });
    expect(doc.paint({ type: "radial", stops }, 10, 10)).toMatchObject({ kind: "url" });
    expect(doc.paint({ type: "pattern", pattern: "grid", color: "#000000", background: "#ffffff", scale: 1 }, 10, 10)).toMatchObject({ kind: "url" });
    expect(doc.defs).toHaveLength(3);
  });

  it("defines clip paths and blur filters once per key", () => {
    const doc = new SvgDoc();
    const clip = doc.clipPath(`<rect width="10" height="10"/>`, "a");
    expect(doc.clipPath(`<rect width="10" height="10"/>`, "a")).toBe(clip);
    expect(doc.clipPath(`<rect width="20" height="10"/>`, "b")).not.toBe(clip);
    expect(doc.defs[0]).toBe(`<clipPath id="${clip}"><rect width="10" height="10"/></clipPath>`);
    const blur = doc.blurFilter(4, { x: 0, y: 0, w: 100, h: 50 });
    expect(doc.blurFilter(4, { x: 0, y: 0, w: 100, h: 50 })).toBe(blur);
    expect(doc.defs.at(-1)).toContain(`x="-14" y="-14" width="128" height="78"`);
    expect(doc.defs.at(-1)).toContain(`<feGaussianBlur stdDeviation="4"/>`);
  });

  describe("shadow filters", () => {
    const spec = { dx: 4, dy: 6, sigma: 5, color: "rgba(0,0,0,0.5)", includeSource: false, region: { x: 0, y: 0, w: 100, h: 50 } };

    it("blurs, offsets and tints the shadow, in a region padded for the blur and the offset", () => {
      const doc = new SvgDoc();
      const id = doc.shadowFilter(spec);
      const markup = doc.defs[0];
      expect(markup).toContain(`<filter id="${id}" filterUnits="userSpaceOnUse" x="-23" y="-23" width="146" height="96"`);
      expect(markup).toContain(`<feGaussianBlur in="SourceAlpha" stdDeviation="5" result="b"/><feOffset in="b" dx="4" dy="6" result="o"/>`);
      expect(markup).toContain(`<feFlood flood-color="#000000" flood-opacity="0.5" result="c"/>`);
      expect(markup).not.toContain("feMerge");
    });

    it("keeps the element above its shadow when asked to", () => {
      const doc = new SvgDoc();
      doc.shadowFilter({ ...spec, includeSource: true });
      expect(doc.defs[0]).toContain(`<feMerge><feMergeNode in="s"/><feMergeNode in="SourceGraphic"/></feMerge>`);
    });

    it("skips the blur for a hard shadow and multiplies in an extra opacity", () => {
      const doc = new SvgDoc();
      doc.shadowFilter({ ...spec, sigma: 0, opacity: 0.5 });
      expect(doc.defs[0]).not.toContain("feGaussianBlur");
      expect(doc.defs[0]).toContain(`<feOffset in="SourceAlpha" dx="4" dy="6" result="o"/>`);
      expect(doc.defs[0]).toContain(`flood-opacity="0.25"`);
    });

    it("defines identical shadows once and different ones separately", () => {
      const doc = new SvgDoc();
      const a = doc.shadowFilter(spec);
      expect(doc.shadowFilter({ ...spec })).toBe(a);
      expect(doc.shadowFilter({ ...spec, dx: 5 })).not.toBe(a);
      expect(doc.shadowFilter({ ...spec, includeSource: true })).not.toBe(a);
    });
  });

  it("joins the definitions into one block, extra ones first, or into nothing", () => {
    const doc = new SvgDoc();
    expect(doc.defsMarkup()).toBe("");
    doc.clipPath("<rect/>", "k");
    expect(doc.defsMarkup()).toMatch(/^<defs><clipPath id="cf-cp1"><rect\/><\/clipPath><\/defs>$/);
    expect(doc.defsMarkup(["<style>x</style>"])).toMatch(/^<defs><style>x<\/style><clipPath/);
    expect(new SvgDoc().defsMarkup(["<style>x</style>"])).toBe("<defs><style>x</style></defs>");
  });
});

describe("path helpers", () => {
  it("writes a rectangle path", () => {
    expect(rectPath(10, 20, 30, 40)).toBe("M10 20H40V60H10Z");
  });

  it("writes a rounded rectangle with a corner arc for each non-zero radius", () => {
    expect(roundRectPath(0, 0, 100, 50, [10, 10, 10, 10])).toBe("M10 0H90A10 10 0 0 1 100 10V40A10 10 0 0 1 90 50H10A10 10 0 0 1 0 40V10A10 10 0 0 1 10 0Z");
    expect(roundRectPath(0, 0, 100, 50, [0, 0, 0, 0])).toBe("M0 0H100V50H0V0Z");
    expect(roundRectPath(0, 0, 100, 50, [0, 8, 0, 0])).toBe("M0 0H92A8 8 0 0 1 100 8V50H0V0Z");
    expect(roundRectPath(0, 0, 100, 50, [0, 0, 6, 0])).toBe("M0 0H100V44A6 6 0 0 1 94 50H0V0Z");
    expect(roundRectPath(0, 0, 100, 50, [0, 0, 0, 7])).toBe("M0 0H100V50H7A7 7 0 0 1 0 43V0Z");
    expect(roundRectPath(0, 0, 100, 50, [9, 0, 0, 0])).toBe("M9 0H100V50H0V9A9 9 0 0 1 9 0Z");
  });

  it("scales radii down together when they do not fit, like the canvas does", () => {
    expect(roundRectPath(0, 0, 100, 50, [100, 100, 100, 100])).toBe("M25 0H75A25 25 0 0 1 100 25V25A25 25 0 0 1 75 50H25A25 25 0 0 1 0 25V25A25 25 0 0 1 25 0Z");
  });

  it("treats a negative radius as none", () => {
    expect(roundRectPath(0, 0, 10, 10, [-5, -5, -5, -5])).toBe("M0 0H10V10H0V0Z");
  });
});
