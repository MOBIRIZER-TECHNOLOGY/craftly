import { memo, useMemo } from "react";
import { PageThumb } from "@/components/PageThumb";
import { createPage } from "@/core/factory";
import { getActions, useActivePage } from "@/core/store";
import type { Fill } from "@/core/types";
import { BACKGROUND_GROUPS, type BackgroundPreset } from "@/data/backgrounds";
import { getPhotoDef } from "@/data/photos";
import { m } from "@/i18n";
import { IconBackground, cx } from "@/ui";
import { DraggableItem } from "../../shared/DraggableItem";
import { EmptyHint } from "../../shared/EmptyHint";
import { ItemGrid } from "../../shared/ItemGrid";
import { useElementWidth } from "../../shared/hooks";
import { Panel, PanelScroll, PanelSection } from "../../shared/PanelLayout";
import { fillToCss, sameFill } from "../../shared/panelActions";
import { PhotoThumb } from "./cells";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./BackgroundsPage.css";

const COLUMNS: Record<string, number> = { solid: 6, gradient: 4, pattern: 4, photo: 3 };
const THUMB = { width: 160, height: 120 };

/** Patterns need the real renderer; it draws them into a tiny page. */
const PatternThumb = memo(function PatternThumb({ fill }: { fill: Fill }) {
  const [ref, width] = useElementWidth<HTMLDivElement>();
  const page = useMemo(() => createPage({ background: fill }), [fill]);
  return (
    <div ref={ref} className="cf-bgcell__fill">
      {width > 0 ? <PageThumb design={THUMB} page={page} width={width} placeholder="var(--c-hover)" /> : null}
    </div>
  );
});

function Swatch({ fill }: { fill: Fill }) {
  const css = fillToCss(fill);
  if (css) return <div className="cf-bgcell__fill" style={{ background: css }} />;
  if (fill.type === "image") {
    const def = getPhotoDef(fill.src.replace(/^builtin:/, ""));
    return <div className="cf-bgcell__fill">{def ? <PhotoThumb def={def} maxSide={220} /> : null}</div>;
  }
  return <PatternThumb fill={fill} />;
}

function BackgroundCell({ preset, groupId, current }: { preset: BackgroundPreset; groupId: string; current: Fill | undefined }) {
  const selected = !!current && sameFill(current, preset.fill);
  return (
    <DraggableItem
      label={preset.name}
      pressed={selected}
      onInsert={() => getActions().setPageBackground(preset.fill)}
      getPayload={() => ({ type: "background", fill: preset.fill })}
      className={cx("cf-bgcell", `cf-bgcell--${groupId}`)}
    >
      <Swatch fill={preset.fill} />
    </DraggableItem>
  );
}

/** Page backgrounds: click to set the background of the active page, or drag one onto the canvas. */
export function BackgroundsPage() {
  const query = useElementsNav((s) => s.query);
  const current = useActivePage()?.background;
  const q = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      BACKGROUND_GROUPS.map((g) => ({ ...g, presets: g.presets.filter((p) => !q || `${p.name} ${p.englishName} ${g.label} ${g.id}`.toLowerCase().includes(q)) })).filter(
        (g) => g.presets.length,
      ),
    [q],
  );

  return (
    <Panel>
      <SubPageTop
        title={m.panelsTabs.elements.categories.backgrounds}
        placeholder={m.panelsTabs.elements.backgrounds.search}
        subtitle={m.panelsTabs.elements.backgrounds.subtitle}
      />
      <PanelScroll>
        {groups.map((g) => (
          <PanelSection key={g.id} title={g.label}>
            <ItemGrid columns={COLUMNS[g.id] ?? 4} gap={8} lazy={g.id === "photo" ? { aspect: 0.75, radius: 12 } : undefined}>
              {g.presets.map((p) => (
                <BackgroundCell key={p.id} preset={p} groupId={g.id} current={current} />
              ))}
            </ItemGrid>
          </PanelSection>
        ))}
        {!groups.length ? (
          <EmptyHint icon={<IconBackground />} title={m.panelsTabs.elements.backgrounds.noneTitle} text={m.panelsTabs.elements.backgrounds.noneText(query.trim())} />
        ) : null}
      </PanelScroll>
    </Panel>
  );
}
