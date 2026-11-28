/**
 * The presenter's player. It owns the stage canvas and everything that moves on it: a page playing its animations,
 * a transition between two pages, an automatic playback of the whole design. React (PresentMode) only says which
 * page to show and listens to what the player reports; keeping the frame loop out of React means a frame costs a
 * canvas paint and nothing else.
 *
 * What is on the canvas is described by `mode`:
 *   arriving    waiting for the fonts and pictures of the page we are heading for (the old picture stays up)
 *   transition  the old page at rest and the new page at its first frame, blended by `drawTransition`
 *   page        a page the presenter is holding: a cached bitmap when nothing on it moves, else frames from its own
 *               clock - entrances run to rest, emphasis keeps going, exits never play
 *   auto        following the design's timeline: exits and transitions play, pages move on by themselves
 *   frozen      auto-play ran out of pages: its last frame stays
 */
import { pageDuration, pageHasAnimation, playsClip } from "@/core/animation";
import { carriedClips, carriedClipsSince } from "@/core/carriedClips";
import { buildTimeline, type TimelineFrame } from "@/core/transition";
import type { Design, Page, VideoElement } from "@/core/types";
import { onFontsChange } from "@/render/fonts";
import { onImagesChange } from "@/render/images";
import { drawTransition, PlaybackRenderer } from "@/render/playback";
import { preparePage, renderPage, renderPageToCanvas } from "@/render/renderPage";
import { playSoundsAt, stopSounds } from "@/render/soundTracks";
import { pauseVideos } from "@/render/videos";
import { autoplayAt, isAnimating, pageProgress, planAutoplay, planTransition, stripExits, type AutoplayPlan, type PlannedTransition } from "./playbackPlan";

const MAX_CANVAS_PX = 3840;
/** the quick fade-in that softens a cut */
const CUT_FADE_MS = 180;
/** a settled frame that is still missing a picture or font is looked at again this often, this many times (the load events usually get there first) */
const RETRY_MS = 250;
const MAX_RETRIES = 20;

const noop = (): void => undefined;

export interface PlayerHost {
  canvas: HTMLCanvasElement;
  /** the page on screen changed: a move by the presenter, or auto-play going on to the next page */
  onIndex(index: number): void;
  /** auto-play started or ran out of pages */
  onAutoplay(on: boolean): void;
  /** the page that could not be drawn; null once drawing works again */
  onFailed(pageId: string | null): void;
  /** while auto-playing: how far through its time the page on screen is, 0..1 */
  onProgress(fraction: number): void;
}

export interface PlayerView {
  design: Design | null;
  /** part of the cache key: a document change makes every cached bitmap stale */
  docVersion: number;
  /** CSS pixels the stage offers */
  stageW: number;
  stageH: number;
  reducedMotion: boolean;
}

interface Size {
  /** CSS pixels the canvas is shown at */
  cssW: number;
  cssH: number;
  /** canvas pixels */
  w: number;
  h: number;
}

interface Arriving {
  kind: "arriving";
  from: number;
  to: number;
  plan: PlannedTransition | null;
}
interface Crossing {
  kind: "transition";
  from: number;
  to: number;
  plan: PlannedTransition;
  startedAt: number;
}
interface Holding {
  kind: "page";
  /** performance.now() when the page's own clock read 0 */
  startedAt: number;
}
interface Auto {
  kind: "auto";
  plan: AutoplayPlan;
  startedAt: number;
}
interface Frozen {
  kind: "frozen";
  page: number;
  time: number;
}
type Mode = Arriving | Crossing | Holding | Auto | Frozen;

function sizeFor(design: Pick<Design, "width" | "height">, stageW: number, stageH: number): Size | null {
  if (stageW < 8 || stageH < 8) return null;
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const fit = Math.min(stageW / design.width, stageH / design.height);
  const cssW = Math.max(1, Math.floor(design.width * fit));
  const cssH = Math.max(1, Math.floor(design.height * fit));
  const w = Math.min(MAX_CANVAS_PX, Math.max(64, Math.round(cssW * dpr)));
  // the same rounding renderPageToCanvas uses, so cached bitmaps and the stage canvas always agree
  const h = Math.max(1, Math.round(design.height * (w / design.width)));
  return { cssW, cssH, w, h };
}

const sameSize = (a: Size | null, b: Size | null): boolean => !!a && !!b && a.w === b.w && a.h === b.h && a.cssW === b.cssW && a.cssH === b.cssH;

/** Hands the pixel memory back now instead of whenever the garbage collector gets to it. */
function release(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas) return;
  canvas.width = 0;
  canvas.height = 0;
}

export class PresentPlayer {
  private design: Design | null = null;
  private docVersion = -1;
  private renderer: PlaybackRenderer | null = null;
  private size: Size | null = null;
  private reduced = false;
  /** the page on screen - or the one a transition is heading for */
  private index: number;
  private mode: Mode | null = null;
  /** bumped by every navigation: work started for an older one notices and gives up */
  private token = 0;
  private raf = 0;
  private retryTimer = 0;
  private retries = 0;
  private warmHandle = 0;
  /** the last painted frame was missing a picture or a font */
  private incomplete = false;
  private failed = false;
  /** id of the page last arrived at; a cut fades in only when this changes */
  private shownId: string | null = null;
  /** auto-play: page time of the last frame, and the page that frame was a still picture of (null while things move) */
  private autoTime = 0;
  private stillPage: number | null = null;
  /** what the two transition canvases hold, so a transition frame only has to blend them */
  private prepared: string | null = null;
  private scratch: [HTMLCanvasElement | null, HTMLCanvasElement | null] = [null, null];
  private readonly cache = new Map<string, HTMLCanvasElement>();
  private readonly inflight = new Map<string, Promise<HTMLCanvasElement>>();
  private readonly ctx: CanvasRenderingContext2D | null;
  private readonly unsubscribe: Array<() => void> = [];
  private disposed = false;
  /**
   * The clock of the design's sounds (`Design.audio`), in seconds of the design's timeline: at `soundAt` (performance.now()) it was
   * `soundFrom`. Auto-play follows the design's timeline; a presenter who goes on to the next page by hand lets the sounds play on,
   * and one who goes back or jumps puts them at the start of that page. They are looked at a few times a second (`soundTimer`),
   * apart from the frames, which a still page does not have.
   */
  private soundFrom = 0;
  private soundAt = 0;
  private soundTimer = 0;
  /**
   * When the pages the presenter went through one after another, forwards, started their own clocks (performance.now(), with the
   * page's id): a clip that runs on under the next pages (core/carriedClips.ts) goes on there from where it had really got to, as the
   * sounds do, however long a page was held. Going back, jumping or auto-play starts again from the timeline's distances.
   */
  private clocks = new Map<number, { id: string; at: number }>();
  private lastClock = -1;
  /** the carried clips of the page being held, made once for its clock */
  private carriedNow: { key: string; clips: readonly VideoElement[] } | null = null;

  constructor(
    private readonly host: PlayerHost,
    index: number,
  ) {
    this.index = index;
    this.ctx = host.canvas.getContext("2d");
    // these fire for every picture the app loads anywhere, so only a frame that is known to be incomplete reacts
    const retry = () => {
      this.retries = 0;
      if (this.incomplete) this.schedule();
    };
    this.unsubscribe.push(onFontsChange(retry), onImagesChange(retry));
  }

  /* ------------------------------------------------------------------ */
  /* what React tells us                                                 */
  /* ------------------------------------------------------------------ */

  /** Design, stage size or motion preference changed. The animation clock is not touched: a resize must not replay an entrance. */
  configure(view: PlayerView): void {
    if (this.disposed) return;
    const designChanged = view.design !== this.design || view.docVersion !== this.docVersion;
    const reducedChanged = view.reducedMotion !== this.reduced;
    const before = this.size;
    if (view.design !== this.design) this.renderer = view.design ? new PlaybackRenderer(view.design, { sound: true }) : null;
    this.design = view.design;
    this.docVersion = view.docVersion;
    this.reduced = view.reducedMotion;
    this.size = view.design ? sizeFor(view.design, view.stageW, view.stageH) : null;
    if (!view.design?.pages.length || !this.size) return;

    const last = view.design.pages.length - 1;
    if (this.index > last) this.setIndex(last);
    if (!this.mode) {
      this.startSounds(this.pageStart(this.index));
      this.arrive(this.index, this.index, null);
    } else if (designChanged || reducedChanged || !sameSize(before, this.size)) {
      // the motion preference changed under a running show: hand it back to the presenter, at rest
      if (reducedChanged) this.leaveAuto();
      this.redraw();
    }
  }

  /** Move to page `to` (clamped). Takes the show back from auto-play and completes a running transition first - moves are never queued. */
  goTo(to: number): void {
    const design = this.design;
    if (this.disposed || !design || !Number.isFinite(to)) return;
    const target = Math.max(0, Math.min(design.pages.length - 1, Math.round(to)));
    if (target === this.index) return;
    if (!this.size) {
      // the stage has not been measured yet: remember where we are going, the first picture is drawn there
      this.setIndex(target);
      return;
    }
    this.leaveAuto();
    this.settle();
    const from = this.index;
    // on to the next page: the sounds play on; back, or a jump: they go to where that page starts in the design
    if (target !== from + 1) this.startSounds(this.pageStart(target));
    this.setIndex(target);
    this.arrive(from, target, this.reduced ? null : planTransition(design.pages, from, target));
  }

  step(delta: number): void {
    this.goTo(this.index + delta);
  }

  /** Auto-play on or off. Starting plays the design's timeline from the current page's time 0. */
  toggleAutoplay(): void {
    if (this.disposed || !this.design || !this.size) return;
    if (this.mode?.kind === "auto") {
      this.leaveAuto();
      this.redraw();
    } else {
      this.startAuto();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.token++;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    pauseVideos(); // the show is over: its clips (and their sound) stop at once
    window.clearInterval(this.soundTimer);
    this.soundTimer = 0;
    stopSounds();
    this.quiet();
    this.cancelWarm();
    this.unsubscribe.splice(0).forEach((off) => off());
    for (const bitmap of this.cache.values()) release(bitmap);
    this.cache.clear();
    this.inflight.clear();
    this.scratch.forEach(release);
    this.scratch = [null, null];
    release(this.host.canvas);
    this.mode = null;
    this.design = null;
    this.renderer = null;
  }

  /* ------------------------------------------------------------------ */
  /* arriving at a page                                                  */
  /* ------------------------------------------------------------------ */

  /** Where page `i` starts its own time in the design's timeline, in seconds. */
  private pageStart(i: number): number {
    return this.design ? (buildTimeline(this.design.pages).segments[i]?.playStart ?? 0) : 0;
  }

  /** The sounds' clock, in seconds of the design, now. */
  private soundTime(now: number): number {
    const mode = this.mode;
    if (mode?.kind === "auto") return mode.plan.offset + (now - mode.startedAt) / 1000;
    return this.soundFrom + (now - this.soundAt) / 1000;
  }

  /** Puts the sounds' clock at `time` seconds of the design and keeps the sounds following it, while the design has any. */
  private startSounds(time: number): void {
    this.soundFrom = time;
    this.soundAt = performance.now();
    if (!this.soundTimer && this.design?.audio?.length) this.soundTimer = window.setInterval(() => this.tickSounds(), 100);
    this.tickSounds();
  }

  private tickSounds(): void {
    const design = this.design;
    if (this.disposed || !design) return;
    if (!design.audio?.length) {
      window.clearInterval(this.soundTimer);
      this.soundTimer = 0;
      stopSounds();
      return;
    }
    playSoundsAt(design.audio, this.soundTime(performance.now()), buildTimeline(design.pages).total);
  }

  private setIndex(index: number): void {
    this.index = index;
    this.host.onIndex(index);
  }

  private live(token: number): boolean {
    return !this.disposed && token === this.token;
  }

  /** Whether the page on screen has anything moving (exits never count: a held page stays). */
  private animated(i: number): boolean {
    const page = this.design?.pages[i];
    if (!page) return false;
    // with reduced motion nothing is animated, but a clip still plays: it is what the page shows, not a way of showing it
    return this.carries(page) || (this.reduced ? page.elements.some(playsClip) : pageHasAnimation(stripExits(page)));
  }

  /** The presenter holds the page on screen, its own clock at 0 at `startedAt`. */
  private hold(startedAt: number): void {
    this.mode = { kind: "page", startedAt };
    const i = this.index;
    const id = this.design?.pages[i]?.id;
    if (!id) return;
    // the page right after the last one held goes on with them; the same page again (a transition cut short) starts its clock again
    if (this.lastClock !== i - 1 && this.lastClock !== i) this.clocks.clear();
    this.clocks.set(i, { id, at: startedAt });
    this.lastClock = i;
  }

  /** The clips that run on under page `i` while it is held, as far on as the presenter's own pace has taken them. */
  private carriedHeld(i: number): readonly VideoElement[] | undefined {
    const pages = this.design?.pages;
    const own = this.clocks.get(i);
    if (!pages || !own || own.id !== pages[i]?.id || !this.carries(pages[i])) return undefined;
    const key = `${this.docVersion}:${i}:${own.at}`;
    if (this.carriedNow?.key !== key) {
      const since = (from: number) => {
        const clock = this.clocks.get(from);
        return clock && clock.id === pages[from]?.id ? (own.at - clock.at) / 1000 : undefined;
      };
      this.carriedNow = { key, clips: carriedClipsSince(pages, i, since) };
    }
    return this.carriedNow.clips;
  }

  /** Whether a clip runs on under `page` from a page before it (core/carriedClips.ts): it plays, so the page moves. */
  private carries(page: Page): boolean {
    return carriedClips(this.design?.pages, page).length > 0;
  }

  private arrive(from: number, to: number, plan: PlannedTransition | null): void {
    const token = ++this.token;
    this.mode = { kind: "arriving", from, to, plan };
    this.incomplete = false;
    this.quiet();
    void this.load(from, to, plan, token);
  }

  /** Gets everything page `to` needs, then puts it on screen: a cut, or a transition from page `from`. */
  private async load(from: number, to: number, plan: PlannedTransition | null, token: number): Promise<void> {
    const design = this.design;
    const page = design?.pages[to];
    if (!design || !page) return;
    const moving = this.animated(to);
    let still: HTMLCanvasElement | null = null;
    try {
      if (plan) await Promise.all([preparePage(design.pages[from]), preparePage(page)]);
      else if (moving) await preparePage(page);
      else still = await this.restBitmap(page);
    } catch (err) {
      if (!this.live(token)) return;
      console.warn("Craftly: could not prepare page", page.id, err);
      this.hold(performance.now());
      this.shownId = page.id;
      this.fail(page.id);
      return;
    }
    if (!this.live(token)) return;
    this.clearFailed();
    if (plan) {
      try {
        this.beginTransition(from, to, plan);
      } catch (err) {
        // one of the two pages could not be painted. Cut to the new one instead: if it is the broken one the cut says so,
        // and if it was the page being left, the page we are going to still shows
        console.warn("Craftly: could not play the transition", err);
        this.arrive(to, to, null);
      }
      return;
    }
    try {
      this.hold(performance.now());
      if (still) this.blit(still);
      else this.frame();
      this.arrived(to, true);
    } catch (err) {
      console.warn("Craftly: could not draw page", page.id, err);
      this.fail(page.id);
    }
  }

  /** Bookkeeping for a page that has just come on screen. `cut` pages fade in quickly, as a page always has. */
  private arrived(i: number, cut: boolean): void {
    const page = this.design?.pages[i];
    if (!page) return;
    const changed = this.shownId !== page.id;
    this.shownId = page.id;
    const canvas = this.host.canvas;
    if (cut && changed && !this.reduced && typeof canvas.animate === "function") canvas.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: CUT_FADE_MS, easing: "ease-out" });
    this.evict();
    // The neighbours are painted ahead once the page has stopped moving: doing it during an entrance or a transition would cost
    // frames (the page tells us when it settles). Auto-play only fetches pictures and fonts, which is cheap.
    const kind = this.mode?.kind;
    if (kind === "auto" || (kind !== "transition" && !this.animated(i))) this.scheduleWarm();
  }

  /** Ends a transition (or an arrival still loading) where it was heading: the new page is simply there. */
  private settle(): void {
    const mode = this.mode;
    if (mode?.kind !== "transition" && mode?.kind !== "arriving") return;
    this.token++;
    this.hold(performance.now());
  }

  /** Paints the current scene again after something it depends on changed (design, size, motion preference). */
  private redraw(): void {
    const mode = this.mode;
    if (!mode) return;
    this.prepared = null;
    this.stillPage = null;
    switch (mode.kind) {
      case "arriving":
        this.arrive(mode.from, mode.to, mode.plan);
        break;
      case "transition":
        this.settle();
        this.redrawHeld();
        break;
      case "page":
        this.redrawHeld();
        break;
      default:
        this.schedule(); // auto-play and its final frame repaint from their own clock
    }
  }

  private redrawHeld(): void {
    // a page that moves keeps its clock; a still one is drawn again from a bitmap at the new size
    if (this.animated(this.index)) this.schedule();
    else this.arrive(this.index, this.index, null);
  }

  /* ------------------------------------------------------------------ */
  /* the frame loop                                                      */
  /* ------------------------------------------------------------------ */

  private readonly onFrame = (): void => {
    this.raf = 0;
    this.frame();
  };

  private schedule(): void {
    if (!this.raf && !this.disposed) this.raf = requestAnimationFrame(this.onFrame);
  }

  /** Paints the current scene now, and asks for another frame when it is still moving. */
  private frame(): void {
    const mode = this.mode;
    if (this.disposed || !this.design || !this.size || !this.ctx || !mode) return;
    const now = performance.now();
    let again = false;
    try {
      switch (mode.kind) {
        case "page":
          again = this.framePage(now, mode);
          break;
        case "transition":
          again = this.frameTransition(now, mode);
          break;
        case "auto":
          again = this.frameAuto(now, mode);
          break;
        case "frozen":
          this.frameFrozen(mode);
          break;
        default:
          break; // arriving: the picture comes when the page is ready
      }
    } catch (err) {
      // never leave the show blank without a word: say which page, stop repainting it every frame, and hand a running auto-play back
      console.warn("Craftly: could not draw page", err);
      this.leaveAuto();
      this.fail(this.design.pages[this.index]?.id ?? null);
      return;
    }
    if (again) this.schedule();
  }

  /** Notes how a frame went and says whether the loop should carry on: while things move, or to look again for something still loading. */
  private after(complete: boolean, moving: boolean): boolean {
    this.incomplete = !complete;
    if (complete) this.retries = 0;
    if (moving) return true;
    this.scheduleWarm(); // the page has settled
    if (!complete) this.retryLater();
    return false;
  }

  private retryLater(): void {
    if (this.retryTimer || this.retries >= MAX_RETRIES) return;
    this.retries++;
    this.retryTimer = window.setTimeout(() => {
      this.retryTimer = 0;
      this.schedule();
    }, RETRY_MS);
  }

  private quiet(): void {
    window.clearTimeout(this.retryTimer);
    this.retryTimer = 0;
    this.retries = 0;
  }

  /* ---- a page the presenter is holding ---- */

  private framePage(now: number, mode: Holding): boolean {
    const page = stripExits(this.design!.pages[this.index]);
    // a still page is drawn from its bitmap, not frame by frame; with reduced motion only a page with a clip is painted again
    const carries = this.carries(page);
    if (!carries && (this.reduced ? !page.elements.some(playsClip) : !pageHasAnimation(page))) return false;
    const t = Math.max(0, (now - mode.startedAt) / 1000);
    this.fit();
    const carried = this.carriedHeld(this.index);
    const complete = this.reduced ? this.paintReduced(this.ctx!, page, t, carried) : this.renderer!.renderPageAt(this.ctx!, page, t, { carried });
    this.clearFailed();
    return this.after(complete, this.reduced || carries || isAnimating(page, t));
  }

  /* ---- a transition the presenter started ---- */

  private beginTransition(from: number, to: number, plan: PlannedTransition): void {
    const pages = this.design!.pages;
    this.fit();
    const [a, b] = this.sources();
    this.paintRest(a, pages[from]);
    this.paintFirst(b, pages[to]);
    this.mode = { kind: "transition", from, to, plan, startedAt: performance.now() };
    this.arrived(to, false);
    this.frame();
  }

  private frameTransition(now: number, mode: Crossing): boolean {
    const [a, b] = this.scratch;
    if (!a || !b) return false;
    this.fit();
    const p = Math.min(1, (now - mode.startedAt) / (mode.plan.seconds * 1000));
    drawTransition(this.ctx!, a, b, mode.plan.kind, p, mode.plan.direction);
    if (p < 1) return true;
    // the new page is all there (the blend ends on its first frame): its own clock starts now
    this.hold(now);
    if (this.animated(this.index)) return true; // it warms the neighbours when it settles
    this.scheduleWarm();
    return false;
  }

  /* ---- auto-play ---- */

  private startAuto(): void {
    const design = this.design!;
    this.settle();
    this.token++; // an arrival still loading is dropped
    this.quiet();
    this.mode = { kind: "auto", plan: planAutoplay(design.pages, this.index, this.reduced), startedAt: performance.now() };
    this.clocks.clear();
    this.lastClock = -1;
    this.prepared = null;
    this.stillPage = null;
    this.autoTime = 0;
    this.incomplete = false;
    this.host.onAutoplay(true);
    this.scheduleWarm();
    this.frame();
  }

  /** Hands the show back to the presenter: whatever auto-play was showing becomes a page being held. */
  private leaveAuto(): void {
    const mode = this.mode;
    if (mode?.kind === "auto") {
      // the sounds go on from where auto-play had got to
      this.startSounds(mode.plan.offset + (performance.now() - mode.startedAt) / 1000);
      this.hold(performance.now() - this.autoTime * 1000);
      this.host.onAutoplay(false);
    } else if (mode?.kind === "frozen") {
      this.hold(performance.now() - mode.time * 1000);
    }
  }

  private frameAuto(now: number, mode: Auto): boolean {
    const pages = this.design!.pages;
    const { frame, done } = autoplayAt(mode.plan, (now - mode.startedAt) / 1000);
    if (frame.kind === "page") {
      // a page change that arrives on a page frame is a cut; one that arrives with a transition fades in by itself
      if (frame.page !== this.index) this.enter(frame.page, true);
      this.autoTime = frame.time;
      this.paintAutoPage(frame.page, frame.time);
    } else {
      if (frame.to !== this.index) this.enter(frame.to, false);
      this.autoTime = 0;
      this.paintAutoTransition(frame);
    }
    this.host.onProgress(pageProgress(frame, pages));
    if (!done) return true;
    // out of pages: stay on the final frame; the sounds end with the design
    this.startSounds(Number.POSITIVE_INFINITY);
    this.mode = frame.kind === "page" ? { kind: "frozen", page: frame.page, time: frame.time } : { kind: "frozen", page: frame.to, time: 0 };
    this.host.onAutoplay(false);
    return false;
  }

  private enter(i: number, cut: boolean): void {
    this.setIndex(i);
    this.arrived(i, cut);
  }

  private paintAutoPage(i: number, time: number): void {
    const design = this.design!;
    const page = design.pages[i];
    // a page nothing moves on is the same picture frame after frame: paint it once
    const moving = this.carries(page) || (this.reduced ? page.elements.some(playsClip) : isAnimating(page, time));
    if (!moving && this.stillPage === i && !this.incomplete) return;
    this.fit();
    const ctx = this.ctx!;
    const complete = this.reduced ? this.paintReduced(ctx, page, time) : this.renderer!.renderPageAt(ctx, page, time);
    this.stillPage = moving ? null : i;
    this.incomplete = !complete;
    this.clearFailed();
  }

  /** With reduced motion: the page at rest, with its clips playing `time` seconds in (and their sound). */
  private paintReduced(ctx: CanvasRenderingContext2D, page: Page, time: number, carried?: readonly VideoElement[]): boolean {
    const design = this.design!;
    return renderPage(ctx, design, page, { scale: ctx.canvas.width / design.width, playVideos: { sound: true, time }, carried });
  }

  private paintAutoTransition(frame: Extract<TimelineFrame, { kind: "transition" }>): void {
    const pages = this.design!.pages;
    const key = `${frame.from}>${frame.to}:${this.docVersion}:${this.size!.w}`;
    if (this.prepared !== key || !this.scratch[0] || !this.scratch[1]) {
      this.fit();
      // the old page is frozen at its last moment (exits done), the new one at its first
      const [a, b] = this.sources();
      this.renderer!.renderPageAt(a.getContext("2d")!, pages[frame.from], pageDuration(pages[frame.from]));
      this.renderer!.renderPageAt(b.getContext("2d")!, pages[frame.to], 0);
      this.prepared = key;
    }
    const tr = pages[frame.to].transition;
    drawTransition(this.ctx!, this.scratch[0]!, this.scratch[1]!, tr?.kind ?? "dissolve", frame.progress, tr?.direction);
    this.stillPage = null;
    this.clearFailed();
  }

  private frameFrozen(mode: Frozen): void {
    const design = this.design!;
    const page = design.pages[mode.page];
    if (!page) return;
    this.fit();
    const ctx = this.ctx!;
    const complete = this.reduced ? renderPage(ctx, design, page, { scale: ctx.canvas.width / design.width }) : this.renderer!.renderPageAt(ctx, page, mode.time);
    this.clearFailed();
    this.after(complete, false);
  }

  /* ------------------------------------------------------------------ */
  /* canvases                                                            */
  /* ------------------------------------------------------------------ */

  /** Sizes the stage canvas. Always directly before painting it: resizing clears it, and a cleared canvas must never be shown. */
  private fit(): void {
    const size = this.size!;
    const canvas = this.host.canvas;
    if (canvas.width !== size.w || canvas.height !== size.h) {
      canvas.width = size.w;
      canvas.height = size.h;
    }
    const w = `${size.cssW}px`;
    const h = `${size.cssH}px`;
    if (canvas.style.width !== w) canvas.style.width = w;
    if (canvas.style.height !== h) canvas.style.height = h;
  }

  private blit(src: HTMLCanvasElement): void {
    const ctx = this.ctx;
    if (!ctx || !src.width || !src.height) return;
    this.fit();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    ctx.drawImage(src, 0, 0);
  }

  /** The two canvases a transition blends, created on first use and sized like the stage. */
  private sources(): [HTMLCanvasElement, HTMLCanvasElement] {
    const { w, h } = this.size!;
    const make = (i: 0 | 1): HTMLCanvasElement => {
      const canvas = (this.scratch[i] ??= document.createElement("canvas"));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
      return canvas;
    };
    return [make(0), make(1)];
  }

  /** `page` at rest on `target` - copied from the cache when the page is there, painted when it is not. */
  private paintRest(target: HTMLCanvasElement, page: Page): boolean {
    const design = this.design!;
    const ctx = target.getContext("2d")!;
    const hit = this.cache.get(this.key(page.id));
    if (hit && hit.width === target.width && hit.height === target.height) {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, target.width, target.height);
      ctx.drawImage(hit, 0, 0);
      return true;
    }
    return renderPage(ctx, design, page, { scale: target.width / design.width });
  }

  /** `page` as the presenter first sees it: entrances at time 0, exits left out. */
  private paintFirst(target: HTMLCanvasElement, page: Page): boolean {
    const held = stripExits(page);
    if (this.reduced || !pageHasAnimation(held)) return this.paintRest(target, page);
    return this.renderer!.renderPageAt(target.getContext("2d")!, held, 0);
  }

  /* ------------------------------------------------------------------ */
  /* the bitmap cache: the page on screen and its neighbours             */
  /* ------------------------------------------------------------------ */

  private key(id: string): string {
    return `${this.docVersion}:${id}:${this.size?.w ?? 0}`;
  }

  /** A page at rest at stage resolution, rendered once (its pictures and fonts are awaited) and shared by whoever asks. */
  private restBitmap(page: Page): Promise<HTMLCanvasElement> {
    const design = this.design!;
    const key = this.key(page.id);
    const hit = this.cache.get(key);
    if (hit) return Promise.resolve(hit);
    const running = this.inflight.get(key);
    if (running) return running;
    const job = renderPageToCanvas(design, page, { width: this.size!.w }).then(
      (canvas) => {
        this.inflight.delete(key);
        if (this.disposed) {
          release(canvas);
          return canvas;
        }
        this.cache.set(key, canvas);
        this.evict(); // a result nobody wants any more (the show moved on while it rendered) goes straight back
        return canvas;
      },
      (err: unknown) => {
        this.inflight.delete(key);
        throw err;
      },
    );
    this.inflight.set(key, job);
    return job;
  }

  /** Keeps the bitmaps of the page on screen and its neighbours; frees the rest. */
  private evict(): void {
    const pages = this.design?.pages ?? [];
    const keep = new Set<string>();
    for (const n of [this.index - 1, this.index, this.index + 1]) if (pages[n]) keep.add(this.key(pages[n].id));
    for (const [key, bitmap] of this.cache) {
      if (keep.has(key)) continue;
      this.cache.delete(key);
      release(bitmap);
    }
  }

  /** Once the page is up and the main thread is quiet: get the neighbours ready, so the next move starts without waiting. */
  private scheduleWarm(): void {
    this.cancelWarm();
    const run = () => {
      this.warmHandle = 0;
      this.warm();
    };
    this.warmHandle = typeof requestIdleCallback === "function" ? requestIdleCallback(run, { timeout: 1000 }) : window.setTimeout(run, 250);
  }

  private cancelWarm(): void {
    if (!this.warmHandle) return;
    if (typeof cancelIdleCallback === "function") cancelIdleCallback(this.warmHandle);
    else window.clearTimeout(this.warmHandle);
    this.warmHandle = 0;
  }

  private warm(): void {
    const design = this.design;
    if (this.disposed || !design || !this.size) return;
    const auto = this.mode?.kind === "auto";
    for (const n of auto ? [this.index + 1, this.index + 2] : [this.index - 1, this.index + 1]) {
      const page = design.pages[n];
      if (!page) continue;
      // a page that will play is painted frame by frame: all it needs ahead of time is its pictures and fonts
      if (auto || this.animated(n)) void preparePage(page).catch(noop);
      else void this.restBitmap(page).catch(noop);
    }
    this.evict();
  }

  /* ------------------------------------------------------------------ */
  /* failures                                                            */
  /* ------------------------------------------------------------------ */

  private fail(pageId: string | null): void {
    this.failed = true;
    this.host.onFailed(pageId);
  }

  private clearFailed(): void {
    if (!this.failed) return;
    this.failed = false;
    this.host.onFailed(null);
  }
}
