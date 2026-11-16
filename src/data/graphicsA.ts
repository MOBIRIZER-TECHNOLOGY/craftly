/**
 * Craftly illustration library, part A: abstract, nature, decor, doodles, dividers, frames,
 * badges and arrows. Every piece is original, hand-composed flat vector art.
 *
 * Geometry is computed once at module load by the tiny helpers below, so the exported
 * library is plain static markup: standalone <svg> strings with a viewBox, literal lower-case
 * #rrggbb colours (recolourable by regex) and only basic elements (path, rect, circle, ellipse,
 * polygon, polyline, line, g and the odd gradient). Strokes always use round caps and joins.
 */
import type { GraphicCategory, GraphicDraft } from "./graphicTypes";

/* ------------------------------------------------------------------------------------------ *
 *  Toolkit
 * ------------------------------------------------------------------------------------------ */

type Pt = [number, number];

const TAU = Math.PI * 2;
const rad = (deg: number): number => (deg * Math.PI) / 180;

/** Number to at most one decimal, never "-0". */
const n = (v: number): string => {
  const r = Math.round(v * 10) / 10;
  return String(Object.is(r, -0) ? 0 : r);
};

/** Two points as "x y". */
const xy = (p: Pt): string => `${n(p[0])} ${n(p[1])}`;

/** Standalone svg document. */
const svg = (w: number, h: number, body: string): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;

/** Presentation attributes for a round-capped, round-joined stroke group. */
const ink = (color: string, width: number): string =>
  `fill="none" stroke="${color}" stroke-width="${width}" stroke-linecap="round" stroke-linejoin="round"`;

/** `<g>` wrapper. */
const g = (attrs: string, body: string): string => `<g ${attrs}>${body}</g>`;

/** Filled path. */
const fp = (d: string, fill: string): string => `<path d="${d}" fill="${fill}"/>`;

/** Stroked path (own attributes, for one-off strokes). */
const sp = (d: string, color: string, width: number): string => `<path d="${d}" ${ink(color, width)}/>`;

/** Filled circle. */
const circ = (cx: number, cy: number, r: number, fill: string): string =>
  `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(r)}" fill="${fill}"/>`;

/** Rotate a chunk of markup about a point. */
const rot = (deg: number, cx: number, cy: number, body: string): string =>
  `<g transform="rotate(${n(deg)} ${n(cx)} ${n(cy)})">${body}</g>`;

/** Translate a chunk of markup. */
const mv = (dx: number, dy: number, body: string): string => `<g transform="translate(${n(dx)} ${n(dy)})">${body}</g>`;

/** Mirror a chunk of markup left-to-right inside a viewBox of the given width. */
const mirror = (w: number, body: string): string => `<g transform="translate(${w} 0) scale(-1 1)">${body}</g>`;

/** Deterministic pseudo random numbers (mulberry32), so the library never changes between loads. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Smooth curve through points (Catmull-Rom converted to cubic Beziers). */
function smooth(pts: Pt[], closed: boolean, k = 1): string {
  const m = pts.length;
  const at = (i: number): Pt => (closed ? pts[(i + m) % m] : pts[Math.max(0, Math.min(m - 1, i))]);
  let d = `M${xy(pts[0])}`;
  const segs = closed ? m : m - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + ((p2[0] - p0[0]) / 6) * k, p1[1] + ((p2[1] - p0[1]) / 6) * k];
    const c2: Pt = [p2[0] - ((p3[0] - p1[0]) / 6) * k, p2[1] - ((p3[1] - p1[1]) / 6) * k];
    d += `C${xy(c1)} ${xy(c2)} ${xy(p2)}`;
  }
  return closed ? d + "Z" : d;
}

/** Straight-edged polygon path. */
const polyD = (pts: Pt[]): string => `M${pts.map(xy).join("L")}Z`;

/** Scale + centre points so they fill a W x H box (uniformly) with padding. */
function fit(pts: Pt[], W: number, H: number, pad: number): Pt[] {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const y0 = Math.min(...ys);
  const y1 = Math.max(...ys);
  const s = Math.min((W - 2 * pad) / (x1 - x0), (H - 2 * pad) / (y1 - y0));
  const ox = (W - (x1 - x0) * s) / 2 - x0 * s;
  const oy = (H - (y1 - y0) * s) / 2 - y0 * s;
  return pts.map((p) => [p[0] * s + ox, p[1] * s + oy] as Pt);
}

/** Points on a closed organic outline: radius modulated by a few harmonics. */
interface Harm {
  k: number; // lobes
  a: number; // amplitude (fraction of radius)
  p: number; // phase (radians)
}
function blobPts(harms: Harm[], sx = 1, sy = 1, samples = 14, turn = 0): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < samples; i++) {
    const t = (i / samples) * TAU;
    let r = 1;
    for (const h of harms) r += h.a * Math.cos(h.k * t + h.p);
    const x = Math.cos(t) * r * sx;
    const y = Math.sin(t) * r * sy;
    out.push([x * Math.cos(turn) - y * Math.sin(turn), x * Math.sin(turn) + y * Math.cos(turn)]);
  }
  return out;
}

/** Star / burst polygon points. */
function starPts(cx: number, cy: number, R: number, r: number, points: number, start = -Math.PI / 2): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < points * 2; i++) {
    const rr = i % 2 ? r : R;
    const a = start + (i * Math.PI) / points;
    out.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
  }
  return out;
}

/** Four-point sparkle with softly concave sides. */
function sparkleD(cx: number, cy: number, R: number, pinch = 0.16): string {
  const q = R * pinch;
  return (
    `M${n(cx)} ${n(cy - R)}Q${n(cx + q)} ${n(cy - q)} ${n(cx + R)} ${n(cy)}` +
    `Q${n(cx + q)} ${n(cy + q)} ${n(cx)} ${n(cy + R)}` +
    `Q${n(cx - q)} ${n(cy + q)} ${n(cx - R)} ${n(cy)}` +
    `Q${n(cx - q)} ${n(cy - q)} ${n(cx)} ${n(cy - R)}Z`
  );
}

/** Pointed leaf from (x,y) heading at angle `a`, with a given length and half width. */
function leafD(x: number, y: number, a: number, len: number, wid: number): string {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const P = (u: number, v: number): string => `${n(x + ca * u - sa * v)} ${n(y + sa * u + ca * v)}`;
  return (
    `M${P(0, 0)}C${P(len * 0.14, wid * 1.3)} ${P(len * 0.62, wid * 1.15)} ${P(len, 0)}` +
    `C${P(len * 0.62, -wid * 1.15)} ${P(len * 0.14, -wid * 1.3)} ${P(0, 0)}Z`
  );
}

/** Slim symmetric lens (cheaper than leafD) from (x,y) heading at angle `a`. */
function lensD(x: number, y: number, a: number, len: number, wid: number): string {
  const ca = Math.cos(a);
  const sa = Math.sin(a);
  const P = (u: number, v: number): string => `${n(x + ca * u - sa * v)} ${n(y + sa * u + ca * v)}`;
  return `M${P(0, 0)}Q${P(len * 0.5, wid * 2)} ${P(len, 0)}Q${P(len * 0.5, -wid * 2)} ${P(0, 0)}Z`;
}

/** Quadratic Bezier helpers (stems, branches, stalks). */
interface Quad {
  a: Pt;
  c: Pt;
  b: Pt;
}
const qAt = (q: Quad, t: number): Pt => {
  const u = 1 - t;
  return [u * u * q.a[0] + 2 * u * t * q.c[0] + t * t * q.b[0], u * u * q.a[1] + 2 * u * t * q.c[1] + t * t * q.b[1]];
};
const qAng = (q: Quad, t: number): number => {
  const u = 1 - t;
  return Math.atan2(2 * u * (q.c[1] - q.a[1]) + 2 * t * (q.b[1] - q.c[1]), 2 * u * (q.c[0] - q.a[0]) + 2 * t * (q.b[0] - q.c[0]));
};
const qD = (q: Quad): string => `M${xy(q.a)}Q${xy(q.c)} ${xy(q.b)}`;

/** Arc along a circle between two angles (radians), as path data. */
function arcD(cx: number, cy: number, r: number, a0: number, a1: number): string {
  const p = (a: number): string => `${n(cx + Math.cos(a) * r)} ${n(cy + Math.sin(a) * r)}`;
  const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${p(a0)}A${n(r)} ${n(r)} 0 ${large} ${a1 > a0 ? 1 : 0} ${p(a1)}`;
}

/** Scalloped circle outline: `count` outward bumps around radius R. */
function scallopD(cx: number, cy: number, R: number, count: number, bulge = 0.62): string {
  const pt = (i: number): Pt => [cx + Math.cos((i / count) * TAU - Math.PI / 2) * R, cy + Math.sin((i / count) * TAU - Math.PI / 2) * R];
  const chord = 2 * R * Math.sin(Math.PI / count);
  const rr = chord * bulge;
  let d = `M${xy(pt(0))}`;
  for (let i = 1; i <= count; i++) d += `A${n(rr)} ${n(rr)} 0 0 1 ${xy(pt(i % count))}`;
  return d + "Z";
}

/** Crescent: circle 1 minus circle 2 (the two circles must overlap). */
function crescentD(c1: Pt, R: number, c2: Pt, r: number): string {
  const dx = c2[0] - c1[0];
  const dy = c2[1] - c1[1];
  const d = Math.hypot(dx, dy);
  const a = (R * R - r * r + d * d) / (2 * d);
  const h = Math.sqrt(R * R - a * a);
  const mx = c1[0] + (a * dx) / d;
  const my = c1[1] + (a * dy) / d;
  const p1: Pt = [mx + (h * dy) / d, my - (h * dx) / d];
  const p2: Pt = [mx - (h * dy) / d, my + (h * dx) / d];
  return `M${xy(p1)}A${n(R)} ${n(R)} 0 ${a > 0 ? 1 : 0} 0 ${xy(p2)}A${n(r)} ${n(r)} 0 ${d < a ? 1 : 0} 1 ${xy(p1)}Z`;
}

/** A dot made of a zero-length round-capped stroke (very compact for stipple textures). */
const dot = (x: number, y: number): string => `M${Math.round(x)} ${Math.round(y)}h.1`;

/** (the name comes from the catalog by id, see graphics.ts) */
const def = (id: string, category: GraphicCategory, tags: string, markup: string, kind: "illustration" | "sticker" = "illustration"): GraphicDraft => ({
  id,
  category,
  tags: tags.split(" "),
  svg: markup,
  kind,
});

/* ------------------------------------------------------------------------------------------ *
 *  ABSTRACT
 * ------------------------------------------------------------------------------------------ */

const blob = (pts: Pt[], color: string): string => svg(200, 200, fp(smooth(fit(pts, 200, 200, 10), true), color));

/** Two-tone blob: a pale shadow silhouette offset behind the main one. */
const blob2 = (pts: Pt[], back: string, front: string): string => {
  const a = fit(pts, 190, 190, 10);
  const shifted = a.map((p) => [p[0] + 10, p[1] + 10] as Pt);
  return svg(200, 200, fp(smooth(shifted, true), back) + fp(smooth(a, true), front));
};

const bean: Pt[] = [
  [30, 96], [44, 54], [86, 34], [132, 40], [168, 66], [176, 108], [150, 128], [120, 122],
  [104, 138], [116, 164], [86, 178], [48, 164], [30, 130],
];
const leafDrop: Pt[] = [
  [178, 22], [176, 60], [164, 108], [134, 152], [92, 178], [50, 172], [26, 140], [32, 98], [58, 64], [98, 42], [140, 28],
];

const wavyStripes = (): string => {
  let d = "";
  [26, 56, 86, 116, 146, 176].forEach((y) => {
    d += `M14 ${y}q17 -22 34 0` + "t34 0".repeat(4);
  });
  return svg(200, 200, g(ink("#4361ee", 10), `<path d="${d}"/>`));
};

const sunburst = (): string => {
  const N = 16;
  const r0 = 20;
  const R = 94;
  const p = (r: number, a: number): string => `${n(100 + Math.cos(a) * r)} ${n(100 + Math.sin(a) * r)}`;
  let d = "";
  for (let i = 0; i < N; i++) {
    const a0 = (i / N) * TAU;
    const a1 = a0 + (TAU / N) * 0.5;
    d += `M${p(r0, a0)}L${p(R, a0)}A${R} ${R} 0 0 1 ${p(R, a1)}L${p(r0, a1)}A${r0} ${r0} 0 0 0 ${p(r0, a0)}Z`;
  }
  return svg(200, 200, fp(d, "#ffb703"));
};

const rings = (): string =>
  svg(
    200,
    200,
    g(
      ink("#6c5ce7", 7),
      `<circle cx="100" cy="100" r="95" stroke-width="3"/><circle cx="100" cy="100" r="84"/>` +
        `<circle cx="100" cy="100" r="65" stroke-width="13"/><circle cx="100" cy="100" r="46"/>` +
        `<circle cx="100" cy="100" r="29" stroke-width="13"/><circle cx="100" cy="100" r="10" fill="#6c5ce7"/>`,
    ),
  );

const overlapCircles = (): string => {
  // translucent discs (overlaps blend) plus a fine inner ring of the same hue
  const c = (cx: number, cy: number, col: string): string =>
    `<circle cx="${cx}" cy="${cy}" r="54" fill="${col}" fill-opacity=".72"/>` +
    g(ink(col, 3), `<circle cx="${cx}" cy="${cy}" r="45"/>`);
  return svg(220, 200, c(80, 78, "#ff6b6b") + c(140, 78, "#ffd43b") + c(110, 130, "#339af0"));
};

const archesNested = (): string => {
  const arch = (x: number, w: number, top: number): string => {
    const r = w / 2;
    return `M${x} 186V${top + r}A${r} ${r} 0 0 1 ${x + w} ${top + r}V186Z`;
  };
  // a row of small cream beads follows the outer band
  let beads = "";
  for (let i = 0; i <= 10; i++) {
    const a = Math.PI + (i / 10) * Math.PI;
    beads += dot(100 + Math.cos(a) * 68, 94 + Math.sin(a) * 68);
  }
  for (const y of [118, 142, 166]) beads += dot(32, y) + dot(168, y);
  return svg(
    200,
    200,
    fp(arch(20, 160, 14), "#c8684b") + fp(arch(44, 112, 38), "#e29a76") + fp(arch(68, 64, 62), "#f4dcc0") + fp(arch(92, 16, 86), "#9bab8c") +
      g(ink("#f4dcc0", 5), `<path d="${beads}"/>`),
  );
};

const bauhaus = (): string => {
  const Y = "#f6c344";
  const N = "#1f3a68";
  const R = "#e4572e";
  const C = "#f2e9d8";
  // four 96px tiles inset by 4, outer corners softened
  return svg(
    200,
    200,
    fp("M4 100V20Q4 4 20 4H100V100Z", Y) +
      fp("M100 4H180Q196 4 196 20V100H100Z", R) +
      fp("M4 100H100V196H20Q4 196 4 180Z", C) +
      fp("M100 100H196V180Q196 196 180 196H100Z", N) +
      fp("M12 100A40 40 0 0 1 92 100Z", N) +
      fp("M100 100V30A70 70 0 0 1 170 100Z", C) +
      circ(52, 148, 32, R) +
      fp("M196 108A40 40 0 0 0 196 188Z", Y),
  );
};

/** Disc of horizontal stripes, built from round-capped lines (no clipping needed). */
const stripedDisc = (cx: number, cy: number, r: number, gap: number, w: number): string => {
  let d = "";
  for (let y = -r + w; y <= r - w + 0.01; y += gap) {
    const hx = Math.max(0, Math.sqrt(r * r - y * y) - w / 2);
    d += `M${n(cx - hx)} ${n(cy + y)}H${n(cx + hx)}`;
  }
  return `<path d="${d}"/>`;
};

const memphisA = (): string => {
  const NAVY = "#1b2a6b";
  const PINK = "#ff5d8f";
  const YEL = "#ffd23f";
  const MINT = "#3bceac";
  const PUR = "#7b4bff";
  return svg(
    240,
    200,
    g(ink(NAVY, 6), `<path d="M14 34q8 -14 16 0t16 0t16 0"/>`) +
      g(ink(PINK, 6), `<path d="M200 14L222 54H178Z"/><path d="M98 170l11 -16l11 16l11 -16l11 16l11 -16"/>`) +
      circ(40, 100, 20, YEL) +
      circ(100, 34, 5, YEL) + circ(120, 34, 5, YEL) + circ(140, 34, 5, YEL) +
      g(ink(MINT, 7), `<path d="M120 84V116M104 100H136"/>`) +
      fp("M178 116A22 22 0 0 1 222 116Z", PUR) +
      g(`fill="${NAVY}"`, [0, 1, 2].map((i) => [0, 1, 2].map((j) => `<circle cx="${22 + i * 16}" cy="${150 + j * 16}" r="3.2"/>`).join("")).join("")) +
      fp("M200 146L222 184H178Z", MINT),
  );
};

const memphisB = (): string => {
  const OR = "#ff7b54";
  const PE = "#ffb26b";
  const INK = "#2f4858";
  const SAGE = "#86a873";
  const PK = "#f4a5b8";
  return svg(
    240,
    200,
    g(ink(OR, 5), stripedDisc(44, 40, 26, 9, 5)) +
      g(ink(INK, 7), `<circle cx="120" cy="40" r="17"/>`) +
      g(ink(PK, 6), `<path d="M172 40q7 -13 14 0t14 0t14 0"/>`) +
      `<path d="M26 128L58 74L74 128Z" fill="${PE}"/>` +
      g(ink(INK, 4), `<path d="M34 136L66 82L82 136Z"/>`) +
      g(ink(SAGE, 11), `<path d="M92 126A28 28 0 0 1 148 126"/>`) +
      g(ink(INK, 4), `<path d="M168 84L190 62M168 100L212 56M176 112L218 70M196 114L218 92"/>`) +
      g(`fill="${INK}"`, [0, 1, 2, 3, 4].map((i) => `<circle cx="${24 + i * 15}" cy="172" r="3.6"/>`).join("")) +
      g(ink(PK, 6), `<path d="M122 156V184M108 170H136"/>`) +
      g(ink(SAGE, 6), `<path d="M168 184l11 -18l11 18l11 -18l11 18"/>`) +
      fp("M164 150A18 18 0 0 1 200 150Z", OR) + circ(222, 152, 5, PE),
  );
};

/**
 * Grain texture: rows of irregular round dots (zero-length dashes with round caps) laid along
 * direction `ang` and kept inside `inside(x, y)`. Cheap in bytes, noise-like when rows cross.
 */
function speckle(
  color: string, w: number, gaps: number[], step: number, ang: number,
  inside: (x: number, y: number) => boolean, W: number, H: number, rnd: () => number,
): string {
  const pattern = gaps.flatMap((gap) => [0, gap]).join(" ");
  const total = gaps.reduce((a, b) => a + b, 0);
  const diag = Math.hypot(W, H);
  let d = "";
  for (let s = -diag / 2 + rnd() * step; s < diag / 2; s += step * (0.75 + rnd() * 0.5)) {
    const a = ang + (rnd() - 0.5) * 0.12;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const px = W / 2 - dy * s;
    const py = H / 2 + dx * s;
    let u0: number | null = null;
    let u1 = 0;
    for (let u = -diag / 2; u <= diag / 2; u += 1.5) {
      if (inside(px + dx * u, py + dy * u)) {
        if (u0 === null) u0 = u;
        u1 = u;
      }
    }
    if (u0 === null || u1 - u0 < 10) continue;
    const us = u0 + rnd() * Math.min(total, u1 - u0 - 6);
    d += `M${Math.round(px + dx * us)} ${Math.round(py + dy * us)}L${Math.round(px + dx * u1)} ${Math.round(py + dy * u1)}`;
  }
  return `<path d="${d}" ${ink(color, w)} stroke-dasharray="${pattern}"/>`;
}

/** Linear gradient definition (diagonal or vertical). */
const gradient = (id: string, c0: string, c1: string, vertical = false): string =>
  `<defs><linearGradient id="${id}" x1="0" y1="0" x2="${vertical ? 0 : 1}" y2="1"><stop offset="0" stop-color="${c0}"/><stop offset="1" stop-color="${c1}"/></linearGradient></defs>`;

const grainOrb = (): string => {
  const rnd = rng(9);
  const inOrb = (x: number, y: number): boolean => Math.hypot(x - 100, y - 100) < 85;
  const t = (x: number, y: number): number => (x + y) / 400;
  return svg(
    200,
    200,
    gradient("ga-grain-orb", "#ffe2b0", "#ff7b9c") +
      `<path d="M100 10a90 90 0 1 0 .1 0Z" fill="url(#ga-grain-orb)"/>` +
      speckle("#e03e6b", 2, [8, 13, 6, 10, 15, 7], 5, 0, (x, y) => inOrb(x, y) && t(x, y) > 0.38, 200, 200, rnd) +
      speckle("#e03e6b", 2, [9, 12, 7, 14], 5.4, 1.05, (x, y) => inOrb(x, y) && t(x, y) > 0.5, 200, 200, rnd) +
      speckle("#fff2d6", 2, [9, 14, 7, 11, 16], 5.2, 2.1, (x, y) => inOrb(x, y) && t(x, y) < 0.62, 200, 200, rnd) +
      speckle("#fff2d6", 1.8, [10, 16, 8], 5.8, 0.55, (x, y) => inOrb(x, y) && t(x, y) < 0.42, 200, 200, rnd),
  );
};

const grainArch = (): string => {
  const rnd = rng(31);
  const inArch = (x: number, y: number): boolean =>
    x > 33 && x < 167 && y < 226 && (y > 98 || Math.hypot(x - 100, y - 98) < 67);
  const t = (_x: number, y: number): number => y / 240;
  return svg(
    200,
    240,
    gradient("ga-grain-arch", "#cdbdff", "#59d8c9", true) +
      `<path d="M26 232V98A74 74 0 0 1 174 98V232Z" fill="url(#ga-grain-arch)"/>` +
      speckle("#3f6fd0", 2, [8, 13, 6, 10, 15, 7], 5, 0, (x, y) => inArch(x, y) && t(x, y) > 0.4, 200, 240, rnd) +
      speckle("#3f6fd0", 2, [9, 12, 7, 14], 5.4, 1.05, (x, y) => inArch(x, y) && t(x, y) > 0.55, 200, 240, rnd) +
      speckle("#f3efff", 2, [9, 14, 7, 11, 16], 5.2, 2.1, (x, y) => inArch(x, y) && t(x, y) < 0.6, 200, 240, rnd) +
      speckle("#f3efff", 1.8, [10, 16, 8], 5.8, 0.55, (x, y) => inArch(x, y) && t(x, y) < 0.4, 200, 240, rnd),
  );
};

const ABSTRACT: GraphicDraft[] = [
  def("abstract-blob-1", "abstract", "blob organic shape pebble fluid",
    blob(blobPts([{ k: 2, a: 0.07, p: 0.4 }, { k: 3, a: 0.09, p: 1.3 }, { k: 5, a: 0.035, p: 2.2 }]), "#ff8a65")),
  def("abstract-blob-2", "abstract", "blob egg oval organic shape",
    blob(blobPts([{ k: 2, a: 0.08, p: 0 }, { k: 3, a: 0.07, p: 2.1 }], 0.8, 1, 14, -0.25), "#7c83fd")),
  def("abstract-blob-3", "abstract", "blob triangle organic shape fluid",
    blob(blobPts([{ k: 3, a: 0.17, p: 0.5 }, { k: 2, a: 0.05, p: 1 }]), "#2ec4b6")),
  def("abstract-blob-4", "abstract", "blob flower clover petal shape",
    blob(blobPts([{ k: 5, a: 0.15, p: 0 }, { k: 2, a: 0.04, p: 0.7 }], 1, 1, 20), "#ffc857")),
  def("abstract-blob-5", "abstract", "blob bean kidney organic shape",
    blob(bean, "#f78fb3")),
  def("abstract-blob-6", "abstract", "blob leaf drop teardrop organic shape",
    blob(leafDrop, "#8e7cf0")),
  def("abstract-blob-7", "abstract", "blob wobble layered shadow shape",
    blob2(blobPts([{ k: 6, a: 0.07, p: 0.3 }, { k: 3, a: 0.1, p: 2 }, { k: 2, a: 0.05, p: 0 }], 1, 1, 18), "#bde7c9", "#4cb782")),
  def("abstract-blob-8", "abstract", "blob pillow layered shadow shape",
    blob2(blobPts([{ k: 4, a: 0.1, p: 0.2 }, { k: 2, a: 0.08, p: 1.4 }, { k: 7, a: 0.03, p: 0 }], 1.05, 0.85, 18), "#ffd9a0", "#ff7a59")),
  def("abstract-overlap-circles", "abstract", "circles overlap venn trio transparent",
    overlapCircles()),
  def("abstract-arches", "abstract", "arch rainbow boho nested warm",
    archesNested()),
  def("abstract-bauhaus-tiles", "abstract", "bauhaus half-circle geometric tiles quarter",
    bauhaus()),
  def("abstract-wavy-stripes", "abstract", "wavy stripes lines waves pattern",
    wavyStripes()),
  def("abstract-sunburst", "abstract", "sunburst rays retro radial burst",
    sunburst()),
  def("abstract-concentric-rings", "abstract", "rings concentric circles target ripple",
    rings()),
  def("abstract-memphis-bold", "abstract", "memphis squiggle triangle shapes 80s",
    memphisA()),
  def("abstract-memphis-warm", "abstract", "memphis stripes hatch shapes retro",
    memphisB()),
  def("abstract-grain-sunrise", "abstract", "grain gradient noise orb sunrise",
    grainOrb()),
  def("abstract-grain-arch", "abstract", "grain gradient arch noise boho",
    grainArch()),
];

/* ------------------------------------------------------------------------------------------ *
 *  NATURE
 * ------------------------------------------------------------------------------------------ */

/** Ellipse, optionally rotated about its own centre (rotated ones become arc paths, no transform needed). */
const ell = (cx: number, cy: number, rx: number, ry: number, deg = 0, fill = ""): string => {
  const f = fill ? ` fill="${fill}"` : "";
  if (!deg) return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}"${f}/>`;
  const dx = Math.cos(rad(deg)) * rx;
  const dy = Math.sin(rad(deg)) * rx;
  const arc = `A${n(rx)} ${n(ry)} ${n(deg)} 1 0`;
  return `<path d="M${n(cx - dx)} ${n(cy - dy)}${arc} ${n(cx + dx)} ${n(cy + dy)}${arc} ${n(cx - dx)} ${n(cy - dy)}Z"${f}/>`;
};

const monstera = (): string => {
  const DK = "#2a8f62";
  const LT = "#46b884";
  const VN = "#14573a";
  // heart-shaped envelope: radius from the leaf centre by angle (0 = apex, 180 = stem notch)
  const table: Array<[number, number]> = [
    [0, 90], [10, 79], [22, 74], [40, 73], [60, 72], [80, 74], [100, 77], [120, 77], [140, 72], [156, 60], [168, 44], [176, 34], [180, 30],
  ];
  const rho = (phi: number): number => {
    for (let i = 1; i < table.length; i++) {
      if (phi <= table[i][0]) {
        const [p0, r0] = table[i - 1];
        const [p1, r1] = table[i];
        return r0 + ((r1 - r0) * (phi - p0)) / (p1 - p0);
      }
    }
    return table[table.length - 1][1];
  };
  const P = (phi: number, r: number): Pt => [100 + Math.sin(rad(phi)) * r, 102 - Math.cos(rad(phi)) * r];
  const slits = [26, 52, 78, 104, 130];
  const half = 5.2; // half angular width of a slit where it meets the margin
  const pts: Pt[] = [P(0, rho(0))];
  let phi = 0;
  for (const sl of slits) {
    for (let a = phi + 6; a < sl - half; a += 6) pts.push(P(a, rho(a)));
    pts.push(P(sl - half, rho(sl - half)), P(sl, rho(sl) * 0.36), P(sl + half, rho(sl + half)));
    phi = sl + half;
  }
  for (let a = phi + 6; a < 180; a += 6) pts.push(P(a, rho(a)));
  pts.push(P(180, rho(180)));
  const body = `<path d="${polyD(pts)}" fill="CLR" stroke="CLR" stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>`;
  // veins run from the midrib to the middle of each lobe; holes sit beside the midrib
  const bounds = [0, ...slits, 180];
  let veins = "";
  let holes = "";
  for (let i = 0; i < bounds.length - 1; i++) {
    const pc = (bounds[i] + bounds[i + 1]) / 2;
    const v = P(pc, rho(pc) * 0.8);
    const m: Pt = [100, v[1] + (v[0] - 100) * 0.5];
    veins += `M${xy(m)}L${xy(v)}`;
    if (i > 0 && i < bounds.length - 2) {
      const h = P(pc, rho(pc) * 0.27);
      holes += ell(h[0], h[1], 2.8, 6.4, pc);
    }
  }
  return svg(
    200,
    200,
    sp("M100 126C100 150 98 176 88 192", VN, 6.5) +
      body.replace(/CLR/g, DK) +
      mirror(200, body.replace(/CLR/g, LT)) +
      g(`fill="${VN}"`, holes + mirror(200, holes)) +
      g(ink(VN, 3), `<path d="M100 8V128${veins}"/>` + mirror(200, `<path d="${veins}"/>`)),
  );
};

const fern = (): string => {
  const q: Quad = { a: [86, 194], c: [62, 104], b: [122, 26] };
  const N = 15;
  let left = "";
  let right = "";
  for (let i = 0; i < N; i++) {
    const t = 0.1 + (0.86 * i) / (N - 1);
    const [x, y] = qAt(q, t);
    const ang = qAng(q, t);
    const len = 12 + 38 * Math.pow(1 - t, 0.6) * Math.min(1, (t + 0.12) * 3.2);
    const spread = rad(66 - 26 * t);
    left += lensD(x, y, ang - spread, len, len * 0.2);
    right += lensD(x, y, ang + spread, len, len * 0.2);
  }
  const tip = qAt(q, 1);
  return svg(
    200,
    200,
    mv(
      13,
      0,
      sp(qD(q), "#1f5a3e", 4.5) + fp(left + lensD(tip[0], tip[1], qAng(q, 1), 20, 4.5), "#46b07a") + fp(right, "#2c8260"),
    ),
  );
};

const branch = (): string => {
  const q: Quad = { a: [24, 182], c: [44, 78], b: [166, 36] };
  const GL = "#6a994e";
  const GD = "#a7c957";
  let l1 = "";
  let l2 = "";
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = 0.14 + (0.74 * i) / (N - 1);
    const [x, y] = qAt(q, t);
    const s = i % 2 ? 1 : -1;
    const len = 44 - 14 * t;
    const d = leafD(x, y, qAng(q, t) + s * rad(48), len, 10.5 - 2 * t);
    if (s > 0) l1 += d;
    else l2 += d;
  }
  const tip = qAt(q, 1);
  let berries = "";
  for (const t of [0.3, 0.52, 0.72]) {
    const [x, y] = qAt(q, t);
    const a = qAng(q, t) - rad(95);
    berries += circ(x + Math.cos(a) * 10, y + Math.sin(a) * 10, 5.5, "#e76f51");
  }
  return svg(
    200,
    200,
    sp(qD(q), "#8b6b4a", 4.5) + fp(l1, GL) + fp(l2 + leafD(tip[0], tip[1], qAng(q, 1), 26, 8), GD) + berries,
  );
};

const sun = (): string => {
  let rays = "";
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * TAU;
    const r1 = 62;
    const r2 = i % 2 ? 78 : 90;
    rays += `M${n(100 + Math.cos(a) * r1)} ${n(100 + Math.sin(a) * r1)}L${n(100 + Math.cos(a) * r2)} ${n(100 + Math.sin(a) * r2)}`;
  }
  return svg(
    200,
    200,
    g(ink("#ff9f1c", 9), `<path d="${rays}"/>`) + circ(100, 100, 46, "#ffc233") + circ(100, 100, 32, "#ffd96b"),
  );
};

const moonStars = (): string => {
  const MOON = "#ffd166";
  const SPARK = "#7c83fd";
  return svg(
    200,
    200,
    fp(crescentD([86, 104], 66, [118, 88], 54), MOON) +
      circ(50, 112, 6, "#f2b84b") + circ(66, 150, 4.5, "#f2b84b") + circ(60, 78, 3.5, "#f2b84b") +
      fp(sparkleD(150, 56, 22), SPARK) + fp(sparkleD(168, 132, 13), SPARK) + fp(sparkleD(120, 24, 9), MOON) +
      circ(176, 92, 3.5, MOON) + circ(128, 156, 3, SPARK) + circ(24, 50, 3, SPARK),
  );
};

/** Cloud silhouette (union of a rounded base and three puffs) centred on (cx, cy) at scale s. */
const cloudShape = (cx: number, cy: number, s: number, fill: string): string =>
  `<g fill="${fill}"><rect x="${n(cx - 58 * s)}" y="${n(cy + 4 * s)}" width="${n(116 * s)}" height="${n(28 * s)}" rx="${n(14 * s)}"/>` +
  `<circle cx="${n(cx - 30 * s)}" cy="${n(cy + 6 * s)}" r="${n(20 * s)}"/><circle cx="${n(cx + 4 * s)}" cy="${n(cy - 8 * s)}" r="${n(28 * s)}"/>` +
  `<circle cx="${n(cx + 36 * s)}" cy="${n(cy + 8 * s)}" r="${n(18 * s)}"/></g>`;

const clouds = (): string => {
  const FRONT = "#cfe2ff";
  const SHADE = "#9dbdf0";
  const BACK = "#e4eeff";
  return svg(
    240,
    160,
    cloudShape(52, 54, 0.62, SHADE) + cloudShape(52, 49, 0.62, BACK) +
      cloudShape(196, 62, 0.58, SHADE) + cloudShape(196, 57, 0.58, BACK) +
      cloudShape(122, 98, 1.3, SHADE) + cloudShape(122, 89, 1.3, FRONT),
  );
};

/** Snow cap for a mountain peak: apex A, neighbours Lp / Rp, f = how far down the slopes it reaches. */
function snowCap(A: Pt, Lp: Pt, Rp: Pt, f: number): string {
  const l: Pt = [A[0] + (Lp[0] - A[0]) * f, A[1] + (Lp[1] - A[1]) * f];
  const r: Pt = [A[0] + (Rp[0] - A[0]) * f, A[1] + (Rp[1] - A[1]) * f];
  const depth = (r[0] - l[0]) * 0.2;
  let d = `M${xy(A)}L${xy(l)}`;
  for (let i = 1; i <= 5; i++) {
    const u = i / 6;
    d += `L${n(l[0] + (r[0] - l[0]) * u)} ${n(l[1] + (r[1] - l[1]) * u + (i % 2 ? depth : -depth * 0.2))}`;
  }
  return d + `L${xy(r)}Z`;
}

const mountains = (): string =>
  svg(
    240,
    160,
    mv(0, -7, circ(182, 38, 17, "#ffc9a3") +
      fp("M4 118L44 76L82 112L130 90L152 68L196 112L222 92L236 106V156H4Z", "#c3cdfa") +
      fp("M4 140L50 98L70 114L112 54L158 126L190 102L236 136V156H4Z", "#8d9cf0") +
      fp(snowCap([112, 54], [70, 114], [158, 126], 0.3), "#f4f6ff") +
      fp(snowCap([44, 76], [4, 118], [82, 112], 0.3), "#f4f6ff") +
      fp(snowCap([152, 68], [130, 90], [196, 112], 0.3), "#f4f6ff") +
      fp("M4 156L40 134L84 150L130 128L176 152L214 138L236 148V156Z", "#4f5fd0")),
  );

const daisy = (): string => {
  let petals = "";
  for (let k = 0; k < 11; k++) {
    const a = (k / 11) * 360;
    const r = rad(a);
    petals += ell(100 + Math.sin(r) * 36, 78 - Math.cos(r) * 36, 12, 27, a);
  }
  let seeds = "";
  for (let k = 0; k < 7; k++) {
    const r = rad(k * 51.4);
    seeds += `<circle cx="${n(100 + Math.cos(r) * 9)}" cy="${n(78 + Math.sin(r) * 9)}" r="2.2"/>`;
  }
  return svg(
    200,
    240,
    sp("M100 120C98 160 106 196 100 232", "#4d9962", 7) +
      fp(leafD(99, 190, rad(-150), 46, 11), "#5fb078") + fp(leafD(102, 206, rad(-30), 38, 9.5), "#4d9962") +
      g('fill="#ff8fab"', petals) + circ(100, 78, 21, "#ffc233") + g('fill="#e8962a"', seeds + `<circle cx="100" cy="78" r="2.4"/>`),
  );
};

const cactus = (): string => {
  const G = "#3d9a6b";
  const GL = "#7ad3a0";
  const POT = "#d9825b";
  const RIM = "#bf6642";
  return svg(
    200,
    240,
    mv(0, -12, g(ink(G, 40), `<path d="M100 170V74"/>`) +
      g(ink(G, 20), `<path d="M118 138H138V106"/><path d="M82 118H62V92"/>`) +
      g(ink(GL, 3), `<path d="M92 66V160M108 66V160M138 112V132M62 98V110"/>`) +
      g(ink("#ff8fab", 13), `<path d="M100 46h.1"/>`) +
      fp("M62 176H138L129 226Q128 232 122 232H78Q72 232 71 226Z", POT) +
      `<rect x="54" y="164" width="92" height="18" rx="7" fill="${RIM}"/>`),
  );
};

const pine = (cx: number, base: number, s: number, c0: string, c1: string, c2: string, trunk: string): string => {
  const tier = (apexY: number, w: number, h: number, fill: string): string =>
    `<path d="M${n(cx)} ${n(apexY)}L${n(cx + w)} ${n(apexY + h)}H${n(cx - w)}Z" fill="${fill}" stroke="${fill}" stroke-width="${n(8 * s)}" stroke-linecap="round" stroke-linejoin="round"/>`;
  return (
    `<rect x="${n(cx - 7 * s)}" y="${n(base - 30 * s)}" width="${n(14 * s)}" height="${n(34 * s)}" rx="${n(3 * s)}" fill="${trunk}"/>` +
    tier(base - 112 * s, 48 * s, 66 * s, c2) +
    tier(base - 84 * s, 40 * s, 50 * s, c1) +
    tier(base - 138 * s, 28 * s, 46 * s, c0)
  );
};

const pines = (): string =>
  svg(
    200,
    200,
    mv(
      0,
      -22,
      `<ellipse cx="100" cy="188" rx="86" ry="7" fill="#cfe8d5"/>` +
        pine(138, 186, 0.66, "#52b788", "#40916c", "#2d6a4f", "#8a5a3c") +
        pine(70, 186, 0.96, "#52b788", "#40916c", "#2d6a4f", "#8a5a3c"),
    ),
  );

const wheat = (): string => {
  const C = "#d4a03c";
  const stalk = (q: Quad, awns: boolean): string => {
    let grains = "";
    let aw = "";
    const N = 5;
    for (let i = 0; i < N; i++) {
      const t = 0.58 + (0.38 * i) / (N - 1);
      const [x, y] = qAt(q, t);
      const a = qAng(q, t);
      grains += lensD(x, y, a - rad(34), 26, 5.2) + lensD(x, y, a + rad(34), 26, 5.2);
      if (awns) aw += `M${n(x + Math.cos(a - rad(34)) * 22)} ${n(y + Math.sin(a - rad(34)) * 22)}l${n(Math.cos(a - rad(20)) * 12)} ${n(Math.sin(a - rad(20)) * 12)}M${n(x + Math.cos(a + rad(34)) * 22)} ${n(y + Math.sin(a + rad(34)) * 22)}l${n(Math.cos(a + rad(20)) * 12)} ${n(Math.sin(a + rad(20)) * 12)}`;
    }
    const e = qAt(q, 1);
    return sp(qD(q), C, 4) + fp(grains + lensD(e[0], e[1], qAng(q, 1), 28, 5.4), C) + (aw ? sp(aw, C, 3.2) : "");
  };
  return svg(
    200,
    240,
    stalk({ a: [96, 236], c: [70, 150], b: [52, 66] }, false) +
      stalk({ a: [104, 236], c: [130, 150], b: [148, 66] }, false) +
      stalk({ a: [100, 236], c: [94, 130], b: [102, 36] }, true),
  );
};

const rainbow = (): string => {
  const bands = ["#ef476f", "#ffa94d", "#ffd23f", "#2bb99a"];
  let arcs = "";
  bands.forEach((c, i) => {
    const r = 94 - i * 17;
    arcs += `<path d="M${120 - r} 132A${r} ${r} 0 0 1 ${120 + r} 132" fill="none" stroke="${c}" stroke-width="17"/>`;
  });
  return svg(
    240,
    160,
    g('stroke-linecap="round" stroke-linejoin="round"', arcs) +
      cloudShape(34, 118, 0.56, "#d9e6ff") + cloudShape(206, 118, 0.56, "#d9e6ff"),
  );
};

const wave = (): string => {
  const crest1 = "M6 58C34 30 66 30 94 54S154 82 182 54 218 36 234 48";
  const crest2 = "M6 82C36 54 70 56 100 80S158 106 188 80 222 66 234 74";
  return svg(
    240,
    114,
    mv(
      0,
      -18,
      fp(`${crest1}V122H6Z`, "#90e0ef") + sp(crest1, "#ffffff", 4) +
        fp(`${crest2}V122H6Z`, "#48cae4") + sp(crest2, "#ffffff", 4) +
        fp("M6 104C40 80 74 82 104 102S160 120 190 102 220 94 234 98V122H6Z", "#0096c7"),
    ),
  );
};

const tulips = (): string => {
  const PINK = "#ff5d7a";
  const PINK_L = "#ff9aab";
  const STEM = "#3f9d6b";
  const LEAF = "#5fb078";
  const head = (cx: number, cy: number, s: number): string =>
    `<g transform="translate(${n(cx)} ${n(cy)}) scale(${s})">` +
    fp("M-23 -26L-12 -10L0 -31L12 -10L23 -26C28 8 15 30 0 30C-15 30 -28 8 -23 -26Z", PINK) +
    fp("M-12 -10L0 -31L12 -10C17 10 8 27 0 30C-8 27 -17 10 -12 -10Z", PINK_L) +
    `</g>`;
  return svg(
    200,
    240,
    fp(leafD(92, 232, rad(-108), 150, 15) + leafD(108, 232, rad(-72), 140, 14), LEAF) +
      g(ink(STEM, 6), `<path d="M60 112C58 160 80 200 96 232M100 74C100 130 100 190 100 232M140 106C142 160 122 200 104 232"/>`) +
      head(60, 90, 0.82) + head(140, 84, 0.86) + head(100, 56, 1.04),
  );
};

const grass = (): string => {
  const GA = "#4fae5f";
  const GB = "#2f8a4a";
  const blade = (x0: number, tipX: number, tipY: number, bend: number, w: number): string => {
    const mx = (x0 + tipX) / 2 + bend;
    const my = (150 + tipY) / 2;
    return `M${n(x0 - w)} 152Q${n(mx - w * 0.4)} ${n(my)} ${n(tipX)} ${n(tipY)}Q${n(mx + w * 0.8)} ${n(my + 6)} ${n(x0 + w)} 152Z`;
  };
  const front =
    blade(84, 38, 56, -12, 8) + blade(96, 70, 30, -8, 9) + blade(104, 100, 16, 6, 9) + blade(112, 134, 34, 10, 9) + blade(122, 168, 60, 14, 8);
  const back = blade(70, 22, 96, -8, 7) + blade(90, 54, 54, -6, 7) + blade(118, 118, 44, 6, 7) + blade(132, 184, 98, 10, 7);
  return svg(200, 170, fp(back, GB) + fp(front, GA) + `<rect x="30" y="148" width="140" height="10" rx="5" fill="${GB}"/>`);
};

const NATURE: GraphicDraft[] = [
  def("nature-monstera", "nature", "monstera leaf tropical plant jungle", monstera()),
  def("nature-fern", "nature", "fern frond leaf forest plant", fern()),
  def("nature-olive-branch", "nature", "branch leaves olive twig berries", branch()),
  def("nature-sun", "nature", "sun sunshine summer rays weather", sun()),
  def("nature-moon-stars", "nature", "moon crescent stars night sparkle", moonStars()),
  def("nature-clouds", "nature", "clouds sky weather soft", clouds()),
  def("nature-mountains", "nature", "mountains landscape peaks snow hills", mountains()),
  def("nature-daisy", "nature", "daisy flower bloom spring floral", daisy()),
  def("nature-cactus", "nature", "cactus succulent desert plant pot", cactus()),
  def("nature-pine-trees", "nature", "pine trees forest evergreen woods", pines()),
  def("nature-wheat", "nature", "wheat grain harvest autumn grass", wheat()),
  def("nature-rainbow", "nature", "rainbow clouds sky colorful kids", rainbow()),
  def("nature-wave", "nature", "waves ocean sea water beach", wave()),
  def("nature-tulips", "nature", "tulips flowers bouquet spring floral", tulips()),
  def("nature-grass", "nature", "grass blades meadow lawn green", grass()),
];

/* ------------------------------------------------------------------------------------------ *
 *  DECOR
 * ------------------------------------------------------------------------------------------ */

const bohoArches = (): string => {
  const TERRA = "#c8684b";
  const CLAY = "#e29a76";
  const SAND = "#f2d7b6";
  const SAGE = "#9bab8c";
  const SUN = "#e5a93c";
  const arch = (x: number, w: number, top: number): string => {
    const r = w / 2;
    return `M${x} 188V${top + r}A${r} ${r} 0 0 1 ${x + w} ${top + r}V188Z`;
  };
  return svg(
    240,
    200,
    fp(arch(12, 70, 84), TERRA) + fp(arch(158, 70, 68), SAGE) +
      g(ink(SAND, 3), `<path d="M21 188V119A26 26 0 0 1 73 119V188"/><path d="M167 188V103A26 26 0 0 1 219 103V188"/>`) +
      fp(arch(68, 104, 22), CLAY) + fp(arch(90, 60, 44), SAND) + circ(120, 84, 15, SUN) +
      sp("M4 191H236", TERRA, 4),
  );
};

const driedPalm = (): string => {
  const frond = (q: Quad, N: number, maxLen: number): string => {
    let d = qD(q);
    for (let i = 0; i < N; i++) {
      const t = 0.1 + (0.86 * i) / (N - 1);
      const [x, y] = qAt(q, t);
      const a = qAng(q, t);
      const len = 12 + maxLen * Math.sin(Math.PI * (0.12 + 0.82 * t));
      const spread = rad(54 - 16 * t);
      for (const sd of [-1, 1]) d += `M${n(x)} ${n(y)}l${n(Math.cos(a + sd * spread) * len)} ${n(Math.sin(a + sd * spread) * len)}`;
    }
    return d;
  };
  return svg(
    200,
    250,
    mv(
      -8,
      10,
      g(
        ink("#b08968", 3.6),
        `<path d="${frond({ a: [96, 232], c: [40, 96], b: [150, 22] }, 16, 52)}"/>` +
          `<path d="${frond({ a: [100, 232], c: [156, 176], b: [184, 118] }, 8, 26)}"/>`,
      ),
    ),
  );
};

const sparkles = (): string =>
  svg(
    200,
    200,
    fp(sparkleD(96, 108, 66, 0.14), "#ffc233") + fp(sparkleD(96, 108, 34, 0.12), "#ffe08a") +
      fp(sparkleD(152, 48, 30, 0.15), "#ff8fab") + fp(sparkleD(42, 56, 19, 0.16), "#ffe08a") +
      circ(160, 152, 7, "#ff8fab") + circ(34, 146, 5, "#ffc233") + circ(112, 26, 4, "#ffc233"),
  );

const HEART_D = "M100 176C36 132 18 100 18 70C18 42 38 26 62 26C80 26 94 36 100 50C106 36 120 26 138 26C162 26 182 42 182 70C182 100 164 132 100 176Z";
const heart = (): string =>
  svg(
    200,
    200,
    mv(0, 8, fp(HEART_D, "#d62a4c")) + mv(0, -2, fp(HEART_D, "#ff4d6d")) +
      sp("M44 70C44 54 54 42 70 40", "#ff9fb2", 10) + circ(88, 36, 4.5, "#ffc2cf"),
  );

/** Heart centred on (0,0), about 96 wide. */
const HEART_C = "M0 42C-36 16 -48 -4 -48 -18C-48 -32 -38 -41 -25 -41C-14 -41 -5 -35 0 -26C5 -35 14 -41 25 -41C38 -41 48 -32 48 -18C48 -4 36 16 0 42Z";
const heartAt = (x: number, y: number, s: number, deg: number, fill: string, shine = ""): string =>
  `<g transform="translate(${x} ${y}) rotate(${deg}) scale(${s})"><path d="${HEART_C}" fill="${fill}"/>${
    shine ? sp("M-35 -12C-35 -22 -30 -29 -22 -31", shine, 6) : ""
  }</g>`;
const hearts = (): string =>
  svg(
    200,
    200,
    heartAt(96, 118, 1.18, -12, "#ff6b8b", "#ffd0da") + heartAt(160, 56, 0.6, 14, "#ffb3c1") +
      heartAt(44, 46, 0.46, -20, "#ff4d6d") + heartAt(162, 160, 0.36, 10, "#ffb3c1"),
  );

const confetti = (): string => {
  const rnd = rng(42);
  const COLS = ["#ff5d8f", "#ffd23f", "#3bceac", "#5b6cff", "#ff9f1c"];
  const fills: Record<string, string> = {};
  const lines: Record<string, string> = {};
  const rotPt = (cx: number, cy: number, a: number, u: number, v: number): Pt => [cx + u * Math.cos(a) - v * Math.sin(a), cy + u * Math.sin(a) + v * Math.cos(a)];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const cx = 24 + c * 38.4 + (rnd() - 0.5) * 14;
      const cy = 22 + r * 39 + (rnd() - 0.5) * 12;
      const col = COLS[(c * 2 + r * 3 + Math.floor(rnd() * 2)) % 5];
      const a = rnd() * TAU;
      const type = Math.floor(rnd() * 5);
      if (type === 0) fills[col] = (fills[col] || "") + polyD([rotPt(cx, cy, a, -5, -10), rotPt(cx, cy, a, 5, -10), rotPt(cx, cy, a, 5, 10), rotPt(cx, cy, a, -5, 10)]);
      else if (type === 1) fills[col] = (fills[col] || "") + `M${n(cx - 6.5)} ${n(cy)}a6.5 6.5 0 1 0 13 0a6.5 6.5 0 1 0 -13 0Z`;
      else if (type === 2) fills[col] = (fills[col] || "") + polyD([rotPt(cx, cy, a, 0, -12), rotPt(cx, cy, a, 10.5, 8), rotPt(cx, cy, a, -10.5, 8)]);
      else if (type === 3) lines[col] = (lines[col] || "") + smooth([rotPt(cx, cy, a, -15, 0), rotPt(cx, cy, a, -5, -6.5), rotPt(cx, cy, a, 5, 6.5), rotPt(cx, cy, a, 15, 0)], false);
      else lines[col] = (lines[col] || "") + `M${xy(rotPt(cx, cy, a, -8, 0))}L${xy(rotPt(cx, cy, a, 8, 0))}M${xy(rotPt(cx, cy, a, 0, -8))}L${xy(rotPt(cx, cy, a, 0, 8))}`;
    }
  }
  let body = "";
  for (const col of COLS) {
    if (fills[col]) body += fp(fills[col], col);
    if (lines[col]) body += sp(lines[col], col, 4.2);
  }
  return svg(240, 200, body);
};

const bow = (): string => {
  const R1 = "#ff6b9d";
  const R2 = "#e0457b";
  const R3 = "#ff9bbd";
  const half =
    fp("M98 82C80 34 30 16 17 52C8 84 52 112 98 92Z", R1) +
    sp("M96 87C74 62 50 54 30 60", R2, 3.4) +
    fp("M94 98L52 158L72 153L84 168L112 106Z", R2);
  return svg(200, 180, mv(0, -6, half + mirror(200, half) + `<rect x="82" y="66" width="36" height="40" rx="13" fill="${R3}"/>` + sp("M92 76V96", R1, 3.4)));
};

const washiTape = (fill: string, mark: string, pattern: "stripes" | "dots"): string => {
  const x0 = 16;
  const x1 = 224;
  const y0 = 26;
  const y1 = 74;
  const tooth = 5;
  const pts: Pt[] = [[x0, y0]];
  for (let i = 0; i <= 6; i++) pts.push([x1 - (i % 2 ? tooth : 0), y0 + (i * (y1 - y0)) / 6]);
  for (let i = 6; i >= 0; i--) pts.push([x0 + (i % 2 ? tooth : 0), y0 + (i * (y1 - y0)) / 6]);
  let pat = "";
  if (pattern === "stripes") {
    for (let x = 30; x + 44 < 212; x += 19) pat += `M${x} ${y1 - 5}L${x + 38} ${y0 + 5}`;
    pat = sp(pat, mark, 7);
  } else {
    let d = "";
    for (let row = 0; row < 3; row++) {
      for (let x = 34 + (row % 2) * 9; x < 208; x += 18) d += dot(x, 38 + row * 12);
    }
    pat = sp(d, mark, 7.5);
  }
  return svg(240, 100, rot(-7, 120, 50, fp(polyD(pts), fill) + pat));
};

const paperclip = (): string => {
  const wire = "M64 84V130A11 11 0 0 1 42 130V54A28 28 0 0 1 98 54V150A39 39 0 0 1 20 150V96";
  return svg(160, 200, mv(21, -7, rot(24, 59, 107, sp(wire, "#4c5fd5", 9) + sp(wire, "#a3b1ff", 3))));
};

const pushpin = (): string =>
  svg(
    200,
    220,
    mv(0, -12, rot(
      28,
      100,
      120,
      fp("M95 150H105L100 200Z", "#8d99ae") +
        `<rect x="50" y="130" width="100" height="20" rx="10" fill="#d63a52"/>` +
        fp("M66 134V86Q66 62 90 62H110Q134 62 134 86V134Z", "#ff5d73") +
        fp("M118 63Q134 68 134 88V134H116Z", "#d63a52") +
        sp("M80 80V118", "#ff9aa8", 8),
    )),
  );

const starSticker = (): string => {
  const pts = starPts(100, 104, 78, 38, 5);
  const body = (fill: string): string =>
    `<path d="${polyD(pts)}" fill="${fill}" stroke="${fill}" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/>`;
  return svg(200, 200, mv(0, 7, body("#f0a30a")) + mv(0, -1, body("#ffd23f")) + fp(sparkleD(70, 78, 14, 0.14), "#fff3b8"));
};

const confettiDots = (): string => {
  const rnd = rng(77);
  const COLS = ["#ff8fab", "#ffd166", "#7fdbb6", "#a78bfa", "#6ec6ff"];
  const groups: Record<string, string> = {};
  let k = 0;
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 6; c++) {
      const cx = 24 + c * 38.4 + (rnd() - 0.5) * 16;
      const cy = 22 + r * 39 + (rnd() - 0.5) * 14;
      const col = COLS[(c + r * 2 + k++) % 5];
      const rr = 4 + rnd() * 6;
      groups[col] = (groups[col] || "") + `<circle cx="${n(cx)}" cy="${n(cy)}" r="${n(rr)}"/>`;
    }
  }
  return svg(240, 200, COLS.map((col) => g(`fill="${col}"`, groups[col] || "")).join(""));
};

const curlyRibbons = (): string => {
  const strand = (x0: number, amp: number, turns: number, len: number): string => {
    const pts: Pt[] = [];
    const N = 26;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      pts.push([x0 + amp * (0.35 + 0.65 * t) * Math.sin(TAU * turns * Math.pow(t, 1.35)), 20 + len * Math.pow(t, 0.92)]);
    }
    return smooth(pts, false);
  };
  return svg(
    200,
    220,
    sp(strand(52, 24, 3.2, 170), "#ff6b9d", 8) + sp(strand(100, 26, 3.6, 188), "#ffc233", 8) + sp(strand(148, 24, 3, 160), "#3bceac", 8),
  );
};

const DECOR: GraphicDraft[] = [
  def("decor-boho-arches", "decor", "boho arches rainbow terracotta sun neutral", bohoArches()),
  def("decor-dried-palm", "decor", "palm dried boho line leaf botanical", driedPalm()),
  def("decor-sparkles", "decor", "sparkle stars shine glitter magic", sparkles(), "sticker"),
  def("decor-heart", "decor", "heart love valentine romance sticker", heart(), "sticker"),
  def("decor-hearts-cluster", "decor", "hearts love pink valentine cute", hearts(), "sticker"),
  def("decor-confetti", "decor", "confetti party celebration scatter fun", confetti()),
  def("decor-gift-bow", "decor", "bow ribbon gift present pink", bow(), "sticker"),
  def("decor-washi-stripes", "decor", "washi tape stripes scrapbook pink", washiTape("#ffc4d6", "#ff9ab8", "stripes"), "sticker"),
  def("decor-washi-dots", "decor", "washi tape dots polka scrapbook mint", washiTape("#c6ecd9", "#86d3b0", "dots"), "sticker"),
  def("decor-paperclip", "decor", "paperclip clip office note sticker", paperclip(), "sticker"),
  def("decor-pushpin", "decor", "pushpin pin thumbtack note board", pushpin(), "sticker"),
  def("decor-star-sticker", "decor", "star gold favourite rating sticker", starSticker(), "sticker"),
  def("decor-confetti-dots", "decor", "confetti dots polka party scatter pastel", confettiDots()),
  def("decor-curly-ribbons", "decor", "ribbon curly streamers gift party curl", curlyRibbons()),
];

/* ------------------------------------------------------------------------------------------ *
 *  DOODLES
 * ------------------------------------------------------------------------------------------ */

/** Slightly wobbly pentagram drawn in one go, overshooting where it started. */
const scribbleStar = (): string => {
  const C = "#ffb703";
  const v = (i: number): Pt => {
    const a = -Math.PI / 2 + (i * TAU) / 5;
    return [92 + Math.cos(a) * 74 + ((i * 7) % 5) - 2, 116 + Math.sin(a) * 74 + ((i * 3) % 4) - 1.5];
  };
  const pts = [0, 2, 4, 1, 3, 0].map(v);
  const over: Pt = [pts[0][0] + (pts[1][0] - pts[0][0]) * 0.12, pts[0][1] + (pts[1][1] - pts[0][1]) * 0.12];
  const d = `M${xy(pts[0])}` + pts.slice(1).map((p) => `L${xy(p)}`).join("") + `L${xy(over)}`;
  return svg(
    200,
    200,
    sp(d, C, 8) + sp("M150 44l8 -10M168 66l12 -6M130 28l0 -12", C, 6) + sp("M170 156h16M178 148v16", C, 6),
  );
};

const circleScribble = (): string => {
  const pts: Pt[] = [];
  const noise = [0.01, -0.012, 0.014, -0.006, 0.012, -0.014, 0.008, -0.01, 0.012, -0.008, 0.006, -0.012, 0.01, -0.005];
  for (let i = 0; i < 14; i++) {
    const a = rad(-158 + i * 29.6);
    const k = 1.02 - 0.08 * (i / 13) + noise[i];
    pts.push([120 + 104 * k * Math.cos(a), 76 + 54 * k * Math.sin(a)]);
  }
  return svg(240, 152, sp(smooth(pts, false), "#ef476f", 6.5));
};

const squiggle = (): string => {
  const wave = (y: number, amp: number, phase: number, x0: number, step: number, count: number): Pt[] => {
    const pts: Pt[] = [];
    for (let i = 0; i < count; i++) pts.push([x0 + i * step, y + ((i + phase) % 2 ? amp : -amp)]);
    return pts;
  };
  return svg(
    300,
    96,
    sp(smooth(wave(36, 24, 0, 14, 34, 9), false), "#7c3aed", 9.5) + sp(smooth(wave(76, 11, 1, 31, 34, 8), false), "#7c3aed", 6),
  );
};

const spiral = (): string => {
  const pts: Pt[] = [];
  for (let i = 0; i <= 40; i++) {
    const th = i * 0.42;
    const r = 4 + 5.1 * th;
    pts.push([100 + Math.cos(th) * r, 100 + Math.sin(th) * r]);
  }
  return svg(200, 200, mv(8, 0, sp(smooth(pts, false), "#2ec4b6", 7)));
};

const markerUnderline = (): string =>
  svg(
    300,
    64,
    mv(0, -5, sp("M10 34C60 20 110 42 164 30S250 24 280 28", "#ff5a5f", 9.5) + sp("M44 52C100 46 172 56 240 48", "#ff5a5f", 6) +
      sp("M284 46l9 -9M272 54l12 -3", "#ff5a5f", 5)),
  );

const zigzagUnderline = (): string => {
  let d = "M24 36";
  for (let i = 1; i <= 13; i++) d += `L${24 + i * 19.5} ${i % 2 ? 14 : 36}`;
  return svg(300, 50, mv(0, -5, sp(d, "#12b5a6", 8) + circ(8, 36, 5, "#12b5a6") + circ(292, 36, 5, "#12b5a6") + sp("M130 46h.1M150 46h.1M170 46h.1", "#12b5a6", 5)));
};

/** Highlighter-style brush swipe: thick band, ragged bristle end and two dry streaks. */
const brushSwoosh = (): string =>
  svg(
    280,
    96,
    fp(
      "M16 58C14 40 40 30 82 28C132 26 190 28 244 22L262 28L248 34L266 42L248 48L260 56L240 60L254 68C200 68 134 72 84 76C44 80 18 74 16 58Z",
      "#ffc83d",
    ) + sp("M44 50C100 44 170 42 226 40M62 62C110 58 160 58 212 56M92 40C130 36 170 35 200 34", "#ffe9a8", 4),
  );

const scribbleHeart = (): string =>
  svg(
    200,
    184,
    sp("M98 58C86 28 40 22 28 58C18 92 62 132 100 170C140 134 184 94 172 58C160 22 114 28 102 60L94 74", "#ff4d6d", 8) +
      sp("M158 24l8 -9M176 40l11 -5M146 14l-2 -9", "#ff4d6d", 5.5),
  );

const excitedBurst = (): string => {
  let d = "";
  let dots = "";
  for (let i = 0; i < 8; i++) {
    const a = rad(-90 + i * 45);
    const r1 = 40 + (i % 2) * 6;
    const r2 = 78 - (i % 2) * 14;
    d += `M${n(100 + Math.cos(a) * r1)} ${n(100 + Math.sin(a) * r1)}L${n(100 + Math.cos(a) * r2)} ${n(100 + Math.sin(a) * r2)}`;
    const b = a + rad(22.5);
    dots += dot(100 + Math.cos(b) * 84, 100 + Math.sin(b) * 84);
  }
  return svg(200, 200, sp(d, "#7c3aed", 9) + sp(dots, "#7c3aed", 8));
};

const DOODLES: GraphicDraft[] = [
  def("doodles-underline-marker", "doodles", "underline marker hand-drawn stroke emphasis", markerUnderline()),
  def("doodles-underline-zigzag", "doodles", "underline zigzag hand-drawn stroke emphasis", zigzagUnderline()),
  def("doodles-circle-scribble", "doodles", "circle scribble highlight hand-drawn emphasis", circleScribble()),
  def("doodles-squiggle", "doodles", "squiggle wave line hand-drawn playful", squiggle()),
  def("doodles-star", "doodles", "star doodle hand-drawn sketch shine", scribbleStar()),
  def("doodles-spiral", "doodles", "spiral swirl doodle hand-drawn", spiral()),
  def("doodles-brush-swoosh", "doodles", "brush swoosh paint stroke highlight", brushSwoosh()),
  def("doodles-heart-scribble", "doodles", "heart doodle love hand-drawn sketch", scribbleHeart()),
  def("doodles-burst", "doodles", "burst rays lines doodle pop", excitedBurst()),
];

/* ------------------------------------------------------------------------------------------ *
 *  DIVIDERS  (360 x 60)
 * ------------------------------------------------------------------------------------------ */

const ornamentalRule = (): string => {
  const C = "#a67c52";
  const dm = (cx: number, rx: number, ry: number): string => fp(polyD([[cx, 30 - ry], [cx + rx, 30], [cx, 30 + ry], [cx - rx, 30]]), C);
  return svg(
    360,
    60,
    sp("M26 30H108M252 30H334", C, 4.5) + circ(14, 30, 5.5, C) + circ(346, 30, 5.5, C) +
      circ(118, 30, 4, C) + circ(242, 30, 4, C) + dm(138, 9, 9) + dm(222, 9, 9) + dm(180, 21, 23),
  );
};

const wavyRule = (): string => {
  let dots = "";
  for (let i = 0; i < 17; i++) dots += dot(20 + i * 20, 50);
  return svg(360, 60, sp("M12 22q10 -20 20 0" + "t20 0".repeat(16), "#5b8def", 7) + sp(dots, "#5b8def", 6));
};

/** Two out-of-phase waves that cross like a twisted rope. */
const braidRule = (): string =>
  svg(
    360,
    60,
    sp("M10 30q15 -34 30 0" + "t30 0".repeat(10), "#2ec4b6", 6) + sp("M10 30q15 34 30 0" + "t30 0".repeat(10), "#2ec4b6", 6),
  );

const zigzagRule = (): string => {
  const line = (dy: number): string => {
    let d = `M12 ${22 + dy}`;
    for (let i = 1; i <= 17; i++) d += `L${12 + i * 20} ${i % 2 ? 6 + dy : 22 + dy}`;
    return d;
  };
  return svg(360, 60, mv(0, 7, sp(line(0) + line(18), "#ef476f", 5.5)));
};

const dottedRule = (): string => {
  let body = "";
  for (let i = 0; i < 17; i++) body += circ(20 + i * 20, 30, 3.5 + 6 * Math.sin((Math.PI * i) / 16), "#7c3aed");
  return svg(360, 60, body);
};

const scallopRule = (): string => {
  let dots = "";
  for (let i = 0; i < 12; i++) dots += dot(26 + i * 28, 50);
  return svg(360, 60, mv(0, -6, sp("M12 36" + "a14 14 0 0 1 28 0".repeat(12), "#f59e0b", 6.5) + sp(dots, "#f59e0b", 6)));
};

const diamondRule = (): string => {
  const C = "#5b6ee1";
  const dm = (cx: number, rx: number, ry: number): string => fp(polyD([[cx, 30 - ry], [cx + rx, 30], [cx, 30 + ry], [cx - rx, 30]]), C);
  return svg(
    360,
    60,
    sp("M26 30H104M256 30H334", C, 4) + circ(14, 30, 5, C) + circ(346, 30, 5, C) +
      dm(180, 20, 24) + dm(144, 11, 14) + dm(216, 11, 14) + dm(120, 6, 8) + dm(240, 6, 8),
  );
};

const floralRule = (): string => {
  const LEAF = "#5f8d4e";
  const PET = "#f4a6b7";
  const CEN = "#ffc233";
  const vine = (): string =>
    sp("M158 30C136 14 110 46 86 30S46 24 18 30", LEAF, 4.5) +
    fp(
      leafD(138, 22, rad(-55), 19, 5.8) + leafD(116, 40, rad(50), 19, 5.8) + leafD(94, 31, rad(-70), 18, 5.4) +
        leafD(68, 29, rad(62), 16, 5) + leafD(44, 28, rad(-55), 15, 4.8),
      LEAF,
    ) +
    circ(12, 30, 5, PET);
  let petals = "";
  for (let k = 0; k < 6; k++) {
    const a = rad(k * 60 - 90);
    petals += circ(180 + Math.cos(a) * 13, 30 + Math.sin(a) * 13, 9, PET);
  }
  return svg(360, 60, vine() + mirror(360, vine()) + petals + circ(180, 30, 9, CEN));
};

const DIVIDERS: GraphicDraft[] = [
  def("dividers-ornamental-rule", "dividers", "divider rule ornament diamond elegant line", ornamentalRule()),
  def("dividers-wavy", "dividers", "divider wavy wave dots line separator", wavyRule()),
  def("dividers-braid", "dividers", "divider braid rope twist wave line", braidRule()),
  def("dividers-zigzag", "dividers", "divider zigzag double line separator bold", zigzagRule()),
  def("dividers-dotted", "dividers", "divider dots dotted line separator", dottedRule()),
  def("dividers-scallop", "dividers", "divider scallop border bunting line", scallopRule()),
  def("dividers-diamond-rule", "dividers", "divider diamonds rule classic line", diamondRule()),
  def("dividers-floral", "dividers", "divider floral flower vine leaves botanical", floralRule()),
];

/* ------------------------------------------------------------------------------------------ *
 *  FRAMES
 * ------------------------------------------------------------------------------------------ */

const roundedBorder = (): string =>
  svg(
    240,
    300,
    g(
      ink("#7c3aed", 10),
      `<rect x="14" y="14" width="212" height="272" rx="36"/><rect x="34" y="34" width="172" height="232" rx="20" stroke-width="3.5"/>`,
    ) +
      sp("M120 24h.1M120 276h.1M24 150h.1M216 150h.1", "#7c3aed", 6),
  );

const doubleLineFrame = (): string => {
  const NAVY = "#1f2a68";
  const GOLD = "#c9a227";
  const dm = (cx: number, cy: number): string => fp(polyD([[cx, cy - 8], [cx + 8, cy], [cx, cy + 8], [cx - 8, cy]]), GOLD);
  return svg(
    240,
    300,
    g(ink(NAVY, 6), `<rect x="12" y="12" width="216" height="276" rx="5"/>`) +
      g(ink(GOLD, 3.2), `<rect x="28" y="28" width="184" height="244" rx="2"/>`) +
      dm(28, 28) + dm(212, 28) + dm(28, 272) + dm(212, 272) + dm(120, 28) + dm(120, 272) + dm(28, 150) + dm(212, 150),
  );
};

const cornerBrackets = (): string => {
  const bracket = (x: number, y: number, sx: number, sy: number, len: number, r: number): string =>
    `M${x + sx * len} ${y}H${x + sx * r}Q${x} ${y} ${x} ${y + sy * r}V${y + sy * len}`;
  const all = (inset: number, len: number, r: number): string =>
    bracket(inset, inset, 1, 1, len, r) + bracket(240 - inset, inset, -1, 1, len, r) +
    bracket(inset, 300 - inset, 1, -1, len, r) + bracket(240 - inset, 300 - inset, -1, -1, len, r);
  return svg(240, 300, sp(all(14, 62, 22), "#14b8a6", 9) + sp(all(34, 28, 8), "#14b8a6", 4.5));
};

/** Ornate corner for the top-left: border rules that roll into mirrored spiral scrolls. */
const cornerFlourish = (): string => {
  const C = "#b08d57";
  const D = "#7c5a2a";
  const R0 = 26;
  const cx = 14 + R0;
  const cy = 70;
  const pts: Pt[] = [];
  for (let i = 0; i <= 15; i++) {
    const a = rad(180 + i * 40);
    const r = R0 * (1 - 0.8 * (i / 15));
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  const curl = (p: Pt[]): string => smooth(p, false).replace(/^M[^C]*/, "");
  const arm1 = `M14 128V${cy}` + curl(pts);
  const arm2 = `M128 14H${cy}` + curl(pts.map((p) => [p[1], p[0]] as Pt));
  return svg(
    140,
    140,
    g(ink(C, 4.8), `<path d="${arm1}"/><path d="${arm2}"/>`) +
      fp(polyD([[24, 12], [36, 24], [24, 36], [12, 24]]), D) +
      circ(14, 128, 5.5, C) + circ(128, 14, 5.5, C) + circ(54, 54, 4.5, D),
  );
};

const polaroid = (): string => {
  const CARD = "#fffdf7";
  const EDGE = "#d9d0bd";
  const SHADOW = "#cfc6b2";
  const TAPE = "#f6a8ba";
  const hole = "M28 30V186H184V30Z";
  const cardD = `M16 14H194Q200 14 200 20V242Q200 248 194 248H16Q10 248 10 242V20Q10 14 16 14Z${hole}`;
  const shadowD = `M24 24H210Q216 24 216 30V254Q216 260 210 260H24Q18 260 18 254V30Q18 24 24 24Z${hole}`;
  return svg(
    226,
    266,
    `<path d="${shadowD}" fill="${SHADOW}" fill-rule="evenodd"/>` +
      `<path d="${cardD}" fill="${CARD}" fill-rule="evenodd" stroke="${EDGE}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/>` +
      rot(-4, 105, 20, `<rect x="72" y="6" width="66" height="26" rx="2" fill="${TAPE}"/>`),
  );
};

const ticket = (): string => {
  const Y = "#ffbe0b";
  const D = "#d98e04";
  const body =
    "M20 10H280A14 14 0 0 1 294 24V54A16 16 0 0 0 294 86V116A14 14 0 0 1 280 130H20A14 14 0 0 1 6 116V86A16 16 0 0 0 6 54V24A14 14 0 0 1 20 10Z";
  let perf = "";
  for (let y = 22; y < 122; y += 14) perf += `M214 ${y}v6`;
  return svg(
    300,
    140,
    fp(body, Y) +
      `<rect x="20" y="24" width="266" height="92" rx="9" fill="none" stroke="${D}" stroke-width="3.2" stroke-dasharray="7 7" stroke-linecap="round" stroke-linejoin="round"/>` +
      sp(perf, D, 3.4),
  );
};

const archWindow = (): string => {
  const T = "#d98e73";
  const S = "#f4dcc0";
  let beads = "";
  for (let i = 0; i <= 12; i++) {
    const a = Math.PI + (i / 12) * Math.PI;
    beads += dot(120 + Math.cos(a) * 89, 118 + Math.sin(a) * 89);
  }
  for (const y of [150, 182, 214, 246]) beads += dot(31, y) + dot(209, y);
  return svg(
    240,
    300,
    `<path d="M16 288V118A104 104 0 0 1 224 118V288ZM46 258V120A74 74 0 0 1 194 120V258Z" fill="${T}" fill-rule="evenodd"/>` +
      sp(beads, S, 7),
  );
};

const FRAMES: GraphicDraft[] = [
  def("frames-rounded-border", "frames", "frame border rounded page outline simple", roundedBorder()),
  def("frames-double-line", "frames", "frame border double line classic elegant", doubleLineFrame()),
  def("frames-corner-brackets", "frames", "frame corners brackets viewfinder minimal", cornerBrackets()),
  def("frames-corner-flourish", "frames", "corner flourish ornament vintage swirl", cornerFlourish()),
  def("frames-polaroid", "frames", "polaroid photo frame instant tape", polaroid()),
  def("frames-ticket", "frames", "ticket coupon admission stub label", ticket()),
  def("frames-arch-window", "frames", "arch window frame boho photo mask", archWindow()),
];

/* ------------------------------------------------------------------------------------------ *
 *  BADGES
 * ------------------------------------------------------------------------------------------ */

const strokedPoly = (pts: Pt[], fill: string, w: number): string =>
  `<path d="${polyD(pts)}" fill="${fill}" stroke="${fill}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"/>`;

const sealBadge = (): string => {
  const GOLD = "#e6b422";
  const LIGHT = "#f8e29a";
  const DARK = "#a97c0a";
  let beads = "";
  for (let i = 0; i < 28; i++) {
    const a = (i / 28) * TAU;
    beads += dot(100 + Math.cos(a) * 55, 100 + Math.sin(a) * 55);
  }
  return svg(
    200,
    200,
    fp(scallopD(100, 100, 88, 24, 0.62), GOLD) + circ(100, 100, 72, LIGHT) +
      g(ink(DARK, 3.5), `<circle cx="100" cy="100" r="62"/>`) + sp(beads, DARK, 4) +
      strokedPoly(starPts(100, 102, 34, 15, 5), DARK, 6),
  );
};

const ribbonBanner = (): string => {
  const BAND = "#e63946";
  const TAIL = "#c1121f";
  const FOLD = "#7f0b13";
  const tail = fp(polyD([[6, 50], [62, 50], [62, 112], [6, 112], [28, 81]]), TAIL) + fp(polyD([[62, 92], [84, 92], [62, 112]]), FOLD);
  return svg(
    360,
    140,
    tail + mirror(360, tail) +
      `<rect x="56" y="26" width="248" height="66" rx="3" fill="${BAND}"/>` +
      `<path d="M72 38H288M72 80H288" fill="none" stroke="#ff9aa2" stroke-width="3.2" stroke-dasharray="8 7" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
};

const starburstSale = (): string => {
  const R = "#ff3b57";
  const SH = "#b3122f";
  const burst = starPts(100, 100, 90, 76, 24);
  return svg(
    200,
    200,
    mv(0, 4, strokedPoly(burst, SH, 6)) + mv(0, -3, strokedPoly(burst, R, 6)) +
      `<circle cx="100" cy="97" r="60" fill="none" stroke="#ffd166" stroke-width="4" stroke-dasharray="2 9" stroke-linecap="round" stroke-linejoin="round"/>`,
  );
};

const priceTag = (): string => {
  const TAG = "#ff7a45";
  const EYE = "#c8461b";
  const STRING = "#3a3a5c";
  const body =
    "M20 85L52 46Q56 40 64 40H180Q190 40 190 50V120Q190 130 180 130H64Q56 130 52 124ZM69 85a9 9 0 1 0 -18 0a9 9 0 1 0 18 0Z";
  return svg(
    240,
    180,
    mv(
      14,
      18,
      rot(
        -14,
        105,
        85,
        `<path d="${body}" fill="${TAG}" fill-rule="evenodd"/>` +
          `<rect x="78" y="52" width="104" height="66" rx="8" fill="none" stroke="#ffd1b8" stroke-width="3" stroke-dasharray="6 7" stroke-linecap="round" stroke-linejoin="round"/>` +
          sp("M60 85m-14 0a14 14 0 1 0 28 0a14 14 0 1 0 -28 0", EYE, 4) +
          sp("M60 85C34 84 12 62 24 30C30 14 48 12 58 20", STRING, 3.6),
      ),
    ),
  );
};

const laurelWreath = (): string => {
  const C = "#c9a227";
  let leaves = "";
  const N = 9;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    const th = rad(104 + 146 * t);
    const x = 100 + Math.cos(th) * 66;
    const y = 106 + Math.sin(th) * 66;
    const len = 30 - 12 * t;
    const w = 7.4 - 2 * t;
    leaves += lensD(x, y, th + rad(48), len, w) + lensD(x, y, th + rad(132), len * 0.9, w * 0.9);
  }
  const tipTh = rad(250);
  leaves += lensD(100 + Math.cos(tipTh) * 66, 106 + Math.sin(tipTh) * 66, tipTh + rad(80), 20, 5);
  const branch = fp(leaves, C) + sp(arcD(100, 106, 66, rad(100), rad(252)), C, 3.6);
  return svg(200, 200, branch + mirror(200, branch) + circ(100, 172, 5.5, C));
};

const rosette = (): string => {
  const B = "#3b82f6";
  const L = "#93c5fd";
  const DK = "#1d4ed8";
  const T2 = "#2563eb";
  const tail = (deg: number, fill: string): string =>
    rot(deg, 100, 120, fp(polyD([[80, 112], [120, 112], [120, 222], [100, 204], [80, 222]]), fill));
  return svg(
    200,
    240,
    tail(16, DK) + tail(-16, T2) +
      fp(scallopD(100, 92, 74, 20, 0.6), B) + circ(100, 92, 56, L) +
      g(ink(DK, 3.6), `<circle cx="100" cy="92" r="48"/>`) +
      strokedPoly(starPts(100, 94, 28, 12.5, 5), DK, 5),
  );
};

const BADGES: GraphicDraft[] = [
  def("badges-seal", "badges", "badge seal medal quality premium circle", sealBadge()),
  def("badges-ribbon-banner", "badges", "ribbon banner label title scroll red", ribbonBanner()),
  def("badges-starburst-sale", "badges", "sale starburst discount offer sticker burst", starburstSale()),
  def("badges-price-tag", "badges", "price tag label sale hang shop", priceTag()),
  def("badges-laurel-wreath", "badges", "laurel wreath award winner victory", laurelWreath()),
  def("badges-rosette", "badges", "rosette award prize ribbon medal blue", rosette()),
];

/* ------------------------------------------------------------------------------------------ *
 *  ARROWS
 * ------------------------------------------------------------------------------------------ */

/** Open arrow head with its tip at `tip`, travelling in direction `ang`. */
const head = (tip: Pt, ang: number, size = 26, spread = 0.52): string => {
  const back = ang + Math.PI;
  const w = (s: number): string => xy([tip[0] + Math.cos(back + s) * size, tip[1] + Math.sin(back + s) * size]);
  return `M${w(spread)}L${xy(tip)}L${w(-spread)}`;
};

const INK = "#1f2937";

const curvedArrowA = (): string => {
  const end: Pt = [172, 66];
  const d = `M20 114C40 34 112 14 ${xy(end)}` + head(end, Math.atan2(66 - 14, 172 - 112));
  return svg(200, 140, mv(0, -7, mv(4, 5, sp(d, "#cbd5e1", 7.5)) + sp(d, INK, 7.5) + circ(20, 114, 6, INK)));
};

const curvedArrowB = (): string => {
  const end: Pt = [166, 124];
  const d = `M26 26C152 4 22 114 ${xy(end)}` + head(end, Math.atan2(124 - 114, 166 - 22), 28);
  return svg(200, 150, mv(4, 5, sp(d, "#ddd0fb", 7.5)) + sp(d, "#7c3aed", 7.5) + circ(26, 26, 6, "#7c3aed"));
};

const loopArrow = (): string => {
  const pts: Pt[] = [[14, 104], [58, 94], [96, 70], [126, 40], [120, 14], [92, 18], [84, 46], [104, 74], [142, 84], [178, 66]];
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  return svg(210, 130, mv(9, 7, sp(smooth(pts, false) + head(last, Math.atan2(last[1] - prev[1], last[0] - prev[0]) - 0.1, 26), "#ff5a5f", 7.5)));
};

/** Dotted trail along a cubic Bezier, ending in a solid arrow head. */
const dottedArrow = (): string => {
  const P0: Pt = [16, 112];
  const C1: Pt = [56, 6];
  const C2: Pt = [146, 6];
  const P1: Pt = [194, 100];
  const at = (t: number): Pt => {
    const u = 1 - t;
    return [
      u * u * u * P0[0] + 3 * u * u * t * C1[0] + 3 * u * t * t * C2[0] + t * t * t * P1[0],
      u * u * u * P0[1] + 3 * u * u * t * C1[1] + 3 * u * t * t * C2[1] + t * t * t * P1[1],
    ];
  };
  let dots = "";
  let acc = 0;
  let prev = at(0);
  dots += dot(prev[0], prev[1]);
  for (let i = 1; i <= 200; i++) {
    const p = at(i / 200);
    acc += Math.hypot(p[0] - prev[0], p[1] - prev[1]);
    prev = p;
    if (acc >= 17 && Math.hypot(P1[0] - p[0], P1[1] - p[1]) > 34) {
      dots += dot(p[0], p[1]);
      acc = 0;
    }
  }
  return svg(
    210,
    130,
    sp(dots, "#12b5a6", 8) + sp(head(P1, Math.atan2(P1[1] - C2[1], P1[0] - C2[0]), 32), "#12b5a6", 8),
  );
};

const doubleArrow = (): string => {
  const a: Pt = [24, 44];
  const b: Pt = [176, 40];
  const d = "M24 44C70 32 134 52 176 40" + head(b, Math.atan2(40 - 52, 176 - 134), 26) + head(a, Math.atan2(44 - 32, 24 - 70), 26);
  return svg(200, 84, mv(3, 5, sp(d, "#fde2b0", 7.5)) + sp(d, "#f59e0b", 7.5));
};

const blockArrow = (): string =>
  svg(
    200,
    120,
    mv(0, 6, strokedPoly([[18, 44], [110, 44], [110, 20], [182, 58], [110, 96], [110, 72], [18, 72]], "#d63c43", 8)) +
      strokedPoly([[18, 44], [110, 44], [110, 20], [182, 58], [110, 96], [110, 72], [18, 72]], "#ff5a5f", 8) +
      sp("M32 58H98", "#ffb3b6", 5),
  );

const blockCurvedArrow = (): string => {
  const cx = 100;
  const cy = 122;
  const r = 64;
  const th = rad(335);
  const end: Pt = [cx + Math.cos(th) * r, cy + Math.sin(th) * r];
  const tan: Pt = [-Math.sin(th), Math.cos(th)];
  const rad2: Pt = [Math.cos(th), Math.sin(th)];
  const tip: Pt = [end[0] + tan[0] * 36, end[1] + tan[1] * 36];
  const b1: Pt = [end[0] + rad2[0] * 28, end[1] + rad2[1] * 28];
  const b2: Pt = [end[0] - rad2[0] * 28, end[1] - rad2[1] * 28];
  return svg(
    200,
    170,
    sp(arcD(cx, cy, r, rad(200), th), "#7c3aed", 26) +
      strokedPoly([b1, tip, b2], "#7c3aed", 6) +
      sp(arcD(cx, cy, r, rad(206), rad(318)), "#b79bf7", 4.5),
  );
};

const chevrons = (): string =>
  svg(
    190,
    120,
    sp("M20 36L50 60L20 84", "#ffb703", 12) + sp("M70 28L108 60L70 92", "#ffb703", 15) + sp("M128 18L172 60L128 102", "#ffb703", 18),
  );

const sketchArrowDown = (): string => {
  const end: Pt = [100, 180];
  const d = `M60 18C140 30 150 84 96 96C48 106 46 140 ${xy(end)}` + head(end, Math.PI / 2 + 0.06, 30);
  return svg(200, 200, mv(4, 4, sp(d, "#bfe6f9", 7.5)) + sp(d, "#0ea5e9", 7.5) + circ(60, 18, 6, "#0ea5e9"));
};

const ARROWS: GraphicDraft[] = [
  def("arrows-curved-hand", "arrows", "arrow curved hand-drawn pointer swoosh direction", curvedArrowA()),
  def("arrows-curved-s", "arrows", "arrow curve s-shaped hand-drawn flow direction", curvedArrowB()),
  def("arrows-loop", "arrows", "arrow loop swirl hand-drawn twist direction", loopArrow()),
  def("arrows-dotted-path", "arrows", "arrow dotted path trail dashed route", dottedArrow()),
  def("arrows-double-ended", "arrows", "arrow double both ways hand-drawn two-way", doubleArrow()),
  def("arrows-block-right", "arrows", "arrow block bold right next direction", blockArrow()),
  def("arrows-block-curved", "arrows", "arrow block curved bold turn direction", blockCurvedArrow()),
  def("arrows-chevrons", "arrows", "arrow chevron forward next fast bold", chevrons()),
  def("arrows-scribble-down", "arrows", "arrow down scribble swirl hand-drawn scroll", sketchArrowDown()),
];

/* ------------------------------------------------------------------------------------------ *
 *  Library
 * ------------------------------------------------------------------------------------------ */

export const GRAPHICS_A: GraphicDraft[] = [
  ...ABSTRACT,
  ...NATURE,
  ...DECOR,
  ...DOODLES,
  ...DIVIDERS,
  ...FRAMES,
  ...BADGES,
  ...ARROWS,
];
