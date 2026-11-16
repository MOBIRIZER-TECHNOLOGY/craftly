/**
 * "Convert to shapes" for a text box (text to points): the letters as they are drawn become path shapes, one a letter, that keep
 * their place, size and colour and can then be edited point by point like any path.
 *
 * WHERE THE LETTERS GO. The text is laid out by the layout the canvas, the exports and the editor draw with (textLayout.ts), so
 * lines break, align and space as they do on the page. Within a piece of a line in one style, fontkit (MIT, 2.0.4, loaded on first
 * use) lays the letters out from the font file itself, kerning included, and hands over their outlines; letter spacing is added
 * after each letter as the canvas adds it. The file is the one the browser draws the family with (fonts.ts `faceFile`): the
 * bundled woff2 or the uploaded file, at the weight the text is drawn at for a variable font, slanted as the browser slants an
 * upright face that is asked to be italic.
 *
 * WHAT IS KEPT, AND WHAT IS NOT. Colours of every piece, underline and strike (as the rectangles the canvas draws), list markers,
 * and a gradient over the whole text (then the letters are one shape, so that it still runs across all of them). The element's
 * turn, mirroring, opacity, shadow, blur, blend, name, alt text, link and animation go to the group. Not kept, and said: the ten
 * text effects, and letters the font has no outline for (the browser borrows those from another font, which has no file here).
 * Refused: curved text, a family Craftly has no file of (a system font), and more than MAX_SHAPES letters.
 */
import type { Font } from "fontkit";
import { createGroup, createShape } from "@/core/factory";
import { fromLocalPoint } from "@/core/geometry";
import { fitPaths, type PenPath } from "@/core/pen";
import { MAX_POINTS, MAX_SHAPES } from "@/core/svgImport";
import { multiply, parsePathData, rectPath, transformPath, TooLarge, type Budget, type Matrix } from "@/core/svgGeometry";
import type { ElementBase, Fill, GroupElement, ShapeElement, TextElement } from "@/core/types";
import { faceFile } from "./fonts";
import { plainFile } from "./sfnt";
import { curveGeometry, layoutText, type RunStyle, type TextLayout } from "./textLayout";

/** How far an upright face is slanted when italic is asked of it: what Chrome and Skia use (a quarter of the height). */
export const SYNTHETIC_SLANT = 0.25;

/** A font file, opened, and whether its letters are to be slanted (see `faceFile`). */
export interface OutlineFace {
  font: Pick<Font, "unitsPerEm" | "layout">;
  slanted: boolean;
}

/** The face a run of text is drawn with; null when there is no file for its family. */
export type FaceFor = (style: RunStyle) => OutlineFace | null;

export type TextOutlineProblem = "curved" | "no-font" | "too-large" | "empty";

export interface TextOutline {
  /** the shapes, in the space of the text box (its top-left corner is 0, 0, before it is turned) */
  shapes: ShapeElement[];
  /** letters the font has no outline for: left out */
  missing: number;
  /** the families that have no file (a refusal when there are any) */
  noFont: string[];
}

const tidy = (v: number) => Math.round(v * 1000) / 1000 + 0;
const keyOf = (style: Pick<RunStyle, "family" | "weight" | "italic">) => `${style.family}\u0000${style.weight}\u0000${style.italic ? 1 : 0}`;

/** A shape of the pieces, filled with `fill`: its box is where the pieces are. */
function shapeOf(pieces: readonly PenPath[], fill: Fill): ShapeElement {
  const { d, box } = fitPaths(pieces);
  return createShape("path", { x: tidy(box.x), y: tidy(box.y), width: tidy(box.w), height: tidy(box.h), path: d, fill, stroke: null });
}

/**
 * The outlines of the laid-out text, as shapes in the space of the text box. `mirror` is the element's own flip, so that a
 * mirrored text gives mirrored letters. Throws `TooLarge` when there are more letters or points than a drawing may have.
 */
export function outlineText(el: TextElement, layout: TextLayout, faceFor: FaceFor, mirror: Matrix = [1, 0, 0, 1, 0, 0]): TextOutline {
  const budget: Budget = { points: MAX_POINTS };
  const noFont = new Set<string>();
  let missing = 0;
  // each letter (or decoration) as pieces with its colour; joined into one shape at the end when a gradient paints the whole text
  const letters: { pieces: PenPath[]; color: string }[] = [];
  const add = (pieces: PenPath[], color: string) => {
    if (!pieces.length) return;
    if (!el.gradient && letters.length >= MAX_SHAPES) throw new TooLarge();
    letters.push({ pieces, color });
  };

  /** Draws `text` in `style` with its left end on the baseline at x, y; returns nothing, adds the letters. */
  const write = (text: string, style: RunStyle, x: number, y: number) => {
    const face = faceFor(style);
    if (!face) {
      noFont.add(style.family);
      return;
    }
    const scale = style.size / face.font.unitsPerEm;
    const run = face.font.layout(text);
    let pen = x;
    run.glyphs.forEach((glyph, i) => {
      const at = run.positions[i];
      const gx = pen + at.xOffset * scale;
      const gy = y - at.yOffset * scale;
      pen += at.xAdvance * scale + style.spacing;
      // font units point up; a slant moves what is higher further right
      const place: Matrix = multiply(mirror, [scale, 0, face.slanted ? SYNTHETIC_SLANT * scale : 0, -scale, gx, gy]);
      // a letter the font does not have is glyph 0, which the browser draws from another font; a space has no outline
      if (glyph.id === 0) {
        missing++;
        return;
      }
      const d = glyph.path.toSVG();
      if (!d) return;
      add(
        parsePathData(d, budget).pieces.map((piece) => transformPath(piece, place)),
        style.color,
      );
    });
  };

  for (const line of layout.lines) {
    const baseline = line.y + line.baseline;
    for (const seg of line.segments) {
      if (!seg.text) continue;
      const x = line.x + seg.x;
      if (!seg.isSpace) write(seg.text, seg.style, x, baseline);
      const thickness = Math.max(1, seg.style.size * 0.06);
      if (seg.style.underline) add([transformPath(rectPath(x, baseline + seg.style.size * 0.1, seg.width, thickness, 0, 0), mirror)], seg.style.color);
      if (seg.style.strike) add([transformPath(rectPath(x, baseline - seg.style.size * 0.3, seg.width, thickness, 0, 0), mirror)], seg.style.color);
    }
    if (line.marker) write(line.marker.text, line.marker.style, line.marker.x, baseline);
  }

  if (noFont.size) return { shapes: [], missing, noFont: [...noFont] };
  if (el.gradient) {
    const pieces = letters.flatMap((letter) => letter.pieces);
    return { shapes: pieces.length ? [shapeOf(pieces, el.gradient)] : [], missing, noFont: [] };
  }
  return { shapes: letters.map((letter) => shapeOf(letter.pieces, { type: "solid", color: letter.color })), missing, noFont: [] };
}

const CARRIED = ["name", "shadow", "blur", "blend", "alt", "link", "animation"] as const satisfies ReadonlyArray<keyof ElementBase>;

export interface TextShapes {
  element: GroupElement | ShapeElement | null;
  count: number;
  missing: number;
  /** the text had an effect, which the shapes do not have */
  effectDropped: boolean;
  problem: TextOutlineProblem | null;
  noFont: string[];
}

/**
 * What takes the place of the text box: the letters, exactly where the element shows them. As for a drawing (svgImport.ts
 * `convertToShapes`), the turn of the element becomes the turn of the group, about a centre that keeps everything in place,
 * and what belongs to the element as a whole goes to the group.
 */
export function textInPlaceOf(el: TextElement, layout: TextLayout, faceFor: FaceFor): TextShapes {
  const effectDropped = el.effect.kind !== "none";
  const none = (problem: TextOutlineProblem, noFont: string[] = [], missing = 0): TextShapes => ({ element: null, count: 0, missing, effectDropped, problem, noFont });
  if (el.curve && curveGeometry(el, layout)) return none("curved");
  const mirror: Matrix = [el.flipH ? -1 : 1, 0, 0, el.flipV ? -1 : 1, el.flipH ? el.width : 0, el.flipV ? el.height : 0];
  let outline: TextOutline;
  try {
    outline = outlineText(el, layout, faceFor, mirror);
  } catch (error) {
    if (error instanceof TooLarge) return none("too-large");
    throw error;
  }
  if (outline.noFont.length) return none("no-font", outline.noFont, outline.missing);
  const { shapes } = outline;
  if (!shapes.length) return none("empty", [], outline.missing);

  const left = Math.min(...shapes.map((s) => s.x));
  const top = Math.min(...shapes.map((s) => s.y));
  const width = tidy(Math.max(...shapes.map((s) => s.x + s.width)) - left);
  const height = tidy(Math.max(...shapes.map((s) => s.y + s.height)) - top);
  const centre = fromLocalPoint(el, { x: left + width / 2, y: top + height / 2 });
  const box = { x: tidy(centre.x - width / 2), y: tidy(centre.y - height / 2), width, height, rotation: el.rotation };
  const carried = Object.fromEntries(CARRIED.filter((key) => el[key] !== undefined).map((key) => [key, el[key]])) as Partial<Pick<ElementBase, (typeof CARRIED)[number]>>;
  const element: GroupElement | ShapeElement =
    shapes.length === 1
      ? { ...shapes[0], ...carried, ...box, opacity: el.opacity }
      : createGroup(
          shapes.map((shape) => ({ ...shape, x: tidy(shape.x - left), y: tidy(shape.y - top) })),
          { ...carried, ...box, opacity: el.opacity },
        );
  return { element, count: shapes.length, missing: outline.missing, effectDropped, problem: null, noFont: [] };
}

/**
 * Opens a font file with fontkit (the first font of a collection), at `weight` when it is a variable font with a weight axis.
 * A WOFF or WOFF2 file is rebuilt as a plain file first, which is the only kind fontkit sets a weight on (sfnt.ts).
 */
export async function openFace(data: ArrayBuffer, weight: number, variable: boolean, slanted: boolean): Promise<OutlineFace> {
  const fontkit = await import("fontkit");
  const first = (opened: ReturnType<typeof fontkit.create>) => ("fonts" in opened ? opened.fonts[0] : opened);
  let font = first(fontkit.create(new Uint8Array(data)));
  if (variable && font.variationAxes?.wght) {
    const plain = plainFile(font);
    if (plain) font = first(fontkit.create(plain));
    font = font.getVariation({ wght: weight });
  }
  return { font, slanted };
}

/**
 * Everything the action needs, from the element alone: lays it out, fetches and opens the file of every face it uses (each
 * once), and converts. Rejects when a file cannot be fetched or read.
 */
export async function textToShapes(el: TextElement): Promise<TextShapes> {
  const layout = layoutText(el);
  const styles = new Map<string, RunStyle>();
  for (const line of layout.lines) {
    for (const seg of line.segments) if (!seg.isSpace && seg.text) styles.set(keyOf(seg.style), seg.style);
    if (line.marker) styles.set(keyOf(line.marker.style), line.marker.style);
  }
  const faces = new Map<string, OutlineFace | null>();
  await Promise.all(
    [...styles].map(async ([key, style]) => {
      const file = await faceFile(style.family, style.weight, style.italic);
      faces.set(key, file && (await openFace(file.data, file.weight, file.variable, file.slanted)));
    }),
  );
  return textInPlaceOf(el, layout, (style) => faces.get(keyOf(style)) ?? null);
}
