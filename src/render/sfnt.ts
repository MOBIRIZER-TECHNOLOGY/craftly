/**
 * A WOFF or WOFF2 font file rebuilt as the plain TrueType / OpenType file it was made from, for text to points (textOutline.ts).
 *
 * WHY. fontkit 2.0.4 reads both web formats, but sets the weight of a variable font only on a plain file: for a WOFF2 file its
 * `getVariation` reads the still compressed bytes as if they were a plain file (and fails), and its WOFF2 glyphs never apply the
 * variation data (a bold text would come out regular); for WOFF its `getVariation` makes the same mistake. Most fonts Craftly
 * ships are variable WOFF2 files. So the web file is rebuilt first, and fontkit reads that, by the path it has for plain files.
 *
 * HOW. Every table is taken as fontkit decompresses it. WOFF2 also changes the form of two tables, `glyf` (the outlines) and
 * `loca` (where each outline starts): they are written again from the outlines fontkit decodes, point for point and in the same
 * order, so the variation data (`gvar`), which is kept per point, still fits them. What is not kept: the hinting instructions of
 * each glyph (nothing here draws at small pixel sizes), the original flags of a composite glyph's parts other than their
 * placement and scale, and the bounding box of a composite glyph (written as zero; fontkit measures from the outline). Checksums
 * are not written; fontkit does not read them. Nothing of this leaves the tab: the rebuilt file is read once and dropped.
 */
import type { Font } from "fontkit";

/** The parts of fontkit's own objects that are read here. They are not its public API; fontkit is pinned to 2.0.4 for that reason. */
interface Point {
  x: number;
  y: number;
  onCurve: boolean;
  endContour: boolean;
}
interface Component {
  glyphID: number;
  dx: number;
  dy: number;
  scaleX: number;
  scaleY: number;
  scale01: number;
  scale10: number;
}
interface DecodedGlyph {
  numberOfContours?: number;
  points?: Point[];
  components?: Component[];
}
interface Entry {
  offset: number;
  length: number;
  transformed?: boolean;
}
interface Stream {
  buffer: Uint8Array;
  pos: number;
  readBuffer(length: number): Uint8Array;
}
interface WebFont {
  type: string;
  directory: { flavor?: number; tables: Record<string, Entry> };
  stream: Stream;
  _decompress?(): void;
  _transformGlyfTable?(): void;
  _transformedGlyphs?: DecodedGlyph[];
  _getTableStream?(tag: string): Stream | null;
}

/** The plain file of a WOFF or WOFF2 font that fontkit opened; null for a font that is a plain file already. */
export function plainFile(font: Font): Uint8Array | null {
  const web = font as unknown as WebFont;
  if (web.type === "WOFF2") return fromWoff2(web);
  if (web.type === "WOFF") return fromWoff(web);
  return null;
}

function fromWoff(font: WebFont): Uint8Array {
  const tables: Record<string, Uint8Array> = {};
  for (const [tag, entry] of Object.entries(font.directory.tables)) {
    const stream = font._getTableStream?.(tag);
    if (!stream) continue;
    // an uncompressed table is read from the file's own stream, which fontkit has put at the table's start
    tables[tag] = stream.readBuffer(entry.length).slice();
  }
  return sfnt(tables, font.directory.flavor);
}

function fromWoff2(font: WebFont): Uint8Array {
  font._decompress?.();
  const data = font.stream.buffer;
  const tables: Record<string, Uint8Array> = {};
  for (const [tag, entry] of Object.entries(font.directory.tables)) {
    if (entry.transformed && (tag === "glyf" || tag === "loca")) continue;
    tables[tag] = data.slice(entry.offset, entry.offset + entry.length);
  }
  if (font.directory.tables.glyf?.transformed) {
    if (!font._transformedGlyphs) font._transformGlyfTable?.();
    const glyphs = font._transformedGlyphs ?? [];
    const encoded = glyphs.map(encodeGlyph);
    const offsets = [0];
    for (const bytes of encoded) offsets.push(offsets[offsets.length - 1] + bytes.length);
    const glyf = new Uint8Array(offsets[offsets.length - 1]);
    encoded.forEach((bytes, i) => glyf.set(bytes, offsets[i]));
    const loca = new Uint8Array(offsets.length * 4);
    const view = new DataView(loca.buffer);
    offsets.forEach((offset, i) => view.setUint32(i * 4, offset));
    tables.glyf = glyf;
    tables.loca = loca;
    // the rebuilt `loca` has offsets of four bytes: `head` says so (indexToLocFormat, at byte 50)
    const head = tables.head.slice();
    new DataView(head.buffer).setInt16(50, 1);
    tables.head = head;
  }
  return sfnt(tables, font.directory.flavor);
}

/** One glyph in the `glyf` form of a plain file: a simple outline, or the parts of a composite glyph. Padded to four bytes. */
export function encodeGlyph(glyph: DecodedGlyph): Uint8Array {
  const out: number[] = [];
  const u16 = (v: number) => out.push((v >> 8) & 0xff, v & 0xff);
  const i16 = (v: number) => u16(Math.round(v) & 0xffff);
  const contours = glyph.numberOfContours ?? 0;
  if (contours > 0 && glyph.points?.length) {
    const points = glyph.points;
    let [xMin, yMin, xMax, yMax] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const p of points) {
      xMin = Math.min(xMin, p.x);
      yMin = Math.min(yMin, p.y);
      xMax = Math.max(xMax, p.x);
      yMax = Math.max(yMax, p.y);
    }
    i16(contours);
    i16(xMin);
    i16(yMin);
    i16(xMax);
    i16(yMax);
    points.forEach((p, i) => p.endContour && u16(i));
    u16(0); // no instructions
    for (const p of points) out.push(p.onCurve ? 1 : 0); // a flag a point, every coordinate two bytes
    let px = 0;
    for (const p of points) {
      i16(p.x - px);
      px = p.x;
    }
    let py = 0;
    for (const p of points) {
      i16(p.y - py);
      py = p.y;
    }
  } else if (contours < 0 && glyph.components?.length) {
    i16(-1);
    for (let i = 0; i < 4; i++) i16(0);
    const parts = glyph.components;
    parts.forEach((part, i) => {
      // ARG_1_AND_2_ARE_WORDS | ARGS_ARE_XY_VALUES, and MORE_COMPONENTS but for the last
      let flags = 0x0001 | 0x0002 | (i < parts.length - 1 ? 0x0020 : 0);
      let scale: number[] = [];
      if (part.scale01 || part.scale10) {
        flags |= 0x0080; // WE_HAVE_A_TWO_BY_TWO
        scale = [part.scaleX, part.scale01, part.scale10, part.scaleY];
      } else if (part.scaleX !== part.scaleY) {
        flags |= 0x0040; // WE_HAVE_AN_X_AND_Y_SCALE
        scale = [part.scaleX, part.scaleY];
      } else if (part.scaleX !== 1) {
        flags |= 0x0008; // WE_HAVE_A_SCALE
        scale = [part.scaleX];
      }
      u16(flags);
      u16(part.glyphID);
      i16(part.dx);
      i16(part.dy);
      for (const s of scale) i16(s * 16384); // F2DOT14
    });
  }
  while (out.length % 4) out.push(0);
  return Uint8Array.from(out);
}

/** A plain font file of these tables: the table directory sorted by tag, every table at a multiple of four bytes. */
export function sfnt(tables: Record<string, Uint8Array>, flavor = 0x00010000): Uint8Array {
  const tags = Object.keys(tables).sort();
  const count = tags.length;
  let offset = 12 + 16 * count;
  const records = tags.map((tag) => {
    const record = { tag, offset, length: tables[tag].length };
    offset += (tables[tag].length + 3) & ~3;
    return record;
  });
  const out = new Uint8Array(offset);
  const view = new DataView(out.buffer);
  const power = 2 ** Math.floor(Math.log2(count));
  view.setUint32(0, flavor);
  view.setUint16(4, count);
  view.setUint16(6, power * 16);
  view.setUint16(8, Math.log2(power));
  view.setUint16(10, count * 16 - power * 16);
  records.forEach((record, i) => {
    for (let k = 0; k < 4; k++) out[12 + i * 16 + k] = record.tag.charCodeAt(k);
    view.setUint32(12 + i * 16 + 8, record.offset);
    view.setUint32(12 + i * 16 + 12, record.length);
    out.set(tables[record.tag], record.offset);
  });
  return out;
}
