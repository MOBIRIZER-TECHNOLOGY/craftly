/**
 * Font files for the tests of uploaded fonts, and a stand-in for the browser's FontFace.
 *
 * No real font is kept in the repository: `sfntBytes` writes the few tables the app reads (`name`, `OS/2`, `head`, and
 * `fvar` for a variable font) into a file that has the layout of a TrueType / OpenType font and no glyphs. jsdom has no
 * FontFace and no `document.fonts`, so `installFontFaces` provides both: a face "loads" unless its bytes say BROKEN, which
 * is how a test plays a file that has the right first bytes and still is no font.
 */
import { vi } from "vitest";

export interface SfntOptions {
  /** name id 1 */
  family?: string;
  /** name id 16, which wins over id 1 when it is there */
  typographicFamily?: string;
  weight?: number;
  italic?: boolean;
  /** the first four bytes: TrueType outlines or OpenType (CFF) ones */
  flavor?: "ttf" | "otf";
  /** a `wght` axis from..to makes it a variable font */
  range?: [number, number];
  /** leave these tables out */
  without?: Array<"name" | "OS/2" | "head">;
  /** write the names the way old Mac fonts did (one byte per character) and not as UTF-16 */
  macNames?: boolean;
}

const BROKEN = "BROKEN";
const ascii = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0));

function nameTable(names: Array<[number, string]>, mac: boolean): Uint8Array {
  const encoded = names.map(([, value]) => {
    if (mac) return ascii(value);
    const out = new Uint8Array(value.length * 2);
    for (let i = 0; i < value.length; i++) new DataView(out.buffer).setUint16(i * 2, value.charCodeAt(i));
    return out;
  });
  const stringOffset = 6 + names.length * 12;
  const table = new Uint8Array(stringOffset + encoded.reduce((sum, e) => sum + e.length, 0));
  const view = new DataView(table.buffer);
  view.setUint16(2, names.length);
  view.setUint16(4, stringOffset);
  let at = 0;
  names.forEach(([id], i) => {
    const record = 6 + i * 12;
    view.setUint16(record, mac ? 1 : 3); // platform: Macintosh or Windows
    view.setUint16(record + 2, mac ? 0 : 1); // encoding: Roman or Unicode BMP
    view.setUint16(record + 4, mac ? 0 : 0x409); // language: English
    view.setUint16(record + 6, id);
    view.setUint16(record + 8, encoded[i].length);
    view.setUint16(record + 10, at);
    table.set(encoded[i], stringOffset + at);
    at += encoded[i].length;
  });
  return table;
}

/** The bytes of a font file with the tables the app reads, and nothing to draw. */
export function sfntBytes(options: SfntOptions = {}): Uint8Array {
  const { family = "Acme Sans", typographicFamily, weight = 400, italic = false, flavor = "ttf", range, without = [], macNames = false } = options;
  const tables: Array<[string, Uint8Array]> = [];

  if (!without.includes("head")) {
    const head = new Uint8Array(54);
    new DataView(head.buffer).setUint16(44, italic ? 2 : 0); // macStyle
    tables.push(["head", head]);
  }
  if (!without.includes("OS/2")) {
    const os2 = new Uint8Array(78);
    new DataView(os2.buffer).setUint16(4, weight); // usWeightClass
    new DataView(os2.buffer).setUint16(62, italic ? 1 : 0); // fsSelection
    tables.push(["OS/2", os2]);
  }
  if (!without.includes("name")) {
    const names: Array<[number, string]> = [
      [1, family],
      [2, italic ? "Italic" : "Regular"],
    ];
    if (typographicFamily) names.push([16, typographicFamily]);
    tables.push(["name", nameTable(names, macNames)]);
  }
  if (range) {
    const fvar = new Uint8Array(16 + 20);
    const view = new DataView(fvar.buffer);
    view.setUint16(0, 1);
    view.setUint16(4, 16); // where the axes start
    view.setUint16(8, 1); // one axis
    view.setUint16(10, 20);
    fvar.set(ascii("wght"), 16);
    view.setInt32(20, range[0] * 65536);
    view.setInt32(24, weight * 65536);
    view.setInt32(28, range[1] * 65536);
    tables.push(["fvar", fvar]);
  }

  const directory = 12 + tables.length * 16;
  const file = new Uint8Array(directory + tables.reduce((sum, [, data]) => sum + data.length, 0));
  const view = new DataView(file.buffer);
  if (flavor === "otf") file.set(ascii("OTTO"), 0);
  else view.setUint32(0, 0x00010000);
  view.setUint16(4, tables.length);
  let offset = directory;
  tables.forEach(([tag, data], i) => {
    const record = 12 + i * 16;
    file.set(ascii(tag), record);
    view.setUint32(record + 8, offset);
    view.setUint32(record + 12, data.length);
    file.set(data, offset);
    offset += data.length;
  });
  return file;
}

/** A compressed web font as far as its first bytes go; what is inside cannot be read without unpacking it. */
export function woffBytes(kind: "woff" | "woff2" = "woff2", size = 64): Uint8Array {
  const file = new Uint8Array(size);
  file.set(ascii(kind === "woff" ? "wOFF" : "wOF2"), 0);
  return file;
}

/** The same file, marked so that the stand-in FontFace refuses it: the right first bytes, and still no font. */
export function brokenFont(bytes: Uint8Array): Uint8Array {
  const out = new Uint8Array(bytes.length + BROKEN.length);
  out.set(bytes);
  out.set(ascii(BROKEN), bytes.length);
  return out;
}

export function fontFileOf(name: string, bytes: Uint8Array, type = ""): File {
  return new File([bytes as BlobPart], name, { type });
}

export interface TestFace {
  family: string;
  source: string | ArrayBuffer;
  descriptors: FontFaceDescriptors;
}

export interface FontFaces {
  /** every face that was made, in order, whether or not it was added to the document */
  made: TestFace[];
  /** the faces `document.fonts` holds now */
  registered: Set<TestFace>;
  /** families (as registered) whose faces fail to load from now on */
  failing: Set<string>;
}

/** Puts a FontFace and a `document.fonts` in place until the globals are unstubbed (vi.unstubAllGlobals). */
export function installFontFaces(): FontFaces {
  const faces: FontFaces = { made: [], registered: new Set(), failing: new Set() };
  class TestFontFace implements TestFace {
    constructor(
      readonly family: string,
      readonly source: string | ArrayBuffer,
      readonly descriptors: FontFaceDescriptors = {},
    ) {
      faces.made.push(this);
    }
    load(): Promise<this> {
      const bytes = typeof this.source === "string" ? null : new Uint8Array(this.source);
      const tail = bytes ? String.fromCharCode(...bytes.subarray(Math.max(0, bytes.length - BROKEN.length))) : "";
      if (tail === BROKEN || faces.failing.has(this.family)) return Promise.reject(new DOMException("Not a font", "SyntaxError"));
      return Promise.resolve(this);
    }
  }
  vi.stubGlobal("FontFace", TestFontFace);
  const set = {
    add: (face: TestFace) => faces.registered.add(face),
    delete: (face: TestFace) => faces.registered.delete(face),
    has: (face: TestFace) => faces.registered.has(face),
  };
  if (typeof document === "undefined") vi.stubGlobal("document", { fonts: set });
  else Object.defineProperty(document, "fonts", { configurable: true, value: set });
  return faces;
}

/** Takes `document.fonts` away again in a jsdom test (the FontFace goes with vi.unstubAllGlobals). */
export function removeFontFaces(): void {
  vi.unstubAllGlobals();
  if (typeof document !== "undefined" && "fonts" in document) delete (document as unknown as { fonts?: unknown }).fonts;
}
