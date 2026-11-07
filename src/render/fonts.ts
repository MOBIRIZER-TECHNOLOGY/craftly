/**
 * Font catalogue and lazy loader.
 *
 * Every family shipped through the `@fontsource` packages is described once, in
 * `ENTRIES`: display name, category and the woff2 files that back it. Only the
 * latin subset is bundled. Each file is imported with Vite's `?url` suffix inside
 * its own loader, so every woff2 is a separate asset that is fetched the first
 * time a design needs that face and then registered with the FontFace API under
 * the family name the fontsource CSS would use ("Inter Variable", "Poppins" ...).
 * That keeps canvas `ctx.font` strings and DOM text editing in agreement.
 *
 * Nothing here touches the DOM at import time, and without a `document` (unit
 * tests, workers) every font counts as ready, so layout code never waits on it.
 */

export type FontCategory = "sans" | "serif" | "display" | "script" | "handwriting" | "mono";

export interface FontDef {
  /** Display name stored in documents, e.g. "Plus Jakarta Sans". */
  family: string;
  /** CSS family registered with FontFace, e.g. "Plus Jakarta Sans Variable". */
  css: string;
  category: FontCategory;
  /** Available weights, ascending. Variable fonts list every 100 step of their range. */
  weights: number[];
  variable: boolean;
  /** A real italic face exists (otherwise the browser synthesises an oblique). */
  italic: boolean;
}

/* ------------------------------------------------------------------ */
/* Face sources                                                       */
/* ------------------------------------------------------------------ */

/** A woff2 file imported on demand; Vite resolves the `?url` import to a hashed asset URL. */
type FontFile = () => Promise<{ default: string }>;

/** One woff2 file together with the CSS descriptors it is registered with. */
interface FaceSource {
  /** Lightest and heaviest weight the file covers; equal for static files. */
  minWeight: number;
  maxWeight: number;
  italic: boolean;
  load: FontFile;
}

interface FontEntry {
  def: FontDef;
  /** Upright faces first; together they cover every weight in `def.weights`. */
  faces: readonly FaceSource[];
}

const WEIGHT_STEP = 100;
/** The document model stops at 900, even where a font goes further (DM Sans, Nunito reach 1000). */
const MAX_WEIGHT = 900;

function weightSteps(min: number, max: number): number[] {
  const steps: number[] = [];
  for (let weight = min; weight <= Math.min(max, MAX_WEIGHT); weight += WEIGHT_STEP) steps.push(weight);
  return steps;
}

/** A `@fontsource-variable` family: one file per style that covers the whole weight range. */
function variable(family: string, category: FontCategory, [minWeight, maxWeight]: readonly [number, number], files: { normal: FontFile; italic?: FontFile }): FontEntry {
  const faces: FaceSource[] = [{ minWeight, maxWeight, italic: false, load: files.normal }];
  if (files.italic) faces.push({ minWeight, maxWeight, italic: true, load: files.italic });
  return {
    def: { family, css: `${family} Variable`, category, weights: weightSteps(minWeight, maxWeight), variable: true, italic: files.italic !== undefined },
    faces,
  };
}

/** A static `@fontsource` family: one file per weight (400, plus 700 where it exists) and style. */
function fixed(family: string, category: FontCategory, files: { regular: FontFile; bold?: FontFile; italic?: FontFile; boldItalic?: FontFile }): FontEntry {
  const faces: FaceSource[] = [];
  const add = (weight: number, italic: boolean, load: FontFile | undefined) => {
    if (load) faces.push({ minWeight: weight, maxWeight: weight, italic, load });
  };
  add(400, false, files.regular);
  add(700, false, files.bold);
  add(400, true, files.italic);
  add(700, true, files.boldItalic);
  return {
    def: { family, css: family, category, weights: files.bold ? [400, 700] : [400], variable: false, italic: files.italic !== undefined },
    faces,
  };
}

/* ------------------------------------------------------------------ */
/* Catalogue                                                          */
/* ------------------------------------------------------------------ */

/** Everyday fonts first, then display, script, handwriting and monospace. */
const ENTRIES: FontEntry[] = [
  variable("Plus Jakarta Sans", "sans", [200, 800], {
    normal: () => import("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-italic.woff2?url"),
  }),
  variable("Inter", "sans", [100, 900], {
    normal: () => import("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url"),
  }),
  fixed("Poppins", "sans", {
    regular: () => import("@fontsource/poppins/files/poppins-latin-400-normal.woff2?url"),
    bold: () => import("@fontsource/poppins/files/poppins-latin-700-normal.woff2?url"),
    italic: () => import("@fontsource/poppins/files/poppins-latin-400-italic.woff2?url"),
    boldItalic: () => import("@fontsource/poppins/files/poppins-latin-700-italic.woff2?url"),
  }),
  variable("Montserrat", "sans", [100, 900], {
    normal: () => import("@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/montserrat/files/montserrat-latin-wght-italic.woff2?url"),
  }),
  variable("DM Sans", "sans", [100, 1000], {
    normal: () => import("@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/dm-sans/files/dm-sans-latin-wght-italic.woff2?url"),
  }),
  variable("Playfair Display", "serif", [400, 900], {
    normal: () => import("@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2?url"),
  }),
  variable("Lora", "serif", [400, 700], {
    normal: () => import("@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url"),
  }),
  variable("Raleway", "sans", [100, 900], {
    normal: () => import("@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2?url"),
  }),
  variable("Open Sans", "sans", [300, 800], {
    normal: () => import("@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/open-sans/files/open-sans-latin-wght-italic.woff2?url"),
  }),
  fixed("Roboto", "sans", {
    regular: () => import("@fontsource/roboto/files/roboto-latin-400-normal.woff2?url"),
    bold: () => import("@fontsource/roboto/files/roboto-latin-700-normal.woff2?url"),
    italic: () => import("@fontsource/roboto/files/roboto-latin-400-italic.woff2?url"),
    boldItalic: () => import("@fontsource/roboto/files/roboto-latin-700-italic.woff2?url"),
  }),
  fixed("Lato", "sans", {
    regular: () => import("@fontsource/lato/files/lato-latin-400-normal.woff2?url"),
    bold: () => import("@fontsource/lato/files/lato-latin-700-normal.woff2?url"),
    italic: () => import("@fontsource/lato/files/lato-latin-400-italic.woff2?url"),
    boldItalic: () => import("@fontsource/lato/files/lato-latin-700-italic.woff2?url"),
  }),
  variable("Work Sans", "sans", [100, 900], {
    normal: () => import("@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2?url"),
  }),
  variable("Manrope", "sans", [200, 800], {
    normal: () => import("@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url"),
  }),
  variable("Outfit", "sans", [100, 900], {
    normal: () => import("@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url"),
  }),
  variable("Nunito", "sans", [200, 1000], {
    normal: () => import("@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url"),
  }),
  variable("Josefin Sans", "sans", [100, 700], {
    normal: () => import("@fontsource-variable/josefin-sans/files/josefin-sans-latin-wght-normal.woff2?url"),
  }),
  variable("Space Grotesk", "sans", [300, 700], {
    normal: () => import("@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url"),
  }),
  variable("Bricolage Grotesque", "sans", [200, 800], {
    normal: () => import("@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url"),
  }),
  variable("Merriweather", "serif", [300, 900], {
    normal: () => import("@fontsource-variable/merriweather/files/merriweather-latin-wght-normal.woff2?url"),
  }),
  variable("Cormorant Garamond", "serif", [300, 700], {
    normal: () => import("@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-italic.woff2?url"),
  }),
  variable("Fraunces", "serif", [100, 900], {
    normal: () => import("@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url"),
    italic: () => import("@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2?url"),
  }),
  fixed("Libre Baskerville", "serif", {
    regular: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff2?url"),
    bold: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-700-normal.woff2?url"),
    italic: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-400-italic.woff2?url"),
    boldItalic: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-700-italic.woff2?url"),
  }),
  fixed("DM Serif Display", "serif", {
    regular: () => import("@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2?url"),
    italic: () => import("@fontsource/dm-serif-display/files/dm-serif-display-latin-400-italic.woff2?url"),
  }),
  fixed("Cinzel", "serif", {
    regular: () => import("@fontsource/cinzel/files/cinzel-latin-400-normal.woff2?url"),
    bold: () => import("@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url"),
  }),
  variable("Oswald", "sans", [200, 700], {
    normal: () => import("@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2?url"),
  }),
  fixed("Bebas Neue", "display", {
    regular: () => import("@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url"),
  }),
  fixed("Anton", "display", {
    regular: () => import("@fontsource/anton/files/anton-latin-400-normal.woff2?url"),
  }),
  fixed("Archivo Black", "display", {
    regular: () => import("@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2?url"),
  }),
  fixed("Abril Fatface", "display", {
    regular: () => import("@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff2?url"),
  }),
  fixed("Yeseva One", "display", {
    regular: () => import("@fontsource/yeseva-one/files/yeseva-one-latin-400-normal.woff2?url"),
  }),
  variable("Syne", "display", [400, 800], {
    normal: () => import("@fontsource-variable/syne/files/syne-latin-wght-normal.woff2?url"),
  }),
  fixed("Righteous", "display", {
    regular: () => import("@fontsource/righteous/files/righteous-latin-400-normal.woff2?url"),
  }),
  fixed("Bungee", "display", {
    regular: () => import("@fontsource/bungee/files/bungee-latin-400-normal.woff2?url"),
  }),
  variable("Fredoka", "display", [300, 700], {
    normal: () => import("@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url"),
  }),
  variable("Dancing Script", "script", [400, 700], {
    normal: () => import("@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2?url"),
  }),
  fixed("Great Vibes", "script", {
    regular: () => import("@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2?url"),
  }),
  fixed("Pacifico", "script", {
    regular: () => import("@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url"),
  }),
  fixed("Lobster", "script", {
    regular: () => import("@fontsource/lobster/files/lobster-latin-400-normal.woff2?url"),
  }),
  fixed("Satisfy", "script", {
    regular: () => import("@fontsource/satisfy/files/satisfy-latin-400-normal.woff2?url"),
  }),
  variable("Caveat", "handwriting", [400, 700], {
    normal: () => import("@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url"),
  }),
  fixed("Shadows Into Light", "handwriting", {
    regular: () => import("@fontsource/shadows-into-light/files/shadows-into-light-latin-400-normal.woff2?url"),
  }),
  fixed("Permanent Marker", "handwriting", {
    regular: () => import("@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url"),
  }),
  variable("JetBrains Mono", "mono", [100, 800], {
    normal: () => import("@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url"),
  }),
  fixed("Space Mono", "mono", {
    regular: () => import("@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url"),
    bold: () => import("@fontsource/space-mono/files/space-mono-latin-700-normal.woff2?url"),
  }),
];

export const FONT_CATALOG: FontDef[] = ENTRIES.map((entry) => entry.def);

const ENTRY_BY_FAMILY = new Map(ENTRIES.map((entry) => [entry.def.family, entry]));

/** Exact, case-sensitive lookup by display name. */
export function getFontDef(family: string): FontDef | undefined {
  return ENTRY_BY_FAMILY.get(family)?.def;
}

const GENERIC_FALLBACK: Record<FontCategory, string> = {
  sans: "sans-serif",
  serif: "serif",
  display: "sans-serif",
  script: "cursive",
  handwriting: "cursive",
  mono: "monospace",
};

const quote = (name: string) => `"${name.replace(/["\\]/g, "\\$&")}"`;

/**
 * Canvas / CSS font-family value with fallbacks, e.g.
 * `"Plus Jakarta Sans Variable", "Plus Jakarta Sans", sans-serif`.
 * Families outside the catalogue (a brand font, a system font) get a plain sans-serif fallback.
 */
export function cssFontFamily(family: string): string {
  const def = getFontDef(family);
  if (!def) return `${quote(family)}, sans-serif`;
  const names = def.css === def.family ? [def.css] : [def.css, def.family];
  return [...names.map(quote), GENERIC_FALLBACK[def.category]].join(", ");
}

/**
 * The weight a request is rendered with: the nearest available weight for static
 * fonts (a tie goes to the bolder one), the request clamped to the font's range
 * for variable fonts. Anything that is not a finite number counts as regular (400).
 */
export function snapWeight(def: FontDef, weight: number): number {
  const wanted = Number.isFinite(weight) ? weight : 400;
  if (def.variable) return Math.min(def.weights[def.weights.length - 1], Math.max(def.weights[0], wanted));
  return def.weights.reduce((best, candidate) => (Math.abs(candidate - wanted) <= Math.abs(best - wanted) ? candidate : best));
}

/* ------------------------------------------------------------------ */
/* Loading                                                            */
/* ------------------------------------------------------------------ */

let epoch = 0;
const listeners = new Set<() => void>();
/** Every face whose load has started; the promise never rejects. */
const loads = new Map<FaceSource, Promise<void>>();
/** Faces with nothing left to wait for: loaded, or failed for good (the fallback font is used). */
const settled = new Set<FaceSource>();

/** FontFace and `document.fonts` exist (false in node tests and workers). */
const canLoadFonts = () => typeof document !== "undefined" && typeof FontFace !== "undefined";

function pickFace(entry: FontEntry, weight: number, italic: boolean): FaceSource {
  const wanted = snapWeight(entry.def, weight);
  const covers = (face: FaceSource) => face.minWeight <= wanted && wanted <= face.maxWeight;
  return (italic ? entry.faces.find((face) => face.italic && covers(face)) : undefined) ?? entry.faces.find((face) => !face.italic && covers(face)) ?? entry.faces[0];
}

function notify(): void {
  for (const listener of [...listeners]) {
    try {
      listener();
    } catch (error) {
      console.error("A fonts change listener threw", error);
    }
  }
}

/** Fetches one woff2 file and registers it; resolves to false (after logging) when that fails. */
async function registerFace(def: FontDef, face: FaceSource): Promise<boolean> {
  try {
    const { default: url } = await face.load();
    const weight = face.minWeight === face.maxWeight ? String(face.minWeight) : `${face.minWeight} ${face.maxWeight}`;
    const font = new FontFace(def.css, `url("${url}")`, { weight, style: face.italic ? "italic" : "normal" });
    document.fonts.add(await font.load());
    return true;
  } catch (error) {
    console.warn(`Could not load the ${def.family} font; text falls back to a default font.`, error);
    return false;
  }
}

function loadFace(def: FontDef, face: FaceSource): Promise<void> {
  let task = loads.get(face);
  if (!task) {
    task = registerFace(def, face).then((loaded) => {
      settled.add(face);
      if (loaded) {
        epoch += 1;
        notify();
      }
    });
    loads.set(face, task);
  }
  return task;
}

/**
 * Loads (once) the face needed for this family, weight and style, and resolves when
 * it is usable. Never rejects: a failed load is logged and the fallback font is used.
 * Unknown families, and environments without a DOM, resolve immediately.
 */
export function ensureFont(family: string, weight = 400, italic = false): Promise<void> {
  const entry = canLoadFonts() ? ENTRY_BY_FAMILY.get(family) : undefined;
  return entry ? loadFace(entry.def, pickFace(entry, weight, italic)) : Promise.resolve();
}

/**
 * True when `ensureFont` with the same arguments would have nothing left to wait for:
 * the face is loaded, failed for good, or the family is unknown / there is no DOM.
 * Callers can therefore repaint on `onFontsChange` without ever looping on a broken font.
 */
export function isFontReady(family: string, weight = 400, italic = false): boolean {
  const entry = canLoadFonts() ? ENTRY_BY_FAMILY.get(family) : undefined;
  return !entry || settled.has(pickFace(entry, weight, italic));
}

/** Starts loading every face (all weights, upright and italic) of the given families, for the font picker. */
export async function preloadFonts(families: string[]): Promise<void> {
  if (!canLoadFonts()) return;
  const jobs = families.flatMap((family) => {
    const entry = ENTRY_BY_FAMILY.get(family);
    return entry ? entry.faces.map((face) => loadFace(entry.def, face)) : [];
  });
  await Promise.all(jobs);
}

/** Increments whenever a face finishes loading, so layout caches can tell their measurements are stale. */
export function fontsEpoch(): number {
  return epoch;
}

/** Calls `cb` each time a face finishes loading; returns the unsubscribe function. */
export function onFontsChange(cb: () => void): () => void {
  const subscription = () => cb();
  listeners.add(subscription);
  return () => {
    listeners.delete(subscription);
  };
}
