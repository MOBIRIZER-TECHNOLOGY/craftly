import { memo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_CLIP_START, clipLoopFrom, clipPlayingLength, clipStartAt } from "@/core/animation";
import { useEditor } from "@/core/store";
import type { DesignElement, Page, VideoElement } from "@/core/types";
import { m } from "@/i18n";
import { MIN_TRIM, clipClock } from "@/render/videos";
import { cx } from "@/ui";
import { tileMoments, useClipFrames } from "./clipFrames";

/** Top of the first row of clips, pixels from the top of the timeline's lane: under the page blocks (4 + 54 + 4). */
export const CLIP_TOP_PX = 62;
/** Height of a clip's row and the gap above it, in pixels. */
export const ROW_H = 26;
export const ROW_GAP = 4;
/** The most rows of clips the timeline makes room for (clips that play at once past these share a row: clipLanes). */
export const MAX_ROWS = 3;
/** About this many pixels of a bar for each picture of the clip. */
const TILE_W = 44;

/** The clips of a page, groups included, in paint order (the one at the back first). */
export function pageClips(page: Pick<Page, "elements">): VideoElement[] {
  const out: VideoElement[] = [];
  const visit = (el: DesignElement) => {
    if (el.hidden) return;
    if (el.type === "video") out.push(el);
    else if (el.type === "group") el.children.forEach(visit);
  };
  page.elements.forEach(visit);
  return out;
}

/**
 * Seconds of its page from which to which a clip's bar runs: from when it starts to when it stops, or to the end of the page for a
 * clip that plays over and over; nothing of it past the page's end.
 */
export function clipSpan(el: VideoElement, pageLength: number): { start: number; end: number } {
  const start = Math.min(clipStartAt(el), pageLength);
  return { start, end: el.once ? Math.min(pageLength, start + clipPlayingLength(el)) : pageLength };
}

/**
 * The row of each of `spans` (by its id) and how many rows they take: in the order they start (the order given between two that
 * start together), each on the first row that is free by then, so that what plays one after another shares a row and only what
 * plays at once needs a row of its own. Past MAX_ROWS one goes on the row that is free soonest. For clips and for sounds alike.
 */
export function packRows(spans: readonly { id: string; start: number; end: number }[]): { rows: number; row: Record<string, number> } {
  const order = spans.map((s, i) => ({ ...s, i })).sort((a, b) => a.start - b.start || a.i - b.i);
  const ends: number[] = [];
  const row: Record<string, number> = {};
  for (const s of order) {
    let r = ends.findIndex((end) => end <= s.start + 1e-6);
    if (r < 0 && ends.length < MAX_ROWS) r = ends.length;
    if (r < 0) r = ends.indexOf(Math.min(...ends));
    ends[r] = Math.max(ends[r] ?? 0, s.end);
    row[s.id] = r;
  }
  return { rows: ends.length, row };
}

/** The row of each clip of a page and how many rows they take (packRows), its page lasting `pageLength` seconds. */
export const clipLanes = (page: Pick<Page, "elements">, pageLength: number): { rows: number; row: Record<string, number> } =>
  packRows(pageClips(page).map((el) => ({ id: el.id, ...clipSpan(el, pageLength) })));

/** How many rows of clips the timeline of `pages` needs (0 without a clip); `lengths` are how long each page lasts (without, every clip counts as playing to the end). */
export const clipRows = (pages: readonly Pick<Page, "elements">[], lengths: readonly number[] = []): number =>
  Math.max(0, ...pages.map((p, i) => clipLanes(p, lengths[i] ?? Infinity).rows));

const r3 = (s: number) => Math.round(s * 1000) / 1000;

/**
 * What a drag of `dt` seconds of the page does to a clip, from how it was at the press:
 *   - "start": its trimmed start, keeping what plays where it was (the bar's left end moves, the rest of it stays);
 *   - "end": its trimmed end;
 *   - "move": when it starts on its page.
 */
export function dragClip(el: Pick<VideoElement, "trimStart" | "trimEnd" | "duration" | "speed" | "startAt">, part: "start" | "end" | "move", dt: number): Partial<VideoElement> {
  const speed = el.speed > 0 ? el.speed : 1;
  const start = clipStartAt(el);
  if (part === "move") return { startAt: r3(Math.min(MAX_CLIP_START, Math.max(0, start + dt))) };
  if (part === "end") return { trimEnd: r3(Math.min(el.duration, Math.max(el.trimStart + MIN_TRIM, el.trimEnd + dt * speed))) };
  // the left end: never before the clip's beginning nor before its page's, never closer than MIN_TRIM to its end
  const lo = Math.max(-el.trimStart / speed, -start);
  const hi = (el.trimEnd - MIN_TRIM - el.trimStart) / speed;
  const d = Math.min(hi, Math.max(lo, dt));
  return { trimStart: r3(Math.max(0, el.trimStart + d * speed)), startAt: r3(start + d) };
}

interface ClipBarProps {
  el: VideoElement;
  page: Page;
  /** second of the whole timeline at which its page's own time begins, and how far from there its bar may reach (the end of its page, or of the last page it runs on under) */
  pageStart: number;
  pageLength: number;
  row: number;
  /** top of the first row, pixels from the top of the lane */
  top: number;
  pps: number;
  pad: number;
  selected: boolean;
  readOnly: boolean;
}

/**
 * One clip under its page: a bar from when it starts to when it stops (to the end of its page for a clip that plays over and over,
 * with a mark where each play begins again), filled with pictures of it. Its ends trim it, its middle moves when it starts, a click
 * selects it on the page; each part answers the arrow keys too.
 */
export const ClipBar = memo(function ClipBar({ el, page, pageStart, pageLength, row, top, pps, pad, selected, readOnly }: ClipBarProps) {
  const words = m.editorChrome.timeline;
  const start = clipStartAt(el);
  const span = clipSpan(el, pageLength);
  const once = clipPlayingLength(el);
  const shown = Math.max(0, span.end - span.start);
  const left = pad + (pageStart + span.start) * pps;
  const width = Math.max(6, shown * pps);
  const tiles = tileMoments(el.trimStart, el.trimEnd, Math.min(10, Math.max(1, Math.round(Math.min(width, once * pps) / TILE_W))));
  const pictures = useClipFrames(el.src, tiles);
  const drag = useRef<{ part: "start" | "end" | "move"; x: number; from: VideoElement; pps: number; moved: boolean } | null>(null);
  const actions = useEditor.getState().actions;
  const name = el.name || words.clip;

  const apply = (part: "start" | "end" | "move", from: VideoElement, dt: number) =>
    actions.updateElementsOnPage(page.id, [el.id], (e) => Object.assign(e, dragClip(from, part, dt)), { coalesce: `clip-${part}:${el.id}` });

  const select = () => {
    if (useEditor.getState().activePageId !== page.id) actions.setActivePage(page.id);
    actions.select([el.id]);
  };

  const down = (part: "start" | "end" | "move") => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { part, x: e.clientX, from: el, pps, moved: false };
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (!d.moved && Math.abs(dx) < 3) return;
    d.moved = true;
    apply(d.part, d.from, dx / d.pps);
  };
  const up = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    // a press that did not move is a click: the clip is chosen on its page
    if (!d.moved) select();
  };
  const key = (part: "start" | "end" | "move") => (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? 0.01 : 0.1;
    // the clip as it is now in the design: keys can come faster than the timeline is drawn again
    const now = (pageClips(useEditor.getState().design?.pages.find((p) => p.id === page.id) ?? page).find((c) => c.id === el.id) ?? el) as VideoElement;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") apply(part, now, step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") apply(part, now, -step);
    else if (e.key === "Enter" && part === "move") select();
    else return;
    e.preventDefault();
    e.stopPropagation();
  };

  const handlers = (part: "start" | "end" | "move") => ({
    onPointerDown: down(part),
    onPointerMove: move,
    onPointerUp: up,
    onPointerCancel: up,
    onKeyDown: key(part),
  });
  const playLength = Math.max(0.1, once);
  // a loop carried on from a split page begins part-way through its first play: that play starts before the bar does
  const phase = clipLoopFrom(el);
  const repeats = el.once ? 0 : Math.max(0, Math.ceil((shown + phase) / playLength) - 1);

  return (
    <div className={cx("cf-tl__clip", selected && "is-selected")} style={{ left, width, top: top + row * (ROW_H + ROW_GAP), height: ROW_H }}>
      <div className="cf-tl__frames" aria-hidden="true">
        {Array.from({ length: repeats + 1 }, (_, n) => (
          <div key={n} className="cf-tl__play" style={{ left: (n * playLength - phase) * pps, width: Math.min(playLength, shown + phase - n * playLength) * pps }}>
            {pictures.map((src, i) => (src ? <img key={i} src={src} alt="" draggable={false} /> : <span key={i} />))}
          </div>
        ))}
      </div>
      {readOnly ? (
        // one who may only look can still find the clip on its page
        <button type="button" className="cf-tl__clipbody" title={name} onClick={select}>
          <span className="cf-tl__clipname">{name}</span>
        </button>
      ) : (
        <div
          className="cf-tl__clipbody"
          role="slider"
          tabIndex={0}
          aria-label={words.clipStart(name)}
          aria-valuemin={0}
          aria-valuemax={MAX_CLIP_START}
          aria-valuenow={Math.round(start * 10) / 10}
          aria-valuetext={words.clipAt(clipClock(start, true), clipClock(once, true))}
          title={words.clipTip}
          {...handlers("move")}
        >
          <span className="cf-tl__clipname">{name}</span>
        </div>
      )}
      {readOnly ? null : (
        <>
          <div
            className="cf-tl__trim cf-tl__trim--start"
            role="slider"
            tabIndex={0}
            aria-label={words.trimStart(name)}
            aria-valuemin={0}
            aria-valuemax={Math.round(el.trimEnd * 100) / 100}
            aria-valuenow={Math.round(el.trimStart * 100) / 100}
            aria-valuetext={clipClock(el.trimStart, true)}
            {...handlers("start")}
          />
          <div
            className="cf-tl__trim cf-tl__trim--end"
            role="slider"
            tabIndex={0}
            aria-label={words.trimEnd(name)}
            aria-valuemin={Math.round(el.trimStart * 100) / 100}
            aria-valuemax={Math.round(el.duration * 100) / 100}
            aria-valuenow={Math.round(el.trimEnd * 100) / 100}
            aria-valuetext={clipClock(el.trimEnd, true)}
            {...handlers("end")}
          />
        </>
      )}
    </div>
  );
});
