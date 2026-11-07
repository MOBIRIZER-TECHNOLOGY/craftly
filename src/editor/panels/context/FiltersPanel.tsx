import { useEffect, useReducer } from "react";
import { getActions, useSelectedElements } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { FILTER_PRESETS } from "@/data/filters";
import { renderFiltered } from "@/render/imageFilters";
import { getImage, onImagesChange } from "@/render/images";
import { cx, IconImage, Slider, Tabs } from "@/ui";
import { AdjustTab } from "./AdjustTab";
import { PanelEmpty, PanelShell, Section } from "./PanelShell";
import { PreviewCanvas } from "./PreviewCanvas";
import { ToolsTab } from "./ToolsTab";
import { useBatch } from "./useBatch";
import "./FiltersPanel.css";

const TABS = [
  { id: "filters", label: "Filters" },
  { id: "adjust", label: "Adjust" },
  { id: "tools", label: "Tools" },
];

const TITLES = { filters: "Filters", adjust: "Adjust", tools: "Photo tools" } as const;

/** Photos of the selection that have a picture (an empty frame has nothing to filter). */
function useSelectedPhotos(): ImageElement[] {
  return useSelectedElements().filter((e): e is ImageElement => e.type === "image" && !!e.src);
}

/** Filters (preset grid with live previews), Adjust (sliders, duotone) and Tools (on-device AI tools) for the selected photos. */
export function FiltersPanel({ tab }: { tab: "filters" | "adjust" | "tools" }) {
  const photos = useSelectedPhotos();
  return (
    <PanelShell
      title={TITLES[tab]}
      tabs={
        <Tabs
          value={tab}
          tabs={TABS}
          fullWidth
          aria-label="Photo editing sections"
          idBase="cf-filters"
          onChange={(id) => getActions().openContext({ kind: "filters", tab: id === "adjust" || id === "tools" ? id : "filters" })}
        />
      }
    >
      <div id={`cf-filters-panel-${tab}`} role="tabpanel" aria-labelledby={`cf-filters-tab-${tab}`}>
        {photos.length === 0 ? (
          <PanelEmpty
            icon={<IconImage />}
            title="No photo selected"
            text="Select a photo on the page to apply filters, adjust its look or use the photo tools. Empty frames need a photo first."
          />
        ) : tab === "filters" ? (
          <FiltersTab photos={photos} />
        ) : tab === "adjust" ? (
          <AdjustTab photos={photos} />
        ) : (
          <ToolsTab photos={photos} />
        )}
      </div>
    </PanelShell>
  );
}

/** The decoded picture of an image element, re-read whenever any image finishes loading. */
function usePicture(src: string) {
  const [, rerender] = useReducer((n: number) => n + 1, 0);
  useEffect(() => onImagesChange(rerender), []);
  return getImage(src);
}

function FiltersTab({ photos }: { photos: ImageElement[] }) {
  const first = photos[0];
  const actions = getActions();
  const batch = useBatch();
  const picture = usePicture(first.src as string);
  const presetId = photos.every((p) => p.filter.preset === first.filter.preset) ? first.filter.preset || "none" : null;

  const setPreset = (id: string) =>
    actions.updateSelection((el) => {
      if (el.type !== "image") return;
      // a different preset starts at full strength
      el.filter = { ...el.filter, preset: id, intensity: el.filter.preset === id ? el.filter.intensity : 100 };
    });

  // what a tile shows depends on everything but the preset: the picture, its crop and the user's own sliders
  const look = JSON.stringify([first.src, first.width, first.height, first.crop, { ...first.filter, preset: "", intensity: first.filter.intensity }, !!picture]);

  return (
    <>
      {presetId && presetId !== "none" ? (
        // pinned: the preset list is long, the slider must stay in reach
        <div className="cf-ctx__pinned">
          <Slider
            label="Intensity"
            showValue
            min={0}
            max={100}
            step={1}
            value={first.filter.intensity}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) =>
              batch.run(() =>
                actions.updateSelection((el) => {
                  if (el.type === "image") el.filter = { ...el.filter, intensity: v };
                }),
              )
            }
            onChangeEnd={() => batch.end()}
          />
        </div>
      ) : null}
      <Section>
        <div className="cf-flt__grid" role="group" aria-label="Filter presets">
          {FILTER_PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              className={cx("cf-flt__tile", presetId === p.id && "is-selected")}
              aria-pressed={presetId === p.id}
              title={p.description}
              onClick={() => setPreset(p.id)}
            >
              <span className="cf-flt__thumb">
                <PreviewCanvas
                  width={96}
                  height={96}
                  fluid
                  lazy
                  deps={[look, p.id]}
                  draw={(ctx, w, _h, dpr) => {
                    if (!picture) return false;
                    const t = Math.round(w * dpr);
                    const boxW = Math.max(1, first.width);
                    const boxH = Math.max(1, first.height);
                    // the visible part of the photo (its crop) through the preset, then "cover" fitted into the square tile
                    const scale = Math.min(t / Math.min(boxW, boxH), 512 / Math.max(boxW, boxH));
                    const out = renderFiltered({
                      key: first.src as string,
                      img: picture,
                      dx: first.crop.x * boxW,
                      dy: first.crop.y * boxH,
                      dw: first.crop.w * boxW,
                      dh: first.crop.h * boxH,
                      boxW,
                      boxH,
                      filter: { ...first.filter, preset: p.id },
                      scale,
                    });
                    const k = Math.max(t / out.width, t / out.height);
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.drawImage(out, (t - out.width * k) / 2, (t - out.height * k) / 2, out.width * k, out.height * k);
                  }}
                />
              </span>
              <span className="cf-flt__label">{p.name}</span>
            </button>
          ))}
        </div>
      </Section>
    </>
  );
}
