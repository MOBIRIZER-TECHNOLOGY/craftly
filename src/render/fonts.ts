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
 *
 * Fonts a person uploaded (src/core/customFonts.ts keeps the files) join the same
 * catalogue through `setCustomFaces`, so everything that asks for a font here - the
 * canvas, thumbnails, Present, the exports - finds them the same way. A bundled
 * family always wins over an uploaded one of the same name, and an uploaded family
 * is registered under a name this file makes up from safe characters, never under
 * the text a person typed.
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

/** One uploaded font file, as much of it as drawing needs (the stored record is `CustomFontFile` in src/core/customFonts.ts). */
export interface CustomFace {
  id: string;
  /** the name the person knows the family by; it is what documents store */
  family: string;
  /** lightest and heaviest weight the file covers; equal unless it is a variable font */
  minWeight: number;
  maxWeight: number;
  italic: boolean;
  format: "ttf" | "otf" | "woff" | "woff2";
  /** the file itself, checked when it was uploaded */
  data: ArrayBuffer;
}

/** One font file together with the CSS descriptors it is registered with. */
interface FaceSource {
  /** Lightest and heaviest weight the file covers; equal for static files. */
  minWeight: number;
  maxWeight: number;
  italic: boolean;
  /** the woff2 file of a bundled face */
  load?: FontFile;
  /** the uploaded file of a custom face */
  custom?: CustomFace;
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

/** The uploaded families, by the name the person gave them (see `setCustomFaces`). */
const CUSTOM_BY_FAMILY = new Map<string, FontEntry>();

/** A bundled family first: an uploaded one can never take its place. */
const entryOf = (family: string): FontEntry | undefined => ENTRY_BY_FAMILY.get(family) ?? CUSTOM_BY_FAMILY.get(family);

/** Exact, case-sensitive lookup by display name, among the bundled families and the uploaded ones. */
export function getFontDef(family: string): FontDef | undefined {
  return entryOf(family)?.def;
}

const GENERIC_FALLBACK: Record<FontCategory, string> = {
  sans: "sans-serif",
  serif: "serif",
  display: "sans-serif",
  script: "cursive",
  handwriting: "cursive",
  mono: "monospace",
};

/**
 * A family name as a quoted CSS string. A name is text from a document or from a person, so nothing in it may end the
 * string: quotes and backslashes are escaped, and a line break or other control character (which would end a CSS string
 * and with it the whole `font` value) becomes a space.
 */
// eslint-disable-next-line no-control-regex -- control characters are exactly what is replaced
const quote = (name: string) => `"${name.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/["\\]/g, "\\$&")}"`;

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

/** The FontFace of every uploaded face that is in the document, so that it can be taken out when its file is deleted. */
const registered = new Map<FaceSource, FontFace>();

/**
 * Fetches one woff2 file, or takes the bytes of an uploaded one, and registers it; resolves to false (after logging) when
 * that fails. An uploaded file goes to the FontFace constructor as bytes, which parses it and runs nothing; it is never
 * written into a style sheet.
 */
async function registerFace(def: FontDef, face: FaceSource): Promise<boolean> {
  try {
    const source = face.custom ? face.custom.data : `url("${(await (face.load as FontFile)()).default}")`;
    const weight = face.minWeight === face.maxWeight ? String(face.minWeight) : `${face.minWeight} ${face.maxWeight}`;
    const font = new FontFace(def.css, source, { weight, style: face.italic ? "italic" : "normal" });
    const loaded = await font.load();
    if (face.custom) {
      // the file was deleted while it loaded: its face must not stay behind
      if (!loads.has(face)) return false;
      registered.set(face, loaded);
    }
    document.fonts.add(loaded);
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
 * Unknown families, and environments without a DOM, resolve immediately; while the
 * uploaded fonts are still being read from storage an unknown family waits for that
 * read first, so an export that starts right after the page opened draws the right font.
 */
export function ensureFont(family: string, weight = 400, italic = false): Promise<void> {
  if (!canLoadFonts()) return Promise.resolve();
  const entry = entryOf(family);
  if (entry) return loadFace(entry.def, pickFace(entry, weight, italic));
  if (!customPending) return Promise.resolve();
  return customPending.then(() => {
    const late = CUSTOM_BY_FAMILY.get(family);
    return late ? loadFace(late.def, pickFace(late, weight, italic)) : undefined;
  });
}

/**
 * True when `ensureFont` with the same arguments would have nothing left to wait for:
 * the face is loaded, failed for good, or the family is unknown / there is no DOM.
 * Callers can therefore repaint on `onFontsChange` without ever looping on a broken font.
 */
export function isFontReady(family: string, weight = 400, italic = false): boolean {
  if (!canLoadFonts()) return true;
  const entry = entryOf(family);
  // an unknown family may still turn out to be an uploaded one
  if (!entry) return customPending === null;
  return settled.has(pickFace(entry, weight, italic));
}

/** The file a family is drawn with for a weight and style, as "Convert to shapes" for text reads its outlines (src/render/textOutline.ts). */
export interface FaceFile {
  data: ArrayBuffer;
  /** the weight the text is drawn at: snapped to what the family has, and within the file's range for a variable file */
  weight: number;
  /** the file covers a range of weights (a `wght` axis to set) */
  variable: boolean;
  /** italic was asked for and this file is upright: the browser slants it, and so must whoever draws its outlines */
  slanted: boolean;
}

/**
 * The bytes of the face `ensureFont` would draw this family, weight and style with: the bundled woff2 file (fetched from the
 * hashed asset the app ships, as the FontFace does) or the uploaded file. Null for a family Craftly has no file of (a system font).
 * Rejects when the bundled file cannot be fetched.
 */
export async function faceFile(family: string, weight = 400, italic = false): Promise<FaceFile | null> {
  if (customPending) await customPending;
  const entry = entryOf(family);
  if (!entry) return null;
  const face = pickFace(entry, weight, italic);
  const drawn = Math.min(face.maxWeight, Math.max(face.minWeight, snapWeight(entry.def, weight)));
  const describe = (data: ArrayBuffer): FaceFile => ({ data, weight: drawn, variable: face.minWeight !== face.maxWeight, slanted: italic && !face.italic });
  if (face.custom) return describe(face.custom.data);
  const url = (await (face.load as FontFile)()).default;
  const response = await fetch(url);
  if (!response.ok) throw new Error(`the font file of ${family} could not be fetched (${response.status})`);
  return describe(await response.arrayBuffer());
}

/** Starts loading every face (all weights, upright and italic) of the given families, for the font picker. */
export async function preloadFonts(families: string[]): Promise<void> {
  if (!canLoadFonts()) return;
  const jobs = families.flatMap((family) => {
    const entry = entryOf(family);
    return entry ? entry.faces.map((face) => loadFace(entry.def, face)) : [];
  });
  await Promise.all(jobs);
}

/* ------------------------------------------------------------------ */
/* Uploaded fonts                                                     */
/* ------------------------------------------------------------------ */

/** Every name a bundled family is known or registered by, in lower case. */
const BUNDLED_NAMES = new Set(ENTRIES.flatMap((entry) => [entry.def.family.toLowerCase(), entry.def.css.toLowerCase()]));

/** True for the name of a bundled family or the name one is registered under, whatever its case. An uploaded family cannot be called that. */
export function isBundledFamily(family: string): boolean {
  return BUNDLED_NAMES.has(family.trim().toLowerCase());
}

/** True for a family that was uploaded and is on this device. */
export function isCustomFamily(family: string): boolean {
  return !ENTRY_BY_FAMILY.has(family) && CUSTOM_BY_FAMILY.has(family);
}

function fnv1a(text: string, seed: number): string {
  let hash = seed;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * The name an uploaded family is registered under with FontFace: "Craftly Upload" and a number worked out from the
 * family name. It holds none of the text a person typed, so it can go into a canvas `font` string, a style attribute or
 * an exported SVG as it is; it is the same on every device, so an exported file and the app agree; and it is not the
 * name of any bundled family, which are registered under their own names.
 */
export function customFontCss(family: string): string {
  return `Craftly Upload ${fnv1a(family, 0x811c9dc5)}${fnv1a(family, 0x9747b28c)}`;
}

/** A file keeps its id for as long as it is stored and its bytes never change, so the bytes are not compared. */
const sameFace = (a: CustomFace, b: CustomFace) => a.id === b.id && a.family === b.family && a.minWeight === b.minWeight && a.maxWeight === b.maxWeight && a.italic === b.italic;

/**
 * Replaces the set of uploaded fonts. Families are found by the name on their files; a file whose family has the name of
 * a bundled one, or no name, is left out, and so is a second file for a weight and style that the family already has.
 * A file that was there before keeps its loaded face; the face of one that is gone is taken out of the document. Every
 * screen that draws text is told, since a name that drew in the fallback font may now have a font, or the other way round.
 */
export function setCustomFaces(faces: readonly CustomFace[]): void {
  const before = new Map<string, FaceSource>();
  for (const entry of CUSTOM_BY_FAMILY.values()) for (const face of entry.faces) before.set((face.custom as CustomFace).id, face);

  const grouped = new Map<string, FaceSource[]>();
  for (const custom of faces) {
    if (!custom.family.trim() || isBundledFamily(custom.family)) continue;
    const list = grouped.get(custom.family) ?? [];
    if (list.some((have) => have.italic === custom.italic && have.minWeight === custom.minWeight && have.maxWeight === custom.maxWeight)) continue;
    const old = before.get(custom.id);
    list.push(old && sameFace(old.custom as CustomFace, custom) ? old : { minWeight: custom.minWeight, maxWeight: custom.maxWeight, italic: custom.italic, custom });
    grouped.set(custom.family, list);
  }

  CUSTOM_BY_FAMILY.clear();
  const kept = new Set<FaceSource>();
  for (const [family, list] of [...grouped].sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))) {
    // upright faces first, lighter before heavier: `pickFace` falls back on the first one
    list.sort((a, b) => Number(a.italic) - Number(b.italic) || a.minWeight - b.minWeight);
    // the weights the family offers are those of its upright files (of all of them when it has italics only)
    const shown = list.some((face) => !face.italic) ? list.filter((face) => !face.italic) : list;
    const variable = shown.every((face) => face.maxWeight > face.minWeight);
    const weights = [...new Set(shown.flatMap((face) => (variable ? weightSteps(face.minWeight, face.maxWeight) : [face.minWeight])))].sort((a, b) => a - b);
    CUSTOM_BY_FAMILY.set(family, {
      def: { family, css: customFontCss(family), category: "sans", weights, variable, italic: list.some((face) => face.italic) },
      faces: list,
    });
    for (const face of list) kept.add(face);
  }

  for (const face of before.values()) {
    if (kept.has(face)) continue;
    const loaded = registered.get(face);
    // (a face is only ever remembered where there is a document to put it in)
    if (loaded) document.fonts.delete(loaded);
    registered.delete(face);
    loads.delete(face);
    settled.delete(face);
  }
  epoch += 1;
  notify();
}

/** The uploaded families that are on this device, by name. */
export function customFontDefs(): FontDef[] {
  return [...CUSTOM_BY_FAMILY.values()].map((entry) => entry.def);
}

/**
 * The uploaded file a request for this family, weight and style is drawn with, and the name it is registered under
 * (the same choice as `ensureFont` makes); null for a bundled or unknown family. The exports that embed fonts use it.
 */
export function customFaceFor(family: string, weight: number, italic: boolean): (CustomFace & { css: string }) | null {
  if (!isCustomFamily(family)) return null;
  const entry = CUSTOM_BY_FAMILY.get(family) as FontEntry;
  return { ...(pickFace(entry, weight, italic).custom as CustomFace), css: entry.def.css };
}

/** The read of the uploaded fonts that is under way, if one is. */
let customPending: Promise<void> | null = null;

/**
 * Says that the uploaded fonts are being read from storage and `task` settles when they are in (`setCustomFaces` was
 * called) or the read failed. Until then a family this file does not know is not "ready": it may be one of them.
 */
export function trackCustomFonts(task: Promise<unknown>): void {
  const pending: Promise<void> = task
    .then(
      () => undefined,
      () => undefined,
    )
    .then(() => {
      if (customPending === pending) customPending = null;
    });
  customPending = pending;
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
