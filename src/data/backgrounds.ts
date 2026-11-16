/**
 * Page background catalogue: solid colours, gradients, patterns and photo / texture fills.
 * Every list is also available as named presets grouped for the Background panel.
 */
import type { Fill, LinearGradientFill, PatternFill, PatternKind } from "@/core/types";
import { m } from "@/i18n";
import { englishName, nameIn } from "./names";
import { getPhotoDef } from "./photos";

export interface BackgroundPreset {
  id: string;
  name: string;
  /** the English name, which search also matches on a page in another language (src/data/names.ts) */
  englishName: string;
  fill: Fill;
}
export interface BackgroundGroup {
  id: string;
  label: string;
  presets: BackgroundPreset[];
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/* ------------------------------------------------------------------ */
/* Solid colours                                                      */
/* ------------------------------------------------------------------ */

const SOLIDS: Array<[key: string, color: string]> = [
  // whites and off-whites
  ["white", "#ffffff"],
  ["paper", "#faf7f2"],
  ["cream", "#f5efe3"],
  ["linen", "#ece4d6"],
  ["fog", "#eff1f5"],
  ["stone", "#d9d6cf"],
  // soft pastels
  ["blush", "#fde4e4"],
  ["peach", "#ffe3d3"],
  ["apricot", "#ffd9b8"],
  ["butter", "#fff1b8"],
  ["pistachio", "#e1f0c4"],
  ["mint", "#d6f5e6"],
  ["seafoam", "#c8efe9"],
  ["sky", "#d4ebfb"],
  ["periwinkle", "#d9dcfb"],
  ["lavender", "#e6dcf7"],
  ["lilac", "#f0d9f4"],
  ["rose", "#f9d2e0"],
  // mid tones
  ["coral", "#ff8a73"],
  ["marigold", "#f7b538"],
  ["mustard", "#d9a520"],
  ["sage", "#a8bfa0"],
  ["teal", "#2a9d8f"],
  ["cornflower", "#6c8cf0"],
  ["orchid", "#b576d9"],
  ["bubblegum", "#ff6fa5"],
  ["clay", "#c2735a"],
  ["sand", "#d8bf9a"],
  // deep tones
  ["navy", "#14213d"],
  ["midnight", "#0b1026"],
  ["indigo", "#2b2f77"],
  ["forest", "#1d3b2f"],
  ["pine", "#12322c"],
  ["aubergine", "#3b1f4a"],
  ["plum", "#4a1d4f"],
  ["burgundy", "#5c1a2b"],
  ["espresso", "#2b1d17"],
  ["slate", "#3b4656"],
  ["charcoal", "#22252b"],
  ["ink", "#0e1318"],
];

export const SOLID_BACKGROUNDS: string[] = SOLIDS.map(([, c]) => c);

/* ------------------------------------------------------------------ */
/* Gradients                                                          */
/* ------------------------------------------------------------------ */

export const lg = (angle: number, ...colors: string[]): LinearGradientFill => ({
  type: "linear",
  angle,
  stops: colors.map((color, i) => ({ offset: colors.length === 1 ? 0 : i / (colors.length - 1), color })),
});

const GRADIENTS: Array<[key: string, fill: LinearGradientFill]> = [
  ["peach-sorbet", lg(135, "#ffecd2", "#fcb69f")],
  ["blush-sky", lg(160, "#ffdde1", "#c9d6ff")],
  ["mint-breeze", lg(135, "#e0f7ef", "#a8e6cf")],
  ["lavender-dream", lg(135, "#e6dcf7", "#b8c6f5")],
  ["cotton-candy", lg(135, "#ff9a9e", "#fecfef", "#a1c4fd")],
  ["sunset-glow", lg(160, "#ff512f", "#dd2476")],
  ["golden-hour", lg(180, "#ffd6a5", "#ff9a76", "#c9455f")],
  ["ocean-breeze", lg(135, "#2193b0", "#6dd5ed")],
  ["lagoon", lg(135, "#43cea2", "#185a9d")],
  ["aurora", lg(160, "#0f2027", "#2c5364", "#43cea2")],
  ["northern-lights", lg(135, "#12c2e9", "#c471ed", "#f64f59")],
  ["berry-fizz", lg(135, "#8e2de2", "#f857a6")],
  ["tropical", lg(135, "#00b09b", "#96c93d")],
  ["dusk", lg(180, "#2c3e50", "#fd746c", "#ffb88c")],
  ["midnight", lg(180, "#0b1026", "#1f2a5c", "#3b4a9a")],
  ["forest-mist", lg(180, "#e5efe6", "#9bbf9d", "#3d6b57")],
  ["rose-quartz", lg(135, "#fbd3e9", "#bb377d")],
  ["sand-dune", lg(160, "#fdf1dc", "#f0c997", "#d98b5f")],
  ["citrus", lg(135, "#f9d423", "#ff4e50")],
  ["plum-velvet", lg(135, "#41295a", "#2f0743")],
  ["cloud", lg(180, "#ffffff", "#e6e9f0")],
  ["steel", lg(180, "#e3e8ef", "#8895a7", "#3b4656")],
  ["spring", lg(135, "#d4fc79", "#96e6a1")],
  ["sunrise", lg(0, "#f6d365", "#fda085")],
  ["candy-floss", lg(90, "#fbc2eb", "#a6c1ee")],
  ["neon-pop", lg(135, "#00f5a0", "#00d9f5")],
  ["twilight", lg(160, "#4b1d6e", "#c0397e", "#ff9a5a")],
  ["ember", lg(180, "#2b0a0a", "#a1260c", "#ff8a3d")],
  ["glacier", lg(180, "#f4fbff", "#b6dcf3", "#5b9ad1")],
  ["pastel-rainbow", lg(135, "#ffd6e0", "#ffe7c7", "#e4f5c8", "#cfeef7", "#e1d6fa")],
  ["latte", lg(180, "#fbf3e9", "#e3cdb2", "#b38b69")],
  ["emerald", lg(135, "#0f2c25", "#14705a", "#5fd3a5")],
  ["violet-storm", lg(135, "#232a6b", "#5b3a9e", "#b45bd1")],
  ["poolside", lg(90, "#a1ffce", "#faffd1")],
  ["craftly", lg(90, "#12c2b9", "#3b82f6", "#7c3aed")],
];

export const GRADIENT_BACKGROUNDS: LinearGradientFill[] = GRADIENTS.map(([, g]) => g);

/* ------------------------------------------------------------------ */
/* Patterns                                                           */
/* ------------------------------------------------------------------ */

const pat = (pattern: PatternKind, color: string, background: string, scale = 1): PatternFill => ({
  type: "pattern",
  pattern,
  color,
  background,
  scale,
});

const PATTERNS: Array<[key: string, fill: PatternFill]> = [
  ["polka-cream", pat("dots", "#e0b8a0", "#fbf1e6", 1)],
  ["midnight-dots", pat("dots", "#4a5c9a", "#14213d", 1)],
  ["pop-dots", pat("dots", "#ff6fa5", "#fff0f6", 1.5)],
  ["blueprint", pat("grid", "#4f86c6", "#0f2a4a", 1)],
  ["graph-paper", pat("grid", "#cfd8e3", "#ffffff", 1)],
  ["soft-grid", pat("grid", "#e0d4f5", "#faf7ff", 1.7)],
  ["pinstripe", pat("lines", "#d9d3c7", "#faf7f2", 1)],
  ["ink-stripes", pat("lines", "#3a4a78", "#1d2740", 1.2)],
  ["candy-stripes", pat("lines", "#ffb3c7", "#fff5f8", 1.6)],
  ["awning", pat("diagonal", "#ff8a73", "#fff4ea", 1.2)],
  ["navy-diagonal", pat("diagonal", "#34447a", "#1b2547", 1)],
  ["mint-diagonal", pat("diagonal", "#bfe7d5", "#f1fbf6", 1.5)],
  ["classic-checker", pat("checker", "#111111", "#ffffff", 1)],
  ["picnic", pat("checker", "#ff9aa2", "#fff7f7", 1.4)],
  ["sage-checker", pat("checker", "#a8bfa0", "#f4f7f1", 1.8)],
  ["ocean-waves", pat("waves", "#7ec8e3", "#e8f6fb", 1)],
  ["sand-waves", pat("waves", "#e8d3b0", "#fbf3e4", 1.3)],
  ["night-waves", pat("waves", "#3b4a8a", "#171d3d", 1)],
  ["zigzag-mustard", pat("zigzag", "#e3b341", "#fff8e1", 1)],
  ["chevron-teal", pat("zigzag", "#2a9d8f", "#e8f6f3", 1.4)],
  ["zigzag-ink", pat("zigzag", "#f4efe6", "#1c1f2b", 1.2)],
  ["plus-pink", pat("plus", "#ff8fb1", "#fff0f5", 1)],
  ["plus-navy", pat("plus", "#7c8fd6", "#101a3a", 1.2)],
  ["plus-sage", pat("plus", "#9fb596", "#f3f6ef", 1.6)],
  ["bubbles-aqua", pat("bubbles", "#9bdcf0", "#e9f8fd", 1)],
  ["bubbles-blush", pat("bubbles", "#f7b2c4", "#fff0f3", 1.3)],
  ["bubbles-lilac", pat("bubbles", "#b9a7ea", "#f3effc", 1.8)],
  ["paper-grain", pat("noise", "#bfae96", "#f4ecdf", 1)],
  ["slate-grain", pat("noise", "#8a93a6", "#2a2f3b", 1)],
  ["soft-grain", pat("noise", "#d4c9e8", "#f6f1fb", 1.4)],
];

export const PATTERN_BACKGROUNDS: PatternFill[] = PATTERNS.map(([, p]) => p);

/* ------------------------------------------------------------------ */
/* Photos and textures (procedural, see photos.ts)                    */
/* ------------------------------------------------------------------ */

/** Photo ids that work well behind text and graphics. */
export const PHOTO_BACKGROUND_IDS: string[] = [
  "mesh-sunrise",
  "mesh-ocean",
  "mesh-candy",
  "mesh-forest",
  "mesh-midnight",
  "liquid-purple",
  "soft-blobs",
  "neon-grid",
  "paper-waves",
  "boho-arches",
  "grain-orb",
  "pastel-clouds",
  "paper-cream",
  "marble-white",
  "concrete-gray",
  "linen-beige",
  "terrazzo",
  "kraft-paper",
  "wood-oak",
  "watercolor-wash",
  "bokeh-gold",
  "water-ripples",
  "nebula",
  "starfield",
  "moon-horizon",
  "sunset-hills",
  "ocean-waves",
  "aurora-night",
  "forest-mist",
  "desert-dunes",
  "lavender-fields",
];

/* ------------------------------------------------------------------ */
/* Presets and groups                                                 */
/* ------------------------------------------------------------------ */

export const uniqueIds = (prefix: string, names: string[]): string[] => {
  const seen = new Map<string, number>();
  return names.map((n) => {
    const base = `${prefix}-${slug(n)}`;
    const k = (seen.get(base) ?? 0) + 1;
    seen.set(base, k);
    return k === 1 ? base : `${base}-${k}`;
  });
};

const solidIds = uniqueIds("bg-solid", SOLIDS.map(([n]) => n));
const gradIds = uniqueIds("bg-gradient", GRADIENTS.map(([n]) => n));
const patIds = uniqueIds("bg-pattern", PATTERNS.map(([n]) => n));

// (each entry is written with a key, and its name is the catalog's: m.data.solidBackgrounds ...)
const SOLID_PRESETS: BackgroundPreset[] = SOLIDS.map(([key, color], i) => ({
  id: solidIds[i],
  name: nameIn(m.data.solidBackgrounds, key),
  englishName: englishName("solidBackgrounds", key),
  fill: { type: "solid", color },
}));
const GRADIENT_PRESETS: BackgroundPreset[] = GRADIENTS.map(([key, fill], i) => ({
  id: gradIds[i],
  name: nameIn(m.data.gradientBackgrounds, key),
  englishName: englishName("gradientBackgrounds", key),
  fill,
}));
const PATTERN_PRESETS: BackgroundPreset[] = PATTERNS.map(([key, fill], i) => ({
  id: patIds[i],
  name: nameIn(m.data.patternBackgrounds, key),
  englishName: englishName("patternBackgrounds", key),
  fill,
}));
const PHOTO_PRESETS: BackgroundPreset[] = PHOTO_BACKGROUND_IDS.map((id) => ({
  id: `bg-photo-${id}`,
  name: getPhotoDef(id)?.name ?? id,
  englishName: englishName("photos", id),
  fill: { type: "image", src: `builtin:${id}`, fit: "cover" },
}));

export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  { id: "solid", label: m.data.backgroundGroups.solid, presets: SOLID_PRESETS },
  { id: "gradient", label: m.data.backgroundGroups.gradient, presets: GRADIENT_PRESETS },
  { id: "pattern", label: m.data.backgroundGroups.pattern, presets: PATTERN_PRESETS },
  { id: "photo", label: m.data.backgroundGroups.photo, presets: PHOTO_PRESETS },
];

export const BACKGROUND_PRESETS: BackgroundPreset[] = BACKGROUND_GROUPS.flatMap((g) => g.presets);
