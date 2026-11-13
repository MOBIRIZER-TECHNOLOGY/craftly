import { describe, expect, it } from "vitest";
import { CROP_MARK_GAP_PT, CROP_MARK_LENGTH_PT, CROP_MARK_ROOM_PT, buildPdf, type PdfPageInput } from "./pdf";

/** A structurally valid JPEG skeleton: SOI, SOF0 with the size, EOI. */
function fakeJpeg(width: number, height: number): Uint8Array {
  return Uint8Array.from([0xff, 0xd8, 0xff, 0xc0, 0x00, 0x11, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, 3, 1, 0x11, 0, 2, 0x11, 0, 3, 0x11, 0, 0xff, 0xd9]);
}

const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");
const META = { id: new Uint8Array(16), created: new Date(0) };
const page = (over: Partial<PdfPageInput> = {}): PdfPageInput => ({ widthPt: 400, heightPt: 300, jpeg: fakeJpeg(400, 300), ...over });
const build = (over: Partial<PdfPageInput> = {}) => latin1(buildPdf([page(over)], META));

/** The numbers of a box of the page dictionary. */
const box = (pdf: string, name: string) =>
  pdf
    .match(new RegExp(`/${name} \\[([^\\]]*)\\]`))?.[1]
    .split(" ")
    .map(Number);

/** The content stream of the only page. */
const content = (pdf: string) => pdf.match(/<< \/Length (\d+) >>\nstream\n([\s\S]*?)\nendstream/)![2];

/** The crop marks of a content stream as [x1, y1, x2, y2] segments. */
function marks(pdf: string): number[][] {
  const out: number[][] = [];
  for (const m of content(pdf).matchAll(/([\d.]+) ([\d.]+) m ([\d.]+) ([\d.]+) l/g)) out.push(m.slice(1, 5).map(Number));
  return out;
}

/** Every offset of the xref table points at its object. */
function expectSoundOffsets(pdf: string): void {
  const xref = Number(pdf.match(/startxref\n(\d+)\n%%EOF\n$/)![1]);
  const size = Number(pdf.slice(xref).match(/^xref\n0 (\d+)\n/)![1]);
  const table = pdf.slice(xref + `xref\n0 ${size}\n`.length);
  for (let n = 1; n < size; n++) {
    const offset = Number(table.slice(n * 20, n * 20 + 10));
    expect(pdf.slice(offset, offset + `${n} 0 obj\n`.length), `object ${n}`).toBe(`${n} 0 obj\n`);
  }
  const length = Number(pdf.match(/<< \/Length (\d+) >>\nstream\n/)![1]);
  expect(content(pdf)).toHaveLength(length);
}

describe("a page without bleed or crop marks", () => {
  it("is written byte for byte as before", () => {
    const plain = buildPdf([page()], META);
    expect(buildPdf([page({ bleedPt: 0, cropMarks: false })], META)).toEqual(plain);
    // a bleed that is not a usable number is no bleed
    expect(buildPdf([page({ bleedPt: Number.NaN })], META)).toEqual(plain);
    expect(buildPdf([page({ bleedPt: -5 })], META)).toEqual(plain);
    const pdf = latin1(plain);
    expect(pdf).not.toContain("/TrimBox");
    expect(pdf).not.toContain("/BleedBox");
    expect(pdf).not.toContain("/ColorSpace <<");
  });
});

describe("bleed", () => {
  it("grows the page by the bleed on every side and says where the design and the bleed are", () => {
    const pdf = build({ bleedPt: 9 });
    expect(box(pdf, "MediaBox")).toEqual([0, 0, 418, 318]);
    expect(box(pdf, "BleedBox")).toEqual([0, 0, 418, 318]);
    expect(box(pdf, "TrimBox")).toEqual([9, 9, 409, 309]);
    // the picture holds the bleed: it covers the whole page
    expect(content(pdf)).toBe("q 418 0 0 318 0 0 cm /Im0 Do Q");
    expect(marks(pdf)).toEqual([]);
    expectSoundOffsets(pdf);
  });

  it("keeps fractions of a point", () => {
    const pdf = build({ bleedPt: 8.504 });
    expect(box(pdf, "MediaBox")).toEqual([0, 0, 417.008, 317.008]);
    expect(box(pdf, "TrimBox")).toEqual([8.504, 8.504, 408.504, 308.504]);
  });
});

describe("crop marks", () => {
  it("are eight thin lines in registration colour, outside the bleed, in line with the edges of the design", () => {
    const pdf = build({ bleedPt: 9, cropMarks: true });
    const room = 9 + CROP_MARK_ROOM_PT; // the page grows by the bleed and the room the marks need
    expect(box(pdf, "MediaBox")).toEqual([0, 0, 400 + room * 2, 300 + room * 2]);
    expect(box(pdf, "TrimBox")).toEqual([room, room, room + 400, room + 300]);
    expect(box(pdf, "BleedBox")).toEqual([room - 9, room - 9, room + 409, room + 309]);
    // the picture (design and bleed) sits inside the room of the marks
    expect(content(pdf).startsWith(`q 418 0 0 318 ${room - 9} ${room - 9} cm /Im0 Do Q\nq 0.25 w /CS0 CS 1 SCN `)).toBe(true);
    expect(content(pdf).endsWith(" l S Q")).toBe(true);
    expect(pdf).toContain("/ColorSpace << /CS0 [/Separation /All /DeviceCMYK << /FunctionType 2 /Domain [0 1] /C0 [0 0 0 0] /C1 [1 1 1 1] /N 1 >>] >>");

    const [left, bottom, right, top] = [room, room, room + 400, room + 300];
    const near = 9 + CROP_MARK_GAP_PT; // from the edge of the design to where a mark starts
    const far = near + CROP_MARK_LENGTH_PT;
    expect(marks(pdf)).toEqual([
      // along the bottom and the top edge, left and right of the design
      [left - far, bottom, left - near, bottom],
      [right + near, bottom, right + far, bottom],
      [left - far, top, left - near, top],
      [right + near, top, right + far, top],
      // along the left and the right edge, below and above the design
      [left, bottom - far, left, bottom - near],
      [left, top + near, left, top + far],
      [right, bottom - far, right, bottom - near],
      [right, top + near, right, top + far],
    ]);
    // no mark reaches into the bleed, and none leaves the page
    const [bx0, by0, bx1, by1] = box(pdf, "BleedBox")!;
    const [, , pageW, pageH] = box(pdf, "MediaBox")!;
    for (const [x1, y1, x2, y2] of marks(pdf)) {
      const outside = Math.max(x1, x2) < bx0 || Math.min(x1, x2) > bx1 || Math.max(y1, y2) < by0 || Math.min(y1, y2) > by1;
      expect(outside, `${x1} ${y1} ${x2} ${y2}`).toBe(true);
      for (const v of [x1, x2]) expect(v > 0 && v < pageW).toBe(true);
      for (const v of [y1, y2]) expect(v > 0 && v < pageH).toBe(true);
    }
    expectSoundOffsets(pdf);
  });

  it("stand off the design itself when there is no bleed", () => {
    const pdf = build({ cropMarks: true });
    const room = CROP_MARK_ROOM_PT;
    expect(box(pdf, "MediaBox")).toEqual([0, 0, 400 + room * 2, 300 + room * 2]);
    expect(box(pdf, "BleedBox")).toEqual(box(pdf, "TrimBox"));
    expect(marks(pdf)[0]).toEqual([room - CROP_MARK_GAP_PT - CROP_MARK_LENGTH_PT, room, room - CROP_MARK_GAP_PT, room]);
    expect(marks(pdf)).toHaveLength(8);
  });
});

describe("what lies on a page that has grown", () => {
  it("moves the text layer with the design, so it stays over the picture", () => {
    const text = [{ matrix: [0.75, 0, 0, 0.75, 30, 37.5] as const, pieces: [{ text: "Hello", x: 0, width: 100, size: 40 }] }];
    expect(content(build({ text }))).toContain("BT 3 Tr 0.75 0 0 0.75 30 262.5 Tm ");
    expect(content(build({ text, bleedPt: 9 }))).toContain("BT 3 Tr 0.75 0 0 0.75 39 271.5 Tm ");
    const withMarks = build({ text, bleedPt: 9, cropMarks: true });
    const room = 9 + CROP_MARK_ROOM_PT;
    expect(content(withMarks)).toContain(`BT 3 Tr 0.75 0 0 0.75 ${30 + room} ${262.5 + room} Tm `);
    // the picture first, then the marks, then the text
    expect(content(withMarks)).toMatch(/^q [^\n]* Do Q\nq 0\.25 w [^\n]* S Q\nBT /);
    expect(withMarks).toContain("/ProcSet [/PDF /Text /ImageC]");
    expectSoundOffsets(withMarks);
  });

  it("moves the links with the design", () => {
    const links = [{ url: "https://craftly.test/", x: 10, y: 20, w: 100, h: 50 }];
    expect(build({ links })).toContain("/Rect [10 230 110 280]");
    expect(build({ links, bleedPt: 9 })).toContain("/Rect [19 239 119 289]");
  });

  it("lets every page have its own bleed and marks", () => {
    const pdf = latin1(buildPdf([page({ bleedPt: 9 }), page(), page({ cropMarks: true })], META));
    expect([...pdf.matchAll(/\/MediaBox \[([^\]]*)\]/g)].map((m) => m[1])).toEqual([
      "0 0 418 318",
      "0 0 400 300",
      `0 0 ${400 + CROP_MARK_ROOM_PT * 2} ${300 + CROP_MARK_ROOM_PT * 2}`,
    ]);
    expect(pdf.match(/\/TrimBox/g)).toHaveLength(2);
  });
});
