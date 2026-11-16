/**
 * The part of fontkit 2.0.4 (MIT) that "Convert to shapes" for text uses: open a font file, set a variable font's weight, and lay
 * out a piece of text into glyphs with their outlines and positions. fontkit ships no types of its own.
 */
declare module "fontkit" {
  export interface GlyphPath {
    /** SVG path data in font units, y pointing up */
    toSVG(): string;
  }

  export interface Glyph {
    id: number;
    path: GlyphPath;
    codePoints: number[];
  }

  export interface GlyphPosition {
    xAdvance: number;
    yAdvance: number;
    xOffset: number;
    yOffset: number;
  }

  export interface GlyphRun {
    glyphs: Glyph[];
    positions: GlyphPosition[];
  }

  export interface Font {
    unitsPerEm: number;
    variationAxes: Record<string, { name: string; min: number; default: number; max: number }>;
    layout(text: string, features?: string[] | Record<string, boolean>): GlyphRun;
    getVariation(settings: Record<string, number>): Font;
  }

  export interface FontCollection {
    fonts: Font[];
  }

  export function create(buffer: Uint8Array, postscriptName?: string): Font | FontCollection;
}
