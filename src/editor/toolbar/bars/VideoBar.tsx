/** The contextual toolbar of video elements: play, trim, speed, sound, and the frame they are cut to. */
import { MAX_CAPTIONS, MAX_CAPTION_LENGTH, MAX_CLIP_FADE, MAX_CLIP_START, MAX_PAGE_DURATION, clipCaptions, clipFades, clipStartAt, clipVolume } from "@/core/animation";
import { readSrt, writeSrt } from "@/core/srt";
import type { ClipCaption } from "@/core/types";
import { downloadBlob } from "@/export/download";
import { safeFileName } from "@/export/options";
import { useRef, useState } from "react";
import { VIDEO_SPEED_MAX, VIDEO_SPEED_MIN } from "@/core/factory";
import type { VideoElement } from "@/core/types";
import { startPreview, stopPreview, usePreview } from "@/editor/canvas/preview";
import { ShapePreview } from "@/editor/panels/shared/ShapePreview";
import { m } from "@/i18n";
import { clampTrim, MIN_TRIM, playingLength } from "@/render/videos";
import {
  Button,
  Checkbox,
  Divider,
  IconAudio,
  IconButton,
  IconCaptions,
  IconDownload,
  IconPlus,
  IconTrash,
  IconUpload,
  NumberField,
  TextField,
  IconCut,
  IconFrame,
  IconMuted,
  IconPause,
  IconPlay,
  IconSound,
  IconSpeed,
  type MenuEntry,
} from "@/ui";
import { AnimateButton, BorderPopover, CopyStyleButton, FlipMenu, MoreButton, MultiActions, PositionButton, RadiusPopover, TransparencyButton, type BarProps } from "../common";
import { MenuButton, PopoverButton, SliderField, TBIcon } from "../kit";
import { editElements, only, uniform } from "../selection";
import { FRAME_SHAPES } from "./ImageBar";
import "./VideoBar.css";

type Extra = { copyEnabled: boolean };

/** The speeds offered, slowest first (VIDEO_SPEED_MIN to VIDEO_SPEED_MAX). */
export const VIDEO_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].filter((x) => x >= VIDEO_SPEED_MIN && x <= VIDEO_SPEED_MAX);

export function VideoBar({ els, ids, copyEnabled }: BarProps<VideoElement> & Extra) {
  const single = els.length === 1 ? els[0] : null;
  const playing = usePreview((s) => s.preview !== null && !s.preview.paused);
  const rounded = els.every((e) => (e.mask || "rect") === "rect");
  const mask = uniform(els, (e) => e.mask || "rect");
  const speed = uniform(els, (e) => e.speed);
  const muted = els.every((e) => !!e.muted);
  // the preview plays the page from its start until the last of these clips has played once from its start time
  const longest = Math.max(1, ...els.map((e) => clipStartAt(e) + playingLength(e)));

  const frameItems = (): MenuEntry[] =>
    FRAME_SHAPES.map((shape) => ({
      id: `frame-${shape.mask}`,
      label: shape.name,
      icon: <ShapePreview kind={shape.mask} box={18} />,
      checked: !mask.mixed && mask.value === shape.mask,
      onSelect: () =>
        editElements(
          ids,
          only("video", (el) => {
            el.mask = shape.mask;
            delete el.maskPath;
          }),
        ),
    }));
  const speedItems = (): MenuEntry[] =>
    VIDEO_SPEEDS.map((x) => ({
      id: `speed-${x}`,
      label: m.editor.videoBar.speedValue(x),
      checked: !speed.mixed && speed.value === x,
      onSelect: () =>
        editElements(
          ids,
          only("video", (el) => {
            el.speed = x;
          }),
        ),
    }));

  return (
    <>
      <TBIcon
        label={playing ? m.editor.videoBar.stop : m.editor.videoBar.play}
        tip={playing ? m.editor.videoBar.stopTip : m.editor.videoBar.playTip}
        icon={playing ? <IconPause /> : <IconPlay />}
        onClick={() => (playing ? stopPreview() : startPreview(0, longest, { sound: true }))}
      />
      {single && <TrimPopover el={single} />}
      <MenuButton
        label={m.editor.videoBar.speed}
        tip={m.editor.videoBar.speedTip}
        icon={<IconSpeed />}
        text={speed.mixed || speed.value === undefined ? undefined : m.editor.videoBar.speedValue(speed.value)}
        items={speedItems}
      />
      <TBIcon
        label={m.editor.videoBar.sound}
        tip={muted ? m.editor.videoBar.soundOffTip : m.editor.videoBar.soundOnTip}
        icon={muted ? <IconMuted /> : <IconSound />}
        active={!muted}
        onClick={() =>
          editElements(
            ids,
            only("video", (el) => {
              if (muted) delete el.muted;
              else el.muted = true;
            }),
          )
        }
      />
      <AudioPopover els={els} ids={ids} muted={muted} />
      {single && <CaptionsPopover el={single} />}
      <MenuButton label={m.editor.imageBar.frameShape} tip={m.editor.videoBar.frameShapeTip} icon={<IconFrame />} items={frameItems} />
      <FlipMenu />
      {rounded && <RadiusPopover els={els} ids={ids} />}
      <BorderPopover els={els} ids={ids} />
      <TransparencyButton els={els} ids={ids} />
      <AnimateButton />
      <PositionButton />
      {ids.length > 1 && <MultiActions ids={ids} />}
      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}

/** How loud the clips play, and how long their sound takes to rise at the start of every play and fall at its end. */
function AudioPopover({ els, ids, muted }: { els: VideoElement[]; ids: string[]; muted: boolean }) {
  // several clips: the first one's values are shown, and a change sets them on all of them
  const first = els[0];
  const { fadeIn, fadeOut } = clipFades(first);
  const set = (change: (el: VideoElement) => void, tag: string) => editElements(ids, only("video", change), tag);
  return (
    <PopoverButton label={m.editor.videoBar.audio} tip={m.editor.videoBar.audioTip} icon={<IconAudio />}>
      {() => (
        <div className="cf-tbpop__stack">
          {muted ? (
            <p className="cf-tbpop__hint" role="status">
              {m.editor.videoBar.audioMuted}
            </p>
          ) : null}
          <SliderField
            label={m.editor.videoBar.volume}
            value={Math.round(clipVolume(first) * 100)}
            min={0}
            max={100}
            step={1}
            onChange={(v) =>
              set((el) => {
                const volume = Math.min(1, Math.max(0, v / 100));
                if (volume === 1) delete el.volume;
                else el.volume = volume;
              }, "volume")
            }
          />
          <SliderField
            label={m.editor.videoBar.fadeIn}
            value={Math.round(fadeIn * 10) / 10}
            min={0}
            max={MAX_CLIP_FADE}
            step={0.1}
            numberStep={0.1}
            onChange={(v) =>
              set((el) => {
                const seconds = Math.min(MAX_CLIP_FADE, Math.max(0, Math.round(v * 10) / 10));
                if (seconds === 0) delete el.fadeIn;
                else el.fadeIn = seconds;
              }, "fade-in")
            }
          />
          <SliderField
            label={m.editor.videoBar.fadeOut}
            value={Math.round(fadeOut * 10) / 10}
            min={0}
            max={MAX_CLIP_FADE}
            step={0.1}
            numberStep={0.1}
            onChange={(v) =>
              set((el) => {
                const seconds = Math.min(MAX_CLIP_FADE, Math.max(0, Math.round(v * 10) / 10));
                if (seconds === 0) delete el.fadeOut;
                else el.fadeOut = seconds;
              }, "fade-out")
            }
          />
          <p className="cf-tbpop__hint">{m.editor.videoBar.fadeHint}</p>
        </div>
      )}
    </PopoverButton>
  );
}

/** Typed captions: lines of words, each shown over the clip from one second of its play to another. */
function CaptionsPopover({ el }: { el: VideoElement }) {
  const lines: ClipCaption[] = Array.isArray(el.captions) ? el.captions : [];
  const words = m.editor.videoBar;
  const fileRef = useRef<HTMLInputElement>(null);
  /** what the last subtitle file gave: said under the buttons until the popover closes */
  const [note, setNote] = useState<string | null>(null);
  const openFile = async (file: File | undefined) => {
    if (!file) return;
    const { captions, skipped } = readSrt(await file.text());
    if (!captions.length) {
      setNote(words.captionsFileEmpty);
      return;
    }
    // the file's lines take the place of the clip's (one step of undo brings them back)
    change((list) => {
      list.splice(0, list.length, ...captions);
    });
    setNote(words.captionsFileRead(captions.length, skipped));
  };
  const saveFile = () => {
    const blob = new Blob([writeSrt(clipCaptions(el))], { type: "application/x-subrip" });
    downloadBlob(blob, `${safeFileName(el.name ?? "", words.captionsFileName)}.srt`);
  };
  const change = (fn: (captions: ClipCaption[]) => void, tag?: string) =>
    editElements(
      [el.id],
      only("video", (clip) => {
        const captions = Array.isArray(clip.captions) ? clip.captions : [];
        fn(captions);
        if (captions.length) clip.captions = captions;
        else delete clip.captions;
      }),
      tag,
    );
  const seconds = (v: number) => Math.min(MAX_CLIP_START, Math.max(0, Math.round(v * 10) / 10));
  const add = () =>
    change((captions) => {
      const last = captions[captions.length - 1];
      const start = last ? last.end : 0;
      captions.push({ start, end: start + 2, text: "" });
    });
  return (
    <PopoverButton label={words.captions} tip={words.captionsTip} icon={<IconCaptions />} panelClass="cf-tbpop--captions">
      {() => (
        <div className="cf-tbpop__stack">
          {lines.length ? (
            <>
              <div className="cf-captions__head" aria-hidden="true">
                <span>{words.captionFrom}</span>
                <span>{words.captionTo}</span>
                <span>{words.captionText}</span>
              </div>
              <ol className="cf-captions__list">
                {lines.map((line, i) => (
                  <li key={i} className="cf-captions__row">
                    <NumberField
                      size="sm"
                      aria-label={words.captionFromLabel(i + 1)}
                      value={line.start}
                      min={0}
                      max={MAX_CLIP_START}
                      step={0.1}
                      onChange={(v) =>
                        change((captions) => {
                          const c = captions[i];
                          c.start = seconds(v);
                          // the end moves out of the way of a start set past it
                          if (c.end <= c.start) c.end = seconds(c.start + 0.5);
                        }, `caption-from-${i}`)
                      }
                    />
                    <NumberField
                      size="sm"
                      aria-label={words.captionToLabel(i + 1)}
                      value={line.end}
                      min={0}
                      max={MAX_CLIP_START}
                      step={0.1}
                      onChange={(v) =>
                        change((captions) => {
                          const c = captions[i];
                          c.end = seconds(v);
                          if (c.end <= c.start) c.start = Math.max(0, seconds(c.end - 0.5));
                        }, `caption-to-${i}`)
                      }
                    />
                    <TextField
                      size="sm"
                      aria-label={words.captionTextLabel(i + 1)}
                      value={line.text}
                      maxLength={MAX_CAPTION_LENGTH}
                      onChange={(e) => {
                        const text = e.currentTarget.value;
                        change((captions) => {
                          captions[i].text = text;
                        }, `caption-text-${i}`);
                      }}
                    />
                    <IconButton
                      size="sm"
                      label={words.captionRemove(i + 1)}
                      icon={<IconTrash />}
                      onClick={() =>
                        change((captions) => {
                          captions.splice(i, 1);
                        })
                      }
                    />
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="cf-tbpop__hint">{words.captionsNone}</p>
          )}
          <Button variant="secondary" size="sm" icon={<IconPlus />} disabled={lines.length >= MAX_CAPTIONS} onClick={add}>
            {words.captionAdd}
          </Button>
          <div className="cf-captions__files">
            <Button variant="secondary" size="sm" icon={<IconUpload />} onClick={() => fileRef.current?.click()}>
              {words.captionsOpen}
            </Button>
            <Button variant="secondary" size="sm" icon={<IconDownload />} disabled={!clipCaptions(el).length} onClick={saveFile}>
              {words.captionsSave}
            </Button>
          </div>
          <input
            ref={fileRef}
            type="file"
            accept=".srt,application/x-subrip,text/plain"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              void openFile(file);
            }}
          />
          {note ? (
            <p className="cf-tbpop__hint" role="status">
              {note}
            </p>
          ) : null}
          <p className="cf-tbpop__hint">{words.captionsHint}</p>
        </div>
      )}
    </PopoverButton>
  );
}

/** Where the clip starts and stops playing, in seconds of the clip, with how much of it is left. */
/**
 * Seconds to hundredths, as the Start and End fields round them: the hint beside them then agrees with them
 * (a clip of 2.385 s reads 2.38 in the field; formatting it alone would say 2.39).
 */
const hundredths = (seconds: number) => Math.round(seconds * 100) / 100;

function TrimPopover({ el }: { el: VideoElement }) {
  const length = Math.max(MIN_TRIM, el.duration);
  const trimmed = el.trimStart > 0 || el.trimEnd < el.duration;
  const set = (next: { start?: number; end?: number }) => {
    const { trimStart, trimEnd } = clampTrim(el, next);
    editElements(
      [el.id],
      only("video", (v) => {
        v.trimStart = trimStart;
        v.trimEnd = trimEnd;
      }),
      "trim",
    );
  };
  const reset = () =>
    editElements(
      [el.id],
      only("video", (v) => {
        v.trimStart = 0;
        v.trimEnd = v.duration;
      }),
    );
  return (
    <PopoverButton label={m.editor.videoBar.trim} tip={m.editor.videoBar.trimTip} icon={<IconCut />}>
      {() => (
        <div className="cf-tbpop__stack">
          <SliderField label={m.editor.videoBar.trimStart} value={el.trimStart} min={0} max={length} step={0.1} numberStep={0.01} onChange={(v) => set({ start: v })} />
          <SliderField label={m.editor.videoBar.trimEnd} value={el.trimEnd} min={0} max={length} step={0.1} numberStep={0.01} onChange={(v) => set({ end: v })} />
          <p className="cf-tbpop__hint" role="status">
            {m.editor.videoBar.trimLength(hundredths(el.trimEnd - el.trimStart), hundredths(el.duration))}
          </p>
          <Button variant="secondary" size="sm" disabled={!trimmed} onClick={reset}>
            {m.editor.videoBar.resetTrim}
          </Button>
          <SliderField
            label={m.editor.videoBar.startAt}
            value={clipStartAt(el)}
            min={0}
            max={MAX_PAGE_DURATION}
            step={0.5}
            numberStep={0.1}
            onChange={(v) =>
              editElements(
                [el.id],
                only("video", (clip) => {
                  const seconds = Math.min(MAX_PAGE_DURATION, Math.max(0, Math.round(v * 10) / 10));
                  if (seconds === 0) delete clip.startAt;
                  else clip.startAt = seconds;
                }),
                "start-at",
              )
            }
          />
          <Checkbox
            checked={!el.once}
            label={m.editor.videoBar.loop}
            onChange={(loop) =>
              editElements(
                [el.id],
                only("video", (v) => {
                  if (loop) delete v.once;
                  else v.once = true;
                }),
              )
            }
          />
          <p className="cf-tbpop__hint">{el.once ? m.editor.videoBar.onceHint : m.editor.videoBar.loopHint}</p>
        </div>
      )}
    </PopoverButton>
  );
}
