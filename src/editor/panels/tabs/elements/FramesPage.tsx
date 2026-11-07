import { useMemo } from "react";
import { getActions, useEditor } from "@/core/store";
import { FRAME_PRESETS, GRID_PRESETS, createFrameFromPreset, createGridFrames, type FramePreset, type GridPreset } from "@/data/shapes";
import { shapePathData } from "@/render/shapePaths";
import { IconFrame, IconGrid } from "@/ui";
import { DraggableItem } from "../../shared/DraggableItem";
import { EmptyHint } from "../../shared/EmptyHint";
import { ItemGrid } from "../../shared/ItemGrid";
import { Panel, PanelScroll } from "../../shared/PanelLayout";
import { designMin } from "../../shared/panelActions";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./FramesPage.css";

/** The little landscape glyph every empty photo frame shows (same path the renderer draws). */
const PICTURE = "M4 18 L9 11 L13 16 L16 12 L22 18 Z M17 7 A2 2 0 1 1 16.99 7 Z";

/* ------------------------------------------------------------------ */
/* frames                                                               */
/* ------------------------------------------------------------------ */

function FramePreview({ preset }: { preset: FramePreset }) {
  const box = 100;
  const inner = 84;
  const a = preset.aspect;
  const w = a >= 1 ? inner : inner * a;
  const h = a >= 1 ? inner / a : inner;
  const d = shapePathData(preset.mask, w, h, { radius: preset.radius ? Math.min(w, h) * 0.14 : 0 });
  const icon = Math.min(w, h) * 0.34;
  return (
    <svg viewBox={`0 0 ${box} ${box}`} className="cf-frame-preview" aria-hidden="true">
      <g transform={`translate(${(box - w) / 2} ${(box - h) / 2})`}>
        <path d={d} className="cf-frame-preview__shape" />
        <path d={PICTURE} className="cf-frame-preview__icon" transform={`translate(${w / 2 - icon / 2} ${h / 2 - icon / 2}) scale(${icon / 26})`} />
      </g>
    </svg>
  );
}

export function FramesPage() {
  const query = useElementsNav((s) => s.query);
  const q = query.trim().toLowerCase();
  const presets = useMemo(() => FRAME_PRESETS.filter((p) => !q || `${p.name} ${p.mask} frame mask`.toLowerCase().includes(q)), [q]);
  return (
    <Panel>
      <SubPageTop title="Frames" placeholder="Search frames" subtitle="Drop a photo onto a frame to fill it" />
      <PanelScroll>
        {presets.length ? (
          <ItemGrid columns={3} minCell={84} gap={8}>
            {presets.map((p) => {
              const make = () => createFrameFromPreset(p, designMin());
              return (
                <DraggableItem
                  key={p.id}
                  label={p.name}
                  onInsert={() => void getActions().addElement(make())}
                  getPayload={() => ({ type: "elements", elements: [make()] })}
                  className="cf-cell cf-frame-cell"
                >
                  <FramePreview preset={p} />
                </DraggableItem>
              );
            })}
          </ItemGrid>
        ) : (
          <EmptyHint icon={<IconFrame />} title="No frames found" text={`Nothing matches "${query.trim()}". Try "circle", "heart" or "arch".`} />
        )}
      </PanelScroll>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* photo grids                                                          */
/* ------------------------------------------------------------------ */

function GridPreview({ preset }: { preset: GridPreset }) {
  const W = 100;
  const H = 72;
  const gap = 3;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="cf-grid-preview" aria-hidden="true">
      {preset.cells.map(([x, y, w, h], i) => (
        <rect key={i} x={x * W + gap / 2} y={y * H + gap / 2} width={Math.max(2, w * W - gap)} height={Math.max(2, h * H - gap)} rx="3" className="cf-grid-preview__cell" />
      ))}
    </svg>
  );
}

/** Frames of a grid preset filling the page minus a margin, with a small gutter between them. */
function buildGridFrames(preset: GridPreset) {
  const design = useEditor.getState().design;
  const width = design?.width ?? 1920;
  const height = design?.height ?? 1080;
  const min = Math.min(width, height);
  const m = Math.round(min * 0.06);
  const gap = Math.max(6, Math.round(min * 0.012));
  return createGridFrames(preset, { x: m, y: m, w: width - m * 2, h: height - m * 2 }, gap);
}

export function GridsPage() {
  const query = useElementsNav((s) => s.query);
  const q = query.trim().toLowerCase();
  const presets = useMemo(() => GRID_PRESETS.filter((p) => !q || `${p.name} grid collage photos`.toLowerCase().includes(q)), [q]);

  return (
    <Panel>
      <SubPageTop title="Grids" placeholder="Search grids" subtitle="Photo layouts that fill the page" />
      <PanelScroll>
        {presets.length ? (
          <ItemGrid columns={2} minCell={130} gap={10}>
            {presets.map((p) => (
              <DraggableItem
                key={p.id}
                label={p.name}
                onInsert={() => void getActions().addElements(buildGridFrames(p), { center: false })}
                getPayload={() => ({ type: "elements", elements: buildGridFrames(p) })}
                className="cf-cell cf-grid-cell"
              >
                <GridPreview preset={p} />
                <span className="cf-grid-cell__name">{p.name}</span>
              </DraggableItem>
            ))}
          </ItemGrid>
        ) : (
          <EmptyHint icon={<IconGrid />} title="No grids found" text={`Nothing matches "${query.trim()}". Try "mosaic" or "columns".`} />
        )}
      </PanelScroll>
    </Panel>
  );
}
