/**
 * Colour data for the colour picker: the default swatch grid, curated gradients, named palettes,
 * and a small colour-name search.
 */
import type { LinearGradientFill } from "@/core/types";
import { hsvToRgb, lighten, darken, parseColor, rgbToHsv, toHex } from "@/core/color";
import { m } from "@/i18n";
import { nameIn } from "./names";

/* ------------------------------------------------------------------ */
/* Default solid colours: 7 x 4 grid                                  */
/* ------------------------------------------------------------------ */

/** Row 1 greys, row 2 red -> violet, row 3 teal -> indigo, row 4 green -> orange. Seven per row. */
export const DEFAULT_SOLID_COLORS: string[] = [
  // greys, black to white
  "#000000", "#252525", "#4a4a4a", "#737373", "#a6a6a6", "#d9d9d9", "#ffffff",
  // red, rose, pink, orchid, lavender, violet, deep violet
  "#ff3131", "#ff5c8a", "#ff66c4", "#cb6ce6", "#a16bff", "#7c3aed", "#5b21b6",
  // teal, cyan, sky, blue, periwinkle, royal, indigo
  "#00c2a8", "#0cc0df", "#38b6ff", "#3b82f6", "#5271ff", "#1e40af", "#312e81",
  // green, light green, lime, yellow, amber, orange, deep orange
  "#0f9d58", "#7ed957", "#c5e63c", "#ffde59", "#ffbd59", "#ff914d", "#ff6b2c",
];

/* ------------------------------------------------------------------ */
/* Default gradients                                                  */
/* ------------------------------------------------------------------ */

const grad = (angle: number, ...colors: string[]): LinearGradientFill => ({
  type: "linear",
  angle,
  stops: colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color })),
});

export const DEFAULT_GRADIENTS: LinearGradientFill[] = [
  grad(135, "#ffecd2", "#fcb69f"), // peach
  grad(135, "#ff512f", "#dd2476"), // sunset
  grad(135, "#2193b0", "#6dd5ed"), // ocean
  grad(135, "#56ab2f", "#a8e063"), // lush
  grad(135, "#141e30", "#243b55"), // royal night
  grad(135, "#00c6ff", "#0072ff"), // electric blue
  grad(135, "#a1c4fd", "#c2e9fb"), // sky
  grad(135, "#667eea", "#764ba2"), // grape
  grad(90, "#f857a6", "#ff5858"), // flamingo
  grad(135, "#00b09b", "#96c93d"), // mint
  grad(135, "#f7971e", "#ffd200"), // gold
  grad(135, "#8e2de2", "#4a00e0"), // berry
  grad(180, "#bdc3c7", "#2c3e50"), // slate
  grad(135, "#ff9a9e", "#fecfef", "#a1c4fd"), // candy
  grad(180, "#2c3e50", "#fd746c", "#ff9068"), // dusk
  grad(135, "#12c2e9", "#c471ed", "#f64f59"), // tropical
  grad(135, "#d4fc79", "#96e6a1"), // spring
  grad(180, "#0f2027", "#203a43", "#2c5364"), // deep sea
  grad(135, "#f4c4f3", "#fc67fa"), // orchid
  grad(135, "#f9d423", "#ff4e50"), // citrus
  grad(90, "#ffdde1", "#ee9ca7"), // blush
  grad(135, "#43cea2", "#185a9d"), // lagoon
  grad(135, "#41295a", "#2f0743"), // plum
  grad(180, "#ffffff", "#e6e9f0"), // cloud
  grad(90, "#12c2b9", "#3b82f6", "#7c3aed"), // Craftly
];

/* ------------------------------------------------------------------ */
/* Named palettes                                                     */
/* ------------------------------------------------------------------ */

export interface ColorPalette {
  id: string;
  name: string;
  /** exactly five colours, usually dark -> light with one accent */
  colors: string[];
}

const PALETTE_DATA: Array<[string, string[]]> = [
  ["sunset-market", ["#3d2c4d", "#c8553d", "#f28f3b", "#ffd58a", "#fff3d6"]],
  ["sea-glass", ["#0b3c49", "#1f7a8c", "#7fc8c0", "#bfe3d6", "#f1f7f0"]],
  ["peach-fuzz", ["#ffe5d4", "#ffc2a1", "#ff9b85", "#d6657a", "#7a3b69"]],
  ["berry-smoothie", ["#3b1c32", "#6a1a4c", "#b3366a", "#ee6c8a", "#ffc9d6"]],
  ["forest-floor", ["#1b2b20", "#2f5233", "#6b8f4e", "#b7c58a", "#efe6c8"]],
  ["desert-bloom", ["#5a3e36", "#b5654b", "#e3a07f", "#f4d6b0", "#8fa88a"]],
  ["midnight-jazz", ["#0d1b2a", "#1b263b", "#415a77", "#778da9", "#e0e1dd"]],
  ["cotton-candy", ["#ffc8dd", "#ffafcc", "#bde0fe", "#a2d2ff", "#fff5fb"]],
  ["matcha-latte", ["#3a4a2c", "#7a9a52", "#c4d49a", "#f0ead2", "#a77d5c"]],
  ["coral-reef", ["#05396b", "#0c7a8d", "#37b5a5", "#ff8a65", "#ffe0c2"]],
  ["lavender-haze", ["#2b2145", "#5b4b8a", "#9d8ec7", "#cfc4e8", "#f5f0ff"]],
  ["autumn-harvest", ["#3d1f0f", "#8c3b12", "#d2691e", "#e8a53c", "#f5deb3"]],
  ["ink-and-paper", ["#111111", "#3a3a3a", "#8a8a8a", "#d8d3c8", "#faf7f0"]],
  ["tropical-punch", ["#00695c", "#26c6a2", "#ffd54f", "#ff7043", "#e91e63"]],
  ["nordic-morning", ["#1f3a4d", "#5a8399", "#a9c6d3", "#e6eef2", "#f2b882"]],
  ["rose-garden", ["#4a1c2c", "#a23b5b", "#e07a95", "#f6b8c6", "#fdecef"]],
  ["citrus-grove", ["#2f4b26", "#7cb518", "#e9d758", "#f9a03f", "#fff4cc"]],
  ["blueberry-pie", ["#1d1b4d", "#3c3a8f", "#6a74d9", "#b3b9f0", "#f4d6a0"]],
  ["terracotta-studio", ["#6b3a2e", "#b8583d", "#e0916b", "#efd5b6", "#7c8b6f"]],
  ["mint-chocolate", ["#2e1f1a", "#5c3d2e", "#8cd0b4", "#cdeee0", "#fbfffc"]],
  ["golden-hour", ["#2c2a4a", "#7a4e7e", "#e07a5f", "#f2cc8f", "#fff1d0"]],
  ["pool-party", ["#00b4d8", "#48cae4", "#90e0ef", "#caf0f8", "#ff5d8f"]],
  ["moss-and-stone", ["#2b2d2a", "#5c6b57", "#9aa58b", "#d1cfc0", "#f2efe6"]],
  ["candy-shop", ["#ff4d8d", "#ff9bd2", "#ffd6a5", "#a0e7e5", "#6c5ce7"]],
  ["espresso", ["#1e1511", "#4a2f24", "#7b5844", "#c1a18a", "#f3e7da"]],
  ["spring-meadow", ["#386641", "#6a994e", "#a7c957", "#f2e8cf", "#bc4749"]],
  ["dusty-rose", ["#583a45", "#9a6b75", "#c99aa2", "#e8cfcf", "#f8efea"]],
  ["electric-night", ["#0a0a23", "#2d1b69", "#7b2ff7", "#00e5ff", "#f5f5ff"]],
  ["sandstone", ["#4a3b2a", "#9c7a54", "#d4b98c", "#ecdcc0", "#faf4e6"]],
  ["wild-orchid", ["#3a0f4d", "#7a2a8c", "#c459c8", "#f0a6e0", "#ffe9f8"]],
  ["glacier", ["#0a2540", "#1b6ca8", "#6fb7e9", "#cfe9f7", "#ffffff"]],
  ["olive-oil", ["#3b3d1c", "#6b6e2a", "#a9ab4e", "#e4e1a6", "#fbf8e1"]],
  ["hot-chilli", ["#2b0a0a", "#7a1212", "#d62828", "#f77f00", "#fcbf49"]],
  ["soft-sage", ["#4a5d4e", "#87a08b", "#b9cbb8", "#e5ece2", "#f7f4ec"]],
  ["dream-sky", ["#355c9a", "#7aa6e0", "#c3d9f5", "#ffd9c0", "#ffb3a7"]],
  ["plum-wine", ["#2a0f24", "#5b1e45", "#912f63", "#d9728f", "#f6c1a7"]],
  ["lemon-sorbet", ["#fff6a8", "#ffe066", "#ffc857", "#b8e0d2", "#5aa9a1"]],
  ["craftly-studio", ["#12c2b9", "#3b82f6", "#7c3aed", "#0e1318", "#f6f7f9"]],
  ["retro-diner", ["#d62839", "#f4f1de", "#ffb703", "#219ebc", "#023047"]],
  ["misty-mountain", ["#2f3e46", "#52796f", "#84a98c", "#cad2c5", "#e9f0ec"]],
];

/** (each palette is written with its id; the name is the catalog's) */
export const COLOR_PALETTES: ColorPalette[] = PALETTE_DATA.map(([id, colors]) => ({ id, name: nameIn(m.data.palettes, id), colors }));

/* ------------------------------------------------------------------ */
/* Colour names and search                                            */
/* ------------------------------------------------------------------ */

/** The basic names the colour search field understands. */
export const COLOR_NAMES = ["red", "orange", "yellow", "green", "teal", "blue", "purple", "pink", "brown", "grey", "black", "white"] as const;
export type ColorName = (typeof COLOR_NAMES)[number];

/** Classifies a colour into one of the basic names. Unparseable input gives "grey". */
export function nameOfColor(hex: string): ColorName {
  const c = parseColor(hex);
  if (!c) return "grey";
  const { h, s, v } = rgbToHsv(c);
  if (v < 0.14) return "black";
  if (s < 0.1) return v > 0.93 ? "white" : v < 0.2 ? "black" : "grey";
  if (s < 0.2 && v > 0.9) return "white";
  if (h >= 12 && h < 48 && v < 0.68 && s > 0.28) return "brown";
  if (h >= 16 && h < 50 && s < 0.4 && v < 0.85) return "brown";
  if ((h >= 335 || h < 12) && s < 0.5 && v > 0.78) return "pink";
  if (h >= 345 || h < 12) return "red";
  if (h < 42) return "orange";
  if (h < 68) return "yellow";
  if (h < 165) return "green";
  if (h < 200) return "teal";
  if (h < 255) return "blue";
  if (h < 312) return "purple";
  return "pink";
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  const [r, g, b] = hp < 1 ? [c, x, 0] : hp < 2 ? [x, c, 0] : hp < 3 ? [0, c, x] : hp < 4 ? [0, x, c] : hp < 5 ? [x, 0, c] : [c, 0, x];
  const base = l - c / 2;
  return toHex({ r: (r + base) * 255, g: (g + base) * 255, b: (b + base) * 255, a: 1 });
}

interface Family {
  /** basic name used to pick curated swatches from the palettes */
  base: ColorName;
  hue: number;
  sat: number;
  /** lightness range of the generated shades */
  lo: number;
  hi: number;
}
const FAMILIES: Record<string, Family> = {
  red: { base: "red", hue: 2, sat: 0.82, lo: 0.2, hi: 0.9 },
  orange: { base: "orange", hue: 26, sat: 0.92, lo: 0.22, hi: 0.9 },
  yellow: { base: "yellow", hue: 50, sat: 0.95, lo: 0.25, hi: 0.92 },
  green: { base: "green", hue: 130, sat: 0.6, lo: 0.16, hi: 0.9 },
  teal: { base: "teal", hue: 176, sat: 0.68, lo: 0.16, hi: 0.9 },
  blue: { base: "blue", hue: 216, sat: 0.8, lo: 0.18, hi: 0.92 },
  purple: { base: "purple", hue: 272, sat: 0.62, lo: 0.18, hi: 0.92 },
  pink: { base: "pink", hue: 332, sat: 0.8, lo: 0.3, hi: 0.94 },
  brown: { base: "brown", hue: 26, sat: 0.5, lo: 0.12, hi: 0.66 },
  grey: { base: "grey", hue: 220, sat: 0.04, lo: 0.1, hi: 0.94 },
  black: { base: "black", hue: 230, sat: 0.12, lo: 0.0, hi: 0.18 },
  white: { base: "white", hue: 40, sat: 0.3, lo: 0.9, hi: 1.0 },
  // aliases
  gray: { base: "grey", hue: 220, sat: 0.04, lo: 0.1, hi: 0.94 },
  violet: { base: "purple", hue: 266, sat: 0.7, lo: 0.2, hi: 0.92 },
  indigo: { base: "blue", hue: 244, sat: 0.6, lo: 0.16, hi: 0.86 },
  cyan: { base: "teal", hue: 188, sat: 0.85, lo: 0.2, hi: 0.9 },
  aqua: { base: "teal", hue: 184, sat: 0.7, lo: 0.3, hi: 0.92 },
  turquoise: { base: "teal", hue: 172, sat: 0.7, lo: 0.25, hi: 0.9 },
  navy: { base: "blue", hue: 224, sat: 0.68, lo: 0.08, hi: 0.34 },
  sky: { base: "blue", hue: 200, sat: 0.8, lo: 0.5, hi: 0.94 },
  lime: { base: "green", hue: 80, sat: 0.85, lo: 0.3, hi: 0.88 },
  mint: { base: "green", hue: 150, sat: 0.55, lo: 0.65, hi: 0.94 },
  olive: { base: "green", hue: 66, sat: 0.5, lo: 0.16, hi: 0.5 },
  gold: { base: "yellow", hue: 44, sat: 0.9, lo: 0.3, hi: 0.8 },
  beige: { base: "brown", hue: 38, sat: 0.35, lo: 0.7, hi: 0.94 },
  cream: { base: "white", hue: 45, sat: 0.6, lo: 0.86, hi: 0.97 },
  coral: { base: "red", hue: 10, sat: 0.85, lo: 0.52, hi: 0.78 },
  salmon: { base: "pink", hue: 8, sat: 0.8, lo: 0.6, hi: 0.86 },
  peach: { base: "orange", hue: 22, sat: 0.9, lo: 0.7, hi: 0.93 },
  rose: { base: "pink", hue: 345, sat: 0.7, lo: 0.4, hi: 0.9 },
  magenta: { base: "pink", hue: 308, sat: 0.8, lo: 0.25, hi: 0.85 },
  lavender: { base: "purple", hue: 262, sat: 0.6, lo: 0.7, hi: 0.94 },
  maroon: { base: "red", hue: 350, sat: 0.7, lo: 0.1, hi: 0.36 },
  crimson: { base: "red", hue: 348, sat: 0.85, lo: 0.3, hi: 0.6 },
  silver: { base: "grey", hue: 220, sat: 0.05, lo: 0.6, hi: 0.9 },
  charcoal: { base: "grey", hue: 220, sat: 0.06, lo: 0.08, hi: 0.3 },
};

function shadesOf(f: Family): string[] {
  const out: string[] = [];
  const steps = 11;
  for (const s of [f.sat, f.sat * 0.5]) {
    for (let i = 0; i < steps; i++) out.push(hslToHex(f.hue, Math.min(1, s), f.lo + ((f.hi - f.lo) * i) / (steps - 1)));
  }
  return out;
}

const hsvOf = (hex: string) => rgbToHsv(parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 });

/** Swatches from the default grid and the palettes that carry this name, most characteristic first. */
function curated(base: ColorName): string[] {
  const pool = new Set<string>();
  const add = (c: string) => {
    if (nameOfColor(c) === base) pool.add(c);
  };
  DEFAULT_SOLID_COLORS.forEach(add);
  for (const p of COLOR_PALETTES) p.colors.forEach(add);
  let list = [...pool];
  if (base === "white") return list.sort((a, b) => hsvOf(b).v - hsvOf(a).v);
  if (base === "black") return list.sort((a, b) => hsvOf(a).v - hsvOf(b).v);
  if (base === "grey") return list.sort((a, b) => Math.abs(hsvOf(a).v - 0.55) - Math.abs(hsvOf(b).v - 0.55));
  // near-black "blues" and washed-out "pinks" are not what someone typing a hue is after
  const minV = base === "brown" ? 0.2 : 0.32;
  list = list.filter((c) => hsvOf(c).v >= minV);
  return list.sort((a, b) => hsvOf(b).s * hsvOf(b).v - hsvOf(a).s * hsvOf(a).v);
}

function hexQuery(q: string): string | null {
  const hex = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(q);
  if (!hex) return null;
  // a bare 3-digit string is far more likely to be a word ("add", "bad") than a colour
  if (q[0] !== "#" && hex[1].length === 3) return null;
  const c = parseColor("#" + hex[1]);
  return c ? toHex(c) : null;
}

/**
 * Colours matching a search query. Understands `#rgb` / `#rrggbb` (the colour plus lighter and
 * darker variants) and colour names: the 12 basics (red, orange, yellow, green, teal, blue, purple,
 * pink, brown, grey, black, white), common aliases (navy, coral, mint ...) and name prefixes ("gre").
 * Curated swatches come first, followed by generated shades. Returns [] when nothing matches.
 */
export function searchColors(query: string): string[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hex = hexQuery(q);
  if (hex) {
    return [hex, lighten(hex, 0.2), lighten(hex, 0.4), lighten(hex, 0.65), darken(hex, 0.2), darken(hex, 0.4), darken(hex, 0.6)].filter(
      (c, i, a) => a.indexOf(c) === i,
    );
  }
  const names = Object.keys(FAMILIES).filter((n) => n === q || (q.length >= 2 && n.startsWith(q)));
  if (!names.length) return [];
  // an exact name beats prefix matches
  const wanted = names.includes(q) ? [q] : names;
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (c: string) => {
    if (!seen.has(c)) {
      seen.add(c);
      out.push(c);
    }
  };
  for (const n of wanted) {
    const f = FAMILIES[n];
    if (n === f.base) for (const c of curated(f.base)) push(c);
    for (const c of shadesOf(f)) push(c);
  }
  return out.slice(0, 40);
}

/** Convenience for swatch rendering: hue/saturation/value of a colour. */
export function describeColor(hex: string): { name: ColorName; h: number; s: number; v: number } {
  const c = parseColor(hex) ?? { r: 0, g: 0, b: 0, a: 1 };
  const { h, s, v } = rgbToHsv(c);
  return { name: nameOfColor(hex), h, s, v };
}

/** A fully saturated colour for a hue angle (for hue strips). */
export const hueColor = (h: number): string => toHex(hsvToRgb({ h, s: 1, v: 1 }));
