/**
 * A small hand written PDF 1.4 writer. Every page is one full-bleed JPEG image XObject
 * (/DCTDecode - the JPEG bytes are embedded untouched), optionally with /Link annotations on top, plus a
 * document /Info dictionary. Objects are numbered sequentially, every /Length is exact, and the
 * cross-reference table holds the real byte offset of each object.
 *
 * A page can carry its text as well: an invisible layer over the image (text rendering mode 3, the way a
 * scanned and recognised document is written), so the text of the picture can be selected, searched and
 * copied. The fonts of that layer are described in pdfFonts.ts; no font is embedded. A page without text is
 * written exactly as it was before the layer existed.
 *
 * The writer never builds one giant string: it collects Uint8Array parts (the JPEGs are referenced as they
 * are) and `pdfBlob` hands them straight to the Blob constructor.
 */
import { HELVETICA_DESCRIPTOR, PdfTextEncoder } from "./pdfFonts";

/** [a, b, c, d, e, f] as in CanvasRenderingContext2D.setTransform: x' = a x + c y + e, y' = b x + d y + f. */
export type PdfMatrix = readonly [number, number, number, number, number, number];

/** A stretch of a line that is placed and stretched as one: a word, the spaces between two words, a list marker. */
export interface PdfTextPiece {
  text: string;
  /** where it starts along the baseline, in the units of the line's matrix */
  x: number;
  /** how wide it is drawn on the page, same units: the piece is stretched (or squeezed) to exactly this */
  width: number;
  /** font size, same units */
  size: number;
}

export interface PdfTextLine {
  /**
   * Maps the line's own space (x along the baseline, y downwards, origin where the baseline starts) to PDF points
   * measured from the TOP-left of the page, so it holds the place, the turn and the scale of the line.
   */
  matrix: PdfMatrix;
  pieces: PdfTextPiece[];
}

export interface PdfLink {
  url: string;
  /** rectangle in PDF points measured from the TOP-left of the page */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface PdfPageInput {
  /** page size in points (1/72 inch) */
  widthPt: number;
  heightPt: number;
  /** a complete baseline / progressive JPEG file */
  jpeg: Uint8Array;
  links?: PdfLink[];
  /** the text of the page, in reading order: written invisibly over the image */
  text?: PdfTextLine[];
  /**
   * Print: how far the picture reaches beyond the design on every side, in points. The JPEG then shows the design
   * AND this bleed; `widthPt` / `heightPt` stay the size of the design, which becomes the page's /TrimBox, and the
   * page (/MediaBox) grows by the bleed on every side.
   */
  bleedPt?: number;
  /** Print: crop marks at the corners of the design. The page grows by CROP_MARK_ROOM_PT more on every side to hold them. */
  cropMarks?: boolean;
}

export interface PdfMeta {
  title?: string;
  author?: string;
  subject?: string;
  /** default "Craftly" */
  producer?: string;
  /** default: now */
  created?: Date;
  /** 16 bytes used for the trailer /ID (default: random) */
  id?: Uint8Array;
}

export interface PdfBuild {
  parts: Uint8Array[];
  length: number;
  /** byte offset of every object, index 0 = object 1 */
  offsets: number[];
  /** byte offset of the "xref" keyword */
  xrefOffset: number;
}

/* ------------------------------------------------------------------ */
/* JPEG                                                               */
/* ------------------------------------------------------------------ */

export interface JpegInfo {
  width: number;
  height: number;
  /** 1 = gray, 3 = YCbCr / RGB, 4 = CMYK */
  components: number;
  bits: number;
}

/** Reads the frame header (SOFn marker) of a JPEG file. Throws when the data is not a JPEG. */
export function parseJpegInfo(bytes: Uint8Array): JpegInfo {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) throw new Error("The page image is not a JPEG.");
  let i = 2;
  while (i + 3 < bytes.length) {
    if (bytes[i] !== 0xff) {
      i++;
      continue;
    }
    const marker = bytes[i + 1];
    if (marker === 0xff) {
      i++; // fill byte
      continue;
    }
    if (marker === 0x00 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      i += 2; // stuffing / TEM / RSTn / SOI carry no length
      continue;
    }
    if (marker === 0xd9) break; // EOI
    const length = (bytes[i + 2] << 8) | bytes[i + 3];
    const isFrame = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isFrame) {
      if (i + 9 >= bytes.length) break;
      return {
        bits: bytes[i + 4],
        height: (bytes[i + 5] << 8) | bytes[i + 6],
        width: (bytes[i + 7] << 8) | bytes[i + 8],
        components: bytes[i + 9],
      };
    }
    if (marker === 0xda) break; // SOS before any frame header
    i += 2 + length;
  }
  throw new Error("Could not read the size of the page image.");
}

/* ------------------------------------------------------------------ */
/* Primitive encoders                                                 */
/* ------------------------------------------------------------------ */

function latin1(text: string): Uint8Array {
  const out = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c > 255) throw new Error("PDF structure text must be Latin-1.");
    out[i] = c;
  }
  return out;
}

/** PDF number: at most 3 decimals, never exponent notation. */
export function pdfNumber(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : rounded.toFixed(3).replace(/\.?0+$/, "") || "0";
}

/** A text string object: a literal for printable ASCII, otherwise UTF-16BE with a byte order mark. */
export function pdfTextString(text: string): string {
  if (/^[\x20-\x7e]*$/.test(text)) return `(${text.replace(/[\\()]/g, "\\$&")})`;
  let hex = "FEFF";
  for (let i = 0; i < text.length; i++) hex += text.charCodeAt(i).toString(16).padStart(4, "0").toUpperCase();
  return `<${hex}>`;
}

/** A URI literal: 7-bit ASCII only (anything else is percent-encoded as UTF-8). */
export function pdfUri(url: string): string {
  let out = "";
  for (const ch of Array.from(url)) {
    const code = ch.codePointAt(0) ?? 0;
    if (code > 0x20 && code < 0x7f) out += ch;
    else {
      try {
        out += encodeURIComponent(ch);
      } catch {
        out += "%EF%BF%BD"; // lone surrogate
      }
    }
  }
  return `(${out.replace(/[\\()]/g, "\\$&")})`;
}

function pdfDate(date: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `D:${p(date.getUTCFullYear(), 4)}${p(date.getUTCMonth() + 1)}${p(date.getUTCDate())}${p(date.getUTCHours())}${p(date.getUTCMinutes())}${p(date.getUTCSeconds())}Z`;
}

function colorSpaceOf(components: number): { space: string; procSet: string } {
  if (components === 1) return { space: "/DeviceGray", procSet: "/ImageB" };
  if (components === 4) return { space: "/DeviceCMYK", procSet: "/ImageC" };
  return { space: "/DeviceRGB", procSet: "/ImageC" };
}

function randomId(): Uint8Array {
  const id = new Uint8Array(16);
  if (typeof crypto !== "undefined" && crypto.getRandomValues) crypto.getRandomValues(id);
  else for (let i = 0; i < id.length; i++) id[i] = Math.floor(Math.random() * 256);
  return id;
}

const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");

/* ------------------------------------------------------------------ */
/* Writer                                                             */
/* ------------------------------------------------------------------ */

class Sink {
  readonly parts: Uint8Array[] = [];
  length = 0;
  readonly offsets: number[] = [];

  text(s: string): void {
    this.bytes(latin1(s));
  }
  bytes(b: Uint8Array): void {
    this.parts.push(b);
    this.length += b.length;
  }
  /** Starts object `number` (1-based, must be written in order) and records its offset. */
  begin(number: number): void {
    if (number !== this.offsets.length + 1) throw new Error("PDF objects must be written in numerical order.");
    this.offsets.push(this.length);
    this.text(`${number} 0 obj\n`);
  }
  end(): void {
    this.text("endobj\n");
  }
  /** A complete object holding one dictionary. */
  dict(number: number, body: string): void {
    this.begin(number);
    this.text(`${body}\n`);
    this.end();
  }
  /** A complete stream object; /Length is computed from the data. */
  stream(number: number, entries: string, data: Uint8Array): void {
    this.begin(number);
    this.text(`<< ${entries ? `${entries} ` : ""}/Length ${data.length} >>\nstream\n`);
    this.bytes(data);
    this.text("\nendstream\n");
    this.end();
  }
}

interface TextLayer {
  /** content stream operators, one text object per line */
  ops: string;
  /** indices of the fonts the operators name */
  fonts: Set<number>;
}

/**
 * The operators of a page's invisible text, or null when the page has nothing to show.
 *
 * A line is one text object. Its matrix is turned from "points from the top-left, y down" into PDF space
 * (y up, origin bottom-left): [a b c d e f] becomes [a -b -c d e H-f]. Inside it every piece is moved to its own
 * x with Td (which counts from where the piece before started, not from where its glyphs ended, so a reader with
 * other glyph widths cannot drift) and stretched with Tz to the width it has in the picture: a selection then
 * covers the word that is seen, whatever font it was drawn in.
 */
function textLayer(lines: PdfTextLine[] | undefined, pageHeight: number, room: number, encoder: PdfTextEncoder): TextLayer | null {
  const fonts = new Set<number>();
  const blocks: string[] = [];
  for (const line of lines ?? []) {
    const [a, b, c, d, e, f] = line.matrix;
    const ops: string[] = [];
    let at = 0;
    let state = "";
    for (const piece of line.pieces) {
      const runs = encoder.encode(piece.text);
      if (!runs.length) continue;
      if (piece.x !== at) {
        ops.push(`${pdfNumber(piece.x - at)} 0 Td`);
        at = piece.x;
      }
      const natural = (runs.reduce((n, r) => n + r.width, 0) / 1000) * piece.size;
      const stretch = piece.width > 0 && natural > 0 ? (piece.width / natural) * 100 : 100;
      runs.forEach((run, i) => {
        fonts.add(run.font);
        const font = `/F${run.font} ${pdfNumber(piece.size)} Tf`;
        if (font !== state) ops.push((state = font));
        if (i === 0) ops.push(`${pdfNumber(stretch)} Tz`);
        ops.push(`<${run.hex}> Tj`);
      });
    }
    // `room` is what the page has grown by on every side (bleed, crop marks): the design, and its text, sit that far in
    if (ops.length) blocks.push(`BT 3 Tr ${[a, -b, -c, d, e + room, pageHeight - f + room].map(pdfNumber).join(" ")} Tm ${ops.join(" ")} ET`);
  }
  return blocks.length ? { ops: blocks.join("\n"), fonts } : null;
}

/* ------------------------------------------------------------------ */
/* Print: bleed and crop marks                                        */
/* ------------------------------------------------------------------ */

/** From the bleed (or, without one, from the edge of the design) to where a crop mark starts: a mark never touches the bleed. */
export const CROP_MARK_GAP_PT = 6;
export const CROP_MARK_LENGTH_PT = 18;
/** Room the page gets on every side for its crop marks: the gap, the mark, and a little so no mark ends on the edge of the sheet. */
export const CROP_MARK_ROOM_PT = CROP_MARK_GAP_PT + CROP_MARK_LENGTH_PT + 3;
const CROP_MARK_WIDTH_PT = 0.25;

/**
 * Registration colour: the special separation /All, which prints on every plate of the press, so the marks are on
 * each of them. A screen shows it through the alternate space, as CMYK 1 1 1 1.
 */
const REGISTRATION = "/ColorSpace << /CS0 [/Separation /All /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 1 1 1] /N 1 >>] >>";

/** How far the picture reaches beyond the design (the bleed) and how far the design sits from the edge of the page (the bleed and the room for marks). */
function frameOf(page: PdfPageInput): { bleed: number; room: number } {
  const bleed = typeof page.bleedPt === "number" && Number.isFinite(page.bleedPt) && page.bleedPt > 0 ? page.bleedPt : 0;
  return { bleed, room: bleed + (page.cropMarks ? CROP_MARK_ROOM_PT : 0) };
}

/**
 * Two marks at every corner of the design, each in line with one of its edges: a printer cuts along the lines they
 * point at. They start a gap beyond the bleed and so lie outside everything that is printed to be kept.
 */
function cropMarkOps(page: PdfPageInput, bleed: number, room: number): string {
  const [left, bottom, right, top] = [room, room, room + page.widthPt, room + page.heightPt];
  const near = bleed + CROP_MARK_GAP_PT;
  const far = near + CROP_MARK_LENGTH_PT;
  const lines = [
    [left - far, bottom, left - near, bottom],
    [right + near, bottom, right + far, bottom],
    [left - far, top, left - near, top],
    [right + near, top, right + far, top],
    [left, bottom - far, left, bottom - near],
    [left, top + near, left, top + far],
    [right, bottom - far, right, bottom - near],
    [right, top + near, right, top + far],
  ];
  const path = lines.map(([x1, y1, x2, y2]) => `${pdfNumber(x1)} ${pdfNumber(y1)} m ${pdfNumber(x2)} ${pdfNumber(y2)} l`).join(" ");
  return `q ${pdfNumber(CROP_MARK_WIDTH_PT)} w /CS0 CS 1 SCN ${path} S Q`;
}

/** Builds the PDF as a list of byte parts (the JPEGs are not copied). */
export function buildPdfParts(pages: PdfPageInput[], meta: PdfMeta = {}): PdfBuild {
  if (!pages.length) throw new Error("A PDF needs at least one page.");

  // the text of every page is encoded first: only then is it known which fonts the document needs
  const encoder = new PdfTextEncoder();
  const layers = pages.map((p) => textLayer(p.text, p.heightPt, frameOf(p).room, encoder));
  const fonts = encoder.fonts();

  // object numbers: 1 catalog, 2 page tree, 3 info, then per page: page, contents, image, annotations...
  // and after the last page, when there is text: the font descriptor, then a font and its ToUnicode map for each font
  const plan = pages.map(() => ({ page: 0, contents: 0, image: 0, annots: [] as number[] }));
  let next = 4;
  pages.forEach((p, i) => {
    plan[i].page = next++;
    plan[i].contents = next++;
    plan[i].image = next++;
    for (let k = 0; k < (p.links?.length ?? 0); k++) plan[i].annots.push(next++);
  });
  const descriptor = fonts.length ? next++ : 0;
  const fontPlan = new Map(fonts.map((font) => [font.index, { font: next++, cmap: next++ }]));
  const objectCount = next - 1;

  const out = new Sink();
  out.text("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");

  out.dict(1, `<< /Type /Catalog /Pages 2 0 R /ViewerPreferences << /DisplayDocTitle true >> >>`);
  out.dict(2, `<< /Type /Pages /Kids [${plan.map((p) => `${p.page} 0 R`).join(" ")}] /Count ${pages.length} >>`);

  const info = [`/Producer ${pdfTextString(meta.producer ?? "Craftly")}`, `/Creator ${pdfTextString("Craftly")}`, `/CreationDate (${pdfDate(meta.created ?? new Date())})`];
  if (meta.title) info.unshift(`/Title ${pdfTextString(meta.title)}`);
  if (meta.author) info.push(`/Author ${pdfTextString(meta.author)}`);
  if (meta.subject) info.push(`/Subject ${pdfTextString(meta.subject)}`);
  out.dict(3, `<< ${info.join(" ")} >>`);

  pages.forEach((page, i) => {
    const ids = plan[i];
    const jpeg = parseJpegInfo(page.jpeg);
    const { space, procSet } = colorSpaceOf(jpeg.components);
    // A page for a printer is larger than the design: the picture reaches `bleed` beyond it, and the design sits `room`
    // from the edge of the page. Without bleed and marks both are 0 and every number below is what it always was.
    const { bleed, room } = frameOf(page);
    const n = pdfNumber;
    const mediaBox = `[0 0 ${n(page.widthPt + room * 2)} ${n(page.heightPt + room * 2)}]`;
    const printBoxes = room
      ? ` /BleedBox [${n(room - bleed)} ${n(room - bleed)} ${n(room + page.widthPt + bleed)} ${n(room + page.heightPt + bleed)}] /TrimBox [${n(room)} ${n(room)} ${n(room + page.widthPt)} ${n(room + page.heightPt)}]`
      : "";
    const picture = `q ${n(page.widthPt + bleed * 2)} 0 0 ${n(page.heightPt + bleed * 2)} ${n(room - bleed)} ${n(room - bleed)} cm /Im0 Do Q`;
    const marks = page.cropMarks ? `\n${cropMarkOps(page, bleed, room)}` : "";
    const annots = ids.annots.length ? ` /Annots [${ids.annots.map((a) => `${a} 0 R`).join(" ")}]` : "";
    const layer = layers[i];
    const fontRefs = layer
      ? ` /Font << ${[...layer.fonts]
          .sort((x, y) => x - y)
          .map((index) => `/F${index} ${fontPlan.get(index)?.font} 0 R`)
          .join(" ")} >>`
      : "";
    out.dict(
      ids.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox ${mediaBox}${printBoxes} /Resources << /XObject << /Im0 ${ids.image} 0 R >>${fontRefs}${page.cropMarks ? ` ${REGISTRATION}` : ""} /ProcSet [/PDF ${layer ? "/Text " : ""}${procSet}] >> /Contents ${ids.contents} 0 R${annots} >>`,
    );
    out.stream(ids.contents, "", latin1(`${picture}${marks}${layer ? `\n${layer.ops}` : ""}`));
    out.stream(
      ids.image,
      `/Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace ${space} /BitsPerComponent ${jpeg.bits || 8} /Interpolate true /Filter /DCTDecode`,
      page.jpeg,
    );
    (page.links ?? []).forEach((link, k) => {
      const x1 = link.x + room;
      const x2 = x1 + link.w;
      const y1 = page.heightPt - (link.y + link.h) + room;
      const y2 = page.heightPt - link.y + room;
      out.dict(
        ids.annots[k],
        `<< /Type /Annot /Subtype /Link /Rect [${pdfNumber(x1)} ${pdfNumber(y1)} ${pdfNumber(x2)} ${pdfNumber(y2)}] /Border [0 0 0] /F 4 /A << /S /URI /URI ${pdfUri(link.url)} >> >>`,
      );
    });
  });

  if (descriptor) out.dict(descriptor, HELVETICA_DESCRIPTOR);
  for (const font of fonts) {
    const ids = fontPlan.get(font.index) as { font: number; cmap: number };
    out.dict(ids.font, font.dict(descriptor, ids.cmap));
    out.stream(ids.cmap, "", latin1(font.cmap));
  }

  const xrefOffset = out.length;
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`;
  for (const offset of out.offsets) xref += `${String(offset).padStart(10, "0")} 00000 n \n`;
  out.text(xref);
  const id = toHex(meta.id ?? randomId());
  out.text(`trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info 3 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  if (out.offsets.length !== objectCount) throw new Error("PDF object numbering is inconsistent.");
  return { parts: out.parts, length: out.length, offsets: out.offsets, xrefOffset };
}

/** The whole file as one byte array (tests, small documents). */
export function buildPdf(pages: PdfPageInput[], meta?: PdfMeta): Uint8Array {
  const { parts, length } = buildPdfParts(pages, meta);
  const out = new Uint8Array(length);
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
}

/** The file as a Blob (the parts are handed over without being joined first). */
export function pdfBlob(pages: PdfPageInput[], meta?: PdfMeta): Blob {
  return new Blob(buildPdfParts(pages, meta).parts as BlobPart[], { type: "application/pdf" });
}
