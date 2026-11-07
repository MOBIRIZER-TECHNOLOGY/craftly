import { useEffect, useRef, useState } from "react";
import { getActions, getActivePage, useActivePage, useEditor } from "@/core/store";
import type { Fill, PatternFill } from "@/core/types";
import { BACKGROUND_GROUPS, type BackgroundGroup, type BackgroundPreset } from "@/data/backgrounds";
import { getPhotoDef } from "@/data/photos";
import { Button, cx, IconBackground, IconCheck, IconChevronRight, IconLayers, Select, Slider } from "@/ui";
import { samePaint } from "./colorTargets";
import { ColorField } from "./ColorField";
import { FillThumb } from "./FillThumb";
import { FieldLabel, PanelEmpty, PanelShell, Section } from "./PanelShell";
import { useBatch } from "./useBatch";
import "./BackgroundPanel.css";

/** How many presets of a group show before "See all". */
const COLLAPSED: Record<string, number> = { solid: 18, gradient: 18, pattern: 12, photo: 6 };

const FIT_OPTIONS = [
  { value: "cover", label: "Fill the page" },
  { value: "contain", label: "Fit inside the page" },
  { value: "tile", label: "Tile" },
];

/** Does the page background still match this preset? (patterns ignore the scale, which has its own slider) */
function matchesPreset(bg: Fill, preset: Fill): boolean {
  if (bg.type !== preset.type) return false;
  switch (bg.type) {
    case "solid":
    case "linear":
    case "radial":
      return samePaint(bg, preset as typeof bg);
    case "pattern": {
      const p = preset as PatternFill;
      return bg.pattern === p.pattern && bg.color.toLowerCase() === p.color.toLowerCase() && bg.background.toLowerCase() === p.background.toLowerCase();
    }
    case "image":
      return bg.src === (preset as typeof bg).src;
  }
}

function describeFill(bg: Fill): string {
  switch (bg.type) {
    case "solid":
      return bg.color.toUpperCase();
    case "linear":
    case "radial":
      return "Gradient";
    case "pattern":
      return "Pattern";
    case "image":
      return bg.src.startsWith("builtin:") ? (getPhotoDef(bg.src.slice(8))?.name ?? "Photo") : "Photo";
  }
}

export function BackgroundPanel() {
  const page = useActivePage();
  const pageCount = useEditor((s) => s.design?.pages.length ?? 0);
  const actions = getActions();
  const batch = useBatch();
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [applied, setApplied] = useState(false);
  const appliedTimer = useRef(0);
  useEffect(() => () => window.clearTimeout(appliedTimer.current), []);

  if (!page) {
    return (
      <PanelShell title="Background">
        <PanelEmpty icon={<IconBackground />} title="No page open" text="Open a design to change the background of its pages." />
      </PanelShell>
    );
  }
  const bg = page.background;

  const choose = (preset: BackgroundPreset) => {
    const fill = structuredClone(preset.fill);
    // switching between photos keeps the dimming the user chose
    if (fill.type === "image" && bg.type === "image" && bg.dim) fill.dim = bg.dim;
    actions.setPageBackground(fill);
  };

  const patchBackground = (patch: Partial<PatternFill> | { dim?: number; fit?: "cover" | "contain" | "tile" }) =>
    batch.run(() => {
      const current = getActivePage(useEditor.getState())?.background;
      if (current) actions.setPageBackground({ ...current, ...patch } as Fill);
    });

  const applyToAll = () => {
    const design = useEditor.getState().design;
    const current = getActivePage(useEditor.getState())?.background;
    if (!design || !current) return;
    actions.beginTransaction();
    try {
      for (const p of design.pages) actions.setPageBackground(structuredClone(current), p.id);
    } finally {
      actions.endTransaction();
    }
    setApplied(true);
    window.clearTimeout(appliedTimer.current);
    appliedTimer.current = window.setTimeout(() => setApplied(false), 2200);
  };

  return (
    <PanelShell
      title="Background"
      footer={
        pageCount > 1 ? (
          <Button block variant="secondary" icon={applied ? <IconCheck /> : <IconLayers />} onClick={applyToAll}>
            {applied ? "Applied to all pages" : "Apply to all pages"}
          </Button>
        ) : undefined
      }
    >
      <div className="cf-bg">
        <button
          type="button"
          className="cf-bg__current"
          onClick={() => actions.openContext({ kind: "color", target: "page" })}
          aria-label={`Page color: ${describeFill(bg)}. Open the color panel`}
        >
          <span className="cf-bg__current-swatch">
            <FillThumb fill={bg} />
          </span>
          <span className="cf-bg__current-text">
            <span className="cf-bg__current-title">Page color</span>
            <span className="cf-bg__current-sub">{describeFill(bg)}</span>
          </span>
          <IconChevronRight className="cf-bg__current-chev" aria-hidden="true" />
        </button>

        {bg.type === "pattern" || bg.type === "image" ? (
          // pinned under the header so the options stay in reach while the long preset lists scroll
          <div className="cf-ctx__pinned">
            {bg.type === "pattern" ? (
              <>
                <h3 className="cf-ctx__h">Pattern</h3>
                <div className="cf-ctx__rows">
                  <Slider
                    label="Scale"
                    showValue
                    min={0.4}
                    max={4}
                    step={0.1}
                    value={bg.scale}
                    format={(v) => `${Math.round(v * 100)}%`}
                    onChange={(v) => patchBackground({ scale: v })}
                    onChangeEnd={() => batch.end()}
                  />
                  <div className="cf-bg__colors">
                    <div>
                      <FieldLabel>Ink</FieldLabel>
                      <ColorField label="Pattern ink color" value={bg.color} size={40} onChange={(c) => patchBackground({ color: c })} onCommit={() => batch.end()} />
                    </div>
                    <div>
                      <FieldLabel>Paper</FieldLabel>
                      <ColorField label="Pattern paper color" value={bg.background} size={40} onChange={(c) => patchBackground({ background: c })} onCommit={() => batch.end()} />
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                <h3 className="cf-ctx__h">Photo</h3>
                <div className="cf-ctx__rows">
                  <Slider
                    label="Dim"
                    showValue
                    min={-90}
                    max={90}
                    step={1}
                    value={Math.round((bg.dim ?? 0) * 100)}
                    format={(v) => (v === 0 ? "Off" : v > 0 ? `Dim ${v}%` : `Lighten ${-v}%`)}
                    onChange={(v) => patchBackground({ dim: v / 100 })}
                    onChangeEnd={() => batch.end()}
                  />
                  <div>
                    <FieldLabel>Fit</FieldLabel>
                    <Select
                      aria-label="Photo fit"
                      value={bg.fit}
                      options={FIT_OPTIONS}
                      onChange={(fit) => actions.setPageBackground({ ...bg, fit: fit as "cover" | "contain" | "tile" })}
                    />
                  </div>
                </div>
              </>
            )}
          </div>
        ) : null}

        {BACKGROUND_GROUPS.map((group) => (
          <Group
            key={group.id}
            group={group}
            current={bg}
            open={!!expanded[group.id]}
            onToggle={() => setExpanded((e) => ({ ...e, [group.id]: !e[group.id] }))}
            onChoose={choose}
          />
        ))}
      </div>
    </PanelShell>
  );
}

function Group({
  group,
  current,
  open,
  onToggle,
  onChoose,
}: {
  group: BackgroundGroup;
  current: Fill;
  open: boolean;
  onToggle: () => void;
  onChoose: (preset: BackgroundPreset) => void;
}) {
  const limit = COLLAPSED[group.id] ?? 12;
  const presets = open ? group.presets : group.presets.slice(0, limit);
  const photo = group.id === "photo";
  return (
    <Section
      title={group.label}
      aside={
        group.presets.length > limit ? (
          <button type="button" className="cf-ctx__link" onClick={onToggle}>
            {open ? "Show less" : "See all"}
          </button>
        ) : undefined
      }
    >
      <div className={cx("cf-bg__grid", photo && "cf-bg__grid--photo")}>
        {presets.map((p) => {
          const selected = matchesPreset(current, p.fill);
          return (
            <button
              key={p.id}
              type="button"
              className={cx("cf-bg__tile", selected && "is-selected")}
              aria-pressed={selected}
              aria-label={p.name}
              title={p.name}
              onClick={() => onChoose(p)}
            >
              <FillThumb fill={p.fill} />
            </button>
          );
        })}
      </div>
    </Section>
  );
}
