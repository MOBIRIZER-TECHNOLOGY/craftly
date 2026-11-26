/**
 * The sounds of the design on the timeline: a row (or a few) under the clips, with a bar for each sound from when it starts to when it
 * stops (to the end of the design for one that plays over and over, each new play marked). Its ends trim it, its middle moves when
 * it starts, a click chooses it; a chosen sound's controls (volume and fades, over and over, remove) show in the timeline's bar.
 */
import { memo, useRef, type KeyboardEvent, type PointerEvent } from "react";
import { MAX_TRACK_FADE, MAX_TRACK_START, MIN_TRACK_TRIM, trackFades, trackLength, trackSpan, trackStartAt, trackVolume } from "@/core/audioTracks";
import { useEditor } from "@/core/store";
import type { AudioTrack } from "@/core/types";
import { m } from "@/i18n";
import { clipClock } from "@/render/videos";
import { Button, IconAudio, IconButton, IconTrash, cx, toast } from "@/ui";
import { PopoverButton, SliderField } from "../toolbar/kit";
import { MAX_ROWS, ROW_GAP, ROW_H, packRows } from "./ClipBar";
import { chooseTrack, useTimeline } from "./timelineStore";

const r3 = (s: number) => Math.round(s * 1000) / 1000;

/** The row of each sound of the design and how many rows they take, the design lasting `total` seconds. */
export const soundLanes = (tracks: readonly AudioTrack[], total: number): { rows: number; row: Record<string, number> } =>
  packRows(tracks.map((t) => ({ id: t.id, ...trackSpan(t, total) })));

export { MAX_ROWS as MAX_SOUND_ROWS };

/**
 * What a drag of `dt` seconds of the design does to a sound, from how it was at the press:
 *   - "start": its trimmed start, keeping what plays where it was (the bar's left end moves, the rest of it stays);
 *   - "end": its trimmed end;
 *   - "move": when it starts in the design.
 */
export function dragTrack(t: Pick<AudioTrack, "trimStart" | "trimEnd" | "duration" | "startAt">, part: "start" | "end" | "move", dt: number): Partial<AudioTrack> {
  const start = trackStartAt(t);
  if (part === "move") return { startAt: r3(Math.min(MAX_TRACK_START, Math.max(0, start + dt))) };
  if (part === "end") return { trimEnd: r3(Math.min(t.duration, Math.max(t.trimStart + MIN_TRACK_TRIM, t.trimEnd + dt))) };
  // the left end: never before the sound's beginning nor before the design's, never closer than MIN_TRACK_TRIM to its end
  const d = Math.min(t.trimEnd - MIN_TRACK_TRIM - t.trimStart, Math.max(-t.trimStart, -start, dt));
  return { trimStart: r3(Math.max(0, t.trimStart + d)), startAt: r3(start + d) };
}

/** The sound of the design with this id as it is now (keys can come faster than the timeline is drawn again). */
const trackNow = (id: string): AudioTrack | undefined => useEditor.getState().design?.audio?.find((t) => t.id === id);

interface TrackBarProps {
  track: AudioTrack;
  /** how long the design lasts, in seconds */
  total: number;
  row: number;
  /** top of the first row of sounds, pixels from the top of the lane */
  top: number;
  pps: number;
  pad: number;
  chosen: boolean;
  readOnly: boolean;
}

export const TrackBar = memo(function TrackBar({ track, total, row, top, pps, pad, chosen, readOnly }: TrackBarProps) {
  const words = m.editorChrome.timeline;
  const span = trackSpan(track, total);
  const once = trackLength(track);
  const shown = Math.max(0, span.end - span.start);
  const left = pad + span.start * pps;
  const width = Math.max(6, shown * pps);
  const drag = useRef<{ part: "start" | "end" | "move"; x: number; from: AudioTrack; pps: number; moved: boolean } | null>(null);
  const name = track.name || words.sound;
  const actions = useEditor.getState().actions;

  const apply = (part: "start" | "end" | "move", from: AudioTrack, dt: number) =>
    actions.updateAudioTrack(track.id, (t) => Object.assign(t, dragTrack(from, part, dt)), { coalesce: `track-${part}:${track.id}` });

  const down = (part: "start" | "end" | "move") => (e: PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    drag.current = { part, x: e.clientX, from: track, pps, moved: false };
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
    // a press that did not move is a click: the sound is chosen; a drag chooses it too
    chooseTrack(track.id);
  };
  const key = (part: "start" | "end" | "move") => (e: KeyboardEvent<HTMLDivElement>) => {
    const now = trackNow(track.id) ?? track;
    const step = e.shiftKey ? 0.01 : 0.1;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") apply(part, now, step);
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") apply(part, now, -step);
    else if (e.key === "Enter" && part === "move") chooseTrack(track.id);
    else if ((e.key === "Delete" || e.key === "Backspace") && part === "move") removeTrack(track.id);
    else if (e.key === "Escape" && useTimeline.getState().track === track.id) chooseTrack(null);
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
  const repeats = track.loop ? Math.max(0, Math.ceil(shown / playLength) - 1) : 0;

  return (
    <div className={cx("cf-tl__clip cf-tl__sound", chosen && "is-selected")} style={{ left, width, top: top + row * (ROW_H + ROW_GAP), height: ROW_H }}>
      <div className="cf-tl__frames" aria-hidden="true">
        {Array.from({ length: repeats + 1 }, (_, n) => (
          <div key={n} className="cf-tl__play cf-tl__wave" style={{ left: n * playLength * pps, width: Math.min(playLength, shown - n * playLength) * pps }} />
        ))}
      </div>
      {readOnly ? (
        <div className="cf-tl__clipbody" title={name}>
          <span className="cf-tl__clipname">{name}</span>
        </div>
      ) : (
        <>
          <div
            className="cf-tl__clipbody"
            role="slider"
            tabIndex={0}
            aria-label={words.soundStart(name)}
            aria-valuemin={0}
            aria-valuemax={MAX_TRACK_START}
            aria-valuenow={Math.round(trackStartAt(track) * 10) / 10}
            aria-valuetext={words.soundAt(clipClock(trackStartAt(track), true), clipClock(once, true), !!track.loop)}
            aria-keyshortcuts="Enter Delete"
            title={words.soundTip}
            {...handlers("move")}
          >
            <IconAudio aria-hidden="true" className="cf-tl__soundicon" />
            <span className="cf-tl__clipname">{name}</span>
          </div>
          <div
            className="cf-tl__trim cf-tl__trim--start"
            role="slider"
            tabIndex={0}
            aria-label={words.trimStart(name)}
            aria-valuemin={0}
            aria-valuemax={Math.round(track.trimEnd * 100) / 100}
            aria-valuenow={Math.round(track.trimStart * 100) / 100}
            aria-valuetext={clipClock(track.trimStart, true)}
            {...handlers("start")}
          />
          <div
            className="cf-tl__trim cf-tl__trim--end"
            role="slider"
            tabIndex={0}
            aria-label={words.trimEnd(name)}
            aria-valuemin={Math.round(track.trimStart * 100) / 100}
            aria-valuemax={Math.round(track.duration * 100) / 100}
            aria-valuenow={Math.round(track.trimEnd * 100) / 100}
            aria-valuetext={clipClock(track.trimEnd, true)}
            {...handlers("end")}
          />
        </>
      )}
    </div>
  );
});

/** Takes a sound out of the design (one step of undo), and says so. */
function removeTrack(id: string): void {
  useEditor.getState().actions.removeAudioTrack(id);
  chooseTrack(null);
  toast.info(m.editorChrome.timeline.soundRemoved);
}

/** The controls of the chosen sound, in the timeline's bar: its name, volume and fades, over and over, remove, done. */
export function TrackControls({ track }: { track: AudioTrack }) {
  const words = m.editorChrome.timeline;
  const actions = useEditor.getState().actions;
  const { fadeIn, fadeOut } = trackFades(track);
  const set = (change: (t: AudioTrack) => void, tag: string) => actions.updateAudioTrack(track.id, change, { coalesce: `track-${tag}:${track.id}` });
  const fade = (key: "fadeIn" | "fadeOut") => (v: number) =>
    set((t) => {
      const seconds = Math.min(MAX_TRACK_FADE, Math.max(0, Math.round(v * 10) / 10));
      if (seconds === 0) delete t[key];
      else t[key] = seconds;
    }, key);
  return (
    <div className="cf-tl__soundbar" role="group" aria-label={words.soundChosen(track.name || words.sound)}>
      <span className="cf-tl__soundname">{words.soundChosen(track.name || words.sound)}</span>
      <PopoverButton label={words.soundSettings} tip={words.soundSettingsTip} icon={<IconAudio />} placement="top-start">
        {() => (
          <div className="cf-tbpop__stack">
            <SliderField
              label={m.editor.videoBar.volume}
              value={Math.round(trackVolume(track) * 100)}
              min={0}
              max={100}
              step={1}
              onChange={(v) =>
                set((t) => {
                  const volume = Math.min(1, Math.max(0, v / 100));
                  if (volume === 1) delete t.volume;
                  else t.volume = volume;
                }, "volume")
              }
            />
            <SliderField label={m.editor.videoBar.fadeIn} value={Math.round(fadeIn * 10) / 10} min={0} max={MAX_TRACK_FADE} step={0.1} numberStep={0.1} onChange={fade("fadeIn")} />
            <SliderField
              label={m.editor.videoBar.fadeOut}
              value={Math.round(fadeOut * 10) / 10}
              min={0}
              max={MAX_TRACK_FADE}
              step={0.1}
              numberStep={0.1}
              onChange={fade("fadeOut")}
            />
            <p className="cf-tbpop__hint">{words.fadeHint}</p>
          </div>
        )}
      </PopoverButton>
      <Button
        size="sm"
        variant="ghost"
        aria-pressed={!!track.loop}
        className={cx(track.loop && "is-active")}
        title={words.loopTip}
        onClick={() =>
          set((t) => {
            if (t.loop) delete t.loop;
            else t.loop = true;
          }, "loop")
        }
      >
        {words.loop}
      </Button>
      <IconButton size="sm" label={words.removeSound} icon={<IconTrash aria-hidden="true" />} onClick={() => removeTrack(track.id)} />
      <Button size="sm" variant="ghost" onClick={() => chooseTrack(null)}>
        {words.soundDone}
      </Button>
    </div>
  );
}
