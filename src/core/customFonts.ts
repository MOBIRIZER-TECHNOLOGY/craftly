/**
 * Fonts a person uploaded: checking a file, keeping it, and telling the font catalogue (src/render/fonts.ts) about it.
 *
 * A font file is data. It is taken only when its first bytes say it is a font (src/core/fontFile.ts) and the browser's
 * FontFace can load it from those bytes, which parses the file and runs nothing; it is never written into a style sheet.
 * A file from a project file or a backup goes through the very same check (`importCustomFont`).
 *
 * The files live in the `meta` store of the library, one record per file under the key `customFont:<id>`, bytes
 * included. That needs no new version of the database (docs/MIGRATIONS.md): `meta` is a key/value store whose readers
 * ask for the keys they know, so an older release never sees these records and a newer one finds them where they are.
 * They are part of a backup (src/export/backup.ts) and travel inside a project file with the designs that use them.
 *
 * A family is the set of files that carry the same family name (regular, bold, italic ...). Documents store that name,
 * as they store the name of a bundled family, so a design that names a family this device does not have draws in the
 * fallback font and is not changed. A family can never have the name of a bundled one (`usableFamilyName`).
 */
import { getFontDef, isBundledFamily, setCustomFaces, trackCustomFonts, type CustomFace } from "@/render/fonts";
import { UNNAMED_FAMILY, cleanFamilyName, describeFontFile, fontProblem, type FontDescription, type FontFormat } from "./fontFile";
import { uid } from "./ids";
import { dbDelete, dbGet, dbGetAllKeys, dbPut } from "./persistence";
import type { Design, DesignElement } from "./types";

export interface CustomFontFile {
  id: string;
  /** the name the family is shown and stored in documents by */
  family: string;
  /** 100..900; the lightest weight of a variable font */
  weight: number;
  /** the heaviest weight of a variable font; equal to `weight` otherwise */
  maxWeight: number;
  italic: boolean;
  format: FontFormat;
  /** the name of the uploaded file, for the list in the brand kit */
  fileName: string;
  size: number;
  createdAt: number;
  /** the file, byte for byte */
  data: ArrayBuffer;
}

/** A font file was refused. The message is written for the person and reaches a toast as it is. */
export class FontUploadError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "FontUploadError";
  }
}

const KEY_PREFIX = "customFont:";
const FORMATS = new Set<string>(["ttf", "otf", "woff", "woff2"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
/** The family a trial face is made under. It is never added to the document, so the name is seen by nothing. */
const CHECK_FAMILY = "Craftly font check";

const listeners = new Set<() => void>();
/** Called after a font was added, renamed or deleted, once the catalogue knows about it. */
export const subscribeCustomFonts = (cb: () => void): (() => void) => {
  listeners.add(cb);
  return () => listeners.delete(cb);
};

/* ------------------------------------------------------------------ */
/* Checking                                                           */
/* ------------------------------------------------------------------ */

/**
 * Decides whether these bytes are a font this browser can use, and says what font. Throws `FontUploadError` in plain
 * words otherwise: not one of the four kinds, too large, or a file the browser's own font reader turns down. Where there
 * is no FontFace nothing can be checked, so nothing is taken.
 */
export async function checkFontBytes(bytes: Uint8Array, fileName: string): Promise<FontDescription> {
  const problem = fontProblem(bytes);
  if (problem !== null) throw new FontUploadError(problem);
  // (bytes without a problem are one of the four kinds, so they can be described)
  const described = describeFontFile(bytes, fileName) as FontDescription;
  if (typeof FontFace === "undefined") throw new FontUploadError("This browser cannot check font files, so the font was not added.");
  try {
    // a copy of exactly these bytes: the array may be a window into a larger file
    await new FontFace(CHECK_FAMILY, bytes.slice().buffer as ArrayBuffer).load();
  } catch {
    throw new FontUploadError("This file could not be read as a font. It may be damaged.");
  }
  return described;
}

/**
 * The name a family can have: one line of text, never empty, and never the name of a bundled family or the name one of
 * those is registered under (then "(uploaded)" is added), so that an uploaded font cannot pass for a bundled one.
 */
export function usableFamilyName(wanted: string): string {
  const name = cleanFamilyName(wanted) || UNNAMED_FAMILY;
  return isBundledFamily(name) ? `${name} (uploaded)` : name;
}

/** A weight as the document asks for it: 100 to 900 in steps of 100, regular for anything that is no number. */
function usableWeight(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 400;
  return Math.min(900, Math.max(100, Math.round(value / 100) * 100));
}

/* ------------------------------------------------------------------ */
/* Storage                                                            */
/* ------------------------------------------------------------------ */

function isFontRecord(value: unknown): value is CustomFontFile {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  // the bytes come back from the database as an ArrayBuffer of whatever realm stored them, so they are known by their shape
  const data = v.data as { byteLength?: unknown } | null | undefined;
  return (
    typeof v.id === "string" &&
    typeof v.family === "string" &&
    v.family.trim() !== "" &&
    typeof v.weight === "number" &&
    typeof v.maxWeight === "number" &&
    typeof v.italic === "boolean" &&
    typeof v.format === "string" &&
    FORMATS.has(v.format) &&
    typeof data === "object" &&
    data !== null &&
    typeof data.byteLength === "number"
  );
}

/** Every stored font file, oldest first. A record that is not a font file record is left out. */
export async function listCustomFonts(): Promise<CustomFontFile[]> {
  const keys = (await dbGetAllKeys("meta")).filter((key) => key.startsWith(KEY_PREFIX));
  const records = await Promise.all(keys.map((key) => dbGet<unknown>("meta", key)));
  return records.filter(isFontRecord).sort((a, b) => a.createdAt - b.createdAt || a.family.localeCompare(b.family) || a.weight - b.weight || a.id.localeCompare(b.id));
}

/** The ids of the stored font files, without reading the files. */
export async function customFontIds(): Promise<string[]> {
  return (await dbGetAllKeys("meta")).filter((key) => key.startsWith(KEY_PREFIX)).map((key) => key.slice(KEY_PREFIX.length));
}

export interface CustomFamily {
  family: string;
  /** upright before italic, lighter before heavier */
  files: CustomFontFile[];
}

/** The files grouped into families, by name. */
export function customFamilies(files: readonly CustomFontFile[]): CustomFamily[] {
  const byName = new Map<string, CustomFontFile[]>();
  for (const file of files) byName.set(file.family, [...(byName.get(file.family) ?? []), file]);
  return [...byName]
    .sort((a, b) => a[0].localeCompare(b[0], undefined, { sensitivity: "base" }))
    .map(([family, list]) => ({ family, files: list.sort((a, b) => Number(a.italic) - Number(b.italic) || a.weight - b.weight) }));
}

const toFace = (file: CustomFontFile): CustomFace => ({
  id: file.id,
  family: file.family,
  minWeight: file.weight,
  maxWeight: Math.max(file.weight, file.maxWeight),
  italic: file.italic,
  format: file.format,
  data: file.data,
});

/** Reads what is stored into the catalogue, then tells the screens. */
async function sync(): Promise<void> {
  setCustomFaces((await listCustomFonts()).map(toFace));
  listeners.forEach((listener) => listener());
}

let started: Promise<void> | null = null;

/**
 * Makes the stored fonts known to the catalogue; called once when the app starts (src/main.tsx). Never rejects: a
 * library that cannot be read has no uploaded fonts, and says so elsewhere. While the read is under way, drawing code
 * that waits for a font it does not know waits for the read (`trackCustomFonts`). `again` reads once more.
 */
export function startCustomFonts(again = false): Promise<void> {
  if (started && !again) return started;
  const reading = sync();
  trackCustomFonts(reading);
  started = reading.catch(() => undefined);
  return started;
}

const sameSlot = (a: Pick<CustomFontFile, "family" | "weight" | "maxWeight" | "italic">, b: Pick<CustomFontFile, "family" | "weight" | "maxWeight" | "italic">) =>
  a.family === b.family && a.weight === b.weight && a.maxWeight === b.maxWeight && a.italic === b.italic;

/**
 * Checks an uploaded file and adds it to the library. The family is the one the file names (or its file name, for a
 * compressed font) unless `family` gives another; a file for a weight and style the family already has replaces the
 * older file. Throws `FontUploadError` for a file that is refused.
 */
export async function addCustomFont(file: File, options: { family?: string } = {}): Promise<CustomFontFile> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const described = await checkFontBytes(bytes, file.name);
  const record: CustomFontFile = {
    id: uid("f"),
    family: usableFamilyName(options.family ?? described.family),
    weight: described.weight,
    maxWeight: described.maxWeight,
    italic: described.italic,
    format: described.format,
    fileName: file.name,
    size: bytes.length,
    createdAt: Date.now(),
    data: bytes.slice().buffer as ArrayBuffer,
  };
  const replaced = (await listCustomFonts()).filter((have) => sameSlot(have, record));
  await dbPut("meta", record, KEY_PREFIX + record.id);
  for (const old of replaced) await dbDelete("meta", KEY_PREFIX + old.id);
  await sync();
  return record;
}

export interface IncomingFont {
  bytes: Uint8Array;
  fileName: string;
  /** the family the file was used as where it comes from; the design that travels with it names this */
  family: string;
  weight: number;
  maxWeight: number;
  italic: boolean;
  /** a backup brings the id and date the file had */
  id?: string;
  createdAt?: number;
}

/**
 * A font that came inside a project file or a backup, which anybody can write by hand. It is checked exactly as an
 * upload is. "here": this device has that file, or one for the same family, weight and style, and keeps its own.
 * "refused": it is no usable font, or its family has no name or the name of a bundled family. Such a font is not
 * renamed, because the design beside it would still name the bundled family, and draws with that.
 */
export async function importCustomFont(font: IncomingFont): Promise<"added" | "here" | "refused"> {
  const family = cleanFamilyName(String(font.family ?? ""));
  if (!family || isBundledFamily(family)) return "refused";
  const weight = usableWeight(font.weight);
  const slot = { family, weight, maxWeight: Math.max(weight, usableWeight(font.maxWeight)), italic: font.italic === true };
  const id = typeof font.id === "string" && SAFE_ID.test(font.id) ? font.id : uid("f");
  const have = await listCustomFonts();
  if (have.some((file) => file.id === id || sameSlot(file, slot))) return "here";
  let described: FontDescription;
  try {
    described = await checkFontBytes(font.bytes, font.fileName);
  } catch {
    return "refused";
  }
  const record: CustomFontFile = {
    id,
    ...slot,
    format: described.format,
    fileName: cleanFamilyName(String(font.fileName ?? "")) || "font",
    size: font.bytes.length,
    createdAt: typeof font.createdAt === "number" && Number.isFinite(font.createdAt) ? font.createdAt : Date.now(),
    data: font.bytes.slice().buffer as ArrayBuffer,
  };
  await dbPut("meta", record, KEY_PREFIX + id);
  await sync();
  return "added";
}

/**
 * Gives a family another name and returns the name it got (see `usableFamilyName`). Designs are not touched: a text
 * that names the old family keeps naming it, and draws in the fallback font until it is given a font again.
 */
export async function renameCustomFamily(from: string, to: string): Promise<string> {
  const name = usableFamilyName(to);
  if (name === from) return name;
  const files = (await listCustomFonts()).filter((file) => file.family === from);
  for (const file of files) await dbPut("meta", { ...file, family: name }, KEY_PREFIX + file.id);
  await sync();
  return name;
}

/** Deletes every file of a family and returns how many there were. Designs that name the family are not touched. */
export async function deleteCustomFamily(family: string): Promise<number> {
  const files = (await listCustomFonts()).filter((file) => file.family === family);
  for (const file of files) await dbDelete("meta", KEY_PREFIX + file.id);
  await sync();
  return files.length;
}

/* ------------------------------------------------------------------ */
/* Designs                                                            */
/* ------------------------------------------------------------------ */

/** The font families a design names: its texts, the runs inside them, tables and charts, inside groups too. Each once, in order of first use. */
export function fontFamiliesOf(design: Pick<Design, "pages">): string[] {
  const families = new Set<string>();
  const visit = (el: DesignElement) => {
    if (el.type === "text") {
      families.add(el.fontFamily);
      for (const paragraph of el.paragraphs) for (const run of paragraph.runs) if (run.font) families.add(run.font);
    } else if (el.type === "table" || el.type === "chart") families.add(el.fontFamily);
    else if (el.type === "group") el.children.forEach(visit);
  };
  for (const page of design.pages) page.elements.forEach(visit);
  return [...families].filter((family) => typeof family === "string" && family !== "");
}

/**
 * The families a design names that the catalogue does not have: neither bundled nor uploaded on this device. Their text
 * is drawn in a substitute font (one of that name installed on the computer, if there is one, or a plain sans-serif).
 */
export function missingFontsOf(design: Pick<Design, "pages">): string[] {
  return fontFamiliesOf(design).filter((family) => getFontDef(family) === undefined);
}
