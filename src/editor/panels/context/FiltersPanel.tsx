import { useEffect, useReducer } from "react";
import { getActions, useSelectedElements } from "@/core/store";
import type { ImageElement } from "@/core/types";
import { filterOf, pictureKey, setFilter, type FilterTarget } from "./filterTarget";
import { FILTER_PRESETS } from "@/data/filters";
import { m } from "@/i18n";
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
  { id: "filters", label: m.panelsContext.filters.tabs.filters },
  { id: "adjust", label: m.panelsContext.filters.tabs.adjust },
  { id: "tools", label: m.panelsContext.filters.tabs.tools },
];

const TITLES = m.panelsContext.filters.titles;

/** Photos and clips of the selection that have a picture (an empty frame has nothing to filter). */
function useSelectedPhotos(): FilterTarget[] {
  return useSelectedElements().filter((e): e is FilterTarget => (e.type === "image" || e.type === "video") && !!e.src);
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
          aria-label={m.panelsContext.filters.sections}
          idBase="cf-filters"
          onChange={(id) => getActions().openContext({ kind: "filters", tab: id === "adjust" || id === "tools" ? id : "filters" })}
        />
      }
    >
      <div id={`cf-filters-panel-${tab}`} role="tabpanel" aria-labelledby={`cf-filters-tab-${tab}`}>
        {photos.length === 0 ? (
          <PanelEmpty icon={<IconImage />} title={m.panelsContext.filters.noPhoto} text={m.panelsContext.filters.noPhotoText} />
        ) : tab === "filters" ? (
          <FiltersTab photos={photos} />
        ) : tab === "adjust" ? (
          <AdjustTab photos={photos} />
        ) : photos.some((p) => p.type === "image") ? (
          <ToolsTab photos={photos.filter((p): p is ImageElement => p.type === "image")} />
        ) : (
          <PanelEmpty icon={<IconImage />} title={m.panelsContext.filters.titles.tools} text={m.panelsContext.filters.clipsOnly} />
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

function FiltersTab({ photos }: { photos: FilterTarget[] }) {
  const first = photos[0];
  const actions = getActions();
  const batch = useBatch();
  const key = pictureKey(first);
  const picture = usePicture(key);
  const filter = filterOf(first);
  const presetId = photos.every((p) => filterOf(p).preset === filter.preset) ? filter.preset || "none" : null;

  const setPreset = (id: string) =>
    actions.updateSelection((el) =>
      // a different preset starts at full strength
      setFilter(el, (f) => ({ ...f, preset: id, intensity: f.preset === id ? f.intensity : 100 })),
    );

  // what a tile shows depends on everything but the preset: the picture, its crop and the user's own sliders
  const look = JSON.stringify([key, first.width, first.height, first.crop, { ...filter, preset: "", intensity: filter.intensity }, !!picture]);

  return (
    <>
      {presetId && presetId !== "none" ? (
        // pinned: the preset list is long, the slider must stay in reach
        <div className="cf-ctx__pinned">
          <Slider
            label={m.panelsContext.filters.intensity}
            showValue
            min={0}
            max={100}
            step={1}
            value={filter.intensity}
            format={(v) => `${Math.round(v)}%`}
            onChange={(v) => batch.run(() => actions.updateSelection((el) => setFilter(el, (f) => ({ ...f, intensity: v }))))}
            onChangeEnd={() => batch.end()}
          />
        </div>
      ) : null}
      <Section>
        <div className="cf-flt__grid" role="group" aria-label={m.panelsContext.filters.presets}>
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
                      key,
                      img: picture,
                      dx: first.crop.x * boxW,
                      dy: first.crop.y * boxH,
                      dw: first.crop.w * boxW,
                      dh: first.crop.h * boxH,
                      boxW,
                      boxH,
                      filter: { ...filter, preset: p.id },
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
