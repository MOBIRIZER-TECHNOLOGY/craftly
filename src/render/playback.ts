/**
 * Painting a whole playback: the editor preview, the presenter and the animated exports all ask a
 * `PlaybackRenderer` "what is on screen `t` seconds in?". A moment is either one page part-way through its
 * animations or two pages part-way through a transition (see core/transition.ts for the timeline maths).
 */
import { pageDuration } from "@/core/animation";
import { frameAt, getTransitionPreset, transitionFrame, type Timeline, type TransitionLayer } from "@/core/transition";
import type { AnimDirection, Design, Page } from "@/core/types";
import { renderPage } from "./renderPage";

type Ctx = CanvasRenderingContext2D;
type Source = HTMLCanvasElement | OffscreenCanvas;

function drawLayer(ctx: Ctx, src: Source, layer: TransitionLayer, w: number, h: number): void {
  if (layer.opacity <= 0.001) return;
  ctx.save();
  ctx.globalAlpha = layer.opacity;
  ctx.translate(w / 2 + layer.dx * w, h / 2 + layer.dy * h);
  if (layer.scale !== 1) ctx.scale(layer.scale, layer.scale);
  ctx.translate(-w / 2, -h / 2);
  if (layer.clip) {
    ctx.beginPath();
    ctx.rect(layer.clip.x0 * w, layer.clip.y0 * h, (layer.clip.x1 - layer.clip.x0) * w, (layer.clip.y1 - layer.clip.y0) * h);
    ctx.clip();
  }
  ctx.drawImage(src, 0, 0, w, h);
  ctx.restore();
}

/** Composites the old page (`from`) and the new one (`to`) onto `ctx`, `p` of the way through a transition (0..1). */
export function drawTransition(ctx: Ctx, from: Source, to: Source, kind: string, p: number, direction: AnimDirection | undefined): void {
  const w = ctx.canvas.width;
  const h = ctx.canvas.height;
  const frame = transitionFrame(kind, p, direction ?? getTransitionPreset(kind)?.defaultDirection ?? "left");
  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.fillStyle = "#000";
  ctx.fillRect(0, 0, w, h);
  drawLayer(ctx, from, frame.from, w, h);
  drawLayer(ctx, to, frame.to, w, h);
  ctx.restore();
}

function scratch(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  return c;
}

/**
 * Renders frames of a design's playback onto any canvas. Pages are painted at the target canvas's own
 * resolution; transitions use two scratch canvases that are created once and reused.
 */
export class PlaybackRenderer {
  private a: HTMLCanvasElement | null = null;
  private b: HTMLCanvasElement | null = null;

  constructor(private readonly design: Pick<Design, "width" | "height" | "pages">) {}

  private pair(w: number, h: number): [HTMLCanvasElement, HTMLCanvasElement] {
    if (!this.a || this.a.width !== w || this.a.height !== h) this.a = scratch(w, h);
    if (!this.b || this.b.width !== w || this.b.height !== h) this.b = scratch(w, h);
    return [this.a, this.b];
  }

  /** One page `time` seconds into its own animations. True when every image and font was ready. */
  renderPageAt(ctx: Ctx, page: Page, time: number, opts: { transparent?: boolean } = {}): boolean {
    const scale = ctx.canvas.width / this.design.width;
    return renderPage(ctx, this.design, page, { scale, transparent: opts.transparent, animation: { time } });
  }

  /** The frame at `t` seconds of the whole playback described by `timeline`. */
  renderAt(ctx: Ctx, timeline: Timeline, t: number): boolean {
    const frame = frameAt(timeline, t);
    const pages = this.design.pages;
    if (frame.kind === "page") return this.renderPageAt(ctx, pages[frame.page], frame.time);
    const [a, b] = this.pair(ctx.canvas.width, ctx.canvas.height);
    const actx = a.getContext("2d")!;
    const bctx = b.getContext("2d")!;
    // the old page is frozen at its last moment, the new one at its first
    const ready1 = this.renderPageAt(actx, pages[frame.from], pageDuration(pages[frame.from]));
    const ready2 = this.renderPageAt(bctx, pages[frame.to], 0);
    const tr = pages[frame.to].transition;
    drawTransition(ctx, a, b, tr?.kind ?? "dissolve", frame.progress, tr?.direction);
    return ready1 && ready2;
  }

  /** Frees the two transition canvases at once instead of waiting for garbage collection (a 1080p pair is 16 MB). */
  dispose(): void {
    for (const c of [this.a, this.b]) {
      if (!c) continue;
      c.width = 0;
      c.height = 0;
    }
    this.a = null;
    this.b = null;
  }
}
