/**
 * Painting the page while something is dragged.
 *
 * Every pointer move of a drag changes the document, and the page canvas was then painted again from nothing: on a page
 * of 150 text boxes, of 40 filtered photos or of 60 blended shapes that took two to four frames of a 60 Hz screen on the
 * machine it was measured on (docs/PERFORMANCE.md). Nearly all of it was painting elements that had not changed.
 *
 * So during a pointer gesture the elements that stay as they are are painted once, on two layers: one with the page
 * background and everything under the lowest element that changes, one with everything over the highest. A frame then
 * lays the layer under on the empty canvas, paints the elements between the two (those that move and what lies between
 * them in the stack) the usual way, and lays the layer over on top.
 *
 * What makes this the same picture:
 *  - the layers are painted by `renderPage` itself, at the same scale, place, clip and size as the page canvas;
 *  - the layer under is opaque page, laid on an empty canvas: a copy. Blend modes in it mix with what is under them, all
 *    of which is on the layer;
 *  - the layer over holds only elements with no blend mode anywhere in them, which go over the page as "normal" does,
 *    and "normal" gives the same result whether elements go over the page one after the other or together (up to the
 *    rounding of a half-transparent edge to one of 256 levels). An element with a blend mode mixes with the moving
 *    element under it, so if one is over the moving elements there is no layer over: all of them are painted every frame;
 *  - when the gesture ends the page is painted from nothing again, so the picture at rest is never one made of layers.
 *
 * What moves is not asked for, it is seen: the store never changes an element in place (Immer), so an element that is
 * the same object as in the frame before has not changed, and one that is another object has. A layer is used again only
 * while every element on it is the same object as when it was painted and everything else it depends on is the same
 * (`keyOf`); a font or a picture that arrives is told with `invalidate`. A stale layer would be worse than a slow frame.
 */
import { blendOf } from "@/core/blend";
import type { Design, DesignElement, ID, Page } from "@/core/types";
import { renderPage, type RenderOptions } from "./renderPage";

type Ctx = CanvasRenderingContext2D;

/** With fewer elements than this staying as they are, painting them every frame costs less than two more canvases would. */
export const MIN_STEADY = 12;

export interface DragPainter {
  /**
   * Paints the page as `renderPage` does and answers what it answers (true when nothing was still loading). `gesture`
   * says that a pointer gesture is under way: only then are layers made and used; without it the layers are let go.
   */
  paint(ctx: Ctx, design: Pick<Design, "width" | "height">, page: Page, opts: RenderOptions, gesture: boolean): boolean;
  /** Something the layers show may look different now (a font or a picture arrived): they are painted again before they are used. */
  invalidate(): void;
  /** Lets go of the layers and of their memory. */
  release(): void;
  /** Whether the last paint was put together from layers: the page is then due a paint from nothing when the gesture ends. */
  readonly layered: boolean;
}

interface Layer {
  canvas: HTMLCanvasElement;
  ctx: Ctx;
}

/** The layers as they were painted: for which elements, and under which circumstances. */
interface Kept {
  key: string;
  background: Page["background"];
  elements: readonly DesignElement[];
  /** the elements from `lo` up to (not including) `liveEnd` are painted every frame */
  lo: number;
  liveEnd: number;
  under: Layer;
  /** nothing when no element is over the moving ones, or when one of them has a blend mode */
  over: Layer | null;
}

const hasBlend = (el: DesignElement): boolean => !!blendOf(el) || (el.type === "group" && el.children.some(hasBlend));

/** Everything but the elements and the background that decides what a layer looks like. */
function keyOf(ctx: Ctx, design: Pick<Design, "width" | "height">, page: Page, opts: RenderOptions): string {
  const hide = opts.hide ? [...opts.hide].sort().join(",") : "";
  const clip = opts.clip ? `${opts.clip.x},${opts.clip.y},${opts.clip.w},${opts.clip.h}` : "";
  return [ctx.canvas.width, ctx.canvas.height, design.width, design.height, page.id, opts.scale, clip, opts.transparent ? 1 : 0, opts.bleed ?? 0, hide].join("|");
}

export function createDragPainter(makeCanvas: () => HTMLCanvasElement = () => document.createElement("canvas")): DragPainter {
  /** the elements of the frame before, to see which have changed */
  let seen: { pageId: ID; elements: readonly DesignElement[] } | null = null;
  /** the lowest and the highest element that changed in this gesture so far */
  let span: { lo: number; hi: number } | null = null;
  let kept: Kept | null = null;
  let under: Layer | null = null;
  let over: Layer | null = null;
  let layered = false;

  const free = (layer: Layer | null): null => {
    if (layer) layer.canvas.width = layer.canvas.height = 0;
    return null;
  };
  const release = () => {
    under = free(under);
    over = free(over);
    kept = null;
    span = null;
    layered = false;
  };

  /** A layer as big as the page canvas, or nothing when no canvas can be had. */
  const sized = (layer: Layer | null, like: HTMLCanvasElement): Layer | null => {
    let made = layer;
    if (!made) {
      const canvas = makeCanvas();
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      made = { canvas, ctx };
    }
    if (made.canvas.width !== like.width) made.canvas.width = like.width;
    if (made.canvas.height !== like.height) made.canvas.height = like.height;
    return made;
  };

  /** Takes the elements that changed since the frame before into the span. False when the page is not the one of that frame, element for element. */
  const follow = (page: Page): boolean => {
    const before = seen;
    const els = page.elements;
    if (!before || before.pageId !== page.id || before.elements.length !== els.length) return false;
    for (let i = 0; i < els.length; i++) {
      if (els[i] === before.elements[i]) continue;
      if (els[i].id !== before.elements[i].id) return false;
      span = span ? { lo: Math.min(span.lo, i), hi: Math.max(span.hi, i) } : { lo: i, hi: i };
    }
    return true;
  };

  /** Whether the layers still show what they would show if they were painted now. */
  const fresh = (k: Kept, key: string, page: Page): boolean => {
    // (the page has the stack of the frame before, element for element: `follow` saw to that, and lets go of the layers otherwise)
    const els = page.elements;
    if (k.key !== key || k.background !== page.background) return false;
    for (let i = 0; i < k.lo; i++) if (els[i] !== k.elements[i]) return false;
    for (let i = k.liveEnd; i < els.length; i++) if (els[i] !== k.elements[i]) return false;
    return true;
  };

  /** Paints the layers for the span. Nothing when there are too few elements for it, no canvas, or something still loading. */
  const build = (ctx: Ctx, design: Pick<Design, "width" | "height">, page: Page, opts: RenderOptions, key: string, s: { lo: number; hi: number }): Kept | null => {
    const els = page.elements;
    const count = els.length;
    let hasOver = s.hi < count - 1;
    for (let i = s.hi + 1; hasOver && i < count; i++) if (hasBlend(els[i])) hasOver = false;
    const liveEnd = hasOver ? s.hi + 1 : count;
    if (s.lo + (count - liveEnd) < MIN_STEADY || !ctx.canvas.width || !ctx.canvas.height) return null;
    under = sized(under, ctx.canvas);
    if (!under) return null;
    if (!renderPage(under.ctx, design, page, { ...opts, part: { from: 0, to: s.lo, background: true } })) return null;
    if (hasOver) {
      over = sized(over, ctx.canvas);
      if (!over) return null;
      if (!renderPage(over.ctx, design, page, { ...opts, part: { from: liveEnd, to: count, background: false } })) return null;
    }
    return { key, background: page.background, elements: els, lo: s.lo, liveEnd, under, over: hasOver ? over : null };
  };

  const lay = (ctx: Ctx, layer: Layer, clear: boolean) => {
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = "source-over";
    if (clear) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(layer.canvas, 0, 0);
    ctx.restore();
  };

  return {
    paint(ctx, design, page, opts, gesture) {
      const whole = () => {
        layered = false;
        return renderPage(ctx, design, page, opts);
      };
      const known = gesture && !opts.animation && follow(page);
      seen = { pageId: page.id, elements: page.elements };
      if (!gesture) {
        release();
        return whole();
      }
      if (!known || !span) {
        // another page, another stack or an animation: what was kept says nothing about this frame
        if (!known) {
          kept = null;
          span = null;
        }
        return whole();
      }
      const key = keyOf(ctx, design, page, opts);
      if (!kept || !fresh(kept, key, page)) kept = build(ctx, design, page, opts, key, span);
      if (!kept) return whole();
      lay(ctx, kept.under, true);
      const complete = renderPage(ctx, design, page, { ...opts, part: { from: kept.lo, to: kept.liveEnd, background: false, keep: true } });
      if (kept.over) lay(ctx, kept.over, false);
      layered = true;
      return complete;
    },
    invalidate() {
      kept = null;
    },
    release,
    get layered() {
      return layered;
    },
  };
}
