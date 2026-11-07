import { describe, expect, it } from "vitest";
import { createText } from "@/core/factory";
import type { TextEffect, TextParagraph } from "@/core/types";
import { IDENTITY } from "./links";
import { SvgDoc } from "./svgUtil";
import { textElementSvg, textGeometry } from "./svgText";

type TextInit = NonNullable<Parameters<typeof createText>[0]>;

/** Text at 20 px: with the estimated metrics "Hi" is 22 wide, a space 11 and "you" starts at x = 33. */
function render(init: TextInit, alpha = 1) {
  const doc = new SvgDoc();
  const svg = textElementSvg(createText({ text: "Hi you", fontSize: 20, ...init }), { doc, matrix: IDENTITY, alpha });
  return { svg, doc, defs: doc.defs.join("") };
}
const effect = (e: TextEffect, init: TextInit = {}) => render({ effect: e, ...init });
const count = (text: string, part: string) => text.split(part).length - 1;
const attr = (text: string, name: string) => [...text.matchAll(new RegExp(`(?<![\\w:-])${name}="([^"]*)"`, "g"))].map((m) => m[1]);

describe("effects with their default settings", () => {
  it("draws no effect as plain words on one baseline", () => {
    const { svg } = render({});
    expect(count(svg, "<text ")).toBe(1);
    expect(attr(svg, "x")).toEqual(["0", "33"]);
    expect(attr(svg, "y")).toEqual(["19.5", "19.5"]);
    expect(svg).toContain('font-size="20" font-weight="400" fill="#0e1318"');
  });

  it("casts a shadow down and to the right, black and 40% see-through, from a shadow with no settings", () => {
    const { svg, defs } = effect({ kind: "shadow" });
    expect(svg).toMatch(/^<g filter="url\(#cf-sh1\)"><text /);
    expect(defs).toContain('dx="1.556" dy="1.556"');
    expect(defs).toContain('flood-color="#000000" flood-opacity="0.4"');
    // no blur setting: the shadow is sharp
    expect(defs).not.toContain("feGaussianBlur");
  });

  it("follows the settings of a shadow when there are some", () => {
    const { defs } = effect({ kind: "shadow", offset: 100, direction: 90, blur: 50, color: "#ff0000", transparency: 0 });
    expect(defs).toContain('dx="0" dy="4.4"');
    expect(defs).toContain('stdDeviation="1.75"');
    expect(defs).toContain('flood-color="#ff0000" flood-opacity="1"');
  });

  it("lifts text with a soft shadow straight below it", () => {
    const { defs } = effect({ kind: "lift" });
    expect(defs).toContain('stdDeviation="3.2"');
    expect(defs).toContain('dx="0" dy="1.2"');
    expect(defs).toContain('flood-opacity="0.33"');
    const strong = effect({ kind: "lift", intensity: 100 }).defs;
    expect(strong).toContain('stdDeviation="5.2"');
    expect(strong).toContain('flood-opacity="0.48"');
  });

  it("outlines the glyphs only, at a thickness that grows with the setting", () => {
    expect(attr(effect({ kind: "hollow" }).svg, "stroke-width")).toEqual(["1.1"]);
    expect(attr(effect({ kind: "hollow", thickness: 100 }).svg, "stroke-width")).toEqual(["2"]);
    // never thinner than one pixel
    expect(attr(effect({ kind: "hollow", thickness: 0 }).svg, "stroke-width")).toEqual(["1"]);
    expect(effect({ kind: "hollow" }).svg).toContain('fill="none"');
  });

  it("puts a black outline of twice the thickness behind the filled text", () => {
    const { svg } = effect({ kind: "outline" });
    expect(count(svg, "<text ")).toBe(2);
    expect(svg.indexOf('stroke="#000000"')).toBeLessThan(svg.indexOf('fill="#0e1318"'));
    expect(attr(svg, "stroke-width")).toEqual(["2.2"]);
    expect(effect({ kind: "outline", color: "#00ff00" }).svg).toContain('stroke="#00ff00"');
  });

  it("splices a violet offset copy behind a thin outline of the text", () => {
    const { svg } = effect({ kind: "splice" });
    expect(count(svg, "<text ")).toBe(2);
    expect(svg).toContain('stroke="#8b3dff"');
    expect(svg).toContain('stroke="#0e1318"');
    // the coloured copy is shifted, the outline is not
    expect(attr(svg, "x")).toEqual(["1.556", "34.556", "0", "33"]);
    expect(effect({ kind: "splice", color: "#123456", offset: 0 }).svg).toContain('stroke="#123456"');
  });

  it("echoes the text twice, fainter and further away each time", () => {
    const { svg } = effect({ kind: "echo" });
    expect(count(svg, "<text ")).toBe(3);
    expect(attr(svg, "fill-opacity")).toEqual(["0.28", "0.55"]);
    expect(attr(svg, "x").slice(0, 2)).toEqual(["3.111", "36.111"]);
    // in the text colour unless the effect has one
    expect(svg).toContain('fill="#0e1318" fill-opacity="0.28"');
    expect(effect({ kind: "echo", color: "#abcdef" }).svg).toContain('fill="#abcdef" fill-opacity="0.28"');
  });

  it("splits the colours of a glitch by a pixel either way", () => {
    const { svg } = effect({ kind: "glitch" });
    expect(svg).toContain('fill="#ff2d95" fill-opacity="0.9"');
    expect(svg).toContain('fill="#19e6ff" fill-opacity="0.9"');
    expect(attr(svg, "x").slice(0, 4)).toEqual(["-1", "32", "1", "34"]);
    expect(attr(effect({ kind: "glitch", offset: 100 }).svg, "x")[0]).toBe("-1.4");
  });

  it("glows with three nested blurs around the text, pink unless told otherwise", () => {
    const { svg, defs } = effect({ kind: "neon" });
    expect(count(svg, "<g filter=")).toBe(3);
    expect(count(svg, 'fill="#ff2fb3"')).toBe(3);
    expect(attr(defs, "stdDeviation")).toEqual(["5.775", "2.52", "1.05"]);
    const custom = effect({ kind: "neon", color: "#00ffaa", intensity: 0 });
    expect(count(custom.svg, 'fill="#00ffaa"')).toBe(3);
    // a weaker glow is tighter
    expect(Number(attr(custom.defs, "stdDeviation")[0])).toBeLessThan(5.775);
  });

  it("paints a rounded yellow box behind each line", () => {
    const { svg } = effect({ kind: "background" });
    expect(svg).toMatch(/^<rect x="-5.2" y="0.22" width="76.4" height="24.56" rx="6" fill="#ffe066"\/>/);
    const tuned = effect({ kind: "background", color: "#112233", spread: 0, roundness: 0, transparency: 50 }).svg;
    // no rounding setting, no rx
    expect(tuned).not.toContain("rx=");
    expect(tuned).toContain('fill="#112233" fill-opacity="0.5"');
  });

  it("skips the box of an empty line", () => {
    const { svg } = effect({ kind: "background" }, { text: "Hi\n\nyou" });
    expect(count(svg, "<rect ")).toBe(2);
  });

  it("scales every layer of an effect by the opacity of the element", () => {
    expect(render({}, 0.5).svg).toContain('fill="#0e1318" fill-opacity="0.5"');
    expect(attr(render({ effect: { kind: "echo" } }, 0.5).svg, "fill-opacity")).toEqual(["0.14", "0.275", "0.5"]);
  });
});

describe("what a text element is made of", () => {
  it("tells a run apart from the rest only by what differs", () => {
    const paragraphs: TextParagraph[] = [{ runs: [{ text: "Big " }, { text: "bolder", bold: true, italic: true, size: 40, font: "Lora", spacing: 100, color: "#ff0000" }] }];
    const { svg } = render({ paragraphs });
    const [big, bolder] = svg.match(/<tspan [^>]*>[^<]*<\/tspan>/g) as string[];
    expect(big).not.toContain("font-");
    expect(bolder).toContain('font-family="');
    expect(bolder).toContain("Lora");
    expect(bolder).toContain('font-size="40"');
    expect(bolder).toContain('font-weight="700"');
    expect(bolder).toContain('font-style="italic"');
    expect(bolder).toContain('letter-spacing="4"');
    expect(bolder).toContain('fill="#ff0000"');
  });

  it("states italics and letter spacing once on the text itself", () => {
    const { svg } = render({ italic: true, letterSpacing: 100 });
    expect(svg).toMatch(/^<text [^>]*font-style="italic"[^>]*letter-spacing="2"/);
    expect(count(svg, "font-style")).toBe(1);
  });

  it("goes back to normal for a run that is not italic in italic text", () => {
    const { svg } = render({ italic: true, paragraphs: [{ runs: [{ text: "lean " }, { text: "upright", italic: false }] }] });
    expect(svg).toContain('font-style="normal"');
  });

  it("underlines words and the spaces between them with one bar each, below the baseline", () => {
    const { svg } = render({ underline: true });
    const bars = svg.match(/<rect [^>]*\/>/g) as string[];
    expect(bars).toHaveLength(3);
    expect(bars[0]).toContain('x="0" y="21.5" width="22" height="1.2"');
    // the space between "Hi" and "you"
    expect(bars[1]).toContain('x="22" y="21.5" width="11"');
  });

  it("strikes words through above the baseline", () => {
    const { svg } = render({ strike: true });
    expect(svg).toContain('<rect x="0" y="13.5" width="22" height="1.2"');
  });

  it("gives a text of nothing but spaces no markup at all", () => {
    expect(render({ text: "    " }).svg).toBe("");
  });

  it("gives only bars to spaces that are underlined", () => {
    const { svg } = render({ text: "   ", underline: true });
    expect(svg).not.toContain("<text");
    expect(count(svg, "<rect ")).toBeGreaterThan(0);
  });

  it("paints text with a gradient when it has one", () => {
    const { svg, defs } = render({
      gradient: {
        type: "linear",
        angle: 90,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
    });
    expect(svg).toContain('fill="url(#cf-lg1)"');
    expect(defs).toContain("<linearGradient");
  });

  it("lists the words of each line, empty lines included", () => {
    const lines = textGeometry(createText({ text: "a b\n\nc", fontSize: 20 }));
    expect(lines.map((l) => l.words)).toEqual([["a", "b"], [], ["c"]]);
    expect(lines.map((l) => l.line.y)).toEqual([...lines.map((l) => l.line.y)].sort((a, b) => a - b));
    expect(lines[1].line.segments).toHaveLength(0);
  });
});

describe("curved text", () => {
  it("sets every word on a circular arc, one text per word", () => {
    const { svg, defs } = render({ curve: 20 });
    expect(count(svg, "<textPath")).toBe(2);
    expect(attr(svg, "startOffset")).toEqual(["0", "33"]);
    expect(svg).toContain('style="font-kerning:none;font-variant-ligatures:none"');
    // a short arc (the small-arc flag is 0) swept clockwise, on a circle whose radius is the text width over the arc angle
    expect(defs).toMatch(/<path id="cf-arc1" d="M[\d. -]+A85\.9\d* 85\.9\d* 0 0 1 /);
    expect(svg).toContain('xlink:href="#cf-arc1"');
  });

  it("curves the other way, round the opposite side of the circle, for a negative curve", () => {
    const { defs } = render({ curve: -20 });
    expect(defs).toMatch(/ 0 0 0 [\d. -]+"\/>$/);
    // the bulge is up, so the arc starts lower than the baseline of the straight text
    expect(defs).not.toBe(render({ curve: 20 }).defs);
  });

  it("uses the long way round for an arc of more than half a circle", () => {
    const { defs } = render({ curve: 100, text: "a longer line of text" });
    expect(defs).toMatch(/ 0 1 1 /);
  });

  it("starts a new arc for each line", () => {
    const { svg, defs } = render({ curve: 20, text: "one\ntwo" });
    expect(count(defs, "<path id=")).toBe(2);
    expect(count(svg, "<textPath")).toBe(2);
  });

  it("skips lines that hold no words", () => {
    const { svg, defs } = render({ curve: 20, text: "Hi\n   \nyou" });
    expect(count(svg, "<textPath")).toBe(2);
    expect(count(defs, "<path id=")).toBe(2);
  });

  it("writes the spacing, weight and colour of each word on its own text", () => {
    const { svg } = render({ curve: 20, letterSpacing: 100, fontWeight: 700, color: "#334455" });
    expect(count(svg, 'letter-spacing="2"')).toBe(2);
    expect(count(svg, 'font-weight="700"')).toBe(2);
    expect(count(svg, 'fill="#334455"')).toBe(2);
  });

  it("paints every word with the gradient of the element", () => {
    const { svg } = render({
      curve: 20,
      gradient: {
        type: "linear",
        angle: 0,
        stops: [
          { offset: 0, color: "#fff" },
          { offset: 1, color: "#000" },
        ],
      },
    });
    expect(count(svg, 'fill="url(#cf-lg1)"')).toBe(2);
  });

  it("stays straight when the curve is too slight to show", () => {
    const straight = render({ curve: 0 }).svg;
    expect(render({ curve: 0.3 }).svg).toBe(straight);
    expect(render({ curve: -0.3 }).svg).toBe(straight);
  });
});
