import type { LineElement, Point } from "./types";

export const straightPath = (line: Pick<LineElement, "width" | "height">): Point[] => [
  { x: 0, y: line.height / 2 },
  { x: line.width, y: line.height / 2 },
];

export function linePath(line: Pick<LineElement, "width" | "height" | "route">): Point[] {
  return line.route && line.route.length >= 2 ? line.route : straightPath(line);
}

function cubic(a: Point, b: Point, c: Point, d: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u ** 3 * a.x + 3 * u * u * t * b.x + 3 * u * t * t * c.x + t ** 3 * d.x,
    y: u ** 3 * a.y + 3 * u * u * t * b.y + 3 * u * t * t * c.y + t ** 3 * d.y,
  };
}

/** Polyline approximation used for hit testing and for placing a label. */
export function lineSegments(line: Pick<LineElement, "width" | "height" | "route" | "routing">): Point[] {
  const path = linePath(line);
  if (line.routing !== "curved" || path.length !== 4) return path;
  return Array.from({ length: 25 }, (_unused, i) => cubic(path[0], path[1], path[2], path[3], i / 24));
}

export function lineRouteAngles(line: Pick<LineElement, "width" | "height" | "route" | "routing">): { start: number; end: number } {
  const path = linePath(line);
  const first = path[0];
  const second = path[1];
  const last = path[path.length - 1];
  const before = path[path.length - 2];
  return { start: Math.atan2(second.y - first.y, second.x - first.x), end: Math.atan2(last.y - before.y, last.x - before.x) };
}

export function lineLabelPoint(line: Pick<LineElement, "width" | "height" | "route" | "routing">): Point {
  const path = lineSegments(line);
  let total = 0;
  const lengths = path.slice(1).map((point, i) => {
    const length = Math.hypot(point.x - path[i].x, point.y - path[i].y);
    total += length;
    return length;
  });
  let left = total / 2;
  for (let i = 0; i < lengths.length; i++) {
    if (left <= lengths[i] || i === lengths.length - 1) {
      const t = lengths[i] ? left / lengths[i] : 0;
      return { x: path[i].x + (path[i + 1].x - path[i].x) * t, y: path[i].y + (path[i + 1].y - path[i].y) * t };
    }
    left -= lengths[i];
  }
  return path[0];
}
