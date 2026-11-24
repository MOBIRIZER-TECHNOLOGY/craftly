/** The contextual toolbar of video elements: play, trim, speed, sound, and the frame they are cut to. */
import { VIDEO_SPEED_MAX, VIDEO_SPEED_MIN } from "@/core/factory";
import type { VideoElement } from "@/core/types";
import { startPreview, stopPreview, usePreview } from "@/editor/canvas/preview";
import { ShapePreview } from "@/editor/panels/shared/ShapePreview";
import { m } from "@/i18n";
import { clampTrim, clipClock, MIN_TRIM, playingLength, trimmedLength } from "@/render/videos";
import { Button, Divider, IconCut, IconFrame, IconMuted, IconPause, IconPlay, IconSound, IconSpeed, type MenuEntry } from "@/ui";
import { AnimateButton, BorderPopover, CopyStyleButton, FlipMenu, MoreButton, MultiActions, PositionButton, RadiusPopover, TransparencyButton, type BarProps } from "../common";
import { MenuButton, PopoverButton, SliderField, TBIcon } from "../kit";
import { editElements, only, uniform } from "../selection";
import { FRAME_SHAPES } from "./ImageBar";

type Extra = { copyEnabled: boolean };

/** The speeds offered, slowest first (VIDEO_SPEED_MIN to VIDEO_SPEED_MAX). */
export const VIDEO_SPEEDS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4].filter((x) => x >= VIDEO_SPEED_MIN && x <= VIDEO_SPEED_MAX);

export function VideoBar({ els, ids, copyEnabled }: BarProps<VideoElement> & Extra) {
  const single = els.length === 1 ? els[0] : null;
  const playing = usePreview((s) => s.preview !== null);
  const rounded = els.every((e) => (e.mask || "rect") === "rect");
  const mask = uniform(els, (e) => e.mask || "rect");
  const speed = uniform(els, (e) => e.speed);
  const muted = els.every((e) => !!e.muted);
  // the preview plays the page from its start for as long as the longest of these clips plays once
  const longest = Math.max(1, ...els.map((e) => playingLength(e)));

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
        onClick={() => (playing ? stopPreview() : startPreview(0, longest))}
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

/** Where the clip starts and stops playing, in seconds of the clip, with how much of it is left. */
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
            {m.editor.videoBar.trimLength(clipClock(trimmedLength(el), true), clipClock(el.duration, true))}
          </p>
          <Button variant="secondary" size="sm" disabled={!trimmed} onClick={reset}>
            {m.editor.videoBar.resetTrim}
          </Button>
        </div>
      )}
    </PopoverButton>
  );
}
