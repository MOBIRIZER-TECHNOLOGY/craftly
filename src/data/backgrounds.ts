/**
 * Page background catalogue: solid colours, gradients, patterns and photo / texture fills.
 * Every list is also available as named presets grouped for the Background panel.
 */
import type { Fill, LinearGradientFill, PatternFill, PatternKind } from "@/core/types";
import { getPhotoDef } from "./photos";

export interface BackgroundPreset {
  id: string;
  name: string;
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

const SOLIDS: Array<[name: string, color: string]> = [
  // whites and off-whites
  ["White", "#ffffff"],
  ["Paper", "#faf7f2"],
  ["Cream", "#f5efe3"],
  ["Linen", "#ece4d6"],
  ["Fog", "#eff1f5"],
  ["Stone", "#d9d6cf"],
  // soft pastels
  ["Blush", "#fde4e4"],
  ["Peach", "#ffe3d3"],
  ["Apricot", "#ffd9b8"],
  ["Butter", "#fff1b8"],
  ["Pistachio", "#e1f0c4"],
  ["Mint", "#d6f5e6"],
  ["Seafoam", "#c8efe9"],
  ["Sky", "#d4ebfb"],
  ["Periwinkle", "#d9dcfb"],
  ["Lavender", "#e6dcf7"],
  ["Lilac", "#f0d9f4"],
  ["Rose", "#f9d2e0"],
  // mid tones
  ["Coral", "#ff8a73"],
  ["Marigold", "#f7b538"],
  ["Mustard", "#d9a520"],
  ["Sage", "#a8bfa0"],
  ["Teal", "#2a9d8f"],
  ["Cornflower", "#6c8cf0"],
  ["Orchid", "#b576d9"],
  ["Bubblegum", "#ff6fa5"],
  ["Clay", "#c2735a"],
  ["Sand", "#d8bf9a"],
  // deep tones
  ["Navy", "#14213d"],
  ["Midnight", "#0b1026"],
  ["Indigo", "#2b2f77"],
  ["Forest", "#1d3b2f"],
  ["Pine", "#12322c"],
  ["Aubergine", "#3b1f4a"],
  ["Plum", "#4a1d4f"],
  ["Burgundy", "#5c1a2b"],
  ["Espresso", "#2b1d17"],
  ["Slate", "#3b4656"],
  ["Charcoal", "#22252b"],
  ["Ink", "#0e1318"],
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

const GRADIENTS: Array<[name: string, fill: LinearGradientFill]> = [
  ["Peach sorbet", lg(135, "#ffecd2", "#fcb69f")],
  ["Blush sky", lg(160, "#ffdde1", "#c9d6ff")],
  ["Mint breeze", lg(135, "#e0f7ef", "#a8e6cf")],
  ["Lavender dream", lg(135, "#e6dcf7", "#b8c6f5")],
  ["Cotton candy", lg(135, "#ff9a9e", "#fecfef", "#a1c4fd")],
  ["Sunset glow", lg(160, "#ff512f", "#dd2476")],
  ["Golden hour", lg(180, "#ffd6a5", "#ff9a76", "#c9455f")],
  ["Ocean breeze", lg(135, "#2193b0", "#6dd5ed")],
  ["Lagoon", lg(135, "#43cea2", "#185a9d")],
  ["Aurora", lg(160, "#0f2027", "#2c5364", "#43cea2")],
  ["Northern lights", lg(135, "#12c2e9", "#c471ed", "#f64f59")],
  ["Berry fizz", lg(135, "#8e2de2", "#f857a6")],
  ["Tropical", lg(135, "#00b09b", "#96c93d")],
  ["Dusk", lg(180, "#2c3e50", "#fd746c", "#ffb88c")],
  ["Midnight", lg(180, "#0b1026", "#1f2a5c", "#3b4a9a")],
  ["Forest mist", lg(180, "#e5efe6", "#9bbf9d", "#3d6b57")],
  ["Rose quartz", lg(135, "#fbd3e9", "#bb377d")],
  ["Sand dune", lg(160, "#fdf1dc", "#f0c997", "#d98b5f")],
  ["Citrus", lg(135, "#f9d423", "#ff4e50")],
  ["Plum velvet", lg(135, "#41295a", "#2f0743")],
  ["Cloud", lg(180, "#ffffff", "#e6e9f0")],
  ["Steel", lg(180, "#e3e8ef", "#8895a7", "#3b4656")],
  ["Spring", lg(135, "#d4fc79", "#96e6a1")],
  ["Sunrise", lg(0, "#f6d365", "#fda085")],
  ["Candy floss", lg(90, "#fbc2eb", "#a6c1ee")],
  ["Neon pop", lg(135, "#00f5a0", "#00d9f5")],
  ["Twilight", lg(160, "#4b1d6e", "#c0397e", "#ff9a5a")],
  ["Ember", lg(180, "#2b0a0a", "#a1260c", "#ff8a3d")],
  ["Glacier", lg(180, "#f4fbff", "#b6dcf3", "#5b9ad1")],
  ["Pastel rainbow", lg(135, "#ffd6e0", "#ffe7c7", "#e4f5c8", "#cfeef7", "#e1d6fa")],
  ["Latte", lg(180, "#fbf3e9", "#e3cdb2", "#b38b69")],
  ["Emerald", lg(135, "#0f2c25", "#14705a", "#5fd3a5")],
  ["Violet storm", lg(135, "#232a6b", "#5b3a9e", "#b45bd1")],
  ["Poolside", lg(90, "#a1ffce", "#faffd1")],
  ["Craftly", lg(90, "#12c2b9", "#3b82f6", "#7c3aed")],
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

const PATTERNS: Array<[name: string, fill: PatternFill]> = [
  ["Polka cream", pat("dots", "#e0b8a0", "#fbf1e6", 1)],
  ["Midnight dots", pat("dots", "#4a5c9a", "#14213d", 1)],
  ["Pop dots", pat("dots", "#ff6fa5", "#fff0f6", 1.5)],
  ["Blueprint", pat("grid", "#4f86c6", "#0f2a4a", 1)],
  ["Graph paper", pat("grid", "#cfd8e3", "#ffffff", 1)],
  ["Soft grid", pat("grid", "#e0d4f5", "#faf7ff", 1.7)],
  ["Pinstripe", pat("lines", "#d9d3c7", "#faf7f2", 1)],
  ["Ink stripes", pat("lines", "#3a4a78", "#1d2740", 1.2)],
  ["Candy stripes", pat("lines", "#ffb3c7", "#fff5f8", 1.6)],
  ["Awning", pat("diagonal", "#ff8a73", "#fff4ea", 1.2)],
  ["Navy diagonal", pat("diagonal", "#34447a", "#1b2547", 1)],
  ["Mint diagonal", pat("diagonal", "#bfe7d5", "#f1fbf6", 1.5)],
  ["Classic checker", pat("checker", "#111111", "#ffffff", 1)],
  ["Picnic", pat("checker", "#ff9aa2", "#fff7f7", 1.4)],
  ["Sage checker", pat("checker", "#a8bfa0", "#f4f7f1", 1.8)],
  ["Ocean waves", pat("waves", "#7ec8e3", "#e8f6fb", 1)],
  ["Sand waves", pat("waves", "#e8d3b0", "#fbf3e4", 1.3)],
  ["Night waves", pat("waves", "#3b4a8a", "#171d3d", 1)],
  ["Zigzag mustard", pat("zigzag", "#e3b341", "#fff8e1", 1)],
  ["Chevron teal", pat("zigzag", "#2a9d8f", "#e8f6f3", 1.4)],
  ["Zigzag ink", pat("zigzag", "#f4efe6", "#1c1f2b", 1.2)],
  ["Plus pink", pat("plus", "#ff8fb1", "#fff0f5", 1)],
  ["Plus navy", pat("plus", "#7c8fd6", "#101a3a", 1.2)],
  ["Plus sage", pat("plus", "#9fb596", "#f3f6ef", 1.6)],
  ["Bubbles aqua", pat("bubbles", "#9bdcf0", "#e9f8fd", 1)],
  ["Bubbles blush", pat("bubbles", "#f7b2c4", "#fff0f3", 1.3)],
  ["Bubbles lilac", pat("bubbles", "#b9a7ea", "#f3effc", 1.8)],
  ["Paper grain", pat("noise", "#bfae96", "#f4ecdf", 1)],
  ["Slate grain", pat("noise", "#8a93a6", "#2a2f3b", 1)],
  ["Soft grain", pat("noise", "#d4c9e8", "#f6f1fb", 1.4)],
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

const SOLID_PRESETS: BackgroundPreset[] = SOLIDS.map(([name, color], i) => ({
  id: solidIds[i],
  name,
  fill: { type: "solid", color },
}));
const GRADIENT_PRESETS: BackgroundPreset[] = GRADIENTS.map(([name, fill], i) => ({ id: gradIds[i], name, fill }));
const PATTERN_PRESETS: BackgroundPreset[] = PATTERNS.map(([name, fill], i) => ({ id: patIds[i], name, fill }));
const PHOTO_PRESETS: BackgroundPreset[] = PHOTO_BACKGROUND_IDS.map((id) => ({
  id: `bg-photo-${id}`,
  name: getPhotoDef(id)?.name ?? id,
  fill: { type: "image", src: `builtin:${id}`, fit: "cover" },
}));

export const BACKGROUND_GROUPS: BackgroundGroup[] = [
  { id: "solid", label: "Solid colours", presets: SOLID_PRESETS },
  { id: "gradient", label: "Gradients", presets: GRADIENT_PRESETS },
  { id: "pattern", label: "Patterns", presets: PATTERN_PRESETS },
  { id: "photo", label: "Photos & textures", presets: PHOTO_PRESETS },
];

export const BACKGROUND_PRESETS: BackgroundPreset[] = BACKGROUND_GROUPS.flatMap((g) => g.presets);
