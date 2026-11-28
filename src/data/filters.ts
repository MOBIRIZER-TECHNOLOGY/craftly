/**
 * Image filter presets and the sliders of the Adjust panel.
 *
 * A preset is stored on an image as `filter.preset` (id) + `filter.intensity` (0..100). Its `patch`
 * is the preset at 100% strength: the renderer (render/imageFilters.ts) adds `patch[key] * intensity / 100`
 * to the user's own slider values and cross-fades the duotone in. Patches therefore only use the
 * numeric slider fields of `ImageFilter` (plus `duotone`), never `preset` / `intensity`.
 */
import type { ImageFilter } from "@/core/types";
import { m } from "@/i18n";
import { nameIn } from "./names";

/** The numeric sliders of an ImageFilter. */
export type FilterAdjustKey = "brightness" | "contrast" | "saturation" | "warmth" | "fade" | "vignette" | "blur" | "hue" | "highlights" | "shadows" | "sharpen" | "tint" | "curves" | "levels";

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

const SLIDERS: Array<Omit<AdjustmentDef, "label">> = [
  { key: "brightness", min: -100, max: 100, step: 1, default: 0 },
  { key: "contrast", min: -100, max: 100, step: 1, default: 0 },
  { key: "saturation", min: -100, max: 100, step: 1, default: 0 },
  { key: "warmth", min: -100, max: 100, step: 1, default: 0 },
  { key: "fade", min: 0, max: 100, step: 1, default: 0 },
  { key: "vignette", min: 0, max: 100, step: 1, default: 0 },
  { key: "blur", min: 0, max: 100, step: 1, default: 0 },
  { key: "hue", min: -100, max: 100, step: 1, default: 0 },
  { key: "highlights", min: -100, max: 100, step: 1, default: 0 },
  { key: "shadows", min: -100, max: 100, step: 1, default: 0 },
  { key: "sharpen", min: 0, max: 100, step: 1, default: 0 },
  { key: "tint", min: -100, max: 100, step: 1, default: 0 },
  { key: "curves", min: -100, max: 100, step: 1, default: 0 },
  { key: "levels", min: -100, max: 100, step: 1, default: 0 },
];

/** Sliders of the Adjust panel, in display order. */
export const ADJUSTMENTS: AdjustmentDef[] = SLIDERS.map(({ key, ...slider }) => ({ key, label: m.data.adjustments[key], ...slider }));

/** (names and tooltips are the catalog's, by id) */
const PRESETS: Array<Pick<FilterPreset, "id" | "patch">> = [
  { id: "none", patch: {} },
  {
    id: "fresco",
    patch: { brightness: 4, contrast: 10, saturation: 14, warmth: 14, fade: 6 },
  },
  {
    id: "belvedere",
    patch: { brightness: 2, contrast: 14, saturation: -12, warmth: -8, fade: 14, hue: -3 },
  },
  {
    id: "flamingo",
    patch: { brightness: 6, contrast: 4, saturation: 16, warmth: 10, fade: 10, hue: -8 },
  },
  {
    id: "juno",
    patch: { brightness: 3, contrast: 16, saturation: 24, warmth: 10, vignette: 8 },
  },
  {
    id: "golden-hour",
    patch: { brightness: 6, contrast: 8, saturation: 16, warmth: 32, fade: 4, vignette: 14 },
  },
  {
    id: "pastel",
    patch: { brightness: 12, contrast: -10, saturation: -18, warmth: 4, fade: 24 },
  },
  {
    id: "soft",
    patch: { brightness: 8, contrast: -12, saturation: -6, fade: 16, blur: 8 },
  },
  {
    id: "matte",
    patch: { brightness: 2, contrast: -6, saturation: -10, fade: 30 },
  },
  {
    id: "vivid",
    patch: { brightness: 3, contrast: 14, saturation: 48 },
  },
  {
    id: "warm",
    patch: { brightness: 2, saturation: 6, warmth: 38 },
  },
  {
    id: "cool",
    patch: { contrast: 4, saturation: 4, warmth: -38 },
  },
  {
    id: "dramatic",
    patch: { brightness: -8, contrast: 40, saturation: -10, vignette: 38 },
  },
  {
    id: "moody",
    patch: { brightness: -10, contrast: 18, saturation: -16, warmth: -12, vignette: 30 },
  },
  {
    id: "vintage",
    patch: { brightness: 4, contrast: -10, saturation: -20, warmth: 16, fade: 40, vignette: 22 },
  },
  {
    id: "heritage",
    patch: { brightness: 2, contrast: 4, saturation: -48, warmth: 52, fade: 12, vignette: 16 },
  },
  {
    id: "mono",
    patch: { brightness: 2, contrast: 8, saturation: -100 },
  },
  {
    id: "noir",
    patch: { brightness: -8, contrast: 38, saturation: -100, vignette: 34 },
  },
  {
    id: "duo-ocean",
    patch: { contrast: 8, duotone: { dark: "#0b1f4b", light: "#7ee8e0" } },
  },
  {
    id: "duo-sunset",
    patch: { contrast: 8, duotone: { dark: "#3a0a4a", light: "#ffb270" } },
  },
  {
    id: "duo-rose",
    patch: { contrast: 6, duotone: { dark: "#4a0f2e", light: "#ffd1dc" } },
  },
  {
    id: "duo-cyanotype",
    patch: { contrast: 10, duotone: { dark: "#06233f", light: "#d7f0ff" } },
  },
];

export const FILTER_PRESETS: FilterPreset[] = PRESETS.map((preset) => ({
  id: preset.id,
  name: nameIn(m.data.filters, preset.id),
  description: nameIn(m.data.filterHints, preset.id),
  patch: preset.patch,
}));

const BY_ID = new Map(FILTER_PRESETS.map((p) => [p.id, p]));

export const getFilterPreset = (id: string): FilterPreset | undefined => BY_ID.get(id);
