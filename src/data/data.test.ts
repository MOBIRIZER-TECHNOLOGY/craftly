import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { parseColor } from "@/core/color";
import type { GradientStop, ImageFilter, PatternKind } from "@/core/types";
import {
  BACKGROUND_GROUPS,
  BACKGROUND_PRESETS,
  GRADIENT_BACKGROUNDS,
  PATTERN_BACKGROUNDS,
  PHOTO_BACKGROUND_IDS,
  SOLID_BACKGROUNDS,
} from "./backgrounds";
import { ADJUSTMENTS, FILTER_PRESETS, getFilterPreset } from "./filters";
import {
  COLOR_NAMES,
  COLOR_PALETTES,
  DEFAULT_GRADIENTS,
  DEFAULT_SOLID_COLORS,
  nameOfColor,
  searchColors,
} from "./palettes";
import { PHOTOS, drawPhoto, getPhotoDef, getPhotoImage } from "./photos";

const HEX = /^#[0-9a-f]{6}$/;
const validColor = (c: string) => parseColor(c) !== null;
const unique = <T>(xs: T[]) => new Set(xs).size === xs.length;

function expectGradientStops(stops: GradientStop[]) {
  expect(stops.length).toBeGreaterThanOrEqual(2);
  for (const s of stops) {
    expect(s.offset).toBeGreaterThanOrEqual(0);
    expect(s.offset).toBeLessThanOrEqual(1);
    expect(validColor(s.color)).toBe(true);
  }
  for (let i = 1; i < stops.length; i++) expect(stops[i].offset).toBeGreaterThanOrEqual(stops[i - 1].offset);
  expect(stops[0].offset).toBe(0);
  expect(stops[stops.length - 1].offset).toBe(1);
}

describe("palettes", () => {
  it("has a 7 x 4 grid of default solid colours", () => {
    expect(DEFAULT_SOLID_COLORS).toHaveLength(28);
    expect(unique(DEFAULT_SOLID_COLORS)).toBe(true);
    for (const c of DEFAULT_SOLID_COLORS) expect(c).toMatch(HEX);
    // row 1 runs from black to white
    expect(DEFAULT_SOLID_COLORS[0]).toBe("#000000");
    expect(DEFAULT_SOLID_COLORS[6]).toBe("#ffffff");
  });

  it("has at least 21 valid default gradients", () => {
    expect(DEFAULT_GRADIENTS.length).toBeGreaterThanOrEqual(21);
    for (const g of DEFAULT_GRADIENTS) {
      expect(g.type).toBe("linear");
      expect(Number.isFinite(g.angle)).toBe(true);
      expectGradientStops(g.stops);
    }
    expect(DEFAULT_GRADIENTS.some((g) => g.stops.length === 2)).toBe(true);
    expect(DEFAULT_GRADIENTS.some((g) => g.stops.length === 3)).toBe(true);
  });

  it("has at least 36 named five-colour palettes", () => {
    expect(COLOR_PALETTES.length).toBeGreaterThanOrEqual(36);
    expect(unique(COLOR_PALETTES.map((p) => p.id))).toBe(true);
    expect(unique(COLOR_PALETTES.map((p) => p.name))).toBe(true);
    for (const p of COLOR_PALETTES) {
      expect(p.name.length).toBeGreaterThan(2);
      expect(p.colors).toHaveLength(5);
      for (const c of p.colors) expect(c).toMatch(HEX);
    }
    expect(COLOR_PALETTES.some((p) => p.name === "Sunset market")).toBe(true);
    expect(COLOR_PALETTES.some((p) => p.name === "Sea glass")).toBe(true);
  });

  it("names colours", () => {
    const cases: Record<string, string> = {
      "#ff0000": "red",
      "#ffa500": "orange",
      "#ffff00": "yellow",
      "#00ff00": "green",
      "#008080": "teal",
      "#0000ff": "blue",
      "#800080": "purple",
      "#ffc0cb": "pink",
      "#8b4513": "brown",
      "#808080": "grey",
      "#000000": "black",
      "#ffffff": "white",
    };
    for (const [hex, name] of Object.entries(cases)) expect(nameOfColor(hex), hex).toBe(name);
    for (const c of DEFAULT_SOLID_COLORS) expect(COLOR_NAMES).toContain(nameOfColor(c));
    expect(nameOfColor("not a colour")).toBe("grey");
  });

  it("searches by colour name", () => {
    for (const name of COLOR_NAMES) {
      const found = searchColors(name);
      expect(found.length, name).toBeGreaterThan(5);
      expect(unique(found), name).toBe(true);
      for (const c of found) expect(c, name).toMatch(HEX);
    }
    // names agree with the classifier for the curated swatches at the front
    const blues = searchColors("Blue");
    expect(blues).toContain("#3b82f6");
    expect(searchColors("  RED ")).toContain("#ff3131");
    // prefixes and aliases
    expect(searchColors("gre").length).toBeGreaterThan(searchColors("green").length - 1);
    expect(searchColors("gray")).not.toHaveLength(0);
    expect(searchColors("navy")).not.toHaveLength(0);
    // nonsense
    expect(searchColors("")).toEqual([]);
    expect(searchColors("zzzz")).toEqual([]);
    expect(searchColors("x")).toEqual([]);
  });

  it("searches by hex", () => {
    expect(searchColors("#FF0000")[0]).toBe("#ff0000");
    expect(searchColors("ff8800")[0]).toBe("#ff8800");
    expect(searchColors("#f80")[0]).toBe("#ff8800");
    expect(searchColors("#12")).toEqual([]);
    expect(searchColors("#ggg")).toEqual([]);
    // a bare three-letter hex-looking word is not a colour
    expect(searchColors("bad")).toEqual([]);
    for (const c of searchColors("#3b82f6")) expect(c).toMatch(HEX);
  });
});

describe("backgrounds", () => {
  it("has at least 36 distinct solid colours", () => {
    expect(SOLID_BACKGROUNDS.length).toBeGreaterThanOrEqual(36);
    expect(unique(SOLID_BACKGROUNDS)).toBe(true);
    for (const c of SOLID_BACKGROUNDS) expect(c).toMatch(HEX);
  });

  it("has at least 30 valid gradients", () => {
    expect(GRADIENT_BACKGROUNDS.length).toBeGreaterThanOrEqual(30);
    for (const g of GRADIENT_BACKGROUNDS) {
      expect(g.type).toBe("linear");
      expect(g.angle).toBeGreaterThanOrEqual(0);
      expect(g.angle).toBeLessThanOrEqual(360);
      expectGradientStops(g.stops);
    }
  });

  it("has at least 24 patterns covering every pattern kind", () => {
    const kinds: PatternKind[] = ["dots", "grid", "lines", "diagonal", "checker", "waves", "zigzag", "plus", "bubbles", "noise"];
    expect(PATTERN_BACKGROUNDS.length).toBeGreaterThanOrEqual(24);
    for (const k of kinds) expect(PATTERN_BACKGROUNDS.filter((p) => p.pattern === k).length, k).toBeGreaterThanOrEqual(2);
    for (const p of PATTERN_BACKGROUNDS) {
      expect(p.type).toBe("pattern");
      expect(kinds).toContain(p.pattern);
      expect(validColor(p.color)).toBe(true);
      expect(validColor(p.background)).toBe(true);
      expect(p.color).not.toBe(p.background);
      expect(p.scale).toBeGreaterThanOrEqual(0.4);
      expect(p.scale).toBeLessThanOrEqual(4);
    }
  });

  it("only references photos that exist", () => {
    expect(PHOTO_BACKGROUND_IDS.length).toBeGreaterThanOrEqual(12);
    expect(unique(PHOTO_BACKGROUND_IDS)).toBe(true);
    for (const id of PHOTO_BACKGROUND_IDS) expect(getPhotoDef(id), id).toBeDefined();
  });

  it("merges everything into uniquely named presets and groups", () => {
    expect(unique(BACKGROUND_PRESETS.map((p) => p.id))).toBe(true);
    for (const p of BACKGROUND_PRESETS) {
      expect(p.name.trim().length).toBeGreaterThan(0);
      expect(p.id).toMatch(/^bg-[a-z0-9-]+$/);
    }
    expect(BACKGROUND_GROUPS.map((g) => g.label)).toEqual(["Solid colours", "Gradients", "Patterns", "Photos & textures"]);
    expect(unique(BACKGROUND_GROUPS.map((g) => g.id))).toBe(true);
    expect(BACKGROUND_GROUPS.flatMap((g) => g.presets)).toHaveLength(BACKGROUND_PRESETS.length);
    const [solid, gradient, pattern, photo] = BACKGROUND_GROUPS;
    expect(solid.presets).toHaveLength(SOLID_BACKGROUNDS.length);
    expect(gradient.presets).toHaveLength(GRADIENT_BACKGROUNDS.length);
    expect(pattern.presets).toHaveLength(PATTERN_BACKGROUNDS.length);
    expect(photo.presets).toHaveLength(PHOTO_BACKGROUND_IDS.length);
    expect(solid.presets.every((p) => p.fill.type === "solid")).toBe(true);
    expect(gradient.presets.every((p) => p.fill.type === "linear")).toBe(true);
    expect(pattern.presets.every((p) => p.fill.type === "pattern")).toBe(true);
    for (const p of photo.presets) {
      expect(p.fill.type).toBe("image");
      if (p.fill.type === "image") expect(p.fill.src).toMatch(/^builtin:/);
    }
  });
});

describe("filters", () => {
  const NUMERIC = ["brightness", "contrast", "saturation", "warmth", "fade", "vignette", "blur", "hue", "highlights", "shadows", "sharpen", "tint", "curves", "levels"] as const;
  const ALLOWED = new Set<string>([...NUMERIC, "duotone"]);

  it("starts with `none` and has at least 14 unique presets", () => {
    expect(FILTER_PRESETS[0].id).toBe("none");
    expect(Object.keys(FILTER_PRESETS[0].patch)).toHaveLength(0);
    expect(FILTER_PRESETS.length).toBeGreaterThanOrEqual(14);
    expect(unique(FILTER_PRESETS.map((p) => p.id))).toBe(true);
    expect(unique(FILTER_PRESETS.map((p) => p.name))).toBe(true);
    for (const name of ["Fresco", "Belvedere", "Flamingo", "Juno", "Mono", "Noir", "Heritage", "Vintage fade", "Cool", "Warm", "Dramatic", "Soft", "Vivid"]) {
      expect(FILTER_PRESETS.some((p) => p.name === name), name).toBe(true);
    }
    expect(FILTER_PRESETS.filter((p) => p.patch.duotone).length).toBeGreaterThanOrEqual(2);
  });

  it("only patches valid ImageFilter fields within slider ranges", () => {
    const sample: ImageFilter = { preset: "x", intensity: 100, brightness: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0, vignette: 0, blur: 0, hue: 0 };
    for (const p of FILTER_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9-]+$/);
      for (const [key, value] of Object.entries(p.patch)) {
        expect(ALLOWED.has(key), `${p.id}.${key}`).toBe(true);
        expect(key in sample || key === "duotone").toBe(true);
        if (key === "duotone") {
          const d = value as { dark: string; light: string };
          expect(validColor(d.dark)).toBe(true);
          expect(validColor(d.light)).toBe(true);
        } else {
          const adj = ADJUSTMENTS.find((a) => a.key === key)!;
          expect(value as number, `${p.id}.${key}`).toBeGreaterThanOrEqual(adj.min);
          expect(value as number, `${p.id}.${key}`).toBeLessThanOrEqual(adj.max);
        }
      }
      if (p.id !== "none") expect(Object.keys(p.patch).length, p.id).toBeGreaterThan(0);
    }
    expect(getFilterPreset("noir")?.name).toBe("Noir");
    expect(getFilterPreset("nope")).toBeUndefined();
  });

  it("describes the adjust sliders", () => {
    expect(ADJUSTMENTS.map((a) => a.key)).toEqual([...NUMERIC]);
    for (const a of ADJUSTMENTS) {
      expect(a.label.length).toBeGreaterThan(2);
      expect(a.min).toBeLessThan(a.max);
      expect(a.step).toBeGreaterThan(0);
      expect(a.default).toBeGreaterThanOrEqual(a.min);
      expect(a.default).toBeLessThanOrEqual(a.max);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Photos                                                             */
/* ------------------------------------------------------------------ */

const RESERVED_FALLBACK = [
  "sunset-hills", "ocean-waves", "mountain-lake", "desert-dunes", "forest-mist", "aurora-night", "tropical-beach", "snowy-peaks", "rolling-fields", "canyon-glow",
  "city-night", "city-dawn", "glass-towers",
  "mesh-sunrise", "mesh-ocean", "mesh-candy", "mesh-forest", "mesh-midnight", "liquid-purple", "neon-grid", "soft-blobs",
  "paper-cream", "marble-white", "concrete-gray", "linen-beige", "terrazzo",
  "palm-leaves", "monstera", "wildflowers", "bokeh-gold", "water-ripples",
  "nebula", "starfield",
];

/** The ids reserved in docs/DESIGN.md section 6.6 (falls back to the embedded list when the doc is not around). */
function reservedFromDoc(): string[] {
  const path = resolve(__dirname, "../../docs/DESIGN.md");
  if (!existsSync(path)) return [];
  const text = readFileSync(path, "utf8");
  const from = text.indexOf("6.6 Reserved procedural photo ids");
  if (from < 0) return [];
  const to = text.indexOf("\n## ", from);
  const section = text.slice(from, to < 0 ? undefined : to);
  const ids: string[] = [];
  for (const line of section.split("\n")) {
    const m = /^[A-Za-z ]+:\s*(.+)$/.exec(line.trim());
    if (m) ids.push(...m[1].replace(/`/g, " ").split(/\s+/).filter((s) => /^[a-z0-9-]+$/.test(s)));
  }
  return ids;
}

describe("photos", () => {
  const CATEGORIES = ["landscape", "city", "abstract", "texture", "nature", "space"];

  it("lists every reserved id exactly once", () => {
    const ids = PHOTOS.map((p) => p.id);
    expect(unique(ids)).toBe(true);
    for (const id of RESERVED_FALLBACK) expect(ids, id).toContain(id);
    const fromDoc = reservedFromDoc();
    for (const id of fromDoc) expect(ids, `docs/DESIGN.md 6.6: ${id}`).toContain(id);
    if (fromDoc.length) expect(fromDoc.length).toBeGreaterThanOrEqual(RESERVED_FALLBACK.length);
    expect(PHOTOS.length).toBeGreaterThanOrEqual(RESERVED_FALLBACK.length + 8);
  });

  it("has sane metadata", () => {
    for (const p of PHOTOS) {
      expect(p.id, p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(p.name.trim().length).toBeGreaterThan(2);
      expect(CATEGORIES).toContain(p.category);
      expect(p.tags.length, p.id).toBeGreaterThanOrEqual(3);
      for (const t of p.tags) expect(t).toBe(t.toLowerCase());
      expect(Number.isInteger(p.width) && p.width > 0).toBe(true);
      expect(Number.isInteger(p.height) && p.height > 0).toBe(true);
      const aspect = p.width / p.height;
      expect(aspect, p.id).toBeGreaterThan(0.5);
      expect(aspect, p.id).toBeLessThan(2.2);
      expect(getPhotoDef(p.id)).toBe(p);
    }
    for (const c of CATEGORIES) expect(PHOTOS.some((p) => p.category === c), c).toBe(true);
    // a healthy mix of formats
    const aspects = new Set(PHOTOS.map((p) => (p.width / p.height).toFixed(2)));
    expect(aspects.size).toBeGreaterThanOrEqual(3);
  });

  it("rejects unknown ids and paints a placeholder instead of throwing", async () => {
    expect(getPhotoDef("nope")).toBeUndefined();
    await expect(getPhotoImage("nope")).rejects.toThrow(/Unknown builtin photo/);
    const rec = recordingContext();
    expect(() => drawPhoto(rec.ctx as unknown as CanvasRenderingContext2D, "nope", 40, 30)).not.toThrow();
    expect(rec.log.some((l) => l.startsWith("fillRect"))).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* Painters run against a recording fake canvas (no pixels in node)   */
/* ------------------------------------------------------------------ */

const fmt = (v: unknown): string => {
  if (typeof v === "number") return String(Math.round(v * 100) / 100);
  if (typeof v === "string") return v;
  return typeof v;
};

function recordingContext(log: string[] = []) {
  const state: Record<string, unknown> = {
    globalAlpha: 1,
    globalCompositeOperation: "source-over",
    shadowBlur: 0,
    shadowOffsetX: 0,
    shadowOffsetY: 0,
    filter: "none",
  };
  const ctx: unknown = new Proxy(
    {},
    {
      get(_t, prop: string) {
        if (prop in state) return state[prop];
        if (prop === "createImageData") return (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) });
        if (prop === "getTransform") return () => ({ a: 1, b: 0, c: 0, d: 1 });
        if (prop === "createLinearGradient" || prop === "createRadialGradient" || prop === "createPattern") {
          return (...args: unknown[]) => {
            log.push(`${prop}(${args.map(fmt).join(",")})`);
            return { addColorStop: (o: number, c: string) => log.push(`stop(${fmt(o)},${c})`) };
          };
        }
        return (...args: unknown[]) => {
          log.push(`${prop}(${args.map(fmt).join(",")})`);
        };
      },
      set(_t, prop: string, value: unknown) {
        state[prop] = value;
        if (typeof value === "number" || typeof value === "string") log.push(`set ${prop}=${fmt(value)}`);
        return true;
      },
    },
  );
  return { ctx, log };
}

describe("photo painters", () => {
  const g = globalThis as unknown as { document?: unknown };
  const saved = g.document;
  beforeAll(() => {
    g.document = {
      createElement: () => {
        const rec = recordingContext();
        return { width: 0, height: 0, getContext: () => rec.ctx };
      },
    };
  });
  afterAll(() => {
    g.document = saved;
  });

  const run = (id: string, w: number, h: number) => {
    const rec = recordingContext();
    drawPhoto(rec.ctx as unknown as CanvasRenderingContext2D, id, w, h);
    return rec.log;
  };

  it("every photo paints without errors and is deterministic", () => {
    for (const p of PHOTOS) {
      const w = 96;
      const h = Math.round((96 * p.height) / p.width);
      const a = run(p.id, w, h);
      const b = run(p.id, w, h);
      expect(a.length, p.id).toBeGreaterThan(10);
      expect(b, p.id).toEqual(a);
    }
  });

  it("keeps the caller's context state balanced", () => {
    const log = run("sunset-hills", 80, 60);
    const saves = log.filter((l) => l === "save()").length;
    const restores = log.filter((l) => l === "restore()").length;
    expect(saves).toBe(restores);
  });
});
