import { useMemo } from "react";
import { getActions } from "@/core/store";
import { ELLIPSE_PRESET, LINE_PRESETS, ROUNDED_RECT_PRESET, SHAPE_GROUP_LABELS, SHAPE_PRESETS, createLineFromPreset, type LinePreset, type ShapePreset } from "@/data/shapes";
import type { ArrowKind } from "@/core/types";
import { englishName } from "@/data/names";
import { m } from "@/i18n";
import { IconShapes } from "@/ui";
import { DraggableItem } from "../../shared/DraggableItem";
import { EmptyHint } from "../../shared/EmptyHint";
import { ItemGrid } from "../../shared/ItemGrid";
import { Panel, PanelScroll, PanelSection } from "../../shared/PanelLayout";
import { designMin } from "../../shared/panelActions";
import { ShapeCell } from "./cells";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./ShapesPage.css";

const GROUP_ORDER = Object.keys(SHAPE_GROUP_LABELS) as Array<keyof typeof SHAPE_GROUP_LABELS>;

/** Every shape preset, with the rounded square right after the plain square and the ellipse right after the circle. */
export const ALL_SHAPE_PRESETS: ShapePreset[] = (() => {
  const list = [...SHAPE_PRESETS];
  const square = list.findIndex((p) => p.id === "rect");
  list.splice(square < 0 ? 0 : square + 1, 0, ROUNDED_RECT_PRESET);
  const circle = list.findIndex((p) => p.id === "ellipse");
  list.splice(circle < 0 ? list.length : circle + 1, 0, ELLIPSE_PRESET);
  return list;
})();

export const matchShape = (p: ShapePreset, q: string): boolean => !q || `${p.name} ${SHAPE_GROUP_LABELS[p.group]} ${p.id} ${p.keywords ?? ""}`.toLowerCase().includes(q);
export const matchLine = (p: LinePreset, q: string): boolean => !q || `${p.name} ${englishName("lines", p.id)} line arrow`.toLowerCase().includes(q);

/* ------------------------------------------------------------------ */
/* line previews                                                        */
/* ------------------------------------------------------------------ */

function Head({ kind, x, dir }: { kind: ArrowKind; x: number; dir: 1 | -1 }) {
  const y = 12;
  switch (kind) {
    case "arrow":
    case "triangle":
      return <path d={`M${x} ${y} l${-dir * 10} -6 l0 12 z`} fill="currentColor" />;
    case "open-arrow":
      return (
        <path d={`M${x - dir * 9} ${y - 7} L${x} ${y} L${x - dir * 9} ${y + 7}`} fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
      );
    case "circle":
      return <circle cx={x - dir * 4} cy={y} r="4.2" fill="currentColor" />;
    case "square":
      return <rect x={x - dir * 8} y={y - 4} width="8" height="8" fill="currentColor" />;
    case "diamond":
      return <path d={`M${x} ${y} l${-dir * 6} -5 l${-dir * 6} 5 l${dir * 6} 5 z`} fill="currentColor" />;
    case "bar":
      return <line x1={x} y1={y - 7} x2={x} y2={y + 7} stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" />;
    default:
      return null;
  }
}

const headInset = (kind: ArrowKind) => (kind === "none" ? 0 : kind === "open-arrow" || kind === "bar" ? 2 : 9);

export function LinePreview({ preset }: { preset: LinePreset }) {
  const x0 = 12;
  const x1 = 108;
  const dash = preset.stroke.style === "dashed" ? "7 6" : preset.stroke.style === "dotted" ? "0.1 6" : undefined;
  return (
    <svg viewBox="0 0 120 24" width="100%" height="24" aria-hidden="true">
      <line
        x1={x0 + headInset(preset.start)}
        y1="12"
        x2={x1 - headInset(preset.end)}
        y2="12"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap={preset.stroke.cap === "butt" ? "butt" : "round"}
        strokeDasharray={dash}
      />
      <Head kind={preset.start} x={x0} dir={-1} />
      <Head kind={preset.end} x={x1} dir={1} />
    </svg>
  );
}

/** The "Lines" group: plain, dashed and dotted lines and the arrows. */
export function LinesSection({ query, limit }: { query: string; limit?: number }) {
  const presets = LINE_PRESETS.filter((p) => matchLine(p, query)).slice(0, limit);
  if (!presets.length) return null;
  return (
    <ItemGrid columns={2} minCell={120} gap={8}>
      {presets.map((p) => {
        const make = () => createLineFromPreset(p, designMin());
        return (
          <DraggableItem
            key={p.id}
            label={p.name}
            onInsert={() => void getActions().addElement(make())}
            getPayload={() => ({ type: "elements", elements: [make()] })}
            className="cf-cell cf-line-cell"
          >
            <LinePreview preset={p} />
          </DraggableItem>
        );
      })}
    </ItemGrid>
  );
}

/* ------------------------------------------------------------------ */
/* pages                                                                */
/* ------------------------------------------------------------------ */

export function ShapesPage() {
  const query = useElementsNav((s) => s.query);
  const q = query.trim().toLowerCase();

  const groups = useMemo(
    () =>
      GROUP_ORDER.map((id) => ({ id, label: SHAPE_GROUP_LABELS[id], presets: ALL_SHAPE_PRESETS.filter((p) => p.group === id && matchShape(p, q)) })).filter(
        (g) => g.presets.length,
      ),
    [q],
  );
  const hasLines = LINE_PRESETS.some((p) => matchLine(p, q));

  return (
    <Panel>
      <SubPageTop title={m.panelsTabs.elements.categories.shapes} placeholder={m.panelsTabs.elements.shapes.search} />
      <PanelScroll>
        {groups.map((g) => (
          <PanelSection key={g.id} title={g.label}>
            <ItemGrid columns={4} minCell={64} gap={8}>
              {g.presets.map((p) => (
                <ShapeCell key={p.id} preset={p} />
              ))}
            </ItemGrid>
          </PanelSection>
        ))}
        {hasLines ? (
          <PanelSection title={m.panelsTabs.elements.categories.lines}>
            <LinesSection query={q} />
          </PanelSection>
        ) : null}
        {!groups.length && !hasLines ? (
          <EmptyHint icon={<IconShapes />} title={m.panelsTabs.elements.shapes.noneTitle} text={m.panelsTabs.elements.shapes.noneText(query.trim())} />
        ) : null}
      </PanelScroll>
    </Panel>
  );
}

export function LinesPage() {
  const query = useElementsNav((s) => s.query);
  const q = query.trim().toLowerCase();
  const found = LINE_PRESETS.some((p) => matchLine(p, q));
  return (
    <Panel>
      <SubPageTop title={m.panelsTabs.elements.categories.lines} placeholder={m.panelsTabs.elements.lines.search} />
      <PanelScroll>
        {found ? (
          <LinesSection query={q} />
        ) : (
          <EmptyHint icon={<IconShapes />} title={m.panelsTabs.elements.lines.noneTitle} text={m.panelsTabs.elements.lines.noneText(query.trim())} />
        )}
      </PanelScroll>
    </Panel>
  );
}
