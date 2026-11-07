/**
 * A small hand written PDF 1.4 writer. Every page is one full-bleed JPEG image XObject
 * (/DCTDecode - the JPEG bytes are embedded untouched), optionally with /Link annotations on top, plus a
 * document /Info dictionary. Objects are numbered sequentially, every /Length is exact, and the
 * cross-reference table holds the real byte offset of each object.
 *
 * The writer never builds one giant string: it collects Uint8Array parts (the JPEGs are referenced as they
 * are) and `pdfBlob` hands them straight to the Blob constructor.
 */

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

/** Builds the PDF as a list of byte parts (the JPEGs are not copied). */
export function buildPdfParts(pages: PdfPageInput[], meta: PdfMeta = {}): PdfBuild {
  if (!pages.length) throw new Error("A PDF needs at least one page.");

  // object numbers: 1 catalog, 2 page tree, 3 info, then per page: page, contents, image, annotations...
  const plan = pages.map(() => ({ page: 0, contents: 0, image: 0, annots: [] as number[] }));
  let next = 4;
  pages.forEach((p, i) => {
    plan[i].page = next++;
    plan[i].contents = next++;
    plan[i].image = next++;
    for (let k = 0; k < (p.links?.length ?? 0); k++) plan[i].annots.push(next++);
  });
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
    const w = pdfNumber(page.widthPt);
    const h = pdfNumber(page.heightPt);
    const annots = ids.annots.length ? ` /Annots [${ids.annots.map((a) => `${a} 0 R`).join(" ")}]` : "";
    out.dict(
      ids.page,
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${ids.image} 0 R >> /ProcSet [/PDF ${procSet}] >> /Contents ${ids.contents} 0 R${annots} >>`,
    );
    out.stream(ids.contents, "", latin1(`q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`));
    out.stream(
      ids.image,
      `/Type /XObject /Subtype /Image /Width ${jpeg.width} /Height ${jpeg.height} /ColorSpace ${space} /BitsPerComponent ${jpeg.bits || 8} /Interpolate true /Filter /DCTDecode`,
      page.jpeg,
    );
    (page.links ?? []).forEach((link, k) => {
      const x2 = link.x + link.w;
      const y1 = page.heightPt - (link.y + link.h);
      const y2 = page.heightPt - link.y;
      out.dict(
        ids.annots[k],
        `<< /Type /Annot /Subtype /Link /Rect [${pdfNumber(link.x)} ${pdfNumber(y1)} ${pdfNumber(x2)} ${pdfNumber(y2)}] /Border [0 0 0] /F 4 /A << /S /URI /URI ${pdfUri(link.url)} >> >>`,
      );
    });
  });

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
