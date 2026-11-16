/**
 * Original flat vector illustration library, part B: objects, business, food, travel,
 * education, celebration and tech. Every piece is hand-built from basic SVG primitives
 * (no <style>, filters, masks or external refs) with literal #rrggbb colours so the
 * editor's regex based recolouring works.
 *
 * Style: flat shapes, no outlines, soft depth from translucent ink / cream overlays
 * (so a recolour keeps the shading), 3-6 distinct colours per piece.
 */
import type { GraphicCategory, GraphicDef, GraphicDraft } from "./graphicTypes";

/* ------------------------------------------------------------------ palette */

interface Tone {
  /** highlight / light side */
  l: string;
  /** base colour */
  m: string;
  /** shade / dark side */
  d: string;
}
const tone = (l: string, m: string, d: string): Tone => ({ l, m, d });

const RED = tone("#ff9a92", "#ff6b63", "#d9484a");
const ORANGE = tone("#ffc680", "#ff9f43", "#e0731a");
const YELLOW = tone("#ffe78f", "#ffd23f", "#eaa30a");
const GREEN = tone("#8be3b1", "#3ec486", "#1f9566");
const TEAL = tone("#86e6dc", "#22c1b2", "#0f8d86");
const SKY = tone("#b2dcff", "#5db9ff", "#2f86e0");
const ROYAL = tone("#8fb0ff", "#4f7cf0", "#2f55c4");
const INDIGO = tone("#aaa6ff", "#6f66ff", "#4a41c8");
const PURPLE = tone("#d3a9ff", "#a65cf2", "#7b36c6");
const PINK = tone("#ffb3d3", "#ff6fa8", "#d6417f");
const BROWN = tone("#dba577", "#a96b3f", "#774526");
const CLAY = tone("#f4ab8a", "#e8805a", "#c25d3a");
const SLATE = tone("#f1f3fa", "#cdd3e6", "#8f98b6");

const INK = "#2d3047";
const WHITE = "#ffffff";
const CREAM = "#fff3dc";
const SAND = "#f5d9a8";

/* ------------------------------------------------------------------ builders */

type N = number;
const V = "0 0 200 200";
const r2 = (n: number) => Math.round(n * 100) / 100;
const rad = (deg: number) => (deg * Math.PI) / 180;
const r1 = (n: number) => Math.round(n * 10) / 10;
/** point on a circle, degrees clockwise from 3 o'clock */
const pt = (cx: N, cy: N, r: N, deg: N): [N, N] => [r1(cx + r * Math.cos(rad(deg))), r1(cy + r * Math.sin(rad(deg)))];
const op = (o: N) => ` opacity="${o}"`;
/** opacity presets for ink / cream overlays */
const SHADE = op(0.14);
const DEEP = op(0.26);
const GLINT = op(0.45);

const rect = (x: N, y: N, w: N, h: N, fill: string, rx = 0, x_ = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}"${rx ? ` rx="${rx}"` : ""} fill="${fill}"${x_}/>`;
const circle = (cx: N, cy: N, r: N, fill: string, x_ = "") => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${x_}/>`;
const ellipse = (cx: N, cy: N, rx: N, ry: N, fill: string, x_ = "") => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="${fill}"${x_}/>`;
const path = (d: string, fill: string, x_ = "") => `<path d="${d}" fill="${fill}"${x_}/>`;
const poly = (points: string, fill: string, x_ = "") => `<polygon points="${points}" fill="${fill}"${x_}/>`;
/** unfilled stroked path with round caps and joins */
const stroke = (d: string, color: string, w: N, x_ = "") =>
  `<path d="${d}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round" stroke-linejoin="round"${x_}/>`;
const line = (x1: N, y1: N, x2: N, y2: N, color: string, w: N, x_ = "") =>
  `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${color}" stroke-width="${w}" stroke-linecap="round"${x_}/>`;
const ring = (cx: N, cy: N, r: N, color: string, w: N, x_ = "") =>
  `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="${w}"${x_}/>`;
const ringE = (cx: N, cy: N, rx: N, ry: N, color: string, w: N, x_ = "") =>
  `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="none" stroke="${color}" stroke-width="${w}"${x_}/>`;
const outline = (x: N, y: N, w: N, h: N, rx: N, color: string, sw: N, x_ = "") =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="none" stroke="${color}" stroke-width="${sw}"${x_}/>`;
const group = (transform: string, ...kids: string[]) => `<g transform="${transform}">${kids.join("")}</g>`;
const svg = (vb: string, ...parts: string[]) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}">${parts.join("")}</svg>`;

/** soft ground shadow */
const shadow = (cx: N, cy: N, rx: N, ry = 6) => ellipse(cx, cy, rx, ry, INK, op(0.12));
/** pie slice, angles in degrees clockwise from 3 o'clock */
const sector = (cx: N, cy: N, r: N, a0: N, a1: N) => {
  const [x0, y0] = pt(cx, cy, r, a0);
  const [x1, y1] = pt(cx, cy, r, a1);
  return `M${cx} ${cy}L${x0} ${y0}A${r} ${r} 0 ${a1 - a0 > 180 ? 1 : 0} 1 ${x1} ${y1}Z`;
};
/** star polygon points */
const starPts = (cx: N, cy: N, R: N, r: N, n = 5, rot = -90) => {
  const out: string[] = [];
  for (let i = 0; i < n * 2; i++) out.push(pt(cx, cy, i % 2 ? r : R, rot + (i * 180) / n).join(" "));
  return out.join(" ");
};
const star = (cx: N, cy: N, R: N, fill: string, x_ = "", r = R * 0.45, n = 5) => poly(starPts(cx, cy, R, r, n), fill, x_);
/** four pointed sparkle */
const sparkle = (cx: N, cy: N, s: N, fill: string, x_ = "") =>
  path(
    `M${cx} ${cy - s}Q${r2(cx + s * 0.18)} ${r2(cy - s * 0.18)} ${cx + s} ${cy}Q${r2(cx + s * 0.18)} ${r2(cy + s * 0.18)} ${cx} ${cy + s}Q${r2(cx - s * 0.18)} ${r2(cy + s * 0.18)} ${cx - s} ${cy}Q${r2(cx - s * 0.18)} ${r2(cy - s * 0.18)} ${cx} ${cy - s}Z`,
    fill,
    x_,
  );
/** heart outline centred on (cx, cy), `w` wide */
const heartD = (cx: N, cy: N, w: N) => {
  const k = w / 20;
  const p = (x: N, y: N) => `${r2(cx + x * k)} ${r2(cy + y * k)}`;
  return `M${p(0, 8)}C${p(-4, 5)} ${p(-10, 1)} ${p(-10, -4)}C${p(-10, -8)} ${p(-7, -10)} ${p(-4.5, -10)}C${p(-2.5, -10)} ${p(-0.8, -8.8)} ${p(0, -6.5)}C${p(0.8, -8.8)} ${p(2.5, -10)} ${p(4.5, -10)}C${p(7, -10)} ${p(10, -8)} ${p(10, -4)}C${p(10, 1)} ${p(4, 5)} ${p(0, 8)}Z`;
};
const heart = (cx: N, cy: N, w: N, fill: string, x_ = "") => path(heartD(cx, cy, w), fill, x_);
/** teardrop with its point up */
const drop = (cx: N, cy: N, s: N, fill: string, x_ = "") =>
  path(`M${cx} ${r2(cy - s)}C${r2(cx + s * 0.75)} ${r2(cy - s * 0.1)} ${r2(cx + s * 0.85)} ${r2(cy + s * 0.75)} ${cx} ${r2(cy + s * 0.75)}C${r2(cx - s * 0.85)} ${r2(cy + s * 0.75)} ${r2(cx - s * 0.75)} ${r2(cy - s * 0.1)} ${cx} ${r2(cy - s)}Z`, fill, x_);

/** full shape + dark rim + inset base-colour shape = soft crescent shading on the lower right */
const rim = (d: string, fill: string, cx: N, cy: N, s = 0.92, dx = -3, dy = -2) =>
  path(d, fill) + path(d, INK, SHADE) + group(`translate(${r2(cx + dx)} ${r2(cy + dy)}) scale(${s}) translate(${-cx} ${-cy})`, path(d, fill));
/** circle version of `rim` */
const rimCircle = (cx: N, cy: N, r: N, fill: string, dx = -3, dy = -3, s = 0.93) =>
  circle(cx, cy, r, fill) + circle(cx, cy, r, INK, SHADE) + circle(cx + dx, cy + dy, r * s, fill);
/** parallel hatch lines clipped to a convex polygon */
const hatch = (poly: Array<[N, N]>, deg: N, gap: N, color: string, w: N, x_ = "") => {
  const dx = Math.cos(rad(deg));
  const dy = Math.sin(rad(deg));
  const nx = -dy;
  const ny = dx;
  const ds = poly.map(([x, y]) => x * nx + y * ny);
  const lo = Math.min(...ds);
  const hi = Math.max(...ds);
  let out = "";
  for (let k = Math.ceil(lo / gap) * gap; k < hi; k += gap) {
    const ts: number[] = [];
    for (let i = 0; i < poly.length; i++) {
      const [x1, y1] = poly[i];
      const [x2, y2] = poly[(i + 1) % poly.length];
      const d1 = x1 * nx + y1 * ny - k;
      const d2 = x2 * nx + y2 * ny - k;
      if ((d1 <= 0 && d2 > 0) || (d1 > 0 && d2 <= 0)) {
        const t = d1 / (d1 - d2);
        ts.push((x1 + (x2 - x1) * t) * dx + (y1 + (y2 - y1) * t) * dy);
      }
    }
    if (ts.length >= 2) {
      const a = Math.min(...ts);
      const b = Math.max(...ts);
      out += line(r2(k * nx + a * dx), r2(k * ny + a * dy), r2(k * nx + b * dx), r2(k * ny + b * dy), color, w, x_);
    }
  }
  return out;
};

/**
 * Optical centring: [dx, dy, scale?] applied to a piece's artwork (scale is about the
 * viewBox centre). Measured from the rendered pixel bounds so every piece sits centred.
 */
const NUDGE: Record<string, [N, N, N?]> = {
  "business-bar-chart": [-2, -5.1, 1.02],
  "business-briefcase": [0, -15.7, 1.14],
  "business-calendar": [0, -7.6, 1.09],
  "business-coin-stacks": [0, -9, 1.06],
  "business-idea-bulb": [0, 9.9, 1.02],
  "business-laptop-chart": [0, -3],
  "business-megaphone": [-3.7, 9.3, 1.06],
  "business-pie-chart": [5.9, -14.1, 1.13],
  "business-rocket": [0, -4.3, 1.15],
  "business-shopping-bags": [-1.1, -14.8, 1.12],
  "business-target-arrow": [1.2, -3.5, 1.18],
  "business-trophy": [0, -6.7, 1.11],
  "business-wallet": [-2.2, -6.1, 1.11],
  "celebration-balloons": [-0.2, -5.3, 0.97],
  "celebration-birthday-cake": [0, -12, 1.02],
  "celebration-bunting": [0, -7.4, 0.88],
  "celebration-confetti-burst": [3.4, 2.6, 0.96],
  "celebration-crown": [0, -12.7, 1.06],
  "celebration-fireworks": [-4, 1, 0.99],
  "celebration-gifts": [-0.5, -8.7, 1.05],
  "celebration-party-popper": [-21.9, 15.7, 1.14],
  "celebration-ribbons": [0, -29.2, 1.23],
  "education-atom": [0, 2.6, 1.04],
  "education-flask": [0, -4.9, 0.99],
  "education-graduation-cap": [0, 7.1, 1.02],
  "education-notebook": [1.2, -6.1, 0.97],
  "education-open-book": [0, -2.5],
  "education-pencil-ruler": [-0.6, 1.4, 1.14],
  "food-apple": [0.3, 2.3, 1.14],
  "food-avocado": [2.4, -3.2, 1.05],
  "food-burger": [0, -18.9, 1.11],
  "food-cake-slice": [0, -19.9, 0.95],
  "food-coffee-beans": [0.3, -18.3, 1.22],
  "food-croissant": [0, -9.6, 1.2],
  "food-cupcake": [0, 7.4, 0.96],
  "food-ice-cream": [0, 2.1, 0.93],
  "food-lemon": [-2.6, 0.3, 1.03],
  "food-orange": [-2.2, -0.8, 1.12],
  "food-pizza-slice": [9.5, -8.7, 1.09],
  "food-strawberry": [0, -11.4, 1.17],
  "objects-backpack": [0, -10.4, 1.12],
  "objects-books-stack": [0, -13.1, 1.05],
  "objects-camera": [0, -16.4, 1.17],
  "objects-clock": [0, -19.8, 1.24],
  "objects-coffee-cup": [0, -8.3, 1.14],
  "objects-gift-box": [-1.7, -15, 1.11],
  "objects-headphones": [0, -3.3, 1.11],
  "objects-key": [2.4, -2, 1.35],
  "objects-lamp": [0, -16.5, 1.03],
  "objects-plant-pot": [0, -8.8, 1.04],
  "objects-umbrella": [0.3, -0.5, 1.04],
  "tech-chat-bubbles": [0, -6.5, 1.08],
  "tech-chip": [0, 0, 1.14],
  "tech-cloud": [-0.3, -6.6, 1.06],
  "tech-code-brackets": [0, -9.2, 1.02],
  "tech-gears": [-7.1, -10.7, 0.95],
  "tech-laptop": [0, -1.8, 0.92],
  "tech-monitor": [0, -7.6, 1.01],
  "tech-wifi": [0, 0, 1.06],
  "travel-airplane": [16.4, -15.3, 1.09],
  "travel-camper-van": [-2, -7.6, 0.98],
  "travel-compass": [0, 5.3, 0.92],
  "travel-globe": [-5.6, -5, 1.11],
  "travel-hot-air-balloon": [0.2, -4.9, 0.99],
  "travel-map-pin": [0, -2.8, 1.02],
  "travel-sailboat": [0, -4.2, 1.05],
  "travel-suitcase": [0, -15.1, 1.08],
  "travel-tent": [0, -2.8, 0.93],
};

/** (the name comes from the catalog by id, see graphics.ts) */
function art(category: GraphicCategory, slug: string, tags: string, markup: string, kind: GraphicDef["kind"] = "illustration"): GraphicDraft {
  let out = markup;
  const id = `${category}-${slug}`;
  const at = NUDGE[id];
  const m = at && markup.match(/^(<svg[^>]*viewBox="([-\d.]+) ([-\d.]+) ([-\d.]+) ([-\d.]+)"[^>]*>)([\s\S]*)<\/svg>$/);
  if (at && m) {
    const [dx, dy, s = 1] = at;
    const cx = +m[2] + +m[4] / 2;
    const cy = +m[3] + +m[5] / 2;
    const tf = s === 1 ? `translate(${dx} ${dy})` : `translate(${r2(cx + dx)} ${r2(cy + dy)}) scale(${s}) translate(${-cx} ${-cy})`;
    out = `${m[1]}<g transform="${tf}">${m[6]}</g></svg>`;
  }
  return { id, category, tags: tags.split(" "), svg: out, kind };
}

/* ------------------------------------------------------------------ objects */

/** a book seen from the spine side with its page block on the right */
const book = (x: N, y: N, w: N, h: N, fill: string) =>
  rect(x, y, w, h, fill, 6) +
  rect(x + w - 24, y + 5, 24, h - 10, CREAM, 3) +
  rect(x + w - 20, y + h / 2 - 5, 20, 2, INK, 1, op(0.16)) +
  rect(x + w - 20, y + h / 2 + 3, 20, 2, INK, 1, op(0.16)) +
  rect(x, y + h - 8, w, 8, INK, 4, SHADE) +
  rect(x + 12, y, 5, h, INK, 0, op(0.18)) +
  rect(x + 21, y, 2.5, h, CREAM, 0, op(0.7));

/** leaf pointing up from (100,120), rotated about its base */
const leaf = (angle: N, L: N, W: N, fill: string, vein: string) =>
  group(
    `rotate(${angle} 100 120)`,
    path(`M100 120C${100 - W} ${r2(120 - L * 0.3)} ${r2(100 - W * 0.7)} ${r2(120 - L * 0.78)} 100 ${120 - L}C${r2(100 + W * 0.7)} ${r2(120 - L * 0.78)} ${100 + W} ${r2(120 - L * 0.3)} 100 120Z`, fill),
    line(100, 118, 100, r2(120 - L * 0.82), vein, 2),
  );

/** one round balloon with knot and glint */
const balloon = (cx: N, cy: N, rx: N, ry: N, fill: string, angle = 0) =>
  group(
    `rotate(${angle} ${cx} ${cy})`,
    ellipse(cx, cy, rx, ry, fill),
    ellipse(cx, cy, rx, ry, INK, SHADE),
    ellipse(cx - 3, cy - 4, rx - 4, ry - 5, fill),
    poly(`${cx - 5} ${cy + ry + 7} ${cx + 5} ${cy + ry + 7} ${cx} ${cy + ry - 1}`, fill),
    ellipse(cx - rx * 0.42, cy - ry * 0.38, rx * 0.17, ry * 0.3, CREAM, op(0.6)),
  );

const objects: GraphicDraft[] = [
  art(
    "objects",
    "coffee-cup",
    "coffee cup mug cafe drink",
    svg(
      V,
      stroke("M86 62c-8-9 8-14 0-26", TEAL.m, 5, op(0.45)),
      stroke("M104 62c-8-9 8-14 0-26", TEAL.m, 5, op(0.45)),
      stroke("M122 62c-8-9 8-14 0-26", TEAL.m, 5, op(0.45)),
      ellipse(100, 170, 72, 11, SAND),
      ellipse(100, 165, 72, 11, CREAM),
      ellipse(100, 165, 44, 6.5, SAND),
      path("M60 82h80v44a36 36 0 0 1-36 36h-8a36 36 0 0 1-36-36Z", TEAL.m),
      path("M122 82h18v44a36 36 0 0 1-18 31.2Z", INK, SHADE),
      stroke("M139 96h8a15 15 0 0 1 0 30h-9", TEAL.m, 10),
      rect(70, 100, 7, 38, CREAM, 3.5, GLINT),
      heart(100, 122, 22, CREAM),
      ellipse(100, 82, 40, 10, CREAM),
      ellipse(100, 83, 34, 6.5, BROWN.d),
      ellipse(91, 81.5, 13, 2, SAND, op(0.55)),
    ),
  ),
  art(
    "objects",
    "books-stack",
    "books stack reading library study",
    svg(
      V,
      shadow(100, 177, 80),
      book(20, 144, 160, 32, INDIGO.m),
      book(36, 112, 132, 32, RED.m),
      book(30, 80, 124, 32, YELLOW.m),
      group("rotate(-7 100 62)", book(50, 48, 104, 30, TEAL.m)),
    ),
  ),
  art(
    "objects",
    "camera",
    "camera photo photography snapshot picture",
    svg(
      V,
      shadow(100, 172, 72),
      rect(52, 50, 34, 22, INK, 6),
      rect(128, 54, 24, 16, RED.m, 6),
      rect(128, 54, 24, 16, INK, 6, SHADE),
      rect(28, 66, 144, 100, RED.m, 18),
      path("M28 84a18 18 0 0 1 18-18h108a18 18 0 0 1 18 18v10H28Z", CREAM),
      rect(28, 94, 144, 8, INK),
      path("M28 140h144v8a18 18 0 0 1-18 18H46a18 18 0 0 1-18-18Z", INK, DEEP),
      circle(100, 120, 40, INK),
      circle(100, 120, 32, WHITE, op(0.2)),
      circle(100, 120, 24, SKY.m),
      circle(100, 120, 15, INK, op(0.22)),
      stroke("M84 110a18 18 0 0 1 14-10", WHITE, 4),
      circle(114, 132, 4, WHITE, op(0.7)),
      rect(40, 74, 20, 10, YELLOW.m, 3),
      circle(150, 76, 5, INK),
    ),
  ),
  art(
    "objects",
    "headphones",
    "headphones audio music listen podcast",
    svg(
      V,
      stroke("M46 110V98a54 54 0 0 1 108 0v12", INK, 12),
      stroke("M69 53.8A54 54 0 0 1 131 53.8", YELLOW.m, 12),
      rect(24, 100, 44, 68, RED.m, 20),
      rect(58, 106, 22, 56, INK, 11),
      rect(33, 114, 16, 40, CREAM, 8, op(0.5)),
      rect(132, 100, 44, 68, RED.m, 20),
      rect(120, 106, 22, 56, INK, 11),
      rect(151, 114, 16, 40, CREAM, 8, op(0.5)),
    ),
  ),
  art(
    "objects",
    "backpack",
    "backpack bag school travel hiking",
    svg(
      V,
      shadow(100, 178, 64),
      stroke("M86 52a14 14 0 0 1 28 0", INK, 7),
      path("M50 118h-8a10 10 0 0 0-10 10v28a10 10 0 0 0 10 10h8Z", ORANGE.m),
      path("M50 118h-8a10 10 0 0 0-10 10v28a10 10 0 0 0 10 10h8Z", INK, SHADE),
      path("M150 118h8a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10h-8Z", ORANGE.m),
      path("M150 118h8a10 10 0 0 1 10 10v28a10 10 0 0 1-10 10h-8Z", INK, SHADE),
      path("M48 96a52 46 0 0 1 104 0v64a14 14 0 0 1-14 14H62a14 14 0 0 1-14-14Z", ORANGE.m),
      stroke("M62 98c0-20 16-34 38-34s38 14 38 34", CREAM, 3.5, op(0.85)),
      rect(135, 98, 6, 12, CREAM, 3),
      stroke("M60 86a44 40 0 0 1 24-26", CREAM, 4, GLINT),
      rect(62, 112, 76, 54, ORANGE.m, 14),
      rect(62, 112, 76, 54, INK, 14, SHADE),
      stroke("M74 128h52", CREAM, 3.5, op(0.85)),
      rect(93, 134, 14, 28, TEAL.m, 3),
      rect(90, 150, 20, 12, CREAM, 3),
    ),
  ),
  art(
    "objects",
    "plant-pot",
    "plant pot leaves houseplant green garden",
    svg(
      V,
      shadow(100, 183, 52),
      leaf(-62, 56, 20, GREEN.m, GREEN.d),
      leaf(62, 56, 20, GREEN.m, GREEN.d),
      leaf(-32, 76, 22, GREEN.d, GREEN.m),
      leaf(32, 76, 22, GREEN.d, GREEN.m),
      leaf(0, 92, 24, GREEN.m, GREEN.d),
      path("M62 136h76l-8 38a8 8 0 0 1-8 6H78a8 8 0 0 1-8-6Z", CLAY.m),
      path("M114 136h24l-8 38a8 8 0 0 1-8 6h-8Z", INK, SHADE),
      rect(70, 144, 6, 26, CLAY.l, 3, op(0.7)),
      rect(52, 118, 96, 20, CLAY.l, 7),
      rect(52, 130, 96, 8, INK, 4, SHADE),
      ellipse(100, 120, 42, 4, BROWN.d, op(0.9)),
    ),
  ),
  art(
    "objects",
    "lamp",
    "lamp light lighting desk home decor",
    svg(
      V,
      poly("50,114 150,114 182,184 18,184", YELLOW.m, op(0.2)),
      shadow(100, 185, 56, 5),
      rect(96, 110, 8, 52, INK, 3),
      path("M66 184c0-16 14-26 34-26s34 10 34 26Z", TEAL.m),
      path("M66 184c0-8 3-14 8-18l-1 18Z", WHITE, op(0.25)),
      path("M68 48h64l24 62a56 9 0 0 1-112 0Z", YELLOW.m),
      path("M100 48h32l24 62a56 9 0 0 1-56 9Z", INK, SHADE),
      ellipse(100, 48, 32, 6, CREAM),
      stroke("M148 114v22", INK, 2),
      circle(148, 140, 3.5, INK),
    ),
  ),
  art(
    "objects",
    "clock",
    "clock alarm time watch hours schedule",
    (() => {
      const ticks: string[] = [];
      for (let i = 0; i < 12; i++) {
        const major = i % 3 === 0;
        const [x0, y0] = pt(100, 108, major ? 33 : 37, i * 30);
        const [x1, y1] = pt(100, 108, 42, i * 30);
        ticks.push(line(x0, y0, x1, y1, INK, major ? 4 : 2.5));
      }
      const bell = (deg: N) => group(`rotate(${deg} 100 108)`, path("M82 56a18 18 0 0 1 36 0Z", YELLOW.m), rect(96, 34, 8, 6, INK, 3));
      return svg(
        V,
        line(70, 160, 58, 180, INK, 8),
        line(130, 160, 142, 180, INK, 8),
        bell(-38),
        bell(38),
        circle(100, 108, 58, RED.m),
        path("M100 50a58 58 0 0 1 0 116a74 74 0 0 0 0-116Z", INK, SHADE),
        circle(100, 108, 46, CREAM),
        ...ticks,
        line(100, 108, ...pt(100, 108, 36, -30), INK, 4.5),
        line(100, 108, ...pt(100, 108, 25, -150), INK, 5.5),
        circle(100, 108, 5.5, RED.m),
        stroke("M54 86a50 50 0 0 1 30-34", CREAM, 4, op(0.7)),
      );
    })(),
  ),
  art(
    "objects",
    "key",
    "key lock access security password",
    svg(
      V,
      group(
        "rotate(45 100 100)",
        path("M26 100a28 28 0 1 0 56 0a28 28 0 1 0-56 0ZM43 100a11 11 0 1 0 22 0a11 11 0 1 0-22 0Z", YELLOW.m, ' fill-rule="evenodd"'),
        path("M26 100a28 28 0 0 0 56 0h-17a11 11 0 0 1-22 0Z", YELLOW.d),
        rect(80, 93, 98, 14, YELLOW.m, 7),
        rect(80, 101, 98, 6, YELLOW.d, 3),
        rect(146, 104, 11, 20, YELLOW.d, 3),
        rect(163, 104, 11, 13, YELLOW.d, 3),
        rect(86, 89, 8, 22, YELLOW.d, 3),
        line(100, 97, 140, 97, CREAM, 2.5, op(0.8)),
        circle(54, 76, 3, CREAM, op(0.8)),
      ),
    ),
    "sticker",
  ),
  art(
    "objects",
    "gift-box",
    "gift box present ribbon bow surprise",
    svg(
      V,
      shadow(100, 178, 62),
      rect(46, 100, 108, 76, PURPLE.m, 6),
      path("M118 100h30a6 6 0 0 1 6 6v64a6 6 0 0 1-6 6h-30Z", INK, SHADE),
      rect(90, 100, 20, 76, YELLOW.m),
      rect(46, 104, 108, 7, INK, 0, SHADE),
      rect(38, 78, 124, 28, PURPLE.m, 7),
      rect(38, 78, 124, 28, WHITE, 7, op(0.12)),
      rect(90, 78, 20, 28, YELLOW.m),
      path("M100 76C84 44 54 52 62 68C68 80 90 78 100 76Z", YELLOW.m),
      path("M100 76C116 44 146 52 138 68C132 80 110 78 100 76Z", YELLOW.m),
      path("M100 76C88 56 72 58 72 66C74 74 90 76 100 76Z", YELLOW.d, op(0.55)),
      path("M100 76C112 56 128 58 128 66C126 74 110 76 100 76Z", YELLOW.d, op(0.55)),
      rect(91, 68, 18, 14, YELLOW.d, 5),
      sparkle(168, 52, 9, YELLOW.m),
      sparkle(32, 62, 6, CREAM),
    ),
  ),
  art(
    "objects",
    "umbrella",
    "umbrella rain weather season protection",
    svg(
      V,
      line(100, 22, 100, 40, INK, 5),
      stroke("M100 100v62a11 11 0 0 1-22 0", INK, 6),
      path("M22 106C22 62 56 36 100 36s78 26 78 70q-19.5-12-39 0-19.5-12-39 0-19.5-12-39 0-19.5-12-39 0Z", RED.m),
      path("M100 36C52 42 28 74 22 106q19-12 39 0C65 78 78 52 100 36Z", CREAM),
      path("M100 36v70q20-12 39 0C135 78 122 52 100 36Z", CREAM),
      path("M100 36c48 6 72 38 78 70q-19-12-39 0C135 78 122 52 100 36Z", INK, SHADE),
      path("M100 36v70q20-12 39 0C135 78 122 52 100 36Z", INK, SHADE),
      drop(36, 148, 9, SKY.m),
      drop(156, 140, 8, SKY.m),
      drop(172, 168, 9, SKY.m),
      drop(52, 176, 7, SKY.m),
    ),
  ),
  art(
    "objects",
    "bicycle",
    "bicycle bike cycling ride transport",
    (() => {
      const wheel = (cx: N) => {
        const spokes: string[] = [];
        for (let i = 0; i < 8; i++) {
          const [x, y] = pt(cx, 112, 30, i * 45);
          spokes.push(line(cx, 112, x, y, SLATE.m, 1.2));
        }
        return ring(cx, 112, 33, INK, 7) + ring(cx, 112, 28, SLATE.m, 2) + spokes.join("") + circle(cx, 112, 5, TEAL.m);
      };
      return svg(
        "0 0 220 150",
        group(
          "translate(0 -28)",
          shadow(110, 151, 92, 5),
          wheel(54),
          wheel(166),
          // frame: rear triangle, top tube, down tube and fork
          stroke("M54 112L98 118L86 72Z", TEAL.m, 6),
          stroke("M86 72H140L98 118", TEAL.m, 6),
          stroke("M142 76L166 112", TEAL.m, 6),
          // handlebar, saddle
          line(140, 72, 136, 54, INK, 5),
          stroke("M126 52h16q10 0 12 10", INK, 5),
          rect(70, 62, 32, 9, BROWN.m, 4.5),
          line(86, 71, 86, 76, INK, 5),
          // chainring and pedals
          circle(98, 118, 9, SLATE.m),
          circle(98, 118, 4, INK),
          line(98, 118, 88, 136, INK, 4),
          rect(80, 134, 16, 5, INK, 2.5),
          line(98, 118, 108, 100, INK, 4),
          rect(102, 96, 16, 5, INK, 2.5),
          // front basket
          path("M148 56h30l-4 24h-22Z", YELLOW.m),
          line(156, 58, 155, 80, INK, 1.5, op(0.4)),
          line(164, 58, 164, 80, INK, 1.5, op(0.4)),
          line(172, 58, 171, 80, INK, 1.5, op(0.4)),
        ),
      );
    })(),
  ),
  art(
    "objects",
    "balloon-bunch",
    "balloons party birthday float string",
    svg(
      V,
      stroke("M66 128Q74 160 100 186", INK, 1.8, op(0.45)),
      stroke("M108 106Q104 150 100 186", INK, 1.8, op(0.45)),
      stroke("M140 126Q128 160 100 186", INK, 1.8, op(0.45)),
      stroke("M96 100Q98 150 100 186", INK, 1.8, op(0.45)),
      balloon(64, 84, 28, 35, RED.m, -8),
      balloon(140, 82, 28, 35, TEAL.m, 8),
      balloon(104, 52, 28, 35, YELLOW.m, 2),
      balloon(100, 100, 28, 35, PURPLE.m, 0),
    ),
  ),
];

/* ------------------------------------------------------------------ business */

/** one coin: side wall + bottom edge + top face with an engraved ring */
const coin = (cx: N, top: N) =>
  rect(cx - 28, top, 56, 12, YELLOW.d) +
  ellipse(cx, top + 12, 28, 9, YELLOW.d) +
  ellipse(cx, top, 28, 9, YELLOW.m) +
  ringE(cx, top, 19, 5.5, YELLOW.d, 2);
const coinStack = (cx: N, base: N, count: number) => {
  let out = "";
  for (let i = 0; i < count; i++) out += coin(cx, base - 12 * (i + 1));
  return out;
};

const business: GraphicDraft[] = [
  art(
    "business",
    "laptop-chart",
    "laptop chart analytics growth report",
    svg(
      V,
      shadow(100, 164, 84),
      rect(36, 36, 128, 100, INK, 10),
      rect(44, 44, 112, 84, CREAM, 4),
      rect(56, 102, 14, 18, INDIGO.m, 3),
      rect(78, 92, 14, 28, INDIGO.m, 3),
      rect(100, 98, 14, 22, INDIGO.m, 3),
      rect(122, 80, 14, 40, TEAL.m, 3),
      stroke("M62 88L84 76L106 82L134 62", RED.m, 3.5),
      poly("142,56.4 136,66.9 130.2,58.7", RED.m),
      path("M16 136h168l-10 16a10 10 0 0 1-8 4H34a10 10 0 0 1-8-4Z", SLATE.m),
      path("M80 136h40v2a4 4 0 0 1-4 4H84a4 4 0 0 1-4-4Z", INK, DEEP),
    ),
  ),
  art(
    "business",
    "briefcase",
    "briefcase work job career office",
    svg(
      V,
      shadow(100, 176, 70),
      stroke("M76 76V62a12 12 0 0 1 12-12h24a12 12 0 0 1 12 12v14", INK, 9),
      rect(26, 72, 148, 100, ROYAL.m, 14),
      path("M26 120h148v38a14 14 0 0 1-14 14H40a14 14 0 0 1-14-14Z", INK, SHADE),
      rect(26, 116, 148, 6, INK, 0, op(0.2)),
      rect(36, 80, 128, 5, CREAM, 2.5, op(0.4)),
      rect(86, 104, 28, 28, YELLOW.m, 6),
      rect(98, 112, 4, 10, INK, 2),
      circle(100, 113, 3.5, INK),
    ),
  ),
  art(
    "business",
    "target-arrow",
    "target arrow goal bullseye aim success",
    svg(
      V,
      circle(92, 110, 64, RED.m),
      circle(92, 110, 50, CREAM),
      circle(92, 110, 36, RED.m),
      circle(92, 110, 22, CREAM),
      circle(92, 110, 8, RED.m),
      group(
        "rotate(-45 92 110)",
        rect(92, 107.5, 96, 5, INK, 2.5),
        poly("156,110 170,110 186,94 172,94", YELLOW.m),
        poly("156,110 170,110 186,126 172,126", YELLOW.m),
        poly("156,110 170,110 186,126 172,126", INK, SHADE),
        rect(184, 106.5, 7, 7, INK, 3),
      ),
    ),
  ),
  art(
    "business",
    "idea-bulb",
    "idea bulb light innovation creative thinking",
    (() => {
      const rays: string[] = [];
      for (const a of [-165, -127, -90, -53, -15]) {
        const [x0, y0] = pt(100, 84, 62, a);
        const [x1, y1] = pt(100, 84, 74, a);
        rays.push(line(x0, y0, x1, y1, ORANGE.m, 5));
      }
      return svg(
        V,
        ...rays,
        circle(100, 84, 48, YELLOW.m),
        path("M72 110L128 110L121 140H79Z", YELLOW.m),
        path("M100 36a48 48 0 0 1 0 96a54 54 0 0 0 0-96Z", INK, SHADE),
        circle(100, 84, 33, CREAM, op(0.38)),
        stroke("M91 134V108M109 134V108", ORANGE.m, 3.5),
        stroke("M91 108l4.5-9 4.5 9 4.5-9 4.5 9", ORANGE.m, 3.5),
        rect(78, 138, 44, 11, SLATE.m, 5.5),
        rect(82, 150, 36, 11, SLATE.d, 5.5),
        rect(90, 162, 20, 11, INK, 5.5),
        stroke("M66 70a36 36 0 0 1 14-18", CREAM, 5, op(0.7)),
      );
    })(),
  ),
  art(
    "business",
    "rocket",
    "rocket launch startup space growth boost",
    svg(
      V,
      group(
        "rotate(42 100 100)",
        path("M89 138c-3 14 4 26 11 38c7-12 14-24 11-38Z", YELLOW.m),
        path("M95 138c-1 8 1 14 5 21c4-7 6-13 5-21Z", ORANGE.m),
        path("M76 98L52 124V146L78 132Z", RED.m),
        path("M124 98L148 124V146L122 132Z", RED.m),
        path("M124 98L148 124V146L122 132Z", INK, SHADE),
        path("M100 22C126 44 132 86 124 124H76C68 86 74 44 100 22Z", CREAM),
        path("M100 22C126 44 132 86 124 124H100Z", INK, SHADE),
        path("M100 22C113 33 121 50 124 68H76C79 50 87 33 100 22Z", RED.m),
        path("M77 110H123L124 124H76Z", RED.m),
        circle(100, 92, 16, INK),
        circle(100, 92, 11, SKY.m),
        stroke("M94 88a8 8 0 0 1 6-4", CREAM, 3, op(0.9)),
        path("M86 124h28l-5 12H91Z", INK),
      ),
      sparkle(40, 50, 9, YELLOW.m),
      sparkle(166, 150, 7, YELLOW.m),
      circle(30, 140, 3, YELLOW.m),
    ),
  ),
  art(
    "business",
    "trophy",
    "trophy winner award champion prize success",
    svg(
      V,
      shadow(100, 176, 60),
      stroke("M64 52H54a10 10 0 0 0-10 10c0 16 10 26 26 28", YELLOW.d, 8),
      stroke("M136 52h10a10 10 0 0 1 10 10c0 16-10 26-26 28", YELLOW.d, 8),
      rect(90, 108, 20, 24, YELLOW.d, 3),
      rect(66, 130, 68, 14, YELLOW.d, 4),
      path("M62 34h76v40a38 38 0 0 1-76 0Z", YELLOW.m),
      path("M100 34h38v40a38 38 0 0 1-38 38Z", INK, SHADE),
      rect(58, 30, 84, 10, YELLOW.d, 5),
      rect(70, 50, 6, 30, CREAM, 3, GLINT),
      star(100, 70, 16, CREAM),
      path("M56 146h88a4 4 0 0 1 4 4v20H52v-20a4 4 0 0 1 4-4Z", INDIGO.m),
      rect(82, 154, 36, 8, CREAM, 3, op(0.9)),
    ),
  ),
  art(
    "business",
    "pie-chart",
    "pie chart statistics data share report",
    (() => {
      const cut = ` stroke="${CREAM}" stroke-width="3" stroke-linejoin="round"`;
      const lift = pt(0, 0, 13, 220);
      return svg(
        V,
        shadow(100, 180, 66, 7),
        path(sector(98, 108, 64, -20, 120), INDIGO.m, cut),
        path(sector(98, 108, 64, 120, 190), YELLOW.m, cut),
        path(sector(98, 108, 64, 250, 340), RED.m, cut),
        group(`translate(${lift[0]} ${lift[1]})`, path(sector(98, 108, 64, 190, 250), TEAL.m, cut)),
      );
    })(),
  ),
  art(
    "business",
    "bar-chart",
    "bar chart graph growth analytics statistics",
    svg(
      V,
      rect(24, 42, 160, 134, INK, 18, op(0.1)),
      rect(20, 34, 160, 134, CREAM, 18),
      line(40, 66, 160, 66, INK, 2, op(0.12)),
      line(40, 92, 160, 92, INK, 2, op(0.12)),
      line(40, 118, 160, 118, INK, 2, op(0.12)),
      rect(40, 108, 20, 36, INDIGO.m, 5),
      rect(70, 90, 20, 54, INDIGO.m, 5),
      rect(100, 100, 20, 44, INDIGO.m, 5),
      rect(130, 66, 20, 78, TEAL.m, 5),
      line(36, 146, 164, 146, INK, 3),
      stroke("M44 90L80 66L104 76L147 40.5", RED.m, 4),
      poly("156,34 151.7,44.3 145.1,36.7", RED.m),
    ),
  ),
  art(
    "business",
    "calendar",
    "calendar date schedule plan planner event",
    (() => {
      const cells: string[] = [];
      const cols = [46, 74, 102, 130];
      const rows = [98, 118, 138];
      rows.forEach((y, r) =>
        cols.forEach((x, c) => {
          const hit = r === 1 && c === 2;
          const mark = r === 2 && c === 0;
          cells.push(rect(x, y, 24, 16, hit ? TEAL.m : mark ? YELLOW.m : SLATE.m, 5));
        }),
      );
      return svg(
        V,
        shadow(100, 178, 66),
        rect(30, 44, 140, 126, CREAM, 16),
        path("M30 60a16 16 0 0 1 16-16h108a16 16 0 0 1 16 16v28H30Z", RED.m),
        path("M30 74h140v14H30Z", INK, SHADE),
        rect(60, 30, 10, 28, INK, 5),
        rect(130, 30, 10, 28, INK, 5),
        ...cells,
        stroke("M107 126l6 6 11-12", CREAM, 3.5),
      );
    })(),
  ),
  art(
    "business",
    "megaphone",
    "megaphone announcement marketing promotion loudspeaker",
    svg(
      V,
      group(
        "rotate(-14 100 100)",
        stroke("M146 74a24 24 0 0 1 0 36", RED.m, 5),
        stroke("M154 62a38 38 0 0 1 0 60", RED.m, 5),
        stroke("M162 50a52 52 0 0 1 0 84", RED.m, 5),
        rect(48, 100, 16, 38, INK, 6),
        poly("68,80 120,50 120,134 68,104", YELLOW.m),
        poly("68,92 120,92 120,134 68,104", INK, SHADE),
        poly("90,66 98,61.5 98,122.5 90,118", RED.m),
        ellipse(120, 92, 9, 42, YELLOW.d),
        ellipse(122, 92, 5, 36, INK, op(0.4)),
        rect(26, 74, 44, 36, RED.m, 10),
        rect(26, 96, 44, 14, INK, 7, SHADE),
        rect(36, 80, 20, 5, CREAM, 2.5, GLINT),
      ),
    ),
  ),
  art(
    "business",
    "shopping-bags",
    "shopping bag retail store sale buy",
    svg(
      V,
      shadow(100, 182, 68),
      stroke("M124 66V54a13 13 0 0 1 26 0v12", INK, 5),
      path("M106 64h60l4 104a6 6 0 0 1-6 6h-56a6 6 0 0 1-6-6Z", TEAL.m),
      path("M106 64h60l1 14h-62Z", INK, SHADE),
      stroke("M72 82V64a18 18 0 0 1 36 0v18", INK, 6),
      path("M46 80h88l7 92a8 8 0 0 1-8 8H47a8 8 0 0 1-8-8Z", PINK.m),
      path("M112 80h22l7 92a8 8 0 0 1-8 8h-21Z", INK, SHADE),
      path("M46 80h88l1 14H45Z", INK, SHADE),
      circle(90, 130, 22, CREAM),
      star(90, 130, 14, YELLOW.m),
    ),
    "sticker",
  ),
  art(
    "business",
    "wallet",
    "wallet money cash savings finance payment",
    svg(
      V,
      shadow(100, 174, 72),
      group("rotate(6 100 70)", rect(48, 36, 100, 40, GREEN.m, 6), rect(48, 36, 100, 40, INK, 6, SHADE)),
      group(
        "rotate(-6 100 70)",
        rect(50, 40, 100, 40, GREEN.m, 6),
        outline(58, 47, 84, 26, 5, CREAM, 2, op(0.6)),
        circle(100, 60, 9, CREAM, op(0.55)),
      ),
      rect(26, 74, 148, 98, BROWN.m, 16),
      path("M26 104h148v52a16 16 0 0 1-16 16H42a16 16 0 0 1-16-16Z", BROWN.d),
      line(36, 112, 164, 112, CREAM, 2, ' stroke-dasharray="5 5" opacity="0.7"'),
      path("M178 120h-34a18 18 0 0 0 0 36h34Z", YELLOW.m),
      circle(146, 138, 6, BROWN.d),
    ),
  ),
  art(
    "business",
    "coin-stacks",
    "coins money savings finance cash investment",
    svg(
      V,
      shadow(100, 180, 78, 8),
      coinStack(50, 162, 3),
      coinStack(150, 158, 2),
      coinStack(100, 172, 5),
      group(
        "rotate(14 150 50)",
        circle(150, 50, 21, YELLOW.m),
        ring(150, 50, 15, YELLOW.d, 2.5),
        stroke("M158 42c-3-5-16-5-16 3 0 7 16 5 16 12 0 8-13 8-17 3", YELLOW.d, 3.5),
        line(150, 36, 150, 64, YELLOW.d, 3.5),
        stroke("M138 40a14 14 0 0 1 8-8", CREAM, 3, GLINT),
      ),
      sparkle(40, 60, 8, YELLOW.m),
    ),
  ),
];

/* ------------------------------------------------------------------ food */

const bean = (x: N, y: N, rot: N, s = 1) =>
  group(
    `translate(${x} ${y}) rotate(${rot}) scale(${s})`,
    ellipse(0, 0, 27, 38, BROWN.m),
    ellipse(0, 0, 27, 38, INK, SHADE),
    ellipse(-3, -3, 24, 34.5, BROWN.m),
    stroke("M-3 -34C-16 -18 14 -4 1 10C-10 22 9 30 2 35", BROWN.d, 5),
    ellipse(-14, -14, 3.5, 10, CREAM, op(0.4)),
  );

/** one croissant lobe on a circle of radius 58 about (100,150); a = radial, b = tangential half size */
const croissantLobe = (deg: N, a: N, b: N) => {
  const [x, y] = pt(100, 150, 58, deg);
  return group(
    `rotate(${r2(deg + 90)} ${x} ${y})`,
    ellipse(x, y, b, a, ORANGE.d),
    ellipse(x, y + 1.5, b - 2, a - 3, ORANGE.m),
    ellipse(x - b * 0.1, y - a * 0.22, b * 0.6, a * 0.55, ORANGE.l),
  );
};

/** wavy-edged ice-cream scoop */
const scoop = (cx: N, cy: N, n: N, p: N, h: N, fill: string) => {
  const left = cx - (n * p) / 2;
  const w = n * p;
  const wave = `q${-p / 2} 10 ${-p} 0${`t${-p} 0`.repeat(n - 1)}`;
  return (
    path(`M${left} ${cy}a${w / 2} ${h} 0 0 1 ${w} 0${wave}Z`, fill) +
    ellipse(cx - w * 0.22, cy - h * 0.55, w * 0.1, h * 0.22, CREAM, op(0.5))
  );
};

const citrusSlice = (cx: N, cy: N, r: N, peel: string, pith: string, flesh: string) => {
  let segs = "";
  for (let i = 0; i < 8; i++) segs += path(sector(cx, cy, r * 0.8, i * 45 + 3, i * 45 + 42), flesh, ` stroke="${flesh}" stroke-width="3" stroke-linejoin="round"`);
  return circle(cx, cy, r, peel) + circle(cx, cy, r * 0.88, pith) + segs;
};

const APPLE =
  "M100 62C84 44 40 50 40 100C40 142 66 172 86 172C94 172 97 168 100 168C103 168 106 172 114 172C134 172 160 142 160 100C160 50 116 44 100 62Z";
const AVOCADO = "M100 22C130 22 152 62 154 104C156 150 132 184 100 184C68 184 44 150 46 104C48 62 70 22 100 22Z";
const BERRY =
  "M100 68C86 62 68 58 58 68C48 80 50 108 62 132C72 152 88 172 98 180C100 182 100 182 102 180C112 172 128 152 138 132C150 108 152 80 142 68C132 58 114 62 100 68Z";
const LEMON =
  "M0 -46C34 -46 56 -32 62 -14C66 -10 70 -4 80 0C70 4 66 10 62 14C56 32 34 46 0 46C-34 46 -56 32 -62 14C-66 10 -70 4 -80 0C-70 -4 -66 -10 -62 -14C-56 -32 -34 -46 0 -46Z";

const food: GraphicDraft[] = [
  art(
    "food",
    "coffee-beans",
    "coffee beans cafe roast espresso cherry",
    svg(
      V,
      path("M100 82C90 60 66 54 46 62C54 84 80 92 100 82Z", GREEN.m),
      path("M100 82C110 60 134 54 154 62C146 84 120 92 100 82Z", GREEN.m),
      line(98, 80, 62, 66, CREAM, 2, op(0.5)),
      line(102, 80, 138, 66, CREAM, 2, op(0.5)),
      bean(62, 112, -28),
      bean(138, 108, 30),
      bean(100, 146, 78),
      circle(100, 70, 13, RED.m),
      circle(100, 70, 13, INK, SHADE),
      circle(96, 66, 10, RED.m),
      ellipse(94, 62, 3, 4.5, CREAM, op(0.55)),
    ),
    "sticker",
  ),
  art(
    "food",
    "croissant",
    "croissant bakery pastry breakfast french",
    svg(
      V,
      shadow(100, 158, 70),
      croissantLobe(206, 14, 27),
      croissantLobe(334, 14, 27),
      croissantLobe(238, 33, 25),
      croissantLobe(302, 33, 25),
      croissantLobe(270, 40, 30),
    ),
    "sticker",
  ),
  art(
    "food",
    "burger",
    "burger hamburger fast food lunch sandwich",
    (() => {
      const seeds: Array<[N, N, N]> = [
        [72, 82, -30],
        [98, 66, 10],
        [124, 78, 35],
        [100, 90, -15],
        [140, 92, 25],
        [60, 98, 20],
      ];
      return svg(
        V,
        ellipse(100, 186, 70, 6, BROWN.d, op(0.2)),
        path("M32 160H168V168a14 14 0 0 1-14 14H46a14 14 0 0 1-14-14Z", ORANGE.m),
        path("M32 160H168V168a14 14 0 0 1-14 14H46a14 14 0 0 1-14-14Z", BROWN.d, op(0.22)),
        rect(28, 134, 144, 25, BROWN.d, 12.5),
        rect(26, 128, 148, 9, YELLOW.m, 3),
        poly("118,134 144,134 131,158", YELLOW.m),
        poly("46,134 66,134 56,150", YELLOW.m),
        rect(30, 118, 140, 12, RED.m, 6),
        path("M24 110q9.5-9 19 0t19 0t19 0t19 0t19 0t19 0t19 0t19 0v12H24Z", GREEN.m),
        path("M30 108C30 66 62 42 100 42S170 66 170 108Z", ORANGE.m),
        path("M100 42C138 42 170 66 170 108H128C150 80 130 56 100 42Z", BROWN.d, op(0.2)),
        stroke("M48 88C54 70 66 58 82 52", CREAM, 5, op(0.5)),
        ...seeds.map(([x, y, a]) => ellipse(x, y, 4.5, 2.4, CREAM, ` transform="rotate(${a} ${x} ${y})"`)),
      );
    })(),
    "sticker",
  ),
  art(
    "food",
    "pizza-slice",
    "pizza slice cheese pepperoni italian",
    svg(
      V,
      group(
        "rotate(-12 100 100)",
        path("M36 62L164 62L100 180Z", YELLOW.m, ` stroke="${YELLOW.m}" stroke-width="12" stroke-linejoin="round"`),
        stroke("M34 58C70 44 130 44 166 58", ORANGE.m, 24),
        stroke("M44 48C74 40 126 40 156 48", CREAM, 4, op(0.45)),
        circle(78, 94, 14, RED.m),
        circle(124, 90, 13, RED.m),
        circle(100, 136, 13, RED.m),
        circle(74, 90, 3, CREAM, op(0.4)),
        circle(84, 99, 2.4, CREAM, op(0.4)),
        circle(120, 86, 3, CREAM, op(0.4)),
        circle(97, 132, 3, CREAM, op(0.4)),
        ellipse(104, 112, 6, 3.4, GREEN.m, ' transform="rotate(30 104 112)"'),
        ellipse(70, 118, 6, 3.4, GREEN.m, ' transform="rotate(-20 70 118)"'),
        ellipse(132, 118, 6, 3.4, GREEN.m, ' transform="rotate(-30 132 118)"'),
        ellipse(98, 160, 5, 3, GREEN.m, ' transform="rotate(70 98 160)"'),
      ),
    ),
    "sticker",
  ),
  art(
    "food",
    "avocado",
    "avocado half fruit guacamole healthy vegan",
    svg(
      V,
      group(
        "rotate(14 100 100)",
        path(AVOCADO, GREEN.d),
        group("translate(100 106) scale(0.88) translate(-100 -106)", path(AVOCADO, GREEN.l)),
        group("translate(100 112) scale(0.78) translate(-100 -112)", path(AVOCADO, YELLOW.l)),
        rimCircle(100, 138, 28, BROWN.m),
        ellipse(90, 128, 5, 9, CREAM, ' opacity="0.4" transform="rotate(30 90 128)"'),
      ),
    ),
    "sticker",
  ),
  art(
    "food",
    "cupcake",
    "cupcake dessert sweet bakery birthday muffin",
    (() => {
      const pleats: string[] = [];
      for (let i = 1; i <= 5; i++) {
        const f = i / 6;
        pleats.push(line(r2(54 + 92 * f), 116, r2(66 + 68 * f), 176, INK, 2.5, op(0.16)));
      }
      const sprinkles: Array<[N, N, N, string]> = [
        [78, 98, 30, YELLOW.m],
        [112, 100, -25, CREAM],
        [96, 80, 60, TEAL.m],
        [124, 84, 10, YELLOW.m],
        [86, 62, -20, CREAM],
        [106, 66, 40, TEAL.m],
      ];
      return svg(
        V,
        path("M52 112H148L136 172a10 10 0 0 1-10 8H74a10 10 0 0 1-10-8Z", TEAL.m),
        ...pleats,
        rect(40, 96, 120, 24, PINK.m, 12),
        rect(40, 96, 120, 24, INK, 12, op(0.2)),
        rect(54, 76, 92, 28, PINK.m, 14),
        rect(54, 76, 92, 28, INK, 14, SHADE),
        path("M72 80C72 60 90 54 100 38C110 54 128 60 128 80Z", PINK.m),
        stroke("M62 92C78 99 122 99 138 92", CREAM, 3, op(0.4)),
        ...sprinkles.map(([x, y, a, c]) => rect(x - 5, y - 1.8, 10, 3.6, c, 1.8, ` transform="rotate(${a} ${x} ${y})"`)),
        circle(100, 32, 11, RED.m),
        circle(100, 32, 11, INK, SHADE),
        circle(97, 29, 8.5, RED.m),
        stroke("M100 22C100 14 106 8 113 6", INK, 2.2),
      );
    })(),
    "sticker",
  ),
  art(
    "food",
    "ice-cream",
    "ice cream cone dessert summer scoop",
    svg(
      V,
      path("M60 104L140 104L100 184Z", ORANGE.l, ` stroke="${ORANGE.l}" stroke-width="8" stroke-linejoin="round"`),
      hatch(
        [
          [62, 106],
          [138, 106],
          [100, 180],
        ],
        45,
        14,
        ORANGE.d,
        3,
        op(0.7),
      ),
      hatch(
        [
          [62, 106],
          [138, 106],
          [100, 180],
        ],
        -45,
        14,
        ORANGE.d,
        3,
        op(0.7),
      ),
      scoop(100, 106, 6, 17, 38, TEAL.m),
      scoop(100, 74, 5, 16, 32, PINK.m),
      circle(100, 34, 10, RED.m),
      stroke("M100 25C100 16 106 11 113 9", ORANGE.d, 2.4),
      ellipse(97, 31, 3, 4.5, CREAM, op(0.55)),
    ),
    "sticker",
  ),
  art(
    "food",
    "apple",
    "apple fruit red healthy fresh snack",
    svg(
      V,
      rim(APPLE, RED.m, 100, 110),
      stroke("M100 62C100 48 104 38 112 28", BROWN.d, 6),
      path("M108 42C112 24 130 20 148 28C144 46 126 54 108 42Z", GREEN.m),
      line(112, 40, 140, 31, CREAM, 2, op(0.55)),
      stroke("M54 96C56 80 64 68 76 62", CREAM, 6, GLINT),
    ),
    "sticker",
  ),
  art(
    "food",
    "orange",
    "orange citrus fruit juice vitamin slice",
    (() => {
      const dots: Array<[N, N]> = [
        [60, 96],
        [78, 126],
        [104, 82],
        [98, 118],
        [124, 100],
        [70, 76],
        [112, 140],
        [52, 118],
        [92, 64],
        [128, 126],
      ];
      return svg(
        V,
        rimCircle(86, 100, 58, ORANGE.m),
        ...dots.map(([x, y]) => circle(x, y, 1.8, ORANGE.d, op(0.55))),
        circle(86, 46, 4.5, ORANGE.d),
        path("M88 46C92 28 112 22 130 28C126 46 108 54 88 46Z", GREEN.m),
        line(92, 45, 120, 32, CREAM, 2, op(0.55)),
        stroke("M50 86C52 72 60 62 72 58", CREAM, 6, GLINT),
        citrusSlice(142, 142, 34, ORANGE.d, CREAM, ORANGE.l),
      );
    })(),
    "sticker",
  ),
  art(
    "food",
    "lemon",
    "lemon citrus fruit sour yellow juice",
    svg(
      V,
      group("translate(94 86) rotate(-24)", rim(LEMON, YELLOW.m, 0, 0, 0.93, -4, -3), circle(80, 0, 5, YELLOW.d), stroke("M-44 -22C-36 -34 -22 -40 -8 -41", CREAM, 5, GLINT)),
      path("M146 34C152 20 170 16 184 24C178 38 162 44 146 34Z", GREEN.m),
      line(150, 33, 174, 24, CREAM, 2, op(0.55)),
      citrusSlice(132, 148, 32, YELLOW.d, CREAM, YELLOW.l),
    ),
    "sticker",
  ),
  art(
    "food",
    "strawberry",
    "strawberry berry fruit sweet summer red",
    (() => {
      const seeds: Array<[N, N]> = [
        [78, 92],
        [100, 96],
        [122, 92],
        [68, 112],
        [89, 118],
        [111, 118],
        [132, 112],
        [78, 136],
        [100, 140],
        [122, 136],
        [89, 158],
        [111, 158],
      ];
      return svg(
        V,
        rim(BERRY, RED.m, 100, 124),
        ...seeds.map(([x, y]) => ellipse(x, y, 3.4, 5.4, YELLOW.m)),
        path("M100 72C86 60 66 56 52 64C64 80 84 84 100 78C116 84 136 80 148 64C134 56 114 60 100 72Z", GREEN.m),
        path("M100 70C93 58 95 46 100 38C105 46 107 58 100 70Z", GREEN.m),
        stroke("M64 96C66 84 72 76 82 72", CREAM, 5, GLINT),
      );
    })(),
    "sticker",
  ),
  art(
    "food",
    "cake-slice",
    "cake slice dessert sweet bakery chocolate",
    (() => {
      const tip: [N, N] = [28, 94];
      const front: [N, N] = [168, 112];
      const back: [N, N] = [150, 58];
      const h = 54;
      const face = (a: N, b: N, fill: string) =>
        poly(`${tip[0]},${r2(tip[1] + a * h)} ${front[0]},${r2(front[1] + a * h)} ${front[0]},${r2(front[1] + b * h)} ${tip[0]},${r2(tip[1] + b * h)}`, fill);
      return svg(
        V,
        ellipse(100, 172, 88, 12, SLATE.m),
        ellipse(100, 168, 88, 12, CREAM),
        face(0, 1, BROWN.m),
        face(0.38, 0.52, CREAM),
        face(0.78, 0.9, CREAM),
        poly(`${front[0]},${front[1]} ${back[0]},${back[1]} ${back[0]},${back[1] + h} ${front[0]},${front[1] + h}`, BROWN.m),
        poly(`${front[0]},${front[1]} ${back[0]},${back[1]} ${back[0]},${back[1] + h} ${front[0]},${front[1] + h}`, INK, op(0.22)),
        poly(`${tip[0]},${tip[1]} ${back[0]},${back[1]} ${front[0]},${front[1]}`, PINK.m),
        poly(`${tip[0]},${tip[1]} ${back[0]},${back[1]} ${front[0]},${front[1]}`, CREAM, op(0.25)),
        face(0, 0.18, PINK.m),
        circle(124, 86, 11, RED.m),
        circle(124, 86, 11, INK, SHADE),
        circle(121, 83, 8.5, RED.m),
        stroke("M124 76C124 68 130 62 137 60", INK, 2.2),
      );
    })(),
    "sticker",
  ),
];

/* ------------------------------------------------------------------ travel */

/** hot-air-balloon gore between two meridians k0..k1 (-1..1) */
const gore = (k0: N, k1: N, fill: string, x_ = "") => {
  const along = (k: N) => `C${r2(100 + 62 * k)} 24 ${r2(100 + 72 * k)} 108 ${r2(100 + 12 * k)} 138`;
  const back = (k: N) => `C${r2(100 + 72 * k)} 108 ${r2(100 + 62 * k)} 24 100 20`;
  return path(`M100 20${along(k1)}L${r2(100 + 12 * k0)} 138${back(k0)}Z`, fill, x_);
};

/** drooping palm frond growing from (x,y) */
const frond = (x: N, y: N, deg: N, len: N, fill: string) =>
  group(`translate(${x} ${y}) rotate(${deg}) scale(${len / 62})`, path("M0 0C12 -16 42 -20 64 -2C46 -6 20 2 0 0Z", fill));

const travel: GraphicDraft[] = [
  art(
    "travel",
    "airplane",
    "airplane flight travel plane fly trip",
    svg(
      V,
      stroke("M10 188C22 176 32 170 46 156", SKY.m, 3.5, ' stroke-dasharray="1 8" opacity="0.9"'),
      group(
        "rotate(45 100 100)",
        poly("88,66 18,126 18,138 88,114", SKY.m),
        poly("112,66 182,126 182,138 112,114", SKY.m),
        poly("112,66 182,126 182,138 112,114", INK, SHADE),
        poly("88,140 58,162 58,170 88,160", SKY.m),
        poly("112,140 142,162 142,170 112,160", SKY.m),
        poly("112,140 142,162 142,170 112,160", INK, SHADE),
        rect(48, 108, 10, 20, SKY.d, 5),
        rect(142, 108, 10, 20, SKY.d, 5),
        path("M100 16C109 16 113 30 113 46V132C113 148 108 160 100 172C92 160 87 148 87 132V46C87 30 91 16 100 16Z", CREAM),
        path("M100 16C109 16 113 30 113 46V132C113 148 108 160 100 172Z", INK, SHADE),
        path("M93 40C93 32 107 32 107 40L105 50H95Z", SKY.d),
        path("M100 16C106 16 110 24 111 34H89C90 24 94 16 100 16Z", RED.m),
        rect(95, 126, 10, 6, RED.m, 2),
      ),
    ),
  ),
  art(
    "travel",
    "hot-air-balloon",
    "balloon travel adventure sky flight fly",
    svg(
      V,
      gore(-1, -0.6, YELLOW.m),
      gore(-0.6, -0.2, RED.m),
      gore(-0.2, 0.2, CREAM),
      gore(0.2, 0.6, RED.m),
      gore(0.6, 1, YELLOW.m),
      gore(0, 1, INK, SHADE),
      path("M88 138h24l-3 9H91Z", INK),
      line(90, 147, 84, 170, INK, 2),
      line(110, 147, 116, 170, INK, 2),
      line(100, 147, 100, 170, INK, 2),
      rect(80, 168, 40, 22, BROWN.m, 5),
      rect(80, 168, 40, 6, INK, 3, SHADE),
      line(90, 176, 90, 188, INK, 2, op(0.2)),
      line(100, 176, 100, 188, INK, 2, op(0.2)),
      line(110, 176, 110, 188, INK, 2, op(0.2)),
    ),
  ),
  art(
    "travel",
    "suitcase",
    "suitcase luggage travel baggage trip vacation",
    svg(
      V,
      shadow(100, 186, 62),
      stroke("M78 62V48a8 8 0 0 1 8-8h28a8 8 0 0 1 8 8v14", INK, 8),
      circle(70, 180, 7, INK),
      circle(130, 180, 7, INK),
      rect(40, 60, 120, 116, INDIGO.m, 14),
      path("M124 60h22a14 14 0 0 1 14 14v88a14 14 0 0 1-14 14h-22Z", INK, SHADE),
      rect(40, 100, 120, 14, YELLOW.m),
      rect(91, 96, 18, 22, CREAM, 4),
      rect(97, 103, 6, 8, INK, 2),
      line(66, 66, 66, 94, INK, 4, op(0.18)),
      line(134, 66, 134, 94, INK, 4, op(0.18)),
      circle(66, 146, 13, RED.m),
      star(66, 146, 8, CREAM),
      group("rotate(-8 120 146)", rect(104, 136, 34, 22, TEAL.m, 5), circle(121, 147, 5, CREAM)),
    ),
  ),
  art(
    "travel",
    "compass",
    "compass navigation direction explore adventure",
    (() => {
      const ticks: string[] = [];
      for (let i = 0; i < 16; i++) {
        const major = i % 4 === 0;
        const [x0, y0] = pt(100, 108, major ? 40 : 47, i * 22.5);
        const [x1, y1] = pt(100, 108, 54, i * 22.5);
        ticks.push(line(x0, y0, x1, y1, INK, major ? 3.5 : 2, op(0.6)));
      }
      return svg(
        V,
        rect(90, 14, 20, 16, YELLOW.d, 4),
        ring(100, 16, 11, YELLOW.d, 5),
        circle(100, 108, 78, YELLOW.d),
        circle(100, 108, 70, YELLOW.m),
        circle(100, 108, 60, CREAM),
        ...ticks,
        group("rotate(38 100 108)", poly("100,56 113,108 87,108", RED.m), poly("100,160 113,108 87,108", INK, op(0.8))),
        circle(100, 108, 7, CREAM),
        circle(100, 108, 3.5, INK),
        stroke("M42 86A62 62 0 0 1 70 54", CREAM, 5, op(0.9)),
        path("M100 108m-78 0a78 78 0 0 1 78-78v8a70 70 0 0 0-70 70Z", WHITE, op(0.18)),
      );
    })(),
  ),
  art(
    "travel",
    "map-pin",
    "map pin location place destination gps",
    svg(
      V,
      ringE(100, 168, 62, 16, RED.m, 3, op(0.3)),
      ringE(100, 168, 40, 10, RED.m, 3, op(0.5)),
      ellipse(100, 168, 18, 5, INK, op(0.25)),
      rim("M100 20C66 20 40 46 40 80C40 124 100 172 100 172C100 172 160 124 160 80C160 46 134 20 100 20Z", RED.m, 100, 90, 0.92, -4, -3),
      circle(100, 82, 27, CREAM),
      circle(100, 82, 14, RED.m),
      stroke("M58 62C62 48 72 38 86 34", CREAM, 5, GLINT),
    ),
    "sticker",
  ),
  art(
    "travel",
    "tent",
    "tent camping outdoor nature adventure hiking",
    svg(
      V,
      ellipse(100, 168, 90, 14, GREEN.m),
      poly("26,166 44,100 62,166", GREEN.d, ` stroke="${GREEN.d}" stroke-width="6" stroke-linejoin="round"`),
      poly("146,166 162,92 178,166", GREEN.d, ` stroke="${GREEN.d}" stroke-width="6" stroke-linejoin="round"`),
      poly("100,50 38,168 162,168", TEAL.m, ` stroke="${TEAL.m}" stroke-width="8" stroke-linejoin="round"`),
      poly("100,50 162,168 100,168", INK, SHADE),
      poly("100,96 70,168 130,168", INK),
      poly("100,96 62,168 82,168 100,132", TEAL.m),
      poly("100,96 62,168 82,168 100,132", CREAM, op(0.25)),
      line(100, 50, 100, 26, INK, 3.5),
      poly("100,26 124,33 100,40", YELLOW.m),
      line(46, 146, 22, 170, INK, 2, op(0.5)),
      line(154, 146, 178, 170, INK, 2, op(0.5)),
    ),
  ),
  art(
    "travel",
    "palm-island",
    "palm island beach tropical summer sea",
    svg(
      V,
      circle(140, 62, 28, YELLOW.m),
      ellipse(100, 158, 86, 24, SKY.m),
      path("M30 150C34 134 70 128 100 128S166 134 170 150C150 164 50 164 30 150Z", SAND),
      stroke("M96 138C92 108 100 84 114 62", BROWN.m, 9),
      frond(114, 62, -176, 58, GREEN.d),
      frond(114, 62, -142, 62, GREEN.m),
      frond(114, 62, -40, 62, GREEN.m),
      frond(114, 62, -4, 58, GREEN.d),
      frond(114, 62, -100, 40, GREEN.d),
      circle(110, 70, 5, BROWN.m),
      circle(120, 71, 5, BROWN.m),
      stroke("M26 164q10-6 20 0t20 0", SAND, 3, op(0.7)),
      stroke("M118 170q10-6 20 0t20 0", SAND, 3, op(0.7)),
    ),
  ),
  art(
    "travel",
    "camper-van",
    "camper van road trip travel vanlife",
    svg(
      V,
      shadow(100, 164, 84),
      group("rotate(-5 100 56)", ellipse(96, 54, 52, 7.5, RED.m), ellipse(96, 54, 48, 2.2, CREAM)),
      rect(46, 58, 4, 10, INK, 2),
      rect(120, 58, 4, 10, INK, 2),
      path("M18 142V84a24 24 0 0 1 24-24H126c10 0 16 3 22 10l30 36c4 5 6 9 6 16v20a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6Z", CREAM),
      path("M18 112H184v30a6 6 0 0 1-6 6H24a6 6 0 0 1-6-6Z", TEAL.m),
      rect(18, 106, 166, 7, YELLOW.m),
      rect(34, 72, 34, 28, SKY.m, 5),
      rect(74, 72, 34, 28, SKY.m, 5),
      path("M116 72h12c6 0 9 2 13 6l16 22h-41Z", SKY.m),
      path("M184 126h-14v-10h14Z", YELLOW.m),
      rect(170, 134, 18, 8, INK, 3),
      circle(60, 150, 19, INK),
      circle(60, 150, 8, CREAM),
      circle(144, 150, 19, INK),
      circle(144, 150, 8, CREAM),
    ),
  ),
  art(
    "travel",
    "sailboat",
    "sailboat boat sailing sea ocean yacht",
    svg(
      V,
      poly("104,30 104,122 164,122", CREAM),
      poly("104,30 104,122 164,122", INK, SHADE),
      poly("96,46 96,122 50,122", RED.m),
      rect(98, 26, 5, 100, INK, 2),
      poly("103,24 126,31 103,38", YELLOW.m),
      path("M32 130H168L150 162a10 10 0 0 1-8 4H58a10 10 0 0 1-8-4Z", INDIGO.m),
      rect(40, 138, 120, 5, CREAM, 2.5, op(0.8)),
      path("M20 170q10-8 20 0t20 0t20 0t20 0t20 0t20 0t20 0t20 0v4a10 10 0 0 1-10 10H30a10 10 0 0 1-10-10Z", SKY.m),
    ),
  ),
  art(
    "travel",
    "globe",
    "globe world earth planet global map",
    svg(
      V,
      stroke("M170 92A70 70 0 0 1 100 162", INK, 6),
      line(100, 160, 100, 172, INK, 6),
      rect(68, 170, 64, 10, INK, 5),
      rimCircle(100, 92, 62, SKY.m, -4, -4, 0.92),
      path("M62 62C70 50 88 50 92 62C96 72 86 78 90 90C94 102 82 112 76 122C68 118 66 106 60 98C54 88 54 70 62 62Z", GREEN.m),
      path("M112 56C124 50 142 56 148 70C152 82 142 88 136 86C130 92 138 106 130 118C122 126 114 116 112 106C110 96 116 92 110 82C106 72 104 62 112 56Z", GREEN.m),
      path("M124 134C132 130 142 134 140 142C138 148 128 148 124 142Z", GREEN.m),
      ringE(100, 92, 26, 62, CREAM, 2, op(0.4)),
      line(38, 92, 162, 92, CREAM, 2, op(0.4)),
      stroke("M46 62Q100 76 154 62", CREAM, 2, op(0.4)),
      stroke("M46 122Q100 108 154 122", CREAM, 2, op(0.4)),
      stroke("M52 56A56 56 0 0 1 72 38", CREAM, 5, GLINT),
    ),
  ),
];

/* ------------------------------------------------------------------ education */

const education: GraphicDraft[] = [
  art(
    "education",
    "graduation-cap",
    "graduation cap education school degree university",
    svg(
      V,
      path("M52 92V130C52 150 148 150 148 130V92Z", INDIGO.m),
      path("M100 92H148V130C148 141 126 147 100 148Z", INK, SHADE),
      poly("18,72 100,106 100,116 18,82", INK),
      poly("182,72 100,106 100,116 182,82", INK),
      poly("182,72 100,106 100,116 182,82", INK, SHADE),
      poly("100,38 182,72 100,106 18,72", INDIGO.d),
      poly("100,38 100,106 18,72", CREAM, op(0.12)),
      stroke("M100 72L166 78V122", YELLOW.m, 3.5),
      circle(100, 72, 7, YELLOW.m),
      path("M160 120h12l4 28h-20Z", YELLOW.m),
      circle(166, 119, 5, YELLOW.d),
      line(163, 130, 162, 146, YELLOW.d, 1.8, op(0.6)),
      line(169, 130, 170, 146, YELLOW.d, 1.8, op(0.6)),
    ),
  ),
  art(
    "education",
    "open-book",
    "book open reading study learn library",
    (() => {
      const left: string[] = [];
      const right: string[] = [];
      for (let i = 0; i < 5; i++) {
        const y = 86 + i * 13;
        const w = i === 4 ? 26 : 44;
        left.push(stroke(`M40 ${y}C54 ${y - 4} 68 ${y - 4} ${40 + w} ${y + 2}`, SLATE.m, 3.5));
        right.push(stroke(`M${160 - w} ${y + 2}C132 ${y - 4} 146 ${y - 4} 160 ${y}`, SLATE.m, 3.5));
      }
      return svg(
        V,
        shadow(100, 176, 76),
        path("M16 70C46 56 82 58 100 76C118 58 154 56 184 70V152C154 140 118 142 100 160C82 142 46 140 16 152Z", INDIGO.m),
        path("M28 62C54 54 84 56 98 70V150C84 138 54 136 28 144Z", CREAM),
        path("M172 62C146 54 116 56 102 70V150C116 138 146 136 172 144Z", CREAM),
        path("M82 60C88 62 94 66 98 70V150C94 146 88 142 82 140Z", INK, op(0.07)),
        path("M118 60C112 62 106 66 102 70V150C106 146 112 142 118 140Z", INK, op(0.1)),
        ...left,
        ...right,
        path("M96 150V176L102 169L108 176V150Z", RED.m),
        sparkle(158, 34, 11, YELLOW.m),
        sparkle(44, 40, 7, YELLOW.m),
      );
    })(),
  ),
  art(
    "education",
    "pencil-ruler",
    "pencil ruler drawing measure school stationery",
    (() => {
      const ticks: string[] = [];
      for (let i = 0; i < 15; i++) {
        const x = 34 + i * 9.6;
        ticks.push(line(r2(x), 84, r2(x), i % 5 === 0 ? 100 : 93, INK, 2, op(0.6)));
      }
      return svg(
        V,
        group("rotate(-32 100 100)", rect(22, 84, 156, 34, TEAL.m, 5), rect(22, 106, 156, 12, INK, 5, SHADE), ...ticks),
        group(
          "rotate(38 100 100)",
          rect(36, 86, 102, 28, YELLOW.m),
          rect(36, 100, 102, 14, INK, 0, SHADE),
          rect(20, 86, 22, 28, PINK.m, 8),
          rect(40, 86, 12, 28, SLATE.m),
          poly("138,86 170,100 138,114", SAND),
          poly("160,95 172,100 160,105", INK),
        ),
      );
    })(),
  ),
  art(
    "education",
    "atom",
    "atom science physics chemistry molecule research",
    (() => {
      const orbit = (deg: N, color: string, t: N) => {
        const ex = r2(100 + 78 * Math.cos(rad(t)));
        const ey = r2(100 + 28 * Math.sin(rad(t)));
        return group(`rotate(${deg} 100 100)`, ringE(100, 100, 78, 28, color, 5), circle(ex, ey, 8, YELLOW.m), circle(ex - 2, ey - 2, 2.6, CREAM, op(0.8)));
      };
      return svg(
        V,
        orbit(0, INDIGO.m, 25),
        orbit(60, TEAL.m, 200),
        orbit(-60, PINK.m, 110),
        circle(100, 100, 19, RED.m),
        ellipse(93, 92, 4.5, 7, CREAM, op(0.55)),
      );
    })(),
  ),
  art(
    "education",
    "flask",
    "flask science chemistry lab experiment liquid",
    svg(
      V,
      shadow(100, 184, 62),
      path("M82 28h36v52l44 78a14 14 0 0 1-12 22H50a14 14 0 0 1-12-22L82 80Z", SKY.l),
      path("M58.3 122H141.7L162 158a14 14 0 0 1-12 22H50a14 14 0 0 1-12-22Z", GREEN.m),
      ellipse(100, 122, 41.7, 5, CREAM, op(0.3)),
      path("M100 28h18v52l44 78a14 14 0 0 1-12 22h-50Z", INK, op(0.08)),
      rect(74, 20, 52, 13, SLATE.m, 6),
      circle(84, 150, 6, CREAM, op(0.6)),
      circle(114, 140, 4, CREAM, op(0.6)),
      circle(122, 162, 5, CREAM, op(0.6)),
      circle(98, 104, 3.5, CREAM, op(0.8)),
      circle(104, 90, 2.5, CREAM, op(0.8)),
      line(124, 100, 134, 100, INK, 2.5, op(0.25)),
      line(130, 112, 142, 112, INK, 2.5, op(0.25)),
      line(136, 124, 148, 124, INK, 2.5, op(0.25)),
      stroke("M90 40V70", CREAM, 5, op(0.7)),
    ),
  ),
  art(
    "education",
    "notebook",
    "notebook notes journal diary study planner",
    (() => {
      const rings: string[] = [];
      for (let i = 0; i < 8; i++) rings.push(rect(36, 40 + i * 17.5, 30, 7, SLATE.m, 3.5));
      return svg(
        V,
        group(
          "rotate(-7 100 100)",
          shadow(100, 184, 58),
          rect(48, 26, 112, 152, PURPLE.m, 10),
          rect(48, 26, 24, 152, INK, 10, SHADE),
          rect(136, 26, 9, 152, YELLOW.m),
          rect(78, 54, 58, 50, CREAM, 8),
          line(88, 70, 124, 70, INK, 4, op(0.25)),
          line(88, 83, 116, 83, INK, 4, op(0.25)),
          star(106, 130, 14, YELLOW.m),
          ...rings,
        ),
      );
    })(),
  ),
];

/* ------------------------------------------------------------------ celebration */

/** radial burst of lines with dotted tips */
const burst = (cx: N, cy: N, R: N, n: N, colors: string[], w: N) => {
  let out = "";
  for (let i = 0; i < n; i++) {
    const a = (i * 360) / n - 90;
    const long = i % 2 === 0;
    const [x0, y0] = pt(cx, cy, R * 0.34, a);
    const [x1, y1] = pt(cx, cy, R * (long ? 1 : 0.72), a);
    out += line(x0, y0, x1, y1, colors[i % colors.length], w);
    if (long) {
      const [dx, dy] = pt(cx, cy, R * 1.18, a);
      out += circle(dx, dy, w * 0.6, colors[i % colors.length]);
    }
  }
  return out;
};

const celebration: GraphicDraft[] = [
  art(
    "celebration",
    "party-popper",
    "party popper celebration confetti birthday cone",
    svg(
      V,
      group(
        "rotate(40 100 100)",
        path("M100 178L62 92A38 12 0 0 1 138 92Z", ORANGE.m),
        path("M100 178L138 92Q120 106 100 104Z", PURPLE.m, op(0.28)),
        path("M70.8 112Q100 122 129.2 112L123.9 124Q100 134 76.1 124Z", CREAM),
        path("M83.2 140Q100 146 116.8 140L112.4 150Q100 156 87.6 150Z", YELLOW.m),
        ellipse(100, 92, 38, 12, PURPLE.m),
      ),
      rect(114, 34, 12, 5.5, PINK.m, 1.5, ' transform="rotate(25 120 36)"'),
      circle(142, 30, 4.5, TEAL.m),
      poly("150,44 158,56 142,56", PURPLE.m),
      rect(168, 50, 12, 5.5, YELLOW.m, 1.5, ' transform="rotate(-30 174 52)"'),
      circle(160, 80, 4.5, PINK.m),
      stroke("M126 64c4-10 16-6 13-17s-15-8-10-21", TEAL.m, 3.5),
      stroke("M146 76c7-8 16-2 14-12s-9-12-3-21", PINK.m, 3.5),
      sparkle(180, 24, 9, YELLOW.m),
      circle(112, 46, 3.2, YELLOW.m),
      star(180, 96, 8, PURPLE.m),
      circle(128, 16, 3.5, PINK.m),
    ),
    "sticker",
  ),
  art(
    "celebration",
    "balloons",
    "balloons party celebration heart star love",
    (() => {
      const star_ = starPts(138, 88, 46, 21);
      const join = (c: string) => ` stroke="${c}" stroke-width="9" stroke-linejoin="round"`;
      return svg(
        V,
        stroke("M64 120Q68 156 100 184", INK, 1.8, op(0.45)),
        stroke("M138 130Q134 160 100 184", INK, 1.8, op(0.45)),
        rim(heartD(62, 70, 96), PINK.m, 62, 70, 0.92, -3, -3),
        poly("56,121 68,121 62,110", PINK.m),
        stroke("M30 54C32 44 40 38 50 36", CREAM, 5, GLINT),
        poly(star_, YELLOW.m, join(YELLOW.m)),
        poly(star_, INK, join(INK) + ' opacity="0.14"'),
        group("translate(135 85) scale(0.88) translate(-138 -88)", poly(star_, YELLOW.m, join(YELLOW.m))),
        stroke("M118 76L124 66", CREAM, 4, GLINT),
        path("M100 182C88 170 76 176 82 185C88 192 98 188 100 182Z", TEAL.m),
        path("M100 182C112 170 124 176 118 185C112 192 102 188 100 182Z", TEAL.m),
        circle(100, 183, 4, TEAL.m),
        circle(32, 140, 4, TEAL.m),
        circle(172, 36, 3.5, PINK.m),
        sparkle(172, 150, 8, YELLOW.m),
      );
    })(),
    "sticker",
  ),
  art(
    "celebration",
    "birthday-cake",
    "birthday cake candles party dessert celebration",
    (() => {
      const candles: string[] = [];
      for (const x of [76, 96, 116]) {
        candles.push(rect(x, 52, 9, 28, TEAL.m, 2.5), drop(x + 4.5, 42, 8.5, YELLOW.m));
      }
      const dots: string[] = [];
      for (let i = 0; i < 5; i++) dots.push(circle(52 + i * 24, 152, 4, CREAM, op(0.7)));
      return svg(
        V,
        shadow(100, 182, 82, 8),
        rect(32, 126, 136, 52, BROWN.m, 10),
        rect(32, 166, 136, 12, INK, 6, SHADE),
        ...dots,
        rect(30, 120, 140, 16, CREAM, 8),
        rect(44, 128, 12, 30, CREAM, 6),
        rect(80, 128, 12, 20, CREAM, 6),
        rect(116, 128, 12, 34, CREAM, 6),
        rect(150, 128, 12, 22, CREAM, 6),
        rect(58, 82, 84, 44, PINK.m, 10),
        rect(58, 112, 84, 14, INK, 7, SHADE),
        rect(54, 78, 92, 14, CREAM, 7),
        rect(66, 86, 10, 24, CREAM, 5),
        rect(94, 86, 10, 16, CREAM, 5),
        rect(122, 86, 10, 26, CREAM, 5),
        ...candles,
      );
    })(),
  ),
  art(
    "celebration",
    "fireworks",
    "fireworks celebration new year festival party",
    svg(
      V,
      burst(90, 92, 58, 14, [PINK.m, YELLOW.m, TEAL.m], 6),
      circle(90, 92, 7, ORANGE.m),
      burst(152, 146, 30, 10, [PURPLE.m, ORANGE.m], 5),
      circle(152, 146, 4, YELLOW.m),
      sparkle(166, 46, 9, YELLOW.m),
      sparkle(36, 162, 7, PINK.m),
      circle(176, 100, 3, TEAL.m),
      circle(22, 108, 3, ORANGE.m),
    ),
    "sticker",
  ),
  art(
    "celebration",
    "gifts",
    "gifts presents boxes holiday surprise celebration",
    svg(
      V,
      shadow(100, 182, 68),
      rect(38, 108, 124, 70, TEAL.m, 8),
      path("M126 108h28a8 8 0 0 1 8 8v54a8 8 0 0 1-8 8h-28Z", INK, SHADE),
      rect(92, 108, 16, 70, RED.m),
      rect(32, 90, 136, 24, TEAL.m, 8),
      rect(32, 90, 136, 24, CREAM, 8, op(0.14)),
      rect(92, 90, 16, 24, RED.m),
      rect(68, 56, 64, 40, YELLOW.m, 6),
      path("M110 56h16a6 6 0 0 1 6 6v28a6 6 0 0 1-6 6h-16Z", INK, SHADE),
      rect(93, 56, 14, 40, PURPLE.m),
      rect(62, 42, 76, 18, YELLOW.m, 6),
      rect(93, 42, 14, 18, PURPLE.m),
      path("M100 42C88 22 66 28 72 38C78 46 92 44 100 42Z", PURPLE.m),
      path("M100 42C112 22 134 28 128 38C122 46 108 44 100 42Z", PURPLE.m),
      circle(100, 42, 6, PURPLE.m),
      sparkle(160, 52, 9, YELLOW.m),
      sparkle(40, 66, 7, YELLOW.m),
      circle(150, 80, 3, RED.m),
    ),
  ),
  art(
    "celebration",
    "confetti-burst",
    "confetti burst party celebration sparkle festive",
    (() => {
      let seed = 11;
      const rnd = () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296;
      const cols = [RED.m, YELLOW.m, TEAL.m, PURPLE.m, PINK.m, SKY.m];
      const parts: string[] = [];
      const n = 30;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * 360 + rnd() * 8;
        const r = 34 + (i % 5) * 10.5 + rnd() * 8;
        const [x, y] = pt(100, 100, r, a);
        const c = cols[i % cols.length];
        const rot = Math.round(rnd() * 180);
        const tf = ` transform="rotate(${rot} ${x} ${y})"`;
        switch (i % 5) {
          case 0:
            parts.push(rect(r2(x - 8.5), r2(y - 3.4), 17, 6.8, c, 2, tf));
            break;
          case 1:
            parts.push(circle(x, y, 6, c));
            break;
          case 2:
            parts.push(poly(`${x},${r2(y - 9)} ${r2(x + 9)},${r2(y + 7)} ${r2(x - 9)},${r2(y + 7)}`, c, tf));
            break;
          case 3:
            parts.push(stroke(`M${r2(x - 11)} ${y}q5.5-9 11 0t11 0`, c, 4, tf));
            break;
          default:
            parts.push(star(x, y, 9.5, c));
        }
      }
      return svg(V, ...parts, sparkle(100, 100, 20, YELLOW.m));
    })(),
    "sticker",
  ),
  art(
    "celebration",
    "crown",
    "crown king queen royal winner luxury",
    svg(
      V,
      shadow(100, 176, 66),
      circle(30, 70, 9, YELLOW.d),
      circle(100, 52, 10, YELLOW.d),
      circle(170, 70, 9, YELLOW.d),
      poly("44,138 30,74 72,106 100,58 128,106 170,74 156,138", YELLOW.m, ` stroke="${YELLOW.m}" stroke-width="8" stroke-linejoin="round"`),
      poly("100,58 128,106 170,74 156,138 100,138", INK, SHADE),
      rect(40, 126, 120, 34, YELLOW.d, 9),
      rect(40, 126, 120, 11, YELLOW.m, 5.5),
      poly("100,88 113,102 100,116 87,102", RED.m),
      poly("100,88 113,102 100,102", CREAM, op(0.4)),
      circle(66, 146, 7, RED.m),
      circle(100, 146, 7, TEAL.m),
      circle(134, 146, 7, RED.m),
      stroke("M52 112L43 84", CREAM, 4, GLINT),
    ),
    "sticker",
  ),
  art(
    "celebration",
    "heart-bouquet",
    "bouquet hearts flowers love valentine romantic",
    svg(
      V,
      stroke("M100 122C90 104 70 94 56 78", GREEN.m, 4),
      stroke("M100 122C98 100 94 80 92 60", GREEN.m, 4),
      stroke("M100 122C110 104 128 92 142 76", GREEN.m, 4),
      stroke("M100 122V104", GREEN.m, 4),
      ellipse(76, 100, 10, 4.5, GREEN.m, ' transform="rotate(-30 76 100)"'),
      ellipse(124, 100, 10, 4.5, GREEN.m, ' transform="rotate(30 124 100)"'),
      group("rotate(-16 56 62)", heart(56, 62, 42, RED.m), heart(50, 56, 12, CREAM, op(0.35))),
      group("rotate(-3 92 38)", heart(92, 38, 46, PINK.m), heart(84, 31, 13, CREAM, op(0.4))),
      group("rotate(16 142 60)", heart(142, 60, 42, PURPLE.m), heart(136, 54, 12, CREAM, op(0.35))),
      group("rotate(4 100 88)", heart(100, 88, 34, RED.m), heart(94, 83, 10, CREAM, op(0.35))),
      poly("54,114 146,114 118,188 82,188", CREAM),
      poly("100,138 146,114 118,188 100,188", INK, SHADE),
      path("M70 126Q100 142 130 126L126 140Q100 156 74 140Z", PINK.m),
      path("M100 144C88 130 74 134 80 144C86 152 96 150 100 144Z", PINK.m),
      path("M100 144C112 130 126 134 120 144C114 152 104 150 100 144Z", PINK.m),
      circle(100, 144, 5, PINK.m),
      circle(100, 144, 5, INK, SHADE),
    ),
  ),
  art(
    "celebration",
    "ribbons",
    "ribbon bow gift curly present decoration",
    svg(
      V,
      stroke("M94 130C70 140 50 146 42 162C36 174 48 184 58 178C67 172 60 162 53 166", TEAL.m, 7),
      stroke("M106 130C130 140 150 146 158 162C164 174 152 184 142 178C133 172 140 162 147 166", YELLOW.m, 7),
      path("M94 108L58 168L76 162L84 180L106 120Z", PINK.m),
      path("M106 108L142 168L124 162L116 180L94 120Z", PINK.m),
      path("M106 108L142 168L124 162L116 180L94 120Z", INK, SHADE),
      path("M100 98C78 56 30 54 32 86C34 116 80 120 100 98Z", PINK.m),
      path("M100 98C122 56 170 54 168 86C166 116 120 120 100 98Z", PINK.m),
      path("M100 98C122 56 170 54 168 86C166 116 120 120 100 98Z", INK, SHADE),
      path("M98 96C82 72 56 68 54 84C54 98 80 104 98 96Z", INK, SHADE),
      path("M102 96C118 72 144 68 146 84C146 98 120 104 102 96Z", INK, op(0.2)),
      rect(88, 84, 24, 28, PINK.m, 9),
      rect(88, 84, 24, 28, INK, 9, SHADE),
      stroke("M96 90V106", CREAM, 4, GLINT),
    ),
  ),
  art(
    "celebration",
    "bunting",
    "bunting flags banner party garland decoration",
    (() => {
      const cols = [RED.m, YELLOW.m, TEAL.m, PINK.m, INDIGO.m];
      const P0: [N, N] = [12, 28];
      const C: [N, N] = [120, 118];
      const P1: [N, N] = [228, 28];
      const flags: string[] = [];
      const n = 7;
      for (let i = 0; i < n; i++) {
        const t = (i + 0.75) / (n + 0.5);
        const x = (1 - t) ** 2 * P0[0] + 2 * (1 - t) * t * C[0] + t * t * P1[0];
        const y = (1 - t) ** 2 * P0[1] + 2 * (1 - t) * t * C[1] + t * t * P1[1];
        const dx = 2 * (1 - t) * (C[0] - P0[0]) + 2 * t * (P1[0] - C[0]);
        const dy = 2 * (1 - t) * (C[1] - P0[1]) + 2 * t * (P1[1] - C[1]);
        const ang = (Math.atan2(dy, dx) * 180) / Math.PI;
        flags.push(group(`translate(${r2(x)} ${r2(y)}) rotate(${r2(ang)})`, poly("-17,-2 17,-2 0,42", cols[i % cols.length]), poly("0,-2 17,-2 0,42", INK, SHADE)));
      }
      return svg("0 0 240 120", stroke(`M${P0[0]} ${P0[1]}Q${C[0]} ${C[1]} ${P1[0]} ${P1[1]}`, INK, 3), ...flags, circle(12, 28, 6, INK), circle(228, 28, 6, INK));
    })(),
  ),
];

/* ------------------------------------------------------------------ tech */

/** gear: teeth + body with a see-through hole (even-odd), `rot` rotates the teeth */
const gear = (cx: N, cy: N, R: N, rIn: N, teeth: N, hole: N, fill: string, rot = 0) => {
  const tw = ((2 * Math.PI * rIn) / teeth) * 0.5;
  let out = "";
  for (let i = 0; i < teeth; i++) {
    out += rect(r2(cx - tw / 2), r2(cy - R), r2(tw), r2(R - rIn + 6), fill, r2(tw * 0.22), ` transform="rotate(${r2(rot + (i * 360) / teeth)} ${cx} ${cy})"`);
  }
  const body = `M${cx - rIn} ${cy}a${rIn} ${rIn} 0 1 0 ${2 * rIn} 0a${rIn} ${rIn} 0 1 0 ${-2 * rIn} 0ZM${cx - hole} ${cy}a${hole} ${hole} 0 1 0 ${2 * hole} 0a${hole} ${hole} 0 1 0 ${-2 * hole} 0Z`;
  return out + path(body, fill, ' fill-rule="evenodd"');
};

/** one filled wifi arc between radii r0..r1, centred on (100,150) */
const wifiArc = (r0: N, r1: N, color: string, x_ = "") => {
  const [ax, ay] = pt(100, 150, r1, -135);
  const [bx, by] = pt(100, 150, r1, -45);
  const [cx, cy] = pt(100, 150, r0, -45);
  const [dx, dy] = pt(100, 150, r0, -135);
  return path(`M${ax} ${ay}A${r1} ${r1} 0 0 1 ${bx} ${by}L${cx} ${cy}A${r0} ${r0} 0 0 0 ${dx} ${dy}Z`, color, ` stroke="${color}" stroke-width="6" stroke-linejoin="round"${x_}`);
};

const SHIELD = "M100 18L164 40V98C164 138 136 166 100 184C64 166 36 138 36 98V40Z";

const tech: GraphicDraft[] = [
  art(
    "tech",
    "smartphone",
    "smartphone phone mobile app device screen",
    (() => {
      const cols = [PINK.m, YELLOW.m, TEAL.m, CREAM, TEAL.m, PINK.m, YELLOW.m, CREAM, PINK.m];
      const icons: string[] = [];
      cols.forEach((c, i) => icons.push(rect(73 + (i % 3) * 20, 84 + Math.floor(i / 3) * 20, 16, 16, c, 4.5, c === CREAM ? op(0.85) : "")));
      return svg(
        V,
        rect(142, 66, 3.5, 24, INK, 1.7),
        rect(56, 14, 88, 172, INK, 18),
        rect(64, 30, 72, 140, SKY.m, 9),
        rect(88, 19, 24, 5, CREAM, 2.5, op(0.3)),
        rect(73, 44, 54, 11, CREAM, 5.5, op(0.9)),
        rect(82, 60, 36, 5, CREAM, 2.5, op(0.55)),
        ...icons,
        rect(72, 150, 56, 14, CREAM, 7, op(0.4)),
        poly("64,118 136,58 136,92 64,152", CREAM, op(0.1)),
      );
    })(),
  ),
  art(
    "tech",
    "laptop",
    "laptop computer code programming developer work",
    (() => {
      const code: Array<[N, N, N, string, string]> = [
        [52, 48, 26, TEAL.m, ""],
        [82, 48, 18, YELLOW.m, ""],
        [60, 60, 40, CREAM, ""],
        [104, 60, 22, TEAL.m, ""],
        [60, 72, 22, YELLOW.m, ""],
        [86, 72, 34, CREAM, op(0.6)],
        [52, 84, 16, TEAL.m, ""],
        [72, 84, 30, CREAM, ""],
        [52, 96, 34, CREAM, op(0.6)],
        [90, 96, 12, YELLOW.m, ""],
      ];
      const keys: string[] = [];
      for (let r = 0; r < 2; r++) for (let c = 0; c < 10; c++) keys.push(rect(r2(30 + c * 14.4 + r * 1.5), 135 + r * 7.5, 11, 4.6, INK, 1.5, op(0.16)));
      return svg(
        V,
        shadow(100, 170, 88),
        rect(36, 28, 128, 98, INK, 9),
        rect(43, 35, 114, 84, INDIGO.m, 3),
        ...code.map(([x, y, w, c, o]) => rect(x, y, w, 5, c, 2.5, o)),
        rect(52, 106, 6, 8, YELLOW.m, 1.5),
        path("M24 126H176L191 150Q193 164 178 164H22Q7 164 9 150Z", SLATE.m),
        path("M84 126h32v1a4 4 0 0 1-4 4H88a4 4 0 0 1-4-4Z", INK, DEEP),
        ...keys,
        rect(80, 150, 40, 9, INK, 3, op(0.12)),
      );
    })(),
  ),
  art(
    "tech",
    "monitor",
    "monitor screen desktop display computer pc",
    svg(
      V,
      shadow(100, 186, 58, 5),
      rect(22, 24, 156, 106, INK, 10),
      rect(30, 32, 140, 88, SKY.m, 4),
      circle(134, 60, 13, YELLOW.m),
      ellipse(64, 58, 17, 6.5, CREAM, op(0.9)),
      ellipse(78, 52, 12, 8, CREAM, op(0.9)),
      path("M30 120V104C50 84 74 92 94 104C112 92 142 82 170 100V120Z", GREEN.m),
      path("M30 120V114C58 104 84 110 106 118C126 110 150 108 170 116V120Z", INK, SHADE),
      path("M88 130h24l5 24H83Z", SLATE.m),
      path("M100 130h12l5 24h-17Z", INK, SHADE),
      rect(60, 152, 80, 13, SLATE.m, 6.5),
      circle(100, 126, 2.5, SLATE.m),
    ),
  ),
  art(
    "tech",
    "cloud",
    "cloud upload storage sync backup server",
    svg(
      V,
      circle(62, 126, 28, SKY.m),
      circle(96, 96, 38, SKY.m),
      circle(140, 112, 32, SKY.m),
      rect(62, 124, 110, 30, SKY.m, 15),
      group(
        "translate(90 112) scale(0.88) translate(-100 -126)",
        circle(62, 126, 28, SKY.l),
        circle(96, 96, 38, SKY.l),
        circle(140, 112, 32, SKY.l),
        rect(62, 124, 110, 30, SKY.l, 15),
      ),
      stroke("M100 146V102M80 122l20-20 20 20", CREAM, 9),
      sparkle(36, 60, 9, YELLOW.m),
      sparkle(170, 56, 7, YELLOW.m),
      circle(24, 150, 3, SKY.m),
      circle(176, 160, 3.5, SKY.m),
    ),
  ),
  art(
    "tech",
    "wifi",
    "wifi wireless internet signal network connection",
    svg(V, wifiArc(96, 108, INDIGO.m, op(0.22)), wifiArc(60, 84, INDIGO.m), wifiArc(32, 52, INDIGO.m), wifiArc(0, 22, INDIGO.m), circle(100, 150, 11, INDIGO.m)),
    "sticker",
  ),
  art(
    "tech",
    "chat-bubbles",
    "chat message bubbles conversation talk communication",
    svg(
      V,
      rect(22, 30, 112, 78, PURPLE.m, 20),
      poly("40,98 34,132 72,104", PURPLE.m),
      line(42, 54, 100, 54, CREAM, 6, op(0.85)),
      line(42, 72, 84, 72, CREAM, 6, op(0.55)),
      star(112, 56, 11, YELLOW.m),
      rect(66, 78, 112, 80, TEAL.m, 20),
      poly("152,150 166,182 126,154", TEAL.m),
      circle(98, 118, 7.5, CREAM),
      circle(122, 118, 7.5, CREAM),
      circle(146, 118, 7.5, CREAM),
    ),
  ),
  art(
    "tech",
    "code-brackets",
    "code programming developer window html software",
    svg(
      V,
      shadow(100, 178, 76),
      rect(18, 34, 164, 130, INK, 14),
      path("M18 48a14 14 0 0 1 14-14h136a14 14 0 0 1 14 14v14H18Z", TEAL.m, op(0.22)),
      circle(38, 48, 5, RED.m),
      circle(54, 48, 5, YELLOW.m),
      circle(70, 48, 5, GREEN.m),
      stroke("M80 94L50 118L80 142", TEAL.m, 11),
      stroke("M120 94L150 118L120 142", TEAL.m, 11),
      line(106, 88, 94, 148, PINK.m, 11),
    ),
  ),
  art(
    "tech",
    "shield",
    "shield security protection safe privacy check",
    svg(
      V,
      path(SHIELD, INDIGO.m),
      path("M100 18L164 40V98C164 138 136 166 100 184Z", INK, SHADE),
      group("translate(100 100) scale(0.82) translate(-100 -101)", stroke(SHIELD, CREAM, 4.5, op(0.45))),
      stroke("M68 100L92 124L134 78", CREAM, 14),
      sparkle(176, 150, 10, TEAL.m),
      sparkle(24, 156, 7, TEAL.m),
    ),
  ),
  art(
    "tech",
    "gears",
    "gears settings cog engineering mechanism configuration",
    svg(
      V,
      gear(84, 96, 66, 50, 10, 20, TEAL.m),
      path("M84 46a50 50 0 0 1 50 50", "none", ` stroke="${CREAM}" stroke-width="5" stroke-linecap="round" opacity="0.45"`),
      gear(157, 154, 38, 28, 8, 11, YELLOW.m, -7),
      ring(84, 96, 20, INK, 4, op(0.14)),
    ),
  ),
  art(
    "tech",
    "battery",
    "battery charge power energy electric full",
    svg(
      V,
      outline(20, 64, 150, 76, 16, INK, 9),
      rect(176, 88, 12, 32, INK, 5),
      rect(32, 76, 27, 52, GREEN.m, 6),
      rect(66, 76, 27, 52, GREEN.m, 6),
      rect(100, 76, 27, 52, GREEN.m, 6),
      rect(134, 76, 27, 52, GREEN.m, 6),
      rect(36, 80, 19, 4.5, CREAM, 2, op(0.5)),
      rect(70, 80, 19, 4.5, CREAM, 2, op(0.5)),
      poly("108,48 78,106 100,106 90,154 128,92 104,92 116,48", YELLOW.m, ` stroke="${INK}" stroke-width="5" stroke-linejoin="round"`),
    ),
  ),
  art(
    "tech",
    "chip",
    "chip processor cpu hardware circuit electronics",
    (() => {
      const pins: string[] = [];
      for (let i = 0; i < 6; i++) {
        const o = 57.5 + i * 17;
        pins.push(rect(r2(o - 4), 26, 8, 30, YELLOW.m, 3), rect(r2(o - 4), 144, 8, 30, YELLOW.m, 3), rect(26, r2(o - 4), 30, 8, YELLOW.m, 3), rect(144, r2(o - 4), 30, 8, YELLOW.m, 3));
      }
      return svg(
        V,
        ...pins,
        rect(46, 46, 108, 108, INK, 16),
        rect(64, 64, 72, 72, INDIGO.m, 9),
        stroke("M70 84H92V100H104", TEAL.m, 3.5),
        stroke("M70 118H88V132", TEAL.m, 3.5),
        stroke("M130 84H116V74", TEAL.m, 3.5),
        stroke("M130 118H112V104", TEAL.m, 3.5),
        circle(70, 84, 3.6, CREAM),
        circle(70, 118, 3.6, CREAM),
        circle(130, 84, 3.6, CREAM),
        circle(130, 118, 3.6, CREAM),
        rect(86, 86, 28, 28, CREAM, 6, op(0.92)),
        rect(94, 94, 12, 12, INDIGO.m, 3),
        circle(58, 58, 3.5, CREAM),
      );
    })(),
  ),
];

/* ------------------------------------------------------------------ export */

export const GRAPHICS_B: GraphicDraft[] = [...objects, ...business, ...food, ...travel, ...education, ...celebration, ...tech];
