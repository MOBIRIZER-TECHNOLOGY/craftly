import { describe, expect, it } from "vitest";
import { createText } from "@/core/factory";
import type { TextEffect, TextElement } from "@/core/types";
import { spyContext, toDevice, type PaintCall, type SpyOptions } from "@/test/logicPaint";
import { drawTextElement } from "./drawText";
import { layoutText } from "./textLayout";

/** 40 px text in a fixed box: every glyph is 22 px wide, a line is 50 px high and its baseline 39 px down (see canvasMock). */
const text = (init: Parameters<typeof createText>[0] = {}) => createText({ text: "Hello", fontSize: 40, x: 0, y: 0, width: 300, autoWidth: false, color: "#112233", ...init });

function draw(el: TextElement, scale = 1, opts: SpyOptions = {}) {
  const spy = spyContext(opts);
  drawTextElement(spy.ctx, el, { scale });
  return spy;
}

const effect = (e: TextEffect, init: Parameters<typeof createText>[0] = {}) => text({ effect: e, ...init });
const BASELINE = 39;
const at = (call: PaintCall) => ({ x: call.args[1] as number, y: call.args[2] as number });

/** Compare a list of numbers with a tolerance: glyph widths are `length x size x 0.55`, which is not exact in binary. */
function expectNumbers(actual: unknown[], expected: number[]): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, i) => expect(actual[i] as number).toBeCloseTo(value, 6));
}

const alphaOf = (color: unknown) => parseFloat(String(color).split(",")[3]);

describe("plain text", () => {
  it("fills each segment of a line at its baseline in the text colour and font", () => {
    const el = text();
    const spy = draw(el);
    const [call] = spy.to("fillText");
    const seg = layoutText(el).lines[0].segments[0];
    expect(call.args[0]).toBe("Hello");
    expectNumbers(call.args.slice(1), [0, BASELINE]);
    expect(call.state.fillStyle).toBe("#112233");
    expect(call.state.font).toBe(seg.font);
    expect(call.state.font).toContain("40px");
    expect(call.state.textAlign).toBe("left");
    expect(call.state.textBaseline).toBe("alphabetic");
    expect(spy.to("strokeText")).toHaveLength(0);
  });

  it("paints every line of wrapped text", () => {
    const spy = draw(text({ text: "one two three four", width: 130 }));
    const lines = spy.to("fillText").map((c) => c.args[0]);
    expect(lines.join(" ")).toBe("one two three four");
    expect(lines.length).toBeGreaterThan(1);
    const ys = spy.to("fillText").map((c) => c.args[2] as number);
    expect(ys).toEqual([...ys].sort((a, b) => a - b));
    expect(new Set(ys).size).toBeGreaterThan(1);
  });

  it("uses the colour of each styled run", () => {
    const el = text({
      paragraphs: [
        {
          runs: [
            { text: "red ", color: "#ff0000" },
            { text: "blue", color: "#0000ff", bold: true },
          ],
        },
      ],
    });
    const spy = draw(el);
    const painted = spy.to("fillText").map((c) => [c.args[0], c.state.fillStyle]);
    expect(painted).toEqual([
      ["red", "#ff0000"],
      ["blue", "#0000ff"],
    ]);
    expect(spy.to("fillText")[1].state.font).toContain("700");
  });

  it("restores the context when it is done", () => {
    const spy = draw(effect({ kind: "shadow", color: "#000000" }));
    expect(spy.ctx.shadowBlur).toBe(0);
    expect(spy.names().filter((n) => n === "save")).toHaveLength(spy.names().filter((n) => n === "restore").length);
  });

  it("falls back to the plain painter for an unknown effect", () => {
    const spy = draw(effect({ kind: "bogus" as TextEffect["kind"] }));
    expect(spy.to("fillText")).toHaveLength(1);
    expect(spy.to("fillText")[0].state.shadowBlur).toBe(0);
  });

  it("leaves a blank line empty", () => {
    const spy = draw(text({ text: "a\n\nb" }));
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["a", "b"]);
  });

  it("does not paint spaces on their own", () => {
    const spy = draw(text({ text: "a b" }));
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["a", "b"]);
  });
});

describe("decorations", () => {
  it("draws an underline and a strike-through as bars across the text", () => {
    const spy = draw(text({ underline: true, strike: true }));
    const [under, strike] = spy.to("fillRect");
    // thickness 6 % of the size, the underline just under the baseline, the strike through the x-height
    expectNumbers(under.args, [0, BASELINE + 4, 110, 2.4]);
    expectNumbers(strike.args, [0, BASELINE - 12, 110, 2.4]);
    expect(under.state.fillStyle).toBe("#112233");
  });

  it("underlines the space between two words so the line is unbroken", () => {
    const spy = draw(text({ text: "ab cd", underline: true }));
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["ab", "cd"]);
    const bars = spy.to("fillRect");
    expect(bars).toHaveLength(3);
    expectNumbers(
      bars.map((b) => b.args[0]),
      [0, 44, 66],
    );
  });

  it("keeps a decoration at least one pixel thick", () => {
    const spy = draw(text({ fontSize: 10, underline: true }));
    expect(spy.to("fillRect")[0].args[3]).toBe(1);
  });

  it("uses a run's own underline and strike settings", () => {
    const spy = draw(text({ paragraphs: [{ runs: [{ text: "x", underline: true }, { text: "y" }] }] }));
    expect(spy.to("fillRect")).toHaveLength(1);
  });
});

describe("letter spacing", () => {
  it("places the glyphs one by one when the canvas cannot space letters itself", () => {
    // 500 thousandths of an em at 40 px is 20 px between letters; each glyph is 22 px wide
    const spy = draw(text({ letterSpacing: 500 }));
    const glyphs = spy.to("fillText");
    expect(glyphs.map((c) => c.args[0])).toEqual(["H", "e", "l", "l", "o"]);
    expectNumbers(
      glyphs.map((c) => c.args[1]),
      [0, 42, 84, 126, 168],
    );
    expect(glyphs.every((c) => Math.abs((c.args[2] as number) - BASELINE) < 1e-9)).toBe(true);
  });

  it("strokes the glyphs one by one too", () => {
    const spy = draw(effect({ kind: "hollow" }, { letterSpacing: 500 }));
    expect(spy.to("strokeText").map((c) => c.args[0])).toEqual(["H", "e", "l", "l", "o"]);
  });
});

describe("list markers", () => {
  it("puts a bullet in the margin of every list paragraph", () => {
    const el = text({ text: "first\nsecond", list: "bullet" });
    const spy = draw(el);
    const marks = spy.to("fillText").filter((c) => c.args[0] === "•");
    expect(marks).toHaveLength(2);
    expect(marks[0].state.fillStyle).toBe("#112233");
    expect(marks[0].args[1]).toBe(0);
    const layout = layoutText(el);
    expect(marks[1].args[2]).toBe(layout.lines[1].y + layout.lines[1].baseline);
    // the text itself is indented to make room for the marker
    expect(spy.to("fillText").find((c) => c.args[0] === "first")!.args[1]).toBe(layout.lines[0].x);
    expect(layout.lines[0].x).toBeGreaterThan(0);
  });

  it("numbers the paragraphs of a numbered list", () => {
    const spy = draw(text({ text: "a\nb\nc", list: "number" }));
    // each line is painted, then its marker
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["a", "1.", "b", "2.", "c", "3."]);
  });

  it("does not mark an outlined (hollow) copy of the text", () => {
    const spy = draw(effect({ kind: "hollow" }, { list: "bullet" }));
    expect(spy.to("fillText")).toHaveLength(0);
  });
});

describe("gradient text", () => {
  const gradient = {
    type: "linear" as const,
    angle: 90,
    stops: [
      { offset: -1, color: "#ff0000" },
      { offset: 2, color: "#0000ff" },
    ],
  };

  it("fills the text with a gradient across the whole text box", () => {
    const el = text({ gradient });
    const spy = draw(el);
    const [x0, y0, x1, y1] = spy.to("createLinearGradient")[0].args as number[];
    expectNumbers([x0, y0, x1, y1], [0, 25, 300, 25]);
    const fill = spy.to("fillText")[0].state.fillStyle as { stops: unknown[] };
    expect(fill.stops).toEqual([
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#0000ff" },
    ]);
  });

  it("underlines in the gradient too", () => {
    const spy = draw(text({ gradient, underline: true }));
    expect((spy.to("fillRect")[0].state.fillStyle as { kind: string }).kind).toBe("linear");
  });

  it("tilts the gradient axis with the angle", () => {
    const spy = draw(text({ gradient: { ...gradient, angle: 180 } }));
    const [x0, y0, x1, y1] = spy.to("createLinearGradient")[0].args as number[];
    expectNumbers([x0, y0, x1, y1], [150, 0, 150, 50]);
  });

  it("keeps the effect's own colour for an outline and gives the fill the gradient", () => {
    const spy = draw(effect({ kind: "outline", color: "#00ff00" }, { gradient }));
    expect(spy.to("strokeText")[0].state.strokeStyle).toBe("#00ff00");
    expect((spy.to("fillText")[0].state.fillStyle as { kind: string }).kind).toBe("linear");
  });
});

describe("text effects", () => {
  it("shadow: casts one shadow at the chosen distance and direction, scaled to canvas pixels", () => {
    const e: TextEffect = { kind: "shadow", color: "#336699", offset: 100, direction: 90, blur: 50, transparency: 25 };
    const call = draw(effect(e), 2).to("fillText")[0];
    // 22 % of the size at full offset = 8.8 px straight down, a blur of 35 % of the size at full blur = 7 px
    expect(call.state.shadowColor).toBe("rgba(51,102,153,0.75)");
    expect(call.state.shadowOffsetX).toBeCloseTo(0);
    expect(call.state.shadowOffsetY).toBeCloseTo(17.6);
    expect(call.state.shadowBlur).toBeCloseTo(14);
  });

  it("shadow: uses a soft black shadow down and to the right by default", () => {
    const call = draw(effect({ kind: "shadow" })).to("fillText")[0];
    expect(call.state.shadowColor).toBe("rgba(0,0,0,0.4)");
    expect(call.state.shadowOffsetX).toBeCloseTo(3.111, 3);
    expect(call.state.shadowOffsetY).toBeCloseTo(3.111, 3);
    expect(call.state.shadowBlur).toBe(0);
  });

  it("lift: lifts the text off the page with a soft shadow below it", () => {
    const call = draw(effect({ kind: "lift", intensity: 100 }), 2).to("fillText")[0];
    expect(alphaOf(call.state.shadowColor)).toBeCloseTo(0.48);
    expect(call.state.shadowOffsetX).toBe(0);
    expect(call.state.shadowOffsetY).toBeCloseTo(4.8);
    expect(call.state.shadowBlur).toBeCloseTo(41.6);
    // a gentler lift by default
    expect(alphaOf(draw(effect({ kind: "lift" })).to("fillText")[0].state.shadowColor)).toBeCloseTo(0.33);
  });

  it("hollow: strokes the letters instead of filling them", () => {
    const spy = draw(effect({ kind: "hollow" }, { underline: true }));
    const stroke = spy.to("strokeText")[0];
    expect(spy.to("fillText")).toHaveLength(0);
    expect(spy.to("fillRect")).toHaveLength(0);
    expect(stroke.args[0]).toBe("Hello");
    expectNumbers(stroke.args.slice(1), [0, BASELINE]);
    expect(stroke.state.strokeStyle).toBe("#112233");
    expect(stroke.state.lineWidth).toBeCloseTo(2.2);
    expect(stroke.state.lineJoin).toBe("round");
  });

  it("hollow: a thicker outline for a higher thickness", () => {
    const thin = draw(effect({ kind: "hollow", thickness: 0 })).to("strokeText")[0].state.lineWidth;
    const thick = draw(effect({ kind: "hollow", thickness: 100 })).to("strokeText")[0].state.lineWidth;
    expect(thin).toBeCloseTo(1);
    expect(thick).toBeCloseTo(4);
  });

  it("outline: strokes behind the fill in the effect colour", () => {
    const spy = draw(effect({ kind: "outline", color: "#ff00ff" }));
    const stroke = spy.to("strokeText")[0];
    expect(stroke.state.strokeStyle).toBe("#ff00ff");
    expect(stroke.state.lineWidth).toBeCloseTo(4.4);
    expect(spy.names().indexOf("strokeText")).toBeLessThan(spy.names().indexOf("fillText"));
    expect(spy.to("fillText")[0].state.fillStyle).toBe("#112233");
  });

  it("outline: is black unless told otherwise", () => {
    expect(draw(effect({ kind: "outline" })).to("strokeText")[0].state.strokeStyle).toBe("#000000");
  });

  it("splice: two hollow copies, the tinted one offset from the other", () => {
    const spy = draw(effect({ kind: "splice", color: "#8b00ff", offset: 50, direction: 0 }));
    const [tinted, plain] = spy.to("strokeText");
    expect(spy.to("fillText")).toHaveLength(0);
    expect(tinted.state.strokeStyle).toBe("#8b00ff");
    expect(plain.state.strokeStyle).toBe("#112233");
    expect(at(tinted).x - at(plain).x).toBeCloseTo(4.4);
    expect(at(tinted).y).toBeCloseTo(at(plain).y);
    expect(tinted.state.lineWidth).toBeCloseTo(1.54);
  });

  it("splice: is violet by default", () => {
    expect(draw(effect({ kind: "splice" })).to("strokeText")[0].state.strokeStyle).toBe("#8b3dff");
  });

  it("echo: two fading copies trail behind the text", () => {
    const spy = draw(effect({ kind: "echo", offset: 50, direction: 0 }));
    const [far, near, front] = spy.to("fillText");
    expect(far.state.globalAlpha).toBeCloseTo(0.28);
    expect(near.state.globalAlpha).toBeCloseTo(0.55);
    expect(front.state.globalAlpha).toBe(1);
    expect(at(far).x).toBeCloseTo(8.8);
    expect(at(near).x).toBeCloseTo(4.4);
    expect(at(front).x).toBe(0);
    expect(far.state.fillStyle).toBe("#112233");
  });

  it("echo: tints the copies with the effect colour", () => {
    const [far, near, front] = draw(effect({ kind: "echo", color: "#00aa00" })).to("fillText");
    expect([far.state.fillStyle, near.state.fillStyle, front.state.fillStyle]).toEqual(["#00aa00", "#00aa00", "#112233"]);
  });

  it("glitch: shifts a pink copy left and a cyan one right of the text", () => {
    const [pink, cyan, front] = draw(effect({ kind: "glitch" })).to("fillText");
    expect(pink.state.fillStyle).toBe("#ff2d95");
    expect(cyan.state.fillStyle).toBe("#19e6ff");
    expect(front.state.fillStyle).toBe("#112233");
    expect(at(pink).x).toBeCloseTo(-1.6);
    expect(at(cyan).x).toBeCloseTo(1.6);
    expect(pink.state.globalAlpha).toBeCloseTo(0.9);
    expect(front.state.globalAlpha).toBe(1);
  });

  it("neon: three glow passes of falling strength under the text", () => {
    const spy = draw(effect({ kind: "neon", color: "#00ffcc" }), 2);
    const passes = spy.to("fillText");
    expect(passes).toHaveLength(4);
    expectNumbers(
      passes.slice(0, 3).map((c) => c.state.shadowBlur),
      [40 * 0.55 * 1.05 * 2, 40 * 0.24 * 1.05 * 2, 40 * 0.1 * 1.05 * 2],
    );
    for (const glow of passes.slice(0, 3)) {
      expect(glow.state.shadowColor).toBe("#00ffcc");
      expect(glow.state.fillStyle).toBe("#00ffcc");
    }
    expect(passes[3].state.fillStyle).toBe("#112233");
    expect(passes[3].state.shadowBlur).toBe(0);
  });

  it("neon: glows pink by default and stronger with more intensity", () => {
    const calm = draw(effect({ kind: "neon", intensity: 0 })).to("fillText");
    const strong = draw(effect({ kind: "neon", intensity: 100 })).to("fillText");
    expect(calm[0].state.shadowColor).toBe("#ff2fb3");
    expect(strong[0].state.shadowBlur).toBeGreaterThan(calm[0].state.shadowBlur);
  });

  describe("background", () => {
    it("draws a rounded box behind each line of text", () => {
      const spy = draw(effect({ kind: "background", color: "#ffee00", transparency: 50, spread: 50, roundness: 50 }));
      const box = spy.to("roundRect")[0];
      expect(box.args[0]).toBeCloseTo(-10.4);
      expect(box.args[1]).toBeCloseTo(0.44);
      expect(box.args[2]).toBeCloseTo(130.8);
      expect(box.args[3]).toBeCloseTo(49.12);
      expect(box.args[4]).toBeCloseTo(12);
      const fill = spy.to("fill")[0];
      expect(fill.state.fillStyle).toBe("rgba(255,238,0,0.5)");
      expect(spy.names().indexOf("fill")).toBeLessThan(spy.names().indexOf("fillText"));
      expect(spy.to("fillText")[0].state.fillStyle).toBe("#112233");
    });

    it("limits the corner radius to half the box height", () => {
      const spy = draw(effect({ kind: "background", roundness: 100, spread: 0 }, { fontSize: 10, lineHeight: 1 }));
      const box = spy.to("roundRect")[0];
      expect(box.args[4]).toBeCloseTo((box.args[3] as number) / 2);
    });

    it("skips the empty lines", () => {
      const spy = draw(effect({ kind: "background" }, { text: "a\n\nb" }));
      expect(spy.to("roundRect")).toHaveLength(2);
    });

    it("makes square boxes on a canvas that has no roundRect", () => {
      const spy = draw(effect({ kind: "background" }), 1, { omit: ["roundRect"] });
      expect(spy.to("rect")).toHaveLength(1);
      expect(spy.to("fill")).toHaveLength(1);
    });

    it("is a pale yellow, fully opaque, by default", () => {
      const spy = draw(effect({ kind: "background" }));
      expect(spy.to("fill")[0].state.fillStyle).toBe("rgba(255,224,102,1)");
    });
  });
});

describe("curved text", () => {
  const curved = (init: Parameters<typeof createText>[0]) => text({ autoWidth: true, ...init });
  const letters = (el: TextElement) => {
    const spy = draw(el);
    const calls = spy.calls;
    const out: Array<{ char: string; x: number; y: number; angle: number; call: PaintCall }> = [];
    let tx = 0;
    let ty = 0;
    let angle = 0;
    for (const c of calls) {
      if (c.name === "translate") [tx, ty] = c.args as number[];
      if (c.name === "rotate") angle = c.args[0] as number;
      if (c.name === "fillText") out.push({ char: String(c.args[0]), x: tx, y: ty, angle, call: c });
    }
    return { spy, out };
  };

  it("sets each letter on the arc, turned to follow it, with the middle one upright on the baseline", () => {
    const { out } = letters(curved({ curve: 60 }));
    expect(out.map((l) => l.char).join("")).toBe("Hello");
    expect(out[0].angle).toBeLessThan(0);
    expect(out[4].angle).toBeGreaterThan(0);
    expect(out[0].angle).toBeCloseTo(-out[4].angle);
    expect(out[2].angle).toBeCloseTo(0);
    // an arch: the ends drop below the middle letter, and the letters stay centred on their own spot
    expect(out[0].y).toBeGreaterThan(out[2].y);
    expect(out[2].y).toBeCloseTo(BASELINE);
    for (const l of out) expectNumbers(l.call.args.slice(1), [-11, 0]);
    // the arc is centred on the middle of the text (110 px wide)
    expect(out[2].x).toBeCloseTo(55);
    expect(out[0].x + out[4].x).toBeCloseTo(110);
  });

  it("bows the other way for a negative curve", () => {
    const arch = letters(curved({ curve: 60 })).out;
    const bow = letters(curved({ curve: -60 })).out;
    expect(bow[0].angle).toBeGreaterThan(0);
    expect(bow[4].angle).toBeLessThan(0);
    expect(bow[0].y).toBeLessThan(bow[2].y);
    expect(arch[0].y).toBeGreaterThan(arch[2].y);
  });

  it("gives every letter its own gradient mapped into the letter's frame", () => {
    const gradient = {
      type: "linear" as const,
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const { spy, out } = letters(curved({ curve: 40, gradient }));
    // one gradient for the text box, then one per letter
    expect(spy.to("createLinearGradient")).toHaveLength(6);
    const first = spy.to("createLinearGradient")[1].args as number[];
    const last = spy.to("createLinearGradient")[5].args as number[];
    expect(first).not.toEqual(last);
    expect((out[0].call.state.fillStyle as { kind: string }).kind).toBe("linear");
  });

  it("colours each run on the arc and skips the spaces", () => {
    const el = curved({
      curve: 30,
      paragraphs: [
        {
          runs: [
            { text: "ab ", color: "#ff0000" },
            { text: "cd", color: "#00ff00" },
          ],
        },
      ],
    });
    const { out } = letters(el);
    expect(out.map((l) => [l.char, l.call.state.fillStyle])).toEqual([
      ["a", "#ff0000"],
      ["b", "#ff0000"],
      ["c", "#00ff00"],
      ["d", "#00ff00"],
    ]);
    // the gap for the space is kept: c sits about twice as far from b as b from a
    expect((out[2].x - out[1].x) / (out[1].x - out[0].x)).toBeGreaterThan(1.5);
  });

  it("includes the letter spacing in the advance of each letter", () => {
    const tight = letters(curved({ curve: 30 })).out;
    const loose = letters(curved({ curve: 30, letterSpacing: 500 })).out;
    expect(loose[1].call.args[1]).toBeCloseTo(-(22 + 20) / 2);
    expect(tight[1].call.args[1]).toBeCloseTo(-11);
  });

  it("draws a barely curved line straight instead of losing it", () => {
    // |curve| below 0.91 gives an arc too small to bend the text (the SVG export draws such text straight too)
    const spy = draw(curved({ curve: 0.5 }));
    expect(spy.to("fillText").map((c) => c.args[0])).toEqual(["Hello"]);
  });
});

describe("curved text with an effect", () => {
  const KINDS = ["shadow", "lift", "hollow", "outline", "splice", "echo", "glitch", "neon", "background"] as const;
  const glyphCalls = (spy: ReturnType<typeof draw>) => spy.calls.filter((c) => c.name === "fillText" || c.name === "strokeText");
  /** what a pass looks like, apart from where it is */
  const look = (c: PaintCall) => ({
    name: c.name,
    paint: String(c.name === "fillText" ? c.state.fillStyle : c.state.strokeStyle),
    lineWidth: c.name === "strokeText" ? c.state.lineWidth : null,
    alpha: c.state.globalAlpha,
    shadow: [c.state.shadowColor, c.state.shadowBlur, c.state.shadowOffsetX, c.state.shadowOffsetY],
  });
  const curvedEffect = (e: TextEffect, init: Parameters<typeof createText>[0] = {}) => effect(e, { autoWidth: true, curve: 50, ...init });
  const translates = (spy: ReturnType<typeof draw>) => spy.to("translate").map((c) => c.args as number[]);

  it.each(KINDS)("%s: paints every pass of the straight text, each letter of it on the arc", (kind) => {
    const e: TextEffect = { kind, color: "#00aa88" };
    const straight = glyphCalls(draw(effect(e, { autoWidth: true }), 2));
    const curved = glyphCalls(draw(curvedEffect(e), 2));
    expect(straight.length).toBeGreaterThan(0);
    // "Hello" is one segment on a straight line and five letters on the arc
    expect(curved).toHaveLength(straight.length * 5);
    straight.forEach((pass, i) => {
      for (let k = 0; k < 5; k++) expect(look(curved[i * 5 + k])).toEqual(look(pass));
    });
  });

  it("neon: three glows of the effect colour under the letters, then the letters in their own colour", () => {
    const calls = glyphCalls(draw(curvedEffect({ kind: "neon", color: "#00ffcc" }), 2));
    expect(calls).toHaveLength(20);
    for (const glow of calls.slice(0, 15)) {
      expect(glow.state.shadowColor).toBe("#00ffcc");
      expect(glow.state.fillStyle).toBe("#00ffcc");
      expect(glow.state.shadowBlur).toBeGreaterThan(0);
    }
    for (const letter of calls.slice(15)) {
      expect(letter.state.fillStyle).toBe("#112233");
      expect(letter.state.shadowBlur).toBe(0);
    }
  });

  it("splice and echo: the offset copies move the whole arc by the offset", () => {
    const splice = translates(draw(curvedEffect({ kind: "splice", offset: 50, direction: 0 })));
    for (let k = 0; k < 5; k++) {
      expect(splice[k][0] - splice[5 + k][0]).toBeCloseTo(4.4);
      expect(splice[k][1]).toBeCloseTo(splice[5 + k][1]);
    }
    const echo = translates(draw(curvedEffect({ kind: "echo", offset: 50, direction: 90 })));
    for (let k = 0; k < 5; k++) {
      expect(echo[k][1] - echo[10 + k][1]).toBeCloseTo(8.8);
      expect(echo[5 + k][1] - echo[10 + k][1]).toBeCloseTo(4.4);
    }
  });

  it("background: bends the box onto the arc, behind the letters, in the effect colour", () => {
    const spy = draw(curvedEffect({ kind: "background", color: "#ffee00", transparency: 50, spread: 50, roundness: 50 }));
    const [arc] = spy.to("arc");
    const stroke = spy.to("stroke")[0];
    expect(spy.to("arc")).toHaveLength(1);
    expect(stroke.state.strokeStyle).toBe("rgba(255,238,0,0.5)");
    expect(stroke.state.lineWidth).toBeCloseTo(49.12);
    expect(stroke.state.lineCap).toBe("round");
    expect(spy.names().indexOf("stroke")).toBeLessThan(spy.names().indexOf("fillText"));
    // an arch: the band runs clockwise round a centre below the text, its ends level with each other
    const [cx, , r, from, to, anticlockwise] = arc.args as [number, number, number, number, number, boolean];
    expect(cx).toBeCloseTo(55);
    expect(anticlockwise).toBe(false);
    expect(from + Math.PI / 2).toBeCloseTo(-(to + Math.PI / 2));
    expect(r).toBeGreaterThan(0);
    // the letters stay in their own colour, the box is not drawn as a straight rectangle
    expect(spy.to("roundRect")).toHaveLength(0);
    expect(spy.to("fillText")[0].state.fillStyle).toBe("#112233");
  });

  it("background: turns the other way round a centre above the text for a bow, and has square ends for square corners", () => {
    const spy = draw(curvedEffect({ kind: "background", roundness: 0 }, { curve: -50 }));
    expect(spy.to("arc")[0].args[5]).toBe(true);
    expect(spy.to("stroke")[0].state.lineCap).toBe("butt");
  });

  it("keeps the gradient on the letters of a curved text with an effect, and off its tinted copies", () => {
    const gradient = {
      type: "linear" as const,
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    };
    const calls = glyphCalls(draw(curvedEffect({ kind: "glitch" }, { gradient })));
    expect(calls.slice(0, 5).every((c) => c.state.fillStyle === "#ff2d95")).toBe(true);
    expect(calls.slice(10).every((c) => (c.state.fillStyle as { kind?: string }).kind === "linear")).toBe(true);
  });
});

describe("text on the page", () => {
  it("is placed where the layout puts it, for any alignment", () => {
    const el = text({ align: "right" });
    const call = draw(el).to("fillText")[0];
    const line = layoutText(el).lines[0];
    expect(line.x).toBeCloseTo(300 - 110);
    const where = toDevice(call.state.matrix, call.args[1] as number, call.args[2] as number);
    expect(where.x).toBeCloseTo(190);
    expect(where.y).toBeCloseTo(BASELINE);
  });
});
