/**
 * The fonts of the invisible text layer of a PDF (see pdf.ts) and how a text becomes the bytes of a `Tj`.
 *
 * No font program is embedded. The layer is never painted (rendering mode 3); it only has to say which characters
 * lie where, so a reader can select, search and copy them. Every font is the standard Helvetica:
 *
 *   F0        WinAnsiEncoding: ASCII, Latin-1 and the Windows-1252 extras (curly quotes, dashes, the euro ...).
 *   F1, F2 .. one for every 223 different characters of the document that WinAnsi does not have. Each has an
 *             encoding of its own (/Differences with the glyph names uniXXXX / uXXXXX), so a code is free to mean
 *             any character.
 *
 * Every font has a /ToUnicode map, which is what a reader copies and searches by, and declares its /Widths, so the
 * advance of a character does not depend on which Helvetica the reader has. Helvetica has no glyph for a Cyrillic
 * letter or an ideograph; that does no harm, since no glyph is ever drawn.
 */

/** Advance widths of Helvetica for the WinAnsi codes 32 .. 255, in thousandths of the font size (Adobe's metrics; 0 = code not used). */
// prettier-ignore
export const HELVETICA_WIDTHS: readonly number[] = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // space ! " # $ % & ' ( ) * + , - . /
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 0-9 : ; < = > ?
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // @ A-O
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // P-Z [ \ ] ^ _
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // ` a-o
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, 0, // p-z { | } ~
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, // 128-143
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, // 144-159
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, // 160-175
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, // 176-191
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, // 192-207
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, // 208-223
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, // 224-239
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500, // 240-255
];

/** The characters Windows-1252 puts at 128 .. 159, by code point. */
const CP1252_EXTRAS = new Map<number, number>([
  [0x20ac, 0x80],
  [0x201a, 0x82],
  [0x0192, 0x83],
  [0x201e, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02c6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8a],
  [0x2039, 0x8b],
  [0x0152, 0x8c],
  [0x017d, 0x8e],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201c, 0x93],
  [0x201d, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02dc, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9a],
  [0x203a, 0x9b],
  [0x0153, 0x9c],
  [0x017e, 0x9e],
  [0x0178, 0x9f],
]);

/** First code of a font with an encoding of its own: 0 .. 31 are left alone, and 32 stays out so no reader takes a letter for a word space. */
const EXTRA_FIRST_CODE = 33;
/** How many different characters one such font holds (the codes 33 .. 255). */
export const EXTRA_CODES_PER_FONT = 256 - EXTRA_FIRST_CODE;

/** Width given to a character Helvetica does not have: the full em for ideographs, kana, hangul, full-width forms and emoji, 600 for the rest. */
function extraWidth(cp: number): number {
  const wide =
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    cp >= 0x1f000;
  return wide ? 1000 : 600;
}

const hex2 = (n: number) => n.toString(16).toUpperCase().padStart(2, "0");
const hex4 = (n: number) => n.toString(16).toUpperCase().padStart(4, "0");

/** A code point as UTF-16BE hex, the form a ToUnicode map wants (a surrogate pair above U+FFFF). */
function utf16Hex(cp: number): string {
  if (cp <= 0xffff) return hex4(cp);
  const v = cp - 0x10000;
  return hex4(0xd800 + (v >> 10)) + hex4(0xdc00 + (v & 0x3ff));
}

/** The glyph name the Adobe glyph list rules give a code point: uniXXXX, or uXXXXX above U+FFFF. */
const glyphName = (cp: number) => (cp <= 0xffff ? `uni${hex4(cp)}` : `u${cp.toString(16).toUpperCase()}`);

/** A stretch of a text that one font shows: the bytes as hex, and their width in thousandths of the font size. */
export interface EncodedRun {
  /** 0 = the WinAnsi font, 1 .. = the fonts with an encoding of their own */
  font: number;
  hex: string;
  width: number;
}

export interface UsedFont {
  index: number;
  /** resource name on a page: F0, F1 ... */
  name: string;
  /** the font dictionary without its closing: `descriptor` and `toUnicode` are object numbers */
  dict: (descriptor: number, toUnicode: number) => string;
  /** the ToUnicode CMap stream */
  cmap: string;
}

/**
 * Gives every character of a document a font and a code, the same ones each time it is met, and remembers which
 * were used: `fonts()` then describes exactly the fonts the document needs.
 */
export class PdfTextEncoder {
  /** code point -> [font, code] for characters outside WinAnsi */
  private readonly extra = new Map<number, readonly [number, number]>();
  /** per font: code -> code point, for the codes that were used */
  private readonly used = new Map<number, Map<number, number>>();

  /** The font, the code and the character that is written for a code point of the text. */
  private place(raw: number): readonly [font: number, code: number, cp: number] {
    // a tab, a line break or any other control character has no glyph and no width: a space keeps the words apart.
    // Half of a surrogate pair is not a character: the replacement character says so honestly.
    const cp = raw < 0x20 || (raw >= 0x7f && raw <= 0x9f) ? 0x20 : raw >= 0xd800 && raw <= 0xdfff ? 0xfffd : raw;
    if ((cp >= 0x20 && cp <= 0x7e) || (cp >= 0xa0 && cp <= 0xff)) return [0, cp, cp];
    const win = CP1252_EXTRAS.get(cp);
    if (win !== undefined) return [0, win, cp];
    let at = this.extra.get(cp);
    if (!at) {
      const n = this.extra.size;
      at = [1 + Math.floor(n / EXTRA_CODES_PER_FONT), EXTRA_FIRST_CODE + (n % EXTRA_CODES_PER_FONT)];
      this.extra.set(cp, at);
    }
    return [at[0], at[1], cp];
  }

  private remember(font: number, code: number, cp: number): void {
    let codes = this.used.get(font);
    if (!codes) this.used.set(font, (codes = new Map()));
    codes.set(code, cp);
  }

  /** The text as runs of one font each, in order. Accents are composed first (e + combining acute = é), so more of a text fits WinAnsi. */
  encode(text: string): EncodedRun[] {
    const runs: EncodedRun[] = [];
    for (const ch of Array.from(text.normalize("NFC"))) {
      const [font, code, cp] = this.place(ch.codePointAt(0) as number);
      this.remember(font, code, cp);
      const width = font === 0 ? HELVETICA_WIDTHS[code - 32] : extraWidth(cp);
      const last = runs[runs.length - 1];
      if (last && last.font === font) {
        last.hex += hex2(code);
        last.width += width;
      } else runs.push({ font, hex: hex2(code), width });
    }
    return runs;
  }

  /** The fonts that were used, lowest index first. */
  fonts(): UsedFont[] {
    return [...this.used.keys()]
      .sort((a, b) => a - b)
      .map((index) => {
        const codes = [...(this.used.get(index) as Map<number, number>)].sort((a, b) => a[0] - b[0]);
        return { index, name: `F${index}`, dict: (descriptor, toUnicode) => fontDict(index, codes, descriptor, toUnicode), cmap: toUnicodeCMap(codes) };
      });
  }
}

function fontDict(index: number, codes: Array<[number, number]>, descriptor: number, toUnicode: number): string {
  const tail = `/FontDescriptor ${descriptor} 0 R /ToUnicode ${toUnicode} 0 R >>`;
  if (index === 0)
    return `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding /FirstChar 32 /LastChar 255 /Widths [${HELVETICA_WIDTHS.join(" ")}] ${tail}`;
  // the codes of such a font are handed out in order, so the ones in use are 33 .. 33 + n - 1 without a gap
  const names = codes.map(([, cp]) => `/${glyphName(cp)}`).join(" ");
  const widths = codes.map(([, cp]) => extraWidth(cp)).join(" ");
  const last = codes[codes.length - 1][0];
  return `<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding << /Type /Encoding /Differences [${EXTRA_FIRST_CODE} ${names}] >> /FirstChar ${EXTRA_FIRST_CODE} /LastChar ${last} /Widths [${widths}] ${tail}`;
}

/** The descriptor all the fonts share: Helvetica's own numbers, and no font file. */
export const HELVETICA_DESCRIPTOR =
  "<< /Type /FontDescriptor /FontName /Helvetica /Flags 32 /FontBBox [-166 -225 1000 931] /ItalicAngle 0 /Ascent 718 /Descent -207 /CapHeight 718 /StemV 88 >>";

/** A ToUnicode CMap for one-byte codes: which character (as UTF-16BE) each code stands for. */
function toUnicodeCMap(codes: Array<[number, number]>): string {
  let out =
    "/CIDInit /ProcSet findresource begin\n12 dict begin\nbegincmap\n/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def\n" +
    "/CMapName /Adobe-Identity-UCS def\n/CMapType 2 def\n1 begincodespacerange\n<00> <FF>\nendcodespacerange\n";
  // a block may hold at most 100 pairs
  for (let i = 0; i < codes.length; i += 100) {
    const block = codes.slice(i, i + 100);
    out += `${block.length} beginbfchar\n${block.map(([code, cp]) => `<${hex2(code)}> <${utf16Hex(cp)}>`).join("\n")}\nendbfchar\n`;
  }
  return `${out}endcmap\nCMapName currentdict /CMap defineresource pop\nend\nend`;
}
