/**
 * Text to points with a real font file: Inter, the woff2 the app ships, opened by fontkit. The layout is the one the canvas uses
 * (here without a canvas, so with its measured fallback); what is checked is that every letter becomes a shape where the layout
 * puts it, with its colour, its holes, its decorations, and that what cannot be converted is refused or counted.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { createText } from "@/core/factory";
import type { GroupElement, ShapeElement, TextElement } from "@/core/types";
import { layoutText } from "./textLayout";
import { openFace, outlineText, SYNTHETIC_SLANT, textInPlaceOf, type OutlineFace } from "./textOutline";

const file = (name: string) => {
  const bytes = readFileSync(join(process.cwd(), "node_modules/@fontsource-variable/inter/files", name));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

let upright: OutlineFace;
let slanted: OutlineFace;
beforeAll(async () => {
  upright = await openFace(file("inter-latin-wght-normal.woff2"), 400, true, false);
  slanted = await openFace(file("inter-latin-wght-normal.woff2"), 400, true, true);
}, 120_000);

const interOnly = () => (style: { family: string }) => (style.family === "Inter" ? upright : null);
const text = (init: Parameters<typeof createText>[0]): TextElement => createText({ fontFamily: "Inter", fontSize: 40, x: 100, y: 50, ...init });
const pieces = (shape: ShapeElement) => (shape.path?.match(/M/g) ?? []).length;

describe("text to points", () => {
  it("makes one shape a letter, where the layout puts it, in the colour of its run", () => {
    const el = text({ text: "Hi to", color: "#123456" });
    const layout = layoutText(el);
    const { shapes, missing, noFont } = outlineText(el, layout, interOnly());
    expect(noFont).toEqual([]);
    expect(missing).toBe(0);
    expect(shapes).toHaveLength(4); // H, i, t, o: the space has no outline
    for (const shape of shapes) expect(shape).toMatchObject({ type: "shape", shape: "path", fill: { type: "solid", color: "#123456" }, stroke: null });
    // left to right, on the line: every letter starts where the one before it ends or later, and sits on the baseline
    const xs = shapes.map((s) => s.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
    const line = layout.lines[0];
    const baseline = line.y + line.baseline;
    for (const shape of shapes) expect(shape.y + shape.height).toBeLessThanOrEqual(baseline + 1);
    // the H is about as tall as Inter's capitals (0.727 of an em) and starts at the left of the line
    const h = shapes[0];
    expect(h.height).toBeGreaterThan(40 * 0.69);
    expect(h.height).toBeLessThan(40 * 0.76);
    expect(h.x).toBeGreaterThanOrEqual(line.x);
    expect(h.x).toBeLessThan(line.x + 6);
    // the dot of the i is a piece of its own, and the o keeps its hole as a second piece of the same shape
    expect(pieces(shapes[1])).toBe(2);
    expect(pieces(shapes[3])).toBe(2);
  });

  it("follows the runs of a rich text: each piece keeps its own colour and size", () => {
    const el = text({
      paragraphs: [
        {
          runs: [
            { text: "A", color: "#ff0000" },
            { text: "B", color: "#00ff00", size: 80 },
          ],
        },
      ],
    });
    const { shapes } = outlineText(el, layoutText(el), interOnly());
    expect(shapes.map((s) => (s.fill as { color: string }).color)).toEqual(["#ff0000", "#00ff00"]);
    expect(shapes[1].height).toBeGreaterThan(shapes[0].height * 1.8);
  });

  it("adds the letter spacing after every letter, as the canvas does", () => {
    const tight = text({ text: "AA" });
    const wide = { ...tight, letterSpacing: 500 }; // half an em
    const gap = (el: TextElement) => {
      const [a, b] = outlineText(el, layoutText(el), interOnly()).shapes;
      return b.x - a.x;
    };
    expect(gap(wide) - gap(tight)).toBeCloseTo(20, 0);
  });

  it("draws underline and strike as the rectangles the canvas draws", () => {
    const el = text({ text: "a", underline: true, strike: true });
    const { shapes } = outlineText(el, layoutText(el), interOnly());
    expect(shapes).toHaveLength(3);
    const [, under, strike] = shapes;
    expect(under.height).toBeCloseTo(Math.max(1, 40 * 0.06), 1);
    expect(strike.y).toBeLessThan(under.y);
  });

  it("slants an upright face that is asked to be italic, by what the browser slants it", () => {
    const el = text({ text: "I" });
    const layout = layoutText(el);
    const straight = outlineText(el, layout, () => upright).shapes[0];
    const leaning = outlineText(el, layout, () => slanted).shapes[0];
    expect(leaning.width - straight.width).toBeCloseTo(straight.height * SYNTHETIC_SLANT, 0);
  });

  it("makes the whole text one shape when a gradient paints it, so the gradient still runs across it", () => {
    const gradient = {
      type: "linear" as const,
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const el = text({ text: "Hello", gradient });
    const { shapes } = outlineText(el, layoutText(el), interOnly());
    expect(shapes).toHaveLength(1);
    expect(shapes[0].fill).toEqual(gradient);
  });

  it("counts a letter the font has no outline for, and leaves it out", () => {
    const el = text({ text: "Aनमस्ते" }); // Devanagari is not in the latin file
    const { shapes, missing } = outlineText(el, layoutText(el), interOnly());
    expect(shapes).toHaveLength(1);
    expect(missing).toBeGreaterThan(0);
  });
});

describe("the weight of a variable font", () => {
  /** How wide the ink of an H is, in font units: a bolder H has thicker stems on the same middle, so its ink is wider. */
  const stemOf = (face: OutlineFace) => {
    const d = face.font.layout("H").glyphs[0].path.toSVG();
    const xs = [...d.matchAll(/(-?\d+(?:\.\d+)?) (-?\d+(?:\.\d+)?)/g)].map((m) => Number(m[1]));
    return Math.max(...xs) - Math.min(...xs);
  };

  it("draws a bold text bolder, and a thin one thinner, from the woff2 file the app ships", async () => {
    const data = file("inter-latin-wght-normal.woff2");
    const [thin, regular, bold] = await Promise.all([100, 400, 700].map((weight) => openFace(data, weight, true, false)));
    expect(stemOf(thin)).toBeLessThan(stemOf(regular));
    expect(stemOf(bold)).toBeGreaterThan(stemOf(regular) * 1.05);
    // and the letters are wider: the letter widths of the font change with the weight as well
    const advance = (face: OutlineFace) => face.font.layout("Hamburg").positions.reduce((sum, p) => sum + p.xAdvance, 0);
    expect(advance(bold)).toBeGreaterThan(advance(regular));
  }, 120_000);

  it("gives, at the default weight, the very outlines fontkit reads from the woff2 file itself", async () => {
    const { create } = await import("fontkit");
    const data = file("inter-latin-wght-normal.woff2");
    const direct = create(new Uint8Array(data)) as import("fontkit").Font;
    const rebuilt = await openFace(data, 400, true, false);
    const sample = "The quick brown fox jumps over the lazy dog. ÀÉÎÕÜ çñß 0123456789 &@?!";
    const outlines = (font: Pick<import("fontkit").Font, "layout">) => font.layout(sample).glyphs.map((g) => g.path.toSVG());
    expect(outlines(rebuilt.font)).toEqual(outlines(direct));
  }, 120_000);

  it("opens an italic file and a file that is not variable without rebuilding them", async () => {
    const italic = await openFace(file("inter-latin-wght-italic.woff2"), 400, false, false);
    expect(italic.font.layout("a").glyphs[0].path.toSVG()).not.toBe("");
  }, 120_000);
});

describe("in the place of the text box", () => {
  it("keeps the turn, the opacity and what belongs to the element, and puts the letters where they were", () => {
    const el = text({ text: "Turn", rotation: 30, opacity: 0.5, name: "Title", link: "https://example.com", width: 300, autoWidth: false });
    const made = textInPlaceOf(el, layoutText(el), interOnly());
    expect(made.problem).toBeNull();
    const group = made.element as GroupElement;
    expect(group.type).toBe("group");
    expect(made.count).toBe(4);
    expect(group).toMatchObject({ rotation: 30, opacity: 0.5, name: "Title", link: "https://example.com" });
    expect(group.children).toHaveLength(4);
    // the middle of the letters is where it was on the page: the group turns about its own middle, so the turn is undone about it
    const unturned = textInPlaceOf({ ...el, rotation: 0 }, layoutText(el), interOnly()).element as GroupElement;
    const mid = (g: GroupElement) => ({ x: g.x + g.width / 2, y: g.y + g.height / 2 });
    const textMid = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
    const angle = (30 * Math.PI) / 180;
    const off = { x: mid(unturned).x - textMid.x, y: mid(unturned).y - textMid.y };
    const turned = { x: textMid.x + off.x * Math.cos(angle) - off.y * Math.sin(angle), y: textMid.y + off.x * Math.sin(angle) + off.y * Math.cos(angle) };
    expect(mid(group).x).toBeCloseTo(turned.x, 1);
    expect(mid(group).y).toBeCloseTo(turned.y, 1);
  });

  it("mirrors the letters of a mirrored text", () => {
    const el = text({ text: "AB" });
    const flipped = textInPlaceOf({ ...el, flipH: true }, layoutText(el), interOnly()).element as GroupElement;
    const plain = textInPlaceOf(el, layoutText(el), interOnly()).element as GroupElement;
    // the A is on the left of plain text and on the right of mirrored text
    const aOf = (g: GroupElement) => (g.children[0] as ShapeElement).x;
    expect(aOf(plain)).toBeLessThan(aOf(flipped));
  });

  it("gives one letter as the shape itself, not a group of one", () => {
    const el = text({ text: "A", rotation: 10 });
    const made = textInPlaceOf(el, layoutText(el), interOnly());
    expect(made.element).toMatchObject({ type: "shape", shape: "path", rotation: 10 });
  });

  it("refuses curved text, a font with no file, and text that is only spaces", () => {
    const curved = text({ text: "Arch", curve: 80 });
    expect(textInPlaceOf(curved, layoutText(curved), interOnly())).toMatchObject({ element: null, problem: "curved" });
    const system = text({ text: "Hello", fontFamily: "Comic Sans MS" });
    expect(textInPlaceOf(system, layoutText(system), interOnly())).toMatchObject({ element: null, problem: "no-font", noFont: ["Comic Sans MS"] });
    const blank = text({ text: "   " });
    expect(textInPlaceOf(blank, layoutText(blank), interOnly())).toMatchObject({ element: null, problem: "empty" });
  });

  it("refuses more letters than a drawing may have", () => {
    const el = text({ text: "x".repeat(501), width: 4000, autoWidth: false, fontSize: 8 });
    expect(textInPlaceOf(el, layoutText(el), interOnly())).toMatchObject({ element: null, problem: "too-large" });
  });

  it("says that an effect is not kept", () => {
    const el = { ...text({ text: "Glow" }), effect: { kind: "neon" as const } };
    expect(textInPlaceOf(el, layoutText(el), interOnly())).toMatchObject({ effectDropped: true, problem: null });
  });
});
