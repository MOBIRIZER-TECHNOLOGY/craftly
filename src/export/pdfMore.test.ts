import { afterEach, describe, expect, it, vi } from "vitest";
import { buildPdf, buildPdfParts, parseJpegInfo, pdfBlob, pdfNumber, pdfTextString, pdfUri, type PdfPageInput } from "./pdf";

const bytes = (...parts: Array<number | number[]>): Uint8Array => Uint8Array.from(parts.flat());
const SOI = [0xff, 0xd8];
/** an SOF0 frame header: precision 8, height, width, components */
const sof = (marker: number, width: number, height: number, components = 3) => [
  0xff,
  marker,
  0x00,
  8 + components * 3,
  8,
  height >> 8,
  height & 0xff,
  width >> 8,
  width & 0xff,
  components,
  ...Array(components * 3).fill(1),
];
const text = (u: Uint8Array) => Array.from(u, (c) => String.fromCharCode(c)).join("");
const jpeg = (w: number, h: number, components = 3) => bytes(SOI, sof(0xc0, w, h, components), 0xff, 0xd9);
const page = (extra: Partial<PdfPageInput> = {}): PdfPageInput => ({ widthPt: 100, heightPt: 50, jpeg: jpeg(200, 100), ...extra });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("reading the size of a JPEG", () => {
  it("accepts every frame type: baseline, extended, progressive and lossless variants", () => {
    for (const marker of [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc9, 0xcf]) {
      expect(parseJpegInfo(bytes(SOI, sof(marker, 640, 480), 0xff, 0xd9)), marker.toString(16)).toMatchObject({ width: 640, height: 480, components: 3, bits: 8 });
    }
  });

  it("skips tables and other segments by their length before the frame", () => {
    const dht = [0xff, 0xc4, 0x00, 0x05, 1, 2, 3];
    const jpg = [0xff, 0xc8, 0x00, 0x04, 1, 2];
    const dac = [0xff, 0xcc, 0x00, 0x04, 1, 2];
    const comment = [0xff, 0xfe, 0x00, 0x06, 65, 66, 67, 68];
    expect(parseJpegInfo(bytes(SOI, dht, jpg, dac, comment, sof(0xc0, 33, 44), 0xff, 0xd9))).toMatchObject({ width: 33, height: 44 });
  });

  it("steps over fill bytes, stray bytes and markers that carry no length", () => {
    expect(parseJpegInfo(bytes(SOI, 0xff, 0xff, 0xff, 0xe0, 0x00, 0x02, sof(0xc0, 10, 20), 0xff, 0xd9))).toMatchObject({ width: 10, height: 20 });
    expect(parseJpegInfo(bytes(SOI, 0x12, 0x34, sof(0xc0, 10, 20), 0xff, 0xd9))).toMatchObject({ width: 10, height: 20 });
    expect(parseJpegInfo(bytes(SOI, 0xff, 0x00, 0xff, 0x01, 0xff, 0xd0, 0xff, 0xd7, sof(0xc0, 11, 21), 0xff, 0xd9))).toMatchObject({ width: 11, height: 21 });
  });

  it("reports one, three or four colour components", () => {
    for (const components of [1, 3, 4]) expect(parseJpegInfo(jpeg(8, 8, components)).components).toBe(components);
  });

  it("gives up when the image ends or starts its data before a frame header", () => {
    expect(() => parseJpegInfo(bytes(SOI, 0xff, 0xda, 0x00, 0x03, 0x01, 0, 0, 0))).toThrow("Could not read the size");
    expect(() => parseJpegInfo(bytes(SOI, 0xff, 0xd9, 0, 0))).toThrow("Could not read the size");
    expect(() => parseJpegInfo(bytes(SOI, 0xff, 0xc0, 0x00, 0x0b, 8, 0, 4))).toThrow("Could not read the size");
  });

  it("is not fooled by a file that is too short or does not start like a JPEG", () => {
    expect(() => parseJpegInfo(new Uint8Array())).toThrow("not a JPEG");
    expect(() => parseJpegInfo(bytes(0xff, 0xd8, 0xff))).toThrow("not a JPEG");
    expect(() => parseJpegInfo(bytes(0xd8, 0xff, 0xe0, 0x00))).toThrow("not a JPEG");
  });
});

describe("PDF values", () => {
  it("writes numbers with at most three decimals and no exponent", () => {
    expect(pdfNumber(1.23456)).toBe("1.235");
    expect(pdfNumber(100)).toBe("100");
    expect(pdfNumber(10.5)).toBe("10.5");
    expect(pdfNumber(0)).toBe("0");
    expect(pdfNumber(0.0004)).toBe("0");
    expect(pdfNumber(-0.0004)).toBe("0");
    expect(pdfNumber(-2.5)).toBe("-2.5");
    expect(pdfNumber(Number.NaN)).toBe("0");
    expect(pdfNumber(Number.POSITIVE_INFINITY)).toBe("0");
  });

  it("writes plain text as a literal and anything else as UTF-16", () => {
    expect(pdfTextString("Hello (world) \\ done")).toBe("(Hello \\(world\\) \\\\ done)");
    expect(pdfTextString("")).toBe("()");
    expect(pdfTextString("café")).toBe("<FEFF00630061006600E9>");
    expect(pdfTextString("line\nbreak")).toBe("<FEFF006C0069006E0065000A0062007200650061006B>");
  });

  it("writes web addresses in 7-bit ASCII, encoding the rest", () => {
    expect(pdfUri("https://example.com/a?b=c")).toBe("(https://example.com/a?b=c)");
    expect(pdfUri("https://example.com/a b")).toBe("(https://example.com/a%20b)");
    expect(pdfUri("https://example.com/ü")).toBe("(https://example.com/%C3%BC)");
    expect(pdfUri("https://example.com/(x)\\")).toBe("(https://example.com/\\(x\\)\\\\)");
    expect(pdfUri("a\uD800b")).toBe("(a%EF%BF%BDb)");
    expect(pdfUri("")).toBe("()");
  });
});

describe("building a document", () => {
  it("needs at least one page", () => {
    expect(() => buildPdfParts([])).toThrow("A PDF needs at least one page.");
  });

  it("puts the title, author and subject in the document information", () => {
    const pdf = text(buildPdf([page()], { title: "My plan", author: "Ada", subject: "Q3" }));
    expect(pdf).toContain("/Title (My plan)");
    expect(pdf).toContain("/Author (Ada)");
    expect(pdf).toContain("/Subject (Q3)");
    expect(pdf).toContain("/Creator (Craftly)");
    expect(pdf).toContain("/Producer (Craftly)");
  });

  it("leaves out the title, author and subject that are not given", () => {
    const pdf = text(buildPdf([page()]));
    expect(pdf).not.toContain("/Title");
    expect(pdf).not.toContain("/Author");
    expect(pdf).not.toContain("/Subject");
  });

  it("takes the producer and the creation date from the caller", () => {
    const pdf = text(buildPdf([page()], { producer: "Test rig", created: new Date(Date.UTC(2024, 2, 5, 9, 4, 7)) }));
    expect(pdf).toContain("/Producer (Test rig)");
    expect(pdf).toContain("/CreationDate (D:20240305090407Z)");
  });

  it("writes a non-Latin title as UTF-16", () => {
    expect(text(buildPdf([page()], { title: "日本" }))).toContain("/Title <FEFF65E5672C>");
  });

  it("uses the document id it is given in both halves of the trailer", () => {
    const id = Uint8Array.from({ length: 16 }, (_v, i) => i * 16 + i);
    expect(text(buildPdf([page()], { id }))).toContain("/ID [<00112233445566778899aabbccddeeff> <00112233445566778899aabbccddeeff>]");
  });

  it("makes a random document id of 16 bytes otherwise, different every time", () => {
    const idOf = (pdf: Uint8Array) => /\/ID \[<([0-9a-f]{32})>/.exec(text(pdf))![1];
    const a = idOf(buildPdf([page()]));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(idOf(buildPdf([page()]))).not.toBe(a);
  });

  it("makes the id from Math.random where there is no crypto", () => {
    vi.stubGlobal("crypto", undefined);
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    expect(text(buildPdf([page()]))).toContain(`/ID [<${"80".repeat(16)}>`);
  });

  it("names the colour space after the components of the JPEG", () => {
    expect(text(buildPdf([page({ jpeg: jpeg(10, 10, 1) })]))).toContain("/ColorSpace /DeviceGray");
    expect(text(buildPdf([page({ jpeg: jpeg(10, 10, 1) })]))).toContain("/ProcSet [/PDF /ImageB]");
    expect(text(buildPdf([page({ jpeg: jpeg(10, 10, 3) })]))).toContain("/ColorSpace /DeviceRGB");
    expect(text(buildPdf([page({ jpeg: jpeg(10, 10, 4) })]))).toContain("/ColorSpace /DeviceCMYK");
    expect(text(buildPdf([page({ jpeg: jpeg(10, 10, 4) })]))).toContain("/ProcSet [/PDF /ImageC]");
  });

  it("sizes the page and the image from the page and the JPEG", () => {
    const pdf = text(buildPdf([page({ widthPt: 612.5, heightPt: 792, jpeg: jpeg(1700, 2200) })]));
    expect(pdf).toContain("/MediaBox [0 0 612.5 792]");
    expect(pdf).toContain("/Width 1700 /Height 2200");
    expect(pdf).toContain("q 612.5 0 0 792 0 0 cm /Im0 Do Q");
  });

  it("adds a link annotation for each link, measured from the top of the page", () => {
    const pdf = text(
      buildPdf([
        page({
          links: [
            { url: "https://a.example", x: 10, y: 5, w: 20, h: 10 },
            { url: "https://b.example/ü", x: 0, y: 0, w: 5, h: 5 },
          ],
        }),
      ]),
    );
    expect(pdf).toContain("/Rect [10 35 30 45]");
    expect(pdf).toContain("/URI (https://a.example)");
    expect(pdf).toContain("/URI (https://b.example/%C3%BC)");
    expect((pdf.match(/\/Subtype \/Link/g) ?? []).length).toBe(2);
    expect(pdf).toMatch(/\/Annots \[\d+ 0 R \d+ 0 R\]/);
  });

  it("numbers the objects page by page, with annotations after the image", () => {
    const build = buildPdfParts([page({ links: [{ url: "https://a.example", x: 0, y: 0, w: 1, h: 1 }] }), page()]);
    // catalog, page tree, info, then (page, contents, image, annot) and (page, contents, image)
    expect(build.offsets).toHaveLength(10);
    expect(build.offsets.every((o, i) => i === 0 || o > build.offsets[i - 1])).toBe(true);
  });

  it("writes a document that can be handed over as a blob", async () => {
    const blob = pdfBlob([page()], { title: "T" });
    expect(blob.type).toBe("application/pdf");
    const joined = buildPdf([page()], { title: "T", created: new Date(0), id: new Uint8Array(16) });
    const viaBlob = new Uint8Array(await pdfBlob([page()], { title: "T", created: new Date(0), id: new Uint8Array(16) }).arrayBuffer());
    expect(viaBlob).toEqual(joined);
  });

  it("refuses a page whose picture is not a JPEG", () => {
    expect(() => buildPdf([page({ jpeg: bytes(1, 2, 3, 4) })])).toThrow("not a JPEG");
  });
});
