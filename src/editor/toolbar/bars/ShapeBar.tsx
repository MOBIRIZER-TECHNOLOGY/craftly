/** Contextual toolbars of shapes and lines. */
import { createImage } from "@/core/factory";
import { lineEndpoints, lineFromRoute } from "@/core/connectors";
import { elementPath } from "@/core/penShape";
import { getActions, getActivePage, useEditor } from "@/core/store";
import { startPathEdit } from "@/editor/canvas/pathEditStore";
import { getShape } from "@/render/shapePaths";
import type { ArrowKind, LineElement, LineRouting, ShapeElement, StrokeStyle } from "@/core/types";
import { m } from "@/i18n";
import { Divider, IconChevronDown, IconCombine, IconCurve, IconLine, IconSliders, IconText, TextField, type MenuEntry } from "@/ui";
import {
  BorderPopover,
  CopyStyleButton,
  EffectsButton,
  FillButton,
  FlipMenu,
  MoreButton,
  MultiActions,
  AnimateButton,
  PositionButton,
  RadiusPopover,
  Swatch,
  TransparencyButton,
  capFor,
  type BarProps,
} from "../common";
import { combineMenuItems } from "../combine";
import { ArrowheadPreview, IconStrokeStyle, IconStrokeWeight } from "../icons";
import { MenuButton, PopoverButton, SliderField, TBIcon, TBText, toggleContext, useContextActive } from "../kit";
import { MIXED_SWATCH_CSS, editElements, only, uniform } from "../selection";
import { paramControlsFor, setShapeParam, shapeParam } from "../shapeParams";

type Extra = { copyEnabled: boolean };

export function ShapeBar({ els, ids, copyEnabled }: BarProps<ShapeElement> & Extra) {
  // Only shapes whose outline has a corner radius (the rectangle) get the corner control.
  const rounded = els.every((e) => getShape(e.shape)?.hasRadius ?? e.shape === "rect");
  // the numbers a polygon, a star and their like are drawn from, when the selected shapes are all of one such kind
  const controls = paramControlsFor(els);
  return (
    <>
      <FillButton els={els} />
      <BorderPopover els={els} ids={ids} />
      {rounded && <RadiusPopover els={els} ids={ids} />}
      {controls.length > 0 && (
        <PopoverButton label={m.editor.shapeBar.shapeOptions} tip={m.editor.shapeBar.shapeOptionsTip} icon={<IconSliders />} panelClass="cf-tbpop--narrow">
          {() => (
            <>
              {controls.map((control) => {
                const value = uniform(els, (e) => shapeParam(e, control));
                return (
                  <SliderField
                    key={control.key}
                    label={control.percent ? m.editor.shapeBar.percent(control.label) : control.label}
                    value={value.value ?? control.min}
                    mixed={value.mixed}
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    onChange={(v) =>
                      editElements(
                        ids,
                        only("shape", (s) => setShapeParam(s, control, v)),
                        `shapeparam-${control.key}`,
                      )
                    }
                  />
                );
              })}
            </>
          )}
        </PopoverButton>
      )}
      <TransparencyButton els={els} ids={ids} />
      <EffectsButton />
      <FlipMenu />
      <AnimateButton />
      <PositionButton />
      {els.length === 1 && elementPath(els[0]) && (
        <TBText icon={<IconCurve />} tip={m.editor.shapeBar.editPointsTip} shortcut="Enter" onClick={() => startPathEdit(els[0].id)}>
          {m.editor.shapeBar.editPoints}
        </TBText>
      )}
      {els.length === 1 && els[0].shape === "path" && els[0].path ? (
        <TBText
          icon={<IconCurve />}
          tip={m.editor.shapeBar.useAsFrame}
          onClick={() =>
            getActions().replaceElements(
              [els[0].id],
              createImage({
                src: null,
                x: els[0].x,
                y: els[0].y,
                width: els[0].width,
                height: els[0].height,
                rotation: els[0].rotation,
                mask: "path",
                maskPath: els[0].path,
                isFrame: true,
                name: m.editor.shapeBar.useAsFrame,
              }),
            )
          }
        >
          {m.editor.shapeBar.useAsFrame}
        </TBText>
      ) : null}
      {ids.length > 1 && (
        <>
          <MultiActions ids={ids} />
          <MenuButton
            label={m.editor.shapeBar.combine}
            tip={m.editor.shapeBar.combineTip}
            icon={<IconCombine />}
            iconRight={<IconChevronDown />}
            text={m.editor.shapeBar.combine}
            items={() => combineMenuItems(getActivePage(useEditor.getState()), ids)}
          />
        </>
      )}
      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* lines                                                               */
/* ------------------------------------------------------------------ */

const LINE_STYLES: StrokeStyle[] = ["solid", "dashed", "dotted"];

const ARROWS: ArrowKind[] = ["none", "arrow", "triangle", "open-arrow", "circle", "square", "diamond", "bar"];
const ROUTES: LineRouting[] = ["straight", "elbow", "curved"];

export function LineBar({ els, ids, copyEnabled }: BarProps<LineElement> & Extra) {
  const color = uniform(els, (e) => e.stroke.color);
  const weight = uniform(els, (e) => Math.round(e.stroke.width));
  const style = uniform(els, (e) => e.stroke.style);
  const routing = uniform(els, (e) => e.routing ?? "straight");
  const label = uniform(els, (e) => e.label ?? "");
  const start = uniform(els, (e) => e.startArrow);
  const end = uniform(els, (e) => e.endArrow);
  const colorOpen = useContextActive({ kind: "color", target: "stroke" });

  const styleItems: MenuEntry[] = LINE_STYLES.map((s) => ({
    id: `style-${s}`,
    label: m.editor.toolbar.strokeStyles[s],
    icon: <IconStrokeStyle kind={s} />,
    checked: !style.mixed && style.value === s,
    onSelect: () =>
      editElements(
        ids,
        only("line", (l) => {
          const cap = capFor(s, true);
          l.stroke = { ...l.stroke, style: s };
          if (cap) l.stroke.cap = cap;
          else delete l.stroke.cap;
        }),
      ),
  }));

  const routeItems: MenuEntry[] = ROUTES.map((route) => ({
    id: `route-${route}`,
    label: m.editor.shapeBar.routes[route],
    checked: !routing.mixed && routing.value === route,
    onSelect: () =>
      editElements(
        ids,
        only("line", (line) => {
          const ends = lineEndpoints(line);
          Object.assign(line, lineFromRoute(ends.start, ends.end, route));
          line.routing = route;
        }),
      ),
  }));

  const arrowItems = (which: "start" | "end"): MenuEntry[] => {
    const current = which === "start" ? start : end;
    return ARROWS.map((a) => ({
      id: `${which}-${a}`,
      label: m.editor.shapeBar.arrows[a],
      icon: <ArrowheadPreview kind={a} end={which} />,
      checked: !current.mixed && current.value === a,
      onSelect: () =>
        editElements(
          ids,
          only("line", (l) => {
            if (which === "start") l.startArrow = a;
            else l.endArrow = a;
          }),
        ),
    }));
  };

  return (
    <>
      <TBIcon
        label={m.editor.shapeBar.lineColor}
        icon={<Swatch large css={color.mixed ? MIXED_SWATCH_CSS : (color.value ?? "var(--c-ink)")} />}
        active={colorOpen}
        onClick={() => toggleContext({ kind: "color", target: "stroke" })}
      />

      <PopoverButton label={m.editor.shapeBar.lineWeight} tip={m.editor.shapeBar.weight} icon={<IconStrokeWeight />} panelClass="cf-tbpop--narrow">
        {() => (
          <SliderField
            label={m.editor.shapeBar.weight}
            value={weight.value ?? 1}
            mixed={weight.mixed}
            min={1}
            max={60}
            step={1}
            onChange={(v) =>
              editElements(
                ids,
                only("line", (l) => {
                  l.stroke.width = v;
                }),
                "lineWeight",
              )
            }
          />
        )}
      </PopoverButton>

      <MenuButton
        label={m.editor.shapeBar.lineStyle}
        tip={m.editor.shapeBar.lineStyle}
        icon={<IconStrokeStyle kind={style.mixed ? "solid" : (style.value ?? "solid")} />}
        items={styleItems}
      />

      <MenuButton label={m.editor.shapeBar.routing} tip={m.editor.shapeBar.routing} icon={<IconLine />} items={routeItems} />

      <PopoverButton label={m.editor.shapeBar.lineLabel} tip={m.editor.shapeBar.lineLabelTip} icon={<IconText />} panelClass="cf-tbpop--narrow">
        {() => (
          <TextField
            label={m.editor.shapeBar.lineLabel}
            value={label.mixed ? "" : (label.value ?? "")}
            maxLength={120}
            onChange={(event) =>
              editElements(
                ids,
                only("line", (line) => {
                  if (event.target.value) line.label = event.target.value;
                  else delete line.label;
                }),
                "line-label",
              )
            }
          />
        )}
      </PopoverButton>

      <MenuButton
        label={m.editor.shapeBar.startArrowhead}
        tip={m.editor.shapeBar.startArrowhead}
        icon={<ArrowheadPreview kind={start.mixed ? "none" : (start.value ?? "none")} end="start" />}
        iconRight={<IconChevronDown />}
        text={m.editor.shapeBar.start}
        items={() => arrowItems("start")}
      />
      <MenuButton
        label={m.editor.shapeBar.endArrowhead}
        tip={m.editor.shapeBar.endArrowhead}
        icon={<ArrowheadPreview kind={end.mixed ? "none" : (end.value ?? "none")} end="end" />}
        iconRight={<IconChevronDown />}
        text={m.editor.shapeBar.end}
        items={() => arrowItems("end")}
      />

      <TransparencyButton els={els} ids={ids} />
      <AnimateButton />
      <PositionButton />
      {ids.length > 1 && <MultiActions ids={ids} />}
      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}
