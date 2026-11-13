/**
 * The uploaded fonts of a `.craftly` project file. A design names a font family, as it names an uploaded picture by its
 * id; a file that left the font behind would open in a substitute font on every other device. So the file carries, next
 * to `design` and `assets`, the font files of every uploaded family the design names:
 *
 *   fonts: [{ family, weight, maxWeight, italic, fileName, dataUrl }]
 *
 * The list is optional: a design with bundled fonts only has none, a file from before has none, and a release from
 * before reads a file that has one and ignores it (the text then draws in a substitute font and the editor says which
 * font is missing). That is why it needed no new version of the file layout (docs/MIGRATIONS.md).
 *
 * A project file can be written by hand. A font in it is therefore checked exactly as an upload is, by its first bytes
 * and by loading it with FontFace, and is never stored under the name of a bundled family (`importCustomFont`). A font
 * that is refused does not stop the design from opening: the design keeps naming the family and says that it is missing.
 */
import { importCustomFont, fontFamiliesOf, listCustomFonts } from "@/core/customFonts";
import { FONT_MIME } from "@/core/fontFile";
import type { Design } from "@/core/types";
import { isCustomFamily } from "@/render/fonts";
import { bytesToBase64 } from "./encoding";
import { dataUrlToBytes } from "./projectFormat";

export interface ProjectFont {
  /** the family the design names */
  family: string;
  weight: number;
  /** above `weight` for a variable font */
  maxWeight: number;
  italic: boolean;
  fileName: string;
  /** the font file, base64 encoded */
  dataUrl: string;
}

/** More font files than a design plausibly uses; what a file lists beyond that is not looked at. */
export const MAX_PROJECT_FONTS = 64;

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const numberOr = (v: unknown, fallback: number): number => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

/**
 * The fonts a project file lists, as far as they have the shape of one: a family name and a `data:` address. Anything
 * else in the list, and a file with no list or that is no JSON at all, gives nothing; it never throws. Whether a listed
 * font really is one is decided when it is stored.
 */
export function readProjectFonts(text: string): ProjectFont[] {
  // most files carry no fonts: they are not read a second time for nothing
  if (!text.includes('"fonts"')) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return [];
  }
  if (!isObject(raw) || !Array.isArray(raw.fonts)) return [];
  const fonts: ProjectFont[] = [];
  for (const item of raw.fonts.slice(0, MAX_PROJECT_FONTS)) {
    if (!isObject(item) || typeof item.family !== "string" || typeof item.dataUrl !== "string" || !item.dataUrl.startsWith("data:")) continue;
    const weight = numberOr(item.weight, 400);
    fonts.push({
      family: item.family,
      weight,
      maxWeight: numberOr(item.maxWeight, weight),
      italic: item.italic === true,
      fileName: typeof item.fileName === "string" && item.fileName ? item.fileName : "font",
      dataUrl: item.dataUrl,
    });
  }
  return fonts;
}

/**
 * The font files a project file of this design has to carry: every file of every uploaded family the design names, so
 * that bold and italic text draws with the real faces on the other side too. The library is only read when the design
 * names an uploaded family at all.
 */
export async function collectProjectFonts(design: Pick<Design, "pages">): Promise<ProjectFont[]> {
  const families = new Set(fontFamiliesOf(design).filter(isCustomFamily));
  if (!families.size) return [];
  return (await listCustomFonts())
    .filter((file) => families.has(file.family))
    .map((file) => ({
      family: file.family,
      weight: file.weight,
      maxWeight: file.maxWeight,
      italic: file.italic,
      fileName: file.fileName,
      dataUrl: `data:${FONT_MIME[file.format]};base64,${bytesToBase64(new Uint8Array(file.data))}`,
    }));
}

/**
 * Stores the fonts of a project file that this device does not have, each checked as an upload is. Never throws: a
 * font that is refused, or cannot be stored, is left out and the design opens without it.
 */
export async function storeProjectFonts(fonts: readonly ProjectFont[]): Promise<void> {
  for (const font of fonts) {
    const decoded = dataUrlToBytes(font.dataUrl);
    if (!decoded) continue;
    try {
      await importCustomFont({ bytes: decoded.bytes, fileName: font.fileName, family: font.family, weight: font.weight, maxWeight: font.maxWeight, italic: font.italic });
    } catch {
      // the library could not take it (no room, closed): the design is what matters, and it says which font is missing
    }
  }
}
