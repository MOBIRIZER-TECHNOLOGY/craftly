/** Contextual toolbars of shapes and lines. */
import { elementPath } from "@/core/penShape";
import { startPathEdit } from "@/editor/canvas/pathEditStore";
import { getShape } from "@/render/shapePaths";
import type { ArrowKind, LineElement, ShapeElement, StrokeStyle } from "@/core/types";
import { Divider, IconChevronDown, IconCurve, type MenuEntry } from "@/ui";
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
        <TBText icon={<IconCurve />} tip="Move, add and delete the points of this path" shortcut="Enter" onClick={() => startPathEdit(els[0].id)}>
          Edit points
        </TBText>
      )}
      {ids.length > 1 && <MultiActions ids={ids} />}
      <Divider vertical className="cf-tb__div" />
      <CopyStyleButton els={els} enabled={copyEnabled} />
      <MoreButton />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* lines                                                               */
/* ------------------------------------------------------------------ */

const LINE_STYLES: Array<{ value: StrokeStyle; label: string }> = [
  { value: "solid", label: "Solid" },
  { value: "dashed", label: "Dashed" },
  { value: "dotted", label: "Dotted" },
];

const ARROWS: Array<{ value: ArrowKind; label: string }> = [
  { value: "none", label: "None" },
  { value: "arrow", label: "Arrow" },
  { value: "triangle", label: "Triangle" },
  { value: "open-arrow", label: "Open arrow" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "diamond", label: "Diamond" },
  { value: "bar", label: "Bar" },
];

export function LineBar({ els, ids, copyEnabled }: BarProps<LineElement> & Extra) {
  const color = uniform(els, (e) => e.stroke.color);
  const weight = uniform(els, (e) => Math.round(e.stroke.width));
  const style = uniform(els, (e) => e.stroke.style);
  const start = uniform(els, (e) => e.startArrow);
  const end = uniform(els, (e) => e.endArrow);
  const colorOpen = useContextActive({ kind: "color", target: "stroke" });

  const styleItems: MenuEntry[] = LINE_STYLES.map((s) => ({
    id: `style-${s.value}`,
    label: s.label,
    icon: <IconStrokeStyle kind={s.value} />,
    checked: !style.mixed && style.value === s.value,
    onSelect: () =>
      editElements(
        ids,
        only("line", (l) => {
          const cap = capFor(s.value, true);
          l.stroke = { ...l.stroke, style: s.value };
          if (cap) l.stroke.cap = cap;
          else delete l.stroke.cap;
        }),
      ),
  }));

  const arrowItems = (which: "start" | "end"): MenuEntry[] => {
    const current = which === "start" ? start : end;
    return ARROWS.map((a) => ({
      id: `${which}-${a.value}`,
      label: a.label,
      icon: <ArrowheadPreview kind={a.value} end={which} />,
      checked: !current.mixed && current.value === a.value,
      onSelect: () =>
        editElements(
          ids,
          only("line", (l) => {
            if (which === "start") l.startArrow = a.value;
            else l.endArrow = a.value;
          }),
        ),
    }));
  };

  return (
    <>
      <TBIcon
        label="Line color"
        icon={<Swatch large css={color.mixed ? MIXED_SWATCH_CSS : (color.value ?? "var(--c-ink)")} />}
        active={colorOpen}
        onClick={() => toggleContext({ kind: "color", target: "stroke" })}
      />

      <PopoverButton label="Line weight" tip="Weight" icon={<IconStrokeWeight />} panelClass="cf-tbpop--narrow">
        {() => (
          <SliderField
            label="Weight"
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

      <MenuButton label="Line style" tip="Line style" icon={<IconStrokeStyle kind={style.mixed ? "solid" : (style.value ?? "solid")} />} items={styleItems} />

      <MenuButton
        label="Start arrowhead"
        tip="Start arrowhead"
        icon={<ArrowheadPreview kind={start.mixed ? "none" : (start.value ?? "none")} end="start" />}
        iconRight={<IconChevronDown />}
        text="Start"
        items={() => arrowItems("start")}
      />
      <MenuButton
        label="End arrowhead"
        tip="End arrowhead"
        icon={<ArrowheadPreview kind={end.mixed ? "none" : (end.value ?? "none")} end="end" />}
        iconRight={<IconChevronDown />}
        text="End"
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
