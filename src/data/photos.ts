/**
 * Procedural stock photos.
 *
 * Craftly ships no photographic files. Every "stock photo" is generated on a canvas from a
 * seeded PRNG, so a photo is deterministic, resolution independent and costs no bytes in the
 * bundle. `ImageElement.src = "builtin:<id>"` resolves through `getPhotoImage(id)`.
 *
 * Layout of this file
 *   1. public types
 *   2. maths, colour, PRNG, gradient noise
 *   3. canvas plumbing (scratch canvases, pixel "fields", pyramid blur, film grain)
 *   4. drawing kit (gradients, glows, skies, ridgelines, trees, stars, clouds ...)
 *   5. painters, one small function per photo, grouped by family
 *   6. registry + public API (drawPhoto / getPhotoImage / getPhotoThumb)
 *
 * Conventions for painters: positions are fractions of the canvas, sizes are fractions of
 * `S.U` (geometric mean of the sides) or reference pixels (`S.px` = 1 at a 1600px render), and
 * all randomness comes from `S.rng` / `S.noise`, so the same id looks the same at any size.
 * Noise-heavy looks (clouds, textures, mesh gradients, caustics) are evaluated per pixel on a coarse
 * grid by `field()` and stretched over the picture; 3D-ish landscapes (dunes, canyon, fields) go through
 * the small heightfield renderer `terrain()`. Nothing relies on `ctx.filter`, so Safari renders the same.
 *
 * Adding a photo: append a `photo(id, name, category, size, "search tags", (S) => { ... })` call in the
 * right family section of part 5. Ids are stable API (templates reference them), so never rename one.
 */

/* ========================================================================== */
/* 1. Public types                                                            */
/* ========================================================================== */

export type PhotoCategory = "landscape" | "city" | "abstract" | "texture" | "nature" | "space";

export interface PhotoDef {
  /** unique, kebab-case, stable: templates reference it as `builtin:<id>` */
  id: string;
  name: string;
  category: PhotoCategory;
  /** lower-case search keywords */
  tags: string[];
  /** intrinsic size (defines the aspect ratio; the image is resolution independent) */
  width: number;
  height: number;
}

/* ========================================================================== */
/* 2. Maths, colour, PRNG, noise                                              */
/* ========================================================================== */

type Ctx = CanvasRenderingContext2D;
type Surface = HTMLCanvasElement | OffscreenCanvas;
type Stops = ReadonlyArray<readonly [number, string]>;
type RGB = [number, number, number];

const TAU = Math.PI * 2;
const clamp = (v: number, a = 0, b = 1) => (v < a ? a : v > b ? b : v);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a || 1));
  return t * t * (3 - 2 * t);
};

const RGB_CACHE = new Map<string, RGB>();
/** "#rgb" / "#rrggbb" -> [r, g, b] */
function rgbOf(c: string): RGB {
  let v = RGB_CACHE.get(c);
  if (!v) {
    let h = c[0] === "#" ? c.slice(1) : c;
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    const n = parseInt(h, 16) || 0;
    v = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    RGB_CACHE.set(c, v);
  }
  return v;
}
const toHex = (c: RGB) =>
  "#" + c.map((x) => Math.round(clamp(x, 0, 255)).toString(16).padStart(2, "0")).join("");
const mixc = (a: string, b: string, t: number) => {
  const A = rgbOf(a);
  const B = rgbOf(b);
  return toHex([lerp(A[0], B[0], t), lerp(A[1], B[1], t), lerp(A[2], B[2], t)]);
};
const rgba = (c: string, a: number) => {
  const [r, g, b] = rgbOf(c);
  return `rgba(${r},${g},${b},${+clamp(a).toFixed(3)})`;
};

/** mulberry32: tiny, fast, good-enough 32-bit PRNG */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Rng {
  (): number;
  range(a: number, b: number): number;
  int(a: number, b: number): number;
  pick<T>(arr: readonly T[]): T;
  chance(p: number): boolean;
  /** approx. normal, mean 0, sd 1 */
  gauss(): number;
}
function makeRng(seed: number): Rng {
  const next = mulberry32(seed);
  const r = (() => next()) as Rng;
  r.range = (a, b) => a + (b - a) * next();
  r.int = (a, b) => a + Math.floor(next() * (b - a + 1));
  r.pick = (arr) => arr[Math.floor(next() * arr.length)];
  r.chance = (p) => next() < p;
  r.gauss = () => (next() + next() + next() + next() - 2) * 1.732;
  return r;
}

function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

interface Noise {
  /** gradient noise, about -0.7 .. 0.7 */
  n(x: number, y: number): number;
  /** fractal brownian motion, 0..1 centred on .5 */
  fbm(x: number, y: number, oct?: number, gain?: number): number;
  /** ridged multifractal, 0..1 (sharp crests where the base noise crosses zero) */
  ridged(x: number, y: number, oct?: number): number;
}
function makeNoise(seed: number): Noise {
  const rnd = mulberry32(seed * 7919 + 13);
  const perm = new Uint8Array(512);
  const gx = new Float32Array(256);
  const gy = new Float32Array(256);
  const idx = Array.from({ length: 256 }, (_, i) => i);
  for (let i = 255; i > 0; i--) {
    const j = (rnd() * (i + 1)) | 0;
    const t = idx[i];
    idx[i] = idx[j];
    idx[j] = t;
  }
  for (let i = 0; i < 512; i++) perm[i] = idx[i & 255];
  for (let i = 0; i < 256; i++) {
    const a = rnd() * TAU;
    gx[i] = Math.cos(a);
    gy[i] = Math.sin(a);
  }
  const n = (x: number, y: number): number => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const xf = x - x0;
    const yf = y - y0;
    const xi = x0 & 255;
    const yi = y0 & 255;
    const pa = perm[xi] + yi;
    const pb = perm[xi + 1] + yi;
    const a = perm[pa];
    const b = perm[pb];
    const c = perm[pa + 1];
    const d = perm[pb + 1];
    const u = xf * xf * xf * (xf * (xf * 6 - 15) + 10);
    const v = yf * yf * yf * (yf * (yf * 6 - 15) + 10);
    const xf1 = xf - 1;
    const yf1 = yf - 1;
    const n00 = gx[a] * xf + gy[a] * yf;
    const n10 = gx[b] * xf1 + gy[b] * yf;
    const n01 = gx[c] * xf + gy[c] * yf1;
    const n11 = gx[d] * xf1 + gy[d] * yf1;
    const nx0 = n00 + (n10 - n00) * u;
    const nx1 = n01 + (n11 - n01) * u;
    return nx0 + (nx1 - nx0) * v;
  };
  const fbm = (x: number, y: number, oct = 5, gain = 0.5): number => {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let fx = x;
    let fy = y;
    for (let i = 0; i < oct; i++) {
      sum += amp * n(fx, fy);
      norm += amp;
      amp *= gain;
      fx = fx * 2.03 + 11.7;
      fy = fy * 2.03 - 5.3;
    }
    return clamp(0.5 + (sum / norm) * 1.45);
  };
  const ridged = (x: number, y: number, oct = 5): number => {
    let sum = 0;
    let amp = 0.5;
    let norm = 0;
    let wgt = 1;
    let fx = x;
    let fy = y;
    for (let i = 0; i < oct; i++) {
      let s = clamp(1 - Math.abs(n(fx, fy)) * 1.5);
      s *= s;
      s *= wgt;
      wgt = clamp(s * 1.6);
      sum += s * amp;
      norm += amp;
      amp *= 0.5;
      fx = fx * 2.07 + 3.1;
      fy = fy * 2.07 + 7.9;
    }
    return clamp((sum / norm) * 1.15);
  };
  return { n, fbm, ridged };
}

/* ========================================================================== */
/* 3. Canvas plumbing                                                         */
/* ========================================================================== */

function makeCanvas(w: number, h: number): Surface {
  const cw = Math.max(1, Math.round(w));
  const ch = Math.max(1, Math.round(h));
  if (typeof document !== "undefined") {
    const c = document.createElement("canvas");
    c.width = cw;
    c.height = ch;
    return c;
  }
  if (typeof OffscreenCanvas !== "undefined") return new OffscreenCanvas(cw, ch);
  throw new Error("Craftly photos need a canvas implementation");
}
const ctxOf = (c: Surface): Ctx => (c as HTMLCanvasElement).getContext("2d") as Ctx;

/** What a painter receives. `w`/`h` are the target size, everything else derives from it. */
interface Scene {
  ctx: Ctx;
  w: number;
  h: number;
  /** geometric mean of the sides: a unit for sizes that should scale with the picture */
  U: number;
  /** 1 at a 1600px render: thickness of hairlines, grain size ... */
  px: number;
  rng: Rng;
  noise: Noise;
}
function makeScene(ctx: Ctx, w: number, h: number, seed: number): Scene {
  return { ctx, w, h, U: Math.sqrt(w * h), px: Math.max(w, h) / 1600, rng: makeRng(seed), noise: makeNoise(seed) };
}
/** Same random streams, different target canvas / size (for reflections and layers). */
function subScene(S: Scene, ctx: Ctx, w: number, h: number): Scene {
  return { ...S, ctx, w, h, U: Math.sqrt(w * h), px: Math.max(w, h) / 1600 };
}
/** Paint into a fresh scratch canvas, return it. */
function layer(S: Scene, w: number, h: number, paint: (L: Scene) => void): Surface {
  const cv = makeCanvas(w, h);
  paint(subScene(S, ctxOf(cv), cv.width, cv.height));
  return cv;
}

/** Pixel shader for `field`: write r,g,b (0..255) and a (0..1, preset to 1) into `o`. */
type Shader = (u: number, v: number, o: Float32Array) => void;

/**
 * Evaluate `shader` on a coarse grid (longest side <= `res`) and stretch it over the rect
 * with smooth filtering. This is how noise-heavy looks stay inside the time budget.
 */
function field(
  S: Scene,
  res: number,
  shader: Shader,
  rect?: { x: number; y: number; w: number; h: number },
  gco: GlobalCompositeOperation = "source-over",
  alpha = 1,
): void {
  const rx = rect?.x ?? 0;
  const ry = rect?.y ?? 0;
  const rw = rect?.w ?? S.w;
  const rh = rect?.h ?? S.h;
  const k = Math.min(1, res / Math.max(rw, rh));
  const bw = Math.max(2, Math.ceil(rw * k));
  const bh = Math.max(2, Math.ceil(rh * k));
  const cv = makeCanvas(bw, bh);
  const c = ctxOf(cv);
  const img = c.createImageData(bw, bh);
  const d = img.data;
  const o = new Float32Array(4);
  for (let j = 0, p = 0; j < bh; j++) {
    const v = (j + 0.5) / bh;
    for (let i = 0; i < bw; i++, p += 4) {
      o[3] = 1;
      shader((i + 0.5) / bw, v, o);
      d[p] = o[0];
      d[p + 1] = o[1];
      d[p + 2] = o[2];
      d[p + 3] = o[3] * 255;
    }
  }
  c.putImageData(img, 0, 0);
  const ctx = S.ctx;
  ctx.save();
  ctx.globalCompositeOperation = gco;
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cv as CanvasImageSource, rx, ry, rw, rh);
  ctx.restore();
}

/** Colour ramp lookup: `ramp(t, o)` writes the r,g,b of position t (0..1) into o[0..2]. */
function makeRamp(stops: Stops, n = 256): (t: number, o: Float32Array) => void {
  const cs = stops.map(([off, c]) => [off, rgbOf(c)] as const);
  const lut = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let j = 0;
    while (j < cs.length - 2 && t > cs[j + 1][0]) j++;
    const [o0, c0] = cs[j];
    const [o1, c1] = cs[j + 1];
    const k = clamp((t - o0) / (o1 - o0 || 1));
    lut[i * 3] = c0[0] + (c1[0] - c0[0]) * k;
    lut[i * 3 + 1] = c0[1] + (c1[1] - c0[1]) * k;
    lut[i * 3 + 2] = c0[2] + (c1[2] - c0[2]) * k;
  }
  return (t, o) => {
    const i = ((t <= 0 ? 0 : t >= 1 ? 1 : t) * (n - 1) + 0.5) | 0;
    o[0] = lut[i * 3];
    o[1] = lut[i * 3 + 1];
    o[2] = lut[i * 3 + 2];
  };
}

/**
 * Cheap gaussian-ish blur without `ctx.filter` (absent in Safari): halve the image `levels`
 * times with smoothing, then double it back. Returns a new canvas of the same size.
 */
function softBlur(src: Surface, w: number, h: number, levels: number): Surface {
  const sizes: Array<[number, number]> = [[Math.round(w), Math.round(h)]];
  let cur: Surface = src;
  for (let i = 0; i < levels; i++) {
    const [pw, ph] = sizes[sizes.length - 1];
    const nw = Math.max(1, pw >> 1);
    const nh = Math.max(1, ph >> 1);
    const t = makeCanvas(nw, nh);
    const c = ctxOf(t);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(cur as CanvasImageSource, 0, 0, nw, nh);
    sizes.push([nw, nh]);
    cur = t;
  }
  for (let i = levels - 1; i >= 0; i--) {
    const [tw, th] = sizes[i];
    const t = makeCanvas(tw, th);
    const c = ctxOf(t);
    c.imageSmoothingEnabled = true;
    c.imageSmoothingQuality = "high";
    c.drawImage(cur as CanvasImageSource, 0, 0, tw, th);
    cur = t;
  }
  return cur;
}

/** Draw `src` blurred by roughly `radius` px on top of the scene (screen / lighter blooms). */
function bloom(S: Scene, src: Surface, radius: number, alpha = 1, gco: GlobalCompositeOperation = "screen"): void {
  const levels = clamp(Math.round(Math.log2(Math.max(1, radius))), 1, 7);
  const b = softBlur(src, S.w, S.h, levels);
  S.ctx.save();
  S.ctx.globalCompositeOperation = gco;
  S.ctx.globalAlpha = alpha;
  S.ctx.drawImage(b as CanvasImageSource, 0, 0, S.w, S.h);
  S.ctx.restore();
}

let grainTile: Surface | null = null;
function getGrainTile(): Surface {
  if (!grainTile) {
    const N = 256;
    const cv = makeCanvas(N, N);
    const c = ctxOf(cv);
    const img = c.createImageData(N, N);
    const r = mulberry32(0x51f15e);
    for (let i = 0; i < N * N; i++) {
      const g = Math.round(((r() + r() + r()) / 3) * 255);
      img.data[i * 4] = g;
      img.data[i * 4 + 1] = g;
      img.data[i * 4 + 2] = g;
      img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    grainTile = cv;
  }
  return grainTile;
}
/** Film grain. `dark` also lifts the shadows a hair, which doubles as dithering against banding. */
function grain(S: Scene, amount = 0.08, dark = false): void {
  const pat = S.ctx.createPattern(getGrainTile() as CanvasImageSource, "repeat");
  if (!pat) return;
  const k = Math.max(0.7, S.px);
  const { ctx } = S;
  ctx.save();
  ctx.scale(k, k);
  ctx.fillStyle = pat;
  ctx.globalCompositeOperation = "overlay";
  ctx.globalAlpha = amount;
  ctx.fillRect(0, 0, S.w / k, S.h / k);
  if (dark) {
    ctx.globalCompositeOperation = "lighter";
    ctx.globalAlpha = amount * 0.3;
    ctx.fillRect(0, 0, S.w / k, S.h / k);
  }
  ctx.restore();
}

/* ========================================================================== */
/* 4. Drawing kit                                                             */
/* ========================================================================== */

function addStops(g: CanvasGradient, stops: Stops): CanvasGradient {
  for (const [o, c] of stops) g.addColorStop(clamp(o), c);
  return g;
}
const lin = (ctx: Ctx, x0: number, y0: number, x1: number, y1: number, stops: Stops) =>
  addStops(ctx.createLinearGradient(x0, y0, x1, y1), stops);
const rad = (ctx: Ctx, x: number, y: number, r: number, stops: Stops) =>
  addStops(ctx.createRadialGradient(x, y, 0, x, y, Math.max(0.001, r)), stops);

/** Stops of a smooth, banding-free falloff from `a` at the centre to 0 at the rim. */
function glowStops(color: string, a = 1, power = 2.2): Stops {
  const out: Array<[number, string]> = [];
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    const f = 1 - t * t * (3 - 2 * t);
    out.push([t, rgba(color, a * Math.pow(f, power))]);
  }
  return out;
}
/** Soft light blob. `sx`/`sy` stretch it into an ellipse. */
function glow(
  S: Scene,
  x: number,
  y: number,
  r: number,
  color: string,
  a = 1,
  gco: GlobalCompositeOperation = "screen",
  sx = 1,
  sy = 1,
): void {
  const { ctx } = S;
  ctx.save();
  ctx.globalCompositeOperation = gco;
  ctx.translate(x, y);
  ctx.scale(sx, sy);
  ctx.fillStyle = rad(ctx, 0, 0, r, glowStops(color, a));
  ctx.fillRect(-r, -r, r * 2, r * 2);
  ctx.restore();
}

/** Vertical gradient band. */
function fillV(S: Scene, y0: number, y1: number, stops: Stops, x = 0, w = S.w): void {
  S.ctx.fillStyle = lin(S.ctx, 0, y0, 0, y1, stops);
  S.ctx.fillRect(x, y0, w, y1 - y0);
}

/** Sun (or moon): disc + layered bloom. */
function sun(S: Scene, x: number, y: number, r: number, halo: string, core = "#fff4d6", k = 1): void {
  glow(S, x, y, r * 18, halo, 0.38 * k);
  glow(S, x, y, r * 6.5, mixc(halo, core, 0.4), 0.55 * k);
  glow(S, x, y, r * 2.6, core, 0.7 * k);
  const { ctx } = S;
  ctx.fillStyle = rad(ctx, x, y, r, [
    [0, "#ffffff"],
    [0.72, core],
    [1, mixc(core, halo, 0.3)],
  ]);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();
}

/** Radial vignette. */
function vignette(S: Scene, strength = 0.3, color = "#000000"): void {
  const { ctx, w, h } = S;
  const r = Math.hypot(w, h) * 0.5;
  ctx.fillStyle = rad(ctx, w / 2, h / 2, r, [
    [0, rgba(color, 0)],
    [0.55, rgba(color, 0)],
    [1, rgba(color, strength)],
  ]);
  ctx.fillRect(0, 0, w, h);
}

/* ---- ridgelines ---- */

interface CrestOpts {
  /** baseline as a fraction of the height */
  base: number;
  /** peak-to-valley amplitude (fraction of the height) */
  amp: number;
  /** noise features across the width */
  freq: number;
  oct?: number;
  /** decorrelates layers */
  seed?: number;
  /** 0 rolling .. 1 alpine */
  sharp?: number;
  /** extra linear slope, fraction of the height from left to right */
  tilt?: number;
}
/** Sampled ridgeline: y (px) at n+1 evenly spaced x positions across the width. */
function crest(S: Scene, o: CrestOpts): Float32Array {
  const n = clamp(Math.round(S.w / 3), 160, 900);
  const ys = new Float32Array(n + 1);
  const oct = o.oct ?? 4;
  const off = (o.seed ?? 0) * 7.13;
  const sharp = o.sharp ?? 0;
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    let v = S.noise.fbm(t * o.freq + off, off * 0.37 + 0.5, oct);
    // fold about the mean: sharp crests where the noise crosses it, rounder valleys
    if (sharp > 0) v = lerp(v, (1 - Math.abs(2 * v - 1)) * 1.3 - 0.3, sharp);
    ys[i] = (o.base - (v - 0.5) * 2 * o.amp + (o.tilt ?? 0) * (t - 0.5)) * S.h;
  }
  return ys;
}
const yAt = (ys: Float32Array, t: number) => {
  const f = clamp(t) * (ys.length - 1);
  const i = Math.min(ys.length - 2, Math.floor(f));
  return ys[i] + (ys[i + 1] - ys[i]) * (f - i);
};
const minOf = (ys: Float32Array) => {
  let m = Infinity;
  for (let i = 0; i < ys.length; i++) if (ys[i] < m) m = ys[i];
  return m;
};
function crestPath(S: Scene, ys: Float32Array, bottom: number): void {
  const { ctx, w } = S;
  const n = ys.length - 1;
  ctx.beginPath();
  ctx.moveTo(0, bottom);
  ctx.lineTo(0, ys[0]);
  for (let i = 1; i <= n; i++) ctx.lineTo((i / n) * w, ys[i]);
  ctx.lineTo(w, bottom);
  ctx.closePath();
}
/** Fill the area under a ridgeline with a vertical gradient (crest colour -> base colour). */
function fillCrest(S: Scene, ys: Float32Array, top: string, bottomColor: string, bottom = S.h, topAt = minOf(ys)): void {
  crestPath(S, ys, bottom);
  S.ctx.fillStyle = lin(S.ctx, 0, topAt, 0, bottom, [
    [0, top],
    [1, bottomColor],
  ]);
  S.ctx.fill();
}
/** Light along the crest where the slope faces the light (`light`: 1 = from the left, -1 = from the right). */
function rimLight(S: Scene, ys: Float32Array, color: string, alpha: number, light: 1 | -1, width = 1.6): void {
  const { ctx, w } = S;
  const n = ys.length - 1;
  ctx.save();
  ctx.lineWidth = width * S.px;
  ctx.lineCap = "round";
  for (let i = 1; i < n; i++) {
    const slope = (ys[i + 1] - ys[i - 1]) / ((2 * w) / n);
    const facing = clamp(-slope * light * 2.2);
    if (facing < 0.04) continue;
    ctx.strokeStyle = rgba(color, alpha * facing);
    ctx.beginPath();
    ctx.moveTo(((i - 1) / n) * w, ys[i - 1]);
    ctx.lineTo(((i + 1) / n) * w, ys[i + 1]);
    ctx.stroke();
  }
  ctx.restore();
}
/**
 * Low-poly style faceting for alpine ridgelines: every peak gets a shadow wedge on the side that
 * faces away from the light, bounded by a ridge line and a valley line that lean towards the lit side.
 */
function facets(S: Scene, ys: Float32Array, color: string, alpha: number, light: 1 | -1, bottom: number, lean = 0.3): void {
  const { ctx, w, h, rng } = S;
  const n = ys.length - 1;
  const X = (i: number) => (i / n) * w;
  const step = Math.max(2, Math.round(n / 140));
  const peaks: number[] = [];
  const valleys: number[] = [];
  for (let i = step; i < n - step; i++) {
    const a = ys[i - step];
    const b = ys[i];
    const c = ys[i + step];
    if (b < a && b <= c) {
      if (!peaks.length || i - peaks[peaks.length - 1] > step) peaks.push(i);
    } else if (b > a && b >= c) {
      if (!valleys.length || i - valleys[valleys.length - 1] > step) valleys.push(i);
    }
  }
  ctx.save();
  ctx.fillStyle = lin(ctx, 0, minOf(ys), 0, bottom, [
    [0, rgba(color, alpha)],
    [1, rgba(color, alpha * 0.3)],
  ]);
  for (const p of peaks) {
    let v = -1;
    if (light === 1) {
      for (const q of valleys) if (q > p) { v = q; break; }
    } else {
      for (let k = valleys.length - 1; k >= 0; k--) if (valleys[k] < p) { v = valleys[k]; break; }
    }
    if (v < 0 || Math.abs(ys[v] - ys[p]) < h * 0.012) continue;
    const sh = -light * lean * rng.range(0.75, 1.25);
    ctx.beginPath();
    ctx.moveTo(X(p), ys[p]);
    if (light === 1) for (let i = p + 1; i <= v; i++) ctx.lineTo(X(i), ys[i]);
    else for (let i = p - 1; i >= v; i--) ctx.lineTo(X(i), ys[i]);
    ctx.lineTo(X(v) + sh * (bottom - ys[v]), bottom);
    ctx.lineTo(X(p) + sh * (bottom - ys[p]), bottom);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/* ---- trees ---- */

function pineTriangles(ctx: Ctx, cx: number, baseY: number, H: number, W: number, tiers: number): void {
  for (let k = 0; k < tiers; k++) {
    const ya = baseY - H + H * (k / tiers) * 0.82;
    const yb = baseY - H + H * ((k + 1) / tiers) * 0.9 + H * 0.1;
    const hw = (W / 2) * (0.3 + 0.7 * ((k + 1) / tiers));
    ctx.moveTo(cx, ya);
    ctx.lineTo(cx + hw, yb);
    ctx.lineTo(cx - hw, yb);
    ctx.closePath();
  }
}
interface PineOpts {
  count: number;
  /** heights as fractions of the picture height */
  h0: number;
  h1: number;
  /** width / height */
  slim?: number;
  color: string;
  /** vertical offset of the tree base below the crest, fraction of H */
  sink?: number;
  from?: number;
  to?: number;
  tiers?: number;
  /** density(t) 0..1 thins the forest where it returns small values */
  density?: (t: number) => number;
}
function pines(S: Scene, ys: Float32Array, o: PineOpts): void {
  const { ctx, w, h, rng } = S;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  for (let i = 0; i < o.count; i++) {
    const t = lerp(o.from ?? 0, o.to ?? 1, rng());
    const keep = rng();
    const hh = rng.range(o.h0, o.h1) * h;
    const tiers = o.tiers ?? rng.int(4, 6);
    if (o.density && keep > o.density(t)) continue;
    const x = t * w;
    pineTriangles(ctx, x, yAt(ys, t) + (o.sink ?? 0.01) * h, hh, hh * (o.slim ?? 0.42), tiers);
  }
  ctx.fill();
}

/* ---- sky furniture ---- */

function stars(
  S: Scene,
  count: number,
  o: { y0?: number; y1?: number; size?: number; warm?: string; cool?: string; bright?: number } = {},
): void {
  const { ctx, w, h, rng } = S;
  const y0 = (o.y0 ?? 0) * h;
  const y1 = (o.y1 ?? 1) * h;
  const size = (o.size ?? 1) * Math.max(0.6, S.px);
  const warm = o.warm ?? "#ffe9c9";
  const cool = o.cool ?? "#cfe0ff";
  const levels = [0.18, 0.3, 0.45, 0.62, 0.8, 1].map((a) => ({ w: rgba("#ffffff", a), c: rgba(cool, a), k: rgba(warm, a) }));
  ctx.save();
  const big: Array<[number, number, number, string]> = [];
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = y0 + rng() * (y1 - y0);
    const b = Math.pow(rng(), 3.2);
    const tone = rng();
    const lv = levels[Math.min(5, Math.floor(b * 6))];
    ctx.fillStyle = tone < 0.5 ? lv.w : tone < 0.78 ? lv.c : lv.k;
    const r = (0.45 + b * 0.9) * size;
    if (r < 0.9) ctx.fillRect(x, y, r * 1.2, r * 1.2);
    else {
      ctx.beginPath();
      ctx.arc(x, y, r, 0, TAU);
      ctx.fill();
    }
    if (b > (o.bright ?? 0.97)) big.push([x, y, r, tone < 0.5 ? "#ffffff" : tone < 0.78 ? cool : warm]);
  }
  for (const [x, y, r, c] of big) {
    glow(S, x, y, r * 7, c, 0.5);
    ctx.strokeStyle = rgba(c, 0.55);
    ctx.lineWidth = Math.max(0.5, r * 0.28);
    ctx.beginPath();
    ctx.moveTo(x - r * 5, y);
    ctx.lineTo(x + r * 5, y);
    ctx.moveTo(x, y - r * 5);
    ctx.lineTo(x, y + r * 5);
    ctx.stroke();
  }
  ctx.restore();
}

interface CloudOpts {
  y0: number;
  y1: number;
  /** noise frequency across / down the band (higher = smaller clouds) */
  fx: number;
  fy: number;
  /** 0..1, share of the band covered */
  cover: number;
  soft?: number;
  lit: string;
  shade: string;
  alpha?: number;
  /** direction towards the light, in noise space */
  light?: [number, number];
  seed?: number;
  res?: number;
  oct?: number;
}
/** Noise-thresholded cloud band with simple self-shadowing. */
function clouds(S: Scene, o: CloudOpts): void {
  const asp = S.w / S.h;
  const [lx, ly] = o.light ?? [0.6, -0.8];
  const lit = rgbOf(o.lit);
  const shade = rgbOf(o.shade);
  const soft = o.soft ?? 0.22;
  const off = (o.seed ?? 0) * 5.7;
  const oct = o.oct ?? 5;
  field(
    S,
    o.res ?? 360,
    (u, v, out) => {
      const x = u * asp * o.fx + off;
      const y = v * o.fy + off * 0.6;
      const d = S.noise.fbm(x, y, oct);
      const th = 1 - o.cover;
      const a = smooth(th, th + soft, d);
      if (a <= 0.003) {
        out[3] = 0;
        return;
      }
      const d2 = S.noise.fbm(x + lx * 0.12, y + ly * 0.12, oct);
      const l = clamp(0.55 + (d2 - d) * 5.5);
      const band = smooth(0, 0.35, v) * (1 - smooth(0.62, 1, v));
      out[0] = lerp(shade[0], lit[0], l);
      out[1] = lerp(shade[1], lit[1], l);
      out[2] = lerp(shade[2], lit[2], l);
      out[3] = a * band;
    },
    { x: 0, y: o.y0 * S.h, w: S.w, h: (o.y1 - o.y0) * S.h },
    "source-over",
    o.alpha ?? 1,
  );
}

function birds(S: Scene, list: Array<[number, number, number]>, color: string): void {
  const { ctx, w, h } = S;
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const [fx, fy, size] of list) {
    const s = size * S.U;
    const x = fx * w;
    const y = fy * h;
    ctx.lineWidth = Math.max(0.8, s * 0.13);
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.12);
    ctx.quadraticCurveTo(x - s * 0.5, y - s * 0.55, x, y);
    ctx.quadraticCurveTo(x + s * 0.5, y - s * 0.55, x + s, y - s * 0.12);
    ctx.stroke();
  }
  ctx.restore();
}

/** Flat translucent haze band. */
function haze(S: Scene, y0: number, y1: number, color: string, aTop: number, aBottom: number): void {
  fillV(S, y0, y1, [
    [0, rgba(color, aTop)],
    [1, rgba(color, aBottom)],
  ]);
}

/* ---- heightfield terrain (voxel-space style renderer) ---- */

interface TerrainOpts {
  /** ground height at world (x, z); `dist` is the camera distance, for level-of-detail */
  height(x: number, z: number, dist: number): number;
  /** write the surface albedo (0..255) into `o`; `ny` = up component of the normal */
  albedo(x: number, z: number, h: number, ny: number, dist: number, o: Float32Array): void;
  camY: number;
  camX?: number;
  camZ?: number;
  /** horizon line, fraction of the picture height */
  horizon: number;
  /** half width of the view at distance 1 (smaller = longer lens) */
  fov: number;
  zNear: number;
  zFar: number;
  /** typical camera height above the ground nearby: sets how fine the slices are */
  drop: number;
  /** unit vector towards the sun */
  sun: [number, number, number];
  sunRGB: [number, number, number];
  ambRGB: [number, number, number];
  fog: string;
  /** fog density: amount = 1 - exp(-dist * fogK) */
  fogK: number;
  /** extra fog by altitude (valley mist): returns 0..1 */
  mist?: (h: number, dist: number) => number;
  res?: number;
  /** relative step between far slices (smaller = finer, slower) */
  step?: number;
}
/**
 * Renders a heightfield seen from a camera looking along +z. Slices are swept from near to far
 * and each slice paints only what rises above everything nearer (the classic "voxel space"
 * trick), with Lambert lighting from finite differences and distance fog. The sky stays transparent.
 */
function terrain(S: Scene, o: TerrainOpts): void {
  const k = Math.min(1, (o.res ?? 520) / Math.max(S.w, S.h));
  const bw = Math.max(8, Math.ceil(S.w * k));
  const bh = Math.max(8, Math.ceil(S.h * k));
  const cv = makeCanvas(bw, bh);
  const c = ctxOf(cv);
  const img = c.createImageData(bw, bh);
  const d = img.data;
  const f = bw / (2 * o.fov);
  const hy = o.horizon * bh;
  const fog = rgbOf(o.fog);
  const [sx, sy, sz] = o.sun;
  const camX = o.camX ?? 0;
  const camZ = o.camZ ?? 0;
  const col = new Float32Array(3);
  const top = new Float32Array(bw).fill(bh);
  const topH = new Float32Array(bw).fill(-1e9);
  let prev = new Float32Array(bw);
  let cur = new Float32Array(bw);
  const step = o.step ?? 0.012;
  const fine = 0.8 / (o.drop * f);
  const dzOf = (z: number) => Math.min(z * step + 0.002, z * z * fine);
  let zPrev = o.zNear - dzOf(o.zNear);
  for (let i = 0; i < bw; i++) prev[i] = o.height(camX + ((i + 0.5) / bw - 0.5) * 2 * o.fov * zPrev, camZ + zPrev, zPrev);
  let open = bw;
  for (let z = o.zNear; z < o.zFar && open > 0; z += dzOf(z)) {
    const fogAmt = 1 - Math.exp(-z * o.fogK);
    const wz = camZ + z;
    const span = 2 * o.fov * z;
    const dxl = span / bw;
    const dzr = z - zPrev;
    for (let i = 0; i < bw; i++) {
      if (top[i] <= 0) continue;
      const rx = ((i + 0.5) / bw - 0.5) * 2 * o.fov;
      const x = camX + rx * z;
      const hg = o.height(x, wz, z);
      cur[i] = hg;
      const syp = hy + ((o.camY - hg) * f) / z;
      if (syp >= top[i]) continue;
      const y0 = Math.max(0, Math.ceil(syp));
      if (y0 >= top[i]) continue;
      const dHl = i > 0 && top[i - 1] > 0 ? hg - cur[i - 1] : 0;
      const dHr = hg - prev[i];
      const gx = -dzr * dHl;
      const gy = dzr * dxl;
      const gz = rx * dzr * dHl - dHr * dxl;
      const inv = 1 / Math.sqrt(gx * gx + gy * gy + gz * gz || 1);
      const ny = gy * inv;
      const lamb = Math.max(0, gx * inv * sx + ny * sy + gz * inv * sz);
      const up = 0.5 + 0.5 * ny;
      const lr = o.ambRGB[0] * up + o.sunRGB[0] * lamb;
      const lg = o.ambRGB[1] * up + o.sunRGB[1] * lamb;
      const lb = o.ambRGB[2] * up + o.sunRGB[2] * lamb;
      const fa = clamp(fogAmt + (o.mist ? o.mist(hg, z) * (1 - fogAmt) : 0));
      // a long span is a cliff face between two slices: walk the height down it so strata stay horizontal
      const rows = top[i] - y0;
      const hb = topH[i];
      const walk = rows > 1.5 && hb > -1e8 && Math.abs(hb - hg) > 0.6;
      if (!walk) o.albedo(x, wz, hg, ny, z, col);
      for (let y = y0, p = (y0 * bw + i) * 4; y < top[i]; y++, p += bw * 4) {
        if (walk) o.albedo(x, wz, hg + (hb - hg) * ((y - y0 + 0.5) / rows), ny, z, col);
        d[p] = col[0] * lr + (fog[0] - col[0] * lr) * fa;
        d[p + 1] = col[1] * lg + (fog[1] - col[1] * lg) * fa;
        d[p + 2] = col[2] * lb + (fog[2] - col[2] * lb) * fa;
        d[p + 3] = 255;
      }
      top[i] = y0;
      topH[i] = hg;
      if (y0 <= 0) open--;
    }
    const t = prev;
    prev = cur;
    cur = t;
    zPrev = z;
  }
  c.putImageData(img, 0, 0);
  const ctx = S.ctx;
  ctx.save();
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(cv as CanvasImageSource, 0, 0, S.w, S.h);
  ctx.restore();
}

/** Normalised direction vector. */
const unit = (x: number, y: number, z: number): [number, number, number] => {
  const l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
};
/** Polynomial smooth minimum (k = blend width). */
const smin = (a: number, b: number, k: number) => {
  const hh = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - (hh * hh * k) / 4;
};

interface MountainOpts {
  /** 1: light comes from the left, -1: from the right */
  light: 1 | -1;
  snow: string;
  snowShade: string;
  rock: string;
  rockShade: string;
  /** how far the snow reaches down from the crest, fraction of the relief height */
  snowDepth: number;
  fog: string;
  /** share of fog at the foot of the layer */
  foot: number;
  /** alpha of the shadow facets */
  facet?: number;
  /** alpha of the rim light along the lit crest */
  rim?: number;
  rimColor?: string;
  /** alpha of the vertical rock streaks */
  streaks?: number;
  seed?: number;
  bottom?: number;
}
/**
 * An alpine mountain mass under a ridgeline: rock body with fog at its foot, a snow cap whose lower
 * edge sends tongues down the gullies, shadow facets on the side facing away from the light,
 * subtle rock streaks and a rim of light along the crest.
 */
function mountain(S: Scene, ys: Float32Array, o: MountainOpts): void {
  const { ctx, w, noise } = S;
  const bottom = o.bottom ?? S.h;
  const top = minOf(ys);
  const H = Math.max(8, bottom - top);
  const n = ys.length - 1;
  const X = (i: number) => (i / n) * w;
  const seed = (o.seed ?? 0) * 5.3;
  // rock body, fading into fog at the foot
  fillCrest(S, ys, mixc(o.rock, o.fog, 0.05), mixc(o.rock, o.fog, o.foot), bottom, top);
  ctx.save();
  crestPath(S, ys, bottom);
  ctx.clip();
  // snow cap with tongues
  ctx.beginPath();
  ctx.moveTo(0, ys[0] - 4);
  for (let i = 0; i <= n; i++) ctx.lineTo(X(i), ys[i] - 2);
  for (let i = n; i >= 0; i--) {
    const t = i / n;
    const tongue = noise.ridged(t * 11 + seed, 1.3 + seed, 4);
    const depth = H * o.snowDepth * (0.12 + 0.88 * Math.pow(tongue, 1.6)) * (0.55 + 0.9 * noise.fbm(t * 3 + seed, 7, 2));
    ctx.lineTo(X(i), ys[i] + depth);
  }
  ctx.closePath();
  ctx.fillStyle = lin(ctx, 0, top, 0, top + H * o.snowDepth * 1.1, [
    [0, o.snow],
    [1, mixc(o.snow, o.snowShade, 0.45)],
  ]);
  ctx.fill();
  // vertical streaks of rock and snow, very subtle
  if (o.streaks) {
    field(
      S,
      360,
      (u, v, out) => {
        const s = noise.ridged(u * 46 + seed, v * 3.2, 3);
        out[0] = 20;
        out[1] = 24;
        out[2] = 50;
        out[3] = o.streaks! * smooth(0.45, 0.95, s) * (0.4 + 0.6 * v);
      },
      { x: 0, y: top, w, h: H },
    );
  }
  ctx.restore();
  if (o.facet) facets(S, ys, mixc(o.snowShade, o.rockShade, 0.4), o.facet, o.light, bottom, 0.36);
  if (o.rim) rimLight(S, ys, o.rimColor ?? "#fff4e6", o.rim, o.light, 1.7);
}

/** Fog that fades in and out again: a soft band between two ridgelines. */
function fogBand(S: Scene, y0: number, y1: number, color: string, a: number, peak = 0.62): void {
  fillV(S, y0, y1, [
    [0, rgba(color, 0)],
    [peak, rgba(color, a)],
    [1, rgba(color, 0)],
  ]);
}

/* ---- palm fronds ---- */

interface FrondOpts {
  /** colour of the leaflets on the lit / shaded side of the midrib */
  a: string;
  b: string;
  /** colour towards the tip */
  tip?: string;
  /** how far the frond bends towards the ground (radians) */
  droop?: number;
  /** number of leaflets per side */
  leaflets?: number;
  /** leaflet length as a fraction of the frond length */
  leaf?: number;
  /** leaflets fan out less when this is small */
  spread?: number;
  /** leaflet base width multiplier (>1 makes the blades overlap into a continuous leaf) */
  width?: number;
}
/** A palm frond: an arching midrib with tapered leaflets on both sides. `heading` in radians (0 = right, -PI/2 = up). */
function frond(S: Scene, x: number, y: number, heading: number, len: number, o: FrondOpts): void {
  const { ctx } = S;
  const n = o.leaflets ?? 44;
  const droop = o.droop ?? 1.1;
  const sgn = Math.cos(heading) >= 0 ? 1 : -1;
  const pts: Array<[number, number, number]> = [];
  let px = x;
  let py = y;
  for (let i = 0; i <= n; i++) {
    const th = heading + sgn * droop * Math.pow(i / n, 1.7);
    pts.push([px, py, th]);
    px += (Math.cos(th) * len) / n;
    py += (Math.sin(th) * len) / n;
  }
  ctx.save();
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  for (const side of [-1, 1]) {
    ctx.beginPath();
    for (let i = 2; i <= n; i++) {
      const t = i / n;
      const [bx, by, th] = pts[i];
      const L = len * (o.leaf ?? 0.3) * Math.sin(Math.PI * Math.min(1, 0.1 + 0.9 * Math.pow(t, 0.85)));
      const ang = th + side * lerp(1.2, 0.5, t) * (o.spread ?? 1);
      const dx = Math.cos(ang);
      const dy = Math.sin(ang);
      const ex = bx + dx * L;
      const ey = by + dy * L + L * 0.3;
      const wd = len * 0.02 * (o.width ?? 1) * (1 - 0.55 * t);
      const nx = Math.cos(th) * wd;
      const ny = Math.sin(th) * wd;
      ctx.moveTo(bx - nx, by - ny);
      ctx.quadraticCurveTo(bx + dx * L * 0.5 - nx * 0.4, by + dy * L * 0.5 + L * 0.06, ex, ey);
      ctx.quadraticCurveTo(bx + dx * L * 0.55 + nx * 1.4, by + dy * L * 0.55 + L * 0.14 + ny * 1.4, bx + nx, by + ny);
      ctx.closePath();
    }
    ctx.fillStyle = lin(ctx, x, y, px, py, [
      [0, side > 0 ? o.a : o.b],
      [1, o.tip ?? (side > 0 ? o.a : o.b)],
    ]);
    ctx.fill();
  }
  ctx.strokeStyle = o.b;
  ctx.lineWidth = Math.max(1, len * 0.011);
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (const p of pts) ctx.lineTo(p[0], p[1]);
  ctx.stroke();
  ctx.restore();
}

/* ---- city ---- */

interface SkylineOpts {
  /** baseline (fraction of the height) and building heights (fraction of the height) */
  base: number;
  h0: number;
  h1: number;
  /** building widths (fraction of the width) */
  w0: number;
  w1: number;
  color: string;
  /** colour of the roofs / top of the body gradient (defaults to `color`) */
  top?: string;
  seed?: number;
  /** share of towers that are much taller than the rest */
  landmarks?: number;
  /** fraction of windows that are lit (0 = none drawn) */
  lit?: number;
  litColors?: string[];
  /** window pitch as a fraction of the width */
  pitch?: number;
}
/**
 * One row of buildings. Returns the lit windows painted on a separate transparent layer (for blooms),
 * or null when the row has no windows.
 */
function skyline(S: Scene, o: SkylineOpts): Surface | null {
  const { ctx, w, h, rng } = S;
  const base = o.base * h;
  const lit = o.lit ?? 0;
  const pitch = (o.pitch ?? 0.0085) * w;
  const colors = o.litColors ?? ["#ffd98a", "#ffc46b", "#fff0c4", "#cfe8ff"];
  const glowLayer = lit > 0 ? makeCanvas(w, h) : null;
  const gctx = glowLayer ? ctxOf(glowLayer) : null;
  const rects: Array<[number, number, number, number, number]> = [];
  ctx.beginPath();
  let x = -0.02 * w;
  while (x < w * 1.02) {
    const bw = rng.range(o.w0, o.w1) * w;
    const tall = rng() < (o.landmarks ?? 0.08);
    const bh = lerp(o.h0, o.h1, Math.pow(rng(), 1.5)) * h * (tall ? 1.55 : 1);
    const kind = rng();
    const y = base - bh;
    ctx.rect(x, y, bw, bh + 2);
    if (kind < 0.28) ctx.rect(x + bw * 0.2, y - bh * 0.1, bw * 0.6, bh * 0.1 + 2); // stepped crown
    else if (kind < 0.4) ctx.rect(x + bw * 0.46, y - bh * 0.22, bw * 0.05, bh * 0.22 + 2); // antenna
    else if (kind < 0.5) {
      ctx.moveTo(x + bw * 0.1, y + 1);
      ctx.lineTo(x + bw * 0.5, y - bw * 0.35);
      ctx.lineTo(x + bw * 0.9, y + 1);
      ctx.closePath();
    }
    if (lit > 0) {
      const p = lit * rng.range(0.25, 1.3);
      const cols = Math.max(1, Math.floor((bw - pitch * 0.9) / pitch));
      const rows = Math.max(1, Math.floor((bh - pitch * 1.2) / (pitch * 1.45)));
      const ox = x + (bw - cols * pitch) / 2 + pitch * 0.2;
      for (let r = 0; r < rows; r++) {
        const rowOn = rng() < 0.82 ? 1 : 0.15;
        for (let c = 0; c < cols; c++) {
          if (rng() < p * rowOn) rects.push([ox + c * pitch, y + pitch * 0.9 + r * pitch * 1.45, rng.int(0, colors.length - 1), rng.range(0.55, 1), 0]);
        }
      }
    }
    x += bw * rng.range(0.9, 1.0);
  }
  const top = o.top ?? o.color;
  const miny = base - o.h1 * h * 1.7;
  ctx.fillStyle = top === o.color ? o.color : lin(ctx, 0, miny, 0, base, [[0, top], [1, o.color]]);
  ctx.fill();
  if (rects.length) {
    for (let ci = 0; ci < colors.length; ci++) {
      for (const target of [ctx, gctx!]) {
        target.fillStyle = colors[ci];
        for (let lv = 0; lv < 3; lv++) {
          target.globalAlpha = 0.45 + lv * 0.27;
          target.beginPath();
          for (const r of rects) if (r[2] === ci && Math.min(2, Math.floor((r[3] - 0.55) * 6.6)) === lv) target.rect(r[0], r[1], pitch * 0.5, pitch * 0.72);
          target.fill();
        }
        target.globalAlpha = 1;
      }
    }
  }
  return glowLayer;
}

/** Smooth "mesh gradient": a grid of colours blended bicubically, with the sample position swirled by noise. */
function meshGrid(S: Scene, grid: string[][], o: { warp?: number; freq?: number; seed?: number; res?: number } = {}): void {
  const rows = grid.length;
  const cols = grid[0].length;
  const g = grid.map((r) => r.map(rgbOf));
  const warp = o.warp ?? 0.12;
  const f = o.freq ?? 1.6;
  const off = (o.seed ?? 0) * 3.3;
  const cr = (p0: number, p1: number, p2: number, p3: number, t: number) =>
    0.5 * (2 * p1 + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t * t + (-p0 + 3 * p1 - 3 * p2 + p3) * t * t * t);
  const ci = (i: number) => (i < 0 ? 0 : i > cols - 1 ? cols - 1 : i);
  const ri = (j: number) => (j < 0 ? 0 : j > rows - 1 ? rows - 1 : j);
  const colv = new Float32Array(4);
  field(S, o.res ?? 220, (u, v, out) => {
    const x = clamp(u + (S.noise.fbm(u * f + off, v * f, 3) - 0.5) * warp * 2) * (cols - 1);
    const y = clamp(v + (S.noise.fbm(u * f, v * f + off + 9, 3) - 0.5) * warp * 2) * (rows - 1);
    const ix = Math.min(cols - 2, Math.floor(x));
    const iy = Math.min(rows - 2, Math.floor(y));
    const tx = x - ix;
    const ty = y - iy;
    for (let c = 0; c < 3; c++) {
      for (let k = -1; k <= 2; k++) {
        const r = g[ri(iy + k)];
        colv[k + 1] = cr(r[ci(ix - 1)][c], r[ci(ix)][c], r[ci(ix + 1)][c], r[ci(ix + 2)][c], tx);
      }
      out[c] = cr(colv[0], colv[1], colv[2], colv[3], ty);
    }
  });
}

/* ---- monstera leaf ---- */

/**
 * Heart-shaped leaf with deep slits and holes, tip pointing up; (x, y) is where the stalk meets the blade.
 * The blade is composed on a scratch canvas so the slits can be cut out and cast a real shadow.
 */
function monsteraLeaf(
  S: Scene,
  x: number,
  y: number,
  size: number,
  rot: number,
  o: { light: string; dark: string; seed: number },
): void {
  const L = size * 0.98;
  const W = size * 0.52;
  const bw = Math.ceil(W * 2.5);
  const bh = Math.ceil(L * 1.16);
  const ox = bw / 2;
  const oy = L * 1.02;
  const cv = makeCanvas(bw, bh);
  const c = ctxOf(cv);
  c.translate(ox, oy);
  const hw = (s: number) => W * Math.pow(Math.sin(Math.PI * Math.pow(clamp(s), 0.7)), 0.82) * (1 - 0.2 * s);
  const N = 70;
  // blade outline plus the two rounded basal lobes
  c.beginPath();
  for (let i = 0; i <= N; i++) c.lineTo(hw(i / N), -(i / N) * L);
  for (let i = N; i >= 0; i--) c.lineTo(-hw(i / N), -(i / N) * L);
  c.closePath();
  for (const s of [-1, 1]) {
    c.moveTo(s * W * 0.74, -L * 0.13);
    c.ellipse(s * W * 0.5, -L * 0.13, W * 0.5, L * 0.15, s * 0.25, 0, TAU);
  }
  c.fillStyle = lin(c, -W, 0, W, -L * 0.5, [[0, o.light], [0.5, mixc(o.light, o.dark, 0.45)], [1, o.dark]]);
  c.fill();
  // veins, sheen and midrib only touch pixels that are already leaf
  c.globalCompositeOperation = "source-atop";
  c.strokeStyle = rgba("#d9f3b9", 0.4);
  c.lineCap = "round";
  c.lineWidth = Math.max(1, size * 0.0042);
  for (let k = 1; k <= 9; k++) {
    const s0 = 0.06 + k * 0.088;
    for (const s of [-1, 1]) {
      c.beginPath();
      c.moveTo(0, -L * s0);
      c.quadraticCurveTo(s * W * 0.45, -L * (s0 + 0.01), s * hw(s0 + 0.15) * 0.97, -L * (s0 + 0.16));
      c.stroke();
    }
  }
  c.fillStyle = rad(c, -W * 0.4, -L * 0.7, L * 0.8, [[0, "rgba(255,255,255,.22)"], [1, "rgba(255,255,255,0)"]]);
  c.fillRect(-bw, -bh, bw * 2, bh * 2);
  c.strokeStyle = rgba("#e6f8cc", 0.75);
  c.lineWidth = Math.max(1.2, size * 0.011);
  c.beginPath();
  c.moveTo(0, 0);
  c.quadraticCurveTo(size * 0.015, -L * 0.5, 0, -L * 0.985);
  c.stroke();
  // cut the slits and holes out of the blade
  c.globalCompositeOperation = "destination-out";
  c.fillStyle = "#000";
  for (const s of [-1, 1]) {
    for (let k = 0; k < 5; k++) {
      const sk = 0.2 + k * 0.145;
      const jitter = 0.02 * S.noise.n(o.seed * 3 + k, s * 2.1);
      const ix = s * W * 0.2;
      const iy = -L * (sk + jitter);
      const dx = s * 1;
      const dy = -0.5;
      const dl = Math.hypot(dx, dy);
      const ex = ix + (dx / dl) * W * 1.25;
      const ey = iy + (dy / dl) * W * 1.25;
      const nx = -dy / dl;
      const ny = dx / dl;
      const wi = size * 0.01;
      const wo = size * 0.045;
      c.beginPath();
      c.moveTo(ix - nx * wi, iy - ny * wi);
      c.lineTo(ex - nx * wo, ey - ny * wo);
      c.lineTo(ex + nx * wo, ey + ny * wo);
      c.lineTo(ix + nx * wi, iy + ny * wi);
      c.closePath();
      c.fill();
      c.beginPath();
      c.arc(ix, iy, wi, 0, TAU);
      c.fill();
    }
    for (let k = 0; k < 3; k++) {
      c.beginPath();
      c.ellipse(s * W * (0.16 + 0.015 * k), -L * (0.3 + k * 0.2), size * 0.02, size * 0.034, s * 0.5, 0, TAU);
      c.fill();
    }
  }
  const { ctx } = S;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.shadowColor = "rgba(50,35,25,.3)";
  ctx.shadowBlur = size * 0.05;
  ctx.shadowOffsetX = size * 0.012;
  ctx.shadowOffsetY = size * 0.03;
  ctx.drawImage(cv as CanvasImageSource, -ox, -oy);
  ctx.shadowColor = "transparent";
  ctx.strokeStyle = o.dark;
  ctx.lineWidth = Math.max(1.5, size * 0.016);
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(-size * 0.03, size * 0.35, size * 0.04, size * 0.9);
  ctx.stroke();
  ctx.restore();
}


/* ---- composed helpers ---- */

interface Hill extends Omit<CrestOpts, "seed"> {
  seed?: number;
  color: string;
  /** share of the fog colour mixed into the layer (atmospheric perspective) */
  fog?: number;
  /** how far the foot of the layer fades into the fog colour (default .5) */
  foot?: number;
  rim?: number;
  facet?: number;
  pines?: Omit<PineOpts, "color"> & { color?: string };
}
/** Back-to-front ridgelines with atmospheric perspective. Returns each layer's crest. */
function hillStack(
  S: Scene,
  hills: Hill[],
  o: { fog: string; light: 1 | -1; rim?: string; facetColor?: string },
): Float32Array[] {
  return hills.map((hl, i) => {
    const ys = crest(S, { ...hl, seed: hl.seed ?? i + 1 });
    const col = mixc(hl.color, o.fog, hl.fog ?? 0);
    fillCrest(S, ys, col, mixc(col, o.fog, hl.foot ?? 0.5));
    if (hl.facet) facets(S, ys, o.facetColor ?? mixc(hl.color, "#141a3a", 0.55), hl.facet, o.light, S.h);
    if (hl.rim && o.rim) rimLight(S, ys, o.rim, hl.rim, o.light);
    if (hl.pines) pines(S, ys, { ...hl.pines, color: hl.pines.color ?? mixc(col, "#06101c", 0.32) });
    return ys;
  });
}

/** A solid band of fir trees whose tips make the skyline; painted down to the bottom edge. */
function pineRow(
  S: Scene,
  o: { base: number; h0: number; h1: number; step: number; color: string; seed?: number; wave?: number; slim?: number; tiers?: number },
): void {
  const { ctx, w, h, noise, rng } = S;
  const off = (o.seed ?? 0) * 3.7;
  const wave = o.wave ?? 0.03;
  ctx.fillStyle = o.color;
  ctx.beginPath();
  let x = -o.step * w;
  while (x < w * (1 + o.step)) {
    const t = x / w;
    const nh = noise.fbm(t * 7 + off, 0.5 + off, 3);
    const hh = lerp(o.h0, o.h1, clamp(nh * 1.5 - 0.25) * rng.range(0.75, 1)) * h;
    const by = (o.base + (noise.fbm(t * 2.2 + off, 7.1 + off, 2) - 0.5) * wave) * h;
    pineTriangles(ctx, x, by + 0.012 * h, hh, hh * (o.slim ?? 0.4), o.tiers ?? 5);
    x += o.step * w * rng.range(0.55, 1.3);
  }
  ctx.fill();
  ctx.fillRect(0, (o.base + wave * 0.5 - o.h0 * 0.45) * h, w, h);
}

/** Fan of soft light beams from a point. Angles in degrees, 0 = right, 90 = down. */
function rays(
  S: Scene,
  ox: number,
  oy: number,
  o: { angle: number; spread: number; count: number; length: number; color: string; alpha: number; width?: [number, number] },
): void {
  const { ctx, rng } = S;
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  const [w0, w1] = o.width ?? [1.2, 4];
  for (let i = 0; i < o.count; i++) {
    const a = ((o.angle + (rng() - 0.5) * o.spread) * Math.PI) / 180;
    const wd = (rng.range(w0, w1) * Math.PI) / 180;
    const len = o.length * rng.range(0.6, 1);
    const ex = ox + Math.cos(a) * len;
    const ey = oy + Math.sin(a) * len;
    ctx.fillStyle = lin(ctx, ox, oy, ex, ey, [
      [0, rgba(o.color, o.alpha * rng.range(0.35, 1))],
      [1, rgba(o.color, 0)],
    ]);
    ctx.beginPath();
    ctx.moveTo(ox, oy);
    ctx.lineTo(ox + Math.cos(a - wd / 2) * len, oy + Math.sin(a - wd / 2) * len);
    ctx.lineTo(ox + Math.cos(a + wd / 2) * len, oy + Math.sin(a + wd / 2) * len);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

/**
 * Mirror `src` (the part of the picture above the waterline, as tall as `waterY`) into the water
 * below it, strip by strip so the surface can ripple.
 */
function reflect(
  S: Scene,
  src: Surface,
  waterY: number,
  o: { alpha: number; ripple: number; tint: string; tintAlpha: number; strip?: number; seed?: number },
): void {
  const { ctx, w, h, noise } = S;
  const strip = Math.max(1, (o.strip ?? 2) * S.px);
  const total = h - waterY;
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, waterY, w, total);
  ctx.clip();
  ctx.fillStyle = o.tint;
  ctx.fillRect(0, waterY, w, total);
  ctx.globalAlpha = o.alpha;
  const rip = o.ripple * S.px;
  const off = (o.seed ?? 0) * 5.1;
  for (let yd = 0; yd < total; yd += strip) {
    const ysrc = waterY - yd - strip;
    if (ysrc < -strip) break;
    const d = yd / total;
    const dx = (noise.n(yd * 0.012 / S.px + off, 3.3) * 2.2 + Math.sin(yd * 0.21 / S.px + off)) * rip * (0.25 + 0.75 * d);
    ctx.drawImage(src as CanvasImageSource, 0, Math.max(0, ysrc), w, strip, dx - rip, waterY + yd, w + rip * 2, strip + 0.6);
  }
  ctx.globalAlpha = 1;
  fillV(S, waterY, h, [
    [0, rgba(o.tint, o.tintAlpha * 0.35)],
    [1, rgba(o.tint, o.tintAlpha)],
  ]);
  ctx.restore();
}

/* ========================================================================== */
/* 5. Painters                                                                */
/* ========================================================================== */

type Painter = (S: Scene) => void;
interface Entry {
  def: PhotoDef;
  seed: number;
  paint: Painter;
}
const REGISTRY = new Map<string, Entry>();
/** All photos, in panel order. Filled by the `photo(...)` calls below. */
export const PHOTOS: PhotoDef[] = [];

function photo(
  id: string,
  name: string,
  category: PhotoCategory,
  size: [number, number],
  tags: string,
  paint: Painter,
  seed = hashString(id),
): void {
  const def: PhotoDef = { id, name, category, tags: tags.split(/[\s,]+/).filter(Boolean), width: size[0], height: size[1] };
  PHOTOS.push(def);
  REGISTRY.set(id, { def, seed, paint });
}

const LANDSCAPE: [number, number] = [1600, 1067];
const WIDE: [number, number] = [1600, 900];
const PORTRAIT: [number, number] = [1200, 1500];
const SQUARE: [number, number] = [1400, 1400];

/* ---------------------------------------------------------------- landscapes */

photo("sunset-hills", "Sunset hills", "landscape", LANDSCAPE, "sunset dusk hills purple orange golden hour silhouette sky evening pines", (S) => {
  const { w, h } = S;
  const hz = 0.6 * h;
  fillV(S, 0, hz + 0.08 * h, [
    [0, "#161345"],
    [0.18, "#3a2377"],
    [0.38, "#8c3a87"],
    [0.55, "#df556f"],
    [0.72, "#fb8a62"],
    [0.87, "#ffb867"],
    [1, "#ffdc98"],
  ]);
  const sx = 0.7 * w;
  const sy = hz - 0.012 * h;
  clouds(S, { y0: 0.14, y1: 0.62, fx: 1.5, fy: 9, cover: 0.5, soft: 0.3, lit: "#ffb27a", shade: "#7a3a86", alpha: 0.55, seed: 2, light: [0.5, 1] });
  clouds(S, { y0: 0.34, y1: 0.64, fx: 2.2, fy: 11, cover: 0.38, soft: 0.25, lit: "#ffd9a0", shade: "#c0507f", alpha: 0.45, seed: 5, light: [0.5, 1] });
  sun(S, sx, sy, 0.032 * S.U, "#ff7a42", "#fff0c2");
  glow(S, sx, sy, 0.55 * w, "#ffa060", 0.3, "screen", 1, 0.12);
  birds(S, [[0.36, 0.27, 0.012], [0.4, 0.235, 0.009], [0.33, 0.225, 0.008], [0.43, 0.3, 0.007], [0.46, 0.26, 0.006]], "rgba(40,18,62,.75)");
  const forest = (i: number) => (t: number) => clamp(0.25 + 0.9 * S.noise.fbm(t * 5 + i * 3, 1.5));
  hillStack(
    S,
    [
      { base: 0.625, amp: 0.035, freq: 1.4, oct: 3, color: "#f08a86", foot: 0.45, rim: 0.5, tilt: -0.02 },
      { base: 0.665, amp: 0.045, freq: 1.7, oct: 3, color: "#d56583", foot: 0.5, rim: 0.45 },
      { base: 0.715, amp: 0.05, freq: 1.5, oct: 3, color: "#a74a88", foot: 0.5, rim: 0.4, tilt: 0.04 },
      { base: 0.77, amp: 0.06, freq: 1.8, oct: 4, color: "#78407e", foot: 0.45, rim: 0.35, pines: { count: 70, h0: 0.018, h1: 0.034, density: forest(1) } },
      { base: 0.84, amp: 0.07, freq: 2.0, oct: 4, color: "#4a3472", foot: 0.4, pines: { count: 90, h0: 0.026, h1: 0.05, density: forest(2) } },
      { base: 0.93, amp: 0.07, freq: 1.6, oct: 4, color: "#241f55", foot: 0.2, pines: { count: 70, h0: 0.05, h1: 0.1, density: forest(3) } },
    ],
    { fog: "#ffa578", light: -1, rim: "#ffd29a" },
  );
  vignette(S, 0.3, "#12062a");
  grain(S, 0.09, true);
});

photo("ocean-waves", "Ocean waves", "landscape", WIDE, "ocean sea waves water blue teal swell surf horizon sun summer golden hour", (S) => {
  const { ctx, w, h, noise, rng } = S;
  const hz = 0.4 * h;
  const sx = 0.66 * w;
  fillV(S, 0, hz + 1, [[0, "#1c4577"], [0.28, "#3f7bad"], [0.55, "#9cc6d2"], [0.8, "#f6dcb0"], [1, "#ffd9a2"]]);
  clouds(S, { y0: 0.02, y1: 0.4, fx: 1.4, fy: 8, cover: 0.42, soft: 0.3, lit: "#ffeacb", shade: "#6d98c2", alpha: 0.55, seed: 4, light: [0.6, 1] });
  sun(S, sx, hz - 0.012 * h, 0.026 * S.U, "#ffc977", "#fffbea", 1);
  fillV(S, hz, h, [[0, "#b9d3c6"], [0.04, "#3a98a2"], [0.3, "#0f6683"], [1, "#05294a"]]);
  glow(S, sx, hz + 0.16 * h, 0.55 * h, "#ffd89a", 0.7, "screen", 0.3, 1.2);
  const N = 26;
  const step = Math.max(5, w / 280);
  for (let k = 1; k <= N; k++) {
    const d = k / N;
    const yb = hz + Math.pow(d, 1.85) * (h - hz) * 1.05;
    const dy = (Math.pow(d, 1.85) - Math.pow((k - 1) / N, 1.85)) * (h - hz);
    const swell = 0.75 + 0.5 * noise.fbm(k * 1.7, 3.3, 2);
    const amp = dy * 0.7 * swell;
    const ph = k * 1.9;
    const edge = (x: number) => yb + amp * (noise.n((x / w) * (5 + d * 3) + k * 3.7, k * 1.3) * 1.7 + Math.sin((x / w) * (8 + k * 0.4) + ph) * 0.5);
    const crestC = mixc("#6fcbc8", "#e4fbf2", Math.pow(d, 1.3));
    const midC = mixc("#1c8fa6", "#2fb0b8", d);
    const deepC = mixc("#0a3f63", "#0b5f82", d);
    ctx.beginPath();
    ctx.moveTo(-10, h + 10);
    for (let x = -10; x <= w + 10; x += step) ctx.lineTo(x, edge(x));
    ctx.lineTo(w + 10, h + 10);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, yb - amp * 1.8, 0, yb + dy * 2.6, [[0, rgba(crestC, 0.97)], [0.16, midC], [1, deepC]]);
    ctx.fill();
    // crest highlight, broken up by noise
    ctx.lineCap = "round";
    ctx.lineWidth = (0.8 + 2.6 * d) * S.px;
    let run = -1;
    ctx.beginPath();
    for (let x = -10; x <= w + 10; x += step) {
      const a = (0.12 + 0.6 * d) * smooth(0.4, 0.7, noise.fbm((x / w) * 6 + k * 2.3, k));
      const lv = Math.floor(a * 7);
      if (lv !== run) {
        if (run > 0) {
          ctx.lineTo(x, edge(x));
          ctx.strokeStyle = rgba("#f4fffb", run / 8);
          ctx.stroke();
        }
        ctx.beginPath();
        ctx.moveTo(x, edge(x));
        run = lv;
      } else if (run > 0) ctx.lineTo(x, edge(x));
    }
    if (run > 0) {
      ctx.strokeStyle = rgba("#f4fffb", run / 8);
      ctx.stroke();
    }
    // sun glitter, denser and brighter nearer the sun's column
    const spread = w * (0.014 + 0.1 * d);
    const glints = Math.round(7 + 30 * d);
    ctx.fillStyle = "#fff0c8";
    for (let g = 0; g < glints; g++) {
      const gx = sx + rng.gauss() * spread;
      const gw = (6 + 62 * d) * S.px * rng.range(0.3, 1);
      const gy = yb + dy * rng.range(0.1, 0.85) + amp * 0.2;
      ctx.globalAlpha = rng.range(0.35, 0.95) * (1 - 0.35 * d);
      ctx.fillRect(gx - gw / 2, gy, gw, (0.9 + 1.8 * d) * S.px);
    }
    ctx.globalAlpha = 1;
  }
  // light falls off towards the viewer and warms towards the horizon
  fillV(S, hz, h, [[0, "rgba(255,226,170,.38)"], [0.3, "rgba(255,226,170,.0)"], [0.6, "rgba(2,28,58,.1)"], [1, "rgba(2,22,48,.5)"]]);
  haze(S, hz - 0.012 * h, hz + 0.1 * h, "#fbe3b8", 0.55, 0);
  vignette(S, 0.3, "#021a2e");
  grain(S, 0.08, true);
});

photo("mountain-lake", "Mountain lake", "landscape", LANDSCAPE, "mountain lake reflection alpine dawn pine forest snow peaks calm water still", (S) => {
  const { ctx, w, h } = S;
  const hz = 0.6 * h;
  const top = layer(S, w, hz, (L) => {
    const lh = L.h;
    fillV(L, 0, lh, [[0, "#3d5d92"], [0.35, "#8da5cf"], [0.62, "#f0c1b6"], [0.85, "#ffdfc4"], [1, "#ffeedc"]]);
    clouds(L, { y0: 0.05, y1: 0.7, fx: 1.6, fy: 9, cover: 0.36, soft: 0.3, lit: "#ffd5c2", shade: "#8396c4", alpha: 0.6, seed: 7, light: [-0.6, 0.8] });
    glow(L, 0.14 * w, 0.82 * lh, 0.5 * w, "#ffd1a6", 0.5, "screen", 1.3, 0.55);
    const far = crest(L, { base: 0.76, amp: 0.26, freq: 2.4, oct: 5, sharp: 0.9, seed: 3 });
    mountain(L, far, { light: 1, snow: "#f7eaef", snowShade: "#a9a8cf", rock: "#a79bbc", rockShade: "#7f7dad", snowDepth: 0.5, fog: "#eadbe6", foot: 0.66, facet: 0.3, rim: 0.45, seed: 1 });
    const main = crest(L, { base: 0.9, amp: 0.46, freq: 1.45, oct: 5, sharp: 1, seed: 9 });
    mountain(L, main, { light: 1, snow: "#fff9f5", snowShade: "#8092c9", rock: "#786b7e", rockShade: "#46477a", snowDepth: 0.46, fog: "#f0d8d6", foot: 0.5, facet: 0.5, rim: 0.8, streaks: 0.14, seed: 4 });
    fogBand(L, 0.45 * lh, lh, "#ffe8d8", 0.4, 0.8);
    hillStack(
      L,
      [
        { base: 1.0, amp: 0.2, freq: 2.2, oct: 4, sharp: 0.3, color: "#5b7392", fog: 0.25, foot: 0.55, facet: 0.0, pines: { count: 220, h0: 0.02, h1: 0.045, density: (t) => clamp(0.3 + S.noise.fbm(t * 6, 3) * 1.1) } },
        { base: 1.03, amp: 0.12, freq: 2.8, oct: 4, color: "#2c465f", fog: 0.1, foot: 0.4, pines: { count: 200, h0: 0.035, h1: 0.07 } },
      ],
      { fog: "#d9d3e2", light: 1, rim: "#ffd8c0", facetColor: "#586ca3" },
    );
    haze(L, 0.8 * lh, lh, "#ffe8d8", 0, 0.6);
  });
  ctx.drawImage(top as CanvasImageSource, 0, 0);
  reflect(S, top, hz, { alpha: 0.9, ripple: 3, tint: "#2d4b6c", tintAlpha: 0.42, seed: 2 });
  // sky glints on the water and a mist line at the shore
  ctx.save();
  ctx.fillStyle = "#ffe9dc";
  for (let i = 0; i < 90; i++) {
    const y = hz + Math.pow(S.rng(), 1.6) * (h - hz);
    ctx.globalAlpha = S.rng.range(0.05, 0.2);
    ctx.fillRect(S.rng() * w, y, S.rng.range(0.02, 0.1) * w, 1.3 * S.px);
  }
  ctx.restore();
  haze(S, hz - 0.01 * h, hz + 0.06 * h, "#ffeadb", 0.5, 0);
  // framing pines in the foreground
  const edge = crest(S, { base: 1.02, amp: 0.02, freq: 2, oct: 2, seed: 11 });
  pines(S, edge, { count: 34, from: 0, to: 0.2, h0: 0.2, h1: 0.4, slim: 0.36, color: "#0f1f2e", sink: 0.03 });
  pines(S, edge, { count: 30, from: 0.84, to: 1, h0: 0.16, h1: 0.34, slim: 0.36, color: "#0f1f2e", sink: 0.03 });
  vignette(S, 0.28, "#0a1220");
  grain(S, 0.08, true);
});

photo("desert-dunes", "Desert dunes", "landscape", PORTRAIT, "desert dunes sand sahara warm golden sun terracotta arid sky ridges", (S) => {
  const { ctx, w, h, noise } = S;
  const hz = 0.34;
  const fogC = "#f8dcc0";
  ctx.fillStyle = fogC;
  ctx.fillRect(0, 0, w, h);
  fillV(S, 0, hz * h + 2, [[0, "#e49f8c"], [0.3, "#eeb89f"], [0.62, "#f5d1b0"], [0.88, "#fae0c4"], [1, fogC]]);
  glow(S, 0.28 * w, 0.14 * h, 0.7 * w, "#ffe9c8", 0.55);
  sun(S, 0.28 * w, 0.14 * h, 0.034 * S.U, "#ffe2bd", "#fffaf0", 0.8);
  clouds(S, { y0: 0.02, y1: 0.34, fx: 1.2, fy: 9, cover: 0.28, soft: 0.3, lit: "#fff1e0", shade: "#e7b7a2", alpha: 0.45, seed: 3, light: [-0.5, -0.5] });
  const dune = (x: number, z: number, dist: number): number => {
    const wx = x + 36 * noise.n(x * 0.011, z * 0.011);
    const wz = z + 28 * noise.n(x * 0.011 + 7.3, z * 0.011 + 3.1);
    // ridges run diagonally; the steep slip face looks right, the gentle windward face looks left
    const p = (wz * 0.62 + wx * 0.78) / 55 + 0.9 * noise.n(wx * 0.012, wz * 0.012 + 5);
    const fr = p - Math.floor(p);
    const prof = smin(Math.pow(fr / 0.8, 1.5), Math.pow((1 - fr) / 0.2, 1.25), 0.22 + 0.3 * clamp(dist / 500));
    const amp = 5 + 15 * smooth(-0.15, 0.45, noise.n(wx * 0.007 + 3, wz * 0.007));
    // wind ripples run parallel to the crests and fade out before they would alias
    const rip = dist < 120 ? (0.075 * Math.sin(p * TAU * 13 + 6 * noise.n(wx * 0.04, wz * 0.04)) + 0.09 * noise.n(wx * 0.35, wz * 0.35)) * (1 - dist / 120) : 0;
    return amp * Math.min(prof, 1) + 9 * noise.n(wx * 0.004, wz * 0.004) + rip;
  };
  const sand = rgbOf("#f0b784");
  const sand2 = rgbOf("#d98d58");
  terrain(S, {
    height: dune,
    albedo: (x, z, hg, ny, dist, o) => {
      const m = clamp(noise.n(x * 0.02, z * 0.02) * 1.6 + 0.5 + (dist < 50 ? noise.n(x * 0.7, z * 0.7) * 0.22 : 0));
      o[0] = lerp(sand[0], sand2[0], m);
      o[1] = lerp(sand[1], sand2[1], m);
      o[2] = lerp(sand[2], sand2[2], m);
    },
    camY: 19,
    horizon: hz,
    fov: 0.62,
    zNear: 9,
    zFar: 700,
    drop: 10,
    sun: unit(-0.8, 0.42, 0.2),
    sunRGB: [1.18, 0.96, 0.72],
    ambRGB: [0.34, 0.3, 0.42],
    fog: fogC,
    fogK: 0.003,
    res: 500,
    step: 0.015,
  });
  vignette(S, 0.2, "#3a1530");
  grain(S, 0.09);
});

photo("forest-mist", "Misty forest", "landscape", PORTRAIT, "forest mist fog pine trees green foggy morning woods rays light", (S) => {
  const { w, h } = S;
  fillV(S, 0, h, [[0, "#a3b9b4"], [0.3, "#c8d8d2"], [0.6, "#e2eae4"], [1, "#c3d2cb"]]);
  glow(S, 0.22 * w, 0.06 * h, 0.8 * w, "#fffbe8", 0.6);
  rays(S, 0.15 * w, -0.08 * h, { angle: 66, spread: 46, count: 10, length: 1.5 * h, color: "#fff8de", alpha: 0.22, width: [1.5, 5] });
  const rows = [
    { base: 0.5, h0: 0.07, h1: 0.14, step: 0.014, c: "#9fb7b0", tiers: 4 },
    { base: 0.57, h0: 0.09, h1: 0.18, step: 0.017, c: "#7e9c97", tiers: 4 },
    { base: 0.65, h0: 0.12, h1: 0.23, step: 0.022, c: "#5d807b", tiers: 5 },
    { base: 0.74, h0: 0.16, h1: 0.3, step: 0.03, c: "#3f625f", tiers: 5 },
    { base: 0.84, h0: 0.2, h1: 0.38, step: 0.04, c: "#2a4a47", tiers: 6 },
    { base: 0.95, h0: 0.26, h1: 0.5, step: 0.055, c: "#183331", tiers: 6 },
  ];
  rows.forEach((r, i) => {
    pineRow(S, { base: r.base, h0: r.h0, h1: r.h1, step: r.step, color: r.c, seed: i + 1, tiers: r.tiers, wave: 0.03, slim: 0.36 });
    if (i < rows.length - 1) haze(S, (r.base - r.h1 * 0.55) * h, (r.base + 0.07) * h, "#e6eee9", 0, 0.78 - i * 0.07);
  });
  rays(S, 0.15 * w, -0.08 * h, { angle: 66, spread: 46, count: 7, length: 1.5 * h, color: "#fff8de", alpha: 0.13, width: [2, 7] });
  haze(S, 0.78 * h, h, "#c9d7d0", 0, 0.34);
  vignette(S, 0.26, "#0a1a1a");
  grain(S, 0.1);
});

photo("snowy-peaks", "Snowy peaks", "landscape", PORTRAIT, "snowy peaks mountains alpine snow glacier alpenglow winter summit range sunrise", (S) => {
  const { w, h } = S;
  fillV(S, 0, h * 0.86, [[0, "#1f3674"], [0.28, "#566fb0"], [0.52, "#b3a5ca"], [0.74, "#f0c4c4"], [1, "#fbdccb"]]);
  clouds(S, { y0: 0.04, y1: 0.5, fx: 1.4, fy: 8, cover: 0.3, soft: 0.3, lit: "#ffd5d0", shade: "#7a84bd", alpha: 0.5, seed: 8, light: [-0.6, 0.8] });
  glow(S, 0.1 * w, 0.62 * h, 0.8 * w, "#ffd2a8", 0.55, "screen", 1, 0.8);
  const far = crest(S, { base: 0.6, amp: 0.2, freq: 2.6, oct: 5, sharp: 0.9, seed: 3 });
  mountain(S, far, { light: 1, snow: "#f9ecef", snowShade: "#a9a9d0", rock: "#a79ab9", rockShade: "#7e7cab", snowDepth: 0.55, fog: "#f0c9cf", foot: 0.7, facet: 0.3, rim: 0.5, seed: 1 });
  const mid = crest(S, { base: 0.68, amp: 0.3, freq: 1.9, oct: 5, sharp: 0.95, seed: 6 });
  mountain(S, mid, { light: 1, snow: "#fff6f1", snowShade: "#97a0cc", rock: "#8f83a0", rockShade: "#666698", snowDepth: 0.5, fog: "#efc8d0", foot: 0.58, facet: 0.4, rim: 0.6, streaks: 0.12, seed: 2 });
  fogBand(S, 0.45 * h, 0.9 * h, "#f6d4d2", 0.5);
  const main = crest(S, { base: 0.8, amp: 0.48, freq: 1.25, oct: 5, sharp: 1, seed: 11 });
  mountain(S, main, { light: 1, snow: "#fffaf6", snowShade: "#7f8fc6", rock: "#756878", rockShade: "#454577", snowDepth: 0.5, fog: "#eec6cc", foot: 0.42, facet: 0.5, rim: 0.9, streaks: 0.18, seed: 4 });
  fogBand(S, 0.68 * h, 1.0 * h, "#f3cfd2", 0.55, 0.8);
  const hills = crest(S, { base: 1.0, amp: 0.12, freq: 2.4, oct: 4, seed: 5 });
  fillCrest(S, hills, "#2b3e5a", "#1c2c44");
  pines(S, hills, { count: 150, h0: 0.02, h1: 0.05, color: "#1d3048", density: (t) => clamp(0.3 + S.noise.fbm(t * 5, 3) * 1.2) });
  vignette(S, 0.22, "#101640");
  grain(S, 0.08);
});

photo("canyon-glow", "Canyon glow", "landscape", PORTRAIT, "canyon desert mesa red rock sunset glow arizona buttes strata warm", (S) => {
  const { ctx, w, h, noise } = S;
  const hz = 0.4;
  const fogC = "#f7b98f";
  ctx.fillStyle = fogC;
  ctx.fillRect(0, 0, w, h);
  fillV(S, 0, hz * h + 2, [[0, "#5b3a78"], [0.25, "#a4507f"], [0.5, "#e9776e"], [0.75, "#fba96f"], [1, fogC]]);
  glow(S, 0.62 * w, hz * h, 0.7 * w, "#ffd9a0", 0.7, "screen", 1.2, 0.8);
  sun(S, 0.62 * w, hz * h - 0.01 * h, 0.03 * S.U, "#ffb06a", "#fff3d2");
  clouds(S, { y0: 0.05, y1: 0.42, fx: 1.3, fy: 9, cover: 0.34, soft: 0.3, lit: "#ffc08a", shade: "#8a4a80", alpha: 0.5, seed: 9, light: [0.5, 1] });
  const bands = ["#b9482f", "#d36a3a", "#e08a4e", "#c0552f", "#9b3a2b", "#e6a362", "#a8432d", "#d97a45"].map(rgbOf);
  const mesas = (x: number, z: number, dist: number): number => {
    const t = noise.fbm(x * 0.0075 + 2, z * 0.0075, dist < 200 ? 4 : 3);
    const lv = 6;
    const s = t * lv;
    const fl = Math.floor(s);
    const fr = s - fl;
    const terr = (fl + smooth(0.72, 0.96, fr)) / lv;
    return 150 * terr * smooth(8, 90, z) + 3 * noise.n(x * 0.05, z * 0.05);
  };
  terrain(S, {
    height: mesas,
    albedo: (x, z, hg, ny, dist, o) => {
      const s = hg * 0.5 + noise.n(x * 0.04, z * 0.04) * 3;
      const i = Math.floor(s);
      const a = bands[((i % 8) + 8) % 8];
      const b = bands[(((i + 1) % 8) + 8) % 8];
      const m = smooth(0.8, 1, s - i);
      const streak = dist < 160 ? 0.9 + 0.2 * noise.n(x * 0.5, hg * 0.4) : 1;
      const dust = smooth(0.7, 0.95, ny) * 0.35;
      o[0] = lerp(lerp(a[0], b[0], m) * streak, 214, dust);
      o[1] = lerp(lerp(a[1], b[1], m) * streak, 150, dust);
      o[2] = lerp(lerp(a[2], b[2], m) * streak, 96, dust);
    },
    camY: 120,
    horizon: hz,
    fov: 0.6,
    zNear: 85,
    zFar: 1100,
    drop: 60,
    sun: unit(-0.55, 0.35, -0.6),
    sunRGB: [1.3, 0.9, 0.65],
    ambRGB: [0.34, 0.26, 0.4],
    fog: fogC,
    fogK: 0.0021,
    mist: (hg) => 0.35 * (1 - smooth(0, 60, hg)),
    res: 560,
  });
  glow(S, 0.62 * w, hz * h, 0.5 * w, "#ffc58a", 0.2, "screen", 1.4, 0.5);
  vignette(S, 0.25, "#2a0f2e");
  grain(S, 0.09);
});

photo("rolling-fields", "Rolling fields", "landscape", WIDE, "fields farmland countryside hills green yellow crops spring meadow agriculture patchwork", (S) => {
  const { ctx, w, h, noise } = S;
  const hz = 0.4;
  const fogC = "#d8e8ee";
  ctx.fillStyle = fogC;
  ctx.fillRect(0, 0, w, h);
  fillV(S, 0, hz * h + 2, [[0, "#6aa9dc"], [0.4, "#a2cdeb"], [0.78, "#d5eaf1"], [1, fogC]]);
  clouds(S, { y0: 0.0, y1: 0.42, fx: 2.0, fy: 5.5, cover: 0.45, soft: 0.28, lit: "#ffffff", shade: "#b0c8de", alpha: 0.9, seed: 6, light: [-0.6, -0.8] });
  const hills = (x: number, z: number): number => 44 * noise.fbm(x * 0.0032 + 1, z * 0.0032, 4) + 4 * noise.n(x * 0.02, z * 0.02) + z * 0.05;
  const hash2 = (i: number, j: number) => {
    let n = Math.imul(i, 374761393) ^ Math.imul(j, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  const crops = ["#86b24f", "#b2c95c", "#dcc95c", "#c9a950", "#6c9d4d", "#9cbf62", "#dfbf68", "#789c4b", "#b69bc0", "#e8bd34", "#8fb356", "#cdb878"].map(rgbOf);
  const hedge = rgbOf("#46703d");
  terrain(S, {
    height: (x, z) => hills(x, z),
    albedo: (x, z, hg, ny, dist, o) => {
      const wx = x + 45 * noise.n(x * 0.005, z * 0.005);
      const wz = z + 45 * noise.n(x * 0.005 + 5, z * 0.005 + 2);
      const cs = 78;
      const ci = Math.floor(wx / cs);
      const cj = Math.floor(wz / cs);
      const hv = hash2(ci, cj);
      const c = crops[Math.floor(hv * crops.length)];
      const ang = hash2(cj, ci) * Math.PI;
      const row = dist < 130 ? 0.5 + 0.5 * Math.sin((wx * Math.cos(ang) + wz * Math.sin(ang)) * 1.9) : 0.5;
      const rowAmt = 0.14 * (1 - smooth(40, 130, dist)) * (hv > 0.25 ? 1 : 0.2);
      const fx = wx / cs - ci;
      const fz = wz / cs - cj;
      const edge = Math.min(fx, 1 - fx, fz, 1 - fz) * cs;
      const hd = (1 - smooth(0.3, 1.1 + dist * 0.01, edge)) * 0.85;
      const k = (1 - rowAmt * row) * (0.92 + 0.16 * noise.n(wx * 0.03, wz * 0.03));
      o[0] = lerp(c[0] * k, hedge[0], hd);
      o[1] = lerp(c[1] * k, hedge[1], hd);
      o[2] = lerp(c[2] * k, hedge[2], hd);
    },
    camY: 62,
    horizon: hz,
    fov: 0.62,
    zNear: 46,
    zFar: 1300,
    drop: 40,
    sun: unit(-0.55, 0.55, -0.4),
    sunRGB: [1.15, 1.0, 0.82],
    ambRGB: [0.5, 0.58, 0.72],
    fog: fogC,
    fogK: 0.0026,
    res: 640,
  });
  vignette(S, 0.16, "#102030");
  grain(S, 0.07);
});

photo("tropical-beach", "Tropical beach", "landscape", LANDSCAPE, "beach tropical palm sea ocean sand turquoise summer holiday island paradise vacation", (S) => {
  const { w, h, noise } = S;
  const hz = 0.42 * h;
  fillV(S, 0, hz + 2, [[0, "#2c9be6"], [0.45, "#79c8f0"], [0.8, "#cdeff7"], [1, "#eefaf8"]]);
  clouds(S, { y0: 0.0, y1: 0.44, fx: 2.2, fy: 5.5, cover: 0.42, soft: 0.25, lit: "#ffffff", shade: "#bcd8ec", alpha: 0.95, seed: 12, light: [-0.6, -0.8] });
  const island = crest(S, { base: 0.435, amp: 0.045, freq: 2.2, oct: 4, sharp: 0.5, seed: 21, tilt: 0.05 });
  fillCrest(S, island, "#7fb9b6", "#bfe3e0", hz + 3, minOf(island));
  const sea = makeRamp([
    [0, "#0b5f93"],
    [0.18, "#0f7fb0"],
    [0.45, "#18b0c4"],
    [0.7, "#38d0c6"],
    [0.9, "#8fe8d2"],
    [1, "#d6f7e6"],
  ]);
  const shore = (u: number) => 0.68 + 0.06 * Math.sin(u * 5.2 + 1.1) + 0.06 * (noise.fbm(u * 2.6 + 3, 2.2, 3) - 0.5);
  const sandA = rgbOf("#f6e3bb");
  const sandB = rgbOf("#e7c58f");
  const wet = rgbOf("#bd9a69");
  field(
    S,
    680,
    (u, v, o) => {
      const vs = shore(u);
      if (v < vs) {
        const d = v / vs;
        sea(Math.pow(d, 0.9), o);
        const bands = 0.5 + 0.5 * Math.sin(Math.pow(d, 0.55) * 95 + noise.n(u * 6, d * 5) * 6);
        const k = 0.95 + 0.09 * bands * smooth(0.05, 0.4, d);
        const patch = smooth(0.52, 0.82, noise.fbm(u * 5 + 7, d * 4, 3)) * smooth(0.5, 0.92, d) * 0.4;
        o[0] = lerp(o[0] * k, 126, patch);
        o[1] = lerp(o[1] * k, 232, patch);
        o[2] = lerp(o[2] * k, 212, patch);
        const gl = smooth(0.7, 0.95, noise.n(u * 95, d * 170) * 1.6 + 0.5) * smooth(0.08, 0.4, d) * 0.4;
        const lace = smooth(0.3, 0.7, noise.fbm(u * 38, d * 70, 3));
        const foam = smooth(0.945, 0.99, d + 0.01 * noise.n(u * 25, 3)) * (0.5 + 0.5 * lace);
        const wh = Math.max(gl, foam);
        o[0] = lerp(o[0], 255, wh);
        o[1] = lerp(o[1], 255, wh);
        o[2] = lerp(o[2], 252, wh);
      } else {
        const t = (v - vs) / (1 - vs);
        const dry = lerp(0, 1, t);
        const g = 1 + noise.n(u * 150, v * 150) * 0.06;
        const wt = (1 - smooth(0, 0.14, t + 0.03 * noise.n(u * 30, t * 10))) * 0.85;
        o[0] = lerp(lerp(sandA[0], sandB[0], dry) * g, wet[0], wt);
        o[1] = lerp(lerp(sandA[1], sandB[1], dry) * g, wet[1], wt);
        o[2] = lerp(lerp(sandA[2], sandB[2], dry) * g, wet[2], wt);
      }
    },
    { x: 0, y: hz, w, h: h - hz },
  );
  // sun glare on the water and a soft horizon
  glow(S, 0.72 * w, hz + 0.1 * h, 0.5 * w, "#fffbe6", 0.28, "screen", 1, 0.35);
  haze(S, hz - 0.004 * h, hz + 0.07 * h, "#e8f8f6", 0.55, 0);
  // palms framing the corners
  const dark = "#0f4a33";
  frond(S, -0.02 * w, 0.06 * h, -0.2, 0.62 * w, { a: "#1f7a4a", b: "#0d4a30", tip: "#2a9560", droop: 0.9, width: 1.9, leaflets: 38 });
  frond(S, -0.02 * w, 0.06 * h, 0.35, 0.5 * w, { a: "#1a7044", b: dark, tip: "#2a9560", droop: 0.7, width: 1.9, leaflets: 36 });
  frond(S, 0.02 * w, -0.02 * h, 0.9, 0.42 * w, { a: "#238552", b: "#0f5236", droop: 0.5, width: 1.9, leaflets: 34 });
  frond(S, 1.03 * w, 0.02 * h, Math.PI + 0.25, 0.5 * w, { a: "#1f7a4a", b: "#0d4a30", tip: "#2a9560", droop: 0.9, width: 1.9, leaflets: 38 });
  frond(S, 1.03 * w, 0.02 * h, Math.PI - 0.55, 0.38 * w, { a: "#238552", b: "#0f5236", droop: 0.6, width: 1.9, leaflets: 32 });
  birds(S, [[0.55, 0.16, 0.012], [0.6, 0.12, 0.009], [0.5, 0.11, 0.007]], "rgba(255,255,255,.9)");
  vignette(S, 0.14, "#06303a");
  grain(S, 0.06);
});

photo("aurora-night", "Northern lights", "landscape", WIDE, "aurora borealis northern lights night sky stars snow mountains lake winter green polar", (S) => {
  const { ctx, w, h, noise } = S;
  const wy = 0.76 * h;
  const top = layer(S, w, wy, (L) => {
    const lh = L.h;
    fillV(L, 0, lh, [[0, "#02040e"], [0.5, "#061330"], [0.82, "#0b2b4b"], [1, "#154a5c"]]);
    field(
      L,
      300,
      (u, v, o) => {
        const d = v - (0.66 - 0.6 * u);
        const band = Math.exp(-(d * d) / 0.02) * (0.4 + 1.1 * (noise.fbm(u * 6 + 2, v * 6, 4) - 0.35));
        o[0] = 120;
        o[1] = 150;
        o[2] = 230;
        o[3] = clamp(band) * 0.5;
      },
      undefined,
      "screen",
    );
    stars(L, 1100, { y1: 0.9 });
    const cur = [
      { y: 0.66, amp: 0.1, f: 3.2, f2: 7, ph: 0.4, h: 0.42, gain: 1.0, rays: 62, off: 1 },
      { y: 0.52, amp: 0.12, f: 2.1, f2: 5, ph: 2.0, h: 0.32, gain: 0.7, rays: 46, off: 5 },
      { y: 0.4, amp: 0.1, f: 3.8, f2: 9, ph: 4.1, h: 0.24, gain: 0.45, rays: 70, off: 9 },
    ];
    const ramp = makeRamp([[0, "#a4ffd6"], [0.3, "#3ff0a0"], [0.62, "#1fc7c4"], [0.84, "#6a63f2"], [1, "#b34df0"]]);
    const tmp = new Float32Array(3);
    field(
      L,
      560,
      (u, v, o) => {
        let r = 0;
        let g = 0;
        let b = 0;
        for (const c of cur) {
          const base = c.y + c.amp * (noise.n(u * c.f + c.off, 0.3) * 1.5 + 0.4 * Math.sin(u * c.f2 + c.ph));
          const dv = base - v;
          if (dv < -0.03) continue;
          const ht = c.h * (0.65 + 0.7 * noise.fbm(u * 2.6 + c.off, 7.7, 2));
          const t = clamp(dv / ht);
          const ray = 0.4 + 0.75 * noise.fbm(u * c.rays + c.off, 4.1 + t * 0.7, 2);
          const I = c.gain * smooth(-0.03, 0.012, dv) * Math.pow(1 - t, 1.5) * ray;
          ramp(t, tmp);
          r += tmp[0] * I;
          g += tmp[1] * I;
          b += tmp[2] * I;
        }
        o[0] = r;
        o[1] = g;
        o[2] = b;
      },
      undefined,
      "lighter",
    );
    const far = crest(L, { base: 0.94, amp: 0.22, freq: 2.6, oct: 5, sharp: 0.9, seed: 5 });
    mountain(L, far, { light: 1, snow: "#35666f", snowShade: "#0e2b3a", rock: "#0c1f33", rockShade: "#07121f", snowDepth: 0.62, fog: "#0f3a4c", foot: 0.62, facet: 0.35, rim: 0.5, rimColor: "#8af0cf", seed: 2 });
    const near = crest(L, { base: 1.0, amp: 0.09, freq: 3.2, oct: 4, seed: 8 });
    fillCrest(L, near, "#04101c", "#020a12");
    pines(L, near, { count: 260, h0: 0.025, h1: 0.07, color: "#020a12", density: (t) => clamp(0.25 + noise.fbm(t * 6, 5) * 1.3) });
  });
  ctx.drawImage(top as CanvasImageSource, 0, 0);
  reflect(S, top, wy, { alpha: 0.82, ripple: 2.5, tint: "#03111c", tintAlpha: 0.45, seed: 4 });
  const shore = crest(S, { base: 1.03, amp: 0.05, freq: 2.2, oct: 3, seed: 12 });
  fillCrest(S, shore, "#030c14", "#020910");
  pines(S, shore, { count: 40, from: 0, to: 0.16, h0: 0.12, h1: 0.3, slim: 0.34, color: "#030c14", sink: 0.03 });
  pines(S, shore, { count: 36, from: 0.86, to: 1, h0: 0.1, h1: 0.26, slim: 0.34, color: "#030c14", sink: 0.03 });
  grain(S, 0.06, true);
});

photo("pastel-clouds", "Pastel clouds", "landscape", PORTRAIT, "clouds sky pastel dreamy soft pink blue peach cotton candy heaven airy wallpaper", (S) => {
  const { w, h } = S;
  fillV(S, 0, h, [[0, "#9ec5ff"], [0.35, "#c9c4ff"], [0.62, "#ffc8e0"], [0.85, "#ffe0c4"], [1, "#fff1d6"]]);
  glow(S, 0.5 * w, 0.98 * h, 0.8 * w, "#fff6dc", 0.6, "screen", 1.4, 0.7);
  clouds(S, { y0: 0.0, y1: 0.6, fx: 3.2, fy: 2.2, cover: 0.5, soft: 0.34, lit: "#ffffff", shade: "#bdb2ee", alpha: 0.9, seed: 3, light: [0, -1], oct: 5, res: 420 });
  clouds(S, { y0: 0.28, y1: 0.86, fx: 3.8, fy: 2.5, cover: 0.55, soft: 0.32, lit: "#fff6fb", shade: "#efaed2", alpha: 0.95, seed: 7, light: [0, -1], res: 420 });
  clouds(S, { y0: 0.52, y1: 1.04, fx: 4.4, fy: 2.7, cover: 0.6, soft: 0.3, lit: "#fffbf2", shade: "#ffc9ac", alpha: 1, seed: 11, light: [0, -1], res: 420 });
  grain(S, 0.08);
});

photo("lavender-fields", "Lavender fields", "landscape", WIDE, "lavender fields purple provence summer sunset rows countryside flowers violet perspective", (S) => {
  const { ctx, w, h, noise } = S;
  const hz = 0.43;
  const fogC = "#f6c3a4";
  ctx.fillStyle = fogC;
  ctx.fillRect(0, 0, w, h);
  fillV(S, 0, hz * h + 2, [[0, "#5b5dac"], [0.3, "#a077b6"], [0.58, "#ec98a8"], [0.82, "#fbbf8e"], [1, fogC]]);
  clouds(S, { y0: 0.04, y1: 0.46, fx: 1.5, fy: 9, cover: 0.4, soft: 0.3, lit: "#ffc7a0", shade: "#8a62a8", alpha: 0.6, seed: 14, light: [0.5, 1] });
  sun(S, 0.3 * w, hz * h - 0.02 * h, 0.03 * S.U, "#ffb077", "#fff2d0");
  const lav = ["#6a42ae", "#8f69cc", "#b194e2"].map(rgbOf);
  const leaf = rgbOf("#62803a");
  terrain(S, {
    height: (x, z) => 1.4 * noise.fbm(x * 0.02, z * 0.02, 2) + smooth(220, 520, z) * 38 * noise.fbm(x * 0.006 + 3, z * 0.006, 4),
    albedo: (x, z, hg, ny, dist, o) => {
      const ph = x / 3.4 + 0.12 * noise.n(x * 0.008, z * 0.008);
      const f = ph - Math.floor(ph);
      const bump = smooth(0.2, 0.7, 0.5 + 0.5 * Math.sin(f * TAU - 1.5708));
      const lod = 1 - smooth(70, 200, dist);
      const rowAmt = lerp(0.58, bump, lod);
      const tone = clamp(noise.fbm(x * 0.4 + 9, z * 0.07, 3) * 1.5 - 0.2) * 2;
      const li = Math.min(1, Math.floor(tone));
      const lt = tone - li;
      const speck = dist < 50 ? 1 + 0.12 * noise.n(x * 3, z * 3) * (1 - dist / 50) : 1;
      const lc: [number, number, number] = [lerp(lav[li][0], lav[li + 1][0], lt), lerp(lav[li][1], lav[li + 1][1], lt), lerp(lav[li][2], lav[li + 1][2], lt)];
      const far = smooth(240, 520, z);
      o[0] = lerp(lerp(leaf[0], lc[0] * speck, rowAmt), 120, far * 0.5);
      o[1] = lerp(lerp(leaf[1], lc[1] * speck, rowAmt), 100, far * 0.5);
      o[2] = lerp(lerp(leaf[2], lc[2] * speck, rowAmt), 150, far * 0.5);
    },
    camY: 3.4,
    horizon: hz,
    fov: 0.8,
    zNear: 5.5,
    zFar: 800,
    drop: 3.2,
    step: 0.009,
    sun: unit(-0.85, 0.22, 0.3),
    sunRGB: [1.25, 0.88, 0.7],
    ambRGB: [0.5, 0.42, 0.62],
    fog: fogC,
    fogK: 0.0036,
    res: 700,
  });
  glow(S, 0.3 * w, hz * h, 0.4 * w, "#ffd9a8", 0.25, "screen", 1.5, 0.4);
  vignette(S, 0.22, "#2a1038");
  grain(S, 0.08);
});

/* -------------------------------------------------------------------- city */

photo("city-night", "City at night", "city", WIDE, "city night skyline skyscrapers lights urban downtown dusk river buildings windows", (S) => {
  const { ctx, w, h } = S;
  const wy = 0.8 * h;
  const top = layer(S, w, wy, (L) => {
    const lh = L.h;
    fillV(L, 0, lh, [[0, "#0a0a2a"], [0.3, "#1c1548"], [0.6, "#4b2269"], [0.82, "#b13d79"], [1, "#ff8f6b"]]);
    stars(L, 220, { y1: 0.45, size: 0.9 });
    sun(L, 0.78 * L.w, 0.2 * lh, 0.02 * L.U, "#9db9ff", "#fff6e8", 0.55);
    skyline(L, { base: 1.0, h0: 0.14, h1: 0.38, w0: 0.02, w1: 0.05, color: "#7b3a86", top: "#a24b88", seed: 1, landmarks: 0.05 });
    haze(L, 0.55 * lh, lh, "#ff9a78", 0, 0.35);
    skyline(L, { base: 1.0, h0: 0.12, h1: 0.5, w0: 0.025, w1: 0.06, color: "#2c1c52", top: "#3d2468", lit: 0.2, pitch: 0.0042, landmarks: 0.07 });
    haze(L, 0.6 * lh, lh, "#b0457f", 0, 0.28);
    const glowA = skyline(L, { base: 1.0, h0: 0.1, h1: 0.62, w0: 0.03, w1: 0.075, color: "#120d2c", top: "#1b1240", lit: 0.34, pitch: 0.0072, landmarks: 0.09 });
    if (glowA) bloom(L, glowA, 14 * L.px, 0.9, "screen");
  });
  ctx.drawImage(top as CanvasImageSource, 0, 0);
  reflect(S, top, wy, { alpha: 0.78, ripple: 5, tint: "#0a0a22", tintAlpha: 0.5, strip: 2, seed: 3 });
  // long light trails on the water
  ctx.save();
  ctx.globalCompositeOperation = "screen";
  for (let i = 0; i < 120; i++) {
    const x = S.rng() * w;
    const y = wy + Math.pow(S.rng(), 1.4) * (h - wy);
    ctx.fillStyle = rgba(S.rng() < 0.7 ? "#ffd49a" : "#ff7aa8", S.rng.range(0.05, 0.2));
    ctx.fillRect(x, y, S.rng.range(0.01, 0.05) * w, 1.4 * S.px);
  }
  ctx.restore();
  vignette(S, 0.3, "#05040f");
  grain(S, 0.08, true);
});

photo("city-dawn", "City at dawn", "city", PORTRAIT, "city dawn sunrise skyline morning mist fog buildings pastel hazy golden urban", (S) => {
  const { w, h } = S;
  const hz = 0.7 * h;
  fillV(S, 0, h, [[0, "#6d86bd"], [0.25, "#a9b6dc"], [0.45, "#f1c6c3"], [0.62, "#ffd9b0"], [0.75, "#ffe9c8"], [1, "#f6d9c4"]]);
  clouds(S, { y0: 0.05, y1: 0.55, fx: 1.4, fy: 8, cover: 0.36, soft: 0.3, lit: "#fff0e0", shade: "#c3a9c9", alpha: 0.6, seed: 13, light: [0.3, 1] });
  sun(S, 0.58 * w, hz - 0.05 * h, 0.04 * S.U, "#ffc58a", "#fffaf0", 1.0);
  birds(S, [[0.3, 0.3, 0.012], [0.34, 0.27, 0.009], [0.27, 0.25, 0.008], [0.72, 0.36, 0.008]], "rgba(70,60,100,.55)");
  const layers: Array<[number, number, number, string, string, number, number]> = [
    [0.7, 0.06, 0.2, "#d8b2c0", "#e9c5c6", 0, 0.012],
    [0.76, 0.08, 0.3, "#b79bb7", "#cdaac0", 0.03, 0.017],
    [0.84, 0.1, 0.42, "#8a7aa2", "#a58bab", 0.08, 0.024],
    [0.97, 0.12, 0.58, "#554a78", "#6a5a85", 0.2, 0.04],
  ];
  layers.forEach(([base, h0, h1, c, tc, lit, pitch], i) => {
    const g = skyline(S, { base, h0, h1, w0: 0.03 + i * 0.012, w1: 0.07 + i * 0.02, color: c, top: tc, seed: i, lit, pitch, litColors: ["#ffd9a0", "#ffe9c4", "#ffc58a"], landmarks: 0.06 });
    if (g) bloom(S, g, 8 * S.px, 0.6, "screen");
    if (i < layers.length - 1) fogBand(S, (base - h1 * 0.5) * h, (base + 0.05) * h, "#ffe5cf", 0.55, 0.7);
  });
  haze(S, 0.9 * h, h, "#ffe3cc", 0, 0.5);
  vignette(S, 0.16, "#3a2a50");
  grain(S, 0.09);
});

photo("glass-towers", "Glass towers", "city", PORTRAIT, "glass towers skyscrapers modern architecture office blue sky looking up facade reflections business", (S) => {
  const { ctx, w, h, rng } = S;
  // sky between the towers
  fillV(S, 0, h, [[0, "#9fd3ff"], [0.5, "#d9efff"], [1, "#f4fbff"]]);
  clouds(S, { y0: 0.0, y1: 0.6, fx: 1.8, fy: 5, cover: 0.4, soft: 0.28, lit: "#ffffff", shade: "#c5dcef", alpha: 0.9, seed: 4, light: [-0.4, -0.8] });
  const vpx = 0.5 * w;
  const vpy = -0.8 * h;
  const tower = (xl: number, xr: number, sTop: number, rows: number, cols: number, tone: number, fogA: number) => {
    const L = (s: number): [number, number] => [lerp(xl * w, vpx, s), lerp(1.05 * h, vpy, s)];
    const R = (s: number): [number, number] => [lerp(xr * w, vpx, s), lerp(1.05 * h, vpy, s)];
    const sAt = (t: number) => (sTop * t * 2.4) / (1 + 1.4 * t);
    const pt = (u: number, t: number): [number, number] => {
      const s = sAt(t);
      const a = L(s);
      const b = R(s);
      return [lerp(a[0], b[0], u), lerp(a[1], b[1], u)];
    };
    // body
    ctx.beginPath();
    const corners = [pt(0, 0), pt(1, 0), pt(1, 1), pt(0, 1)];
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = mixc("#0f2a44", "#7aa6c8", tone * 0.5);
    ctx.fill();
    const off = rng() * 10;
    for (let r = 0; r < rows; r++) {
      const t0 = r / rows;
      const t1 = (r + 0.9) / rows;
      for (let c = 0; c < cols; c++) {
        const u0 = c / cols;
        const u1 = (c + 0.92) / cols;
        const q = S.noise.fbm(u0 * 2.4 + off, t0 * 3.2, 3);
        const flare = smooth(0.62, 0.86, q);
        const hot = rng() < 0.04 ? 1 : 0;
        const v = clamp(0.18 + q * 0.75 + (rng() - 0.5) * 0.1 + tone * 0.3);
        const col = hot ? mixc("#ffd7b0", "#fff2dc", rng()) : mixc(mixc("#0e3a63", "#2f86c4", v), "#e9f8ff", Math.pow(flare, 1.4) * 0.7);
        ctx.fillStyle = col;
        const p0 = pt(u0, t0);
        const p1 = pt(u1, t0);
        const p2 = pt(u1, t1);
        const p3 = pt(u0, t1);
        ctx.beginPath();
        ctx.moveTo(p0[0], p0[1]);
        ctx.lineTo(p1[0], p1[1]);
        ctx.lineTo(p2[0], p2[1]);
        ctx.lineTo(p3[0], p3[1]);
        ctx.closePath();
        ctx.fill();
      }
    }
    // sky glow on the facade and distance haze
    ctx.save();
    ctx.beginPath();
    corners.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.clip();
    fillV(S, 0, 1.05 * h, [[0, rgba("#eaf6ff", 0.55)], [0.5, rgba("#bfe0f7", 0.12)], [1, rgba("#0b2a44", 0.35)]]);
    ctx.fillStyle = rgba("#dff0fb", fogA);
    ctx.fillRect(0, 0, w, h * 1.1);
    ctx.restore();
  };
  tower(0.41, 0.6, 0.9, 40, 5, 0.9, 0.5);
  tower(0.12, 0.43, 0.94, 46, 8, 0.65, 0.26);
  tower(0.58, 0.9, 0.96, 46, 8, 0.55, 0.2);
  tower(-0.25, 0.2, 1.0, 50, 8, 0.2, 0.0);
  tower(0.78, 1.28, 1.0, 50, 8, 0.25, 0.0);
  glow(S, 0.5 * w, 0.02 * h, 0.6 * w, "#ffffff", 0.7);
  vignette(S, 0.22, "#06182c");
  grain(S, 0.07);
});

/* ---------------------------------------------------------------- abstract */

photo("mesh-sunrise", "Mesh sunrise", "abstract", SQUARE, "gradient mesh warm sunrise peach pink coral soft background pastel glow wallpaper", (S) => {
  meshGrid(
    S,
    [
      ["#ffd9e8", "#ffb3c7", "#ffc9b5", "#ffe8c2"],
      ["#ffc7d4", "#ff9aa8", "#ff9a7a", "#ffd08a"],
      ["#ffb0a0", "#ff7a8f", "#ff8f6b", "#ffb35c"],
      ["#ffd08a", "#ff9a5c", "#ff6f61", "#ffe08a"],
    ],
    { warp: 0.14, seed: 3 },
  );
  glow(S, 0.72 * S.w, 0.82 * S.h, 0.5 * S.w, "#fff0c4", 0.45);
  glow(S, 0.2 * S.w, 0.15 * S.h, 0.45 * S.w, "#ffffff", 0.3);
  grain(S, 0.1);
});

photo("mesh-ocean", "Mesh ocean", "abstract", WIDE, "gradient mesh ocean teal blue aqua water calm background wallpaper cool", (S) => {
  meshGrid(
    S,
    [
      ["#0b3c6d", "#1163a8", "#1a8fc4", "#3dc1d3"],
      ["#0a5a8e", "#1585b8", "#27b3c9", "#7fe0d4"],
      ["#0e7da6", "#1fb0c4", "#57d6c9", "#b6f0e2"],
      ["#1fa2bd", "#4fd1cc", "#a0ebdc", "#e6fbf2"],
    ],
    { warp: 0.16, seed: 7, freq: 1.3 },
  );
  glow(S, 0.85 * S.w, 0.9 * S.h, 0.5 * S.w, "#e6fff7", 0.35);
  grain(S, 0.1);
});

photo("mesh-candy", "Mesh candy", "abstract", PORTRAIT, "gradient mesh candy pink lilac baby blue mint pastel soft playful background wallpaper", (S) => {
  meshGrid(
    S,
    [
      ["#ffc2e2", "#ffa6d2", "#d9b8ff", "#b9d0ff"],
      ["#ffd1e8", "#ff9ccc", "#c6a8ff", "#a8dcff"],
      ["#ffe3c8", "#ffb8d6", "#bfe6ff", "#b5f0d8"],
      ["#fff3b8", "#ffd6e2", "#c8f0ff", "#d2f7c8"],
    ],
    { warp: 0.15, seed: 11 },
  );
  glow(S, 0.3 * S.w, 0.2 * S.h, 0.5 * S.w, "#ffffff", 0.35);
  grain(S, 0.09);
});

photo("mesh-forest", "Mesh forest", "abstract", SQUARE, "gradient mesh forest green sage olive nature deep calm background wallpaper earthy", (S) => {
  meshGrid(
    S,
    [
      ["#0e2a20", "#17402f", "#2a5a3d", "#3f7550"],
      ["#14382a", "#2d6246", "#5a8a5a", "#8fae6a"],
      ["#1c4a37", "#4b7d56", "#9bb571", "#d3d28a"],
      ["#2b5a40", "#6f9964", "#c0c680", "#f0e3a0"],
    ],
    { warp: 0.14, seed: 5, freq: 1.5 },
  );
  glow(S, 0.85 * S.w, 0.9 * S.h, 0.5 * S.w, "#fff3b0", 0.28);
  grain(S, 0.1);
});

photo("mesh-midnight", "Mesh midnight", "abstract", WIDE, "gradient mesh midnight navy indigo violet magenta dark night neon glow background wallpaper", (S) => {
  meshGrid(
    S,
    [
      ["#050818", "#0b1030", "#151a52", "#1c1b66"],
      ["#0a0f2c", "#1a1f6a", "#3a2a9a", "#7a2fb0"],
      ["#0e1440", "#2a2a9a", "#6a35c4", "#c23fa8"],
      ["#14194f", "#3b2fa6", "#8a44d6", "#ff6fb3"],
    ],
    { warp: 0.16, seed: 9, freq: 1.4 },
  );
  glow(S, 0.9 * S.w, 0.95 * S.h, 0.5 * S.w, "#ff8ad0", 0.3);
  grain(S, 0.08, true);
});

photo("liquid-purple", "Liquid purple", "abstract", PORTRAIT, "liquid purple silk satin waves fluid chrome violet magenta glossy flowing background wallpaper", (S) => {
  const asp = S.w / S.h;
  const ramp = makeRamp([[0, "#1d0a4d"], [0.3, "#5a1fc6"], [0.55, "#a24df2"], [0.78, "#ee7ef2"], [1, "#fff0ff"]]);
  const H = (X: number, Y: number) => {
    const a1 = 1.7 * X + 1.1 * Math.sin(0.9 * Y + 0.7);
    const a2 = 1.3 * Y - 1.2 * X + 0.7 * Math.sin(1.4 * X + 1.1);
    const a3 = 2.2 * (X + Y) * 0.5 + 0.5 * Math.sin(1.2 * Y);
    return 0.6 * Math.sin(a1) + 0.4 * Math.sin(a2) + 0.18 * Math.sin(a3);
  };
  const tmp = new Float32Array(3);
  field(S, 360, (u, v, o) => {
    const x = u * asp * 5.2;
    const y = v * 5.2;
    const X = x + 0.9 * (S.noise.fbm(x * 0.3, y * 0.3, 3) - 0.5) * 2;
    const Y = y + 0.9 * (S.noise.fbm(x * 0.3 + 7, y * 0.3 + 3, 3) - 0.5) * 2;
    const e = 0.02;
    const hc = H(X, Y);
    const gx = (H(X + e, Y) - hc) / e;
    const gy = (H(X, Y + e) - hc) / e;
    const inv = 1 / Math.sqrt(1 + gx * gx * 0.8 + gy * gy * 0.8);
    const nx = -gx * 0.9 * inv;
    const ny = -gy * 0.9 * inv;
    const nz = inv;
    const diff = clamp(nx * -0.45 + ny * -0.6 + nz * 0.66 + 0.2);
    const spec = Math.pow(clamp(nx * -0.3 + ny * -0.4 + nz * 0.86), 30);
    ramp(clamp(0.04 + 0.34 * (0.5 + 0.5 * hc) + 0.62 * diff * diff + 0.1), tmp);
    o[0] = tmp[0] + spec * 230;
    o[1] = tmp[1] + spec * 200;
    o[2] = tmp[2] + spec * 255;
  });
  vignette(S, 0.22, "#12043a");
  grain(S, 0.07);
});

photo("neon-grid", "Neon grid", "abstract", WIDE, "neon grid synthwave retro 80s outrun sunset purple magenta cyan futuristic perspective", (S) => {
  const { ctx, w, h } = S;
  const hz = 0.58 * h;
  fillV(S, 0, hz, [[0, "#07011a"], [0.45, "#26085a"], [0.78, "#7a1ea2"], [1, "#ff3d9a"]]);
  stars(S, 260, { y1: 0.5, size: 1 });
  // striped sun: the stripes are cut-outs showing the sky behind
  const sx = 0.5 * w;
  const sy = hz - 0.04 * h;
  const sr = 0.27 * h;
  const skyStops: Stops = [[0, "#07011a"], [0.45, "#26085a"], [0.78, "#7a1ea2"], [1, "#ff3d9a"]];
  ctx.save();
  ctx.beginPath();
  ctx.arc(sx, sy, sr, 0, TAU);
  ctx.clip();
  ctx.fillStyle = lin(ctx, 0, sy - sr, 0, sy + sr, [[0, "#ffe66d"], [0.5, "#ff8a4c"], [1, "#ff2e97"]]);
  ctx.fillRect(sx - sr, sy - sr, sr * 2, sr * 2);
  ctx.fillStyle = lin(ctx, 0, 0, 0, hz, skyStops);
  for (let i = 0; i < 9; i++) {
    const t = i / 9;
    const y = sy - sr * 0.1 + t * sr * 1.1;
    ctx.fillRect(sx - sr, y, sr * 2, (0.014 + 0.045 * t) * h);
  }
  ctx.restore();
  glow(S, sx, sy, sr * 3.2, "#ff4fb0", 0.4);
  // mountains with neon rims
  const mt = crest(S, { base: 0.585, amp: 0.1, freq: 3, oct: 4, sharp: 0.9, seed: 3 });
  crestPath(S, mt, hz + 2);
  ctx.fillStyle = lin(ctx, 0, minOf(mt), 0, hz, [[0, "#2b0b55"], [1, "#12042d"]]);
  ctx.fill();
  const lines = layer(S, w, h, (L) => {
    const c = L.ctx;
    c.lineCap = "round";
    // horizon line and mountain rim
    c.strokeStyle = "#ff5ad0";
    c.lineWidth = 2.2 * L.px;
    c.beginPath();
    for (let i = 0; i < mt.length; i++) (i ? c.lineTo : c.moveTo).call(c, (i / (mt.length - 1)) * w, mt[i]);
    c.stroke();
    c.strokeStyle = "#3df0ff";
    c.lineWidth = 2.6 * L.px;
    c.beginPath();
    c.moveTo(0, hz);
    c.lineTo(w, hz);
    c.stroke();
    // perspective grid
    c.strokeStyle = "#ff39c6";
    c.lineWidth = 2 * L.px;
    const n = 26;
    for (let i = -n; i <= n; i++) {
      const bx = w * 0.5 + i * w * 0.115;
      c.beginPath();
      c.moveTo(w * 0.5 + i * w * 0.004, hz);
      c.lineTo(bx, h);
      c.stroke();
    }
    for (let k = 1; k <= 14; k++) {
      const t = Math.pow(k / 14, 2.3);
      const y = hz + t * (h - hz);
      c.lineWidth = (1 + 2.2 * t) * L.px;
      c.beginPath();
      c.moveTo(0, y);
      c.lineTo(w, y);
      c.stroke();
    }
  });
  fillV(S, hz, h, [[0, "#1a0638"], [1, "#0b0220"]]);
  glow(S, w * 0.5, hz, w * 0.7, "#ff3d9a", 0.5, "screen", 1, 0.12);
  ctx.drawImage(lines as CanvasImageSource, 0, 0);
  bloom(S, lines, 10 * S.px, 1, "screen");
  bloom(S, lines, 3 * S.px, 0.7, "screen");
  haze(S, hz - 0.01 * h, hz + 0.3 * h, "#12042d", 0.0, 0.0);
  vignette(S, 0.3, "#05010f");
  grain(S, 0.07, true);
});

photo("soft-blobs", "Soft blobs", "abstract", SQUARE, "blobs organic shapes pastel soft shadows playful modern abstract background cream peach", (S) => {
  const { ctx, w, h, noise, rng } = S;
  fillV(S, 0, h, [[0, "#fdf6ee"], [1, "#fbe6dc"]]);
  const blob = (cx: number, cy: number, r: number, seed: number, wob: number) => {
    const K = 9;
    const pts: Array<[number, number]> = [];
    for (let i = 0; i < K; i++) {
      const a = (i / K) * TAU;
      const rr = r * (1 + wob * (noise.n(Math.cos(a) * 1.3 + seed, Math.sin(a) * 1.3 + seed * 0.7) * 1.8));
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
    ctx.beginPath();
    for (let i = 0; i < K; i++) {
      const p0 = pts[i];
      const p1 = pts[(i + 1) % K];
      const mx = (p0[0] + p1[0]) / 2;
      const my = (p0[1] + p1[1]) / 2;
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.quadraticCurveTo(p0[0], p0[1], mx, my);
    }
    ctx.quadraticCurveTo(pts[0][0], pts[0][1], (pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2);
    ctx.closePath();
  };
  const set: Array<[number, number, number, string, string]> = [
    [0.2, 0.26, 0.2, "#ffb8a8", "#ffd9c8"],
    [0.74, 0.18, 0.15, "#a8d8ff", "#dff0ff"],
    [0.5, 0.5, 0.22, "#c9b8ff", "#ece4ff"],
    [0.16, 0.74, 0.17, "#ffe08a", "#fff3c9"],
    [0.82, 0.62, 0.2, "#9fe3c8", "#d9f7ea"],
    [0.6, 0.88, 0.14, "#ff9ec0", "#ffd6e5"],
    [0.36, 0.1, 0.09, "#ffcfa0", "#ffe9d2"],
  ];
  for (const [fx, fy, fr, c0, c1] of set) {
    const cx = fx * w;
    const cy = fy * h;
    const r = fr * S.U;
    const sd = rng() * 10;
    ctx.save();
    ctx.shadowColor = "rgba(120,80,70,.2)";
    ctx.shadowBlur = 0.05 * S.U;
    ctx.shadowOffsetY = 0.02 * S.U;
    blob(cx, cy, r, sd, 0.16);
    ctx.fillStyle = lin(ctx, cx - r, cy - r, cx + r, cy + r, [[0, c1], [1, c0]]);
    ctx.fill();
    ctx.restore();
    ctx.save();
    blob(cx, cy, r, sd, 0.16);
    ctx.clip();
    ctx.fillStyle = rad(ctx, cx - r * 0.35, cy - r * 0.45, r * 1.1, [[0, "rgba(255,255,255,.55)"], [0.6, "rgba(255,255,255,.08)"], [1, "rgba(255,255,255,0)"]]);
    ctx.fillRect(cx - r * 1.5, cy - r * 1.5, r * 3, r * 3);
    ctx.restore();
  }
  grain(S, 0.08);
});

photo("paper-waves", "Paper waves", "abstract", WIDE, "paper cut layers waves papercut layered gradient teal coral depth modern abstract background", (S) => {
  const { ctx, h } = S;
  fillV(S, 0, h, [[0, "#ffe6d4"], [1, "#ffd0b8"]]);
  const cols = ["#ffb59c", "#ff8f8f", "#f2708f", "#c85a9c", "#8f4fa2", "#524a9e", "#2c3a7c"];
  cols.forEach((c, i) => {
    const ys = crest(S, { base: 0.24 + i * 0.11, amp: 0.05 + i * 0.006, freq: 1.1 + i * 0.12, oct: 2, seed: i * 3 + 1 });
    ctx.save();
    ctx.shadowColor = "rgba(50,20,70,.4)";
    ctx.shadowBlur = 0.03 * S.U;
    ctx.shadowOffsetY = -0.01 * S.U;
    fillCrest(S, ys, mixc(c, "#ffffff", 0.14), mixc(c, "#000000", 0.1));
    ctx.restore();
    rimLight(S, ys, "#ffffff", 0.22, 1, 1.4);
  });
  grain(S, 0.1);
});

photo("boho-arches", "Boho arches", "abstract", PORTRAIT, "boho arches terracotta sage cream earthy minimal modern rainbow arch aesthetic neutral background", (S) => {
  const { ctx, w, h } = S;
  fillV(S, 0, h, [[0, "#f7ead9"], [1, "#f0dcc4"]]);
  glow(S, 0.5 * w, 0.32 * h, 0.5 * w, "#fff6e6", 0.7);
  const cx = 0.5 * w;
  const by = 0.94 * h;
  const arch = (r: number, c0: string, c1: string) => {
    ctx.beginPath();
    ctx.moveTo(cx - r, by);
    ctx.lineTo(cx - r, by - r);
    ctx.arc(cx, by - r, r, Math.PI, 0);
    ctx.lineTo(cx + r, by);
    ctx.closePath();
    ctx.fillStyle = lin(ctx, 0, by - 2 * r, 0, by, [[0, c0], [1, c1]]);
    ctx.fill();
  };
  const cols: Array<[string, string]> = [["#c46a45", "#b85c3a"], ["#df9370", "#d3825d"], ["#eeb98f", "#e6ab80"], ["#f6d7b4", "#efcba5"], ["#a9b79b", "#97a888"]];
  cols.forEach(([a, b], i) => arch(0.36 * w - i * 0.058 * w, a, b));
  ctx.fillStyle = "#e9845a";
  ctx.beginPath();
  ctx.arc(cx, by - 0.17 * w, 0.075 * w, 0, TAU);
  ctx.fill();
  const side = (x: number, r: number, c: string) => {
    ctx.beginPath();
    ctx.moveTo(x - r, by);
    ctx.lineTo(x - r, by - r * 1.5);
    ctx.arc(x, by - r * 1.5, r, Math.PI, 0);
    ctx.lineTo(x + r, by);
    ctx.closePath();
    ctx.fillStyle = c;
    ctx.fill();
  };
  side(0.04 * w, 0.1 * w, "#b9654a");
  side(0.97 * w, 0.12 * w, "#a9b79b");
  ctx.fillStyle = "#dfc7a6";
  ctx.fillRect(0, by, w, h - by);
  fillV(S, by, h, [[0, "rgba(120,80,50,.25)"], [1, "rgba(120,80,50,0)"]]);
  grain(S, 0.14);
});

photo("grain-orb", "Grainy orb", "abstract", SQUARE, "grainy gradient orb glow noise texture sunset dark purple orange poster modern abstract background", (S) => {
  const { ctx, w, h } = S;
  fillV(S, 0, h, [[0, "#0d0826"], [1, "#1c1250"]]);
  glow(S, 0.5 * w, 0.58 * h, 0.62 * S.U, "#ff6a4a", 0.4);
  glow(S, 0.5 * w, 0.58 * h, 0.4 * S.U, "#ff3f8e", 0.35);
  const r = 0.32 * S.U;
  ctx.fillStyle = rad(ctx, 0.5 * w, 0.58 * h, r, [[0, "#fff0c4"], [0.22, "#ffb36b"], [0.5, "#ff5f8f"], [0.8, "rgba(122,60,255,.85)"], [1, "rgba(122,60,255,0)"]]);
  ctx.beginPath();
  ctx.arc(0.5 * w, 0.58 * h, r, 0, TAU);
  ctx.fill();
  grain(S, 0.55, true);
  grain(S, 0.3);
});

/* ----------------------------------------------------------------- textures */

photo("paper-cream", "Cream paper", "texture", SQUARE, "paper cream texture fibre handmade cotton warm background stationery", (S) => {
  const base = rgbOf("#f5eddd");
  const dark = rgbOf("#e3d5b8");
  field(S, 560, (u, v, o) => {
    const m = S.noise.fbm(u * 3.2, v * 3.2, 4);
    const tooth = S.noise.n(u * 340, v * 340) * 0.5 + S.noise.n(u * 120 + 9, v * 120) * 0.5;
    const t = clamp(0.5 + (m - 0.5) * 0.9 + tooth * 0.22 + (0.5 - u * 0.3 - v * 0.3) * 0.18);
    o[0] = lerp(dark[0], base[0], t);
    o[1] = lerp(dark[1], base[1], t);
    o[2] = lerp(dark[2], base[2], t);
  });
  fibres(S, 1100, "#8a6f44", "#ffffff");
  vignette(S, 0.1, "#8a6a3a");
  grain(S, 0.12);
});

photo("marble-white", "White marble", "texture", SQUARE, "marble white stone veins luxury elegant texture polished surface countertop grey gold", (S) => {
  const asp = S.w / S.h;
  const tmp = new Float32Array(3);
  const body = makeRamp([[0, "#dcdde0"], [0.5, "#f2f2f0"], [1, "#fcfcfb"]]);
  const veinA = rgbOf("#6f7782");
  const veinB = rgbOf("#b69b72");
  const n = S.noise;
  // soft cloudy body of the stone: smooth, so a tiny grid is enough
  field(S, 140, (u, v, o) => {
    body(0.55 + (n.fbm(u * asp * 1.8 + 20, v * 1.8, 4) - 0.5) * 1.2, tmp);
    o[0] = tmp[0];
    o[1] = tmp[1];
    o[2] = tmp[2];
  });
  // veins run along a rotated axis; only the thin lines are evaluated at higher resolution
  field(S, 560, (u, v, o) => {
    const x0 = u * asp * 1.6;
    const y0 = v * 1.6;
    const x = x0 * 0.87 + y0 * 0.5;
    const y = -x0 * 0.5 + y0 * 0.87;
    const wx = x + 0.2 * (n.fbm(x * 1.3 + 3, y * 1.3, 2) - 0.5) * 2;
    const wy = y + 0.35 * (n.fbm(x * 1.1, y * 1.1 + 8, 2) - 0.5) * 2;
    const a = 1 - Math.abs(2 * n.fbm(wx * 0.55 + 1, wy * 2.3, 4) - 1);
    const b = 1 - Math.abs(2 * n.fbm(wx * 1.3 + 40, wy * 3.6 + 5, 3) - 1);
    const a2 = a * a;
    const a4 = a2 * a2;
    const a8 = a4 * a4;
    const lineA = a8 * a8 * a8 * a8 * a2 * 0.9 + a4 * a2 * a * 0.1;
    const b8 = b * b * b * b * b * b * b * b;
    const lineB = b > 0.8 ? b8 * b8 * b8 * b8 * b8 * 0.6 : 0;
    // two veins in one pixel: the dark one wins, the golden one is blended underneath
    const kb = clamp(lineB);
    const ka = clamp(lineA);
    const al = ka + kb * (1 - ka);
    o[0] = (veinA[0] * ka + veinB[0] * kb * (1 - ka)) / (al || 1);
    o[1] = (veinA[1] * ka + veinB[1] * kb * (1 - ka)) / (al || 1);
    o[2] = (veinA[2] * ka + veinB[2] * kb * (1 - ka)) / (al || 1);
    o[3] = al;
  });
  fillV(S, 0, S.h, [[0, "rgba(255,255,255,.2)"], [0.5, "rgba(255,255,255,0)"], [1, "rgba(120,120,130,.1)"]]);
  grain(S, 0.05);
});

photo("concrete-gray", "Concrete", "texture", PORTRAIT, "concrete grey gray cement wall industrial brutalist texture raw architectural rough", (S) => {
  const { ctx, w, h, rng, noise } = S;
  const lo = rgbOf("#8d8c89");
  const hi = rgbOf("#b4b3af");
  field(S, 560, (u, v, o) => {
    const big = noise.fbm(u * 2.4, v * 2.4 * (h / w), 4);
    const mid = noise.fbm(u * 9 + 5, v * 9 * (h / w), 4);
    const grit = noise.n(u * 420, v * 420 * (h / w));
    const t = clamp(0.5 + (big - 0.5) * 0.9 + (mid - 0.5) * 0.5 + grit * 0.16);
    o[0] = lerp(lo[0], hi[0], t);
    o[1] = lerp(lo[1], hi[1], t);
    o[2] = lerp(lo[2], hi[2], t);
  });
  // air pockets
  for (let i = 0; i < 260; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const r = Math.pow(rng(), 2.4) * 0.0042 * S.U + 0.0009 * S.U;
    ctx.fillStyle = rgba("#2d2d2d", rng.range(0.25, 0.55));
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * rng.range(0.7, 1), 0, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = rgba("#ffffff", 0.18);
    ctx.lineWidth = Math.max(0.6, r * 0.3);
    ctx.beginPath();
    ctx.arc(x, y, r * 1.15, 0.2, 1.7);
    ctx.stroke();
  }
  // form-work panel seams and tie holes
  ctx.save();
  const seam = (x0: number, y0: number, x1: number, y1: number) => {
    ctx.strokeStyle = rgba("#2a2a2a", 0.34);
    ctx.lineWidth = 1.6 * S.px;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
    ctx.strokeStyle = rgba("#ffffff", 0.22);
    ctx.lineWidth = 1.2 * S.px;
    ctx.beginPath();
    ctx.moveTo(x0 + 1.6 * S.px, y0 + 1.6 * S.px);
    ctx.lineTo(x1 + 1.6 * S.px, y1 + 1.6 * S.px);
    ctx.stroke();
  };
  seam(0, h * 0.5, w, h * 0.5);
  seam(w * 0.5, 0, w * 0.5, h);
  const holes = [0.25, 0.75];
  for (const fx of holes) {
    for (const fy of [0.25, 0.75]) {
      const x = fx * w;
      const y = fy * h;
      const r = 0.011 * S.U;
      ctx.fillStyle = rad(ctx, x, y, r * 1.6, [[0, "rgba(30,30,30,.7)"], [0.55, "rgba(30,30,30,.55)"], [0.62, "rgba(255,255,255,.16)"], [1, "rgba(255,255,255,0)"]]);
      ctx.beginPath();
      ctx.arc(x, y, r * 1.6, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  fillV(S, 0, h, [[0, "rgba(255,255,255,.14)"], [1, "rgba(0,0,0,.14)"]]);
  vignette(S, 0.18, "#202020");
  grain(S, 0.13);
});

photo("linen-beige", "Linen", "texture", SQUARE, "linen fabric beige woven cloth textile natural weave burlap canvas background", (S) => {
  const res = 640;
  const threads = 210;
  const pxPerThread = Math.min(res, S.w) / threads;
  const lod = smooth(1.0, 2.8, pxPerThread);
  const base = rgbOf("#e5d8c0");
  const n = S.noise;
  const hash = (i: number) => {
    let x = Math.imul(i + 1, 0x9e3779b1) ^ 0x85ebca6b;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    return ((x ^ (x >>> 12)) >>> 0) / 4294967296;
  };
  field(S, res, (u, v, o) => {
    const gx = u * threads;
    const gy = v * threads;
    const ix = Math.floor(gx);
    const iy = Math.floor(gy);
    const fx = gx - ix;
    const fy = gy - iy;
    const top = (ix + iy) & 1;
    const cyl = (f: number) => Math.pow(Math.sin(Math.PI * f), 0.55);
    const vt = 0.92 + 0.12 * hash(ix) + 0.2 * n.n(u * 4 + ix * 0.1, v * 36);
    const ht = 0.92 + 0.12 * hash(iy + 977) + 0.2 * n.n(u * 36, v * 4 + iy * 0.1);
    // both thread directions read as continuous lines; the one on top wins the crossing
    const vb = cyl(fx);
    const hb = cyl(fy);
    const prof = top ? vb * 0.7 + hb * 0.3 : hb * 0.7 + vb * 0.3;
    const tone = top ? vt : ht;
    const shade = lerp(0.92, 0.7 + 0.34 * prof, lod);
    const mott = 0.96 + 0.06 * n.fbm(u * 3, v * 3, 3);
    const k = shade * lerp(1, tone, lod) * mott;
    o[0] = base[0] * k;
    o[1] = base[1] * k;
    o[2] = base[2] * k;
  });
  vignette(S, 0.1, "#6a5638");
  grain(S, 0.08);
});

photo("terrazzo", "Terrazzo", "texture", SQUARE, "terrazzo stone chips speckled floor tile mosaic pattern terracotta sage speckle surface", (S) => {
  const { ctx, w, h, rng, noise } = S;
  const bg = rgbOf("#eee8dd");
  field(S, 420, (u, v, o) => {
    const t = 0.97 + 0.05 * noise.fbm(u * 4, v * 4, 3) + 0.02 * noise.n(u * 200, v * 200);
    o[0] = bg[0] * t;
    o[1] = bg[1] * t;
    o[2] = bg[2] * t;
  });
  const palette = ["#c96f4a", "#8fa38a", "#2f3a4a", "#d9a441", "#e8b7a8", "#6f8ca3", "#f9f6ee", "#a35a43", "#c9c2b4"];
  const placed: Array<[number, number, number]> = [];
  const chip = (x: number, y: number, r: number, color: string) => {
    const k = rng.int(5, 8);
    const rot = rng() * TAU;
    ctx.beginPath();
    for (let i = 0; i < k; i++) {
      const a = rot + (i / k) * TAU + rng.range(-0.25, 0.25);
      const rr = r * rng.range(0.62, 1.05);
      const px = x + Math.cos(a) * rr * 1.1;
      const py = y + Math.sin(a) * rr * 0.85;
      if (i) ctx.lineTo(px, py);
      else ctx.moveTo(px, py);
    }
    ctx.closePath();
    ctx.fillStyle = lin(ctx, x - r, y - r, x + r, y + r, [[0, mixc(color, "#ffffff", 0.14)], [1, mixc(color, "#000000", 0.14)]]);
    ctx.fill();
    ctx.strokeStyle = rgba("#000000", 0.14);
    ctx.lineWidth = Math.max(0.5, 0.8 * S.px);
    ctx.stroke();
  };
  const sizes: Array<[number, number, number]> = [
    [0.052, 0.034, 26],
    [0.03, 0.019, 90],
    [0.017, 0.01, 260],
    [0.009, 0.005, 520],
  ];
  for (const [rMax, rMin, count] of sizes) {
    let tries = 0;
    let made = 0;
    while (made < count && tries < count * 40) {
      tries++;
      const r = rng.range(rMin, rMax) * S.U;
      const x = rng() * w;
      const y = rng() * h;
      let ok = true;
      for (const [px, py, pr] of placed) {
        const dx = px - x;
        const dy = py - y;
        if (dx * dx + dy * dy < (pr + r) * (pr + r) * 0.82) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;
      placed.push([x, y, r]);
      chip(x, y, r, palette[Math.floor(Math.pow(rng(), 1.25) * palette.length)]);
      made++;
    }
  }
  // fine speckle
  for (let i = 0; i < 2400; i++) {
    ctx.fillStyle = rgba(rng() < 0.5 ? "#4b4338" : "#ffffff", rng.range(0.2, 0.6));
    const r = rng.range(0.4, 1.3) * Math.max(0.6, S.px);
    ctx.fillRect(rng() * w, rng() * h, r, r);
  }
  grain(S, 0.08);
});

photo("watercolor-wash", "Watercolor wash", "texture", PORTRAIT, "watercolor wash paint paper artistic texture blue pink soft brush painted pastel abstract background", (S) => {
  const { ctx, w, h, noise } = S;
  field(S, 480, (u, v, o) => {
    const t = 0.955 + 0.04 * noise.fbm(u * 5, v * 5, 3) + 0.03 * noise.n(u * 300, v * 300);
    o[0] = 251 * t;
    o[1] = 247 * t;
    o[2] = 239 * t;
  });
  // The pigment is painted at half size (it is soft anyway) and multiplied over the paper once.
  const paint = layer(S, Math.round(w / 2), Math.round(h / 2), (L) => {
    const { rng } = L;
    L.ctx.fillStyle = "#ffffff";
    L.ctx.fillRect(0, 0, L.w, L.h);
    // soft-edged pigment pools: a wobbly disc with a darker rim where the paint dried
    const wash = (fx: number, fy: number, fr: number, color: string, seed: number, density: number) => {
      const c = rgbOf(color);
      const r = fr * L.U * 1.5;
      field(
        L,
        240,
        (u, v, o) => {
          const px = (u - 0.5) * 3;
          const py = (v - 0.5) * 3;
          const a = Math.atan2(py, px);
          const warp = noise.fbm(px * 1.3 + seed, py * 1.3 + seed * 0.7, 3) - 0.5;
          const d = (Math.hypot(px, py) * (1 + 0.6 * warp)) / (1 + 0.22 * noise.n(Math.cos(a) * 2 + seed, Math.sin(a) * 2));
          if (d > 1.2) {
            o[3] = 0;
            return;
          }
          const body = 1 - smooth(0.74, 1.0, d);
          const rim = smooth(0.84, 0.97, d) * (1 - smooth(0.97, 1.08, d));
          const wet = noise.fbm(px * 2.2 + seed + 7, py * 2.2, 3);
          o[0] = c[0];
          o[1] = c[1];
          o[2] = c[2];
          o[3] = clamp(body * density * (0.45 + 0.8 * wet) + rim * 0.24);
        },
        { x: fx * L.w - r, y: fy * L.h - r, w: 2 * r, h: 2 * r },
        "multiply",
      );
    };
    wash(0.3, 0.26, 0.3, "#3f9fc6", 1, 0.55);
    wash(0.72, 0.4, 0.26, "#e65f86", 2, 0.5);
    wash(0.4, 0.72, 0.33, "#f2b04a", 3, 0.5);
    wash(0.78, 0.8, 0.2, "#7f68c8", 4, 0.55);
    wash(0.16, 0.6, 0.16, "#4fb59f", 5, 0.5);
    // flicked droplets
    L.ctx.globalCompositeOperation = "multiply";
    for (let i = 0; i < 46; i++) {
      L.ctx.fillStyle = rgba(rng.pick(["#3f9fc6", "#e65f86", "#f2b04a", "#7f68c8"]), rng.range(0.25, 0.6));
      L.ctx.beginPath();
      L.ctx.arc(rng() * L.w, rng() * L.h, rng.range(0.0015, 0.006) * L.U, 0, TAU);
      L.ctx.fill();
    }
  });
  ctx.save();
  ctx.globalCompositeOperation = "multiply";
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  ctx.drawImage(paint as CanvasImageSource, 0, 0, w, h);
  ctx.restore();
  // pigment granulation
  field(
    S,
    440,
    (u, v, o) => {
      const g = 0.5 + noise.n(u * 260, v * 260) * 0.7 + (noise.fbm(u * 28, v * 28, 3) - 0.5) * 0.5;
      o[0] = 40;
      o[1] = 30;
      o[2] = 60;
      o[3] = clamp(0.2 * (1 - g));
    },
    undefined,
    "multiply",
  );
  grain(S, 0.05);
});

photo("kraft-paper", "Kraft paper", "texture", SQUARE, "kraft paper brown cardboard recycled packaging craft texture natural rustic background", (S) => {
  const light = rgbOf("#c79a68");
  const dark = rgbOf("#a97c4c");
  field(S, 560, (u, v, o) => {
    const m = S.noise.fbm(u * 3, v * 3, 4);
    const tooth = S.noise.n(u * 320, v * 320) * 0.5 + S.noise.n(u * 110 + 4, v * 110) * 0.5;
    const t = clamp(0.5 + (m - 0.5) * 1.1 + tooth * 0.2);
    o[0] = lerp(dark[0], light[0], t);
    o[1] = lerp(dark[1], light[1], t);
    o[2] = lerp(dark[2], light[2], t);
  });
  fibres(S, 1700, "#4a2f14", "#f0d8ad");
  fillV(S, 0, S.h, [[0, "rgba(255,240,210,.14)"], [1, "rgba(60,30,10,.14)"]]);
  vignette(S, 0.14, "#3a210c");
  grain(S, 0.14);
});

photo("wood-oak", "Oak planks", "texture", SQUARE, "wood oak planks timber floor grain natural brown rustic table surface texture background", (S) => {
  const planks = 5;
  const dark = rgbOf("#8b5a31");
  const light = rgbOf("#cf9a5f");
  const n = S.noise;
  const hash = (i: number) => {
    let x = Math.imul(i + 3, 0x9e3779b1) ^ 0x85ebca6b;
    x = Math.imul(x ^ (x >>> 15), 0x2c1b3c6d);
    return ((x ^ (x >>> 12)) >>> 0) / 4294967296;
  };
  field(S, 620, (u, v, o) => {
    const gp = u * planks;
    const i = Math.floor(gp);
    const fu = gp - i;
    const hv = hash(i);
    const warp = 3.2 * n.fbm(fu * 1.6 + i * 5, v * 1.1 + i * 2, 3);
    const rings = 0.5 + 0.5 * Math.sin((fu * 7 + warp + hv * 9) * TAU);
    const fine = n.n(fu * 160 + i * 17, v * 9 + hv * 20);
    const t = clamp(0.2 + 0.5 * rings + 0.25 * n.fbm(fu * 2 + i, v * 3, 3) + 0.12 * fine + (hv - 0.5) * 0.2);
    const seam = smooth(0.0, 0.016, Math.min(fu, 1 - fu));
    const k = lerp(0.42, 1, seam);
    o[0] = lerp(dark[0], light[0], t) * k;
    o[1] = lerp(dark[1], light[1], t) * k;
    o[2] = lerp(dark[2], light[2], t) * k;
  });
  fillV(S, 0, S.h, [[0, "rgba(255,230,190,.12)"], [1, "rgba(40,20,5,.14)"]]);
  vignette(S, 0.16, "#2a1608");
  grain(S, 0.1);
});

/* ------------------------------------------------------------------- nature */

photo("palm-leaves", "Palm leaves", "nature", PORTRAIT, "palm leaves tropical jungle green foliage fronds botanical summer plants backlit exotic", (S) => {
  const { w, h } = S;
  fillV(S, 0, h, [[0, "#06362c"], [0.45, "#0b5a42"], [1, "#04221b"]]);
  glow(S, 0.82 * w, 0.08 * h, 0.8 * w, "#f5ffb8", 0.6);
  rays(S, 0.9 * w, -0.05 * h, { angle: 118, spread: 40, count: 8, length: 1.3 * h, color: "#f1ffc4", alpha: 0.16, width: [2, 6] });
  // dark fronds in the distance first, brighter ones towards the camera
  const layers: Array<{ x: number; y: number; a: number; l: number; c: [string, string, string]; droop: number; width: number }> = [
    { x: 0.5, y: 1.1, a: -1.45, l: 0.95, c: ["#0e6446", "#05352a", "#12805a"], droop: 0.9, width: 2.4 },
    { x: 0.9, y: 1.08, a: -2.0, l: 0.85, c: ["#0e6446", "#05352a", "#12805a"], droop: 0.9, width: 2.4 },
    { x: 0.1, y: 1.08, a: -1.05, l: 0.9, c: ["#118056", "#06402f", "#18a070"], droop: 0.95, width: 2.4 },
    { x: -0.05, y: 0.62, a: -0.62, l: 0.9, c: ["#1c9a63", "#0a5a3c", "#35c183"], droop: 1.05, width: 2.5 },
    { x: 1.05, y: 0.55, a: Math.PI + 0.55, l: 0.88, c: ["#1c9a63", "#0a5a3c", "#35c183"], droop: 1.05, width: 2.5 },
    { x: -0.05, y: 0.3, a: -0.15, l: 0.8, c: ["#2fb67a", "#0f7448", "#7ae0a6"], droop: 1.15, width: 2.6 },
    { x: 1.05, y: 0.18, a: Math.PI + 0.12, l: 0.78, c: ["#2fb67a", "#0f7448", "#7ae0a6"], droop: 1.15, width: 2.6 },
  ];
  for (const f of layers) frond(S, f.x * w, f.y * h, f.a, f.l * Math.max(w, h) * 0.95, { a: f.c[0], b: f.c[1], tip: f.c[2], droop: f.droop, leaf: 0.2, leaflets: 46, width: f.width * 0.8 });
  for (let i = 0; i < 26; i++) glow(S, S.rng() * w, S.rng() * h * 0.7, S.rng.range(0.01, 0.04) * S.U, "#e9ffbf", S.rng.range(0.1, 0.3));
  vignette(S, 0.38, "#021410");
  grain(S, 0.08, true);
});

photo("monstera", "Monstera", "nature", SQUARE, "monstera leaf plant tropical botanical green houseplant swiss cheese foliage cream background", (S) => {
  const { w, h } = S;
  fillV(S, 0, h, [[0, "#f6e9dc"], [1, "#ecd3c0"]]);
  glow(S, 0.2 * w, 0.1 * h, 0.7 * w, "#ffffff", 0.5);
  const leaf = (fx: number, fy: number, size: number, rot: number, light: string, dark: string, seed: number) => monsteraLeaf(S, fx * w, fy * h, size * S.U, rot, { light, dark, seed });
  leaf(0.1, 1.05, 0.62, -0.6, "#3f8f58", "#0f4530", 4);
  leaf(0.9, 1.05, 0.6, 0.62, "#3f8f58", "#0f4530", 5);
  leaf(0.3, 0.88, 0.7, -0.22, "#5cae6c", "#17583a", 2);
  leaf(0.7, 0.92, 0.66, 0.24, "#6fbd72", "#18603e", 3);
  leaf(0.5, 1.04, 0.58, 0.02, "#78c47a", "#1b6642", 1);
  grain(S, 0.07);
});

photo("wildflowers", "Wildflowers", "nature", PORTRAIT, "wildflowers meadow daisies flowers spring summer field floral soft focus petals garden", (S) => {
  const { ctx, w, h, rng } = S;
  fillV(S, 0, h, [[0, "#cde5f1"], [0.34, "#e9f1d8"], [0.56, "#bfd88c"], [1, "#4f8636"]]);
  glow(S, 0.2 * w, 0.05 * h, 0.8 * w, "#fffbe0", 0.7);
  // soft meadow bokeh
  for (let i = 0; i < 220; i++) {
    const y = h * (0.28 + 0.72 * Math.pow(rng(), 0.9));
    const r = rng.range(0.008, 0.045) * S.U * (0.6 + (y / h) * 0.8);
    const c = rng.pick(["#a9cf6a", "#f4e06b", "#ffffff", "#7fb04a", "#f7a8c4", "#d3e89a"]);
    glow(S, rng() * w, y, r, c, rng.range(0.18, 0.4), "screen");
  }
  const daisy = (x: number, y: number, r: number, petal: string, centre: string, n: number, lean: number) => {
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(lean);
    ctx.shadowColor = "rgba(30,60,20,.25)";
    ctx.shadowBlur = r * 0.35;
    ctx.shadowOffsetY = r * 0.15;
    for (let k = 0; k < n; k++) {
      const a = (k / n) * TAU + rng.range(-0.08, 0.08);
      ctx.save();
      ctx.rotate(a);
      ctx.translate(r * 0.55, 0);
      ctx.beginPath();
      ctx.ellipse(0, 0, r * 0.46, r * 0.14 * rng.range(0.9, 1.15), 0, 0, TAU);
      ctx.fillStyle = lin(ctx, -r * 0.4, 0, r * 0.45, 0, [[0, mixc(petal, "#e8e0a0", 0.35)], [0.35, petal], [1, mixc(petal, "#ffffff", 0.5)]]);
      ctx.fill();
      ctx.restore();
    }
    ctx.shadowColor = "transparent";
    ctx.fillStyle = rad(ctx, -r * 0.05, -r * 0.05, r * 0.34, [[0, mixc(centre, "#fff4a8", 0.4)], [0.6, centre], [1, mixc(centre, "#b8620a", 0.55)]]);
    ctx.beginPath();
    ctx.arc(0, 0, r * 0.3, 0, TAU);
    ctx.fill();
    for (let i = 0; i < 26; i++) {
      const a = rng() * TAU;
      const d = Math.sqrt(rng()) * r * 0.27;
      ctx.fillStyle = rgba("#7a4a08", rng.range(0.15, 0.4));
      ctx.fillRect(Math.cos(a) * d, Math.sin(a) * d, Math.max(0.6, r * 0.02), Math.max(0.6, r * 0.02));
    }
    ctx.restore();
  };
  const stem = (x0: number, y0: number, x1: number, y1: number, wd: number) => {
    const cx = lerp(x0, x1, 0.2) + (x1 - x0) * 0.1 + rng.range(-0.05, 0.05) * w;
    ctx.strokeStyle = lin(ctx, 0, y1, 0, y0, [[0, "#6aa046"], [1, "#2f5f27"]]);
    ctx.lineWidth = wd;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(cx, lerp(y0, y1, 0.55), x1, y1);
    ctx.stroke();
    for (let i = 0; i < 2; i++) {
      const t = 0.3 + i * 0.28;
      const lx = lerp(x0, x1, t);
      const ly = lerp(y0, y1, t);
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(i % 2 ? -0.9 : 0.9 + Math.PI);
      ctx.fillStyle = "#4a8a38";
      ctx.beginPath();
      ctx.ellipse(wd * 5, 0, wd * 6.5, wd * 1.6, 0, 0, TAU);
      ctx.fill();
      ctx.restore();
    }
  };
  type F = [number, number, number, string, string, number];
  const back: F[] = [];
  for (let i = 0; i < 16; i++) back.push([rng.range(0.03, 0.97), rng.range(0.42, 0.58), rng.range(0.025, 0.04), rng.pick(["#ffffff", "#ffe6f0", "#fff3b0"]), "#f2c230", rng.int(10, 14)]);
  for (const [fx, fy, fr, pc, cc, n] of back) {
    ctx.globalAlpha = 0.6;
    daisy(fx * w, fy * h, fr * S.U, pc, cc, n, rng.range(-0.4, 0.4));
    ctx.globalAlpha = 1;
  }
  const fore: F[] = [
    [0.24, 0.5, 0.085, "#ffffff", "#f5c518", 15],
    [0.66, 0.4, 0.07, "#ffd6e6", "#f2b01a", 12],
    [0.46, 0.66, 0.1, "#ffffff", "#f1b813", 16],
    [0.82, 0.62, 0.08, "#fff6c2", "#e8a312", 13],
    [0.12, 0.74, 0.075, "#ffc2da", "#f4b81a", 12],
    [0.7, 0.82, 0.11, "#ffffff", "#f5c518", 17],
  ];
  for (const [fx, fy, fr, pc, cc, n] of fore) {
    stem(fx * w + rng.range(-0.05, 0.05) * w, h * 1.05, fx * w, fy * h, 0.007 * S.U);
    daisy(fx * w, fy * h, fr * S.U, pc, cc, n, rng.range(-0.3, 0.3));
  }
  // out-of-focus foreground petals
  for (let i = 0; i < 8; i++) glow(S, rng() * w, h * rng.range(0.82, 1.02), rng.range(0.05, 0.12) * S.U, rng.pick(["#ffffff", "#f6b4cc", "#fff1a0"]), 0.35, "screen");
  vignette(S, 0.22, "#173a14");
  grain(S, 0.08);
});

photo("bokeh-gold", "Golden bokeh", "nature", WIDE, "bokeh gold lights glitter festive champagne warm blur sparkle celebration party luxury", (S) => {
  const { ctx, w, h, rng } = S;
  fillV(S, 0, h, [[0, "#1a0f08"], [0.55, "#2c1a0b"], [1, "#46290f"]]);
  glow(S, 0.78 * w, 0.18 * h, 0.7 * w, "#ffb347", 0.4);
  glow(S, 0.2 * w, 0.9 * h, 0.6 * w, "#ff8a3c", 0.25);
  const cols = ["#ffe2a3", "#ffbf47", "#ff9a3c", "#fff3d1", "#ffd27a"];
  const disc = (x: number, y: number, r: number, c: string, a: number) => {
    ctx.fillStyle = rad(ctx, x, y, r, [[0, rgba(c, a * 0.55)], [0.7, rgba(c, a * 0.7)], [0.92, rgba(c, a)], [1, rgba(c, 0)]]);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  };
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  const tiers: Array<[number, number, number, number]> = [
    [70, 0.008, 0.024, 0.22],
    [46, 0.024, 0.06, 0.26],
    [16, 0.07, 0.16, 0.2],
  ];
  for (const [n, r0, r1, a] of tiers) {
    for (let i = 0; i < n; i++) {
      const x = rng() * w;
      const y = rng() * h * (0.35 + 0.65 * rng());
      disc(x, y, rng.range(r0, r1) * S.U, rng.pick(cols), a * rng.range(0.6, 1.1));
    }
  }
  ctx.restore();
  for (let i = 0; i < 90; i++) glow(S, rng() * w, rng() * h, rng.range(0.002, 0.006) * S.U, "#fff6d8", rng.range(0.5, 1), "lighter");
  vignette(S, 0.4, "#0a0503");
  grain(S, 0.07, true);
});

photo("water-ripples", "Water ripples", "nature", SQUARE, "water ripples pool caustics turquoise swimming summer waves surface light reflections aqua", (S) => {
  const asp = S.w / S.h;
  const n = S.noise;
  const deep = rgbOf("#0a7fa3");
  const light = rgbOf("#5fe0e0");
  const drops: Array<[number, number, number]> = [
    [0.3, 0.35, 1],
    [0.72, 0.6, 0.8],
    [0.45, 0.82, 0.6],
  ];
  field(S, 420, (u, v, o) => {
    let x = u * asp;
    let y = v;
    // expanding rings bend the light a little
    let rx = 0;
    let ry = 0;
    for (const [dx, dy, amp] of drops) {
      const ex = x - dx;
      const ey = y - dy;
      const d = Math.hypot(ex, ey) + 1e-4;
      if (d > 1.5) continue;
      const ring = Math.sin(d * 46 - 1.2) * Math.exp(-d * 3.2) * amp;
      rx += (ex / d) * ring * 0.018;
      ry += (ey / d) * ring * 0.018;
    }
    x += rx;
    y += ry;
    const X = x + 0.28 * n.n(x * 1.6, y * 1.6);
    const Y = y + 0.28 * n.n(x * 1.6 + 9, y * 1.6 + 4);
    const t1 = clamp(1 - Math.abs(n.n(X * 4.2, Y * 4.2)) * 1.55);
    const t2 = clamp(1 - Math.abs(n.n(X * 7.6 + 3, Y * 7.6 + 7)) * 1.55);
    const t3 = clamp(1 - Math.abs(n.n(X * 13 + 11, Y * 13 + 1)) * 1.55);
    const q1 = t1 * t1;
    const q2 = t2 * t2;
    const q3 = t3 * t3;
    const c1 = q1 * q1 * q1 * t1;
    const c2 = q2 * q2 * q2 * q2;
    const c3 = q3 * q3 * q3 * q3 * t3;
    const caustic = clamp(c1 * 0.75 + c2 * 0.5 + c3 * 0.3);
    const depth = 0.5 + 0.5 * n.fbm(x * 1.4, y * 1.4, 3) - 0.5 * (x * 0.2 + y * 0.35);
    const base = clamp(depth);
    o[0] = lerp(deep[0], light[0], base * 0.55) + caustic * 150;
    o[1] = lerp(deep[1], light[1], base * 0.55) + caustic * 130;
    o[2] = lerp(deep[2], light[2], base * 0.55) + caustic * 90;
  });
  vignette(S, 0.2, "#03323f");
  grain(S, 0.05);
});

photo("cherry-blossom", "Cherry blossom", "nature", PORTRAIT, "cherry blossom sakura spring pink flowers branch japan petals tree soft bokeh floral", (S) => {
  const { ctx, w, h, rng } = S;
  fillV(S, 0, h, [[0, "#cfe3fb"], [0.5, "#f7e3f0"], [1, "#fff1e4"]]);
  glow(S, 0.85 * w, 0.08 * h, 0.7 * w, "#ffffff", 0.7);
  for (let i = 0; i < 60; i++) glow(S, rng() * w, rng() * h, rng.range(0.012, 0.05) * S.U, rng.pick(["#ffd0e2", "#ffffff", "#ffb7d0"]), rng.range(0.2, 0.45), "screen");
  const blossoms: Array<[number, number, number, number, number]> = [];
  const branch = (x: number, y: number, ang: number, len: number, wd: number, depth: number) => {
    const segs = 16;
    let px = x;
    let py = y;
    let a = ang;
    ctx.strokeStyle = depth ? "#5a3a30" : "#43291f";
    ctx.lineCap = "round";
    for (let i = 0; i < segs; i++) {
      const t = i / segs;
      ctx.lineWidth = Math.max(1, wd * (1 - t * 0.8));
      a += rng.range(-0.16, 0.16);
      const nx = px + (Math.cos(a) * len) / segs;
      const ny = py + (Math.sin(a) * len) / segs;
      ctx.beginPath();
      ctx.moveTo(px, py);
      ctx.lineTo(nx, ny);
      ctx.stroke();
      if (depth < 3 && i > 3 && rng() < 0.2) branch(nx, ny, a + (rng() < 0.5 ? 0.6 : -0.6) + rng.range(-0.3, 0.3), len * 0.5, wd * 0.5, depth + 1);
      if (depth >= 1 && rng() < 0.55) blossoms.push([nx + rng.range(-8, 8) * S.px, ny + rng.range(-8, 8) * S.px, rng.range(0.022, 0.04) * S.U, rng() * TAU, rng.range(0.85, 1)]);
      px = nx;
      py = ny;
    }
    if (depth >= 1) for (let k = 0; k < 3; k++) blossoms.push([px + rng.range(-14, 14) * S.px, py + rng.range(-14, 14) * S.px, rng.range(0.025, 0.045) * S.U, rng() * TAU, 1]);
  };
  branch(-0.05 * w, 0.28 * h, 0.1, 0.95 * w, 0.034 * S.U, 0);
  branch(1.05 * w, 0.06 * h, Math.PI - 0.5, 0.6 * w, 0.02 * S.U, 0);
  branch(-0.05 * w, 0.88 * h, -0.28, 0.5 * w, 0.016 * S.U, 0);
  // a few blossom sprites, stamped many times with different size / rotation
  const drawBlossom = (c: Ctx, r: number) => {
    c.beginPath();
    for (let k = 0; k < 5; k++) {
      c.moveTo(0, 0);
      c.bezierCurveTo(-r * 0.62, -r * 0.18, -r * 0.55, -r * 0.98, -r * 0.13, -r * 0.96);
      c.lineTo(0, -r * 0.8);
      c.lineTo(r * 0.13, -r * 0.96);
      c.bezierCurveTo(r * 0.55, -r * 0.98, r * 0.62, -r * 0.18, 0, 0);
      c.closePath();
      c.rotate(TAU / 5);
    }
    c.fillStyle = rad(c, 0, 0, r, [[0, "#ff8fb3"], [0.45, "#ffc2d6"], [1, "#fff0f5"]]);
    c.fill();
    c.strokeStyle = rgba("#e86a98", 0.25);
    c.lineWidth = Math.max(0.5, r * 0.015);
    c.stroke();
    const tips: Array<[number, number]> = [];
    c.beginPath();
    for (let k = 0; k < 8; k++) {
      const an = rng() * TAU;
      const l = r * rng.range(0.22, 0.38);
      c.moveTo(0, 0);
      c.lineTo(Math.cos(an) * l, Math.sin(an) * l);
      tips.push([Math.cos(an) * l, Math.sin(an) * l]);
    }
    c.strokeStyle = "#e05a85";
    c.lineWidth = Math.max(0.5, r * 0.02);
    c.stroke();
    c.beginPath();
    for (const [tx, ty] of tips) {
      c.moveTo(tx + r * 0.035, ty);
      c.arc(tx, ty, r * 0.035, 0, TAU);
    }
    c.fillStyle = "#f6c34a";
    c.fill();
  };
  const SP = 160;
  const sprites = [0, 1, 2, 3].map(() =>
    layer(S, SP, SP, (L) => {
      L.ctx.translate(SP / 2, SP / 2);
      L.ctx.rotate(rng() * TAU);
      drawBlossom(L.ctx, SP * 0.46);
    }),
  );
  for (const [x, y, r, rot, a] of blossoms) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.translate(x, y);
    ctx.rotate(rot);
    const k = r / (SP * 0.46);
    ctx.scale(k, k);
    ctx.drawImage(sprites[Math.floor(rot * 10) % 4] as CanvasImageSource, -SP / 2, -SP / 2);
    ctx.restore();
  }
  // drifting petals and soft foreground blossoms
  for (let i = 0; i < 34; i++) {
    ctx.save();
    ctx.translate(rng() * w, rng() * h);
    ctx.rotate(rng() * TAU);
    ctx.fillStyle = rgba(rng.pick(["#ffc2d6", "#ffd9e6", "#ff9fc0"]), rng.range(0.55, 0.9));
    ctx.beginPath();
    ctx.ellipse(0, 0, rng.range(0.006, 0.012) * S.U, rng.range(0.004, 0.008) * S.U, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }
  for (let i = 0; i < 5; i++) glow(S, rng() * w, rng() * h, rng.range(0.05, 0.1) * S.U, "#ffb7d0", 0.4, "screen");
  vignette(S, 0.12, "#7a3a5a");
  grain(S, 0.07);
});

/* -------------------------------------------------------------------- space */

photo("starfield", "Starfield", "space", WIDE, "stars night sky space galaxy milky way dark universe astronomy", (S) => {
  const { ctx, w, h, rng, noise } = S;
  fillV(S, 0, h, [[0, "#02030c"], [0.5, "#060a1c"], [1, "#0b1030"]]);
  // the Milky Way: a soft diagonal band with dust lanes
  const band = (u: number, v: number) => {
    const d = (v - (0.78 - 0.62 * u)) * 1.2;
    return Math.exp(-(d * d) / 0.022);
  };
  field(
    S,
    420,
    (u, v, o) => {
      const b = band(u, v);
      const cl = noise.fbm(u * 5 + 3, v * 5, 5);
      const k = b * (0.35 + 1.15 * (cl - 0.3));
      o[0] = 150 + 70 * (cl - 0.5);
      o[1] = 165 + 40 * (cl - 0.5);
      o[2] = 235;
      o[3] = clamp(k) * 0.55;
    },
    undefined,
    "screen",
  );
  field(
    S,
    420,
    (u, v, o) => {
      const b = band(u, v);
      const dust = smooth(0.52, 0.72, noise.fbm(u * 7 + 11, v * 8, 5));
      o[0] = 3;
      o[1] = 5;
      o[2] = 14;
      o[3] = clamp(b * dust * 1.1) * 0.8;
    },
  );
  // stars, denser along the band
  const warm = "#ffe6c4";
  const cool = "#cfe0ff";
  ctx.save();
  for (let i = 0; i < 4200; i++) {
    const x = rng();
    const y = rng();
    if (rng() > 0.3 + 0.7 * band(x, y)) continue;
    const m = Math.pow(rng(), 3.4);
    const r = (0.3 + m * 1.3) * Math.max(0.6, S.px);
    ctx.fillStyle = rgba(rng() < 0.18 ? warm : rng() < 0.5 ? cool : "#ffffff", 0.28 + 0.72 * m);
    if (r < 0.85) ctx.fillRect(x * w, y * h, r * 1.3, r * 1.3);
    else {
      ctx.beginPath();
      ctx.arc(x * w, y * h, r, 0, TAU);
      ctx.fill();
    }
  }
  ctx.restore();
  for (let i = 0; i < 9; i++) {
    const x = rng.range(0.06, 0.94) * w;
    const y = rng.range(0.08, 0.92) * h;
    glow(S, x, y, rng.range(0.012, 0.028) * S.U, rng() < 0.5 ? "#dbe7ff" : "#ffe9cf", 0.9);
    glow(S, x, y, rng.range(0.003, 0.006) * S.U, "#ffffff", 1);
  }
  vignette(S, 0.35, "#000005");
  grain(S, 0.06, true);
});

photo("nebula", "Nebula", "space", WIDE, "nebula space galaxy cosmos purple magenta teal stars cosmic clouds deep space astronomy", (S) => {
  const { w, h, rng, noise } = S;
  const asp = w / h;
  const ramp = makeRamp([[0, "#05030f"], [0.25, "#1b0f55"], [0.5, "#5a1e9a"], [0.7, "#b62f9c"], [0.86, "#f0709e"], [1, "#ffe0d6"]]);
  const teal = rgbOf("#1594c2");
  const tmp = new Float32Array(3);
  field(S, 640, (u, v, o) => {
    const x = u * asp * 1.3;
    const y = v * 1.3;
    const wx = noise.fbm(x * 0.8 + 4, y * 0.8, 3);
    const wy = noise.fbm(x * 0.8, y * 0.8 + 9, 3);
    const q1 = noise.fbm(x * 1.2 + 0.9 * wx, y * 1.2 + 0.9 * wy, 6);
    const q2 = noise.fbm(x * 2.2 + 20 - 0.8 * wy, y * 2.2 + 5 + 0.8 * wx, 5);
    const ex = u - 0.56;
    const ey = (v - 0.46) * 1.5;
    const env = Math.exp(-(ex * ex + ey * ey) / 0.2);
    const dens = clamp((q1 - 0.3) * 2.0) * (0.3 + 0.7 * env);
    ramp(clamp(dens * 1.15 + (q2 - 0.5) * 0.22 * env), tmp);
    const side = smooth(0.45, 0.75, q2) * (1 - env) * 0.55 * smooth(0.25, 0.5, q1);
    const dust = smooth(0.58, 0.74, noise.fbm(x * 1.7 + 21, y * 1.7 + 8 + wx, 4));
    const dk = 1 - dust * 0.55 * smooth(0.1, 0.5, dens);
    o[0] = lerp(tmp[0], teal[0], side) * dk;
    o[1] = lerp(tmp[1], teal[1], side) * dk;
    o[2] = lerp(tmp[2], teal[2], side) * dk;
  });
  glow(S, 0.56 * w, 0.46 * h, 0.22 * w, "#ffd6ea", 0.3, "screen", 1.3, 0.9);
  stars(S, 1500, { size: 1, bright: 0.985 });
  for (let i = 0; i < 5; i++) glow(S, rng.range(0.1, 0.9) * w, rng.range(0.1, 0.9) * h, rng.range(0.008, 0.016) * S.U, "#ffffff", 0.7);
  vignette(S, 0.3, "#02010a");
  grain(S, 0.06, true);
});

photo("moon-horizon", "Moonrise", "space", PORTRAIT, "moon full moon night sky moonlight lunar craters horizon dark silhouette stars hills", (S) => {
  const { w, h, noise } = S;
  fillV(S, 0, h, [[0, "#04081a"], [0.5, "#0c1a40"], [0.8, "#223765"], [1, "#2c4476"]]);
  stars(S, 800, { y1: 0.75, size: 1 });
  const cx = 0.5 * w;
  const cy = 0.38 * h;
  const R = 0.22 * S.U;
  glow(S, cx, cy, R * 5, "#8fb0ff", 0.28);
  glow(S, cx, cy, R * 2, "#dfe9ff", 0.3);
  const L = unit(-0.55, -0.45, 0.7);
  field(
    S,
    520,
    (u, v, o) => {
      const px = (u - 0.5) * 2;
      const py = (v - 0.5) * 2;
      const r2 = px * px + py * py;
      if (r2 > 1) {
        o[3] = 0;
        return;
      }
      const nz = Math.sqrt(1 - r2);
      const lamb = Math.max(0, px * L[0] + py * L[1] + nz * L[2]);
      const m = smooth(0.5, 0.62, noise.fbm(px * 1.5 + 3, py * 1.5, 4));
      const crat = noise.fbm(px * 7 + 11, py * 7, 4) - 0.5;
      const alb = 0.94 - 0.2 * m + crat * 0.1;
      const k = alb * (0.62 + 0.46 * Math.pow(lamb, 0.8)) * Math.pow(nz, 0.14);
      o[0] = 250 * k;
      o[1] = 245 * k;
      o[2] = 230 * k;
      o[3] = smooth(1.0, 0.985, Math.sqrt(r2));
    },
    { x: cx - R, y: cy - R, w: 2 * R, h: 2 * R },
  );
  const far = crest(S, { base: 0.84, amp: 0.1, freq: 2.2, oct: 4, sharp: 0.5, seed: 4 });
  fillCrest(S, far, "#1a2c5a", "#14234a");
  fogBand(S, 0.7 * h, 0.95 * h, "#4a64a0", 0.45, 0.7);
  const mid = crest(S, { base: 0.92, amp: 0.08, freq: 2.8, oct: 4, seed: 6 });
  fillCrest(S, mid, "#0d1a3c", "#091330");
  pines(S, mid, { count: 120, h0: 0.02, h1: 0.05, color: "#091330", density: (t) => clamp(0.3 + noise.fbm(t * 6, 2) * 1.2) });
  const near = crest(S, { base: 1.0, amp: 0.06, freq: 3.4, oct: 3, seed: 9 });
  fillCrest(S, near, "#040a1c", "#02060f");
  pines(S, near, { count: 90, h0: 0.04, h1: 0.1, color: "#040a1c", density: (t) => clamp(0.25 + noise.fbm(t * 5, 8) * 1.3) });
  vignette(S, 0.3, "#01030c");
  grain(S, 0.07, true);
});

photo("galaxy-spiral", "Spiral galaxy", "space", SQUARE, "galaxy spiral milky way stars cosmos deep space astronomy andromeda arms core universe", (S) => {
  const { w, h, rng } = S;
  fillV(S, 0, h, [[0, "#02030a"], [1, "#05081a"]]);
  const R = 640;
  const acc = new Float32Array(R * R * 3);
  const cx = R * 0.5;
  const cy = R * 0.5;
  const tilt = 0.6;
  const rot = -0.55;
  const cr = Math.cos(rot);
  const sr = Math.sin(rot);
  const add = (gx: number, gy: number, r: number, g: number, b: number) => {
    const px = cx + gx * cr - gy * sr;
    const py = cy + (gx * sr + gy * cr) * tilt;
    const ix = px | 0;
    const iy = py | 0;
    if (ix < 0 || iy < 0 || ix >= R - 1 || iy >= R - 1) return;
    const fx = px - ix;
    const fy = py - iy;
    const i0 = (iy * R + ix) * 3;
    const i1 = i0 + 3;
    const i2 = i0 + R * 3;
    const i3 = i2 + 3;
    const w0 = (1 - fx) * (1 - fy);
    const w1 = fx * (1 - fy);
    const w2 = (1 - fx) * fy;
    const w3 = fx * fy;
    acc[i0] += r * w0;
    acc[i0 + 1] += g * w0;
    acc[i0 + 2] += b * w0;
    acc[i1] += r * w1;
    acc[i1 + 1] += g * w1;
    acc[i1 + 2] += b * w1;
    acc[i2] += r * w2;
    acc[i2 + 1] += g * w2;
    acc[i2 + 2] += b * w2;
    acc[i3] += r * w3;
    acc[i3 + 1] += g * w3;
    acc[i3 + 2] += b * w3;
  };
  const twist = 3.4;
  const r0 = 22;
  for (let i = 0; i < 80000; i++) {
    const t = Math.pow(rng(), 1.55);
    const rr = t * 0.47 * R;
    const th = Math.log(1 + rr / r0) * twist + (i & 1) * Math.PI + (0.06 + 0.5 * t) * rng.gauss() * 0.6;
    const blue = smooth(0.05, 0.6, t);
    const inten = 0.6 * (0.4 + 0.6 * rng()) / (1 + t * 2.4);
    let cr1 = lerp(1.0, 0.55, blue);
    let cg1 = lerp(0.86, 0.72, blue);
    let cb1 = lerp(0.62, 1.0, blue);
    if (rng() < 0.035 && t > 0.15) {
      cr1 = 1;
      cg1 = 0.45;
      cb1 = 0.68;
    }
    add(Math.cos(th) * rr, Math.sin(th) * rr, cr1 * inten, cg1 * inten, cb1 * inten);
  }
  for (let i = 0; i < 40000; i++) {
    const rr = Math.abs(rng.gauss()) * 0.075 * R;
    const a = rng() * TAU;
    const k = 0.8 / (1 + rr * 0.05);
    add(Math.cos(a) * rr, Math.sin(a) * rr, 1.0 * k, 0.84 * k, 0.6 * k);
  }
  const cos = Math.cos(-rot);
  const sin = Math.sin(-rot);
  field(
    S,
    R,
    (u, v, o) => {
      const ix = Math.min(R - 1, Math.max(0, (u * R) | 0));
      const iy = Math.min(R - 1, Math.max(0, (v * R) | 0));
      const i = (iy * R + ix) * 3;
      // dust lanes hug the inner edge of each arm
      const dx = u * R - cx;
      const dy = (v * R - cy) / tilt;
      const gx = dx * cos - dy * sin;
      const gy = dx * sin + dy * cos;
      const rr = Math.hypot(gx, gy);
      const phase = (((Math.atan2(gy, gx) - Math.log(1 + rr / r0) * twist) % Math.PI) + Math.PI) % Math.PI;
      const lane = Math.exp(-Math.pow(phase - (Math.PI - 0.38), 2) / 0.035) * smooth(0.04, 0.2, rr / (0.47 * R));
      const dk = 1 - 0.65 * lane;
      o[0] = (1 - Math.exp(-1.15 * acc[i])) * 255 * dk;
      o[1] = (1 - Math.exp(-1.15 * acc[i + 1])) * 255 * dk;
      o[2] = (1 - Math.exp(-1.15 * acc[i + 2])) * 255 * dk;
    },
    undefined,
    "screen",
  );
  glow(S, 0.5 * w, 0.5 * h, 0.1 * S.U, "#fff2d8", 0.6);
  stars(S, 2300, { size: 1, bright: 0.992 });
  vignette(S, 0.3, "#01020a");
  grain(S, 0.06, true);
});

/* ------------------------------------------------------------ shared painters */

/** Short curved paper / linen fibres. */
function fibres(S: Scene, count: number, dark: string, light: string): void {
  const { ctx, w, h, rng } = S;
  ctx.save();
  ctx.lineCap = "round";
  for (let i = 0; i < count; i++) {
    const x = rng() * w;
    const y = rng() * h;
    const len = rng.range(0.008, 0.04) * S.U;
    const a = rng() * TAU;
    const bend = rng.range(-0.7, 0.7);
    ctx.strokeStyle = rng() < 0.62 ? rgba(dark, rng.range(0.04, 0.16)) : rgba(light, rng.range(0.2, 0.5));
    ctx.lineWidth = rng.range(0.5, 1.1) * Math.max(0.6, S.px);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.quadraticCurveTo(x + Math.cos(a + bend) * len * 0.5, y + Math.sin(a + bend) * len * 0.5, x + Math.cos(a) * len, y + Math.sin(a) * len);
    ctx.stroke();
  }
  ctx.restore();
}

/* ========================================================================== */
/* 6. Public API                                                              */
/* ========================================================================== */

export function getPhotoDef(id: string): PhotoDef | undefined {
  return REGISTRY.get(id)?.def;
}

/** Does the caller's context state need the photo to be composed in isolation first? */
function needsIsolation(ctx: Ctx): boolean {
  return (
    ctx.globalAlpha !== 1 ||
    ctx.globalCompositeOperation !== "source-over" ||
    ctx.shadowBlur !== 0 ||
    ctx.shadowOffsetX !== 0 ||
    ctx.shadowOffsetY !== 0 ||
    (typeof ctx.filter === "string" && ctx.filter !== "none")
  );
}

const warned = new Set<string>();
/**
 * Runs a painter inside save / clip / restore. A painter that throws must never take the renderer down
 * (or make `getPhotoImage` reject), so the failure is reported once and a neutral gradient is left behind.
 */
function paintEntry(e: Entry, ctx: Ctx, w: number, h: number): void {
  ctx.save();
  try {
    ctx.beginPath();
    ctx.rect(0, 0, w, h);
    ctx.clip();
    e.paint(makeScene(ctx, w, h, e.seed));
  } catch (err) {
    if (!warned.has(e.def.id) && typeof console !== "undefined") {
      warned.add(e.def.id);
      console.warn(`[craftly] photo "${e.def.id}" failed to paint`, err);
    }
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    ctx.shadowBlur = 0;
    ctx.fillStyle = lin(ctx, 0, 0, w, h, [[0, "#e4e6ee"], [1, "#c9ccd8"]]);
    ctx.fillRect(0, 0, w, h);
  } finally {
    ctx.restore();
  }
}

/**
 * Paint photo `id` into the rect (0,0,w,h) of `ctx` (a 2D context of an HTMLCanvasElement or
 * OffscreenCanvas). Unknown ids paint a neutral placeholder instead of throwing.
 */
export function drawPhoto(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  id: string,
  w: number,
  h: number,
): void {
  const c = ctx as unknown as Ctx;
  const e = REGISTRY.get(id);
  if (!e) {
    c.save();
    c.fillStyle = lin(c, 0, 0, w, h, [[0, "#e4e6ee"], [1, "#c9ccd8"]]);
    c.fillRect(0, 0, w, h);
    c.restore();
    return;
  }
  if (w <= 0 || h <= 0) return;
  if (!needsIsolation(c)) {
    paintEntry(e, c, w, h);
    return;
  }
  // The caller set alpha / blend / shadow / filter: compose the photo once on a scratch canvas
  // at device resolution, then draw that so the state applies to the finished picture.
  const m = c.getTransform();
  const sx = Math.hypot(m.a, m.b) || 1;
  const sy = Math.hypot(m.c, m.d) || 1;
  const k = Math.min(1, 4096 / Math.max(w * sx, h * sy));
  const cv = makeCanvas(w * sx * k, h * sy * k);
  paintEntry(e, ctxOf(cv), cv.width, cv.height);
  c.drawImage(cv as CanvasImageSource, 0, 0, w, h);
}

/* ---- bitmap cache ---- */

type Bitmap = HTMLCanvasElement | ImageBitmap;
const SIDE_STEPS = [64, 96, 128, 192, 256, 384, 512, 640, 800, 1024, 1280, 1600, 2048, 2560, 3200, 4096];
const quantizeSide = (side: number) => {
  const s = Math.floor(side);
  if (s < SIDE_STEPS[0]) return Math.max(16, s);
  let best = SIDE_STEPS[0];
  for (const step of SIDE_STEPS) if (step <= s) best = step;
  return best;
};
/** pixels of decoded bitmaps kept alive (about 150 MB of RGBA) */
const PIXEL_BUDGET = 36_000_000;
const imageCache = new Map<string, { promise: Promise<Bitmap>; pixels: number }>();
let cachedPixels = 0;
let queue: Promise<unknown> = Promise.resolve();

/** Run `job` after yielding to the event loop, one at a time, so a grid of previews never freezes the UI. */
function schedule<T>(job: () => T | Promise<T>): Promise<T> {
  const run = queue.then(() => new Promise<void>((r) => setTimeout(r, 0))).then(job);
  queue = run.catch(() => undefined);
  return run;
}

function renderBitmap(e: Entry, side: number): Bitmap {
  const k = side / Math.max(e.def.width, e.def.height);
  const w = Math.max(2, Math.round(e.def.width * k));
  const h = Math.max(2, Math.round(e.def.height * k));
  const cv = makeCanvas(w, h);
  paintEntry(e, ctxOf(cv), cv.width, cv.height);
  if (typeof HTMLCanvasElement !== "undefined" && cv instanceof HTMLCanvasElement) return cv;
  return (cv as OffscreenCanvas).transferToImageBitmap();
}

/**
 * Cached bitmap of photo `id` whose longest side is <= `maxSide` (default 1600, snapped down to
 * a handful of standard sizes so the cache stays small). Rejects only for unknown ids. The result is
 * shared between callers: draw it, never draw *into* it. Renders are queued one at a time and yield to the
 * event loop between jobs, so asking for a whole grid of previews does not freeze the UI.
 */
export function getPhotoImage(id: string, maxSide = 1600): Promise<Bitmap> {
  const e = REGISTRY.get(id);
  if (!e) return Promise.reject(new Error(`Unknown builtin photo "${id}"`));
  const side = quantizeSide(maxSide);
  const key = `${id}@${side}`;
  const hit = imageCache.get(key);
  if (hit) {
    imageCache.delete(key);
    imageCache.set(key, hit);
    return hit.promise;
  }
  const k = side / Math.max(e.def.width, e.def.height);
  const pixels = Math.round(e.def.width * k) * Math.round(e.def.height * k);
  const promise = schedule(() => renderBitmap(e, side));
  promise.catch(() => {
    if (imageCache.get(key)?.promise === promise) {
      imageCache.delete(key);
      cachedPixels -= pixels;
    }
  });
  imageCache.set(key, { promise, pixels });
  cachedPixels += pixels;
  for (const [k2, v] of imageCache) {
    if (cachedPixels <= PIXEL_BUDGET || k2 === key) break;
    imageCache.delete(k2);
    cachedPixels -= v.pixels;
  }
  return promise;
}

const thumbCache = new Map<string, Promise<string>>();
/** Small preview (default longest side 360) as an object URL (data URL where blobs are unavailable). */
export function getPhotoThumb(id: string, maxSide = 360): Promise<string> {
  const e = REGISTRY.get(id);
  if (!e) return Promise.reject(new Error(`Unknown builtin photo "${id}"`));
  const key = `${id}@${Math.round(maxSide)}`;
  const hit = thumbCache.get(key);
  if (hit) return hit;
  const k = Math.max(16, Math.round(maxSide)) / Math.max(e.def.width, e.def.height);
  const w = Math.max(2, Math.round(e.def.width * k));
  const h = Math.max(2, Math.round(e.def.height * k));
  const promise = schedule(async () => {
    const cv = makeCanvas(w, h);
    paintEntry(e, ctxOf(cv), cv.width, cv.height);
    if (typeof OffscreenCanvas !== "undefined" && cv instanceof OffscreenCanvas) {
      const blob = await cv.convertToBlob({ type: "image/jpeg", quality: 0.86 });
      return URL.createObjectURL(blob);
    }
    const el = cv as HTMLCanvasElement;
    if (typeof el.toBlob === "function" && typeof URL !== "undefined" && typeof URL.createObjectURL === "function") {
      const blob = await new Promise<Blob | null>((res) => el.toBlob(res, "image/jpeg", 0.86));
      if (blob) return URL.createObjectURL(blob);
    }
    return el.toDataURL("image/jpeg", 0.86);
  });
  thumbCache.set(key, promise);
  promise.catch(() => thumbCache.delete(key));
  return promise;
}
