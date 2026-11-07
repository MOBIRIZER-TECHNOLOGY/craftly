/**
 * Image filter presets and the sliders of the Adjust panel.
 *
 * A preset is stored on an image as `filter.preset` (id) + `filter.intensity` (0..100). Its `patch`
 * is the preset at 100% strength: the renderer (render/imageFilters.ts) adds `patch[key] * intensity / 100`
 * to the user's own slider values and cross-fades the duotone in. Patches therefore only use the
 * numeric slider fields of `ImageFilter` (plus `duotone`), never `preset` / `intensity`.
 */
import type { ImageFilter } from "@/core/types";

/** The numeric sliders of an ImageFilter. */
export type FilterAdjustKey = "brightness" | "contrast" | "saturation" | "warmth" | "fade" | "vignette" | "blur" | "hue";

export interface FilterPreset {
  id: string;
  name: string;
  /** one short line shown as a tooltip */
  description?: string;
  /** the preset at 100% intensity */
  patch: Partial<ImageFilter>;
}

export interface AdjustmentDef {
  key: FilterAdjustKey;
  label: string;
  min: number;
  max: number;
  step: number;
  /** value of a neutral image */
  default: number;
}

/** Sliders of the Adjust panel, in display order. */
export const ADJUSTMENTS: AdjustmentDef[] = [
  { key: "brightness", label: "Brightness", min: -100, max: 100, step: 1, default: 0 },
  { key: "contrast", label: "Contrast", min: -100, max: 100, step: 1, default: 0 },
  { key: "saturation", label: "Saturation", min: -100, max: 100, step: 1, default: 0 },
  { key: "warmth", label: "Warmth", min: -100, max: 100, step: 1, default: 0 },
  { key: "fade", label: "Fade", min: 0, max: 100, step: 1, default: 0 },
  { key: "vignette", label: "Vignette", min: 0, max: 100, step: 1, default: 0 },
  { key: "blur", label: "Blur", min: 0, max: 100, step: 1, default: 0 },
  { key: "hue", label: "Hue", min: -100, max: 100, step: 1, default: 0 },
];

export const FILTER_PRESETS: FilterPreset[] = [
  { id: "none", name: "None", description: "The original photo", patch: {} },
  {
    id: "fresco",
    name: "Fresco",
    description: "Sunlit and warm with a touch of fade",
    patch: { brightness: 4, contrast: 10, saturation: 14, warmth: 14, fade: 6 },
  },
  {
    id: "belvedere",
    name: "Belvedere",
    description: "Cool, matte tones with lifted shadows",
    patch: { brightness: 2, contrast: 14, saturation: -12, warmth: -8, fade: 14, hue: -3 },
  },
  {
    id: "flamingo",
    name: "Flamingo",
    description: "Rosy highlights and a soft glow",
    patch: { brightness: 6, contrast: 4, saturation: 16, warmth: 10, fade: 10, hue: -8 },
  },
  {
    id: "juno",
    name: "Juno",
    description: "Punchy colour with a golden cast",
    patch: { brightness: 3, contrast: 16, saturation: 24, warmth: 10, vignette: 8 },
  },
  {
    id: "golden-hour",
    name: "Golden hour",
    description: "Late-afternoon warmth",
    patch: { brightness: 6, contrast: 8, saturation: 16, warmth: 32, fade: 4, vignette: 14 },
  },
  {
    id: "pastel",
    name: "Pastel",
    description: "Light, airy and gently muted",
    patch: { brightness: 12, contrast: -10, saturation: -18, warmth: 4, fade: 24 },
  },
  {
    id: "soft",
    name: "Soft",
    description: "Dreamy, low-contrast glow",
    patch: { brightness: 8, contrast: -12, saturation: -6, fade: 16, blur: 8 },
  },
  {
    id: "matte",
    name: "Matte",
    description: "Flat blacks and calm colour",
    patch: { brightness: 2, contrast: -6, saturation: -10, fade: 30 },
  },
  {
    id: "vivid",
    name: "Vivid",
    description: "Rich, saturated colour",
    patch: { brightness: 3, contrast: 14, saturation: 48 },
  },
  {
    id: "warm",
    name: "Warm",
    description: "Amber tones",
    patch: { brightness: 2, saturation: 6, warmth: 38 },
  },
  {
    id: "cool",
    name: "Cool",
    description: "Blue-tinted shadows",
    patch: { contrast: 4, saturation: 4, warmth: -38 },
  },
  {
    id: "dramatic",
    name: "Dramatic",
    description: "Deep contrast and a dark edge",
    patch: { brightness: -8, contrast: 40, saturation: -10, vignette: 38 },
  },
  {
    id: "moody",
    name: "Moody",
    description: "Dim, cool and cinematic",
    patch: { brightness: -10, contrast: 18, saturation: -16, warmth: -12, vignette: 30 },
  },
  {
    id: "vintage",
    name: "Vintage fade",
    description: "Faded film with a warm cast",
    patch: { brightness: 4, contrast: -10, saturation: -20, warmth: 16, fade: 40, vignette: 22 },
  },
  {
    id: "heritage",
    name: "Heritage",
    description: "Old-photograph sepia",
    patch: { brightness: 2, contrast: 4, saturation: -48, warmth: 52, fade: 12, vignette: 16 },
  },
  {
    id: "mono",
    name: "Mono",
    description: "Clean black and white",
    patch: { brightness: 2, contrast: 8, saturation: -100 },
  },
  {
    id: "noir",
    name: "Noir",
    description: "High-contrast black and white",
    patch: { brightness: -8, contrast: 38, saturation: -100, vignette: 34 },
  },
  {
    id: "duo-ocean",
    name: "Duo ocean",
    description: "Deep navy to aqua",
    patch: { contrast: 8, duotone: { dark: "#0b1f4b", light: "#7ee8e0" } },
  },
  {
    id: "duo-sunset",
    name: "Duo sunset",
    description: "Plum to apricot",
    patch: { contrast: 8, duotone: { dark: "#3a0a4a", light: "#ffb270" } },
  },
  {
    id: "duo-rose",
    name: "Duo rose",
    description: "Wine to blush",
    patch: { contrast: 6, duotone: { dark: "#4a0f2e", light: "#ffd1dc" } },
  },
  {
    id: "duo-cyanotype",
    name: "Cyanotype",
    description: "Prussian blue print",
    patch: { contrast: 10, duotone: { dark: "#06233f", light: "#d7f0ff" } },
  },
];

const BY_ID = new Map(FILTER_PRESETS.map((p) => [p.id, p]));

export const getFilterPreset = (id: string): FilterPreset | undefined => BY_ID.get(id);
