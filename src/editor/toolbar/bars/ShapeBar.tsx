/** Contextual toolbars of shapes and lines. */
import { elementPath } from "@/core/penShape";
import { getActivePage, useEditor } from "@/core/store";
import { startPathEdit } from "@/editor/canvas/pathEditStore";
import { getShape } from "@/render/shapePaths";
import type { ArrowKind, LineElement, ShapeElement, StrokeStyle } from "@/core/types";
import { m } from "@/i18n";
import { Divider, IconChevronDown, IconCombine, IconCurve, type MenuEntry } from "@/ui";
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

type Extra = { copyEnabled: boolean };

export function ShapeBar({ els, ids, copyEnabled }: BarProps<ShapeElement> & Extra) {
  // Only shapes whose outline has a corner radius (the rectangle) get the corner control.
  const rounded = els.every((e) => getShape(e.shape)?.hasRadius ?? e.shape === "rect");
  return (
    <>
      <FillButton els={els} />
      <BorderPopover els={els} ids={ids} />
      {rounded && <RadiusPopover els={els} ids={ids} />}
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

export function LineBar({ els, ids, copyEnabled }: BarProps<LineElement> & Extra) {
  const color = uniform(els, (e) => e.stroke.color);
  const weight = uniform(els, (e) => Math.round(e.stroke.width));
  const style = uniform(els, (e) => e.stroke.style);
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
