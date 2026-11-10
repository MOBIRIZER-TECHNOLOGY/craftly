/**
 * Blend modes: how an element mixes its colours with what is under it. The fifteen names are the ones that a canvas
 * (`globalCompositeOperation`) and a style sheet (`mix-blend-mode`) both know, so the painter and the SVG exporter write them
 * as they are. Normal is not a mode: an element with none has no `blend` at all.
 *
 * Whatever reads `blend` goes through `blendOf`, so a value that is not one of these (a hand edited file, another person's
 * browser) is the same as none and never reaches a canvas or a line of markup.
 */
import type { BlendMode } from "./types";

/** Every mode with the name a person reads, in the order of the list of a photo editor: darken, lighten, contrast, compare, colour. */
const LABELS: Readonly<Record<BlendMode, string>> = {
  darken: "Darken",
  multiply: "Multiply",
  "color-burn": "Color burn",
  lighten: "Lighten",
  screen: "Screen",
  "color-dodge": "Color dodge",
  overlay: "Overlay",
  "soft-light": "Soft light",
  "hard-light": "Hard light",
  difference: "Difference",
  exclusion: "Exclusion",
  hue: "Hue",
  saturation: "Saturation",
  color: "Color",
  luminosity: "Luminosity",
};

export const BLEND_MODES: readonly BlendMode[] = Object.keys(LABELS) as BlendMode[];

const KNOWN: ReadonlySet<unknown> = new Set(BLEND_MODES);

export const isBlendMode = (value: unknown): value is BlendMode => KNOWN.has(value);

/** The mode of an element, or nothing when it has none or what it has is not a mode. */
export const blendOf = (el: { blend?: unknown }): BlendMode | undefined => (isBlendMode(el.blend) ? el.blend : undefined);

/** The name of a mode as a person reads it; no mode is Normal. */
export const blendLabel = (mode: BlendMode | undefined): string => (mode ? LABELS[mode] : "Normal");
