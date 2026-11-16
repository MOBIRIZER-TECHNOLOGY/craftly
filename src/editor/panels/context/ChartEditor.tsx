import type { CSSProperties, ReactNode } from "react";
import { getActions } from "@/core/store";
import type { ChartElement, ChartKind } from "@/core/types";
import { m } from "@/i18n";
import { Button, IconButton, IconChart, IconChartBar, IconChartLine, IconChartPie, IconClose, IconPlus, Segmented, Switch } from "@/ui";
import { IconChartArea, IconChartDonut } from "./chartIcons";
import { addChartRow, addChartSeries, chartColor, removeChartRow, removeChartSeries, setChartPaletteColor } from "./dataEdit";
import { ColorRow, NumberCell, TextCell } from "./DataControls";
import { ColorField } from "./ColorField";
import { importChartData } from "./dataImport";
import { ImportData } from "./ImportData";
import { Section } from "./PanelShell";
import { useBatch } from "./useBatch";

const KINDS: Array<{ value: ChartKind; title: string; icon: ReactNode }> = [
  { value: "bar", title: m.panelsContext.chart.kinds.bar, icon: <IconChartBar /> },
  { value: "column", title: m.panelsContext.chart.kinds.column, icon: <IconChart /> },
  { value: "line", title: m.panelsContext.chart.kinds.line, icon: <IconChartLine /> },
  { value: "area", title: m.panelsContext.chart.kinds.area, icon: <IconChartArea /> },
  { value: "pie", title: m.panelsContext.chart.kinds.pie, icon: <IconChartPie /> },
  { value: "donut", title: m.panelsContext.chart.kinds.donut, icon: <IconChartDonut /> },
];

export function ChartEditor({ chart }: { chart: ChartElement }) {
  const batch = useBatch();
  const round = chart.chart === "pie" || chart.chart === "donut";
  const gridStyle = { "--cf-series": chart.series.length } as CSSProperties;

  const edit = (fn: (c: ChartElement) => void, coalesce?: string) =>
    getActions().updateElements(
      [chart.id],
      (el) => {
        if (el.type === "chart") fn(el);
      },
      coalesce ? { coalesce } : undefined,
    );

  return (
    <div className="cf-data">
      <Section title={m.panelsContext.chart.chartType}>
        <Segmented
          aria-label={m.panelsContext.chart.chartType}
          fullWidth
          value={chart.chart}
          options={KINDS.map((k) => ({ value: k.value, icon: k.icon, title: k.title }))}
          onChange={(kind) => edit((c) => void (c.chart = kind))}
        />
      </Section>

      <Section title={m.panelsContext.chart.data}>
        <div className="cf-data__scroll">
          <div className="cf-data__chartgrid" style={gridStyle}>
            <span className="cf-data__head">{m.panelsContext.chart.label}</span>
            {chart.series.map((s, i) => (
              <span key={i} className="cf-data__serieshead" data-dim={round && i > 0 ? "" : undefined}>
                <TextCell
                  className="is-header"
                  value={s.name}
                  label={m.panelsContext.chart.seriesName(i + 1)}
                  onText={(v) => edit((c) => void (c.series[i].name = v), `series:${chart.id}`)}
                />
                <IconButton
                  size="sm"
                  label={m.panelsContext.chart.removeSeries(i + 1)}
                  icon={<IconClose />}
                  disabled={chart.series.length <= 1}
                  onClick={() => edit((c) => removeChartSeries(c, i))}
                />
              </span>
            ))}
            <span />
            {chart.labels.map((label, r) => (
              <ChartRow key={r} chart={chart} r={r} label={label} round={round} edit={edit} />
            ))}
          </div>
        </div>
        {round ? <p className="cf-ctx__hint">{m.panelsContext.chart.roundHint}</p> : null}
        {/* a slice cannot be less than nothing: say so, where the legend still names the row */}
        {round && chart.series[0]?.values.some((v) => v < 0) ? <p className="cf-ctx__hint">{m.panelsContext.chart.negativeHint}</p> : null}
        <div className="cf-data__actions">
          <Button block variant="secondary" icon={<IconPlus />} onClick={() => edit((c) => addChartRow(c))}>
            {m.panelsContext.shared.addRow}
          </Button>
          <Button block variant="secondary" icon={<IconPlus />} onClick={() => edit((c) => addChartSeries(c))}>
            {m.panelsContext.chart.addSeries}
          </Button>
        </div>
      </Section>

      <ImportData hint={m.panelsContext.chart.importHint} onImport={(text) => importChartData(chart.id, text)} />

      <Section title={round ? m.panelsContext.chart.sliceColors : m.panelsContext.chart.seriesColors}>
        <div className="cf-data__palette">
          {chart.palette.map((color, i) => (
            <PaletteSwatch key={i} index={i} color={round ? color : chartColor(chart, i)} batch={batch} edit={edit} />
          ))}
        </div>
        <div className="cf-ctx__rows cf-data__after">
          <ColorRow label={m.panelsContext.chart.textColor} value={chart.textColor} onChange={(c) => edit((el) => void (el.textColor = c))} />
        </div>
      </Section>

      <Section title={m.panelsContext.chart.show}>
        <div className="cf-ctx__rows">
          <Switch label={m.panelsContext.chart.legend} checked={chart.showLegend} onChange={(on) => edit((c) => void (c.showLegend = on))} />
          <Switch label={m.panelsContext.chart.values} checked={chart.showValues} onChange={(on) => edit((c) => void (c.showValues = on))} />
          <Switch
            label={round ? m.panelsContext.chart.gridRound : m.panelsContext.chart.gridLines}
            disabled={round}
            checked={chart.showGrid}
            onChange={(on) => edit((c) => void (c.showGrid = on))}
          />
        </div>
      </Section>
    </div>
  );
}

function PaletteSwatch({ index, color, batch, edit }: { index: number; color: string; batch: ReturnType<typeof useBatch>; edit: (fn: (c: ChartElement) => void) => void }) {
  return (
    <ColorField
      label={m.panelsContext.chart.paletteColor(index + 1)}
      shape="circle"
      size={36}
      value={color}
      onChange={(c) => batch.run(() => edit((el) => setChartPaletteColor(el, index, c)))}
      onCommit={() => batch.end()}
    />
  );
}

function ChartRow({
  chart,
  r,
  label,
  round,
  edit,
}: {
  chart: ChartElement;
  r: number;
  label: string;
  round: boolean;
  edit: (fn: (c: ChartElement) => void, coalesce?: string) => void;
}) {
  return (
    <>
      <TextCell value={label} label={m.panelsContext.chart.rowLabel(r + 1)} onText={(v) => edit((c) => void (c.labels[r] = v), `label:${chart.id}`)} />
      {chart.series.map((s, i) => (
        <NumberCell
          key={i}
          dim={round && i > 0}
          value={s.values[r] ?? 0}
          label={m.panelsContext.chart.cell(s.name || m.panelsContext.chart.seriesFallback(i + 1), label || m.panelsContext.chart.rowFallback(r + 1))}
          onValid={(n) =>
            edit((c) => {
              const target = c.series[i];
              while (target.values.length <= r) target.values.push(0);
              target.values[r] = n;
            }, `value:${chart.id}`)
          }
        />
      ))}
      <IconButton
        size="sm"
        label={m.panelsContext.shared.removeRow(r + 1)}
        icon={<IconClose />}
        disabled={chart.labels.length <= 1}
        onClick={() => edit((c) => removeChartRow(c, r))}
      />
    </>
  );
}
