import { memo, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { PageThumb } from "@/components/PageThumb";
import { MAX_PAGE_DURATION, MIN_PAGE_DURATION, pageDuration } from "@/core/animation";
import { useEditor } from "@/core/store";
import { buildTimeline, type TimelineSegment } from "@/core/transition";
import type { Design, Page } from "@/core/types";
import { m } from "@/i18n";
import { clipClock } from "@/render/videos";
import { Button, IconButton, IconPause, IconPlay, IconSplit, cx } from "@/ui";
import { TransitionJoin } from "./TransitionJoin";
import { splitMoment } from "@/core/splitPage";
import { runEnd } from "@/core/carriedClips";
import { CLIP_TOP_PX, ClipBar, ROW_GAP, ROW_H, VISIBLE_ROWS, clipSpan, packRows, pageClips } from "./ClipBar";
import { pauseTimeline, placeAt, playTimeline, pxPerSecond, seekTimeline, useTimeline } from "./timelineStore";
import { TrackBar, TrackControls, soundLanes } from "./TrackBar";
import "./timeline.css";

/** Room left and right of the blocks, in pixels. */
const PAD = 16;
/** Top of the first row of clips, pixels from the top of the lane (under the page blocks). */
const CLIP_TOP = CLIP_TOP_PX;
/** Height of a page's picture in its block. */
const THUMB_H = 40;
/** A step of the arrow keys on the playhead and on a page's length, in seconds (Shift: a tenth of it). */
const KEY_STEP = 1;

const clock = (seconds: number) => clipClock(seconds, true);

interface BlockProps {
  design: Pick<Design, "width" | "height">;
  page: Page;
  index: number;
  seg: TimelineSegment;
  pps: number;
  active: boolean;
  readOnly: boolean;
}

/** One page: its picture, its number and how long it lasts, and a handle on its end that sets that length. */
const Block = memo(function Block({ design, page, index, seg, pps, active, readOnly }: BlockProps) {
  const length = seg.end - seg.playStart;
  const width = Math.max(4, length * pps);
  const thumbW = Math.max(16, Math.round((THUMB_H * design.width) / design.height));
  // the scale is the one of the press: the lane fits itself to the new total as the page grows, which would run ahead of the pointer
  const drag = useRef<{ x: number; length: number; pps: number } | null>(null);
  const actions = useEditor.getState().actions;
  const words = m.editorChrome.timeline;

  /**
   * A page that follows a long clip can last longer than a length set by hand may (MAX_PAGE_DURATION): asking it to grow would
   * cut it to that, so it is left as it is until it is made shorter than that.
   */
  const setLength = (seconds: number, from: number) => {
    if (from > MAX_PAGE_DURATION && seconds >= from) return;
    actions.setPageDuration(seconds, "page", page.id);
  };
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (readOnly || e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { x: e.clientX, length, pps };
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    setLength(d.length + (e.clientX - d.x) / d.pps, d.length);
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP / 10 : KEY_STEP;
    // read from the design, not from this render: keys can come faster than the timeline is drawn again
    const now = pageDuration(useEditor.getState().design?.pages.find((p) => p.id === page.id) ?? page);
    if (e.key === "ArrowRight" || e.key === "ArrowUp") setLength(now + step, now);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") setLength(now - step, now);
    else if (e.key === "Home") setLength(MIN_PAGE_DURATION, now);
    else if (e.key === "End") setLength(Math.max(MAX_PAGE_DURATION, now), now);
    else return;
    e.preventDefault();
  };

  return (
    <>
      {seg.transition > 0 ? (
        <div className="cf-tl__trans" style={{ left: PAD + seg.start * pps, width: seg.transition * pps }} aria-hidden="true" title={words.transition(clock(seg.transition))} />
      ) : null}
      <div className={cx("cf-tl__block", active && "is-active")} style={{ left: PAD + seg.playStart * pps, width }} aria-hidden="true">
        <div className="cf-tl__pic" style={{ width: thumbW }}>
          <PageThumb design={design} page={page} width={thumbW} sharp={false} />
        </div>
        <span className="cf-tl__label">
          <span className="cf-tl__num">{index + 1}</span>
          <span className="cf-tl__len">{words.seconds(length)}</span>
        </span>
      </div>
      {readOnly ? null : (
        <div
          className="cf-tl__handle"
          style={{ left: PAD + seg.end * pps }}
          role="slider"
          tabIndex={0}
          aria-label={words.pageLength(index + 1)}
          aria-valuemin={MIN_PAGE_DURATION}
          aria-valuemax={Math.max(MAX_PAGE_DURATION, length)}
          aria-valuenow={Math.round(length * 10) / 10}
          aria-valuetext={words.seconds(length)}
          title={words.handleTip}
          onPointerDown={onDown}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerCancel={onUp}
          onKeyDown={onKey}
          // a double click gives the page back the length it had by itself (its longest clip, or 5 s)
          onDoubleClick={() => actions.resetPageDuration("page", page.id)}
        />
      )}
    </>
  );
});

/**
 * The timeline under the page, in place of the page strip: a block for every page as long as the page lasts, the transitions
 * between them, a playhead to drag or move with the arrow keys, and Play, which plays the whole design from the playhead with
 * the clips' sound. The end of a block can be dragged to change how long its page lasts.
 */
export function Timeline() {
  const design = useEditor((s) => s.design);
  const activePageId = useEditor((s) => s.activePageId);
  const readOnly = useEditor((s) => s.mode === "view");
  const selection = useEditor((s) => s.selection);
  const time = useTimeline((s) => s.time);
  const playing = useTimeline((s) => s.playing);
  const chosenTrack = useTimeline((s) => s.track);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800);
  const scrub = useRef(false);
  const words = m.editorChrome.timeline;

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth || 800);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pages = design?.pages ?? [];
  const timeline = buildTimeline(pages);
  const total = timeline.total;
  const pps = pxPerSecond(total, width - PAD * 2);
  const at = Math.min(time, total);
  const place = placeAt(timeline, at);
  // every clip's bar, from its start to the end of the last page it runs under (core/carriedClips.ts), on rows shared by the whole
  // timeline: a clip that runs on can meet the clips of the pages after its own
  const reach = timeline.segments.map((_seg, i) => Object.fromEntries(pageClips(pages[i]).map((el) => [el.id, runEnd(pages, i, el, timeline)])));
  const lanes = packRows(
    timeline.segments.flatMap((seg, i) =>
      pageClips(pages[i]).map((el) => {
        const span = clipSpan(el, reach[i][el.id]);
        return { id: el.id, start: seg.playStart + span.start, end: seg.playStart + span.end };
      }),
    ),
  );
  const clipRowCount = lanes.rows;
  // the sounds of the design: rows of their own under the clips
  const tracks = design?.audio ?? [];
  const sounds = soundLanes(tracks, total);
  const rows = clipRowCount + sounds.rows;
  const chosen = tracks.find((t) => t.id === chosenTrack);
  const here = pages[place.page];
  const canSplit = !readOnly && !playing && !!here && !place.waiting && splitMoment(here, place.time) !== null;
  const split = () => {
    if (canSplit) useEditor.getState().actions.splitPage(here.id, place.time);
  };

  // while it plays, the playhead stays in view
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !playing) return;
    const x = PAD + at * pps;
    if (x < el.scrollLeft || x > el.scrollLeft + el.clientWidth - PAD) el.scrollLeft = Math.max(0, x - PAD * 2);
  }, [at, pps, playing]);

  if (!design) return null;

  const timeAt = (clientX: number, lane: HTMLElement) => (clientX - lane.getBoundingClientRect().left - PAD) / pps;
  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    scrub.current = true;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    e.currentTarget.focus({ preventScroll: true });
    seekTimeline(timeAt(e.clientX, e.currentTarget));
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (scrub.current) seekTimeline(timeAt(e.clientX, e.currentTarget));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    scrub.current = false;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.shiftKey ? KEY_STEP / 10 : KEY_STEP;
    if (e.key === "ArrowRight") seekTimeline(at + step);
    else if (e.key === "ArrowLeft") seekTimeline(at - step);
    else if (e.key === "Home") seekTimeline(0);
    else if (e.key === "End") seekTimeline(total);
    else if (e.key === "PageDown") seekTimeline(timeline.segments[place.page + 1]?.playStart ?? total);
    else if (e.key === "PageUp") {
      // to the start of this page, or of the one before when the playhead is already there
      const start = timeline.segments[place.page]?.playStart ?? 0;
      seekTimeline(at - start > 0.2 ? start : (timeline.segments[place.page - 1]?.playStart ?? 0));
    } else if (e.key === " " || e.key === "k") (playing ? pauseTimeline : playTimeline)();
    else if (e.key === "s" && !e.ctrlKey && !e.metaKey && !e.altKey) split();
    else return;
    e.preventDefault();
    // the editor's own keys (Space for the hand, arrows to move the selection) are not for the page while the playhead has them
    e.stopPropagation();
  };

  const laneWidth = PAD * 2 + total * pps;
  return (
    <section className="cf-tl" aria-label={words.region} style={rows ? { height: `calc(var(--strip-h) + ${Math.min(rows, VISIBLE_ROWS) * (ROW_H + ROW_GAP)}px)` } : undefined}>
      <div className="cf-tl__bar">
        <IconButton
          size="sm"
          label={playing ? words.pause : words.play}
          icon={playing ? <IconPause aria-hidden="true" /> : <IconPlay aria-hidden="true" />}
          onClick={() => (playing ? pauseTimeline() : playTimeline())}
        />
        <span className="cf-tl__clock" aria-hidden="true">
          {clock(at)} / {clock(total)}
        </span>
        {readOnly ? null : (
          <Button size="sm" variant="ghost" icon={<IconSplit aria-hidden="true" />} disabled={!canSplit} onClick={split} title={words.splitTip} aria-keyshortcuts="S">
            {words.split}
          </Button>
        )}
        {chosen && !readOnly ? <TrackControls track={chosen} /> : null}
      </div>
      <div ref={scrollRef} className="cf-tl__scroll">
        {/* more rows than the band shows: the lane is as tall as all of them, and scrolls */}
        <div
          className="cf-tl__lane"
          style={{ width: Math.max(laneWidth, width), ...(rows > VISIBLE_ROWS ? { height: `calc(100% + ${(rows - VISIBLE_ROWS) * (ROW_H + ROW_GAP)}px)` } : {}) }}
        >
          <div
            className="cf-tl__track"
            role="slider"
            tabIndex={0}
            aria-label={words.playhead}
            aria-valuemin={0}
            aria-valuemax={Math.round(total * 10) / 10}
            aria-valuenow={Math.round(at * 10) / 10}
            aria-valuetext={words.playheadAt(clock(at), clock(total), place.page + 1, pages.length)}
            aria-keyshortcuts="Space ArrowLeft ArrowRight Home End PageUp PageDown S"
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerCancel={onUp}
            onKeyDown={onKey}
          />
          {timeline.segments.map((seg, i) => (
            <Block key={pages[i].id} design={design} page={pages[i]} index={i} seg={seg} pps={pps} active={pages[i].id === activePageId} readOnly={readOnly} />
          ))}
          {timeline.segments.map((seg, i) =>
            i > 0 ? <TransitionJoin key={`join-${pages[i].id}`} page={pages[i]} index={i} seg={seg} x={PAD + (seg.start + seg.transition / 2) * pps} readOnly={readOnly} /> : null,
          )}
          {timeline.segments.map((seg, i) =>
            pageClips(pages[i]).map((el) => (
              <ClipBar
                key={el.id}
                el={el}
                page={pages[i]}
                pageStart={seg.playStart}
                pageLength={reach[i][el.id] ?? seg.end - seg.playStart}
                row={lanes.row[el.id] ?? 0}
                top={CLIP_TOP}
                pps={pps}
                pad={PAD}
                selected={selection.includes(el.id)}
                readOnly={readOnly}
              />
            )),
          )}
          {tracks.map((t) => (
            <TrackBar
              key={t.id}
              track={t}
              total={total}
              row={sounds.row[t.id] ?? 0}
              top={CLIP_TOP + clipRowCount * (ROW_H + ROW_GAP)}
              pps={pps}
              pad={PAD}
              chosen={t.id === chosenTrack}
              readOnly={readOnly}
            />
          ))}
          <div className="cf-tl__head" style={{ transform: `translateX(${PAD + at * pps}px)` }} aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}
