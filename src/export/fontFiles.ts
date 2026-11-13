/**
 * Where the woff2 files of the bundled fonts live, so the SVG exporter can embed them as base64 @font-face rules.
 *
 * `render/fonts.ts` imports every `@fontsource*` woff2 file lazily (Vite `?url`) but keeps the resulting URLs
 * private - the FontFace API cannot hand a source URL back either - so this file lists the very same imports.
 * Vite resolves each `?url` import to the same hashed asset, so no file is bundled twice. A unit test checks
 * that this table covers every family, weight range and style of FONT_CATALOG.
 *
 * A font the person uploaded has no file here: its bytes are in the library, and `fontFile` hands them out as they are.
 */
import { customFaceFor, getFontDef, snapWeight } from "@/render/fonts";

interface FaceFile {
  /** weight range the file covers (equal for static files) */
  min: number;
  max: number;
  italic: boolean;
  load: () => Promise<{ default: string }>;
}

/** Same families, order and files as the ENTRIES of render/fonts.ts (latin subset only). */
const FACE_FILES: Record<string, readonly FaceFile[]> = {
  "Plus Jakarta Sans": [
    { min: 200, max: 800, italic: false, load: () => import("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-normal.woff2?url") },
    { min: 200, max: 800, italic: true, load: () => import("@fontsource-variable/plus-jakarta-sans/files/plus-jakarta-sans-latin-wght-italic.woff2?url") },
  ],
  Inter: [
    { min: 100, max: 900, italic: false, load: () => import("@fontsource-variable/inter/files/inter-latin-wght-normal.woff2?url") },
    { min: 100, max: 900, italic: true, load: () => import("@fontsource-variable/inter/files/inter-latin-wght-italic.woff2?url") },
  ],
  Poppins: [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/poppins/files/poppins-latin-400-normal.woff2?url") },
    { min: 700, max: 700, italic: false, load: () => import("@fontsource/poppins/files/poppins-latin-700-normal.woff2?url") },
    { min: 400, max: 400, italic: true, load: () => import("@fontsource/poppins/files/poppins-latin-400-italic.woff2?url") },
    { min: 700, max: 700, italic: true, load: () => import("@fontsource/poppins/files/poppins-latin-700-italic.woff2?url") },
  ],
  Montserrat: [
    { min: 100, max: 900, italic: false, load: () => import("@fontsource-variable/montserrat/files/montserrat-latin-wght-normal.woff2?url") },
    { min: 100, max: 900, italic: true, load: () => import("@fontsource-variable/montserrat/files/montserrat-latin-wght-italic.woff2?url") },
  ],
  "DM Sans": [
    { min: 100, max: 1000, italic: false, load: () => import("@fontsource-variable/dm-sans/files/dm-sans-latin-wght-normal.woff2?url") },
    { min: 100, max: 1000, italic: true, load: () => import("@fontsource-variable/dm-sans/files/dm-sans-latin-wght-italic.woff2?url") },
  ],
  "Playfair Display": [
    { min: 400, max: 900, italic: false, load: () => import("@fontsource-variable/playfair-display/files/playfair-display-latin-wght-normal.woff2?url") },
    { min: 400, max: 900, italic: true, load: () => import("@fontsource-variable/playfair-display/files/playfair-display-latin-wght-italic.woff2?url") },
  ],
  Lora: [
    { min: 400, max: 700, italic: false, load: () => import("@fontsource-variable/lora/files/lora-latin-wght-normal.woff2?url") },
    { min: 400, max: 700, italic: true, load: () => import("@fontsource-variable/lora/files/lora-latin-wght-italic.woff2?url") },
  ],
  Raleway: [{ min: 100, max: 900, italic: false, load: () => import("@fontsource-variable/raleway/files/raleway-latin-wght-normal.woff2?url") }],
  "Open Sans": [
    { min: 300, max: 800, italic: false, load: () => import("@fontsource-variable/open-sans/files/open-sans-latin-wght-normal.woff2?url") },
    { min: 300, max: 800, italic: true, load: () => import("@fontsource-variable/open-sans/files/open-sans-latin-wght-italic.woff2?url") },
  ],
  Roboto: [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/roboto/files/roboto-latin-400-normal.woff2?url") },
    { min: 700, max: 700, italic: false, load: () => import("@fontsource/roboto/files/roboto-latin-700-normal.woff2?url") },
    { min: 400, max: 400, italic: true, load: () => import("@fontsource/roboto/files/roboto-latin-400-italic.woff2?url") },
    { min: 700, max: 700, italic: true, load: () => import("@fontsource/roboto/files/roboto-latin-700-italic.woff2?url") },
  ],
  Lato: [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/lato/files/lato-latin-400-normal.woff2?url") },
    { min: 700, max: 700, italic: false, load: () => import("@fontsource/lato/files/lato-latin-700-normal.woff2?url") },
    { min: 400, max: 400, italic: true, load: () => import("@fontsource/lato/files/lato-latin-400-italic.woff2?url") },
    { min: 700, max: 700, italic: true, load: () => import("@fontsource/lato/files/lato-latin-700-italic.woff2?url") },
  ],
  "Work Sans": [{ min: 100, max: 900, italic: false, load: () => import("@fontsource-variable/work-sans/files/work-sans-latin-wght-normal.woff2?url") }],
  Manrope: [{ min: 200, max: 800, italic: false, load: () => import("@fontsource-variable/manrope/files/manrope-latin-wght-normal.woff2?url") }],
  Outfit: [{ min: 100, max: 900, italic: false, load: () => import("@fontsource-variable/outfit/files/outfit-latin-wght-normal.woff2?url") }],
  Nunito: [{ min: 200, max: 1000, italic: false, load: () => import("@fontsource-variable/nunito/files/nunito-latin-wght-normal.woff2?url") }],
  "Josefin Sans": [{ min: 100, max: 700, italic: false, load: () => import("@fontsource-variable/josefin-sans/files/josefin-sans-latin-wght-normal.woff2?url") }],
  "Space Grotesk": [{ min: 300, max: 700, italic: false, load: () => import("@fontsource-variable/space-grotesk/files/space-grotesk-latin-wght-normal.woff2?url") }],
  "Bricolage Grotesque": [
    { min: 200, max: 800, italic: false, load: () => import("@fontsource-variable/bricolage-grotesque/files/bricolage-grotesque-latin-wght-normal.woff2?url") },
  ],
  Merriweather: [{ min: 300, max: 900, italic: false, load: () => import("@fontsource-variable/merriweather/files/merriweather-latin-wght-normal.woff2?url") }],
  "Cormorant Garamond": [
    { min: 300, max: 700, italic: false, load: () => import("@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-normal.woff2?url") },
    { min: 300, max: 700, italic: true, load: () => import("@fontsource-variable/cormorant-garamond/files/cormorant-garamond-latin-wght-italic.woff2?url") },
  ],
  Fraunces: [
    { min: 100, max: 900, italic: false, load: () => import("@fontsource-variable/fraunces/files/fraunces-latin-wght-normal.woff2?url") },
    { min: 100, max: 900, italic: true, load: () => import("@fontsource-variable/fraunces/files/fraunces-latin-wght-italic.woff2?url") },
  ],
  "Libre Baskerville": [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-400-normal.woff2?url") },
    { min: 700, max: 700, italic: false, load: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-700-normal.woff2?url") },
    { min: 400, max: 400, italic: true, load: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-400-italic.woff2?url") },
    { min: 700, max: 700, italic: true, load: () => import("@fontsource/libre-baskerville/files/libre-baskerville-latin-700-italic.woff2?url") },
  ],
  "DM Serif Display": [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/dm-serif-display/files/dm-serif-display-latin-400-normal.woff2?url") },
    { min: 400, max: 400, italic: true, load: () => import("@fontsource/dm-serif-display/files/dm-serif-display-latin-400-italic.woff2?url") },
  ],
  Cinzel: [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/cinzel/files/cinzel-latin-400-normal.woff2?url") },
    { min: 700, max: 700, italic: false, load: () => import("@fontsource/cinzel/files/cinzel-latin-700-normal.woff2?url") },
  ],
  Oswald: [{ min: 200, max: 700, italic: false, load: () => import("@fontsource-variable/oswald/files/oswald-latin-wght-normal.woff2?url") }],
  "Bebas Neue": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/bebas-neue/files/bebas-neue-latin-400-normal.woff2?url") }],
  Anton: [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/anton/files/anton-latin-400-normal.woff2?url") }],
  "Archivo Black": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/archivo-black/files/archivo-black-latin-400-normal.woff2?url") }],
  "Abril Fatface": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/abril-fatface/files/abril-fatface-latin-400-normal.woff2?url") }],
  "Yeseva One": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/yeseva-one/files/yeseva-one-latin-400-normal.woff2?url") }],
  Syne: [{ min: 400, max: 800, italic: false, load: () => import("@fontsource-variable/syne/files/syne-latin-wght-normal.woff2?url") }],
  Righteous: [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/righteous/files/righteous-latin-400-normal.woff2?url") }],
  Bungee: [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/bungee/files/bungee-latin-400-normal.woff2?url") }],
  Fredoka: [{ min: 300, max: 700, italic: false, load: () => import("@fontsource-variable/fredoka/files/fredoka-latin-wght-normal.woff2?url") }],
  "Dancing Script": [{ min: 400, max: 700, italic: false, load: () => import("@fontsource-variable/dancing-script/files/dancing-script-latin-wght-normal.woff2?url") }],
  "Great Vibes": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/great-vibes/files/great-vibes-latin-400-normal.woff2?url") }],
  Pacifico: [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/pacifico/files/pacifico-latin-400-normal.woff2?url") }],
  Lobster: [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/lobster/files/lobster-latin-400-normal.woff2?url") }],
  Satisfy: [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/satisfy/files/satisfy-latin-400-normal.woff2?url") }],
  Caveat: [{ min: 400, max: 700, italic: false, load: () => import("@fontsource-variable/caveat/files/caveat-latin-wght-normal.woff2?url") }],
  "Shadows Into Light": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/shadows-into-light/files/shadows-into-light-latin-400-normal.woff2?url") }],
  "Permanent Marker": [{ min: 400, max: 400, italic: false, load: () => import("@fontsource/permanent-marker/files/permanent-marker-latin-400-normal.woff2?url") }],
  "JetBrains Mono": [{ min: 100, max: 800, italic: false, load: () => import("@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2?url") }],
  "Space Mono": [
    { min: 400, max: 400, italic: false, load: () => import("@fontsource/space-mono/files/space-mono-latin-400-normal.woff2?url") },
    { min: 700, max: 700, italic: false, load: () => import("@fontsource/space-mono/files/space-mono-latin-700-normal.woff2?url") },
  ],
};

export const FONT_FILE_FAMILIES: readonly string[] = Object.keys(FACE_FILES);

export interface FontFileInfo {
  /** display name stored in documents, e.g. "Plus Jakarta Sans" */
  family: string;
  /** CSS family the face is registered under, e.g. "Plus Jakarta Sans Variable" */
  css: string;
  url: string;
  /** descriptor values for @font-face: `font-weight: min max` */
  minWeight: number;
  maxWeight: number;
  italic: boolean;
  /** an uploaded font: the file itself (`url` is empty then) and what kind of font file it is */
  data?: ArrayBuffer;
  format?: "ttf" | "otf" | "woff" | "woff2";
}

/** The face file `render/fonts.ts` would load for this request (same rule as its `pickFace`). */
function pickFace(family: string, weight: number, italic: boolean): { def: NonNullable<ReturnType<typeof getFontDef>>; face: FaceFile } | null {
  const def = getFontDef(family);
  const faces = FACE_FILES[family];
  if (!def || !faces?.length) return null;
  const wanted = snapWeight(def, weight);
  const covers = (face: FaceFile) => face.min <= wanted && wanted <= face.max;
  const face = (italic ? faces.find((f) => f.italic && covers(f)) : undefined) ?? faces.find((f) => !f.italic && covers(f)) ?? faces[0];
  return { def, face };
}

/** Stable identity of the face a request resolves to (to de-duplicate before fetching). Null for unknown families. */
export function fontFaceKey(family: string, weight = 400, italic = false): string | null {
  const hit = pickFace(family, weight, italic);
  if (hit) return `${family}|${hit.face.min}-${hit.face.max}|${hit.face.italic}`;
  const uploaded = customFaceFor(family, weight, italic);
  return uploaded ? `uploaded|${uploaded.id}` : null;
}

/** The file of the uploaded font this request is drawn with, or null when the family is not an uploaded one. */
function uploadedFile(family: string, weight: number, italic: boolean): FontFileInfo | null {
  const face = customFaceFor(family, weight, italic);
  return face ? { family, css: face.css, url: "", minWeight: face.minWeight, maxWeight: face.maxWeight, italic: face.italic, format: face.format, data: face.data } : null;
}

/**
 * URL plus @font-face descriptors of the woff2 file for this family, weight and style, or the bytes of the uploaded font
 * with the same descriptors; null for unknown families.
 */
export async function fontFile(family: string, weight = 400, italic = false): Promise<FontFileInfo | null> {
  const hit = pickFace(family, weight, italic);
  if (!hit) return uploadedFile(family, weight, italic);
  try {
    const { default: url } = await hit.face.load();
    return { family, css: hit.def.css, url, minWeight: hit.face.min, maxWeight: hit.face.max, italic: hit.face.italic };
  } catch {
    return null;
  }
}

/** URL of the woff2 file for this family, weight and style (same asset the app loads), or null for unknown families. */
export async function fontFileUrl(family: string, weight = 400, italic = false): Promise<string | null> {
  return (await fontFile(family, weight, italic))?.url ?? null;
}
