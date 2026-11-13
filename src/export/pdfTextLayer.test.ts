import { describe, expect, it } from "vitest";
import { buildPdf, type PdfPageInput, type PdfTextLine } from "./pdf";
import { EXTRA_CODES_PER_FONT, HELVETICA_WIDTHS, PdfTextEncoder } from "./pdfFonts";

/** A structurally valid JPEG skeleton: SOI, SOF0 with the size, EOI. */
function fakeJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const META = { id: new Uint8Array(16), created: new Date(0) };

const page = (w: number, h: number, text?: PdfTextLine[]): PdfPageInput => ({ widthPt: w, heightPt: h, jpeg: fakeJpeg(w, h), text });
const line = (text: string, over: Partial<PdfTextLine> = {}, piece: { x?: number; width?: number; size?: number } = {}): PdfTextLine => ({
  matrix: [0.75, 0, 0, 0.75, 30, 37.5],
  pieces: [{ text, x: piece.x ?? 0, width: piece.width ?? 100, size: piece.size ?? 40 }],
  ...over,
});

/** Follows startxref to the table and returns the body of every object, as a reader would find them. */
function objects(bytes: Uint8Array): string[] {
  const text = latin1(bytes);
  const xrefOffset = Number(text.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  const size = Number(text.slice(xrefOffset).match(/^xref\n0 (\d+)\n/)![1]);
  const table = text.slice(xrefOffset + `xref\n0 ${size}\n`.length);
  const out: string[] = [""];
  for (let n = 1; n < size; n++) {
    const offset = Number(table.slice(n * 20, n * 20 + 10));
    const head = `${n} 0 obj\n`;
    expect(text.slice(offset, offset + head.length), `object ${n} is where the table says`).toBe(head);
    const lengthMatch = text.slice(offset + head.length).match(/^<<[^\n]*\/Length (\d+) >>\nstream\n/);
    if (lengthMatch) {
      // a stream is cut by its /Length, not by searching for "endstream": the length has to be exact
      const start = offset + head.length + lengthMatch[0].length;
      const end = start + Number(lengthMatch[1]);
      expect(text.slice(end, end + 18)).toBe("\nendstream\nendobj\n");
      out.push(text.slice(offset + head.length, end));
    } else {
      out.push(text.slice(offset + head.length, text.indexOf("endobj\n", offset)));
    }
  }
  return out;
}

/** The content stream of the nth page (0 based). */
function contentOf(bytes: Uint8Array, pageIndex = 0): string {
  const all = objects(bytes);
  const pages = all.filter((o) => o.includes("/Type /Page "));
  const ref = Number(pages[pageIndex].match(/\/Contents (\d+) 0 R/)![1]);
  return all[ref].replace(/^<<[^\n]*>>\nstream\n/, "");
}

/** What each `Tj` of a content stream shows, decoded through the ToUnicode maps of the fonts of the file: what a reader would copy. */
function shownText(bytes: Uint8Array, pageIndex = 0): string[] {
  const all = objects(bytes);
  const pageObject = all.filter((o) => o.includes("/Type /Page "))[pageIndex];
  const maps = new Map<string, Map<string, string>>();
  for (const m of (pageObject.match(/\/Font << ([^>]*) >>/)?.[1] ?? "").matchAll(/\/(F\d+) (\d+) 0 R/g)) {
    const cmapRef = Number(all[Number(m[2])].match(/\/ToUnicode (\d+) 0 R/)![1]);
    const map = new Map<string, string>();
    for (const pair of all[cmapRef].matchAll(/^<([0-9A-F]{2})> <([0-9A-F]+)>$/gm)) {
      let s = "";
      for (let i = 0; i < pair[2].length; i += 4) s += String.fromCharCode(parseInt(pair[2].slice(i, i + 4), 16));
      map.set(pair[1], s);
    }
    maps.set(m[1], map);
  }
  const out: string[] = [];
  for (const block of contentOf(bytes, pageIndex).matchAll(/BT (.*?) ET/g)) {
    let font = "";
    let shown = "";
    for (const op of block[1].matchAll(/\/(F\d+) [\d.]+ Tf|<([0-9A-F]*)> Tj/g)) {
      if (op[1]) font = op[1];
      else for (let i = 0; i < op[2].length; i += 2) shown += maps.get(font)!.get(op[2].slice(i, i + 2)) ?? "?";
    }
    out.push(shown);
  }
  return out;
}

describe("a page without text", () => {
  it("is written byte for byte as it was before there was a text layer", () => {
    const plain = buildPdf([page(400, 300)], META);
    expect(buildPdf([page(400, 300, [])], META)).toEqual(plain);
    // lines that hold nothing to show count as no text
    expect(buildPdf([page(400, 300, [{ matrix: [1, 0, 0, 1, 0, 0], pieces: [] }, line("")])], META)).toEqual(plain);
    const text = latin1(plain);
    expect(text).toContain("/Resources << /XObject << /Im0 6 0 R >> /ProcSet [/PDF /ImageC] >> /Contents 5 0 R >>");
    expect(text).toContain("<< /Length 30 >>\nstream\nq 400 0 0 300 0 0 cm /Im0 Do Q\nendstream");
    expect(text).not.toContain("/Font");
    expect(text).toContain("/Size 7 ");
  });

  it("keeps its bytes when another page of the file has text", () => {
    const both = objects(buildPdf([page(400, 300), page(400, 300, [line("Hello")])], META));
    const alone = objects(buildPdf([page(400, 300)], META));
    // page, contents, image: objects 4 to 6
    expect(both.slice(4, 7)).toEqual(alone.slice(4, 7));
  });
});

describe("the invisible text layer", () => {
  it("writes each line after the image in rendering mode 3, at its place measured from the bottom of the page", () => {
    const content = contentOf(buildPdf([page(400, 300, [line("Hello")])], META));
    // H e l l o in Helvetica: 722 + 556 + 222 + 222 + 556 thousandths of 40 = 91.12, stretched to the 100 the line is wide
    expect(content).toBe("q 400 0 0 300 0 0 cm /Im0 Do Q\nBT 3 Tr 0.75 0 0 0.75 30 262.5 Tm /F0 40 Tf 109.745 Tz <48656C6C6F> Tj ET");
  });

  it("names the font in the resources of the page and declares that the page has text", () => {
    const all = objects(buildPdf([page(400, 300, [line("Hello")])], META));
    const pageObject = all[4];
    const fontRef = Number(pageObject.match(/\/Font << \/F0 (\d+) 0 R >>/)![1]);
    expect(pageObject).toContain("/ProcSet [/PDF /Text /ImageC]");
    expect(all[fontRef]).toContain("/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding");
    expect(all[fontRef]).toMatch(/\/FirstChar 32 \/LastChar 255 \/Widths \[278 278 355 [\d ]+\] \/FontDescriptor \d+ 0 R \/ToUnicode \d+ 0 R/);
    const descriptor = Number(all[fontRef].match(/\/FontDescriptor (\d+) 0 R/)![1]);
    expect(all[descriptor]).toContain("/Type /FontDescriptor /FontName /Helvetica /Flags 32");
    // no font program is embedded: the reader uses its own Helvetica, and nothing of it is ever painted
    expect(all.join("\n")).not.toMatch(/\/FontFile/);
  });

  it("turns the matrix of a rotated line into PDF space, where y grows upwards", () => {
    // a quarter turn clockwise on screen: x runs down the page
    const content = contentOf(buildPdf([page(400, 300, [line("Hello", { matrix: [0, 0.75, -0.75, 0, 200, 60] })])], META));
    expect(content).toContain("BT 3 Tr 0 -0.75 0.75 0 200 240 Tm ");
    const tilted = contentOf(buildPdf([page(400, 300, [line("Hello", { matrix: [0.6, 0.45, -0.45, 0.6, 10, 20] })])], META));
    expect(tilted).toContain("BT 3 Tr 0.6 -0.45 0.45 0.6 10 280 Tm ");
  });

  it("places every piece of a line at its own x and stretches it to its own width", () => {
    const pieces = [
      { text: "Hi", x: 0, width: 40, size: 40 },
      { text: " ", x: 40, width: 20, size: 40 },
      { text: "you", x: 60, width: 90, size: 20 },
      { text: "", x: 150, width: 10, size: 20 },
    ];
    const content = contentOf(buildPdf([page(400, 300, [{ matrix: [1, 0, 0, 1, 0, 100], pieces }])], META));
    // Hi = 944 / 1000 * 40 = 37.76; a space = 11.12; you = (500 + 556 + 556) / 1000 * 20 = 32.24. Td moves from the piece before
    expect(content).toContain("BT 3 Tr 1 0 0 1 0 200 Tm /F0 40 Tf 105.932 Tz <4869> Tj 40 0 Td 179.856 Tz <20> Tj 20 0 Td /F0 20 Tf 279.156 Tz <796F75> Tj ET");
  });

  it("writes a piece that has no usable width unstretched", () => {
    const content = contentOf(buildPdf([page(400, 300, [line("Hello", {}, { width: 0 })])], META));
    expect(content).toContain(" 100 Tz <48656C6C6F> Tj");
  });

  it("keeps the lines in the order they were given, one text object each", () => {
    const lines = [line("First line"), line("Second line", { matrix: [0.75, 0, 0, 0.75, 30, 80] }), line("Third")];
    const bytes = buildPdf([page(400, 300, lines)], META);
    expect(shownText(bytes)).toEqual(["First line", "Second line", "Third"]);
    expect((contentOf(bytes).match(/3 Tr/g) ?? []).length).toBe(3);
  });

  it("uses exact stream lengths and offsets, and shares the fonts between pages", () => {
    const bytes = buildPdf([page(400, 300, [line("One")]), page(400, 300), page(200, 100, [line("Two")])], META);
    const all = objects(bytes); // checks every offset and every /Length on the way
    // 3 fixed objects, 3 per page, then one descriptor, one font and one map
    expect(all).toHaveLength(1 + 3 + 9 + 3);
    const refs = all.filter((o) => o.includes("/Type /Page ")).map((o) => o.match(/\/Font << \/F0 (\d+) 0 R >>/)?.[1]);
    expect(refs).toEqual(["14", undefined, "14"]);
    expect(latin1(bytes)).toContain("/Kids [4 0 R 7 0 R 10 0 R] /Count 3");
    expect(shownText(bytes, 2)).toEqual(["Two"]);
  });
});

describe("the characters of the text layer", () => {
  it("writes accents, curly quotes and dashes in WinAnsi with a map back to Unicode", () => {
    const bytes = buildPdf([page(400, 300, [line("Café – “ok” €5…")])], META);
    expect(contentOf(bytes)).toContain("<436166E9209620936F6B9420803585> Tj");
    expect(shownText(bytes)).toEqual(["Café – “ok” €5…"]);
    const cmap = objects(bytes).find((o) => o.includes("begincmap"))!;
    expect(cmap).toContain("<96> <2013>");
    expect(cmap).toContain("<E9> <00E9>");
    expect(cmap).toContain("<80> <20AC>");
    expect(cmap).toContain("1 begincodespacerange\n<00> <FF>\nendcodespacerange");
    // thirteen different characters
    expect(cmap).toMatch(/\n13 beginbfchar\n/);
  });

  it("gives characters outside WinAnsi a font of their own with named glyphs, widths and a map", () => {
    const bytes = buildPdf([page(400, 300, [line("Привет, 日本 😀")])], META);
    expect(shownText(bytes)).toEqual(["Привет, 日本 😀"]);
    const all = objects(bytes);
    expect(all[4]).toMatch(/\/Font << \/F0 \d+ 0 R \/F1 \d+ 0 R >>/);
    const extra = all.find((o) => o.includes("/Differences"))!;
    expect(extra).toContain(
      "/Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /Differences [33 /uni041F /uni0440 /uni0438 /uni0432 /uni0435 /uni0442 /uni65E5 /uni672C /u1F600] >>",
    );
    // Cyrillic letters are given 600, an ideograph and an emoji the full em
    expect(extra).toContain("/FirstChar 33 /LastChar 41 /Widths [600 600 600 600 600 600 1000 1000 1000]");
    const cmap = all[Number(extra.match(/\/ToUnicode (\d+) 0 R/)![1])];
    expect(cmap).toContain("<21> <041F>");
    expect(cmap).toContain("<29> <D83DDE00>");
    // the comma and the spaces stay in the WinAnsi font: the line switches fonts and back
    expect(contentOf(bytes)).toMatch(/\/F1 40 Tf [\d.]+ Tz <212223242526> Tj \/F0 40 Tf <2C20> Tj \/F1 40 Tf <2728> Tj \/F0 40 Tf <20> Tj \/F1 40 Tf <29> Tj ET$/);
  });

  it("opens another font when one is full, so any number of different characters fits", () => {
    let text = "";
    for (let i = 0; i < EXTRA_CODES_PER_FONT + 2; i++) text += String.fromCharCode(0x4e00 + i);
    const bytes = buildPdf([page(400, 300, [line(text)])], META);
    expect(shownText(bytes)).toEqual([text]);
    const all = objects(bytes);
    expect(all[4]).toMatch(/\/Font << \/F1 \d+ 0 R \/F2 \d+ 0 R >>/);
    expect(all.filter((o) => o.includes("/Differences"))).toHaveLength(2);
    expect(all.find((o) => o.includes("/LastChar 255 /Widths [1000"))).toBeDefined();
    // more than a hundred pairs: the map is written in blocks of at most 100
    expect(all.find((o) => o.includes("100 beginbfchar"))).toContain(`${EXTRA_CODES_PER_FONT - 200} beginbfchar`);
  });

  it("writes control characters as spaces, a lone surrogate as U+FFFD and composes accents", () => {
    const bytes = buildPdf([page(400, 300, [line("a\tb\u0007c\ud800d é")])], META);
    expect(shownText(bytes)).toEqual(["a b c�d é"]);
  });
});

describe("PdfTextEncoder", () => {
  it("knows the width of every WinAnsi code from 32 to 255", () => {
    expect(HELVETICA_WIDTHS).toHaveLength(224);
    expect(HELVETICA_WIDTHS[0]).toBe(278);
    expect(HELVETICA_WIDTHS["W".charCodeAt(0) - 32]).toBe(944);
    expect(HELVETICA_WIDTHS[0xe9 - 32]).toBe(556);
  });

  it("gives the same code to the same character every time and adds up widths in thousandths", () => {
    const enc = new PdfTextEncoder();
    const first = enc.encode("Жук");
    const again = enc.encode("кЖ");
    expect(first).toEqual([{ font: 1, hex: "212223", width: 1800 }]);
    expect(again).toEqual([{ font: 1, hex: "2321", width: 1200 }]);
    expect(enc.encode("Hi Ж")).toEqual([
      { font: 0, hex: "486920", width: 722 + 222 + 278 },
      { font: 1, hex: "21", width: 600 },
    ]);
    expect(enc.encode("")).toEqual([]);
    expect(enc.fonts().map((f) => f.index)).toEqual([0, 1]);
  });
});
