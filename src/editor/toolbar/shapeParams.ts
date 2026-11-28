/**
 * The numbers a shape is drawn from, where it has some: the sides of a polygon, the points of a star and how deep they are cut,
 * the lobes of a scalloped circle, the hole of a ring. The shapes take them from `params` (src/render/shapePaths.ts); this is
 * which of them the toolbar offers, and within which limits.
 */
import type { ShapeElement } from "@/core/types";
import { m } from "@/i18n";
import { getShape } from "@/render/shapePaths";

export interface ShapeParamControl {
  /** the name of the number in `params` */
  key: string;
  label: string;
  /** limits and step, as the slider shows them: a share is shown in percent */
  min: number;
  max: number;
  step: number;
  /** stored as a share between 0 and 1, shown as a percentage */
  percent?: boolean;
}

const words = m.editor.shapeBar.params;
const sides: ShapeParamControl = { key: "sides", label: words.sides, min: 3, max: 12, step: 1 };
const points = (min: number, max: number): ShapeParamControl => ({ key: "points", label: words.points, min, max, step: 1 });
const inner = (label: string, min: number, max: number): ShapeParamControl => ({ key: "inner", label, min, max, step: 1, percent: true });
const lobes: ShapeParamControl = { key: "lobes", label: words.lobes, min: 4, max: 24, step: 1 };
const amp: ShapeParamControl = { key: "amp", label: words.amp, min: 2, max: 40, step: 1, percent: true };

/** The controls of each shape that has numbers to set, by the id of the shape. */
export const SHAPE_PARAM_CONTROLS: Readonly<Record<string, readonly ShapeParamControl[]>> = {
  polygon: [sides],
  star: [points(3, 24), inner(words.inner, 10, 90)],
  "star-4": [inner(words.inner, 10, 90)],
  "star-6": [inner(words.inner, 10, 90)],
  burst: [points(6, 40), inner(words.inner, 50, 95)],
  scallop: [lobes, amp],
  flower: [lobes, amp],
  ring: [inner(words.hole, 10, 90)],
};

/** The controls for a selection of shapes: those of their kind when they are all of one kind that has some, else none. */
export function paramControlsFor(els: readonly ShapeElement[]): readonly ShapeParamControl[] {
  if (!els.length || els.some((el) => el.shape !== els[0].shape)) return [];
  return SHAPE_PARAM_CONTROLS[els[0].shape] ?? [];
}

/** The number a shape is drawn with: its own, or the one its kind starts with. In the unit of the slider (a share in percent). */
export function shapeParam(el: ShapeElement, control: ShapeParamControl): number {
  const value = el.params?.[control.key] ?? getShape(el.shape)?.params?.[control.key] ?? 0;
  return control.percent ? Math.round(value * 100) : Math.round(value);
}

/** Sets a number of a shape from the value of its slider, within the limits of the control. */
export function setShapeParam(el: ShapeElement, control: ShapeParamControl, shown: number): void {
  const clamped = Math.min(control.max, Math.max(control.min, Math.round(shown)));
  el.params = { ...el.params, [control.key]: control.percent ? clamped / 100 : clamped };
}
