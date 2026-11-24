/** Contextual toolbars of images, empty frames and the crop mode. */
import { getActions } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { CROP_RATIOS, cropRatioOf, currentCropRatio, getCropScale, resetCrop, setCropRatio, setCropRotation, setCropScale } from "@/editor/canvas/CropOverlay";
import { m } from "@/i18n";
import { SHAPES } from "@/render/shapePaths";
import { ShapePreview } from "@/editor/panels/shared/ShapePreview";
import { Divider, IconChevronDown, IconCrop, IconFrame, IconReplace, IconRotateLeft, IconUpload, IconZoomIn, IconZoomOut, Slider, type MenuEntry } from "@/ui";
import {
  BorderPopover,
  CopyStyleButton,
  EffectsButton,
  FlipMenu,
  MoreButton,
  MultiActions,
  AnimateButton,
  PositionButton,
  RadiusPopover,
  TransparencyButton,
  type BarProps,
} from "../common";
import { pickImageFor } from "../imageFile";
import { MenuButton, TBIcon, TBText, toggleContext, useContextActive } from "../kit";
import { clampNumber, editElements, only, uniform } from "../selection";

type Extra = { copyEnabled: boolean };

/** Every catalogue shape can cut a picture; rect means the ordinary frame. */
const FRAME_SHAPES: ReadonlyArray<{ mask: string; name: string }> = [
  { mask: "rect", name: m.editor.imageBar.frameNone },
  ...SHAPES.filter((shape) => shape.id !== "rect").map((shape) => ({ mask: shape.id, name: shape.name })),
];

export function ImageBar({ els, ids, copyEnabled }: BarProps<ImageElement> & Extra) {
  const filtersOpen = useContextActive({ kind: "filters", tab: "filters" });
  const single = els.length === 1 ? els[0] : null;
  // The corner radius only shapes the default rectangular mask.
  const rounded = els.every((e) => (e.mask || "rect") === "rect");
  const mask = uniform(els, (e) => e.mask || "rect");
  // a picture keeps its size and its place; only the outline it is cut to changes
  const frameItems = (): MenuEntry[] =>
    FRAME_SHAPES.map((shape) => ({
      id: `frame-${shape.mask}`,
      label: shape.name,
      icon: <ShapePreview kind={shape.mask} box={18} />,
      checked: !mask.mixed && mask.value === shape.mask,
      onSelect: () =>
        editElements(
          ids,
          only("image", (el) => {
            el.mask = shape.mask;
            delete el.maskPath;
          }),
        ),
    }));
  return (
    <>
      <TBText tip={m.editor.imageBar.editImageTip} active={filtersOpen} onClick={() => toggleContext({ kind: "filters", tab: "filters" })}>
        {m.editor.imageBar.editImage}
      </TBText>
      {single && <TBIcon label={m.editor.imageBar.crop} tip={m.editor.imageBar.crop} shortcut="Enter" icon={<IconCrop />} onClick={() => getActions().startCrop(single.id)} />}
      <MenuButton label={m.editor.imageBar.frameShape} tip={m.editor.imageBar.frameShapeTip} icon={<IconFrame />} items={frameItems} />
      <FlipMenu />
      {rounded && <RadiusPopover els={els} ids={ids} />}
      <BorderPopover els={els} ids={ids} />
      <TransparencyButton els={els} ids={ids} />
      <EffectsButton />
      <AnimateButton />
      <PositionButton />
      {single && (
        <TBText icon={<IconReplace />} tip={m.editor.imageBar.replaceTip} onClick={() => pickImageFor(single.id)}>
          {m.editor.imageBar.replace}
        </TBText>
      )}
      {ids.length > 1 && <MultiActions ids={ids} />}
      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}

/** An empty frame only offers to fill it. */
export function FrameBar({ el }: { el: ImageElement }) {
  return (
    <>
      <TBText variant="soft" icon={<IconUpload />} tip={m.editor.imageBar.uploadTip} onClick={() => pickImageFor(el.id)}>
        {m.editor.imageBar.upload}
      </TBText>
      <Divider vertical className="cf-tb__div" />
      <AnimateButton />
      <PositionButton />
      <MoreButton />
    </>
  );
}

/** While cropping: the shape of the frame, zoom slider, reset and the purple Done button. */
export function CropBar({ el }: { el: ImageElement }) {
  const scale = getCropScale(el);
  const current = currentCropRatio(el);
  const ratioItems = (): MenuEntry[] =>
    CROP_RATIOS.map((r) => ({
      id: `ratio-${r.id}`,
      label: r.id === "original" ? m.editor.imageBar.ratioOriginal : r.id,
      checked: current === r.id,
      onSelect: () => setCropRatio(el.id, cropRatioOf(el, r.id)),
    }));
  return (
    <>
      <MenuButton
        label={m.editor.imageBar.ratio}
        tip={m.editor.imageBar.ratioTip}
        icon={<IconCrop />}
        iconRight={<IconChevronDown />}
        text={current === null ? m.editor.imageBar.ratioFree : current === "original" ? m.editor.imageBar.ratioOriginal : current}
        items={ratioItems}
      />
      <Divider vertical className="cf-tb__div" />
      <span className="cf-tb__caption">{m.editor.imageBar.zoom}</span>
      <IconZoomOut className="cf-tb__zoomicon" aria-hidden="true" />
      <div className="cf-tb__zoom">
        <Slider value={clampNumber(scale, 1, 4)} min={1} max={4} step={0.01} aria-label={m.editor.imageBar.cropZoom} onChange={(v) => setCropScale(el.id, v)} />
      </div>
      <IconZoomIn className="cf-tb__zoomicon" aria-hidden="true" />
      <span className="cf-tb__readout" aria-hidden="true">
        {Math.round(scale * 100)}%
      </span>
      <Divider vertical className="cf-tb__div" />
      <div className="cf-tb__zoom">
        <Slider value={el.crop.rotation ?? 0} min={-45} max={45} step={0.1} aria-label={m.editor.imageBar.straighten} onChange={(v) => setCropRotation(el.id, v)} />
      </div>
      <span className="cf-tb__readout" aria-hidden="true">
        {Math.round(el.crop.rotation ?? 0)}°
      </span>
      <Divider vertical className="cf-tb__div" />
      <TBText icon={<IconRotateLeft />} tip={m.editor.imageBar.resetCropTip} onClick={() => resetCrop(el.id)}>
        {m.editor.imageBar.resetCrop}
      </TBText>
      <TBText variant="primary" tip={m.editor.imageBar.finishCropTip} shortcut="Esc" onClick={() => getActions().endCrop()}>
        {m.common.done}
      </TBText>
    </>
  );
}
