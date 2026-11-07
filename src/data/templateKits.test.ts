import { describe, expect, it } from "vitest";
import { createPage, createShape } from "@/core/factory";
import type { GraphicElement, ImageElement, ShapeElement, Template, TextElement } from "@/core/types";
import { GRAPHICS } from "./graphics";
import { C, F, G, H, L, O, P, R, RR, S, SIZES, T, gradientBg, patternBg, pg, photoBg, solidBg, template } from "./templates/dsl";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, getTemplate, searchTemplates } from "./templates";
import { withMotion } from "./templates/motion";
import { lozengeStrip, rng, synthScene } from "./templates/print-art";
import * as printKit from "./templates/print-kit";
import * as deck from "./templates/presentations-kit";
import * as social from "./templates/social-kit";

const asText = (el: unknown) => el as TextElement;
const asShape = (el: unknown) => el as ShapeElement;
const asImage = (el: unknown) => el as ImageElement;
const asGraphic = (el: unknown) => el as GraphicElement;

describe("the template library", () => {
  it("finds a template by id", () => {
    const first = TEMPLATES[0];
    expect(getTemplate(first.id)).toBe(first);
    expect(getTemplate("no-such-template")).toBeUndefined();
  });

  it("labels every category that has a template", () => {
    for (const t of TEMPLATES) expect(TEMPLATE_CATEGORY_LABELS[t.category], t.id).toBeTruthy();
  });

  it("searches name, category and tags, every word having to match, in any case", () => {
    const sample = TEMPLATES.find((t) => t.tags.length >= 2)!;
    expect(searchTemplates("")).toHaveLength(TEMPLATES.length);
    expect(searchTemplates("   ", null)).toHaveLength(TEMPLATES.length);
    expect(searchTemplates(sample.name.toUpperCase()).map((t) => t.id)).toContain(sample.id);
    expect(searchTemplates(`  ${sample.tags[0]}  ${sample.tags[1]} `).map((t) => t.id)).toContain(sample.id);
    expect(searchTemplates(`${sample.tags[0]} qqqqzzzz`)).toEqual([]);
  });

  it("limits a search to a category", () => {
    const presentations = searchTemplates("", "presentation");
    expect(presentations.length).toBeGreaterThan(0);
    expect(presentations.every((t) => t.category === "presentation")).toBe(true);
    expect(searchTemplates(presentations[0].name, "logo").map((t) => t.id)).not.toContain(presentations[0].id);
  });
});

describe("the template authoring helpers", () => {
  it("writes fixed width text with a tight line height, and headlines bolder and tighter", () => {
    const text = asText(T("Hello", 10, 20, 300, 40));
    expect(text).toMatchObject({ x: 10, y: 20, width: 300, fontSize: 40, autoWidth: false, lineHeight: 1.2 });
    const headline = asText(H("Big", 0, 0, 500, 100, { color: "#ff0000" }));
    expect(headline).toMatchObject({ fontWeight: 800, lineHeight: 1.05, color: "#ff0000", fontSize: 100 });
    expect(asText(H("Big", 0, 0, 500, 100, { fontWeight: 300 })).fontWeight).toBe(300);
  });

  it("writes shapes from a colour, a fill or nothing", () => {
    expect(asShape(R(1, 2, 30, 40, "#112233"))).toMatchObject({ shape: "rect", x: 1, y: 2, width: 30, height: 40, fill: { type: "solid", color: "#112233" } });
    expect(asShape(R(0, 0, 1, 1, null)).fill).toBeNull();
    const fill = gradientBg(90, "#000000", "#ffffff");
    expect(asShape(S("star", 0, 0, 5, 5, fill)).fill).toBe(fill);
    expect(asShape(RR(0, 0, 10, 10, 4, "#000000"))).toMatchObject({ shape: "rect", radius: 4 });
    expect(asShape(RR(0, 0, 10, 10, 4, "#000000", { radius: 9 })).radius).toBe(9);
  });

  it("writes a circle by its centre and radius", () => {
    expect(asShape(C(100, 50, 20, "#000000"))).toMatchObject({ shape: "ellipse", x: 80, y: 30, width: 40, height: 40 });
  });

  it("writes an outline shape with a stroke and no fill", () => {
    expect(asShape(O("hexagon", 0, 0, 50, 50, "#ff0000", 3))).toMatchObject({ shape: "hexagon", fill: null, stroke: { color: "#ff0000", width: 3, style: "solid" } });
  });

  it("writes a line between two points as a turned flat line", () => {
    const line = L(0, 0, 3, 4, "#000000") as ReturnType<typeof L>;
    expect(line.width).toBeCloseTo(5);
    expect(line.x).toBeCloseTo(-1);
    expect(line.y).toBeCloseTo(2);
    expect(line.rotation).toBeCloseTo(53.13, 1);
    expect(line.stroke).toMatchObject({ color: "#000000", width: 4, cap: "round" });
    expect(L(0, 0, 10, 0, "#000000", 9, { endArrow: "arrow" })).toMatchObject({ endArrow: "arrow", stroke: { width: 9 } });
  });

  it("writes a built-in photo, a drop frame and a graphic", () => {
    expect(asImage(P("sunset-hills", 0, 0, 400, 300))).toMatchObject({ src: "builtin:sunset-hills", width: 400, height: 300, naturalWidth: 1600, naturalHeight: 1067 });
    expect(asImage(F(5, 6, 100, 80, "ellipse"))).toMatchObject({ src: null, isFrame: true, mask: "ellipse", x: 5, y: 6 });
    expect(asImage(F(0, 0, 10, 10)).mask).toBe("rect");
    const graphic = asGraphic(G(`<svg viewBox="0 0 10 10"/>`, 1, 2, 30, 40, { name: "Mark" }));
    expect(graphic).toMatchObject({ type: "graphic", x: 1, y: 2, width: 30, height: 40, name: "Mark" });
  });

  it("writes page backgrounds", () => {
    expect(solidBg("#123456")).toEqual({ type: "solid", color: "#123456" });
    expect(gradientBg(45, "#000000")).toEqual({ type: "linear", angle: 45, stops: [{ offset: 0, color: "#000000" }] });
    expect(gradientBg(0, "#000000", "#888888", "#ffffff").stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(patternBg("dots", "#000000", "#ffffff")).toEqual({ type: "pattern", pattern: "dots", color: "#000000", background: "#ffffff", scale: 1 });
    expect(patternBg("grid", "#000000", "#ffffff", 2)).toMatchObject({ pattern: "grid", scale: 2 });
    expect(photoBg("nebula")).toEqual({ type: "image", src: "builtin:nebula", fit: "cover", dim: 0 });
    expect(photoBg("nebula", 0.4)).toMatchObject({ dim: 0.4 });
  });

  it("writes a page from a colour or a fill, with notes", () => {
    const page = pg("#ffffff", [R(0, 0, 1, 1, "#000000")], "Say hello");
    expect(page.background).toEqual({ type: "solid", color: "#ffffff" });
    expect(page.notes).toBe("Say hello");
    expect(pg(gradientBg(0, "#000000", "#ffffff"), []).background.type).toBe("linear");
  });

  it("builds a template with the id, the size and the design type of its size key", () => {
    const t = template({ slug: "demo", name: "Demo", category: "poster", size: "poster", tags: ["a"], accent: "#ff0000" }, [pg("#ffffff", [])]);
    expect(t).toMatchObject({ id: "poster-demo", name: "Demo", category: "poster", typeId: "poster", width: SIZES.poster.width, height: SIZES.poster.height, tags: ["a"], accent: "#ff0000" });
    expect(t.pages).toHaveLength(1);
  });
});

describe("withMotion", () => {
  const base = (): Template => ({
    id: "t",
    name: "T",
    category: "presentation",
    typeId: "presentation",
    width: 1000,
    height: 1000,
    tags: [],
    accent: "#000000",
    pages: [
      createPage({ elements: [createShape("rect", { id: "bg", width: 1000, height: 1000 }), createShape("rect", { id: "a", width: 100, height: 100 }), createShape("rect", { id: "b", width: 100, height: 100 })] }),
      createPage({ elements: [createShape("rect", { id: "c", width: 100, height: 100 })] }),
    ],
  });

  it("gives the elements a staggered entrance, leaving the backdrop still, and does not touch the original", () => {
    const original = base();
    const moved = withMotion(original, { entrance: "rise", transition: "dissolve" });
    expect(moved).not.toBe(original);
    const [first] = moved.pages;
    expect(first.elements[0].animation).toBeUndefined();
    expect(first.elements[1].animation?.in).toMatchObject({ kind: "rise", delay: 0 });
    expect(first.elements[2].animation?.in).toMatchObject({ kind: "rise", delay: 0.14 });
    expect(original.pages[0].elements[1].animation).toBeUndefined();
  });

  it("adds a transition into every page but the first, with its direction and length", () => {
    const moved = withMotion(base(), { entrance: "fade", transition: "slide", direction: "up", transitionSeconds: 1.5 });
    expect(moved.pages[0].transition).toBeUndefined();
    expect(moved.pages[1].transition).toEqual({ kind: "slide", duration: 1.5, direction: "up" });
    const plain = withMotion(base(), { entrance: "fade", transition: "slide" });
    expect(plain.pages[1].transition).toEqual({ kind: "slide", duration: 0.6, direction: "left" });
  });

  it("sets how long each page stays when asked to", () => {
    expect(withMotion(base(), { entrance: "fade", transition: "dissolve", pageSeconds: 7 }).pages.map((p) => p.duration)).toEqual([7, 7]);
    expect(withMotion(base(), { entrance: "fade", transition: "dissolve" }).pages[0].duration).toBeUndefined();
  });

  it("leaves the elements as they are for an entrance that does not exist", () => {
    const original = base();
    const moved = withMotion(original, { entrance: "no-such-entrance", transition: "dissolve" });
    expect(moved.pages[0].elements).toBe(original.pages[0].elements);
  });
});

describe("print art", () => {
  it("makes the same numbers for the same seed, and others for another", () => {
    const a = rng(5);
    const b = rng(5);
    const first = [a(), a(), a()];
    expect(first).toEqual([b(), b(), b()]);
    expect(first.every((n) => n >= 0 && n < 1)).toBe(true);
    expect([rng(6)(), rng(6)()]).not.toEqual([first[0], first[1]]);
  });

  it("draws the same synthwave scene every time, and uses a default seed", () => {
    const opts = { horizon: 600, sunR: 200, gridBottom: 900 };
    const scene = synthScene(800, 1000, opts);
    expect(scene).toBe(synthScene(800, 1000, opts));
    expect(synthScene(800, 1000, { ...opts, seed: 11 })).toBe(scene);
    expect(synthScene(800, 1000, { ...opts, seed: 12 })).not.toBe(scene);
    expect(scene.startsWith("<svg")).toBe(true);
    expect(lozengeStrip(100, "#000000", "#ff0000")).toContain("<svg");
  });
});

describe("print kit", () => {
  const known = GRAPHICS[0];

  it("places a library illustration in a box, or an invisible box for an id it does not know", () => {
    const hit = asGraphic(printKit.gx(known.id, 10, 20, 100, 50));
    expect(hit).toMatchObject({ type: "graphic", x: 10, y: 20, width: 100, height: 50, source: { kind: "illustration", id: known.id } });
    const miss = asShape(printKit.gx("no-such-graphic", 10, 20, 100, 50));
    expect(miss).toMatchObject({ type: "shape", shape: "rect", fill: null, x: 10, y: 20, width: 100, height: 50 });
  });

  it("sizes an illustration by width from its aspect ratio, or a square for an unknown one", () => {
    const hit = asGraphic(printKit.gxw(known.id, 0, 0, 200));
    expect(hit.width).toBe(200);
    expect(hit.height).toBe(Math.round(200 / (hit.viewW / hit.viewH)));
    expect(asShape(printKit.gxw("no-such-graphic", 0, 0, 80))).toMatchObject({ width: 80, height: 80 });
  });

  it("fits a photo to its box around a focal point and grades it", () => {
    const photo = asImage(printKit.ph("sunset-hills", 0, 0, 800, 800, { fx: 0, fy: 1, zoom: 2, duo: ["#000000", "#ffffff"], tune: { contrast: 20 } }));
    expect(photo.src).toBe("builtin:sunset-hills");
    expect(photo.crop.x).toBeCloseTo(0);
    expect(photo.crop.y).toBeLessThan(0);
    expect(photo.filter.duotone).toEqual({ dark: "#000000", light: "#ffffff" });
    expect(photo.filter.contrast).toBe(20);
    const plain = asImage(printKit.ph("sunset-hills", 0, 0, 800, 800));
    expect(plain.filter.duotone).toBeNull();
    expect(plain.crop.x).toBeLessThan(0);
  });

  it("assumes a 3:2 photo for an id it does not know", () => {
    const photo = asImage(printKit.ph("no-such-photo", 0, 0, 300, 200));
    expect([photo.naturalWidth, photo.naturalHeight]).toEqual([1600, 1067]);
    expect(photo.crop.w).toBeGreaterThanOrEqual(1);
  });

  it("draws rules, frames, rings and diamonds from their outer box", () => {
    expect(asShape(printKit.hr(10, 20, 100, "#000000"))).toMatchObject({ x: 10, y: 20, width: 100, height: 1.5 });
    expect(asShape(printKit.vr(10, 20, 100, "#000000", 3))).toMatchObject({ width: 3, height: 100 });
    expect(asShape(printKit.frame(0, 0, 100, 60, "#000000", 4))).toMatchObject({ x: 2, y: 2, width: 96, height: 56, fill: null, stroke: { width: 4, join: "miter" } });
    expect(asShape(printKit.ring(50, 50, 20, "#000000", 4))).toMatchObject({ shape: "ellipse", x: 32, y: 32, width: 36, height: 36 });
    expect(asShape(printKit.diamond(50, 50, 10, "#000000"))).toMatchObject({ shape: "diamond", x: 40, y: 40, width: 20 });
  });

  it("fades through evenly spaced stops, one stop being a plain start", () => {
    expect(printKit.fade(180, "#000000", "#ffffff").stops.map((s) => s.offset)).toEqual([0, 1]);
    expect(printKit.fade(180, "#000000").stops).toEqual([{ offset: 0, color: "#000000" }]);
  });

  it("writes text in one family with defaults it can override", () => {
    const serif = printKit.font("Lora", { color: "#112233" });
    expect(asText(serif("Hi", 0, 0, 100, 20))).toMatchObject({ fontFamily: "Lora", color: "#112233" });
    expect(asText(serif("Hi", 0, 0, 100, 20, { color: "#ff0000", fontFamily: "Anton" }))).toMatchObject({ fontFamily: "Anton", color: "#ff0000" });
  });

  it("estimates the height of wrapped text", () => {
    expect(printKit.est("one two three", 1000, 20)).toBe(30);
    expect(printKit.est("one two three four five six seven eight nine ten", 100, 20)).toBeGreaterThan(60);
    expect(printKit.est("a\nb\nc", 1000, 20, 1)).toBe(60);
    expect(printKit.est("", 100, 20)).toBe(30);
    expect(printKit.est("word", 1, 10)).toBe(15);
  });

  it("draws a dotted leader, never running backwards", () => {
    expect(printKit.leader(10, 110, 50, "#000000")).toMatchObject({ type: "line", width: 100, stroke: { style: "dotted", cap: "round", width: 1.6 } });
    expect((printKit.leader(100, 10, 50, "#000000") as { width: number }).width).toBe(0);
  });
});

describe("social kit", () => {
  const known = GRAPHICS[0];

  it("places a library illustration by width, or fails loudly for an unknown id", () => {
    const g = social.gfx(known.id, 5, 6, 200);
    expect(g).toMatchObject({ x: 5, y: 6, width: 200, name: known.name, alt: known.name });
    expect(g.source).toEqual({ kind: known.kind === "sticker" ? "sticker" : "illustration", id: known.id });
    expect(social.gfx(known.id, 0, 0, 200, { h: 33 }).height).toBe(33);
    expect(() => social.gfx("no-such-graphic", 0, 0, 100)).toThrow('social-kit: unknown graphic "no-such-graphic"');
  });

  it("draws recolourable stroke icons and a play glyph", () => {
    const icon = social.icon("check", 1, 2, 48, "#ff0000");
    expect(icon).toMatchObject({ x: 1, y: 2, width: 48, height: 48, name: "Check icon", strokeWidth: 2, source: { kind: "icon", id: "check" } });
    expect(icon.svg).toContain('stroke="#ff0000"');
    expect(icon.svg).toContain('fill="none"');
    const heavy = social.icon("arrowRight", 0, 0, 24, "#000000", { stroke: 4, fillColor: "#00ff00" });
    expect(heavy.name).toBe("Arrow right icon");
    expect(heavy.strokeWidth).toBe(4);
    expect(heavy.svg).toContain('fill="#00ff00"');
    const play = social.playGlyph(0, 0, 40, "#ffffff");
    expect(play).toMatchObject({ name: "Play", source: { kind: "icon", id: "play" }, width: 40 });
    expect(social.playGlyph(0, 0, 40, "#ffffff", { name: "Start" }).name).toBe("Start");
  });

  it("builds rich text from strings and styled runs", () => {
    expect(social.run("x", { italic: true })).toEqual({ text: "x", italic: true });
    expect(social.para("Be ", social.run("gentle", { bold: true }))).toEqual({ runs: [{ text: "Be " }, { text: "gentle", bold: true }] });
    const rt = social.RT([social.para("a")], 1, 2, 300, 30);
    expect(rt).toMatchObject({ x: 1, y: 2, width: 300, fontSize: 30, autoWidth: false, lineHeight: 1.2 });
  });

  it("writes tracked uppercase labels and centred lines", () => {
    expect(social.label("New", 0, 0, 100, 20, "#ff0000")).toMatchObject({ textCase: "upper", letterSpacing: 160, fontWeight: 700, color: "#ff0000" });
    const line = social.centered("Hi", 200, 100, 100, 40);
    expect(line).toMatchObject({ x: 150, align: "center" });
    expect(line.y).toBeCloseTo(100 - (40 * 1.2) / 2);
    expect(social.centered("Hi", 200, 100, 100, 40, { lineHeight: 2 }).y).toBe(60);
  });

  it("describes the text effects with sensible defaults", () => {
    expect(social.hardShadow("#000000")).toEqual({ kind: "shadow", color: "#000000", offset: 36.36, direction: 45, blur: 0, transparency: 0 });
    expect(social.hardShadow("#000000", 11, 90)).toMatchObject({ offset: 50, direction: 90 });
    expect(social.softShadow("#000000")).toEqual({ kind: "shadow", color: "#000000", offset: 30, direction: 90, blur: 40, transparency: 60 });
    expect(social.softShadow("#000000", 10, 20)).toMatchObject({ blur: 10, transparency: 20 });
    expect(social.outlineFx("#ff0000")).toEqual({ kind: "outline", color: "#ff0000", thickness: 50 });
    expect(social.outlineFx("#ff0000", 80).thickness).toBe(80);
    expect(social.barFx("#ffff00")).toEqual({ kind: "background", color: "#ffff00", roundness: 40, spread: 30, transparency: 0 });
    expect(social.hollowFx()).toEqual({ kind: "hollow", thickness: 50 });
    expect(social.hollowFx(20).thickness).toBe(20);
  });

  it("draws stars, rows of stars, sparkles and film grain", () => {
    expect(asShape(social.star(10, 20, 30, "#ffcc00"))).toMatchObject({ shape: "star", x: 10, y: 20, width: 30, name: "Star" });
    const row = social.stars(3, 0, 0, 20, 5, "#ffcc00");
    expect(row.map((s) => s.x)).toEqual([0, 25, 50]);
    expect(social.sparkle(100, 100, 40, "#ffffff")).toMatchObject({ shape: "star-4", x: 80, y: 80, name: "Sparkle" });
    const grain = social.grain(400, 300);
    expect(grain).toMatchObject({ opacity: 0.06, locked: true, name: "Grain", width: 400, height: 300 });
    expect(social.grain(10, 10, 0.2).opacity).toBe(0.2);
  });

  it("draws a pill with centred text and optional stroke, shadow, font and capitals", () => {
    const [plain, plainText] = social.pill("Go", 0, 0, 200, 60, "#000000", "#ffffff", 28);
    expect(asShape(plain)).toMatchObject({ radius: 30, name: "Pill" });
    expect(asShape(plain).stroke).toBeNull();
    expect(asText(plainText)).toMatchObject({ fontWeight: 700, color: "#ffffff", textCase: "none", letterSpacing: 0, align: "center" });
    const [fancy, fancyText] = social.pill("Go", 0, 0, 200, 60, null, "#ffffff", 28, { weight: 500, font: "Lora", stroke: "#ff0000", strokeWidth: 5, spacing: 40, upper: true, shadow: social.cardShadow() });
    expect(asShape(fancy)).toMatchObject({ stroke: { color: "#ff0000", width: 5, style: "solid" }, fill: null });
    expect(asShape(fancy).shadow).toEqual({ color: "rgba(20,16,40,0.18)", blur: 40, x: 0, y: 18 });
    expect(asText(fancyText)).toMatchObject({ fontFamily: "Lora", fontWeight: 500, textCase: "upper", letterSpacing: 40 });
    expect(social.cardShadow("#000000", 10, 4)).toEqual({ color: "#000000", blur: 10, x: 0, y: 4 });
  });

  it("turns a set of elements together about a pivot", () => {
    const els = [createShape("rect", { x: 90, y: 40, width: 20, height: 20, rotation: 5 })];
    const [turned] = social.tilt(els, 100, 100, 90);
    // the box centre (100, 50) orbits the pivot (100, 100) by a quarter turn, and the box turns with it
    expect(turned.x + turned.width / 2).toBeCloseTo(150);
    expect(turned.y + turned.height / 2).toBeCloseTo(100);
    expect(turned.rotation).toBe(95);
    expect(els[0].rotation).toBe(5);
  });
});

describe("deck kit", () => {
  it("lays out a twelve column grid", () => {
    expect(deck.X(0)).toBe(96);
    expect(deck.X(1)).toBe(96 + 122 + 24);
    expect(deck.SPAN(1)).toBe(122);
    expect(deck.SPAN(3)).toBe(3 * 122 + 2 * 24);
    expect(deck.RIGHT).toBe(1824);
    // twelve columns end exactly at the right margin
    expect(deck.X(11) + deck.COL).toBe(deck.RIGHT);
  });

  it("puts text on a cap line or a baseline using the metrics of its font, or average ones for an unknown font", () => {
    // unknown font: ascent 1, descent 0.25, cap height 0.7, so a 1.25 line has no half-leading
    expect(deck.capOffset("Unknown", 100, 1.25)).toBeCloseTo(30);
    expect(deck.baseOffset("Unknown", 100, 1.25)).toBeCloseTo(100);
    expect(deck.atCap("Unknown", 100, 1.25, 200)).toBe(170);
    expect(deck.atBase("Unknown", 100, 1.25, 300)).toBe(200);
    // a taller line adds the same space above and below the text
    expect(deck.baseOffset("Unknown", 100, 1.45)).toBeCloseTo(110);
    expect(deck.capOffset("Syne", 100, 1.2)).not.toBeCloseTo(deck.capOffset("Unknown", 100, 1.2), 1);
    expect(deck.blockH(40, 1.25, 3)).toBe(150);
  });

  it("covers a box with a photo around a focal point, without distortion", () => {
    const centred = asImage(deck.photo("ocean-waves", 0, 0, 800, 800));
    expect(centred.src).toBe("builtin:ocean-waves");
    expect([centred.naturalWidth, centred.naturalHeight]).toEqual([1600, 900]);
    expect(centred.crop.w).toBeCloseTo(1600 / 900);
    expect(centred.crop.x).toBeCloseTo((1 - centred.crop.w) / 2);
    const left = asImage(deck.photo("ocean-waves", 0, 0, 800, 800, { fx: 0 }));
    expect(left.crop.x).toBe(0);
    const right = asImage(deck.photo("ocean-waves", 0, 0, 800, 800, { fx: 1 }));
    expect(right.crop.x).toBeCloseTo(1 - right.crop.w);
    const zoomed = asImage(deck.photo("ocean-waves", 0, 0, 800, 800, { zoom: 2 }));
    expect(zoomed.crop.w).toBeCloseTo(centred.crop.w * 2);
  });

  it("assumes a 3:2 photo for an id it does not know", () => {
    const unknown = asImage(deck.photo("no-such-photo", 0, 0, 300, 200));
    expect([unknown.naturalWidth, unknown.naturalHeight]).toEqual([1600, 1067]);
  });

  it("makes a named, labelled drop frame", () => {
    const frame = asImage(deck.frame(1, 2, 300, 200));
    expect(frame).toMatchObject({ isFrame: true, mask: "rect", name: "Photo frame", alt: "Placeholder: drop your photo here" });
    expect(asImage(deck.frame(0, 0, 10, 10, { mask: "ellipse", name: "Portrait" }))).toMatchObject({ mask: "ellipse", name: "Portrait" });
  });

  it("places an illustration by width, or an empty one when the id is unknown", () => {
    const known = GRAPHICS[0];
    const g = deck.gfx(known.id, 0, 0, 200);
    expect(g).toMatchObject({ width: 200, name: known.name });
    expect(g.source).toEqual({ kind: known.kind === "sticker" ? "sticker" : "illustration", id: known.id });
    expect(deck.gfx(known.id, 0, 0, 200, { h: 40 }).height).toBe(40);
    const sticker = GRAPHICS.find((x) => x.kind === "sticker");
    if (sticker) expect(deck.gfx(sticker.id, 0, 0, 100).source?.kind).toBe("sticker");
    const empty = deck.gfx("no-such-graphic", 0, 0, 100);
    expect(empty).toMatchObject({ name: "Illustration", width: 100, height: 100 });
    expect(empty.source).toEqual({ kind: "illustration", id: "no-such-graphic" });
  });

  it("draws a glow that fades to nothing at its rim", () => {
    const glow = asShape(deck.glow(500, 400, 100, "#ff0000", 0.8));
    expect(glow).toMatchObject({ shape: "ellipse", x: 400, y: 300, width: 200, name: "Glow" });
    const fill = glow.fill as { type: string; stops: Array<{ offset: number; color: string }> };
    expect(fill.type).toBe("radial");
    expect(fill.stops[0].color).toBe("rgba(255,0,0,0.8)");
    expect(fill.stops[4].color).toBe("rgba(255,0,0,0)");
    expect((deck.glow(0, 0, 10, "#000000").fill as { stops: Array<{ color: string }> }).stops[0].color).toBe("rgba(0,0,0,0.5)");
  });

  it("builds a gradient of one colour fading in and out", () => {
    expect(deck.vshade([[0, 0], [1, 0.8]])).toEqual({ type: "linear", angle: 180, stops: [{ offset: 0, color: "rgba(0,0,0,0)" }, { offset: 1, color: "rgba(0,0,0,0.8)" }] });
    expect(deck.vshade([[0, 0.5]], "255,0,0", 90)).toMatchObject({ angle: 90, stops: [{ color: "rgba(255,0,0,0.5)" }] });
  });

  it("draws crisp rules and numbers pages with a leading zero", () => {
    expect(asShape(deck.hrule(10, 20, 300, "#000000"))).toMatchObject({ width: 300, height: 2 });
    expect(asShape(deck.hrule(10, 20, 300, "#000000", 5))).toMatchObject({ height: 5 });
    expect(asShape(deck.vrule(10, 20, 300, "#000000"))).toMatchObject({ width: 2, height: 300 });
    expect(asShape(deck.vrule(10, 20, 300, "#000000", 6, { name: "Rule" }))).toMatchObject({ width: 6, name: "Rule" });
    expect(deck.num(3)).toBe("03");
    expect(deck.num(12)).toBe("12");
  });

  it("replaces the text of a box with styled runs, and names slides", () => {
    const box = deck.rich(asText(T("", 0, 0, 100, 20)), [["Plain "], [{ text: "italic", italic: true }]]);
    expect(box.paragraphs).toEqual([{ runs: [{ text: "Plain " }] }, { runs: [{ text: "italic", italic: true }] }]);
    const slide = deck.slide("Cover", "#112233", [], "Notes here");
    expect(slide).toMatchObject({ name: "Cover", notes: "Notes here", background: { type: "solid", color: "#112233" } });
  });

  describe("type setter", () => {
    const cfg = { display: "Syne", text: "Inter", ink: "#111111" };

    it("sets display type on its cap line with tighter tracking for larger sizes", () => {
      const { D } = deck.makeType(cfg);
      const big = asText(D("Hello", 100, 300, 800));
      expect(big).toMatchObject({ fontFamily: "Syne", fontSize: 120, fontWeight: 800, lineHeight: 1, letterSpacing: -20, color: "#111111", x: 100, width: 800 });
      expect(big.y).toBe(deck.atCap("Syne", 120, 1, 300));
      expect(asText(D("Hello", 100, 300, 800, 60)).letterSpacing).toBe(-10);
      expect(asText(D("Hello", 100, 300, 800, 100)).letterSpacing).toBe(-20);
    });

    it("lets the deck choose weight, line height and tracking, and a call override them", () => {
      const { D } = deck.makeType({ ...cfg, displayWeight: 500, displayLh: 1.1, tracking: (s) => s / 10 });
      expect(asText(D("Hi", 0, 0, 100, 80))).toMatchObject({ fontWeight: 500, lineHeight: 1.1, letterSpacing: 8 });
      expect(asText(D("Hi", 0, 0, 100, 80, { lineHeight: 1.4, color: "#ff0000" }))).toMatchObject({ lineHeight: 1.4, color: "#ff0000" });
    });

    it("sets tracked capital labels on their cap line", () => {
      const { LBL } = deck.makeType(cfg);
      const label = asText(LBL("Intro", 10, 200, 300));
      expect(label).toMatchObject({ fontFamily: "Inter", fontSize: 26, fontWeight: 700, letterSpacing: 160, textCase: "upper", color: "#111111" });
      expect(label.y).toBe(deck.atCap("Inter", 26, 1.2, 200));
      const custom = deck.makeType({ ...cfg, labelWeight: 500, labelTracking: 80 }).LBL("Intro", 10, 200, 300, "#ff0000", { fontSize: 20 });
      expect(asText(custom)).toMatchObject({ fontWeight: 500, letterSpacing: 80, color: "#ff0000", fontSize: 20 });
    });

    it("sets running text from its top edge", () => {
      const { B } = deck.makeType(cfg);
      const body = asText(B("Words", 10, 400, 500));
      expect(body).toMatchObject({ y: 400, fontSize: 28, fontWeight: 400, lineHeight: 1.5, fontFamily: "Inter", color: "#111111" });
      const custom = deck.makeType({ ...cfg, textWeight: 300, bodyLh: 1.3 }).B("Words", 10, 400, 500, "#ff0000");
      expect(asText(custom)).toMatchObject({ fontWeight: 300, lineHeight: 1.3, color: "#ff0000" });
    });
  });
});
