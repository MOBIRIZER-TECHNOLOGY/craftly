import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { contrastRatio, hexToHsv } from "@/core/color";
import { DEFAULT_FONT, paragraphsToText, textPresetSizes } from "@/core/factory";
import type { TextElement } from "@/core/types";
import { TEXT_COMBOS } from "@/data/textCombos";
import { TEXT_STYLE_PRESETS } from "@/data/textStyles";
import { FONT_CATALOG, cssFontFamily, ensureFont, fontsEpoch, getFontDef, isFontReady, preloadFonts, snapWeight } from "./fonts";
import type { FontCategory, FontDef } from "./fonts";

const projectRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const readProjectFile = (path: string) => readFileSync(join(projectRoot, path), "utf8");

const slug = (family: string) => family.toLowerCase().replace(/\s+/g, "-");
const packageName = (def: FontDef) => `${def.variable ? "@fontsource-variable" : "@fontsource"}/${slug(def.family)}`;

const CATEGORIES: FontCategory[] = ["sans", "serif", "display", "script", "handwriting", "mono"];

function def(family: string): FontDef {
  const found = getFontDef(family);
  if (!found) throw new Error(`${family} is not in the catalogue`);
  return found;
}

describe("font catalogue", () => {
  it("covers exactly the fontsource packages listed in package.json", () => {
    const dependencies = Object.keys(JSON.parse(readProjectFile("package.json")).dependencies as Record<string, string>);
    const installed = dependencies.filter((name) => name.startsWith("@fontsource")).sort();
    expect(FONT_CATALOG.map(packageName).sort()).toEqual(installed);
  });

  it("has unique, trimmed, non-empty family names and starts with the default font", () => {
    const families = FONT_CATALOG.map((font) => font.family);
    expect(new Set(families).size).toBe(families.length);
    for (const family of families) expect(family).toBe(family.trim());
    expect(families.every((family) => family.length > 0)).toBe(true);
    expect(FONT_CATALOG[0].family).toBe(DEFAULT_FONT);
  });

  it("describes every font consistently", () => {
    for (const font of FONT_CATALOG) {
      expect(CATEGORIES, font.family).toContain(font.category);
      expect(font.weights.length, font.family).toBeGreaterThan(0);
      expect(font.weights, font.family).toEqual([...font.weights].sort((a, b) => a - b));
      expect(
        font.weights.every((w) => w >= 100 && w <= 900 && w % 100 === 0),
        font.family,
      ).toBe(true);
      expect(font.css, font.family).toBe(font.variable ? `${font.family} Variable` : font.family);
      if (!font.variable) {
        expect(font.weights[0], font.family).toBe(400);
        expect(
          font.weights.every((w) => w === 400 || w === 700),
          font.family,
        ).toBe(true);
      }
    }
  });

  it("uses every category", () => {
    for (const category of CATEGORIES)
      expect(
        FONT_CATALOG.some((font) => font.category === category),
        category,
      ).toBe(true);
  });

  it("registers the family names the fontsource CSS declares", () => {
    for (const font of FONT_CATALOG) {
      expect(readProjectFile(`node_modules/${packageName(font)}/index.css`), font.family).toContain(`font-family: '${font.css}'`);
    }
  });
});

describe("getFontDef and cssFontFamily", () => {
  it("looks families up by exact display name", () => {
    expect(getFontDef("Playfair Display")?.css).toBe("Playfair Display Variable");
    expect(getFontDef("Bebas Neue")?.variable).toBe(false);
    expect(getFontDef("playfair display")).toBeUndefined();
    expect(getFontDef("Comic Sans MS")).toBeUndefined();
  });

  it("builds the CSS family list with the stored name as a fallback", () => {
    expect(cssFontFamily("Plus Jakarta Sans")).toBe('"Plus Jakarta Sans Variable", "Plus Jakarta Sans", sans-serif');
    expect(cssFontFamily("Poppins")).toBe('"Poppins", sans-serif');
  });

  it("picks the generic fallback from the category", () => {
    expect(cssFontFamily("Playfair Display")).toMatch(/, serif$/);
    expect(cssFontFamily("Bungee")).toMatch(/, sans-serif$/);
    expect(cssFontFamily("Great Vibes")).toMatch(/, cursive$/);
    expect(cssFontFamily("Caveat")).toMatch(/, cursive$/);
    expect(cssFontFamily("JetBrains Mono")).toMatch(/, monospace$/);
  });

  it("falls back to sans-serif for unknown families and escapes quotes", () => {
    expect(cssFontFamily("Comic Sans MS")).toBe('"Comic Sans MS", sans-serif');
    expect(cssFontFamily('Odd "name"')).toBe('"Odd \\"name\\"", sans-serif');
  });
});

describe("snapWeight", () => {
  it("snaps static fonts to the nearest bundled weight, a tie going to the bolder one", () => {
    const poppins = def("Poppins");
    expect([100, 399, 400, 500, 549].map((w) => snapWeight(poppins, w))).toEqual([400, 400, 400, 400, 400]);
    expect([550, 600, 700, 800, 900].map((w) => snapWeight(poppins, w))).toEqual([700, 700, 700, 700, 700]);
  });

  it("always returns 400 for fonts with a single weight", () => {
    expect([100, 400, 700, 900].map((w) => snapWeight(def("Anton"), w))).toEqual([400, 400, 400, 400]);
  });

  it("clamps variable fonts to their range and keeps in-between weights", () => {
    const jakarta = def("Plus Jakarta Sans");
    expect(snapWeight(jakarta, 100)).toBe(200);
    expect(snapWeight(jakarta, 450)).toBe(450);
    expect(snapWeight(jakarta, 900)).toBe(800);
    expect(snapWeight(def("Inter"), 1000)).toBe(900);
  });

  it("treats a non-finite weight as regular", () => {
    expect(snapWeight(def("Poppins"), Number.NaN)).toBe(400);
    expect(snapWeight(def("Inter"), Number.POSITIVE_INFINITY)).toBe(400);
  });
});

describe("without a DOM", () => {
  it("resolves immediately and reports every font as ready", async () => {
    const before = fontsEpoch();
    await expect(ensureFont("Inter", 700, true)).resolves.toBeUndefined();
    await expect(ensureFont("Not A Real Font")).resolves.toBeUndefined();
    await expect(preloadFonts(["Inter", "Poppins"])).resolves.toBeUndefined();
    expect(isFontReady("Inter", 700, true)).toBe(true);
    expect(isFontReady("Not A Real Font")).toBe(true);
    expect(fontsEpoch()).toBe(before);
  });
});

/* ------------------------------------------------------------------ */
/* Loading, against a fake FontFace / document                        */
/* ------------------------------------------------------------------ */

class FakeFontFace {
  static failing = new Set<string>();

  constructor(
    readonly family: string,
    readonly source: string,
    readonly descriptors: FontFaceDescriptors,
  ) {}

  load(): Promise<this> {
    return FakeFontFace.failing.has(this.family) ? Promise.reject(new Error("network error")) : Promise.resolve(this);
  }
}

/** A fresh copy of the module (its caches are module state) running against the fake DOM. */
async function loadFontsModule() {
  vi.resetModules();
  const added: FakeFontFace[] = [];
  vi.stubGlobal("document", { fonts: { add: (face: FakeFontFace) => added.push(face) } });
  vi.stubGlobal("FontFace", FakeFontFace);
  return { fonts: await import("./fonts"), added };
}

/** The `font-weight` range declared by a variable font's CSS, e.g. "200 800". */
function cssWeightRange(def: FontDef, style: "normal" | "italic"): string {
  const css = readProjectFile(`node_modules/${packageName(def)}/wght${style === "italic" ? "-italic" : ""}.css`);
  const match = /font-weight:\s*(\d+ \d+);/.exec(css);
  if (!match) throw new Error(`no weight range in the ${style} CSS of ${def.family}`);
  return match[1];
}

/**
 * True when a face was registered from the woff2 file its descriptors call for
 * (`<name>-latin-wght-<style>` for variable fonts, `<name>-latin-<weight>-<style>` for static ones)
 * and that file exists on disk.
 */
function isExpectedFile(font: FontDef, face: FakeFontFace): boolean {
  const axis = font.variable ? "wght" : face.descriptors.weight;
  const fileName = `${slug(font.family)}-latin-${axis}-${face.descriptors.style}.woff2`;
  const url = /^url\("(.*)"\)$/.exec(face.source)?.[1];
  return url !== undefined && url.endsWith(`/${fileName}`) && existsSync(join(projectRoot, url.replace(/^\/@fs\//, "").replace(/^\//, "")));
}

const byWeight = (a: number, b: number) => a - b;

describe("loading faces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    FakeFontFace.failing.clear();
  });

  it("registers the italic face of a variable font under its CSS name and weight range", async () => {
    const { fonts, added } = await loadFontsModule();
    await fonts.ensureFont("Inter", 600, true);
    expect(added).toHaveLength(1);
    expect(added[0].family).toBe("Inter Variable");
    expect(added[0].descriptors).toEqual({ weight: "100 900", style: "italic" });
    expect(added[0].source).toMatch(/inter-latin-wght-italic\.woff2"\)$/);
  });

  it("loads the bundled weight nearest to the request for static fonts", async () => {
    const { fonts, added } = await loadFontsModule();
    await fonts.ensureFont("Poppins", 650);
    expect(added.map((face) => face.descriptors)).toEqual([{ weight: "700", style: "normal" }]);
    expect(added[0].source).toMatch(/poppins-latin-700-normal\.woff2"\)$/);
  });

  it("uses the upright face when no italic exists", async () => {
    const { fonts, added } = await loadFontsModule();
    await fonts.ensureFont("Bebas Neue", 400, true);
    expect(added.map((face) => face.descriptors)).toEqual([{ weight: "400", style: "normal" }]);
  });

  it("loads each face once, however often and however it is asked for", async () => {
    const { fonts, added } = await loadFontsModule();
    await Promise.all([fonts.ensureFont("Inter"), fonts.ensureFont("Inter", 500), fonts.ensureFont("Inter", 900), fonts.preloadFonts(["Inter"])]);
    await fonts.ensureFont("Inter", 300);
    expect(added.filter((face) => face.descriptors.style === "normal")).toHaveLength(1);
  });

  it("tracks readiness, the epoch and subscribers", async () => {
    const { fonts } = await loadFontsModule();
    const listener = vi.fn();
    const stop = fonts.onFontsChange(listener);
    const pending = fonts.ensureFont("Lora", 700);
    expect(fonts.isFontReady("Lora", 700)).toBe(false);
    expect(fonts.isFontReady("Lora", 700, true)).toBe(false);
    expect(fonts.fontsEpoch()).toBe(0);

    await pending;
    expect(fonts.isFontReady("Lora", 500)).toBe(true);
    expect(fonts.isFontReady("Lora", 700, true)).toBe(false);
    expect(fonts.fontsEpoch()).toBe(1);
    expect(listener).toHaveBeenCalledTimes(1);

    await fonts.ensureFont("Lora", 600);
    expect(listener).toHaveBeenCalledTimes(1);

    stop();
    await fonts.ensureFont("Lora", 400, true);
    expect(fonts.fontsEpoch()).toBe(2);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("keeps notifying the other subscribers when one throws", async () => {
    const { fonts } = await loadFontsModule();
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const survivor = vi.fn();
    fonts.onFontsChange(() => {
      throw new Error("bad subscriber");
    });
    fonts.onFontsChange(survivor);
    await fonts.ensureFont("Inter");
    expect(survivor).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("never rejects: a failed load is logged, settles the face and is not retried", async () => {
    const { fonts, added } = await loadFontsModule();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const listener = vi.fn();
    fonts.onFontsChange(listener);
    FakeFontFace.failing.add("Anton");

    await expect(fonts.ensureFont("Anton")).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(added).toHaveLength(0);
    expect(fonts.isFontReady("Anton")).toBe(true);
    expect(fonts.fontsEpoch()).toBe(0);
    expect(listener).not.toHaveBeenCalled();

    await fonts.ensureFont("Anton");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("preloads every weight and style of the requested families and skips unknown ones", async () => {
    const { fonts, added } = await loadFontsModule();
    await fonts.preloadFonts(["Poppins", "Nothing Here", "Pacifico"]);
    const loaded = added.map((face) => `${face.family}:${face.descriptors.weight}:${face.descriptors.style}`).sort();
    expect(loaded).toEqual(["Pacifico:400:normal", "Poppins:400:italic", "Poppins:400:normal", "Poppins:700:italic", "Poppins:700:normal"]);
  });

  it("backs every catalogue family with real woff2 files that match its definition", async () => {
    const { fonts, added } = await loadFontsModule();
    await fonts.preloadFonts(FONT_CATALOG.map((font) => font.family));

    for (const font of FONT_CATALOG) {
      const faces = added.filter((face) => face.family === font.css);
      const upright = faces.filter((face) => face.descriptors.style === "normal");
      const italic = faces.filter((face) => face.descriptors.style === "italic");
      expect(upright.length, `${font.family} upright faces`).toBeGreaterThan(0);
      expect(italic.length > 0, `${font.family} italic faces`).toBe(font.italic);

      if (font.variable) {
        expect(
          upright.map((face) => face.descriptors.weight),
          font.family,
        ).toEqual([cssWeightRange(font, "normal")]);
        if (font.italic)
          expect(
            italic.map((face) => face.descriptors.weight),
            font.family,
          ).toEqual([cssWeightRange(font, "italic")]);
      } else {
        expect(upright.map((face) => Number(face.descriptors.weight)).sort(byWeight), font.family).toEqual(font.weights);
        if (font.italic) expect(italic.map((face) => Number(face.descriptors.weight)).sort(byWeight), font.family).toEqual(font.weights);
      }
      for (const face of faces) expect(isExpectedFile(font, face), `${font.family}: ${face.source}`).toBe(true);
    }
  });
});

/* ------------------------------------------------------------------ */
/* Text combinations and style presets (src/data/textCombos.ts, textStyles.ts) */
/* ------------------------------------------------------------------ */

const DESIGN_SIZES = [
  { width: 1920, height: 1080 },
  { width: 1080, height: 1350 },
];

function boundsOf(elements: TextElement[]) {
  const left = Math.min(...elements.map((el) => el.x));
  const top = Math.min(...elements.map((el) => el.y));
  const right = Math.max(...elements.map((el) => el.x + el.width));
  const bottom = Math.max(...elements.map((el) => el.y + el.height));
  return { left, top, width: right - left, height: bottom - top };
}

/** Positions and sizes of a build, without the random ids, so two builds can be compared. */
const geometryOf = (elements: TextElement[]) => elements.map(({ x, y, width, height, fontSize, rotation }) => ({ x, y, width, height, fontSize, rotation }));

/** Saturated and bright enough to be the accent colour, as opposed to ink or a soft grey. */
function isAccent(color: string): boolean {
  const { s, v } = hexToHsv(color);
  return s >= 0.45 && v >= 0.45;
}

describe("text combinations", () => {
  it("offers at least 18 distinctly named combinations", () => {
    expect(TEXT_COMBOS.length).toBeGreaterThanOrEqual(18);
    for (const key of ["id", "name"] as const) {
      const values = TEXT_COMBOS.map((combo) => combo[key]);
      expect(new Set(values).size, key).toBe(values.length);
      expect(
        values.every((value) => value.trim().length > 0),
        key,
      ).toBe(true);
    }
  });

  it.each(DESIGN_SIZES)("builds two to four fixed-width text boxes for a $width x $height design", (size) => {
    for (const combo of TEXT_COMBOS) {
      const elements = combo.build(size);
      expect(elements.length, combo.id).toBeGreaterThanOrEqual(2);
      expect(elements.length, combo.id).toBeLessThanOrEqual(4);
      for (const element of elements) {
        expect(element.type, combo.id).toBe("text");
        expect(element.autoWidth, combo.id).toBe(false);
        expect(element.width, combo.id).toBeGreaterThan(0);
        expect(element.fontSize, combo.id).toBeGreaterThan(0);
        expect(paragraphsToText(element.paragraphs).trim().length, combo.id).toBeGreaterThan(0);
      }
    }
  });

  it("only uses catalogue fonts, with weights and italics that really exist", () => {
    for (const combo of TEXT_COMBOS) {
      const elements = combo.build(DESIGN_SIZES[0]);
      for (const element of elements) {
        const font = getFontDef(element.fontFamily);
        expect(font, `${combo.id}: ${element.fontFamily} is not in the catalogue`).toBeDefined();
        if (!font) continue;
        expect(snapWeight(font, element.fontWeight), `${combo.id}: ${font.family} has no weight ${element.fontWeight}`).toBe(element.fontWeight);
        if (element.italic) expect(font.italic, `${combo.id}: ${font.family} has no real italic`).toBe(true);
      }
      expect([...combo.fonts].sort(), `${combo.id} fonts`).toEqual([...new Set(elements.map((element) => element.fontFamily))].sort());
    }
  });

  it("puts the group in a box at the origin that fits well inside the design", () => {
    for (const size of DESIGN_SIZES) {
      const shorter = Math.min(size.width, size.height);
      for (const combo of TEXT_COMBOS) {
        const box = boundsOf(combo.build(size));
        expect(box.left, combo.id).toBe(0);
        expect(box.top, combo.id).toBe(0);
        expect(box.width, combo.id).toBeLessThanOrEqual(shorter * 0.9);
        expect(box.height, combo.id).toBeLessThanOrEqual(shorter * 0.9);
      }
    }
  });

  it("scales with the shorter side of the design and ignores the longer one", () => {
    for (const combo of TEXT_COMBOS) {
      const square = geometryOf(combo.build({ width: 1080, height: 1080 }));
      for (const size of DESIGN_SIZES) expect(geometryOf(combo.build(size)), combo.id).toEqual(square);

      const half = geometryOf(combo.build({ width: 540, height: 540 }));
      square.forEach((expected, index) => {
        // rounding to whole pixels may add up over a stack of lines, hence the slack on vertical values
        for (const [key, slack] of [
          ["x", 1],
          ["width", 1],
          ["fontSize", 1],
          ["y", 3],
          ["height", 3],
        ] as const) {
          expect(Math.abs(half[index][key] - expected[key] / 2), `${combo.id} ${key}`).toBeLessThanOrEqual(slack);
        }
      });
    }
  });

  it("sets text parameters inside the ranges of the document model", () => {
    for (const combo of TEXT_COMBOS) {
      for (const element of combo.build(DESIGN_SIZES[0])) {
        const label = `${combo.id}: ${paragraphsToText(element.paragraphs)}`;
        expect(element.lineHeight, label).toBeGreaterThanOrEqual(0.5);
        expect(element.lineHeight, label).toBeLessThanOrEqual(3);
        expect(element.letterSpacing, label).toBeGreaterThanOrEqual(-200);
        expect(element.letterSpacing, label).toBeLessThanOrEqual(800);
        expect(element.fontWeight, label).toBeGreaterThanOrEqual(100);
        expect(element.fontWeight, label).toBeLessThanOrEqual(900);
        expect(element.color, label).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
  });

  it("uses colours that read on a light page, with at most one accent colour", () => {
    for (const combo of TEXT_COMBOS) {
      const colors = [...new Set(combo.build(DESIGN_SIZES[0]).map((element) => element.color))];
      for (const color of colors) expect(contrastRatio(color, "#ffffff"), `${combo.id} ${color}`).toBeGreaterThanOrEqual(4.5);
      expect(colors.filter(isAccent).length, `${combo.id} accent colours`).toBeLessThanOrEqual(1);
    }
  });

  it("only uses characters the bundled latin subsets contain", () => {
    // eslint-disable-next-line no-control-regex -- the Latin range starts at the control characters
    const latin = /^[\u0000-\u00ff\u2000-\u206f]*$/;
    for (const combo of TEXT_COMBOS) {
      for (const element of combo.build(DESIGN_SIZES[0])) expect(paragraphsToText(element.paragraphs), combo.id).toMatch(latin);
    }
  });
});

describe("text style presets", () => {
  it("offers a heading, a subheading and body text in the default font", () => {
    expect(TEXT_STYLE_PRESETS.map(({ id, label }) => [id, label])).toEqual([
      ["heading", "Add a heading"],
      ["subheading", "Add a subheading"],
      ["body", "Add a little bit of body text"],
    ]);
    for (const preset of TEXT_STYLE_PRESETS) {
      expect(preset.fontFamily, preset.id).toBe(DEFAULT_FONT);
      expect(snapWeight(def(preset.fontFamily), preset.fontWeight), preset.id).toBe(preset.fontWeight);
    }
    const [heading, subheading, body] = TEXT_STYLE_PRESETS;
    expect(heading.fontWeight).toBe(700);
    expect(body.fontWeight).toBe(400);
    expect(heading.sizeFactor).toBeGreaterThan(subheading.sizeFactor);
    expect(subheading.sizeFactor).toBeGreaterThan(body.sizeFactor);
  });

  it("agrees with the sizes the factory gives a design", () => {
    for (const [width, height] of [
      [1920, 1080],
      [1080, 1350],
      [800, 800],
      [595, 842],
    ]) {
      const real = textPresetSizes(width, height);
      for (const preset of TEXT_STYLE_PRESETS) {
        expect(Math.round(Math.min(width, height) * preset.sizeFactor), `${preset.id} at ${width}x${height}`).toBe(real[preset.id]);
      }
    }
  });
});
