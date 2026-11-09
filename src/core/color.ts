export interface RGBA {
  r: number;
  g: number;
  b: number;
  a: number;
}
export interface HSV {
  h: number; // 0..360
  s: number; // 0..1
  v: number; // 0..1
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const hex2 = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, "0");

const NAMED: Record<string, string> = { white: "#ffffff", black: "#000000", transparent: "rgba(0,0,0,0)" };

/** Parses #rgb, #rrggbb, #rrggbbaa, rgb(), rgba() and a few names. Returns null when unknown. */
export function parseColor(input: string): RGBA | null {
  if (!input) return null;
  let s = input.trim().toLowerCase();
  if (NAMED[s]) s = NAMED[s];
  if (s[0] === "#") {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const [r, g, b, a] = h.split("").map((c) => parseInt(c + c, 16));
      return { r, g, b, a: h.length === 4 ? a / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }
  const m = s.match(/^rgba?\(([^)]+)\)$/);
  if (m) {
    const p = m[1]
      .split(/[\s,/]+/)
      .filter(Boolean)
      .map(parseFloat);
    if (p.length >= 3 && p.every((n) => !Number.isNaN(n))) return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  }
  return null;
}

export function toHex(c: RGBA, withAlpha = false): string {
  const base = `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  return withAlpha && c.a < 1 ? base + hex2(c.a * 255) : base;
}

const PLAIN_COLOR = /^(#[0-9a-f]{3,8}|[a-z]{3,30}|rgba?\(\s*[\d.%+-]+(\s*[,/\s]\s*[\d.%+-]+){2,3}\s*\))$/i;

/**
 * Whether a colour is written plainly (#hex, a name the editor knows, rgb() or rgba() with numbers). That is what makes it safe to
 * put into the attribute of some markup as it stands: a colour from a design that somebody else made is text that could be anything.
 */
export function isPlainColor(value: unknown): value is string {
  return typeof value === "string" && value.length <= 64 && PLAIN_COLOR.test(value) && parseColor(value) !== null;
}

/** Any colour string -> #rrggbb (alpha dropped). Falls back to the input. */
export function normalizeHex(input: string): string {
  const c = parseColor(input);
  return c ? toHex(c) : input;
}

export function rgba(input: string, alpha: number): string {
  const c = parseColor(input) ?? { r: 0, g: 0, b: 0, a: 1 };
  return `rgba(${Math.round(c.r)},${Math.round(c.g)},${Math.round(c.b)},${+(c.a * alpha).toFixed(3)})`;
}

export function rgbToHsv({ r, g, b }: RGBA): HSV {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const d = max - min;
  let h = 0;
  if (d) {
    if (max === rr) h = ((gg - bb) / d) % 6;
    else if (max === gg) h = (bb - rr) / d + 2;
    else h = (rr - gg) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return { h, s: max ? d / max : 0, v: max };
}

export function hsvToRgb({ h, s, v }: HSV): RGBA {
  const hh = ((h % 360) + 360) % 360;
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let rr: number;
  let gg: number;
  let bb: number;
  if (hh < 60) [rr, gg, bb] = [c, x, 0];
  else if (hh < 120) [rr, gg, bb] = [x, c, 0];
  else if (hh < 180) [rr, gg, bb] = [0, c, x];
  else if (hh < 240) [rr, gg, bb] = [0, x, c];
  else if (hh < 300) [rr, gg, bb] = [x, 0, c];
  else [rr, gg, bb] = [c, 0, x];
  return { r: (rr + m) * 255, g: (gg + m) * 255, b: (bb + m) * 255, a: 1 };
}

export const hexToHsv = (hex: string): HSV => rgbToHsv(parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 });
export const hsvToHex = (hsv: HSV): string => toHex(hsvToRgb(hsv));

/** Hue in degrees, saturation and lightness in percent -> #rrggbb. */
export function hslToHex(h: number, s: number, l: number): string {
  const sat = clamp01(s / 100);
  const light = clamp01(l / 100);
  const v = light + sat * Math.min(light, 1 - light);
  return hsvToHex({ h, s: v === 0 ? 0 : 2 * (1 - light / v), v });
}

/** Linear mix of two colours, t = 0 -> a, t = 1 -> b. */
export function mix(a: string, b: string, t: number): string {
  const ca = parseColor(a) ?? { r: 0, g: 0, b: 0, a: 1 };
  const cb = parseColor(b) ?? { r: 0, g: 0, b: 0, a: 1 };
  return toHex({ r: ca.r + (cb.r - ca.r) * t, g: ca.g + (cb.g - ca.g) * t, b: ca.b + (cb.b - ca.b) * t, a: 1 });
}

export const lighten = (c: string, t: number) => mix(c, "#ffffff", clamp01(t));
export const darken = (c: string, t: number) => mix(c, "#000000", clamp01(t));

/** WCAG relative luminance, 0..1 */
export function luminance(input: string): number {
  const c = parseColor(input);
  if (!c) return 0;
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
}

export function contrastRatio(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

export const isLight = (c: string) => luminance(c) > 0.5;

/** Black or white, whichever reads better on `bg`. */
export const readableOn = (bg: string) => (contrastRatio(bg, "#ffffff") >= contrastRatio(bg, "#0b0b12") ? "#ffffff" : "#0b0b12");

/**
 * `ink` faded towards `bg` by `strength` (0 is the background, 1 the ink), made stronger in small steps until it reaches
 * `need`:1 contrast with `bg`. It stops at the ink itself, which can still fall short on some mid-tone backgrounds.
 */
export function fadedInk(ink: string, bg: string, strength: number, need = 4.5): string {
  let t = clamp01(strength);
  let colour = mix(bg, ink, t);
  while (t < 1 && contrastRatio(colour, bg) < need) {
    t = Math.min(1, t + 0.02);
    colour = mix(bg, ink, t);
  }
  return colour;
}
