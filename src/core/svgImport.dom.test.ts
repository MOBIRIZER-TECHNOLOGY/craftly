/**
 * Turning a drawing (SVG markup that is plain drawing) into shapes of the editor: what every element and every path command
 * becomes, where the shapes land, what paint they get, what is left out and counted, and where the limits are.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createGraphic, createImage } from "./factory";
import { fromLocalPoint } from "./geometry";
import { bezierPoint, parsePath, segmentsOf, type PenPath } from "./pen";
import { iconNodeToSvg } from "./svg";
import { MAX_POINTS, MAX_SHAPES, convertToShapes, svgToShapes } from "./svgImport";
import { svgProblem } from "./svgSafety";
import type { GroupElement, LinearGradientFill, RadialGradientFill, ShapeElement } from "./types";
import { GRAPHICS } from "@/data/graphics";

const svg = (body: string, attrs = 'viewBox="0 0 100 100"') => `<svg xmlns="http://www.w3.org/2000/svg" ${attrs}>${body}</svg>`;
/** The shapes of a drawing of 100 x 100 that is laid over a box of 100 x 100: a unit of the drawing is a pixel. */
const shapesOf = (body: string, attrs?: string) => svgToShapes(svg(body, attrs), 100, 100).shapes;
const only = (body: string, attrs?: string): ShapeElement => {
  const shapes = shapesOf(body, attrs);
  expect(shapes).toHaveLength(1);
  return shapes[0];
};

/** Two decimals, which is what is left of a number that was stored with three in a box of a hundred; never a minus zero. */
const r2 = (v: number) => Math.round(v * 100) / 100 + 0;

/** The pieces of a shape as points in the pixels of the space the shapes are in. */
function pieces(shape: ShapeElement): PenPath[] {
  const sx = shape.width / 100;
  const sy = shape.height / 100;
  return (shape.path as string)
    .split(/(?=M)/)
    .map((d) => parsePath(d.trim()) as PenPath)
    .map((path) => ({
      closed: path.closed,
      nodes: path.nodes.map((n) => ({
        x: r2(shape.x + n.x * sx),
        y: r2(shape.y + n.y * sy),
        handleIn: n.handleIn && { x: r2(n.handleIn.x * sx), y: r2(n.handleIn.y * sy) },
        handleOut: n.handleOut && { x: r2(n.handleOut.x * sx), y: r2(n.handleOut.y * sy) },
      })),
    }));
}
const piece = (shape: ShapeElement): PenPath => {
  const all = pieces(shape);
  expect(all).toHaveLength(1);
  return all[0];
};
const corners = (path: PenPath) => path.nodes.map((n) => [n.x, n.y]);
const box = (shape: ShapeElement) => [shape.x, shape.y, shape.width, shape.height].map(r2);
/** Twice the area of a piece, with the sign of the way round it runs. */
const turn = (path: PenPath) => path.nodes.reduce((sum, n, i) => sum + n.x * path.nodes[(i + 1) % path.nodes.length].y - path.nodes[(i + 1) % path.nodes.length].x * n.y, 0);
/** How far the points along the sides of a piece are from a centre, at most and at least. */
function radii(path: PenPath, cx: number, cy: number): [number, number] {
  const all = segmentsOf(path).flatMap((side) => [0, 0.25, 0.5, 0.75, 1].map((t) => bezierPoint(side, t)));
  const r = all.map((p) => Math.hypot(p.x - cx, p.y - cy));
  return [Math.min(...r), Math.max(...r)];
}

describe("path data", () => {
  it("reads lines with M, L, H, V and Z", () => {
    const shape = only('<path d="M10 10 L90 10 V90 H10 Z"/>');
    expect(box(shape)).toEqual([10, 10, 80, 80]);
    expect(piece(shape).closed).toBe(true);
    expect(corners(piece(shape))).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ]);
    expect(piece(shape).nodes.every((n) => !n.handleIn && !n.handleOut)).toBe(true);
  });

  it("counts the small letters from the point before", () => {
    const shape = only('<path d="m10 10 l80 0 v80 h-80 z"/>');
    expect(corners(piece(shape))).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
      [10, 90],
    ]);
  });

  it("reads the pairs that follow an M as lines, and those after an m as lines from the point before", () => {
    expect(corners(piece(only('<path d="M10 10 90 10 90 90"/>')))).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
    ]);
    expect(corners(piece(only('<path d="m10 10 80 0 0 80"/>')))).toEqual([
      [10, 10],
      [90, 10],
      [90, 90],
    ]);
  });

  it("reads numbers that are written without anything between them", () => {
    expect(corners(piece(only('<path d="M1.5.5-2-3L1e1,2E1"/>')))).toEqual([
      [1.5, 0.5],
      [-2, -3],
      [10, 20],
    ]);
  });

  it("keeps the handles of a cubic curve, absolute or relative", () => {
    for (const d of ["M0 0 C10 20 30 40 50 0", "M0 0 c10 20 30 40 50 0"]) {
      const path = piece(only(`<path d="${d}" fill="none" stroke="red"/>`));
      expect(path.closed).toBe(false);
      expect(path.nodes[0].handleOut).toEqual({ x: 10, y: 20 });
      expect(path.nodes[1].handleIn).toEqual({ x: -20, y: 40 });
    }
  });

  it("gives S the mirrored handle of the curve before, and none after a line", () => {
    const path = piece(only('<path d="M0 0 C0 10 10 20 20 20 S40 30 40 40 L50 50 s5 5 10 10" fill="none" stroke="red"/>'));
    expect(path.nodes[1].handleOut).toEqual({ x: 10, y: 0 });
    expect(path.nodes[2].handleIn).toEqual({ x: 0, y: -10 });
    expect(path.nodes[3].handleOut).toBeNull();
    expect(path.nodes[4].handleIn).toEqual({ x: -5, y: -5 });
  });

  it("turns a quadratic curve into the cubic that draws the same line", () => {
    for (const d of ["M0 0 Q30 60 60 0", "M0 0 q30 60 60 0"]) {
      const path = piece(only(`<path d="${d}" fill="none" stroke="red"/>`));
      expect(path.nodes[0].handleOut).toEqual({ x: 20, y: 40 });
      expect(path.nodes[1].handleIn).toEqual({ x: -20, y: 40 });
    }
  });

  it("gives T the mirrored control point of the curve before, and a straight side after a line", () => {
    const path = piece(only('<path d="M0 0 Q15 30 30 0 T60 0 L70 0 t10 0" fill="none" stroke="red"/>'));
    // the second curve bends the other way: its control point is (45, -30)
    expect(path.nodes[1].handleOut).toEqual({ x: 10, y: -20 });
    expect(path.nodes[2].handleIn).toEqual({ x: -10, y: -20 });
    expect(path.nodes[3].handleOut).toBeNull();
    expect(path.nodes[4].handleIn).toBeNull();
  });

  it("draws an arc as curves that stay on the circle", () => {
    const quarter = piece(only('<path d="M50 0 A50 50 0 0 1 100 50" fill="none" stroke="red"/>'));
    expect(quarter.nodes).toHaveLength(2);
    const [least, most] = radii(quarter, 50, 50);
    expect(least).toBeGreaterThan(49.97);
    expect(most).toBeLessThan(50.03);
  });

  it("takes the long way round for a large arc, in pieces of a quarter turn at most", () => {
    // three quarters of a circle about (50, 50), against the clock
    const path = piece(only('<path d="M50 0 A50 50 0 1 0 100 50" fill="none" stroke="red"/>'));
    expect(path.nodes).toHaveLength(4);
    expect(corners(path)[1]).toEqual([0, 50]);
    const [least, most] = radii(path, 50, 50);
    expect(least).toBeGreaterThan(49.97);
    expect(most).toBeLessThan(50.03);
  });

  it("reads the flags of an arc that are written without a space, and relative arcs", () => {
    const path = piece(only('<path d="M0 50a50 50 0 01100 0" fill="none" stroke="red"/>'));
    expect(corners(path)).toEqual([
      [0, 50],
      [50, 0],
      [100, 50],
    ]);
  });

  it("turns an ellipse arc with its axis", () => {
    // half an ellipse of 40 x 20 turned a quarter: it is 20 wide and 40 high now
    const shape = only('<path d="M50 10 A40 20 90 0 1 50 90" fill="none" stroke="red"/>');
    expect(box(shape)).toEqual([50, 10, 20, 80]);
  });

  it("makes radii that are too small large enough to reach, and draws a line for a radius of zero", () => {
    const half = piece(only('<path d="M0 50 A10 10 0 0 1 100 50" fill="none" stroke="red"/>'));
    const [least, most] = radii(half, 50, 50);
    expect(least).toBeGreaterThan(49.97);
    expect(most).toBeLessThan(50.03);
    const line = piece(only('<path d="M0 50 A0 10 0 0 1 100 50" fill="none" stroke="red"/>'));
    expect(line.nodes).toHaveLength(2);
    expect(line.nodes[0].handleOut).toBeNull();
  });

  it("leaves out an arc that ends where it starts", () => {
    expect(corners(piece(only('<path d="M0 0 A5 5 0 0 1 0 0 L10 10" fill="none" stroke="red"/>')))).toEqual([
      [0, 0],
      [10, 10],
    ]);
  });

  it("closes a piece on its first point when the last point is the same", () => {
    const path = piece(only('<path d="M0 0 L50 0 C50 30 20 50 0 0 Z"/>'));
    expect(path.nodes).toHaveLength(2);
    expect(path.nodes[0].handleIn).toEqual({ x: 20, y: 50 });
  });

  it("starts the next piece at the first point of the one that Z closed", () => {
    const shape = only('<path d="M10 10 h20 v20 z l-5 5 v5" fill="none" stroke="red" stroke-opacity="0.5"/>');
    expect(pieces(shape).map(corners)).toEqual([
      [
        [10, 10],
        [30, 10],
        [30, 30],
      ],
      [
        [10, 10],
        [5, 15],
        [5, 20],
      ],
    ]);
  });

  it("keeps what it read before a mistake in the data", () => {
    expect(corners(piece(only('<path d="M0 0 L50 50 L90 x 10 10" fill="none" stroke="red"/>')))).toEqual([
      [0, 0],
      [50, 50],
    ]);
    expect(corners(piece(only('<path d="M0 0 L50 50 A5 5 0 2 1 9 9" fill="none" stroke="red"/>')))).toEqual([
      [0, 0],
      [50, 50],
    ]);
    expect(corners(piece(only('<path d="M0 0 L50 50 X 1 2" fill="none" stroke="red"/>')))).toEqual([
      [0, 0],
      [50, 50],
    ]);
    // numbers after a Z have no command to repeat
    expect(corners(piece(only('<path d="M0 0 L50 50 Z 5 5 L90 90" fill="none" stroke="red"/>')))).toEqual([
      [0, 0],
      [50, 50],
    ]);
  });

  it("counts a path whose data is wrong from the start as a part that could not be converted", () => {
    for (const d of ["L10 10", "nonsense", "10 10", "M10", "Z"]) {
      const result = svgToShapes(svg(`<path d="${d}"/><rect width="10" height="10"/>`), 100, 100);
      expect(result.shapes).toHaveLength(1);
      expect(result.skipped).toBe(1);
    }
  });

  it("draws nothing, and counts nothing, for a path that has no data or only a point", () => {
    for (const path of ["<path/>", '<path d=""/>', '<path d="  "/>', '<path d="M10 10"/>', '<path d="M10 10 Z"/>', '<path d="M10 10 L10 10 Z"/>']) {
      expect(svgToShapes(svg(path), 100, 100)).toMatchObject({ shapes: [], skipped: 0 });
    }
  });
});

describe("paths of several pieces", () => {
  const outer = "M0 0 H100 V100 H0 Z";

  it("keeps a piece inside another in one shape, so that the hole stays a hole", () => {
    const shape = only(`<path d="${outer} M25 25 V75 H75 V25 Z"/>`);
    const [a, b] = pieces(shape);
    expect(Math.sign(turn(a))).toBe(-Math.sign(turn(b)));
    expect(box(shape)).toEqual([0, 0, 100, 100]);
  });

  it("makes shapes of their own of pieces that lie apart, each one editable point by point", () => {
    const shapes = shapesOf('<path d="M0 0 H10 V10 H0 Z M50 50 H60 V60 H50 Z M52 52 V58 H58 V52 Z" fill="#ff0000"/>');
    expect(shapes.map(box)).toEqual([
      [0, 0, 10, 10],
      [50, 50, 10, 10],
    ]);
    expect(parsePath(shapes[0].path as string)).not.toBeNull();
    expect(pieces(shapes[1])).toHaveLength(2);
    expect(shapes.every((s) => s.fill?.type === "solid" && s.fill.color === "#ff0000")).toBe(true);
  });

  it("counts the outline when it looks whether pieces lie apart", () => {
    const d = "M0 0 H10 V10 H0 Z M14 0 H24 V10 H14 Z";
    expect(shapesOf(`<path d="${d}"/>`)).toHaveLength(2);
    expect(shapesOf(`<path d="${d}" stroke="#000000" stroke-width="6"/>`)).toHaveLength(1);
  });

  it("splits a path that is only an outline into its pieces even where they cross", () => {
    const shapes = shapesOf('<path d="M0 50 H100 M50 0 V100" fill="none" stroke="#000000"/>');
    expect(shapes).toHaveLength(2);
    expect(shapes.map((s) => parsePath(s.path as string)?.nodes.length)).toEqual([2, 2]);
  });

  it("keeps a see-through outline whose pieces cross in one shape, because two shapes would darken the crossing", () => {
    expect(shapesOf('<path d="M0 50 H100 M50 0 V100" fill="none" stroke="#000000" stroke-opacity="0.5"/>')).toHaveLength(1);
    expect(shapesOf('<g opacity="0.5"><path d="M0 50 H100 M50 0 V100" fill="none" stroke="#000000"/></g>')).toHaveLength(1);
    expect(shapesOf('<path d="M0 10 H100 M0 90 H100" fill="none" stroke="#000000" stroke-opacity="0.5"/>')).toHaveLength(2);
  });

  it("keeps a path with a gradient in one shape, because the gradient runs over all of it", () => {
    const body =
      '<defs><linearGradient id="g"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient></defs>' +
      '<path d="M0 0 H10 V10 H0 Z M50 50 H60 V60 H50 Z" fill="url(#g)"/>';
    expect(shapesOf(body)).toHaveLength(1);
  });

  it("turns the pieces of an even-odd path so that the holes stay holes", () => {
    // both squares run the same way round: a hole by the even-odd rule only
    const d = `${outer} M25 25 H75 V75 H25 Z`;
    const plain = pieces(only(`<path d="${d}"/>`));
    expect(Math.sign(turn(plain[0]))).toBe(Math.sign(turn(plain[1])));
    const evenOdd = pieces(only(`<path d="${d}" fill-rule="evenodd"/>`));
    expect(Math.sign(turn(evenOdd[0]))).toBe(-Math.sign(turn(evenOdd[1])));
    expect(evenOdd[1].nodes).toHaveLength(4);
  });

  it("turns an island in a hole back the way of the outside, with its curves", () => {
    const island = "M40 50 A10 10 0 1 1 60 50 A10 10 0 1 1 40 50 Z";
    const [a, b, c] = pieces(only(`<path d="${outer} M25 25 V75 H75 V25 Z ${island}" fill-rule="evenodd"/>`));
    expect(Math.sign(turn(b))).toBe(-Math.sign(turn(a)));
    expect(Math.sign(turn(c))).toBe(Math.sign(turn(a)));
    const [least, most] = [Math.min(...c.nodes.map((n) => n.x)), Math.max(...c.nodes.map((n) => n.x))];
    expect([least, most]).toEqual([40, 60]);
    expect(c.nodes.every((n) => n.handleIn && n.handleOut)).toBe(true);
  });

  it("leaves pieces that enclose nothing as they are under the even-odd rule", () => {
    const shapes = shapesOf('<path d="M0 10 H50 M0 40 H50" fill-rule="evenodd" stroke="#000000"/>');
    expect(shapes.map((s) => corners(piece(s)))).toEqual([
      [
        [0, 10],
        [50, 10],
      ],
      [
        [0, 40],
        [50, 40],
      ],
    ]);
  });

  it("inherits the even-odd rule, and does nothing about it for a path that is not filled", () => {
    const d = `${outer} M25 25 H75 V75 H25 Z`;
    const inherited = pieces(only(`<g fill-rule="evenodd"><path d="${d}"/></g>`));
    expect(Math.sign(turn(inherited[0]))).toBe(-Math.sign(turn(inherited[1])));
    const outline = pieces(only(`<path d="${d}" fill-rule="evenodd" fill="none" stroke="#000000" stroke-opacity="0.5"/>`));
    expect(Math.sign(turn(outline[0]))).toBe(Math.sign(turn(outline[1])));
  });
});

describe("basic shapes", () => {
  it("draws a rectangle as four corners", () => {
    const shape = only('<rect x="10" y="20" width="30" height="40"/>');
    expect(box(shape)).toEqual([10, 20, 30, 40]);
    expect(piece(shape).closed).toBe(true);
    expect(corners(piece(shape))).toEqual([
      [10, 20],
      [40, 20],
      [40, 60],
      [10, 60],
    ]);
    expect(shape).toMatchObject({ type: "shape", shape: "path", radius: 0, rotation: 0, opacity: 1 });
  });

  it("rounds the corners of a rectangle with curves", () => {
    const path = piece(only('<rect width="100" height="60" rx="20" ry="10"/>'));
    expect(path.nodes).toHaveLength(8);
    expect(corners(path)[0]).toEqual([20, 0]);
    expect(corners(path)[1]).toEqual([80, 0]);
    expect(path.nodes[1].handleOut).toEqual({ x: 11.05, y: 0 });
    expect(corners(path)[2]).toEqual([100, 10]);
    expect(path.nodes[2].handleIn).toEqual({ x: 0, y: -5.52 });
  });

  it("uses one radius for both when only one is given, and never more than half a side", () => {
    expect(corners(piece(only('<rect width="100" height="60" rx="20"/>')))[2]).toEqual([100, 20]);
    expect(corners(piece(only('<rect width="100" height="60" ry="20"/>')))[0]).toEqual([20, 0]);
    // half of the width and half of the height: an ellipse, four points
    expect(piece(only('<rect width="100" height="60" rx="80" ry="80"/>')).nodes).toHaveLength(4);
  });

  it("draws a circle and an ellipse as four curves", () => {
    const circle = only('<circle cx="50" cy="50" r="30"/>');
    expect(box(circle)).toEqual([20, 20, 60, 60]);
    expect(piece(circle).nodes).toHaveLength(4);
    const [least, most] = radii(piece(circle), 50, 50);
    expect(least).toBeGreaterThan(29.98);
    expect(most).toBeLessThan(30.02);
    expect(box(only('<ellipse cx="50" cy="50" rx="40" ry="10"/>'))).toEqual([10, 40, 80, 20]);
    expect(box(only('<circle r="10"/>'))).toEqual([-10, -10, 20, 20]);
  });

  it("draws a line as an outline only, whatever fill it was given", () => {
    const shape = only('<line x1="10" y1="10" x2="90" y2="50" fill="#ff0000" stroke="#00ff00" stroke-width="4"/>');
    expect(shape.fill).toBeNull();
    expect(shape.stroke).toMatchObject({ color: "#00ff00", width: 4, style: "solid" });
    expect(piece(shape).closed).toBe(false);
    expect(corners(piece(shape))).toEqual([
      [10, 10],
      [90, 50],
    ]);
  });

  it("gives a flat line a box of a pixel, as the Pen does", () => {
    expect(box(only('<line x1="10" y1="50" x2="90" y2="50" stroke="#000000"/>'))).toEqual([10, 50, 80, 1]);
  });

  it("leaves a polyline open and closes a polygon", () => {
    const open = piece(only('<polyline points="0,0 50,0 50 50" fill="none" stroke="#000000"/>'));
    expect(open.closed).toBe(false);
    expect(open.nodes).toHaveLength(3);
    const closed = piece(only('<polygon points="0,0 50,0 50,50 7"/>'));
    expect(closed.closed).toBe(true);
    expect(corners(closed)).toEqual([
      [0, 0],
      [50, 0],
      [50, 50],
    ]);
  });

  it("draws nothing, and counts nothing, for a shape without a size", () => {
    const body =
      '<rect width="0" height="10"/><rect width="10"/><circle cx="5" cy="5" r="0"/><ellipse rx="5"/><ellipse rx="5" ry="-1"/><line x1="5" y1="5" x2="5" y2="5" stroke="#000000"/>' +
      '<polyline points="5 5" stroke="#000000"/><polygon points=""/><polygon/><rect width="-5" height="10"/><svg width="0"><rect width="10" height="10"/></svg>';
    expect(svgToShapes(svg(body), 100, 100)).toMatchObject({ shapes: [], skipped: 0, problem: null });
  });

  it("reads lengths with a unit, and a share of the drawing", () => {
    expect(box(only('<rect x="10px" y="1in" width="50%" height="25%"/>', 'viewBox="0 0 200 400"'))).toEqual([5, 24, 50, 25]);
    expect(box(only('<rect width="72pt" height="6pc"/>'))).toEqual([0, 0, 96, 96]);
    expect(box(only('<rect width="2em" height="2ex"/>'))).toEqual([0, 0, 32, 16]);
    expect(box(only('<rect width="25.4mm" height="2.54cm"/>'))).toEqual([0, 0, 96, 96]);
    // the radius of a circle is a share of the diagonal, as SVG has it
    expect(box(only('<circle cx="50%" cy="50%" r="10%"/>')).slice(2)).toEqual([20, 20]);
    // a length that cannot be read is no length
    expect(box(only('<rect x="left" width="10" height="10"/>'))).toEqual([0, 0, 10, 10]);
  });
});

describe("transforms", () => {
  const unit = '<rect width="10" height="10"/>';

  it("moves, scales and turns the points themselves", () => {
    expect(box(only(`<g transform="translate(20 30)">${unit}</g>`))).toEqual([20, 30, 10, 10]);
    expect(box(only(`<g transform="translate(20)">${unit}</g>`))).toEqual([20, 0, 10, 10]);
    expect(box(only(`<g transform="scale(2 3)">${unit}</g>`))).toEqual([0, 0, 20, 30]);
    expect(box(only(`<g transform="scale(2)">${unit}</g>`))).toEqual([0, 0, 20, 20]);
    expect(box(only(`<g transform="rotate(90)">${unit}</g>`))).toEqual([-10, 0, 10, 10]);
    expect(box(only(`<g transform="rotate(180 50 50)">${unit}</g>`))).toEqual([90, 90, 10, 10]);
    expect(box(only(`<g transform="matrix(2 0 0 2 5 6)">${unit}</g>`))).toEqual([5, 6, 20, 20]);
    expect(box(only(`<g transform="skewX(45)">${unit}</g>`))).toEqual([0, 0, 20, 10]);
    expect(box(only(`<g transform="skewY(45)">${unit}</g>`))).toEqual([0, 0, 10, 20]);
  });

  it("applies a list from the right to the left, and the transforms of the groups around from the outside in", () => {
    expect(box(only(`<g transform="translate(50,50) scale(2)">${unit}</g>`))).toEqual([50, 50, 20, 20]);
    expect(box(only(`<g transform="scale(2)translate(50 , 50)">${unit}</g>`))).toEqual([100, 100, 20, 20]);
    expect(box(only(`<g transform="translate(10 10)"><g transform="scale(2)"><rect x="5" width="10" height="10" transform="translate(1 1)"/></g></g>`))).toEqual([22, 12, 20, 20]);
  });

  it("turns the handles of a curve with its points", () => {
    const path = piece(only('<path d="M0 0 C10 0 20 10 20 20" transform="rotate(90)" fill="none" stroke="#000000"/>'));
    expect(path.nodes[0].handleOut?.x).toBeCloseTo(0, 6);
    expect(path.nodes[0].handleOut?.y).toBeCloseTo(10, 6);
  });

  it("scales the width of an outline with the drawing", () => {
    expect(only(`<g transform="scale(3)"><rect width="10" height="10" stroke="#000000" stroke-width="2"/></g>`).stroke?.width).toBe(6);
    // stretched one way only: the mean of both
    expect(only(`<g transform="scale(4 1)"><rect width="10" height="10" stroke="#000000" stroke-width="2"/></g>`).stroke?.width).toBe(4);
  });

  it("leaves out and counts what has a transform that cannot be read", () => {
    for (const bad of ["spin(3)", "rotate(1 2)", "matrix(1 2 3)", "translate()", "scale(1 2 3)", "skewX(1 2)", "rotate(x)"]) {
      const result = svgToShapes(svg(`<g transform="${bad}">${unit}${unit}</g>${unit}`), 100, 100);
      expect(result.shapes).toHaveLength(1);
      expect(result.skipped).toBe(1);
    }
  });

  it("draws nothing for a scale of zero", () => {
    expect(svgToShapes(svg(`<g transform="scale(0)">${unit}</g>`), 100, 100)).toMatchObject({ shapes: [], skipped: 0 });
  });
});

describe("the size of the drawing", () => {
  const unit = '<rect x="10" y="10" width="10" height="10"/>';
  const at = (attrs: string, width = 200, height = 100) => box(svgToShapes(svg(unit, attrs), width, height).shapes[0]);

  it("lays the view box over the box it is given, whatever its own origin is", () => {
    expect(at('viewBox="0 0 100 100"')).toEqual([20, 10, 20, 10]);
    expect(at('viewBox="10,10,20,20"')).toEqual([0, 0, 100, 50]);
  });

  it("takes width and height as the size when there is no view box", () => {
    expect(at('width="50" height="50"')).toEqual([40, 20, 40, 20]);
  });

  it("takes 300 by 150, the size a browser gives a drawing that states none", () => {
    expect(at("")).toEqual([200 / 30, 100 / 15, 200 / 30, 100 / 15].map((v) => Math.round(v * 100) / 100));
    expect(at('viewBox="0 0 0 10" width="100%"')).toEqual(at(""));
    expect(at('viewBox="0 0 10"')).toEqual(at(""));
  });

  it("fits the view box into a stated width and height the way preserveAspectRatio says", () => {
    // a view box of 100 x 100 in a picture of 200 x 100, shown at its own size
    const size = 'viewBox="0 0 100 100" width="200" height="100"';
    expect(at(size)).toEqual([60, 10, 10, 10]);
    expect(at(`${size} preserveAspectRatio="xMidYMid meet"`)).toEqual([60, 10, 10, 10]);
    expect(at(`${size} preserveAspectRatio="xMinYMin"`)).toEqual([10, 10, 10, 10]);
    expect(at(`${size} preserveAspectRatio="xMaxYMax meet"`)).toEqual([110, 10, 10, 10]);
    expect(at(`${size} preserveAspectRatio="none"`)).toEqual([20, 10, 20, 10]);
    expect(at(`${size} preserveAspectRatio="xMidYMid slice"`)).toEqual([20, -30, 20, 20]);
    expect(at(`${size} preserveAspectRatio="xMidYMin slice"`)).toEqual([20, 20, 20, 20]);
    expect(at(`${size} preserveAspectRatio="xMidYMax slice"`)).toEqual([20, -80, 20, 20]);
    // and that picture stretched over a box of another shape
    expect(at(size, 400, 100)).toEqual([120, 10, 20, 10]);
  });

  it("puts a drawing inside the drawing where its x, y, width and height say", () => {
    const inner = (attrs: string) => box(only(`<svg ${attrs}>${unit}</svg>`));
    expect(inner('x="50" y="40"')).toEqual([60, 50, 10, 10]);
    expect(inner('x="50" y="40" width="20" height="20" viewBox="0 0 40 40"')).toEqual([55, 45, 5, 5]);
    expect(inner('viewBox="0 0 200 200"')).toEqual([5, 5, 5, 5]);
    expect(inner('width="50" height="100" viewBox="0 0 100 100" preserveAspectRatio="none"')).toEqual([5, 10, 5, 10]);
  });

  it("applies the transform it is handed last", () => {
    // mirrored left to right in a box of 100
    expect(box(svgToShapes(svg(unit), 100, 100, [-1, 0, 0, 1, 100, 0]).shapes[0])).toEqual([80, 10, 10, 10]);
  });
});

describe("paint", () => {
  const unit = 'width="10" height="10"';

  it("fills with black and draws no outline unless the drawing says otherwise", () => {
    const shape = only(`<rect ${unit}/>`);
    expect(shape.fill).toEqual({ type: "solid", color: "#000000" });
    expect(shape.stroke).toBeNull();
  });

  it("reads colours as hex, rgb(), hsl() and by name", () => {
    const colour = (value: string) => {
      const fill = only(`<rect ${unit} fill="${value}"/>`).fill;
      return fill?.type === "solid" ? fill.color : fill;
    };
    expect(colour("#F00")).toBe("#ff0000");
    expect(colour("#12AB34")).toBe("#12ab34");
    expect(colour("#ff000080")).toBe("rgba(255,0,0,0.502)");
    expect(colour("rgb(255, 128, 0)")).toBe("#ff8000");
    expect(colour("rgb(100%, 50%, 0%)")).toBe("#ff8000");
    expect(colour("rgba(255 0 0 / 50%)")).toBe("rgba(255,0,0,0.5)");
    expect(colour("rgba(255,0,0,0.25)")).toBe("rgba(255,0,0,0.25)");
    expect(colour("hsl(120, 100%, 50%)")).toBe("#00ff00");
    expect(colour("hsla(240, 100%, 50%, 0.5)")).toBe("rgba(0,0,255,0.5)");
    expect(colour("hsl(0, 0%, 50%)")).toBe("#808080");
    expect(colour("hsl(-120, 100%, 25%)")).toBe("#000080");
    expect(colour("hsl(60 100% 50%)")).toBe("#ffff00");
    expect(colour("hsl(180 100% 50%)")).toBe("#00ffff");
    expect(colour("hsl(300 100% 50%)")).toBe("#ff00ff");
    expect(colour("Tomato")).toBe("#ff6347");
    expect(colour("rebeccapurple")).toBe("#663399");
    expect(colour(" red ")).toBe("#ff0000");
  });

  it("takes a colour it cannot read as not said, so that the one from outside counts", () => {
    for (const value of [
      "nocolour",
      "#12",
      "#ggg",
      "rgb(1,2)",
      "rgb(1,2,3,4,5)",
      "rgb(a,b,c)",
      "hsl(1,2)",
      "hsl(x,1%,1%)",
      "rgba(1,2,3,x)",
      "inherit",
      "context-fill",
      "cmyk(1,2,3)",
      "",
    ]) {
      const shape = only(`<g fill="#00ff00"><rect ${unit} fill="${value}"/></g>`);
      expect(shape.fill).toEqual({ type: "solid", color: "#00ff00" });
    }
  });

  it("hands paint down from a group, and lets the element have the last word", () => {
    const [a, b] = shapesOf(
      `<g fill="#ff0000" stroke="#0000ff" stroke-width="3" stroke-linecap="round" stroke-linejoin="bevel"><rect ${unit}/><rect ${unit} fill="#00ff00" stroke="none"/></g>`,
    );
    expect(a.fill).toEqual({ type: "solid", color: "#ff0000" });
    expect(a.stroke).toEqual({ color: "#0000ff", width: 3, style: "solid", cap: "round", join: "bevel" });
    expect(b.fill).toEqual({ type: "solid", color: "#00ff00" });
    expect(b.stroke).toBeNull();
  });

  it("gives an outline a width of one, square ends and pointed corners unless told otherwise", () => {
    expect(only(`<rect ${unit} fill="none" stroke="#000000"/>`)).toMatchObject({ fill: null, stroke: { color: "#000000", width: 1, style: "solid", cap: "butt", join: "miter" } });
    expect(only(`<rect ${unit} stroke="#000000" stroke-linecap="square" stroke-linejoin="round"/>`).stroke).toMatchObject({ cap: "square", join: "round" });
    expect(only(`<rect ${unit} stroke="#000000" stroke-linecap="fancy" stroke-linejoin="arcs" stroke-width="wide"/>`).stroke).toMatchObject({
      cap: "butt",
      join: "miter",
      width: 1,
    });
  });

  it("draws no outline of no width", () => {
    expect(only(`<rect ${unit} stroke="#ff0000" stroke-width="0"/>`).stroke).toBeNull();
    expect(only(`<rect ${unit} stroke="#ff0000" stroke-width="-2"/>`).stroke).toBeNull();
  });

  it("draws a dashed outline as dashed", () => {
    expect(only(`<rect ${unit} stroke="#000000" stroke-dasharray="4 2"/>`).stroke?.style).toBe("dashed");
    expect(only(`<rect ${unit} stroke="#000000" stroke-dasharray="none"/>`).stroke?.style).toBe("solid");
    expect(only(`<g stroke-dasharray="4"><rect ${unit} stroke="#000000"/></g>`).stroke?.style).toBe("dashed");
    expect(only(`<rect ${unit} stroke="#000000" stroke-dasharray="0"/>`).stroke?.style).toBe("solid");
    expect(only(`<g stroke-dasharray="4"><rect ${unit} stroke="#000000" stroke-dasharray="inherit"/></g>`).stroke?.style).toBe("dashed");
  });

  it("draws dashes of no length with round or square ends as dotted, and with flat ends not at all", () => {
    expect(only(`<rect ${unit} stroke="#000000" stroke-linecap="round" stroke-dasharray="0 8 0 13"/>`).stroke?.style).toBe("dotted");
    expect(only(`<rect ${unit} stroke="#000000" stroke-linecap="square" stroke-dasharray="0,4"/>`).stroke?.style).toBe("dotted");
    expect(only(`<rect ${unit} stroke="#000000" stroke-dasharray="0 4"/>`).stroke).toBeNull();
    // three lengths are gone through twice, and the gap of 4 is a dash of 4 the second time round
    expect(only(`<rect ${unit} stroke="#000000" stroke-linecap="round" stroke-dasharray="0 4 0"/>`).stroke?.style).toBe("dashed");
  });

  it("uses the colour of the text for currentColor: black, or what the color attribute says", () => {
    expect(only(`<rect ${unit} fill="currentColor"/>`).fill).toEqual({ type: "solid", color: "#000000" });
    const shape = only(`<g color="#ff0000"><rect ${unit} fill="currentcolor" stroke="currentColor"/></g>`);
    expect(shape.fill).toEqual({ type: "solid", color: "#ff0000" });
    expect(shape.stroke?.color).toBe("#ff0000");
    expect(only(`<g color="#ff0000"><rect ${unit} color="blue" fill="currentColor"/></g>`).fill).toEqual({ type: "solid", color: "#0000ff" });
    expect(only(`<g color="#ff0000"><rect ${unit} color="currentColor" fill="currentColor"/></g>`).fill).toEqual({ type: "solid", color: "#ff0000" });
  });

  it("writes fill-opacity and stroke-opacity into the colours", () => {
    const shape = only(`<g fill-opacity="0.5" stroke-opacity="25%"><rect ${unit} fill="#ff0000" stroke="#0000ff"/></g>`);
    expect(shape.fill).toEqual({ type: "solid", color: "rgba(255,0,0,0.5)" });
    expect(shape.stroke?.color).toBe("rgba(0,0,255,0.25)");
    expect(only(`<rect ${unit} fill="#ff0000" fill-opacity="7"/>`).fill).toEqual({ type: "solid", color: "#ff0000" });
    expect(only(`<rect ${unit} fill="#ff0000" fill-opacity="much"/>`).fill).toEqual({ type: "solid", color: "#ff0000" });
  });

  it("multiplies opacity down the groups into the opacity of the shape", () => {
    expect(only(`<g opacity="0.5"><g><rect ${unit} opacity="0.5"/></g></g>`).opacity).toBe(0.25);
    expect(only(`<g opacity="-1"><rect ${unit}/></g>`).opacity).toBe(0);
  });

  it("draws nothing, and counts nothing, for what a browser would not show either", () => {
    const body =
      `<rect ${unit} fill="none"/><rect ${unit} fill="transparent"/><rect ${unit} display="none"/><g display="none"><rect ${unit}/></g>` +
      `<rect ${unit} visibility="hidden"/><rect ${unit} visibility="collapse"/><rect ${unit} fill="none" stroke="#ff0000" stroke-opacity="0"/><rect ${unit} fill="url(#nowhere)"/>`;
    expect(svgToShapes(svg(body), 100, 100)).toMatchObject({ shapes: [], skipped: 0 });
  });

  it("shows what is made visible again inside something hidden", () => {
    expect(shapesOf(`<g visibility="hidden"><rect ${unit}/><rect ${unit} visibility="visible"/></g>`)).toHaveLength(1);
  });

  it("does not draw what only serves other elements", () => {
    const body =
      `<defs><rect ${unit}/></defs><symbol><rect ${unit}/></symbol><clipPath id="c"><rect ${unit}/></clipPath><mask id="m"><rect ${unit}/></mask>` +
      `<pattern id="p"><rect ${unit}/></pattern><marker id="k"><rect ${unit}/></marker><title>Name</title><desc>What it is</desc><filter id="f"><feGaussianBlur stdDeviation="2"/></filter>`;
    expect(svgToShapes(svg(body), 100, 100)).toMatchObject({ shapes: [], skipped: 0, simplified: 0 });
  });

  it("keeps the paint order of the drawing", () => {
    const shapes = shapesOf(`<rect ${unit} fill="#000001"/><g><rect ${unit} fill="#000002"/><g><rect ${unit} fill="#000003"/></g></g><rect ${unit} fill="#000004"/>`);
    expect(shapes.map((s) => s.fill?.type === "solid" && s.fill.color)).toEqual(["#000001", "#000002", "#000003", "#000004"]);
  });

  it("gives every shape an id of its own", () => {
    const shapes = shapesOf(`<rect ${unit}/><rect ${unit}/><rect ${unit}/>`);
    expect(new Set(shapes.map((s) => s.id)).size).toBe(3);
  });
});

describe("gradients", () => {
  const stops = '<stop offset="0" stop-color="#ff0000"/><stop offset="100%" stop-color="#0000ff"/>';
  const filled = (gradient: string, shape = '<rect width="100" height="50" fill="url(#g)"/>') => only(`<defs>${gradient}</defs>${shape}`);
  const linear = (gradient: string, shape?: string) => filled(gradient, shape).fill as LinearGradientFill;
  const radial = (gradient: string, shape?: string) => filled(gradient, shape).fill as RadialGradientFill;

  it("runs a linear gradient from the left to the right of the shape unless told otherwise", () => {
    expect(linear(`<linearGradient id="g">${stops}</linearGradient>`)).toEqual({
      type: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#0000ff" },
      ],
    });
  });

  it("reads the direction from the two points of the gradient", () => {
    expect(linear(`<linearGradient id="g" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient>`).angle).toBe(180);
    expect(linear(`<linearGradient id="g" x1="100%" y1="0" x2="0%" y2="0">${stops}</linearGradient>`).angle).toBe(270);
    expect(linear(`<linearGradient id="g" x1="0" y1="1" x2="0" y2="0">${stops}</linearGradient>`).angle).toBe(0);
    // corner to corner of a box of 100 x 50: the angle on the page, not the one in the units of the box
    expect(linear(`<linearGradient id="g" x1="0" y1="0" x2="1" y2="1">${stops}</linearGradient>`).angle).toBeCloseTo(90 + (Math.atan2(50, 100) * 180) / Math.PI, 2);
  });

  it("moves the stops of a gradient that covers only a part of the shape to where they are on the shape", () => {
    // from x = 25 to x = 75 of a shape that is 100 wide
    const fill = linear(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="25" y1="0" x2="75" y2="0">${stops}</linearGradient>`);
    expect(fill).toMatchObject({
      angle: 90,
      stops: [
        { offset: 0.25, color: "#ff0000" },
        { offset: 0.75, color: "#0000ff" },
      ],
    });
  });

  it("measures a gradient that gives no points in the units of the drawing across the whole drawing, when it says so", () => {
    // from the left to the right of a drawing of 100: a shape on its left half shows the first half of the colours
    const fill = linear(`<linearGradient id="g" gradientUnits="userSpaceOnUse">${stops}</linearGradient>`, '<rect width="50" height="50" fill="url(#g)"/>');
    expect(fill).toEqual({
      type: "linear",
      angle: 90,
      stops: [
        { offset: 0, color: "#ff0000" },
        { offset: 1, color: "#800080" },
      ],
    });
  });

  it("cuts a gradient that is longer than the shape at the edges of the shape, with the colours it has there", () => {
    // from x = -100 to x = 200: the shape shows the middle third
    const fill = linear(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="-100" y1="0" x2="200" y2="0">${stops}</linearGradient>`);
    expect(fill.stops).toEqual([
      { offset: 0, color: "#aa0055" },
      { offset: 1, color: "#5500aa" },
    ]);
    // three stops, the middle one on the shape
    const three = linear(
      '<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="-100" y1="0" x2="200" y2="0"><stop offset="0" stop-color="#000000"/><stop offset="0.5" stop-color="#ffffff"/><stop offset="1" stop-color="#000000"/></linearGradient>',
    );
    expect(three.stops.map((s) => s.offset)).toEqual([0, 0.5, 1]);
    expect(three.stops[1].color).toBe("#ffffff");
    expect(three.stops[0].color).toBe(three.stops[2].color);
  });

  it("fills with the one colour that is left when the whole gradient lies beside the shape", () => {
    expect(filled(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="-100" y1="0" x2="-50" y2="0">${stops}</linearGradient>`).fill).toEqual({
      type: "solid",
      color: "#0000ff",
    });
    expect(filled(`<linearGradient id="g" gradientUnits="userSpaceOnUse" x1="150" y1="0" x2="200" y2="0">${stops}</linearGradient>`).fill).toEqual({
      type: "solid",
      color: "#ff0000",
    });
  });

  it("applies the transform of the gradient and the transforms around the shape", () => {
    expect(linear(`<linearGradient id="g" gradientTransform="rotate(90)">${stops}</linearGradient>`).angle).toBe(180);
    expect(linear(`<linearGradient id="g">${stops}</linearGradient>`, '<g transform="rotate(90)"><rect width="100" height="50" fill="url(#g)"/></g>').angle).toBe(180);
    // a transform that cannot be read is no transform
    expect(linear(`<linearGradient id="g" gradientTransform="spin(1)">${stops}</linearGradient>`).angle).toBe(90);
  });

  it("reads the stops: a share or a number, never back before the one before, with their opacity", () => {
    const fill = linear(
      '<linearGradient id="g"><stop offset="50%" stop-color="red" stop-opacity="0.5"/><stop offset="0.2" stop-color="#00ff00"/><stop offset="3"/><stop offset="wrong" stop-color="nocolour" stop-opacity="2"/></linearGradient>',
    );
    expect(fill.stops).toEqual([
      { offset: 0.5, color: "rgba(255,0,0,0.5)" },
      { offset: 0.5, color: "#00ff00" },
      { offset: 1, color: "#000000" },
      { offset: 1, color: "#000000" },
    ]);
  });

  it("multiplies fill-opacity into every stop", () => {
    const fill = linear(`<linearGradient id="g">${stops}</linearGradient>`, '<rect width="100" height="50" fill="url(#g)" fill-opacity="0.5"/>');
    expect(fill.stops.map((s) => s.color)).toEqual(["rgba(255,0,0,0.5)", "rgba(0,0,255,0.5)"]);
  });

  it("takes stops and places from the gradient it points to", () => {
    const body = `<linearGradient id="base" x1="0" y1="0" x2="0" y2="1">${stops}</linearGradient><linearGradient id="g" href="#base"/>`;
    expect(linear(body)).toMatchObject({ angle: 180, stops: [{ color: "#ff0000" }, { color: "#0000ff" }] });
    const old = `<linearGradient id="base">${stops}</linearGradient><linearGradient id="g" xlink:href="#base" x2="0" y2="1"/>`;
    expect(linear(old).angle).toBe(180);
  });

  it("does not follow gradients that point at each other for ever", () => {
    const body = '<linearGradient id="g" href="#h"/><linearGradient id="h" href="#g"/>';
    expect(svgToShapes(svg(`<defs>${body}</defs><rect width="10" height="10" fill="url(#g)"/>`), 100, 100)).toMatchObject({ shapes: [], skipped: 0 });
  });

  it("fills with the colour of a gradient that has one stop, and not at all for one that has none", () => {
    expect(filled('<linearGradient id="g"><stop offset="0.3" stop-color="#123456"/></linearGradient>').fill).toEqual({ type: "solid", color: "#123456" });
    expect(svgToShapes(svg('<defs><linearGradient id="g"/></defs><rect width="10" height="10" fill="url(#g)"/>'), 100, 100).shapes).toEqual([]);
  });

  it("fills with the last colour when both points of the gradient are the same", () => {
    expect(filled(`<linearGradient id="g" x1="0.5" x2="0.5">${stops}</linearGradient>`).fill).toEqual({ type: "solid", color: "#0000ff" });
    expect(filled(`<radialGradient id="g" r="0">${stops}</radialGradient>`).fill).toEqual({ type: "solid", color: "#0000ff" });
  });

  it("uses the colour after the address when the address leads nowhere", () => {
    expect(only('<rect width="10" height="10" fill="url(#nowhere) #00ff00"/>').fill).toEqual({ type: "solid", color: "#00ff00" });
    expect(svgToShapes(svg('<rect width="10" height="10" fill="url(#nowhere) none"/>'), 100, 100).shapes).toEqual([]);
    expect(only(`<defs><linearGradient id="g">${stops}</linearGradient></defs><rect width="10" height="10" fill="url('#g') #00ff00"/>`).fill?.type).toBe("linear");
  });

  it("does not paint a gradient in the units of a shape that has no width or height", () => {
    const result = svgToShapes(svg(`<defs><linearGradient id="g">${stops}</linearGradient></defs><path d="M0 10 H50" fill="url(#g)"/>`), 100, 100);
    expect(result).toMatchObject({ shapes: [], skipped: 0 });
  });

  it("puts the centre of a radial gradient where it is on the shape", () => {
    expect(radial(`<radialGradient id="g">${stops}</radialGradient>`)).toMatchObject({ type: "radial", cx: 0.5, cy: 0.5 });
    expect(radial(`<radialGradient id="g" cx="25%" cy="1">${stops}</radialGradient>`)).toMatchObject({ cx: 0.25, cy: 1 });
    expect(radial(`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="200" cy="-10" r="300">${stops}</radialGradient>`)).toMatchObject({ cx: 1, cy: 0 });
  });

  it("moves the stops of a radial gradient to the radius the editor draws with, which reaches the farthest corner", () => {
    // a circle of radius 50 in a square of 100: the editor's radius is half the diagonal, so the last stop comes in to 0.7071
    const fill = radial(`<radialGradient id="g">${stops}</radialGradient>`, '<rect width="100" height="100" fill="url(#g)"/>');
    expect(fill.stops.map((s) => s.offset)).toEqual([0, 0.7071]);
    // a box of 60 x 80 has a corner 50 from its middle: a gradient of twice that radius is cut half way
    const wide = radial(`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="30" cy="40" r="100">${stops}</radialGradient>`, '<rect width="60" height="80" fill="url(#g)"/>');
    expect(wide.stops).toEqual([
      { offset: 0, color: "#ff0000" },
      { offset: 1, color: "#800080" },
    ]);
    // the centre in a corner: the radius reaches the corner across
    const corner = radial(`<radialGradient id="g" gradientUnits="userSpaceOnUse" cx="0" cy="0" r="50">${stops}</radialGradient>`, '<rect width="60" height="80" fill="url(#g)"/>');
    expect(corner).toMatchObject({ cx: 0, cy: 0, stops: [{ offset: 0 }, { offset: 0.5 }] });
  });

  it("gives an outline the first colour of a gradient, and says that it made the part simpler", () => {
    const result = svgToShapes(
      svg(`<defs><linearGradient id="g">${stops}</linearGradient></defs><rect width="10" height="10" fill="none" stroke="url(#g)" stroke-opacity="0.5"/>`),
      100,
      100,
    );
    expect(result.shapes[0].stroke?.color).toBe("rgba(255,0,0,0.5)");
    expect(result.simplified).toBe(1);
  });

  it("leaves out and counts a part that is painted with a pattern only", () => {
    const pattern = '<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs>';
    expect(svgToShapes(svg(`${pattern}<rect width="10" height="10" fill="url(#p)"/>`), 100, 100)).toMatchObject({ shapes: [], skipped: 1 });
    expect(svgToShapes(svg(`${pattern}<rect width="10" height="10" fill="none" stroke="url(#p)"/>`), 100, 100)).toMatchObject({ shapes: [], skipped: 1 });
  });

  it("keeps the other paint of a part that is painted with a pattern too, and says that it made the part simpler", () => {
    const pattern = '<defs><pattern id="p" width="4" height="4"><rect width="2" height="2"/></pattern></defs>';
    const result = svgToShapes(svg(`${pattern}<rect width="10" height="10" fill="url(#p)" stroke="#ff0000"/>`), 100, 100);
    expect(result).toMatchObject({ skipped: 0, simplified: 1 });
    expect(result.shapes[0]).toMatchObject({ fill: null, stroke: { color: "#ff0000" } });
    const other = svgToShapes(svg(`${pattern}<rect width="10" height="10" fill="#ff0000" stroke="url(#p)"/>`), 100, 100);
    expect(other).toMatchObject({ skipped: 0, simplified: 1 });
    expect(other.shapes[0].stroke).toBeNull();
  });
});

describe("what cannot be kept", () => {
  const unit = '<rect width="10" height="10"/>';

  it("converts what is clipped, masked, filtered or has markers without them, and counts each such part once", () => {
    const body =
      `<defs><clipPath id="c">${unit}</clipPath></defs><g clip-path="url(#c)">${unit}${unit}</g><g mask="url(#m)">${unit}</g><g filter="url(#f)">${unit}</g>` +
      `<path d="M0 0 H10" stroke="#000000" marker-end="url(#k)"/><g clip-path="none" mask="none" filter="none">${unit}</g>`;
    const result = svgToShapes(svg(body), 100, 100);
    expect(result.shapes).toHaveLength(6);
    expect(result.simplified).toBe(4);
    expect(result.skipped).toBe(0);
  });

  it("refuses markup that is more than plain drawing", () => {
    expect(svgToShapes('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><rect width="10" height="10"/></svg>', 100, 100)).toEqual({
      shapes: [],
      skipped: 0,
      simplified: 0,
      problem: "not-plain",
    });
    expect(svgToShapes("", 100, 100).problem).toBe("not-plain");
  });

  it("reads an old style address although the drawing does not declare the prefix", () => {
    const body = '<defs><linearGradient id="a"><stop stop-color="#ff0000"/><stop offset="1" stop-color="#0000ff"/></linearGradient><linearGradient id="g" xlink:href="#a"/></defs>';
    const markup = `<svg viewBox="0 0 100 100">${body}<rect width="10" height="10" fill="url(#g)"/></svg>`;
    expect(svgProblem(markup)).toBeNull();
    expect(svgToShapes(markup, 100, 100).shapes[0].fill?.type).toBe("linear");
  });

  describe("with a parser that does not read the markup", () => {
    afterEach(() => vi.unstubAllGlobals());

    it("says that the drawing could not be read", () => {
      const real = new DOMParser();
      for (const answer of ["<parsererror>no</parsererror>", '<svg xmlns="http://www.w3.org/2000/svg"><parsererror>no</parsererror><rect width="10" height="10"/></svg>']) {
        vi.stubGlobal(
          "DOMParser",
          class {
            parseFromString() {
              return real.parseFromString(answer, "image/svg+xml");
            }
          },
        );
        expect(svgToShapes(svg(unit), 100, 100)).toEqual({ shapes: [], skipped: 0, simplified: 0, problem: "unreadable" });
      }
    });

    it("says the same, and converts nothing, when reading fails in a way nobody foresaw", () => {
      vi.stubGlobal(
        "DOMParser",
        class {
          parseFromString() {
            throw new Error("no parser today");
          }
        },
      );
      expect(svgToShapes(svg(unit), 100, 100)).toEqual({ shapes: [], skipped: 0, simplified: 0, problem: "unreadable" });
    });
  });

  it("refuses a box without a size", () => {
    expect(svgToShapes(svg(unit), 0, 100).problem).toBe("unreadable");
    expect(svgToShapes(svg(unit), 100, Number.NaN).problem).toBe("unreadable");
  });
});

describe("limits", () => {
  it(`converts ${MAX_SHAPES} shapes and refuses one more`, () => {
    const many = (count: number) => svg(Array.from({ length: count }, (_unused, i) => `<rect x="${i}" width="1" height="1"/>`).join(""));
    expect(svgToShapes(many(MAX_SHAPES), 100, 100).shapes).toHaveLength(MAX_SHAPES);
    expect(svgToShapes(many(MAX_SHAPES + 1), 100, 100)).toEqual({ shapes: [], skipped: 0, simplified: 0, problem: "too-large" });
  });

  it("counts the pieces a path is split into", () => {
    const d = Array.from({ length: MAX_SHAPES / 2 + 1 }, (_unused, i) => `M${i * 3} 0 h1 v1 z`).join("");
    expect(svgToShapes(svg(`<path d="${d}"/>`), 100, 100).shapes).toHaveLength(MAX_SHAPES / 2 + 1);
    expect(svgToShapes(svg(`<path d="${d}"/><path d="${d}"/>`), 100, 100).problem).toBe("too-large");
  });

  it(`reads ${MAX_POINTS} points and refuses one more`, () => {
    const line = (count: number) => svg(`<path d="M0 0${" l1 1".repeat(count - 1)}" fill="none" stroke="#000000"/>`);
    expect(svgToShapes(line(MAX_POINTS), 100, 100).shapes).toHaveLength(1);
    expect(svgToShapes(line(MAX_POINTS + 1), 100, 100)).toMatchObject({ shapes: [], problem: "too-large" });
    const points = Array.from({ length: MAX_POINTS + 1 }, (_unused, i) => `${i},${i % 7}`).join(" ");
    expect(svgToShapes(svg(`<polyline points="${points}" fill="none" stroke="#000000"/>`), 100, 100).problem).toBe("too-large");
  });

  it("refuses markup that is too long before it reads it", () => {
    const long = svg(`<title>${"x".repeat(2_000_001)}</title><rect width="10" height="10"/>`);
    expect(svgToShapes(long, 100, 100).problem).toBe("too-large");
  });

  it("leaves a path of very many pieces in one shape and does not turn them, rather than compare each with each", () => {
    const d = Array.from({ length: 450 }, (_unused, i) => `M${i * 3} 0 h1 v1 h-1 z`).join("");
    const result = svgToShapes(svg(`<path d="${d}" fill-rule="evenodd"/>`), 100, 100);
    expect(result.shapes).toHaveLength(1);
    expect(result.simplified).toBe(1);
  });
});

describe("the drawings that come with the editor", () => {
  const finite = (shape: ShapeElement) =>
    [shape.x, shape.y, shape.width, shape.height, shape.opacity, shape.stroke?.width ?? 0].every(Number.isFinite) &&
    !/NaN|Infinity|undefined/.test(shape.path as string) &&
    shape.width > 0 &&
    shape.height > 0;

  it("converts every illustration and sticker into at least one shape with sound numbers", () => {
    expect(GRAPHICS.length).toBeGreaterThan(50);
    for (const graphic of GRAPHICS) {
      expect(svgProblem(graphic.svg), graphic.id).toBeNull();
      const el = createGraphic({ svg: graphic.svg, width: 300 });
      const result = svgToShapes(graphic.svg, el.width, el.height);
      expect(result.problem, graphic.id).toBeNull();
      expect(result.skipped, graphic.id).toBe(0);
      expect(result.shapes.length, graphic.id).toBeGreaterThan(0);
      expect(result.shapes.every(finite), graphic.id).toBe(true);
      // nothing lands far outside the box of the element
      for (const shape of result.shapes) {
        expect(shape.x + shape.width, graphic.id).toBeGreaterThan(-el.width);
        expect(shape.x, graphic.id).toBeLessThan(2 * el.width);
      }
    }
  });

  it("converts every icon into outlines with sound numbers", async () => {
    const { icons } = (await import("lucide")) as unknown as { icons: Record<string, Array<[string, Record<string, string | number>]>> };
    const names = Object.keys(icons);
    expect(names.length).toBeGreaterThan(500);
    for (const name of names) {
      const markup = iconNodeToSvg(icons[name]);
      const result = svgToShapes(markup, 240, 240);
      expect(result.problem, name).toBeNull();
      expect(result.skipped, name).toBe(0);
      expect(result.shapes.length, name).toBeGreaterThan(0);
      expect(result.shapes.every(finite), name).toBe(true);
      expect(
        result.shapes.every((s) => s.stroke?.width === 20 && s.stroke.cap === "round" && s.stroke.join === "round"),
        name,
      ).toBe(true);
    }
  });
});

describe("taking the place of an element", () => {
  const two = svg('<rect x="10" y="10" width="30" height="30" fill="#ff0000"/><circle cx="70" cy="70" r="20" fill="#0000ff"/>');

  it("makes a group of the shapes where the drawing was, with the shapes in the space of the group", () => {
    const el = createGraphic({ svg: two, x: 100, y: 200, width: 200, height: 200 });
    const result = convertToShapes(el, two);
    expect(result).toMatchObject({ count: 2, skipped: 0, simplified: 0, problem: null });
    const group = result.element as GroupElement;
    // the box of the group is the box of what is drawn, not of the empty edge around it
    expect(group).toMatchObject({ type: "group", x: 120, y: 220, width: 160, height: 160, rotation: 0, opacity: 1 });
    expect(group.children.map((c) => [c.x, c.y, c.width, c.height])).toEqual([
      [0, 0, 60, 60],
      [80, 80, 80, 80],
    ]);
    expect(group.id).not.toBe(el.id);
  });

  it("hands back the one shape itself when there is only one", () => {
    const one = svg('<rect x="10" y="10" width="30" height="30" fill="#ff0000" opacity="0.5"/>');
    const el = createGraphic({ svg: one, x: 100, y: 200, width: 200, height: 200, opacity: 0.5 });
    const result = convertToShapes(el, one);
    expect(result.count).toBe(1);
    expect(result.element).toMatchObject({ type: "shape", shape: "path", x: 120, y: 220, width: 60, height: 60, opacity: 0.25 });
  });

  it("keeps everything where it is on the page when the element is turned", () => {
    const el = createGraphic({ svg: two, x: 100, y: 200, width: 200, height: 200, rotation: 30 });
    const group = convertToShapes(el, two).element as GroupElement;
    expect(group.rotation).toBe(30);
    // the middle of the circle, through the element and through the group
    const before = fromLocalPoint(el, { x: 140, y: 140 });
    const circle = group.children[1];
    const after = fromLocalPoint(group, { x: circle.x + circle.width / 2, y: circle.y + circle.height / 2 });
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it("mirrors the points of a mirrored element, so that the group needs no mirror", () => {
    const el = createGraphic({ svg: two, x: 0, y: 0, width: 100, height: 100, flipH: true, flipV: true });
    const group = convertToShapes(el, two).element as GroupElement;
    expect(group.flipH).toBeUndefined();
    expect(group.flipV).toBeUndefined();
    expect(group).toMatchObject({ x: 10, y: 10 });
    // the square was at the top left and is at the bottom right now
    expect(group.children[0]).toMatchObject({ x: 50, y: 50, width: 30, height: 30 });
    const half = svg('<rect x="10" y="10" width="30" height="30"/>');
    expect(convertToShapes(createGraphic({ svg: half, x: 0, y: 0, width: 100, height: 100, flipH: true }), half).element).toMatchObject({ x: 60, y: 10 });
    expect(convertToShapes(createGraphic({ svg: half, x: 0, y: 0, width: 100, height: 100, flipV: true }), half).element).toMatchObject({ x: 10, y: 60 });
  });

  it("carries over what belongs to the element as a whole", () => {
    const shadow = { color: "#000000", blur: 4, x: 1, y: 2 };
    const animation = { in: { kind: "fade", duration: 1, delay: 0 } };
    const el = createGraphic({ svg: two, name: "Logo", opacity: 0.4, shadow, blur: 2, blend: "multiply", alt: "Our logo", link: "https://example.test/", animation });
    expect(convertToShapes(el, two).element).toMatchObject({
      name: "Logo",
      opacity: 0.4,
      shadow,
      blur: 2,
      blend: "multiply",
      alt: "Our logo",
      link: "https://example.test/",
      animation,
    });
    const plain = convertToShapes(createGraphic({ svg: two }), two).element as GroupElement;
    for (const key of ["name", "shadow", "blur", "blend", "alt", "link", "animation"]) expect(key in plain, key).toBe(false);
  });

  it("uses the colours and the line width a graphic was given in the editor", () => {
    const icon = iconNodeToSvg([
      ["path", { d: "M2 12h20" }],
      ["circle", { cx: 12, cy: 12, r: 4, fill: "#ff0000" }],
    ]);
    const el = createGraphic({ svg: icon, width: 240, height: 240, colors: { currentColor: "#00aa00", "#ff0000": "#0000ff" }, strokeWidth: 3 });
    const group = convertToShapes(el).element as GroupElement;
    const [line, dot] = group.children as ShapeElement[];
    expect(line.stroke).toMatchObject({ color: "#00aa00", width: 30, cap: "round", join: "round" });
    expect(line.fill).toBeNull();
    expect(dot.fill).toEqual({ type: "solid", color: "#0000ff" });
  });

  it("lays the drawing of a picture over the place the crop gives the whole picture", () => {
    const one = svg('<rect width="50" height="100"/>');
    // the picture is twice as wide as the box and starts half a box to the left: the box shows its middle
    const el = createImage({ src: "asset:a", x: 10, y: 20, width: 100, height: 100, naturalWidth: 100, naturalHeight: 100, crop: { x: -0.5, y: 0, w: 2, h: 1 } });
    expect(convertToShapes(el, one).element).toMatchObject({ x: -40, y: 20, width: 100, height: 100 });
    const mirrored = { ...el, flipH: true };
    expect(convertToShapes(mirrored, one).element).toMatchObject({ x: 60, y: 20, width: 100, height: 100 });
  });

  it("hands back no element when nothing could be converted, with the reason", () => {
    const el = createImage({ src: "asset:a", width: 100, height: 100 });
    expect(convertToShapes(el, svg('<rect width="10" height="10" fill="none"/>'))).toEqual({ element: null, count: 0, skipped: 0, simplified: 0, problem: null });
    expect(convertToShapes(el, "<svg><script/></svg>")).toMatchObject({ element: null, problem: "not-plain" });
    // a picture comes with no markup of its own
    expect(convertToShapes(el)).toMatchObject({ element: null, problem: "not-plain" });
    // a graphic does
    expect(convertToShapes(createGraphic({ svg: svg('<rect width="10" height="10"/>') }))).toMatchObject({ count: 1, element: { type: "shape" } });
  });
});
