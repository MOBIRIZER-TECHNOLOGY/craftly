/**
 * What can be said about an uploaded font file from its bytes and its name, without a browser: which of the four kinds
 * it is, and for a TrueType / OpenType file the family, weight and style its own tables give. Pure, so it is unit
 * tested in node; `customFonts.ts` adds the check that the browser can really load the file, and the storage.
 *
 * A file is known by its first four bytes, never by its name or the type it came with: both are whatever the sender
 * says. The reader below only ever looks inside the bytes it was given: every offset a file states is checked against
 * the length of the file, so a file that lies about itself yields "unknown" and nothing else.
 *
 * WOFF and WOFF2 are compressed, so their tables are not read here. For those the family, weight and style come from
 * the file name ("AcmeSans-BoldItalic.woff2"), and the person can rename the family afterwards.
 */

export type FontFormat = "ttf" | "otf" | "woff" | "woff2";

export const MAX_FONT_BYTES = 10 * 1024 * 1024;
/** The `accept` of the file field. It only narrows what the file dialog shows; the bytes decide. */
export const FONT_ACCEPT = ".ttf,.otf,.woff,.woff2";
export const FONT_MIME: Record<FontFormat, string> = { ttf: "font/ttf", otf: "font/otf", woff: "font/woff", woff2: "font/woff2" };
/** The name of a family whose file says nothing usable about itself. */
export const UNNAMED_FAMILY = "Custom font";

const MAX_NAME_LENGTH = 60;
/** More tables than any real font has: a file that states more is not read. */
const MAX_TABLES = 256;

const tag = (bytes: Uint8Array, at: number) => String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3]);

/** The kind of font file the first four bytes announce, "collection" for several fonts in one file, null for anything else. */
export function sniffFontFormat(bytes: Uint8Array): FontFormat | "collection" | null {
  if (bytes.length < 4) return null;
  const magic = tag(bytes, 0);
  if (magic === "\u0000\u0001\u0000\u0000" || magic === "true") return "ttf";
  if (magic === "OTTO") return "otf";
  if (magic === "wOFF") return "woff";
  if (magic === "wOF2") return "woff2";
  if (magic === "ttcf") return "collection";
  return null;
}

/** Why these bytes are not taken as a font, in words for the person; null when nothing here speaks against them. */
export function fontProblem(bytes: Uint8Array): string | null {
  if (bytes.length === 0) return "This file is empty.";
  if (bytes.length > MAX_FONT_BYTES) return "This font file is larger than 10 MB.";
  const format = sniffFontFormat(bytes);
  if (format === "collection") return "This file holds several fonts in one (a font collection). Upload each font as its own .ttf or .otf file.";
  if (format === null) return "This is not a font file. Craftly takes .ttf, .otf, .woff and .woff2 files.";
  return null;
}

/** A family name as it is stored and shown: one line, no control characters, at most 60 characters. May be empty. */
export function cleanFamilyName(name: string): string {
  return (
    String(name)
      // eslint-disable-next-line no-control-regex -- control characters are exactly what must not be in a name
      .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, MAX_NAME_LENGTH)
      .trim()
  );
}

/** The document asks for weights from 100 to 900 in steps of 100; anything a file states is brought onto that scale. */
function toWeight(value: number): number {
  if (!(value >= 1 && value <= 1000)) return 400;
  return Math.min(900, Math.max(100, Math.round(value / 100) * 100));
}

/* ------------------------------------------------------------------ */
/* TrueType / OpenType tables                                         */
/* ------------------------------------------------------------------ */

export interface SfntInfo {
  /** null when the file has no usable name */
  family: string | null;
  /** the weight, or the lightest weight of a variable font; null when the file does not say */
  weight: number | null;
  /** the heaviest weight of a variable font; the same as `weight` for any other */
  maxWeight: number | null;
  italic: boolean | null;
}

function decodeName(bytes: Uint8Array, platform: number): string {
  let out = "";
  if (platform === 1) for (const byte of bytes) out += String.fromCharCode(byte);
  else for (let i = 0; i + 1 < bytes.length; i += 2) out += String.fromCharCode((bytes[i] << 8) | bytes[i + 1]);
  return cleanFamilyName(out);
}

/** The family name of a `name` table: the typographic family (id 16) before the plain one (id 1), Windows English first. */
function familyOf(table: Uint8Array): string | null {
  if (table.length < 6) return null;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const count = view.getUint16(2);
  const strings = view.getUint16(4);
  let best: { score: number; name: string } | null = null;
  for (let i = 0; i < count; i++) {
    const record = 6 + i * 12;
    if (record + 12 > table.length) break;
    const platform = view.getUint16(record);
    const id = view.getUint16(record + 6);
    if (id !== 1 && id !== 16) continue;
    if (platform !== 0 && platform !== 1 && platform !== 3) continue;
    const start = strings + view.getUint16(record + 10);
    const end = start + view.getUint16(record + 8);
    if (end > table.length) continue;
    const score = (id === 16 ? 10 : 0) + (platform === 3 ? (view.getUint16(record + 4) === 0x409 ? 3 : 2) : platform === 0 ? 1 : 0);
    if (best && best.score >= score) continue;
    const name = decodeName(table.subarray(start, end), platform);
    if (name) best = { score, name };
  }
  return best?.name ?? null;
}

/** The weights a `wght` axis spans, when the `fvar` table has one. */
function weightAxis(table: Uint8Array): [number, number] | null {
  if (table.length < 16) return null;
  const view = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const axes = view.getUint16(4);
  const count = view.getUint16(8);
  const size = view.getUint16(10);
  if (size < 20) return null;
  for (let i = 0; i < count; i++) {
    const at = axes + i * size;
    if (at + 20 > table.length) break;
    // the two bounds are 16.16 fixed point numbers
    if (tag(table, at) === "wght") return [view.getInt32(at + 4) / 65536, view.getInt32(at + 12) / 65536];
  }
  return null;
}

/**
 * Family, weight and style as the tables of a TrueType or OpenType file give them. Null for any other kind of file and
 * for one whose table list is cut short; a single table that is missing or lies outside the file only leaves its own
 * answers out.
 */
export function readSfnt(bytes: Uint8Array): SfntInfo | null {
  const format = sniffFontFormat(bytes);
  if (format !== "ttf" && format !== "otf") return null;
  if (bytes.length < 12) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getUint16(4);
  if (count > MAX_TABLES || 12 + count * 16 > bytes.length) return null;
  const tables = new Map<string, Uint8Array>();
  for (let i = 0; i < count; i++) {
    const record = 12 + i * 16;
    const offset = view.getUint32(record + 8);
    const length = view.getUint32(record + 12);
    if (offset + length <= bytes.length) tables.set(tag(bytes, record), bytes.subarray(offset, offset + length));
  }

  const name = tables.get("name");
  const os2 = tables.get("OS/2");
  const head = tables.get("head");
  const fvar = tables.get("fvar");
  const at16 = (table: Uint8Array, at: number) => new DataView(table.buffer, table.byteOffset, table.byteLength).getUint16(at);

  let weight = os2 && os2.length >= 6 ? toWeight(at16(os2, 4)) : null;
  let maxWeight = weight;
  const axis = fvar ? weightAxis(fvar) : null;
  if (axis && axis[1] > axis[0]) {
    weight = toWeight(axis[0]);
    maxWeight = toWeight(axis[1]);
  }
  // fsSelection of OS/2 says italic in its first bit, macStyle of head in its second
  const italic = os2 && os2.length >= 64 ? (at16(os2, 62) & 1) === 1 : head && head.length >= 46 ? (at16(head, 44) & 2) === 2 : null;
  return { family: name ? familyOf(name) : null, weight, maxWeight, italic };
}

/* ------------------------------------------------------------------ */
/* File names                                                         */
/* ------------------------------------------------------------------ */

/** The words a file name ends with to say its weight or style, the longer ones first so that "ExtraBold" is not read as "Bold". */
const STYLE_WORDS: Array<[string, number | "italic"]> = [
  ["extra bold", 800],
  ["extra-bold", 800],
  ["ultra bold", 800],
  ["ultra-bold", 800],
  ["extrabold", 800],
  ["ultrabold", 800],
  ["extra light", 200],
  ["extra-light", 200],
  ["ultra light", 200],
  ["ultra-light", 200],
  ["extralight", 200],
  ["ultralight", 200],
  ["semi bold", 600],
  ["semi-bold", 600],
  ["demi bold", 600],
  ["demi-bold", 600],
  ["semibold", 600],
  ["demibold", 600],
  ["hairline", 100],
  ["regular", 400],
  ["oblique", "italic"],
  ["italic", "italic"],
  ["medium", 500],
  ["normal", 400],
  ["black", 900],
  ["heavy", 900],
  ["light", 300],
  ["roman", 400],
  ["thin", 100],
  ["bold", 700],
  ["book", 400],
];

/**
 * Family, weight and style as a file name gives them: "AcmeSans-BoldItalic.woff2" is the family "AcmeSans", bold, italic.
 * A style word counts only at the end of the name and only as a word of its own (after a space, a hyphen, or a capital
 * that follows a small letter), so "Highlight.ttf" stays "Highlight".
 */
export function fromFileName(name: string): { family: string; weight: number; italic: boolean } {
  const dot = name.lastIndexOf(".");
  let rest = (dot >= 0 ? name.slice(0, dot) : name).replace(/_/g, " ").trim();
  let weight: number | null = null;
  let italic = false;
  let after = false; // a style word was just taken off: the next one may be glued to it ("BoldItalic")
  for (let found = true; found && rest;) {
    found = false;
    const lower = rest.toLowerCase();
    for (const [word, meaning] of STYLE_WORDS) {
      if (!lower.endsWith(word)) continue;
      const start = rest.length - word.length;
      const before = rest[start - 1];
      const ownWord = start === 0 || /[-\s]/.test(before) || (/[a-z]/.test(before) && /[A-Z]/.test(rest[start])) || (after && /[A-Z]/.test(rest[start]));
      if (!ownWord) continue;
      if (meaning === "italic") italic = true;
      else weight ??= meaning;
      rest = rest.slice(0, start);
      after = !/[-\s]$/.test(rest);
      rest = rest.replace(/[-\s]+$/, "");
      found = true;
      break;
    }
  }
  return { family: cleanFamilyName(rest) || UNNAMED_FAMILY, weight: weight ?? 400, italic };
}

/* ------------------------------------------------------------------ */
/* Both together                                                      */
/* ------------------------------------------------------------------ */

export interface FontDescription {
  format: FontFormat;
  family: string;
  /** the weight, or the lightest one of a variable font */
  weight: number;
  /** the heaviest weight of a variable font; equal to `weight` otherwise */
  maxWeight: number;
  italic: boolean;
}

/**
 * What an uploaded file is: its kind from its first bytes, and family, weight and style from its tables where they can be
 * read (TrueType, OpenType) and from its name where they cannot (WOFF, WOFF2, or a table that is missing). Null for a
 * file that is none of the four kinds. That the file really is a font the browser can use is not decided here.
 */
export function describeFontFile(bytes: Uint8Array, fileName: string): FontDescription | null {
  const format = sniffFontFormat(bytes);
  if (format === null || format === "collection") return null;
  const inside = readSfnt(bytes);
  const named = fromFileName(fileName);
  const weight = inside?.weight ?? named.weight;
  return {
    format,
    family: inside?.family ?? named.family,
    weight,
    maxWeight: inside?.maxWeight ?? weight,
    italic: inside?.italic ?? named.italic,
  };
}
