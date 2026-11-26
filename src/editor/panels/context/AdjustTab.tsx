import { defaultFilter } from "@/core/factory";
import { getActions } from "@/core/store";
import type { ImageFilter } from "@/core/types";
import { ADJUSTMENTS, getFilterPreset, type AdjustmentDef } from "@/data/filters";
import { m } from "@/i18n";
import { effectiveFilter } from "@/render/imageFilters";
import { Button, IconButton, IconRotateLeft, Slider, Switch } from "@/ui";
import { ColorField } from "./ColorField";
import { FieldLabel, Section } from "./PanelShell";
import { filterOf, setFilter, type FilterTarget } from "./filterTarget";
import { useBatch } from "./useBatch";
import "./AdjustTab.css";

const DEFAULT_DUOTONE = { dark: "#0b1f4b", light: "#7ee8e0" };

const signed = (v: number) => (v > 0 ? `+${Math.round(v)}` : String(Math.round(v)));

/** Writes a new filter to every selected photo and clip. */
function patchFilters(make: (filter: ImageFilter) => ImageFilter): void {
  getActions().updateSelection((el) => setFilter(el, make));
}

export function AdjustTab({ photos }: { photos: FilterTarget[] }) {
  const f = filterOf(photos[0]);
  const batch = useBatch();
  const effective = effectiveFilter(f).duotone ?? null;
  const presetOwnsDuotone = !!getFilterPreset(f.preset)?.patch.duotone && f.intensity > 1;
  const changed = ADJUSTMENTS.some((a) => f[a.key] !== a.default) || !!f.duotone;

  const resetAll = () =>
    patchFilters((filter) => {
      const clean = defaultFilter();
      // the preset stays; only the user's own adjustments and duotone go
      return { ...clean, preset: filter.preset, intensity: filter.intensity };
    });

  /** a preset duotone overrides a custom one, so editing / removing it turns the preset off */
  const setDuotone = (duotone: ImageFilter["duotone"]) => patchFilters((filter) => ({ ...filter, preset: presetOwnsDuotone ? "none" : filter.preset, duotone }));

  return (
    <>
      <Section>
        <div className="cf-adj__top">
          <Button
            size="sm"
            variant="secondary"
            onClick={() => patchFilters((filter) => ({ ...filter, brightness: 8, contrast: 12, saturation: 10, highlights: -10, shadows: 15 }))}
          >
            {m.panelsContext.adjust.autoEnhance}
          </Button>
          <Button size="sm" variant="secondary" icon={<IconRotateLeft />} disabled={!changed} onClick={resetAll}>
            {m.panelsContext.adjust.resetAll}
          </Button>
        </div>
        <div className="cf-adj__rows">
          {ADJUSTMENTS.map((adj) => (
            <AdjustRow key={adj.key} adj={adj} value={f[adj.key] ?? adj.default} batch={batch} />
          ))}
        </div>
      </Section>

      <Section title={m.panelsContext.adjust.duotone}>
        <Switch label={m.panelsContext.adjust.duotone} checked={!!effective} onChange={(on) => setDuotone(on ? { ...DEFAULT_DUOTONE } : null)} />
        {effective ? (
          <div className="cf-adj__duo">
            <div className="cf-adj__duo-item">
              <FieldLabel>{m.panelsContext.adjust.shadows}</FieldLabel>
              <ColorField
                label={m.panelsContext.adjust.duotoneShadows}
                value={effective.dark}
                size={40}
                onChange={(c) => batch.run(() => setDuotone({ ...effective, dark: c }))}
                onCommit={() => batch.end()}
              />
            </div>
            <div className="cf-adj__duo-item">
              <FieldLabel>{m.panelsContext.adjust.highlights}</FieldLabel>
              <ColorField
                label={m.panelsContext.adjust.duotoneHighlights}
                value={effective.light}
                size={40}
                onChange={(c) => batch.run(() => setDuotone({ ...effective, light: c }))}
                onCommit={() => batch.end()}
              />
            </div>
          </div>
        ) : (
          <p className="cf-ctx__hint">{m.panelsContext.adjust.duotoneHint}</p>
        )}
      </Section>
    </>
  );
}

function AdjustRow({ adj, value, batch }: { adj: AdjustmentDef; value: number; batch: ReturnType<typeof useBatch> }) {
  const bipolar = adj.min < 0;
  const dirty = value !== adj.default;
  return (
    <div className="cf-adj__row">
      <div className="cf-adj__head">
        <span className="cf-adj__label">{adj.label}</span>
        <span className="cf-adj__tools">
          {dirty ? (
            <IconButton
              size="sm"
              className="cf-adj__reset"
              label={m.panelsContext.adjust.resetOne(adj.label)}
              icon={<IconRotateLeft />}
              onClick={() => patchFilters((filter) => ({ ...filter, [adj.key]: adj.default }))}
            />
          ) : null}
          <span className="cf-adj__value">{bipolar ? signed(value) : Math.round(value)}</span>
        </span>
      </div>
      <Slider
        aria-label={adj.label}
        min={adj.min}
        max={adj.max}
        step={adj.step}
        value={value}
        onChange={(v) => batch.run(() => patchFilters((filter) => ({ ...filter, [adj.key]: v })))}
        onChangeEnd={() => batch.end()}
      />
    </div>
  );
}
