/**
 * Original inline SVG artwork used by the print templates: a synthwave horizon, a lighthouse
 * silhouette, certificate corner ornaments and borders, a seal ribbon, an art deco fan, hazard stripes ...
 * Everything is plain SVG with literal colours so the editor can recolour it like any other graphic.
 */

/** Small deterministic PRNG so scattered artwork (stars, speckles) is stable between loads. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const f1 = (n: number) => (Math.round(n * 10) / 10).toString();

/* ------------------------------------------------------------------ */
/* Synthwave horizon                                                    */
/* ------------------------------------------------------------------ */

export interface SynthOpts {
  /** y of the horizon line */
  horizon: number;
  /** sun radius */
  sunR: number;
  /** y where the perspective grid ends (it fades out before that) */
  gridBottom: number;
  sky?: [string, string];
  grid?: string;
  sun?: [string, string, string, string];
  seed?: number;
}

/** Retro sun with slatted cut-outs, a perspective grid and a field of stars. viewBox = 0 0 W H (page space). */
export function synthScene(W: number, H: number, o: SynthOpts): string {
  const cx = W / 2;
  const hz = o.horizon;
  const r = o.sunR;
  const sunCy = hz - r * 0.1;
  const top = sunCy - r;
  const grid = o.grid ?? "#ff4fd8";
  const [s0, s1, s2, s3] = o.sun ?? ["#ffe66d", "#ffa94d", "#ff4f8b", "#c0189a"];
  const rnd = rng(o.seed ?? 11);

  let stars = "";
  for (let i = 0; i < 110; i++) {
    const x = rnd() * W;
    const y = rnd() * (top + r * 0.9);
    const s = 1 + rnd() * 2.4;
    const op = 0.2 + rnd() * 0.7;
    stars += `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(s)}" fill="#ffffff" fill-opacity="${op.toFixed(2)}"/>`;
  }

  // slats cut out of the lower half of the sun
  let bars = "";
  const n = 8;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1);
    const y = top + r * (0.62 + 0.5 * Math.pow(t, 0.9));
    const th = r * (0.012 + 0.03 * t);
    bars += `<rect x="0" y="${f1(y)}" width="${W}" height="${f1(th)}" fill="#000000"/>`;
  }

  // perspective grid
  const gh = o.gridBottom - hz;
  let lines = "";
  for (let k = -16; k <= 16; k++) {
    const bx = cx + k * (W / 11);
    lines += `<line x1="${f1(cx + k * 4)}" y1="${hz}" x2="${f1(bx)}" y2="${o.gridBottom}" stroke="url(#gl)" stroke-width="${k % 4 === 0 ? 3.4 : 2.4}"/>`;
  }
  for (let j = 1; j <= 11; j++) {
    const t = j / 11;
    const y = hz + gh * Math.pow(t, 2.2);
    lines += `<line x1="0" y1="${f1(y)}" x2="${W}" y2="${f1(y)}" stroke="url(#gl)" stroke-width="${f1(1.6 + t * 3)}"/>`;
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<linearGradient id="sun" gradientUnits="userSpaceOnUse" x1="0" y1="${f1(top)}" x2="0" y2="${hz}"><stop offset="0" stop-color="${s0}"/><stop offset="0.38" stop-color="${s1}"/><stop offset="0.72" stop-color="${s2}"/><stop offset="1" stop-color="${s3}"/></linearGradient>` +
    `<radialGradient id="halo" gradientUnits="userSpaceOnUse" cx="${cx}" cy="${f1(sunCy)}" r="${f1(r * 2.1)}"><stop offset="0" stop-color="${s2}" stop-opacity="0.55"/><stop offset="0.5" stop-color="${s3}" stop-opacity="0.2"/><stop offset="1" stop-color="${s3}" stop-opacity="0"/></radialGradient>` +
    `<linearGradient id="gl" gradientUnits="userSpaceOnUse" x1="0" y1="${hz}" x2="0" y2="${o.gridBottom}"><stop offset="0" stop-color="${grid}" stop-opacity="0.25"/><stop offset="0.12" stop-color="${grid}" stop-opacity="0.95"/><stop offset="0.7" stop-color="${grid}" stop-opacity="0.75"/><stop offset="1" stop-color="${grid}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="hz" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#ff9be8" stop-opacity="0"/><stop offset="0.5" stop-color="#ffd0f5" stop-opacity="1"/><stop offset="1" stop-color="#ff9be8" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="haze" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s2}" stop-opacity="0"/><stop offset="1" stop-color="${s2}" stop-opacity="0.5"/></linearGradient>` +
    `<clipPath id="above"><rect x="0" y="0" width="${W}" height="${hz}"/></clipPath>` +
    `<mask id="slats" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${hz}"><rect x="0" y="0" width="${W}" height="${hz}" fill="#ffffff"/>${bars}</mask>` +
    `</defs>` +
    stars +
    `<circle cx="${cx}" cy="${f1(sunCy)}" r="${f1(r * 2.1)}" fill="url(#halo)" clip-path="url(#above)"/>` +
    `<g clip-path="url(#above)"><circle cx="${cx}" cy="${f1(sunCy)}" r="${f1(r)}" fill="url(#sun)" mask="url(#slats)"/></g>` +
    `<rect x="0" y="${hz - 150}" width="${W}" height="150" fill="url(#haze)"/>` +
    lines +
    `<rect x="0" y="${hz - 2.5}" width="${W}" height="5" fill="url(#hz)"/>` +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ */
/* Lighthouse                                                           */
/* ------------------------------------------------------------------ */

/** Lighthouse silhouette with beams, drawn in page space (viewBox = 0 0 W H). */
export function lighthouseScene(W: number, H: number, o: { x: number; baseY: number; topY: number; rock: string; tower?: string; glow?: string }): string {
  const { x, baseY, topY } = o;
  const tower = o.tower ?? "#04070d";
  const glow = o.glow ?? "#fff1b8";
  const lanternY = topY + 70;
  const rocks = [
    [x - 760, baseY + 150],
    [x - 700, baseY + 70],
    [x - 610, baseY + 82],
    [x - 540, baseY + 30],
    [x - 450, baseY + 44],
    [x - 360, baseY - 6],
    [x - 250, baseY - 12],
    [x - 170, baseY + 22],
    [x - 100, baseY - 28],
    [x - 40, baseY - 60],
    [x + 60, baseY - 62],
    [x + 120, baseY - 24],
    [x + 210, baseY - 40],
    [x + 300, baseY + 14],
    [x + 390, baseY - 8],
    [x + 470, baseY + 44],
    [x + 560, baseY + 40],
    [x + 640, baseY + 96],
    [x + 780, baseY + 120],
    [x + 780, baseY + 400],
    [x - 760, baseY + 400],
  ]
    .map(([px, py]) => `${f1(px)} ${f1(py)}`)
    .join("L");
  const halfBase = 74;
  const halfTop = 40;
  const bodyTop = topY + 130;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">` +
    `<defs>` +
    `<linearGradient id="bm" gradientUnits="userSpaceOnUse" x1="${x}" y1="0" x2="0" y2="0"><stop offset="0" stop-color="${glow}" stop-opacity="0.85"/><stop offset="0.45" stop-color="${glow}" stop-opacity="0.28"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="bm2" gradientUnits="userSpaceOnUse" x1="${x}" y1="0" x2="${W}" y2="0"><stop offset="0" stop-color="${glow}" stop-opacity="0.6"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></linearGradient>` +
    `<radialGradient id="lg" gradientUnits="userSpaceOnUse" cx="${x}" cy="${lanternY}" r="170"><stop offset="0" stop-color="${glow}" stop-opacity="0.95"/><stop offset="0.25" stop-color="${glow}" stop-opacity="0.45"/><stop offset="1" stop-color="${glow}" stop-opacity="0"/></radialGradient>` +
    `</defs>` +
    `<polygon points="${x},${lanternY} 0,${lanternY - 420} 0,${lanternY + 120}" fill="url(#bm)"/>` +
    `<polygon points="${x},${lanternY} ${W},${lanternY - 190} ${W},${lanternY + 60}" fill="url(#bm2)"/>` +
    `<circle cx="${x}" cy="${lanternY}" r="170" fill="url(#lg)"/>` +
    // tower
    `<polygon points="${x - halfTop},${bodyTop} ${x + halfTop},${bodyTop} ${x + halfBase},${baseY} ${x - halfBase},${baseY}" fill="${tower}"/>` +
    `<rect x="${x - 58}" y="${bodyTop - 14}" width="116" height="16" fill="${tower}"/>` +
    `<rect x="${x - 30}" y="${topY + 38}" width="60" height="${bodyTop - topY - 50}" fill="${tower}"/>` +
    `<polygon points="${x - 40},${topY + 40} ${x + 40},${topY + 40} ${x},${topY - 16}" fill="${tower}"/>` +
    `<circle cx="${x}" cy="${topY - 22}" r="7" fill="${tower}"/>` +
    `<rect x="${x - 18}" y="${lanternY - 24}" width="36" height="48" fill="${glow}"/>` +
    `<rect x="${x - 3}" y="${lanternY - 24}" width="6" height="48" fill="${tower}" fill-opacity="0.85"/>` +
    `<polygon points="${x - 64},${bodyTop + 150} ${x + 64},${bodyTop + 150} ${x + 66},${bodyTop + 176} ${x - 66},${bodyTop + 176}" fill="${tower}"/>` +
    `<rect x="${x - 7}" y="${bodyTop + 210}" width="14" height="34" fill="${glow}" fill-opacity="0.8"/>` +
    // rocks
    `<path d="M${rocks}Z" fill="${o.rock}"/>` +
    `</svg>`
  );
}

/* ------------------------------------------------------------------ */
/* Certificates                                                         */
/* ------------------------------------------------------------------ */

/** Ornate top-left corner flourish (140 x 140). Mirror it with flipH / flipV for the other corners. */
export function cornerOrnament(main: string, accent: string): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 160 160">` +
    `<g fill="none" stroke="${main}" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round">` +
    `<path d="M6 154V60C6 30 30 6 60 6H154"/>` +
    `<path d="M20 154V70C20 40 40 20 70 20H154" stroke-width="1.4"/>` +
    `<path d="M34 34C34 62 56 78 82 70C102 64 106 40 88 32C74 26 60 38 66 50C70 58 82 58 84 50" stroke="${accent}" stroke-width="2.6"/>` +
    `<path d="M34 34C62 34 78 56 70 82C64 102 40 106 32 88C26 74 38 60 50 66C58 70 58 82 50 84" stroke="${accent}" stroke-width="2.6"/>` +
    `</g>` +
    `<g fill="${accent}">` +
    `<polygon points="34,24 44,34 34,44 24,34"/>` +
    `<circle cx="154" cy="6" r="5"/><circle cx="6" cy="154" r="5"/>` +
    `<circle cx="96" cy="96" r="4"/>` +
    `</g>` +
    `</svg>`
  );
}

/** Straight ornamental border drawn as a long strip of repeated lozenges (w x 24). */
export function lozengeStrip(w: number, color: string, accent: string): string {
  const n = Math.floor(w / 24);
  const step = w / n;
  let d = "";
  for (let i = 0; i < n; i++) {
    const cx = step * (i + 0.5);
    d += `<polygon points="${f1(cx)},4 ${f1(cx + step * 0.38)},12 ${f1(cx)},20 ${f1(cx - step * 0.38)},12" fill="${i % 2 ? accent : color}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} 24">${d}</svg>`;
}

/** Two ribbon tails with V notches, meant to sit behind a round seal (viewBox 0 0 140 160). */
export function sealRibbon(main: string, dark: string): string {
  const tail = (deg: number, fill: string) =>
    `<g transform="rotate(${deg} 70 6)"><polygon points="52,0 88,0 88,152 70,130 52,152" fill="${fill}"/><polygon points="52,0 58,0 58,148 52,152" fill="${dark}" fill-opacity="0.35"/></g>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 140 160">${tail(14, dark)}${tail(-14, main)}</svg>`;
}

/** Art deco fan: radiating rays inside concentric arcs (viewBox 0 0 400 200, centre at the bottom middle). */
export function decoFan(color: string, rays = 13): string {
  let body = "";
  const cx = 200;
  const cy = 196;
  for (let i = 0; i < rays; i++) {
    const a = Math.PI + (i / (rays - 1)) * Math.PI;
    const r0 = 52;
    const r1 = 176;
    body += `<line x1="${f1(cx + Math.cos(a) * r0)}" y1="${f1(cy + Math.sin(a) * r0)}" x2="${f1(cx + Math.cos(a) * r1)}" y2="${f1(cy + Math.sin(a) * r1)}" stroke="${color}" stroke-width="${i % 2 ? 1.6 : 2.6}" stroke-linecap="round"/>`;
  }
  for (const [r, w] of [[44, 3], [184, 3], [192, 1.2]] as const) {
    body += `<path d="M${cx - r} ${cy}A${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/>`;
  }
  body += `<path d="M${cx - 30} ${cy}A30 30 0 0 1 ${cx + 30} ${cy}Z" fill="${color}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">${body}</svg>`;
}

/** Diagonal hazard stripes (ink on bg), drawn as exact parallelograms so tile seams never show. */
export function hazardStripes(w: number, h: number, ink: string, bg: string, pitch = 30): string {
  let body = `<rect width="${w}" height="${h}" fill="${bg}"/>`;
  const n = Math.ceil((w + h) / pitch) + 2;
  for (let i = -2; i < n; i++) {
    const x = i * pitch;
    body += `<polygon points="${x},${h} ${x + pitch / 2},${h} ${x + pitch / 2 + h},0 ${x + h},0" fill="${ink}"/>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}">${body}</svg>`;
}
