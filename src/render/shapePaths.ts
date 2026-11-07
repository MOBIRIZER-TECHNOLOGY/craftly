/**
 * Shape geometry. Every shape resolves to SVG path data in *pixel* space for a
 * given box, so the canvas renderer (Path2D), image masks and the SVG exporter
 * share one definition.
 */
import type { ShapeElement } from "@/core/types";

export type ShapeGroup = "basic" | "polygons" | "stars" | "arrows" | "symbols" | "bubbles" | "blobs";

export interface ShapeParams {
  sides?: number;
  points?: number;
  inner?: number;
  [k: string]: number | undefined;
}

export interface ShapeDef {
  id: string;
  name: string;
  group: ShapeGroup;
  /** path data for a w x h box */
  path(w: number, h: number, p: ShapeParams, radius: number): string;
  /** width / height when first inserted */
  aspect?: number;
  /** supports the corner radius control */
  hasRadius?: boolean;
  fillRule?: "nonzero" | "evenodd";
  params?: ShapeParams;
}

const f = (n: number) => +n.toFixed(2);

/* ------------------------------------------------------------------ */
/* path utilities                                                      */
/* ------------------------------------------------------------------ */

const ARGC: Record<string, number> = { M: 2, L: 2, H: 1, V: 1, C: 6, S: 4, Q: 4, T: 2, A: 7, Z: 0 };

/** Scales path data (absolute and relative commands) by sx, sy. */
export function scalePathData(d: string, sx: number, sy: number): string {
  const re = /([MLHVCSQTAZmlhvcsqtaz])([^MLHVCSQTAZmlhvcsqtaz]*)/g;
  let out = "";
  let m: RegExpExecArray | null;
  while ((m = re.exec(d))) {
    const cmd = m[1];
    const up = cmd.toUpperCase();
    const nums = (m[2].match(/-?\d*\.?\d+(?:e[-+]?\d+)?/gi) ?? []).map(parseFloat);
    if (up === "Z") {
      out += "Z";
      continue;
    }
    const n = ARGC[up];
    let seg = cmd;
    for (let i = 0; i + n <= nums.length; i += n) {
      const a = nums.slice(i, i + n);
      let r: number[];
      if (up === "H") r = [a[0] * sx];
      else if (up === "V") r = [a[0] * sy];
      else if (up === "A") r = [a[0] * sx, a[1] * sy, a[2], a[3], a[4], a[5] * sx, a[6] * sy];
      else r = a.map((v, j) => (j % 2 === 0 ? v * sx : v * sy));
      seg += (i ? " " : "") + r.map(f).join(" ");
    }
    out += seg;
  }
  return out;
}

/** Path authored in a vw x vh viewBox, stretched to w x h. */
const viewBoxPath = (d: string, vw: number, vh: number) => (w: number, h: number) => scalePathData(d, w / vw, h / vh);

const polygon = (pts: Array<[number, number]>) => (w: number, h: number) => "M" + pts.map(([x, y]) => `${f(x * w)} ${f(y * h)}`).join("L") + "Z";

function regularPolygon(w: number, h: number, n: number, rotation = -90): string {
  const cx = w / 2;
  const cy = h / 2;
  const pts: string[] = [];
  for (let k = 0; k < n; k++) {
    const a = ((rotation + (k * 360) / n) * Math.PI) / 180;
    pts.push(`${f(cx + (w / 2) * Math.cos(a))} ${f(cy + (h / 2) * Math.sin(a))}`);
  }
  return "M" + pts.join("L") + "Z";
}

function starPath(w: number, h: number, points: number, inner: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const pts: string[] = [];
  for (let k = 0; k < points * 2; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / points;
    const r = k % 2 === 0 ? 1 : inner;
    pts.push(`${f(cx + (w / 2) * r * Math.cos(a))} ${f(cy + (h / 2) * r * Math.sin(a))}`);
  }
  return "M" + pts.join("L") + "Z";
}

/** circle with a wavy edge (scallops) */
function wavyCircle(w: number, h: number, lobes: number, amp: number): string {
  const cx = w / 2;
  const cy = h / 2;
  const steps = 240;
  const pts: string[] = [];
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    const r = 1 - amp + amp * Math.cos(a * lobes);
    pts.push(`${f(cx + (w / 2) * r * Math.cos(a))} ${f(cy + (h / 2) * r * Math.sin(a))}`);
  }
  return "M" + pts.join("L") + "Z";
}

function roundedRect(w: number, h: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, w / 2, h / 2));
  if (r <= 0.01) return `M0 0H${f(w)}V${f(h)}H0Z`;
  return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(h - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(h)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(h - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
}

function ellipsePath(w: number, h: number): string {
  const rx = w / 2;
  const ry = h / 2;
  return `M0 ${f(ry)}A${f(rx)} ${f(ry)} 0 1 0 ${f(w)} ${f(ry)}A${f(rx)} ${f(ry)} 0 1 0 0 ${f(ry)}Z`;
}

/* ------------------------------------------------------------------ */
/* catalogue                                                           */
/* ------------------------------------------------------------------ */

export const SHAPES: ShapeDef[] = [
  { id: "rect", name: "Square", group: "basic", path: (w, h, _p, r) => roundedRect(w, h, r), hasRadius: true },
  { id: "ellipse", name: "Circle", group: "basic", path: (w, h) => ellipsePath(w, h) },
  {
    id: "triangle",
    name: "Triangle",
    group: "basic",
    path: polygon([
      [0.5, 0],
      [1, 1],
      [0, 1],
    ]),
    aspect: 1.1,
  },
  {
    id: "right-triangle",
    name: "Right triangle",
    group: "basic",
    path: polygon([
      [0, 0],
      [1, 1],
      [0, 1],
    ]),
  },
  {
    id: "diamond",
    name: "Diamond",
    group: "basic",
    path: polygon([
      [0.5, 0],
      [1, 0.5],
      [0.5, 1],
      [0, 0.5],
    ]),
  },
  {
    id: "trapezoid",
    name: "Trapezoid",
    group: "basic",
    path: polygon([
      [0.2, 0],
      [0.8, 0],
      [1, 1],
      [0, 1],
    ]),
    aspect: 1.4,
  },
  {
    id: "parallelogram",
    name: "Parallelogram",
    group: "basic",
    path: polygon([
      [0.25, 0],
      [1, 0],
      [0.75, 1],
      [0, 1],
    ]),
    aspect: 1.5,
  },
  { id: "half-circle", name: "Half circle", group: "basic", path: (w, h) => `M0 ${f(h)}A${f(w / 2)} ${f(h)} 0 0 1 ${f(w)} ${f(h)}Z`, aspect: 2 },
  { id: "quarter-circle", name: "Quarter circle", group: "basic", path: (w, h) => `M0 ${f(h)}V0A${f(w)} ${f(h)} 0 0 1 ${f(w)} ${f(h)}Z` },
  {
    id: "arch",
    name: "Arch",
    group: "basic",
    path: (w, h) => {
      const ry = Math.min(w / 2, h * 0.9);
      return `M0 ${f(h)}V${f(ry)}A${f(w / 2)} ${f(ry)} 0 0 1 ${f(w)} ${f(ry)}V${f(h)}Z`;
    },
    aspect: 0.7,
  },
  {
    id: "ring",
    name: "Ring",
    group: "basic",
    fillRule: "evenodd",
    params: { inner: 0.62 },
    path: (w, h, p) => {
      const k = p.inner ?? 0.62;
      const iw = w * k;
      const ih = h * k;
      const ox = (w - iw) / 2;
      return ellipsePath(w, h) + `M${f(ox)} ${f(h / 2)}A${f(iw / 2)} ${f(ih / 2)} 0 1 1 ${f(ox + iw)} ${f(h / 2)}A${f(iw / 2)} ${f(ih / 2)} 0 1 1 ${f(ox)} ${f(h / 2)}Z`;
    },
  },
  { id: "pentagon", name: "Pentagon", group: "polygons", path: (w, h) => regularPolygon(w, h, 5) },
  { id: "hexagon", name: "Hexagon", group: "polygons", path: (w, h) => regularPolygon(w, h, 6, 0), aspect: 1.15 },
  { id: "octagon", name: "Octagon", group: "polygons", path: (w, h) => regularPolygon(w, h, 8, -22.5) },
  { id: "polygon", name: "Polygon", group: "polygons", params: { sides: 7 }, path: (w, h, p) => regularPolygon(w, h, Math.max(3, Math.round(p.sides ?? 7))) },
  { id: "star", name: "Star", group: "stars", params: { points: 5, inner: 0.42 }, path: (w, h, p) => starPath(w, h, Math.max(3, Math.round(p.points ?? 5)), p.inner ?? 0.42) },
  { id: "star-4", name: "Sparkle", group: "stars", params: { points: 4, inner: 0.28 }, path: (w, h, p) => starPath(w, h, 4, p.inner ?? 0.28) },
  { id: "star-6", name: "Hexagram", group: "stars", params: { points: 6, inner: 0.55 }, path: (w, h, p) => starPath(w, h, 6, p.inner ?? 0.55) },
  { id: "burst", name: "Starburst", group: "stars", params: { points: 16, inner: 0.82 }, path: (w, h, p) => starPath(w, h, Math.round(p.points ?? 16), p.inner ?? 0.82) },
  { id: "scallop", name: "Scallop badge", group: "stars", params: { lobes: 12, amp: 0.05 }, path: (w, h, p) => wavyCircle(w, h, Math.round(p.lobes ?? 12), p.amp ?? 0.05) },
  { id: "flower", name: "Flower", group: "stars", params: { lobes: 8, amp: 0.2 }, path: (w, h, p) => wavyCircle(w, h, Math.round(p.lobes ?? 8), p.amp ?? 0.2) },
  {
    id: "arrow-right",
    name: "Arrow",
    group: "arrows",
    aspect: 1.6,
    path: polygon([
      [0, 0.3],
      [0.6, 0.3],
      [0.6, 0],
      [1, 0.5],
      [0.6, 1],
      [0.6, 0.7],
      [0, 0.7],
    ]),
  },
  {
    id: "arrow-left",
    name: "Arrow left",
    group: "arrows",
    aspect: 1.6,
    path: polygon([
      [1, 0.3],
      [0.4, 0.3],
      [0.4, 0],
      [0, 0.5],
      [0.4, 1],
      [0.4, 0.7],
      [1, 0.7],
    ]),
  },
  {
    id: "arrow-up",
    name: "Arrow up",
    group: "arrows",
    aspect: 0.63,
    path: polygon([
      [0.3, 1],
      [0.3, 0.4],
      [0, 0.4],
      [0.5, 0],
      [1, 0.4],
      [0.7, 0.4],
      [0.7, 1],
    ]),
  },
  {
    id: "arrow-down",
    name: "Arrow down",
    group: "arrows",
    aspect: 0.63,
    path: polygon([
      [0.3, 0],
      [0.3, 0.6],
      [0, 0.6],
      [0.5, 1],
      [1, 0.6],
      [0.7, 0.6],
      [0.7, 0],
    ]),
  },
  {
    id: "chevron",
    name: "Chevron",
    group: "arrows",
    aspect: 1.3,
    path: polygon([
      [0, 0],
      [0.62, 0],
      [1, 0.5],
      [0.62, 1],
      [0, 1],
      [0.38, 0.5],
    ]),
  },
  {
    id: "double-arrow",
    name: "Double arrow",
    group: "arrows",
    aspect: 2,
    path: polygon([
      [0, 0.5],
      [0.22, 0.12],
      [0.22, 0.34],
      [0.78, 0.34],
      [0.78, 0.12],
      [1, 0.5],
      [0.78, 0.88],
      [0.78, 0.66],
      [0.22, 0.66],
      [0.22, 0.88],
    ]),
  },
  {
    id: "heart",
    name: "Heart",
    group: "symbols",
    aspect: 1.1,
    path: viewBoxPath("M50 100C12 70 0 48 0 30C0 12 14 0 30 0C40 0 47 5 50 16C53 5 60 0 70 0C86 0 100 12 100 30C100 48 88 70 50 100Z", 100, 100),
  },
  {
    id: "plus",
    name: "Plus",
    group: "symbols",
    path: polygon([
      [0.35, 0],
      [0.65, 0],
      [0.65, 0.35],
      [1, 0.35],
      [1, 0.65],
      [0.65, 0.65],
      [0.65, 1],
      [0.35, 1],
      [0.35, 0.65],
      [0, 0.65],
      [0, 0.35],
      [0.35, 0.35],
    ]),
  },
  {
    id: "cross",
    name: "Cross",
    group: "symbols",
    path: polygon([
      [0.2, 0],
      [0.5, 0.3],
      [0.8, 0],
      [1, 0.2],
      [0.7, 0.5],
      [1, 0.8],
      [0.8, 1],
      [0.5, 0.7],
      [0.2, 1],
      [0, 0.8],
      [0.3, 0.5],
      [0, 0.2],
    ]),
  },
  {
    id: "lightning",
    name: "Lightning",
    group: "symbols",
    aspect: 0.7,
    path: polygon([
      [0.62, 0],
      [0.12, 0.56],
      [0.46, 0.56],
      [0.34, 1],
      [0.92, 0.38],
      [0.56, 0.38],
    ]),
  },
  { id: "moon", name: "Crescent", group: "symbols", path: viewBoxPath("M62 2A50 50 0 1 0 98 78A40 40 0 0 1 62 2Z", 100, 100) },
  { id: "drop", name: "Teardrop", group: "symbols", aspect: 0.8, path: viewBoxPath("M50 0C50 0 100 52 100 70A50 50 0 0 1 0 70C0 52 50 0 50 0Z", 100, 120) },
  { id: "cloud", name: "Cloud", group: "symbols", aspect: 1.6, path: viewBoxPath("M26 58C6 58 0 38 15 32C12 14 38 6 49 20C57 6 88 10 88 31C106 32 108 58 88 58Z", 108, 62) },
  {
    id: "tag",
    name: "Tag",
    group: "symbols",
    aspect: 1.7,
    path: polygon([
      [0, 0.12],
      [0.72, 0.12],
      [1, 0.5],
      [0.72, 0.88],
      [0, 0.88],
    ]),
  },
  {
    id: "ribbon",
    name: "Ribbon",
    group: "symbols",
    aspect: 2.4,
    path: polygon([
      [0, 0.15],
      [0.12, 0.15],
      [0.12, 0],
      [0.88, 0],
      [0.88, 0.15],
      [1, 0.15],
      [0.9, 0.5],
      [1, 0.85],
      [0.88, 0.85],
      [0.88, 1],
      [0.12, 1],
      [0.12, 0.85],
      [0, 0.85],
      [0.1, 0.5],
    ]),
  },
  {
    id: "cut-corner",
    name: "Cut corner",
    group: "symbols",
    path: polygon([
      [0.18, 0],
      [1, 0],
      [1, 0.82],
      [0.82, 1],
      [0, 1],
      [0, 0.18],
    ]),
  },
  {
    id: "speech",
    name: "Speech bubble",
    group: "bubbles",
    aspect: 1.35,
    path: (w, h) => {
      const bh = h * 0.8;
      const r = Math.min(w, bh) * 0.18;
      return `M${f(r)} 0H${f(w - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w)} ${f(r)}V${f(bh - r)}A${f(r)} ${f(r)} 0 0 1 ${f(w - r)} ${f(bh)}H${f(w * 0.36)}L${f(w * 0.2)} ${f(h)}L${f(w * 0.22)} ${f(bh)}H${f(r)}A${f(r)} ${f(r)} 0 0 1 0 ${f(bh - r)}V${f(r)}A${f(r)} ${f(r)} 0 0 1 ${f(r)} 0Z`;
    },
  },
  {
    id: "speech-round",
    name: "Round bubble",
    group: "bubbles",
    aspect: 1.2,
    path: (w, h) => {
      const bh = h * 0.84;
      const rx = w / 2;
      const ry = bh / 2;
      return `M${f(w * 0.3)} ${f(bh - ry * 0.05)}L${f(w * 0.18)} ${f(h)}L${f(w * 0.46)} ${f(bh)}A${f(rx)} ${f(ry)} 0 1 0 ${f(w * 0.3)} ${f(bh - ry * 0.05)}Z`;
    },
  },
  { id: "blob-1", name: "Blob 1", group: "blobs", path: viewBoxPath("M52 4C74 2 96 20 97 46C98 72 78 96 50 97C24 98 3 78 3 52C3 26 28 6 52 4Z", 100, 100) },
  { id: "blob-2", name: "Blob 2", group: "blobs", path: viewBoxPath("M30 10C52 -4 86 6 94 34C102 62 80 78 66 90C46 106 14 96 6 70C-2 46 12 22 30 10Z", 100, 100) },
  { id: "blob-3", name: "Blob 3", group: "blobs", path: viewBoxPath("M60 3C84 8 99 30 94 54C90 78 66 98 42 94C16 90 2 66 8 42C14 18 38 -1 60 3Z", 100, 100) },
  { id: "blob-4", name: "Blob 4", group: "blobs", path: viewBoxPath("M48 2C64 -2 74 12 88 22C102 34 100 56 92 72C82 90 60 100 42 96C20 92 4 76 2 54C0 32 18 8 48 2Z", 100, 100) },
  { id: "blob-5", name: "Blob 5", group: "blobs", path: viewBoxPath("M70 6C90 14 100 36 94 58C88 80 68 98 44 96C20 94 2 76 4 52C6 30 20 20 34 12C46 6 56 0 70 6Z", 100, 100) },
  { id: "blob-6", name: "Blob 6", group: "blobs", path: viewBoxPath("M26 8C46 -2 64 10 80 18C98 28 104 50 94 68C84 86 62 92 42 96C22 100 2 84 2 62C2 40 8 18 26 8Z", 100, 100) },
];

const BY_ID = new Map(SHAPES.map((s) => [s.id, s]));

export const getShape = (id: string): ShapeDef | undefined => BY_ID.get(id);

/** Path data for any element that has a shape-like outline (shape elements, image masks). */
export function shapePathData(kind: string, w: number, h: number, opts: { radius?: number; params?: ShapeParams; path?: string } = {}): string {
  if (w <= 0 || h <= 0) return "";
  if (kind === "path" && opts.path) return scalePathData(opts.path, w / 100, h / 100);
  const def = BY_ID.get(kind) ?? BY_ID.get("rect")!;
  return def.path(w, h, { ...def.params, ...opts.params }, opts.radius ?? 0);
}

export const shapeFillRule = (kind: string): "nonzero" | "evenodd" => BY_ID.get(kind)?.fillRule ?? "nonzero";

export const shapePathOf = (el: Pick<ShapeElement, "shape" | "width" | "height" | "radius" | "params" | "path">) =>
  shapePathData(el.shape, el.width, el.height, { radius: el.radius, params: el.params, path: el.path });

/* Path2D cache (canvas only) */
const path2dCache = new Map<string, Path2D>();
export function getPath2D(kind: string, w: number, h: number, opts: { radius?: number; params?: ShapeParams; path?: string } = {}): Path2D {
  const key = `${kind}|${f(w)}|${f(h)}|${opts.radius ?? 0}|${JSON.stringify(opts.params ?? null)}|${opts.path ?? ""}`;
  let p = path2dCache.get(key);
  if (!p) {
    if (path2dCache.size > 600) path2dCache.clear();
    p = new Path2D(shapePathData(kind, w, h, opts));
    path2dCache.set(key, p);
  }
  return p;
}
