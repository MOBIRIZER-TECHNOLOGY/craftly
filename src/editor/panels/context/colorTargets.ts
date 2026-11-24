/**
 * What each colour target of the Colour panel means: how to read the current colour of the selection and how to
 * write a new one (solid or gradient). Writes go through store actions only.
 */
import { parseColor } from "@/core/color";
import { solid } from "@/core/factory";
import { getActions, useEditor, type ColorTarget } from "@/core/store";
import { extractSvgColors } from "@/core/svg";
import type { DesignElement, Fill, LinearGradientFill, PaintFill, Page, Stroke } from "@/core/types";
import { textEditing } from "@/editor/canvas/textEditing";
import { m } from "@/i18n";
import { alphaOf, effectDefaults, SHADOW_PRESETS, shadowScale, toShadow, withAlpha } from "./effectModels";
import { collectTexts, forEachText, supportsShadow, supportsStroke } from "./selectionKinds";

export const TARGET_TITLES: Record<ColorTarget, string> = m.panelsContext.color.targets;

export interface TargetModel {
  title: string;
  /** the selection has something this target can colour */
  supported: boolean;
  emptyTitle: string;
  emptyText: string;
  /** the colour of the first selected element (null when it has none / a pattern) */
  current: PaintFill | null;
  /** gradient swatches make sense for this target */
  gradients: boolean;
}

export const sameColor = (a: string, b: string): boolean => {
  const x = parseColor(a);
  const y = parseColor(b);
  if (!x || !y) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return Math.round(x.r) === Math.round(y.r) && Math.round(x.g) === Math.round(y.g) && Math.round(x.b) === Math.round(y.b) && Math.abs(x.a - y.a) < 0.02;
};

export function samePaint(a: PaintFill | null | undefined, b: PaintFill): boolean {
  if (!a) return false;
  if (a.type === "solid" && b.type === "solid") return sameColor(a.color, b.color);
  if (a.type === "linear" && b.type === "linear") {
    return (
      a.angle === b.angle && a.stops.length === b.stops.length && a.stops.every((s, i) => Math.abs(s.offset - b.stops[i].offset) < 0.01 && sameColor(s.color, b.stops[i].color))
    );
  }
  return false;
}

/** Fill -> something the colour panel can show as "current" (patterns and photos have no single colour). */
function paintOf(fill: Fill | null | undefined): PaintFill | null {
  if (!fill) return null;
  return fill.type === "solid" || fill.type === "linear" || fill.type === "radial" ? fill : null;
}

/** A solid paint for "current colour" values (the store's `solid()` returns the wider Fill type). */
export const solidPaint = (color: string): PaintFill => ({ type: "solid", color });

const paletteIndex = (key: string | undefined) => {
  const n = Number.parseInt(key ?? "0", 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
};

const EMPTY: Record<ColorTarget, { title: string; text: string }> = m.panelsContext.color.empty;

export function describeTarget(target: ColorTarget, key: string | undefined, els: DesignElement[], page: Page | null): TargetModel {
  const texts = collectTexts(els);
  let supported = false;
  let current: PaintFill | null = null;
  let gradients = false;

  switch (target) {
    case "text": {
      supported = texts.length > 0;
      const t = texts[0];
      if (t) current = t.gradient ?? solidPaint(t.color);
      gradients = true;
      break;
    }
    case "highlight": {
      supported = texts.length > 0;
      const t = texts.find((x) => x.effect.kind === "background");
      if (t?.effect.color) current = solidPaint(t.effect.color);
      break;
    }
    case "effect": {
      supported = texts.length > 0;
      const c = texts[0]?.effect.color;
      if (c) current = solidPaint(c);
      break;
    }
    case "fill": {
      const shape = els.find((e) => e.type === "shape");
      const table = els.find((e) => e.type === "table");
      const chart = els.find((e) => e.type === "chart");
      supported = !!(shape || table || chart);
      if (shape?.type === "shape") current = paintOf(shape.fill);
      else if (table?.type === "table") current = solidPaint(table.headerFill);
      else if (chart?.type === "chart") current = solidPaint(chart.palette[paletteIndex(key) % Math.max(1, chart.palette.length)] ?? "#000000");
      gradients = !!shape;
      break;
    }
    case "table": {
      const table = els.find((e) => e.type === "table");
      supported = !!table;
      if (table?.type === "table") current = solidPaint(table.headerFill);
      break;
    }
    case "chart": {
      const chart = els.find((e) => e.type === "chart");
      supported = !!chart;
      if (chart?.type === "chart") current = solidPaint(chart.palette[paletteIndex(key) % Math.max(1, chart.palette.length)] ?? "#000000");
      break;
    }
    case "stroke": {
      const el = els.find(supportsStroke);
      supported = !!el;
      if (el && (el.type === "shape" || el.type === "image" || el.type === "video" || el.type === "line") && el.stroke) current = solidPaint(el.stroke.color);
      break;
    }
    case "shadow": {
      const el = els.find(supportsShadow);
      supported = !!el;
      const sh = els.find((e) => supportsShadow(e) && e.shadow)?.shadow;
      if (sh) current = solidPaint(withAlpha(sh.color, 1));
      break;
    }
    case "page": {
      supported = !!page;
      current = paintOf(page?.background);
      gradients = true;
      break;
    }
    case "graphic": {
      const g = els.find((e) => e.type === "graphic");
      supported = !!g;
      if (g?.type === "graphic") {
        const k = key ?? extractSvgColors(g.svg)[0];
        if (k) current = solidPaint(g.colors[k] ?? (k === "currentColor" ? "#000000" : k));
      }
      break;
    }
  }
  const empty = EMPTY[target];
  return { title: TARGET_TITLES[target], supported, emptyTitle: empty.title, emptyText: empty.text, current, gradients };
}

/* ------------------------------------------------------------------ */
/* writing                                                             */
/* ------------------------------------------------------------------ */

const clone = <T>(v: T): T => structuredClone(v);

function defaultStroke(color: string): Stroke {
  const design = useEditor.getState().design;
  const side = design ? Math.min(design.width, design.height) : 1080;
  return { color, width: Math.max(2, Math.round(side * 0.004)), style: "solid" };
}

/** Writes a solid colour to every selected element the target applies to. Text uses the selected characters while editing. */
export function applySolid(target: ColorTarget, key: string | undefined, color: string): void {
  const a = getActions();
  const s = useEditor.getState();
  switch (target) {
    case "text":
      if (textEditing.applyInline({ color })) return;
      a.setTextProps(null, { color, gradient: null });
      return;
    case "highlight":
      a.updateSelection((el) =>
        forEachText(el, (t) => {
          t.effect = t.effect.kind === "background" ? { ...t.effect, color } : { ...effectDefaults("background"), color };
        }),
      );
      return;
    case "effect":
      a.updateSelection((el) =>
        forEachText(el, (t) => {
          t.effect = { ...t.effect, color };
        }),
      );
      return;
    case "fill":
    case "table":
    case "chart": {
      const idx = paletteIndex(key);
      a.updateSelection((el) => {
        if (el.type === "shape" && target === "fill") el.fill = solid(color);
        else if (el.type === "table") el.headerFill = color;
        else if (el.type === "chart") {
          const n = Math.max(1, el.palette.length);
          el.palette = el.palette.map((c, i) => (i === idx % n ? color : c));
          const own = el.series[idx % n];
          if (own?.color) own.color = color;
        }
      });
      return;
    }
    case "stroke":
      a.updateSelection((el) => {
        if (el.type === "shape" || el.type === "image" || el.type === "video" || el.type === "line") el.stroke = { ...(el.stroke ?? defaultStroke(color)), color };
      });
      return;
    case "shadow": {
      const scale = s.design ? shadowScale(s.design) : 1;
      a.updateSelection((el) => {
        if (!supportsShadow(el)) return;
        el.shadow = el.shadow ? { ...el.shadow, color: withAlpha(color, alphaOf(el.shadow.color)) } : toShadow({ ...SHADOW_PRESETS[0].parts, color }, scale);
      });
      return;
    }
    case "page":
      a.setPageBackground(solid(color));
      return;
    case "graphic":
      a.updateSelection((el) => {
        if (el.type !== "graphic") return;
        const k = key ?? extractSvgColors(el.svg)[0];
        if (k) el.colors = { ...el.colors, [k]: color };
      });
      return;
  }
}

/** Writes a gradient where the target supports one (text, shape fills, the page). */
export function applyGradient(target: ColorTarget, key: string | undefined, gradient: LinearGradientFill): void {
  const a = getActions();
  switch (target) {
    case "text":
      a.setTextProps(null, { gradient: clone(gradient) });
      return;
    case "fill":
      a.updateSelection((el) => {
        if (el.type === "shape") el.fill = clone(gradient);
        else if (el.type === "table") el.headerFill = gradient.stops[0]?.color ?? el.headerFill;
        else if (el.type === "chart") {
          const n = Math.max(1, el.palette.length);
          el.palette = el.palette.map((c, i) => (i === paletteIndex(key) % n ? (gradient.stops[0]?.color ?? c) : c));
        }
      });
      return;
    case "page":
      a.setPageBackground(clone(gradient));
      return;
    default:
      return;
  }
}
