/**
 * Controls that appear on several of the contextual toolbars: transparency, effects, position, copy style,
 * flip, align, border and corner radius, plus the "..." menu.
 */
import type { CSSProperties, ReactElement } from "react";
import { BLEND_MODES, blendLabel, blendOf } from "@/core/blend";
import { connectable } from "@/core/connectors";
import { DEFAULT_INK } from "@/core/factory";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { BlendMode, DesignElement, ID, ImageElement, ShapeElement, Stroke, StrokeStyle, VideoElement } from "@/core/types";
import {
  Button,
  IconAlignObjBottom,
  IconAlignObjCenter,
  IconAlignObjLeft,
  IconAlignObjMiddle,
  IconAlignObjRight,
  IconAlignObjTop,
  IconChevronDown,
  IconConnect,
  IconCopyStyle,
  IconCornerRadius,
  IconDistributeH,
  IconDistributeV,
  IconFlipH,
  IconFlipV,
  IconGroup,
  IconMore,
  Segmented,
  Select,
  cx,
  type MenuEntry,
  type SelectOption,
} from "@/ui";
import { m } from "@/i18n";
import { buildContextMenuItems } from "./contextMenuItems";
import { IconBorderBox, IconChecker, IconStrokeStyle } from "./icons";
import { MenuButton, PopLabel, PopoverButton, SliderField, TBIcon, TBText, toggleContext, useContextActive } from "./kit";
import { MIXED_SWATCH_CSS, NO_FILL_CSS, editElements, fillCss, uniform } from "./selection";

export interface BarProps<E extends DesignElement = DesignElement> {
  els: E[];
  ids: ID[];
}

/** A round colour chip drawn from any CSS background value. */
export function Swatch({ css, large, square }: { css: string; large?: boolean; square?: boolean }) {
  return <span className={cx("cf-tb__swatch", large && "cf-tb__swatch--lg", square && "cf-tb__swatch--square")} style={{ "--cf-sw": css } as CSSProperties} />;
}

/* ------------------------------------------------------------------ */
/* transparency / effects / position                                   */
/* ------------------------------------------------------------------ */

/** Normal, which is no mode and so is not stored, and then the modes in the order of a photo editor's list. */
const blendOptions = (): SelectOption<string>[] => [
  { value: "normal", label: m.editor.toolbar.blendNormal },
  ...BLEND_MODES.map((mode) => ({ value: mode, label: blendLabel(mode) })),
];

export function TransparencyButton({ els, ids }: BarProps) {
  const opacity = uniform(els, (e) => Math.round(e.opacity * 100));
  const mode = uniform(els, (e) => blendOf(e) ?? "normal");
  return (
    <PopoverButton label={m.editor.toolbar.transparency} tip={m.editor.toolbar.transparencyTip} icon={<IconChecker />} panelClass="cf-tbpop--narrow">
      {() => (
        <div className="cf-tbpop__stack">
          <SliderField
            label={m.editor.toolbar.transparency}
            value={opacity.value ?? 100}
            mixed={opacity.mixed}
            min={0}
            max={100}
            step={1}
            onChange={(v) =>
              editElements(
                ids,
                (el) => {
                  el.opacity = v / 100;
                },
                "opacity",
              )
            }
          />
          <div className="cf-tbpop__field">
            <PopLabel>{m.editor.toolbar.blendMode}</PopLabel>
            <Select<string>
              size="sm"
              aria-label={m.editor.toolbar.blendMode}
              value={mode.mixed ? null : (mode.value ?? "normal")}
              placeholder={m.editor.toolbar.mixed}
              options={blendOptions()}
              onChange={(chosen) =>
                editElements(ids, (el) => {
                  if (chosen === "normal") delete el.blend;
                  else el.blend = chosen as BlendMode;
                })
              }
            />
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

export function EffectsButton() {
  const active = useContextActive({ kind: "effects" });
  return (
    <TBText tip={m.editor.toolbar.effectsTip} active={active} onClick={() => toggleContext({ kind: "effects" })}>
      {m.editor.toolbar.effects}
    </TBText>
  );
}

export function AnimateButton({ tab = "element" }: { tab?: "element" | "page" }) {
  const active = useContextActive({ kind: "animate", tab });
  return (
    <TBText tip={tab === "page" ? m.editor.toolbar.animatePageTip : m.editor.toolbar.animateElementTip} active={active} onClick={() => toggleContext({ kind: "animate", tab })}>
      {m.editor.toolbar.animate}
    </TBText>
  );
}

export function PositionButton() {
  const active = useContextActive({ kind: "position", tab: "arrange" });
  return (
    <TBText tip={m.editor.toolbar.positionTip} active={active} onClick={() => toggleContext({ kind: "position", tab: "arrange" })}>
      {m.editor.toolbar.position}
    </TBText>
  );
}

/* ------------------------------------------------------------------ */
/* copy style, more                                                    */
/* ------------------------------------------------------------------ */

/**
 * First click copies the style of the selected element; the button then reads "Paste style" for as long
 * as a compatible style is on the clipboard. Pasting once clears it (like a format painter).
 */
export function CopyStyleButton({ els, enabled = true }: { els: DesignElement[]; enabled?: boolean }) {
  const clip = useEditor((s) => s.styleClipboard);
  const type = els[0]?.type;
  const armed = !!clip && !!type && clip.__type === type && els.every((e) => e.type === type);
  if (!enabled || (els.length !== 1 && !armed)) return null;
  return (
    <TBIcon
      label={armed ? m.editor.actions.pasteStyle : m.editor.actions.copyStyle}
      tip={armed ? m.editor.toolbar.pasteStyleTip : m.editor.actions.copyStyle}
      shortcut={armed ? "Ctrl+Alt+V" : "Ctrl+Alt+C"}
      icon={<IconCopyStyle />}
      active={armed}
      onClick={() => {
        const { actions } = useEditor.getState();
        if (armed) {
          actions.pasteStyle();
          useEditor.setState({ styleClipboard: null });
        } else actions.copyStyle();
      }}
    />
  );
}

/** The "..." button: same menu as a right-click on the selection. */
export function MoreButton() {
  return (
    <MenuButton
      label={m.editor.toolbar.moreActions}
      tip={m.editor.toolbar.more}
      icon={<IconMore />}
      placement="bottom-end"
      items={() => buildContextMenuItems(useEditor.getState())}
    />
  );
}

/* ------------------------------------------------------------------ */
/* flip / group / align                                                */
/* ------------------------------------------------------------------ */

export function FlipMenu() {
  const a = getActions();
  // lucide 1.68 names its flip glyphs by the direction of the centre line: "FlipVertical2" (IconFlipV) has a
  // vertical line with triangles left and right - that is the picture of a horizontal flip, and vice versa.
  const items: MenuEntry[] = [
    { id: "flip-h", label: m.editor.toolbar.flipHorizontal, icon: <IconFlipV />, onSelect: () => a.flip("horizontal") },
    { id: "flip-v", label: m.editor.toolbar.flipVertical, icon: <IconFlipH />, onSelect: () => a.flip("vertical") },
  ];
  return <MenuButton label={m.editor.toolbar.flip} tip={m.editor.toolbar.flip} icon={<IconFlipV />} items={items} />;
}

/** Group + Align, offered whenever several elements are selected. */
export function MultiActions({ ids }: { ids: ID[] }) {
  const a = getActions();
  const canConnect = useEditor((s) => !!connectable(getActivePage(s), ids));
  const align = (mode: "left" | "center" | "right" | "top" | "middle" | "bottom", label: string, icon: ReactElement): MenuEntry => ({
    id: `align-${mode}`,
    label,
    icon,
    onSelect: () => a.align(mode, "selection"),
  });
  const items: MenuEntry[] = [
    align("left", m.editor.align.left, <IconAlignObjLeft />),
    align("center", m.editor.align.center, <IconAlignObjCenter />),
    align("right", m.editor.align.right, <IconAlignObjRight />),
    { type: "divider" },
    align("top", m.editor.align.top, <IconAlignObjTop />),
    align("middle", m.editor.align.middle, <IconAlignObjMiddle />),
    align("bottom", m.editor.align.bottom, <IconAlignObjBottom />),
    { type: "divider" },
    {
      id: "distribute-h",
      label: m.editor.toolbar.distributeHorizontally,
      icon: <IconDistributeH />,
      hint: ids.length < 3 ? "3+" : undefined,
      disabled: ids.length < 3,
      onSelect: () => a.distribute("horizontal"),
    },
    {
      id: "distribute-v",
      label: m.editor.toolbar.distributeVertically,
      icon: <IconDistributeV />,
      hint: ids.length < 3 ? "3+" : undefined,
      disabled: ids.length < 3,
      onSelect: () => a.distribute("vertical"),
    },
  ];
  return (
    <>
      <TBText icon={<IconGroup />} tip={m.editor.toolbar.groupTip} shortcut="Ctrl+G" onClick={() => a.groupSelection()}>
        {m.editor.actions.group}
      </TBText>
      <MenuButton
        label={m.editor.toolbar.align}
        tip={m.editor.toolbar.alignTip}
        icon={<IconAlignObjLeft />}
        iconRight={<IconChevronDown />}
        text={m.editor.toolbar.align}
        items={items}
      />
      {canConnect && (
        <TBText icon={<IconConnect />} tip={m.editor.toolbar.connectTip} onClick={() => a.connect(ids[0], ids[1])}>
          {m.editor.actions.connect}
        </TBText>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* border + corner radius (shapes and images)                          */
/* ------------------------------------------------------------------ */

type Bordered = ShapeElement | ImageElement | VideoElement;

const STROKE_STYLES: Array<"none" | StrokeStyle> = ["none", "solid", "dashed", "dotted"];

const strokeStyleName = (value: "none" | StrokeStyle): string => (value === "none" ? m.editor.toolbar.noBorder : m.editor.toolbar.strokeStyles[value]);

/** Cap that makes each stroke style look right (dashes need butt caps, dots need round ones). */
export function capFor(style: StrokeStyle, line: boolean): Stroke["cap"] {
  if (style === "dotted") return "round";
  if (style === "dashed") return "butt";
  return line ? "round" : undefined;
}

/** A visible default border for the current design size. */
function defaultStroke(style: StrokeStyle = "solid"): Stroke {
  const d = useEditor.getState().design;
  const width = Math.max(2, Math.round(Math.min(d?.width ?? 1000, d?.height ?? 1000) * 0.004));
  const cap = capFor(style, false);
  return { color: DEFAULT_INK, width, style, ...(cap ? { cap } : {}) };
}

function setBorderStyle(ids: ID[], value: "none" | StrokeStyle): void {
  editElements(ids, (el) => {
    if (el.type !== "shape" && el.type !== "image" && el.type !== "video") return;
    if (value === "none") {
      el.stroke = null;
      return;
    }
    const cur = el.stroke && el.stroke.width > 0 ? el.stroke : null;
    const base = cur ?? defaultStroke(value);
    const cap = capFor(value, false);
    const next: Stroke = { ...base, style: value };
    if (cap) next.cap = cap;
    else delete next.cap;
    el.stroke = next;
  });
}

function setBorderWeight(ids: ID[], width: number): void {
  editElements(
    ids,
    (el) => {
      if (el.type !== "shape" && el.type !== "image" && el.type !== "video") return;
      if (el.stroke) el.stroke.width = width;
      else if (width > 0) el.stroke = { ...defaultStroke(), width };
    },
    "borderWeight",
  );
}

/** Border style, weight and colour in one popover. */
export function BorderPopover({ els, ids }: { els: Bordered[]; ids: ID[] }) {
  const style = uniform(els, (e) => (e.stroke && e.stroke.width > 0 ? e.stroke.style : "none"));
  const width = uniform(els, (e) => e.stroke?.width ?? 0);
  const color = uniform(els, (e) => e.stroke?.color ?? DEFAULT_INK);
  const hasBorder = els.some((e) => e.stroke && e.stroke.width > 0);
  return (
    <PopoverButton label={m.editor.toolbar.border} tip={m.editor.toolbar.borderTip} icon={<IconBorderBox />} active={hasBorder}>
      {({ close }) => (
        <div className="cf-tbpop__stack">
          <div className="cf-tbpop__field">
            <PopLabel>{m.editor.toolbar.borderStyle}</PopLabel>
            <Segmented
              size="sm"
              fullWidth
              aria-label={m.editor.toolbar.borderStyle}
              // with mixed borders the first element's style shows (a group with nothing selected cannot be reached by keyboard)
              value={style.value ?? "none"}
              onChange={(v) => setBorderStyle(ids, v)}
              options={STROKE_STYLES.map((s) => ({ value: s, title: strokeStyleName(s), icon: <IconStrokeStyle kind={s} /> }))}
            />
          </div>
          <SliderField label={m.editor.toolbar.borderWeight} value={width.value ?? 0} mixed={width.mixed} min={0} max={40} step={1} onChange={(v) => setBorderWeight(ids, v)} />
          <div className="cf-tbpop__split">
            <PopLabel>{m.editor.toolbar.borderColor}</PopLabel>
            <Button
              variant="secondary"
              icon={<Swatch css={color.mixed ? MIXED_SWATCH_CSS : (color.value ?? DEFAULT_INK)} />}
              onClick={() => {
                // Make sure there is a border to recolour, then hand over to the colour panel.
                if (!hasBorder) setBorderStyle(ids, "solid");
                toggleContext({ kind: "color", target: "stroke" });
                close();
              }}
            >
              {m.editor.toolbar.color}
            </Button>
          </div>
        </div>
      )}
    </PopoverButton>
  );
}

/** Corner radius slider (0 .. half of the shortest side). */
export function RadiusPopover({ els, ids }: { els: Bordered[]; ids: ID[] }) {
  const radius = uniform(els, (e) => Math.round(e.radius));
  const max = Math.max(1, Math.floor(Math.min(...els.map((e) => Math.min(e.width, e.height) / 2))));
  return (
    <PopoverButton label={m.editor.toolbar.cornerRadius} tip={m.editor.toolbar.cornerRadiusTip} icon={<IconCornerRadius />} panelClass="cf-tbpop--narrow">
      {() => (
        <SliderField
          label={m.editor.toolbar.cornerRadius}
          value={radius.value ?? 0}
          mixed={radius.mixed}
          min={0}
          max={max}
          step={1}
          onChange={(v) =>
            editElements(
              ids,
              (el) => {
                if (el.type === "shape" || el.type === "image" || el.type === "video") el.radius = v;
              },
              "radius",
            )
          }
        />
      )}
    </PopoverButton>
  );
}

/** Fill swatch of a shape: opens the colour panel for the fill. */
export function FillButton({ els }: { els: ShapeElement[] }) {
  const css = uniform(els, (e) => fillCss(e.fill));
  const active = useContextActive({ kind: "color", target: "fill" });
  return (
    <TBIcon
      label={m.editor.toolbar.fillColor}
      tip={css.mixed ? m.editor.toolbar.fillColorMixed : m.editor.toolbar.fillColor}
      icon={<Swatch large css={css.mixed ? MIXED_SWATCH_CSS : (css.value ?? NO_FILL_CSS)} />}
      active={active}
      onClick={() => toggleContext({ kind: "color", target: "fill" })}
    />
  );
}
