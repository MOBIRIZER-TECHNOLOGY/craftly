/**
 * A drawing (SVG markup) as shapes of the editor, so that a picture that is a drawing can be taken apart and its points edited.
 *
 * Only markup that is plain drawing is read (`svgProblem`, src/core/svgSafety.ts), which keeps the list of what there is to
 * understand short: path, rect, circle, ellipse, line, polyline, polygon, groups and drawings inside the drawing, their
 * transforms and their paint. Every one of them becomes a path shape (src/core/penShape.ts), with the transforms worked into
 * the points, in the paint order of the drawing and without the groups: a group of an SVG only hands down paint and a
 * transform, and both are in the shapes then.
 *
 * What the editor has no word for is either made simpler and counted in `simplified` (a clip, a mask, a filter, a marker, a
 * gradient on an outline, a pattern beside other paint) or left out and counted in `skipped` (a part painted with a pattern
 * only, a path or transform that cannot be read). A few things are made simpler without being counted, because a count
 * would say little: dashes become the editor's own dashed line, a gradient keeps its direction or centre and its colours
 * but not its exact ends, and the opacity of a group is given to each shape in it. What a browser would not show either
 * (no paint, no size, `display="none"`) is left out and not counted. The limits keep a huge file from freezing the editor:
 * over them nothing is converted at all.
 */
import type { RGBA } from "./color";
import { createGroup, createShape } from "./factory";
import { fromLocalPoint } from "./geometry";
import { fitPaths, pathBounds, type PenPath } from "./pen";
import { recolorSvg, setSvgStrokeWidth } from "./svg";
import { colorText, mixColors, parseShare, parseSvgColor } from "./svgColor";
import {
  IDENTITY,
  TooLarge,
  apart,
  applyTo,
  ellipsePath,
  evenOddPieces,
  fitViewBox,
  multiply,
  parsePathData,
  parseTransform,
  pointsPath,
  rectPath,
  scaleOf,
  scaling,
  transformPath,
  translation,
  type Budget,
  type Matrix,
} from "./svgGeometry";
import { svgProblem } from "./svgSafety";
import type { ElementBase, Fill, GradientStop, GraphicElement, GroupElement, ImageElement, Point, Rect, ShapeElement, Stroke } from "./types";

/** The most shapes a drawing may become. */
export const MAX_SHAPES = 500;
/** The most points all its paths may have together. */
export const MAX_POINTS = 20_000;
/** The longest markup that is read at all, in characters. */
const MAX_MARKUP = 2_000_000;
/** A path with more pieces than this stays one shape as it is: telling which piece lies in which compares each with each. */
const MAX_COMPARED = 400;
/** The size a browser gives a drawing that states neither a view box nor a width and height. */
const DEFAULT_SIZE = { w: 300, h: 150 };

const XLINK = "http://www.w3.org/1999/xlink";

/**
 * Why nothing was converted: the markup is more than plain drawing, it could not be read as a drawing, or it holds more than
 * the limits allow.
 */
export type SvgImportProblem = "not-plain" | "unreadable" | "too-large";

export interface SvgShapes {
  /** from the back to the front, placed in the space of the box the drawing was laid over */
  shapes: ShapeElement[];
  /** parts that could not be converted and were left out */
  skipped: number;
  /** parts that were converted without something the editor cannot express */
  simplified: number;
  problem: SvgImportProblem | null;
}

/* ------------------------------------------------------------------ */
/* reading attributes                                                  */
/* ------------------------------------------------------------------ */

const UNITS: Readonly<Record<string, number>> = { "": 1, px: 1, pt: 96 / 72, pc: 16, mm: 96 / 25.4, cm: 96 / 2.54, in: 96, em: 16, ex: 8 };
const LENGTH = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)(px|pt|pc|mm|cm|in|em|ex|%)?$/i;

/** A length in the units of the drawing, or null when the text is not one. A share is taken of `whole`. */
function parseLength(raw: string | null, whole: number): number | null {
  const found = LENGTH.exec((raw ?? "").trim());
  if (!found) return null;
  const unit = (found[2] ?? "").toLowerCase();
  return unit === "%" ? (parseFloat(found[1]) / 100) * whole : parseFloat(found[1]) * UNITS[unit];
}

interface View {
  w: number;
  h: number;
}

/** The length that a share of "the size of the drawing" is taken of when it is neither a width nor a height. */
const diagonal = (view: View) => Math.sqrt((view.w * view.w + view.h * view.h) / 2);

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));

/** An opacity between 0 and 1, or `fallback` when the attribute is not there or is not a number. */
function opacityOf(el: Element, name: string, fallback: number): number {
  const value = parseShare(el.getAttribute(name) ?? "");
  return Number.isNaN(value) ? fallback : clamp01(value);
}

function viewBoxOf(el: Element): Rect | null {
  const n = (el.getAttribute("viewBox") ?? "")
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  return n.length === 4 && n.every(Number.isFinite) && n[2] > 0 && n[3] > 0 ? { x: n[0], y: n[1], w: n[2], h: n[3] } : null;
}

/* ------------------------------------------------------------------ */
/* paint                                                               */
/* ------------------------------------------------------------------ */

const ADDRESS = /^url\(\s*(["']?)#([^"')\s]+)\1\s*\)\s*(.*)$/i;

/** What is handed down from an element to the elements in it. */
interface Inherited {
  /** as written: none, currentColor, a colour, or an address with what to use when it leads nowhere */
  fill: string;
  stroke: string;
  color: RGBA;
  fillOpacity: number;
  strokeOpacity: number;
  strokeWidth: number;
  cap: NonNullable<Stroke["cap"]>;
  join: NonNullable<Stroke["join"]>;
  /** the editor's own dashes and dots stand in for whatever dashes the drawing has */
  line: Stroke["style"];
  evenOdd: boolean;
  visible: boolean;
}

const BLACK: RGBA = { r: 0, g: 0, b: 0, a: 1 };
const INITIAL: Inherited = {
  fill: "black",
  stroke: "none",
  color: BLACK,
  fillOpacity: 1,
  strokeOpacity: 1,
  strokeWidth: 1,
  cap: "butt",
  join: "miter",
  line: "solid",
  evenOdd: false,
  visible: true,
};

const isPaint = (value: string) => /^(none|currentcolor)$/i.test(value) || ADDRESS.test(value) || parseSvgColor(value) !== null;

/** One of a few words, or undefined: a value that is not one of them is a value that was not said. */
function wordOf<T extends string>(el: Element, name: string, words: readonly T[]): T | undefined {
  const value = (el.getAttribute(name) ?? "").trim() as T;
  return words.includes(value) ? value : undefined;
}

/** What the elements inside `el` inherit: what `el` says itself, and for the rest what it inherited. */
function inherit(el: Element, from: Inherited, view: View): Inherited {
  const next = { ...from };
  for (const name of ["fill", "stroke"] as const) {
    const value = (el.getAttribute(name) ?? "").trim();
    if (isPaint(value)) next[name] = value;
  }
  const colour = parseSvgColor(el.getAttribute("color") ?? "");
  if (colour) next.color = colour;
  next.fillOpacity = opacityOf(el, "fill-opacity", from.fillOpacity);
  next.strokeOpacity = opacityOf(el, "stroke-opacity", from.strokeOpacity);
  next.strokeWidth = parseLength(el.getAttribute("stroke-width"), diagonal(view)) ?? from.strokeWidth;
  next.cap = wordOf(el, "stroke-linecap", ["butt", "round", "square"]) ?? from.cap;
  next.join = wordOf(el, "stroke-linejoin", ["miter", "round", "bevel"]) ?? from.join;
  const dashes = el.getAttribute("stroke-dasharray");
  if (dashes !== null && dashes.trim() !== "inherit") {
    // dashes and gaps in turn; a list of an odd length is gone through twice, so a dash of the first round is a gap of the next
    const lengths = (dashes.match(/[\d.]+/g) ?? []).map(parseFloat);
    const drawn = (lengths.length % 2 ? [...lengths, ...lengths] : lengths).filter((_length, i) => i % 2 === 0);
    // dashes of no length are dots, which is what round or square ends make of them
    next.line = lengths.every((length) => length === 0) ? "solid" : drawn.every((length) => length === 0) ? "dotted" : "dashed";
  }
  const rule = wordOf(el, "fill-rule", ["nonzero", "evenodd"]);
  if (rule) next.evenOdd = rule === "evenodd";
  const visibility = wordOf(el, "visibility", ["visible", "hidden", "collapse"]);
  if (visibility) next.visible = visibility === "visible";
  return next;
}

interface Stop {
  at: number;
  colour: RGBA;
}

/** What a fill or an outline is painted with: nothing, a colour, a gradient, or something the editor has no word for. */
type Paint = { kind: "none" } | { kind: "colour"; colour: RGBA } | { kind: "gradient"; chain: Element[]; stops: Stop[] } | { kind: "other" };

const NONE: Paint = { kind: "none" };

/**
 * The stops of a gradient as the editor draws one, between 0 and 1. A gradient of a drawing may start before the shape and end
 * after it, and the editor's always runs from one edge of the box to the other, so `stops` come with their places on that
 * line: a place outside the shape is cut off, and the edge gets the colour the gradient has there. One colour is left when
 * the whole gradient lies beside the shape, or when all its colours are the same.
 */
function fillFromStops(stops: Stop[], opacity: number, gradient: (stops: GradientStop[]) => Fill): Fill {
  const first = stops[0];
  const last = stops[stops.length - 1];
  const colourAt = (t: number): RGBA => {
    if (t <= first.at) return first.colour;
    const next = stops.findIndex((stop) => t <= stop.at);
    if (next < 0) return last.colour;
    const span = stops[next].at - stops[next - 1].at;
    return mixColors(stops[next - 1].colour, stops[next].colour, (t - stops[next - 1].at) / span);
  };
  const kept: Stop[] = [];
  if (first.at < 0) kept.push({ at: 0, colour: colourAt(0) });
  kept.push(...stops.filter((stop) => stop.at >= 0 && stop.at <= 1));
  if (last.at > 1) kept.push({ at: 1, colour: colourAt(1) });
  const out = kept.map((stop) => ({ offset: Math.round(stop.at * 1e4) / 1e4, color: colorText(stop.colour, opacity) }));
  return out.every((stop) => stop.color === out[0].color) ? { type: "solid", color: out[0].color } : gradient(out);
}

/* ------------------------------------------------------------------ */
/* the drawing                                                         */
/* ------------------------------------------------------------------ */

/** Elements whose content is not drawn where it stands: it serves other elements, or describes the drawing. */
const NOT_DRAWN: ReadonlySet<string> = new Set(["defs", "symbol", "clipPath", "mask", "pattern", "marker", "linearGradient", "radialGradient", "stop", "filter", "title", "desc"]);
const DROPPED_FROM_ANY = ["clip-path", "mask", "filter"];
const DROPPED_FROM_SHAPES = ["marker-start", "marker-mid", "marker-end"];

/** Where an element is drawn: the transform to the box of the drawing, what it inherits, and the size shares are taken of. */
interface Place {
  matrix: Matrix;
  inherited: Inherited;
  opacity: number;
  view: View;
}

/** Three decimals and never a minus zero: what is stored of a place or a size. */
const tidy = (v: number) => Math.round(v * 1000) / 1000 + 0;

function parse(markup: string): Element | null {
  // an old drawing may use xlink:href without saying what xlink is, which a browser forgives in a page and XML does not
  const text = /\sxlink:/.test(markup) && !/\sxmlns:xlink\s*=/.test(markup) ? markup.replace(/<svg\b/, `<svg xmlns:xlink="${XLINK}"`) : markup;
  const doc = new DOMParser().parseFromString(text, "image/svg+xml");
  const root = doc.documentElement;
  return root.localName === "svg" && doc.getElementsByTagName("parsererror").length === 0 ? root : null;
}

/**
 * The shapes of a drawing that is stretched over a box of `width` x `height` at the origin, the way a picture of it is
 * stretched over an element. `outer` is applied last, to put the shapes somewhere else or mirror them.
 */
export function svgToShapes(markup: string, width: number, height: number, outer: Matrix = IDENTITY): SvgShapes {
  const refused = (problem: SvgImportProblem): SvgShapes => ({ shapes: [], skipped: 0, simplified: 0, problem });
  if (markup.length > MAX_MARKUP) return refused("too-large");
  if (svgProblem(markup) !== null) return refused("not-plain");
  if (!(width > 0 && height > 0)) return refused("unreadable");
  try {
    const root = parse(markup);
    return root ? shapesOfDrawing(root, width, height, outer) : refused("unreadable");
  } catch (error) {
    // More than the limits allow. Anything else that goes wrong is something in the drawing that this reader did not
    // foresee, and the answer to that is the same as to a drawing that cannot be read: nothing is converted.
    return refused(error instanceof TooLarge ? "too-large" : "unreadable");
  }
}

/** The shapes of a drawing that was parsed. Throws `TooLarge` when it holds more than the limits allow. */
function shapesOfDrawing(root: Element, width: number, height: number, outer: Matrix): SvgShapes {
  const result: SvgShapes = { shapes: [], skipped: 0, simplified: 0, problem: null };
  const budget: Budget = { points: MAX_POINTS };
  const byId = new Map<string, Element>();
  for (const el of Array.from(root.getElementsByTagName("*"))) {
    const id = el.getAttribute("id");
    if (id && !byId.has(id)) byId.set(id, el);
  }

  /** The gradient with what it takes from the gradients it points to: itself first, then the one it names, and so on. */
  const chainOf = (gradient: Element): Element[] => {
    const chain: Element[] = [];
    for (let el: Element | undefined = gradient; el && !chain.includes(el) && /Gradient$/.test(el.localName);) {
      chain.push(el);
      el = byId.get((el.getAttribute("href") ?? el.getAttribute("xlink:href") ?? "").slice(1));
    }
    return chain;
  };
  const stopsOf = (chain: Element[]): Stop[] => {
    const owner = chain.find((el) => Array.from(el.children).some((child) => child.localName === "stop"));
    let reached = 0;
    return Array.from(owner?.children ?? [])
      .filter((child) => child.localName === "stop")
      .map((stop) => {
        const offset = parseShare(stop.getAttribute("offset") ?? "");
        // a stop is never before the one before it
        reached = Math.max(reached, clamp01(Number.isNaN(offset) ? 0 : offset));
        const colour = parseSvgColor(stop.getAttribute("stop-color") ?? "") ?? BLACK;
        return { at: reached, colour: { ...colour, a: colour.a * opacityOf(stop, "stop-opacity", 1) } };
      });
  };

  const paintOf = (text: string, inherited: Inherited): Paint => {
    if (/^none$/i.test(text)) return NONE;
    if (/^currentcolor$/i.test(text)) return { kind: "colour", colour: inherited.color };
    const address = ADDRESS.exec(text);
    if (!address) return { kind: "colour", colour: parseSvgColor(text) as RGBA };
    const target = byId.get(address[2]);
    // an address that leads nowhere: the paint written after it, or none
    if (!target) return isPaint(address[3]) && !ADDRESS.test(address[3]) ? paintOf(address[3], inherited) : NONE;
    if (!/Gradient$/.test(target.localName)) return { kind: "other" };
    const chain = chainOf(target);
    const stops = stopsOf(chain);
    if (!stops.length) return NONE;
    return stops.length === 1 ? { kind: "colour", colour: stops[0].colour } : { kind: "gradient", chain, stops };
  };

  /**
   * A gradient as a fill of a shape whose box on the page is `box`. `own` is the box of the shape in its own units, which a
   * gradient is measured in unless it says `userSpaceOnUse`. The editor draws a linear gradient through the middle of the
   * box at an angle, from edge to edge, and a radial one from a centre to the farthest corner: the direction or the centre
   * is kept, and the stops are moved to where they are on that line.
   */
  const gradientFill = (paint: Extract<Paint, { kind: "gradient" }>, own: Rect, place: Place, box: Rect, opacity: number): Fill | null => {
    const said = (name: string): string | null => paint.chain.find((el) => el.hasAttribute(name))?.getAttribute(name) ?? null;
    const inBox = said("gradientUnits") !== "userSpaceOnUse";
    if (inBox && (own.w === 0 || own.h === 0)) return null;
    const units: Matrix = inBox ? [own.w, 0, 0, own.h, own.x, own.y] : IDENTITY;
    const matrix = multiply(multiply(place.matrix, units), parseTransform(said("gradientTransform") ?? "") ?? IDENTITY);
    /** A coordinate of the gradient: a share of the box of the shape, or a length in the units of the drawing. */
    const coordinate = (name: string, fallback: number, whole: number): number => {
      const raw = said(name);
      const value = inBox ? parseShare(raw ?? "") : parseLength(raw, whole);
      return value === null || Number.isNaN(value) ? (inBox ? fallback : fallback * whole) : value;
    };
    const last = paint.stops[paint.stops.length - 1];
    const solid: Fill = { type: "solid", color: colorText(last.colour, opacity) };

    if (paint.chain[0].localName === "linearGradient") {
      const p1 = applyTo(matrix, { x: coordinate("x1", 0, place.view.w), y: coordinate("y1", 0, place.view.h) });
      const p2 = applyTo(matrix, { x: coordinate("x2", 1, place.view.w), y: coordinate("y2", 0, place.view.h) });
      const length = Math.hypot(p2.x - p1.x, p2.y - p1.y);
      if (length < 1e-9) return solid;
      const along: Point = { x: (p2.x - p1.x) / length, y: (p2.y - p1.y) / length };
      // the editor's line runs through the middle of the box and is as long as the box is across in that direction
      const half = (Math.abs(box.w * along.x) + Math.abs(box.h * along.y)) / 2;
      const placeOf = (p: Point) => ((p.x - box.x - box.w / 2) * along.x + (p.y - box.y - box.h / 2) * along.y + half) / (2 * half);
      const from = placeOf(p1);
      const to = placeOf(p2);
      const angle = Math.round((((Math.atan2(along.y, along.x) * 180) / Math.PI + 90 + 360) % 360) * 100) / 100;
      return fillFromStops(
        paint.stops.map((stop) => ({ at: from + stop.at * (to - from), colour: stop.colour })),
        opacity,
        (stops) => ({ type: "linear", angle, stops }),
      );
    }
    const centre = applyTo(matrix, { x: coordinate("cx", 0.5, place.view.w), y: coordinate("cy", 0.5, place.view.h) });
    const radius = coordinate("r", 0.5, diagonal(place.view)) * scaleOf(matrix);
    if (radius < 1e-9) return solid;
    const cx = clamp01((centre.x - box.x) / box.w);
    const cy = clamp01((centre.y - box.y) / box.h);
    const reach = Math.hypot(Math.max(cx, 1 - cx) * box.w, Math.max(cy, 1 - cy) * box.h);
    return fillFromStops(
      paint.stops.map((stop) => ({ at: (stop.at * radius) / reach, colour: stop.colour })),
      opacity,
      (stops) => ({ type: "radial", stops, cx: tidy(cx), cy: tidy(cy) }),
    );
  };

  /** The outline of a basic shape or a path in its own units, and whether its data was wrong somewhere. */
  const outlineOf = (el: Element, view: View): { pieces: PenPath[]; mistake: boolean } => {
    const length = (name: string, whole: number) => parseLength(el.getAttribute(name), whole) ?? 0;
    const one = (path: PenPath | null) => ({ pieces: path ? [path] : [], mistake: false });
    switch (el.localName) {
      case "path":
        return parsePathData(el.getAttribute("d") ?? "", budget);
      case "rect": {
        const w = length("width", view.w);
        const h = length("height", view.h);
        if (!(w > 0 && h > 0)) return one(null);
        // a radius that is not given, or is not one, is the other radius
        const stated = [parseLength(el.getAttribute("rx"), view.w), parseLength(el.getAttribute("ry"), view.h)].map((r) => (r !== null && r >= 0 ? r : null));
        const rx = Math.min(stated[0] ?? stated[1] ?? 0, w / 2);
        const ry = Math.min(stated[1] ?? stated[0] ?? 0, h / 2);
        return one(rectPath(length("x", view.w), length("y", view.h), w, h, rx, ry));
      }
      case "circle":
      case "ellipse": {
        const round = el.localName === "circle";
        const rx = length(round ? "r" : "rx", round ? diagonal(view) : view.w);
        const ry = round ? rx : length("ry", view.h);
        return one(rx > 0 && ry > 0 ? ellipsePath(length("cx", view.w), length("cy", view.h), rx, ry) : null);
      }
      case "line": {
        const from = { x: length("x1", view.w), y: length("y1", view.h) };
        const to = { x: length("x2", view.w), y: length("y2", view.h) };
        const flat = from.x === to.x && from.y === to.y;
        return one(flat ? null : { closed: false, nodes: [from, to].map((p) => ({ ...p, handleIn: null, handleOut: null })) });
      }
      default:
        // polyline and polygon: the two that are left
        return one(pointsPath(el.getAttribute("points") ?? "", el.localName === "polygon", budget));
    }
  };

  const drawShape = (el: Element, place: Place): void => {
    const { inherited, matrix } = place;
    if (!inherited.visible || scaleOf(matrix) === 0) return;
    const outline = outlineOf(el, place.view);
    if (!outline.pieces.length) {
      if (outline.mistake) result.skipped++;
      return;
    }
    const fillPaint = el.localName === "line" ? NONE : paintOf(inherited.fill, inherited);
    const strokePaint = inherited.strokeWidth > 0 ? paintOf(inherited.stroke, inherited) : NONE;
    // what the editor cannot paint with: a pattern as a fill or an outline, a gradient on an outline
    const lost = fillPaint.kind === "other" || strokePaint.kind === "other" || strokePaint.kind === "gradient";

    let stroke: Stroke | null = null;
    const strokeColour = strokePaint.kind === "colour" ? strokePaint.colour : strokePaint.kind === "gradient" ? strokePaint.stops[0].colour : null;
    // dots with flat ends have no length and no ends: nothing is drawn of them
    const drawn = inherited.line !== "dotted" || inherited.cap !== "butt";
    if (strokeColour && strokeColour.a * inherited.strokeOpacity > 0 && drawn) {
      stroke = {
        color: colorText(strokeColour, inherited.strokeOpacity),
        width: tidy(inherited.strokeWidth * scaleOf(matrix)),
        style: inherited.line,
        cap: inherited.cap,
        join: inherited.join,
      };
    }
    // the box of the shape in its own units, which a gradient is measured in
    const corners = outline.pieces.map(pathBounds);
    const ownLeft = Math.min(...corners.map((b) => b.x));
    const ownTop = Math.min(...corners.map((b) => b.y));
    const ownBox: Rect = { x: ownLeft, y: ownTop, w: Math.max(...corners.map((b) => b.x + b.w)) - ownLeft, h: Math.max(...corners.map((b) => b.y + b.h)) - ownTop };
    /** The fill of a shape whose box is `box`, or null for none. */
    const fillFor = (box: Rect): Fill | null => {
      if (fillPaint.kind === "gradient") return gradientFill(fillPaint, ownBox, place, box, inherited.fillOpacity);
      const visible = fillPaint.kind === "colour" && fillPaint.colour.a * inherited.fillOpacity > 0;
      return visible ? { type: "solid", color: colorText(fillPaint.colour, inherited.fillOpacity) } : null;
    };

    let pieces = outline.pieces.map((piece) => transformPath(piece, matrix));
    const filled = fillFor(fitPaths(pieces).box) !== null;
    if (!filled && !stroke) {
      if (lost) result.skipped++;
      return;
    }
    const many = pieces.length > 1;
    const comparable = pieces.length <= MAX_COMPARED;
    const turnHoles = many && filled && inherited.evenOdd;
    if (turnHoles && comparable) pieces = evenOddPieces(pieces);
    // with too many pieces to compare, the holes that only the even-odd rule makes are filled
    if (lost || (turnHoles && !comparable)) result.simplified++;

    // Pieces that lie apart become shapes of their own, which can be edited point by point (a shape of several pieces
    // cannot). Pieces that touch stay together: one may be a hole in the other, and where see-through paint overlaps, two
    // shapes would be darker than one. An opaque outline with no fill looks the same either way. A gradient runs over all
    // the pieces as one.
    let sets: number[][] = [pieces.map((_piece, i) => i)];
    if (many && comparable && fillPaint.kind !== "gradient") {
      const margin = stroke ? stroke.width / 2 : 0;
      const opaqueOutline = !filled && place.opacity === 1 && (strokeColour as RGBA).a * inherited.strokeOpacity >= 1;
      sets = opaqueOutline
        ? pieces.map((_piece, i) => [i])
        : apart(pieces.map(pathBounds).map((b) => ({ x: b.x - margin, y: b.y - margin, w: b.w + 2 * margin, h: b.h + 2 * margin })));
    }
    for (const set of sets) {
      if (result.shapes.length >= MAX_SHAPES) throw new TooLarge();
      const { d, box } = fitPaths(set.map((i) => pieces[i]));
      result.shapes.push(
        createShape("path", { x: tidy(box.x), y: tidy(box.y), width: tidy(box.w), height: tidy(box.h), path: d, fill: fillFor(box), stroke, opacity: place.opacity }),
      );
    }
  };

  /** Draws an element and what is in it. `fitted` is given for the drawing itself: the transform that fits its view box. */
  const draw = (el: Element, outside: Place, fitted: Matrix | null): void => {
    const name = el.localName;
    if (NOT_DRAWN.has(name) || (el.getAttribute("display") ?? "").trim() === "none") return;
    const own = parseTransform(el.getAttribute("transform") ?? "");
    if (!own) {
      result.skipped++;
      return;
    }
    const container = name === "g" || name === "svg";
    const dropped = [...DROPPED_FROM_ANY, ...(container ? [] : DROPPED_FROM_SHAPES)].some((attribute) => !["", "none"].includes((el.getAttribute(attribute) ?? "").trim()));
    if (dropped) result.simplified++;
    const place: Place = {
      matrix: multiply(outside.matrix, own),
      inherited: inherit(el, outside.inherited, outside.view),
      opacity: outside.opacity * opacityOf(el, "opacity", 1),
      view: outside.view,
    };
    if (!container) return drawShape(el, place);
    if (fitted) place.matrix = multiply(place.matrix, fitted);
    else if (name === "svg") {
      // a drawing inside the drawing: a viewport of its own at x, y, and a view box of its own that is fitted into it
      const w = parseLength(el.getAttribute("width"), outside.view.w) ?? outside.view.w;
      const h = parseLength(el.getAttribute("height"), outside.view.h) ?? outside.view.h;
      if (!(w > 0 && h > 0)) return;
      const box = viewBoxOf(el);
      const at = translation(parseLength(el.getAttribute("x"), outside.view.w) ?? 0, parseLength(el.getAttribute("y"), outside.view.h) ?? 0);
      place.matrix = multiply(place.matrix, box ? multiply(at, fitViewBox(box, w, h, el.getAttribute("preserveAspectRatio") ?? "")) : at);
      place.view = box ?? { w, h };
    }
    for (const child of Array.from(el.children)) draw(child, place, null);
  };

  // The picture of the drawing has the size the drawing states: its view box fitted into its width and height, or the view
  // box alone, or the width and height alone. That picture is what an element stretches over its box.
  const box = viewBoxOf(root);
  const w = parseLength(root.getAttribute("width"), Number.NaN);
  const h = parseLength(root.getAttribute("height"), Number.NaN);
  const sized = w !== null && h !== null && w > 0 && h > 0;
  const picture: View = sized ? { w, h } : (box ?? DEFAULT_SIZE);
  const fitted = box ? fitViewBox(box, picture.w, picture.h, sized ? (root.getAttribute("preserveAspectRatio") ?? "") : "none") : IDENTITY;
  const stretched = multiply(outer, scaling(width / picture.w, height / picture.h));
  draw(root, { matrix: stretched, inherited: INITIAL, opacity: 1, view: box ?? picture }, fitted);
  return result;
}

/* ------------------------------------------------------------------ */
/* in the place of an element                                          */
/* ------------------------------------------------------------------ */

export interface ConvertedElement {
  /** what takes the place of the element: a group of the shapes, or the shape itself when there is one; null when there is none */
  element: GroupElement | ShapeElement | null;
  /** how many shapes it holds */
  count: number;
  skipped: number;
  simplified: number;
  problem: SvgImportProblem | null;
}

const CARRIED = ["name", "shadow", "blur", "blend", "alt", "link", "animation"] as const satisfies ReadonlyArray<keyof ElementBase>;

/** The markup a graphic is drawn from: its own, with the colours and the line width it was given in the editor. */
function markupOf(el: GraphicElement): string {
  const recoloured = recolorSvg(el.svg, el.colors);
  return el.strokeWidth ? setSvgStrokeWidth(recoloured, el.strokeWidth) : recoloured;
}

/**
 * What takes the place of a graphic, or of a picture whose file is the drawing `markup`: the shapes of the drawing, exactly
 * where the element shows them. A picture shows its whole file over the place its crop says, which may reach outside its
 * box, and so do the shapes; a mask or a filter of the picture is not carried over. A mirrored element gives mirrored
 * points, and the turn of the element becomes the turn of the group, about a centre that keeps everything where it is. What
 * belongs to the element as a whole (its name, opacity, shadow, link ...) goes to the group.
 */
export function convertToShapes(el: ImageElement | GraphicElement, markup?: string): ConvertedElement {
  const source = markup ?? (el.type === "graphic" ? markupOf(el) : "");
  const frame: Rect =
    el.type === "image" ? { x: el.crop.x * el.width, y: el.crop.y * el.height, w: el.crop.w * el.width, h: el.crop.h * el.height } : { x: 0, y: 0, w: el.width, h: el.height };
  const mirror: Matrix = [el.flipH ? -1 : 1, 0, 0, el.flipV ? -1 : 1, el.flipH ? el.width : 0, el.flipV ? el.height : 0];
  const { shapes, skipped, simplified, problem } = svgToShapes(source, frame.w, frame.h, multiply(mirror, translation(frame.x, frame.y)));
  if (!shapes.length) return { element: null, count: 0, skipped, simplified, problem };

  const left = Math.min(...shapes.map((s) => s.x));
  const top = Math.min(...shapes.map((s) => s.y));
  const width = tidy(Math.max(...shapes.map((s) => s.x + s.width)) - left);
  const height = tidy(Math.max(...shapes.map((s) => s.y + s.height)) - top);
  // the box turns about its own middle: put that middle where the turn of the element puts it
  const centre = fromLocalPoint(el, { x: left + width / 2, y: top + height / 2 });
  const box = { x: tidy(centre.x - width / 2), y: tidy(centre.y - height / 2), width, height, rotation: el.rotation };
  const carried = Object.fromEntries(CARRIED.filter((key) => el[key] !== undefined).map((key) => [key, el[key]])) as Partial<Pick<ElementBase, (typeof CARRIED)[number]>>;
  const element: GroupElement | ShapeElement =
    shapes.length === 1
      ? { ...shapes[0], ...carried, ...box, opacity: shapes[0].opacity * el.opacity }
      : createGroup(
          shapes.map((shape) => ({ ...shape, x: tidy(shape.x - left), y: tidy(shape.y - top) })),
          { ...carried, ...box, opacity: el.opacity },
        );
  return { element, count: shapes.length, skipped, simplified, problem };
}
