import { describe, expect, it } from "vitest";
import { buildPdf, buildPdfParts, parseJpegInfo, pdfBlob, pdfNumber, pdfTextString, pdfUri, type PdfPageInput } from "./pdf";

/** A structurally valid JPEG skeleton: SOI, APP0, DQT, SOF0 (w x h, n components), DHT-less SOS, data, EOI. */
function fakeJpeg(width: number, height: number, components = 3, payload = 40): Uint8Array {
  const bytes: number[] = [0xff, 0xd8];
  bytes.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00); // APP0 JFIF
  bytes.push(0xff, 0xdb, 0x00, 0x05, 0x00, 0x08, 0xff); // DQT whose data contains an 0xff byte
  const sofLen = 8 + components * 3;
  bytes.push(0xff, 0xc0, sofLen >> 8, sofLen & 0xff, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components);
  for (let c = 0; c < components; c++) bytes.push(c + 1, 0x11, 0);
  bytes.push(0xff, 0xda, 0x00, 0x03, 0x01); // SOS
  for (let i = 0; i < payload; i++) bytes.push((i * 37 + 11) & 0xfe); // entropy coded data (no 0xff)
  bytes.push(0xff, 0xd9);
  return Uint8Array.from(bytes);
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

interface ParsedPdf {
  text: string;
  xrefOffset: number;
  size: number;
  entries: Array<{ offset: number; gen: number; kind: string; raw: string }>;
}

/** Independent parser: follows startxref -> xref table -> objects, like a real reader would. */
function parsePdf(bytes: Uint8Array): ParsedPdf {
  const text = latin1(bytes);
  expect(text.startsWith("%PDF-1.4\n")).toBe(true);
  expect(text.endsWith("%%EOF\n")).toBe(true);
  const start = text.match(/startxref\n(\d+)\n%%EOF\n$/);
  expect(start, "startxref").not.toBeNull();
  const xrefOffset = Number(start![1]);
  expect(text.slice(xrefOffset, xrefOffset + 5)).toBe("xref\n");
  const head = text.slice(xrefOffset).match(/^xref\n0 (\d+)\n/);
  expect(head, "xref subsection header").not.toBeNull();
  const size = Number(head![1]);
  let at = xrefOffset + head![0].length;
  const entries: ParsedPdf["entries"] = [];
  for (let i = 0; i < size; i++) {
    const raw = text.slice(at, at + 20);
    expect(raw, `xref entry ${i} is exactly 20 bytes`).toMatch(/^\d{10} \d{5} [nf] \n$/);
    entries.push({ offset: Number(raw.slice(0, 10)), gen: Number(raw.slice(11, 16)), kind: raw[17], raw });
    at += 20;
  }
  expect(text.slice(at, at + 8)).toBe("trailer\n");
  return { text, xrefOffset, size, entries };
}

const page = (w: number, h: number, extra: Partial<PdfPageInput> = {}): PdfPageInput => ({
  widthPt: w,
  heightPt: h,
  jpeg: fakeJpeg(Math.round(w * 2), Math.round(h * 2)),
  ...extra,
});

describe("parseJpegInfo", () => {
  it("reads size and component count from the frame header", () => {
    expect(parseJpegInfo(fakeJpeg(1920, 1080))).toEqual({ width: 1920, height: 1080, components: 3, bits: 8 });
    expect(parseJpegInfo(fakeJpeg(300, 200, 1))).toMatchObject({ width: 300, height: 200, components: 1 });
    expect(parseJpegInfo(fakeJpeg(8192, 4608, 4))).toMatchObject({ width: 8192, height: 4608, components: 4 });
  });

  it("rejects anything that is not a JPEG", () => {
    expect(() => parseJpegInfo(new Uint8Array([0x89, 0x50, 0x4e, 0x47]))).toThrow(/not a JPEG/);
    expect(() => parseJpegInfo(new Uint8Array([0xff, 0xd8, 0xff, 0xd9]))).toThrow(/Could not read/);
  });
});

describe("primitive encoders", () => {
  it("formats numbers without exponents or trailing zeros", () => {
    expect(pdfNumber(0)).toBe("0");
    expect(pdfNumber(1440)).toBe("1440");
    expect(pdfNumber(595.2756)).toBe("595.276");
    expect(pdfNumber(10.5)).toBe("10.5");
    expect(pdfNumber(-0.0001)).toBe("0");
    expect(pdfNumber(1e-9)).toBe("0");
    expect(pdfNumber(Number.NaN)).toBe("0");
  });

  it("escapes literal strings and switches to UTF-16BE for non-ASCII text", () => {
    expect(pdfTextString("Plain (title) \\ ok")).toBe("(Plain \\(title\\) \\\\ ok)");
    expect(pdfTextString("Café")).toBe("<FEFF00430061006600E9>");
    expect(pdfTextString("日本")).toBe("<FEFF65E5672C>");
    expect(pdfTextString("")).toBe("()");
  });

  it("keeps URIs 7-bit", () => {
    expect(pdfUri("https://example.com/a b")).toBe("(https://example.com/a%20b)");
    expect(pdfUri("https://例え.jp/é")).toBe("(https://%E4%BE%8B%E3%81%88.jp/%C3%A9)");
    expect(pdfUri("https://x.com/(a)")).toBe("(https://x.com/\\(a\\))");
  });
});

describe("buildPdf", () => {
  const pages = [page(1440, 810), page(595.5, 842.25), page(300, 300)];
  const bytes = buildPdf(pages, { title: "My design", id: new Uint8Array(16).fill(0xab), created: new Date(Date.UTC(2026, 10, 4, 12, 30, 5)) });
  const pdf = parsePdf(bytes);

  it("has a header with a binary comment, a trailer and the right object count", () => {
    expect(latin1(bytes.subarray(0, 15))).toBe("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
    // 3 fixed objects + 3 per page
    expect(pdf.size).toBe(1 + 3 + 3 * pages.length);
    expect(pdf.text).toContain(`/Size ${pdf.size} /Root 1 0 R /Info 3 0 R`);
    expect(pdf.text).toContain(`/ID [<${"ab".repeat(16)}> <${"ab".repeat(16)}>]`);
  });

  it("points every xref entry at the start of its object", () => {
    expect(pdf.entries[0]).toMatchObject({ offset: 0, gen: 65535, kind: "f" });
    for (let n = 1; n < pdf.size; n++) {
      const entry = pdf.entries[n];
      expect(entry.kind).toBe("n");
      expect(entry.gen).toBe(0);
      expect(pdf.text.slice(entry.offset, entry.offset + `${n} 0 obj\n`.length), `object ${n}`).toBe(`${n} 0 obj\n`);
    }
    // offsets strictly increase and the xref table starts right after the last object
    for (let n = 2; n < pdf.size; n++) expect(pdf.entries[n].offset).toBeGreaterThan(pdf.entries[n - 1].offset);
    const last = pdf.entries[pdf.size - 1].offset;
    expect(pdf.text.indexOf("endobj\n", last) + "endobj\n".length).toBe(pdf.xrefOffset);
  });

  it("builds a catalog -> page tree -> pages structure with the right page count and sizes", () => {
    expect(pdf.text).toContain("1 0 obj\n<< /Type /Catalog /Pages 2 0 R");
    expect(pdf.text).toContain(`/Type /Pages /Kids [4 0 R 7 0 R 10 0 R] /Count 3 >>`);
    expect((pdf.text.match(/\/Type \/Page /g) ?? []).length).toBe(3);
    expect(pdf.text).toContain("/MediaBox [0 0 1440 810]");
    expect(pdf.text).toContain("/MediaBox [0 0 595.5 842.25]");
    expect(pdf.text).toContain("/MediaBox [0 0 300 300]");
    expect(pdf.text).toContain("q 1440 0 0 810 0 0 cm /Im0 Do Q");
  });

  it("writes /Info with the title (as text), producer and a UTC date", () => {
    expect(pdf.text).toContain("/Title (My design)");
    expect(pdf.text).toContain("/Producer (Craftly)");
    expect(pdf.text).toContain("/CreationDate (D:20261104123005Z)");
  });

  it("embeds each JPEG untouched with an exact /Length", () => {
    const re = /\/Subtype \/Image \/Width (\d+) \/Height (\d+) \/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Interpolate true \/Filter \/DCTDecode \/Length (\d+) >>\nstream\n/g;
    const found: number[] = [];
    let m: RegExpExecArray | null;
    let index = 0;
    while ((m = re.exec(pdf.text))) {
      const length = Number(m[3]);
      const dataStart = m.index + m[0].length;
      expect(pdf.text.slice(dataStart + length, dataStart + length + 17)).toBe("\nendstream\nendobj");
      expect(bytes.subarray(dataStart, dataStart + length)).toEqual(pages[index].jpeg);
      expect(Number(m[1])).toBe(Math.round(pages[index].widthPt * 2));
      found.push(length);
      index++;
    }
    expect(found).toHaveLength(3);
  });

  it("uses exact lengths for the content streams too", () => {
    const re = /<< \/Length (\d+) >>\nstream\n/g;
    let m: RegExpExecArray | null;
    let n = 0;
    while ((m = re.exec(pdf.text))) {
      const length = Number(m[1]);
      const body = pdf.text.slice(m.index + m[0].length, m.index + m[0].length + length);
      expect(body).toMatch(/^q [\d.]+ 0 0 [\d.]+ 0 0 cm \/Im0 Do Q$/);
      n++;
    }
    expect(n).toBe(3);
  });

  it("is a pure function of its input", () => {
    const again = buildPdf(pages, { title: "My design", id: new Uint8Array(16).fill(0xab), created: new Date(Date.UTC(2026, 10, 4, 12, 30, 5)) });
    expect(again).toEqual(bytes);
  });
});

describe("pdf features", () => {
  it("adds link annotations with the rectangle flipped to PDF space", () => {
    const bytes = buildPdf(
      [
        page(400, 300, {
          links: [
            { url: "https://craftly.test/a b", x: 10, y: 20, w: 100, h: 50 },
            { url: "mailto:hi@example.com", x: 0, y: 0, w: 5, h: 5 },
          ],
        }),
      ],
      { id: new Uint8Array(16) },
    );
    const pdf = parsePdf(bytes);
    // page 4, contents 5, image 6, annotations 7 and 8
    expect(pdf.size).toBe(1 + 3 + 3 + 2);
    expect(pdf.text).toContain("/Annots [7 0 R 8 0 R]");
    expect(pdf.text).toContain("/Subtype /Link /Rect [10 230 110 280] /Border [0 0 0] /F 4 /A << /S /URI /URI (https://craftly.test/a%20b) >>");
    expect(pdf.text).toContain("/Rect [0 295 5 300]");
  });

  it("uses UTF-16 for non-Latin titles", () => {
    const pdf = parsePdf(buildPdf([page(100, 100)], { title: "Menü – 日本", id: new Uint8Array(16) }));
    expect(pdf.text).toMatch(/\/Title <FEFF[0-9A-F]+>/);
  });

  it("omits /Title when none is given and honours gray images", () => {
    const pdf = parsePdf(buildPdf([{ widthPt: 50, heightPt: 50, jpeg: fakeJpeg(100, 100, 1) }], { id: new Uint8Array(16) }));
    expect(pdf.text).not.toContain("/Title");
    expect(pdf.text).toContain("/ColorSpace /DeviceGray");
    expect(pdf.text).toContain("/ProcSet [/PDF /ImageB]");
  });

  it("refuses an empty document and non-JPEG pages", () => {
    expect(() => buildPdf([])).toThrow(/at least one page/);
    expect(() => buildPdf([{ widthPt: 10, heightPt: 10, jpeg: new Uint8Array([1, 2, 3, 4]) }])).toThrow(/not a JPEG/);
  });

  it("buildPdfParts reports the total length and the xref position", () => {
    const build = buildPdfParts([page(100, 100)], { id: new Uint8Array(16) });
    expect(build.parts.reduce((n, p) => n + p.length, 0)).toBe(build.length);
    expect(build.offsets).toHaveLength(6);
    const text = latin1(buildPdf([page(100, 100)], { id: new Uint8Array(16) }));
    expect(text.slice(build.xrefOffset, build.xrefOffset + 4)).toBe("xref");
  });

  it("pdfBlob returns an application/pdf Blob of the same bytes", async () => {
    const meta = { id: new Uint8Array(16), created: new Date(0) };
    const blob = pdfBlob([page(120, 80)], meta);
    expect(blob.type).toBe("application/pdf");
    expect(new Uint8Array(await blob.arrayBuffer())).toEqual(buildPdf([page(120, 80)], meta));
  });
});
