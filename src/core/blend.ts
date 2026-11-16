/**
 * Blend modes: how an element mixes its colours with what is under it. The fifteen names are the ones that a canvas
 * (`globalCompositeOperation`) and a style sheet (`mix-blend-mode`) both know, so the painter and the SVG exporter write them
 * as they are. Normal is not a mode: an element with none has no `blend` at all.
 *
 * Whatever reads `blend` goes through `blendOf`, so a value that is not one of these (a hand edited file, another person's
 * browser) is the same as none and never reaches a canvas or a line of markup.
 *
 * The live server bundles this file too (for `isBlendMode`, through src/collab/protocol.ts), so it takes the names a person
 * reads from the two `core` catalogs and the language of the page directly, not from `@/i18n`, whose `switchLanguage` brings
 * the whole editor (and its font files) into the bundle.
 */
import { core as en } from "@/i18n/en/core";
import { core as hi } from "@/i18n/hi/core";
import { lang, type Language } from "@/i18n/language";
import type { BlendMode } from "./types";

const NAMES: Readonly<Record<Language, typeof en.blend>> = { en: en.blend, hi: hi.blend };

/** Every mode, in the order of the list of a photo editor: darken, lighten, contrast, compare, colour. */
export const BLEND_MODES: readonly BlendMode[] = [
  "darken",
  "multiply",
  "color-burn",
  "lighten",
  "screen",
  "color-dodge",
  "overlay",
  "soft-light",
  "hard-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
];

const KNOWN: ReadonlySet<unknown> = new Set(BLEND_MODES);

export const isBlendMode = (value: unknown): value is BlendMode => KNOWN.has(value);

/** The mode of an element, or nothing when it has none or what it has is not a mode. */
export const blendOf = (el: { blend?: unknown }): BlendMode | undefined => (isBlendMode(el.blend) ? el.blend : undefined);

/** The name of a mode as a person reads it; no mode is Normal. */
export const blendLabel = (mode: BlendMode | undefined): string => (mode ? NAMES[lang][mode] : NAMES[lang].normal);
