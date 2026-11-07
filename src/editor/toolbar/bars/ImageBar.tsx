/** Contextual toolbars of images, empty frames and the crop mode. */
import { getActions } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { getCropScale, resetCrop, setCropScale } from "@/editor/canvas/CropOverlay";
import { Divider, IconCrop, IconReplace, IconRotateLeft, IconUpload, IconZoomIn, IconZoomOut, Slider } from "@/ui";
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
import { TBIcon, TBText, toggleContext, useContextActive } from "../kit";
import { clampNumber } from "../selection";

type Extra = { copyEnabled: boolean };

export function ImageBar({ els, ids, copyEnabled }: BarProps<ImageElement> & Extra) {
  const filtersOpen = useContextActive({ kind: "filters", tab: "filters" });
  const single = els.length === 1 ? els[0] : null;
  // The corner radius only shapes the default rectangular mask.
  const rounded = els.every((e) => (e.mask || "rect") === "rect");
  return (
    <>
      <TBText tip="Filters and adjustments" active={filtersOpen} onClick={() => toggleContext({ kind: "filters", tab: "filters" })}>
        Edit image
      </TBText>
      {single && <TBIcon label="Crop" tip="Crop" shortcut="Enter" icon={<IconCrop />} onClick={() => getActions().startCrop(single.id)} />}
      <FlipMenu />
      {rounded && <RadiusPopover els={els} ids={ids} />}
      <BorderPopover els={els} ids={ids} />
      <TransparencyButton els={els} ids={ids} />
      <EffectsButton />
      <AnimateButton />
      <PositionButton />
      {single && (
        <TBText icon={<IconReplace />} tip="Choose another picture" onClick={() => pickImageFor(single.id)}>
          Replace
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
      <TBText variant="soft" icon={<IconUpload />} tip="Upload a picture into this frame" onClick={() => pickImageFor(el.id)}>
        Upload
      </TBText>
      <Divider vertical className="cf-tb__div" />
      <AnimateButton />
      <PositionButton />
      <MoreButton />
    </>
  );
}

/** While cropping: zoom slider, reset and the purple Done button. */
export function CropBar({ el }: { el: ImageElement }) {
  const scale = getCropScale(el);
  return (
    <>
      <span className="cf-tb__caption">Zoom</span>
      <IconZoomOut className="cf-tb__zoomicon" aria-hidden="true" />
      <div className="cf-tb__zoom">
        <Slider value={clampNumber(scale, 1, 4)} min={1} max={4} step={0.01} aria-label="Crop zoom" onChange={(v) => setCropScale(el.id, v)} />
      </div>
      <IconZoomIn className="cf-tb__zoomicon" aria-hidden="true" />
      <span className="cf-tb__readout" aria-hidden="true">
        {Math.round(scale * 100)}%
      </span>
      <Divider vertical className="cf-tb__div" />
      <TBText icon={<IconRotateLeft />} tip="Restore the original crop" onClick={() => resetCrop(el.id)}>
        Reset crop
      </TBText>
      <TBText variant="primary" tip="Finish cropping" shortcut="Esc" onClick={() => getActions().endCrop()}>
        Done
      </TBText>
    </>
  );
}
