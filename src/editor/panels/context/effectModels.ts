/**
 * Data behind the Effects panel: the ten text effects (which sliders each one has, what a freshly picked style
 * starts with) and the shadow model for shapes, images and graphics. Pure, so it is unit tested.
 */
import { parseColor, rgba, toHex } from "@/core/color";
import type { Shadow, TextEffect, TextEffectKind } from "@/core/types";
import { m } from "@/i18n";

/* ------------------------------------------------------------------ */
/* text effects                                                        */
/* ------------------------------------------------------------------ */

export type EffectControl = "offset" | "direction" | "blur" | "intensity" | "thickness" | "roundness" | "spread" | "transparency";

export const CONTROL_INFO: Record<EffectControl, { label: string; min: number; max: number; fallback: number }> = {
  offset: { label: m.panelsContext.effects.controls.offset, min: 0, max: 100, fallback: 50 },
  direction: { label: m.panelsContext.effects.controls.direction, min: -180, max: 180, fallback: 45 },
  blur: { label: m.panelsContext.effects.controls.blur, min: 0, max: 100, fallback: 0 },
  intensity: { label: m.panelsContext.effects.controls.intensity, min: 0, max: 100, fallback: 50 },
  thickness: { label: m.panelsContext.effects.controls.thickness, min: 0, max: 100, fallback: 50 },
  roundness: { label: m.panelsContext.effects.controls.roundness, min: 0, max: 100, fallback: 50 },
  spread: { label: m.panelsContext.effects.controls.spread, min: 0, max: 100, fallback: 50 },
  transparency: { label: m.panelsContext.effects.controls.transparency, min: 0, max: 100, fallback: 0 },
};

export interface EffectDef {
  kind: TextEffectKind;
  label: string;
  /** what the effect starts with when its tile is picked */
  defaults: TextEffect;
  /** the sliders shown for it, in order (the same fields the painter reads) */
  controls: EffectControl[];
  /** the effect paints with a colour of its own (otherwise it follows the text colour) */
  color: boolean;
}

export const TEXT_EFFECTS: EffectDef[] = [
  { kind: "none", label: m.panelsContext.effects.styles.none, defaults: { kind: "none" }, controls: [], color: false },
  {
    kind: "shadow",
    label: m.panelsContext.effects.styles.shadow,
    defaults: { kind: "shadow", color: "#000000", offset: 50, direction: 45, blur: 30, transparency: 50 },
    controls: ["offset", "direction", "blur", "transparency"],
    color: true,
  },
  { kind: "lift", label: m.panelsContext.effects.styles.lift, defaults: { kind: "lift", intensity: 50 }, controls: ["intensity"], color: false },
  { kind: "hollow", label: m.panelsContext.effects.styles.hollow, defaults: { kind: "hollow", thickness: 50 }, controls: ["thickness"], color: false },
  {
    kind: "splice",
    label: m.panelsContext.effects.styles.splice,
    defaults: { kind: "splice", color: "#8b3dff", thickness: 50, offset: 50, direction: 45 },
    controls: ["thickness", "offset", "direction"],
    color: true,
  },
  { kind: "outline", label: m.panelsContext.effects.styles.outline, defaults: { kind: "outline", color: "#000000", thickness: 50 }, controls: ["thickness"], color: true },
  { kind: "echo", label: m.panelsContext.effects.styles.echo, defaults: { kind: "echo", offset: 50, direction: 45 }, controls: ["offset", "direction"], color: true },
  { kind: "glitch", label: m.panelsContext.effects.styles.glitch, defaults: { kind: "glitch", offset: 50 }, controls: ["offset"], color: false },
  { kind: "neon", label: m.panelsContext.effects.styles.neon, defaults: { kind: "neon", color: "#ff2fb3", intensity: 50 }, controls: ["intensity"], color: true },
  {
    kind: "background",
    label: m.panelsContext.effects.styles.background,
    defaults: { kind: "background", color: "#ffe066", roundness: 50, spread: 50, transparency: 0 },
    controls: ["roundness", "spread", "transparency"],
    color: true,
  },
];

export const getEffectDef = (kind: TextEffectKind): EffectDef => TEXT_EFFECTS.find((d) => d.kind === kind) ?? TEXT_EFFECTS[0];

/** A fresh copy of the effect's defaults. */
export const effectDefaults = (kind: TextEffectKind): TextEffect => ({ ...getEffectDef(kind).defaults });

/** The value of a slider: what the effect stores, or the painter's own fallback. */
export function effectValue(effect: TextEffect, control: EffectControl): number {
  const v = effect[control];
  return typeof v === "number" ? v : CONTROL_INFO[control].fallback;
}

/** Curve value picked by the Curve tile before the user touches the slider. */
export const DEFAULT_CURVE = 50;

/* ------------------------------------------------------------------ */
/* shadow of shapes, images and graphics                                */
/* ------------------------------------------------------------------ */

/** A shadow in the units of the sliders: offset / blur / transparency 0..100, direction -180..180 degrees. */
export interface ShadowParts {
  offset: number;
  direction: number;
  blur: number;
  transparency: number;
  /** #rrggbb */
  color: string;
}

export type ShadowPresetId = "drop" | "glow" | "soft" | "hard";

export const SHADOW_PRESETS: Array<{ id: ShadowPresetId; label: string; parts: ShadowParts }> = [
  { id: "drop", label: m.panelsContext.effects.shadowPresets.drop, parts: { offset: 35, direction: 45, blur: 30, transparency: 55, color: "#000000" } },
  { id: "glow", label: m.panelsContext.effects.shadowPresets.glow, parts: { offset: 0, direction: 45, blur: 60, transparency: 15, color: "#8b3dff" } },
  { id: "soft", label: m.panelsContext.effects.shadowPresets.soft, parts: { offset: 20, direction: 90, blur: 90, transparency: 72, color: "#0e1318" } },
  { id: "hard", label: m.panelsContext.effects.shadowPresets.hard, parts: { offset: 40, direction: 45, blur: 0, transparency: 10, color: "#0e1318" } },
];

/** Design px per slider unit on a page whose short side is 1080px; other page sizes scale with it. */
const OFFSET_PX = 0.5;
const BLUR_PX = 1;
const IMAGE_BLUR_PX = 0.3;

export const shadowScale = (design: { width: number; height: number }) => Math.max(0.05, Math.min(design.width, design.height) / 1080);

const round = (v: number, digits = 2) => Math.round(v * 10 ** digits) / 10 ** digits;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** `color` with its opacity replaced by `alpha` (0..1); opaque colours stay plain hex. */
export function withAlpha(color: string, alpha: number): string {
  const c = parseColor(color);
  if (!c) return color;
  const a = clamp(alpha, 0, 1);
  return a >= 0.995 ? toHex(c) : rgba(toHex(c), a);
}

export const alphaOf = (color: string): number => parseColor(color)?.a ?? 1;

export function toShadow(p: ShadowParts, scale: number): Shadow {
  const dist = p.offset * OFFSET_PX * scale;
  const a = (p.direction * Math.PI) / 180;
  return {
    color: withAlpha(p.color, 1 - p.transparency / 100),
    blur: round(p.blur * BLUR_PX * scale),
    x: round(Math.cos(a) * dist),
    y: round(Math.sin(a) * dist),
  };
}

/** `fallbackDirection` is used when the shadow has no offset (a glow has no direction of its own). */
export function fromShadow(s: Shadow, scale: number, fallbackDirection = 45): ShadowParts {
  const dist = Math.hypot(s.x, s.y);
  const c = parseColor(s.color);
  return {
    offset: clamp(round(dist / (OFFSET_PX * scale), 1), 0, 100),
    direction: dist > 0.01 ? clamp(round((Math.atan2(s.y, s.x) * 180) / Math.PI, 1), -180, 180) : fallbackDirection,
    blur: clamp(round(s.blur / (BLUR_PX * scale), 1), 0, 100),
    transparency: clamp(Math.round((1 - (c?.a ?? 1)) * 100), 0, 100),
    color: c ? toHex(c) : "#000000",
  };
}

/** Which preset (if any) the shadow still matches closely. */
export function matchShadowPreset(s: Shadow | null | undefined, scale: number): ShadowPresetId | null {
  if (!s) return null;
  const p = fromShadow(s, scale);
  for (const preset of SHADOW_PRESETS) {
    const q = preset.parts;
    const sameDirection = q.offset === 0 || Math.abs(p.direction - q.direction) < 2;
    if (Math.abs(p.offset - q.offset) < 1.5 && sameDirection && Math.abs(p.blur - q.blur) < 1.5 && Math.abs(p.transparency - q.transparency) < 1.5 && p.color === q.color)
      return preset.id;
  }
  return null;
}

/** Whole-element blur slider (images): 0..100 maps to 0..30px on a 1080px page. */
export const blurToPx = (value: number, scale: number) => round(value * IMAGE_BLUR_PX * scale);
export const blurFromPx = (px: number, scale: number) => clamp(Math.round(px / (IMAGE_BLUR_PX * scale)), 0, 100);
