import { useMemo } from "react";
import { createChart } from "@/core/factory";
import { getActions, useEditor } from "@/core/store";
import type { ChartKind } from "@/core/types";
import { m } from "@/i18n";
import { IconChart } from "@/ui";
import { DraggableItem } from "../../shared/DraggableItem";
import { EmptyHint } from "../../shared/EmptyHint";
import { ItemGrid } from "../../shared/ItemGrid";
import { Panel, PanelScroll } from "../../shared/PanelLayout";
import { useElementsNav } from "./nav";
import { SubPageTop } from "./SubPageTop";
import "./DataPages.css";

interface ChartDef {
  kind: ChartKind;
  name: string;
  hint: string;
}

const CHARTS: ChartDef[] = [
  { kind: "column", ...m.panelsTabs.elements.charts.kinds.column },
  { kind: "bar", ...m.panelsTabs.elements.charts.kinds.bar },
  { kind: "line", ...m.panelsTabs.elements.charts.kinds.line },
  { kind: "area", ...m.panelsTabs.elements.charts.kinds.area },
  { kind: "pie", ...m.panelsTabs.elements.charts.kinds.pie },
  { kind: "donut", ...m.panelsTabs.elements.charts.kinds.donut },
];

const PALETTE = createChart().palette;
const VALUES = [32, 48, 41, 66];

/** A chart sized for the open page. Pies and donuts are squarer and show their legend. */
function buildChart(kind: ChartKind) {
  const design = useEditor.getState().design;
  const dw = design?.width ?? 1920;
  const dh = design?.height ?? 1080;
  const min = Math.min(dw, dh);
  if (kind === "pie" || kind === "donut") {
    const s = Math.round(min * 0.55);
    return createChart({ chart: kind, width: Math.round(s * 1.3), height: s, showLegend: true, showGrid: false });
  }
  const width = Math.round(Math.min(dw * 0.6, min * 1.15));
  return createChart({ chart: kind, width, height: Math.round(width * 0.62) });
}

/* ------------------------------------------------------------------ */
/* previews                                                             */
/* ------------------------------------------------------------------ */

const polar = (cx: number, cy: number, r: number, turn: number) => [cx + r * Math.cos(turn * Math.PI * 2 - Math.PI / 2), cy + r * Math.sin(turn * Math.PI * 2 - Math.PI / 2)];

function PiePreview({ donut }: { donut: boolean }) {
  const total = VALUES.reduce((a, b) => a + b, 0);
  let acc = 0;
  const cx = 60;
  const cy = 40;
  const r = 32;
  return (
    <>
      {VALUES.map((v, i) => {
        const a0 = acc / total;
        acc += v;
        const a1 = acc / total;
        const [x0, y0] = polar(cx, cy, r, a0);
        const [x1, y1] = polar(cx, cy, r, a1);
        const large = a1 - a0 > 0.5 ? 1 : 0;
        return (
          <path key={i} d={`M${cx} ${cy} L${x0} ${y0} A${r} ${r} 0 ${large} 1 ${x1} ${y1} Z`} fill={PALETTE[i]} stroke="var(--c-bg)" strokeWidth="1.5" strokeLinejoin="round" />
        );
      })}
      {donut ? <circle cx={cx} cy={cy} r={r * 0.55} fill="var(--c-bg-subtle)" /> : null}
    </>
  );
}

function ChartPreview({ kind }: { kind: ChartKind }) {
  const max = Math.max(...VALUES);
  return (
    <svg viewBox="0 0 120 80" className="cf-chart-preview" aria-hidden="true">
      {kind === "column" ? (
        <>
          <path d="M12 68H108M12 48H108M12 28H108" className="cf-chart-preview__grid" />
          {VALUES.map((v, i) => {
            const h = (v / max) * 52;
            return <rect key={i} x={20 + i * 22} y={68 - h} width="14" height={h} rx="3" fill={PALETTE[0]} opacity={0.55 + i * 0.15} />;
          })}
        </>
      ) : null}
      {kind === "bar" ? (
        <>
          <path d="M26 10V70" className="cf-chart-preview__grid" />
          {VALUES.map((v, i) => (
            <rect key={i} x="26" y={12 + i * 15} width={(v / max) * 80} height="10" rx="3" fill={PALETTE[0]} opacity={0.55 + i * 0.15} />
          ))}
        </>
      ) : null}
      {kind === "line" || kind === "area" ? (
        <>
          <path d="M12 68H108M12 48H108M12 28H108" className="cf-chart-preview__grid" />
          {(() => {
            const pts = VALUES.map((v, i) => [18 + i * 28, 68 - (v / max) * 50]);
            const line = pts.map(([x, y], i) => `${i ? "L" : "M"}${x} ${y}`).join("");
            return (
              <>
                {kind === "area" ? <path d={`${line}L${pts[pts.length - 1][0]} 68L${pts[0][0]} 68Z`} fill={PALETTE[0]} opacity="0.22" /> : null}
                <path d={line} fill="none" stroke={PALETTE[0]} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
                {pts.map(([x, y], i) => (
                  <circle key={i} cx={x} cy={y} r="3.4" fill="var(--c-bg)" stroke={PALETTE[0]} strokeWidth="2" />
                ))}
              </>
            );
          })()}
        </>
      ) : null}
      {kind === "pie" || kind === "donut" ? <PiePreview donut={kind === "donut"} /> : null}
    </svg>
  );
}

export function ChartsPage() {
  const query = useElementsNav((s) => s.query);
  const q = query.trim().toLowerCase();
  const charts = useMemo(() => CHARTS.filter((c) => !q || `${c.name} ${c.hint} ${c.kind} chart graph`.toLowerCase().includes(q)), [q]);
  return (
    <Panel>
      <SubPageTop title={m.panelsTabs.elements.categories.charts} placeholder={m.panelsTabs.elements.charts.search} subtitle={m.panelsTabs.elements.charts.subtitle} />
      <PanelScroll>
        {charts.length ? (
          <ItemGrid columns={2} minCell={130} gap={10}>
            {charts.map((c) => (
              <DraggableItem
                key={c.kind}
                label={c.name}
                onInsert={() => void getActions().addElement(buildChart(c.kind))}
                getPayload={() => ({ type: "elements", elements: [buildChart(c.kind)] })}
                className="cf-cell cf-chart-cell"
              >
                <ChartPreview kind={c.kind} />
                <span className="cf-chart-cell__name">{c.name}</span>
              </DraggableItem>
            ))}
          </ItemGrid>
        ) : (
          <EmptyHint icon={<IconChart />} title={m.panelsTabs.elements.charts.noneTitle} text={m.panelsTabs.elements.charts.noneText(query.trim())} />
        )}
      </PanelScroll>
    </Panel>
  );
}
