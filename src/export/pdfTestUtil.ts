/**
 * Reads back the PDFs the writer makes, for tests (node only: it inflates with node:zlib). Not a general PDF parser: it
 * follows the cross-reference table to every object and reads the plain dictionaries Craftly writes.
 */
import { inflateSync } from "node:zlib";

export interface PdfObject {
  number: number;
  /** the dictionary (or the whole body of an object without a stream), as text */
  dict: string;
  /** the bytes of the stream, as stored (not decoded) */
  stream?: Uint8Array;
}

const latin1 = (bytes: Uint8Array) => Buffer.from(bytes).toString("latin1");

/** Every object of the file, found through the xref table (which is so checked as well). */
export function readPdfObjects(bytes: Uint8Array): Map<number, PdfObject> {
  const text = latin1(bytes);
  const xref = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)?.[1]);
  const size = Number(text.slice(xref).match(/^xref\n0 (\d+)\n/)?.[1]);
  if (!Number.isFinite(xref) || !size) throw new Error("no xref table");
  const table = text.slice(xref + `xref\n0 ${size}\n`.length);
  const objects = new Map<number, PdfObject>();
  for (let n = 1; n < size; n++) {
    const offset = Number(table.slice(n * 20, n * 20 + 10));
    const head = `${n} 0 obj\n`;
    if (text.slice(offset, offset + head.length) !== head) throw new Error(`object ${n} is not at ${offset}`);
    const start = offset + head.length;
    const streamAt = text.indexOf(">>\nstream\n", start);
    const end = text.indexOf("endobj\n", start);
    if (streamAt >= 0 && streamAt < end) {
      const dict = text.slice(start, streamAt + 2);
      const length = Number(dict.match(/\/Length (\d+)/)?.[1]);
      const from = streamAt + ">>\nstream\n".length;
      if (text.slice(from + length, from + length + "\nendstream\n".length) !== "\nendstream\n") throw new Error(`the /Length of object ${n} is wrong`);
      objects.set(n, { number: n, dict, stream: bytes.subarray(from, from + length) });
    } else {
      objects.set(n, { number: n, dict: text.slice(start, end).trim() });
    }
  }
  return objects;
}

/** The numbers of a /Name [a b c d] entry. */
export function pdfBox(dict: string, name: string): number[] | undefined {
  return dict
    .match(new RegExp(`/${name} \\[([^\\]]*)\\]`))?.[1]
    .split(" ")
    .map(Number);
}

/** The value of a /Name entry that is a name or a number ("/DeviceCMYK", "8"). */
export const pdfEntry = (dict: string, name: string): string | undefined => dict.match(new RegExp(`/${name} (/?[\\w.]+)`))?.[1];

export interface PdfPageRead {
  page: PdfObject;
  /** the content stream, as text (it is never compressed) */
  content: string;
  image: PdfObject;
}

/** The pages in order, with their content and their image. */
export function readPdfPages(bytes: Uint8Array): PdfPageRead[] {
  const objects = readPdfObjects(bytes);
  const tree = [...objects.values()].find((o) => o.dict.includes("/Type /Pages"));
  if (!tree) throw new Error("no page tree");
  const kids = [...(tree.dict.match(/\/Kids \[([^\]]*)\]/)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map((m) => Number(m[1]));
  return kids.map((n) => {
    const page = objects.get(n) as PdfObject;
    const contents = objects.get(Number(page.dict.match(/\/Contents (\d+) 0 R/)?.[1])) as PdfObject;
    const image = objects.get(Number(page.dict.match(/\/Im0 (\d+) 0 R/)?.[1])) as PdfObject;
    return { page, content: latin1(contents.stream as Uint8Array), image };
  });
}

/** Undoes the PNG predictors (None, Sub, Up, Average, Paeth) of rows of `bpp`-byte pixels, as a PDF reader does. */
export function unpredict(bytes: Uint8Array, width: number, rows: number, bpp = 4): Uint8Array {
  const stride = width * bpp;
  const out = new Uint8Array(stride * rows);
  for (let row = 0; row < rows; row++) {
    const type = bytes[row * (stride + 1)];
    for (let i = 0; i < stride; i++) {
      const raw = bytes[row * (stride + 1) + 1 + i];
      const left = i >= bpp ? out[row * stride + i - bpp] : 0;
      const up = row > 0 ? out[(row - 1) * stride + i] : 0;
      const corner = row > 0 && i >= bpp ? out[(row - 1) * stride + i - bpp] : 0;
      let predicted = 0;
      if (type === 1) predicted = left;
      else if (type === 2) predicted = up;
      else if (type === 3) predicted = (left + up) >> 1;
      else if (type === 4) {
        const p = left + up - corner;
        const [pa, pb, pc] = [Math.abs(p - left), Math.abs(p - up), Math.abs(p - corner)];
        predicted = pa <= pb && pa <= pc ? left : pb <= pc ? up : corner;
      } else if (type !== 0) throw new Error(`unknown PNG filter ${type} in row ${row}`);
      out[row * stride + i] = (raw + predicted) & 0xff;
    }
  }
  return out;
}

/** The pixels of a /FlateDecode image (with or without predictor 15), `components` bytes each. */
export function decodeFlateImage(image: PdfObject): { width: number; height: number; components: number; pixels: Uint8Array } {
  const width = Number(pdfEntry(image.dict, "Width"));
  const height = Number(pdfEntry(image.dict, "Height"));
  const components = image.dict.includes("/DeviceCMYK") ? 4 : image.dict.includes("/DeviceGray") ? 1 : 3;
  const raw = new Uint8Array(inflateSync(image.stream as Uint8Array));
  const pixels = image.dict.includes("/Predictor 15") ? unpredict(raw, width, height, components) : raw;
  return { width, height, components, pixels };
}
