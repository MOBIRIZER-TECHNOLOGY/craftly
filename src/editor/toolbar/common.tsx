/**
 * Controls that appear on several of the contextual toolbars: transparency, effects, position, copy style,
 * flip, align, border and corner radius, plus the "..." menu.
 */
import type { CSSProperties, ReactElement } from "react";
import { BLEND_MODES, blendLabel, blendOf } from "@/core/blend";
import { connectable } from "@/core/connectors";
import { DEFAULT_INK } from "@/core/factory";
import { getActions, getActivePage, useEditor } from "@/core/store";
import type { BlendMode, DesignElement, ID, ImageElement, ShapeElement, Stroke, StrokeStyle } from "@/core/types";
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
const BLEND_OPTIONS: SelectOption<string>[] = [{ value: "normal", label: "Normal" }, ...BLEND_MODES.map((mode) => ({ value: mode, label: blendLabel(mode) }))];

export function TransparencyButton({ els, ids }: BarProps) {
  const opacity = uniform(els, (e) => Math.round(e.opacity * 100));
  const mode = uniform(els, (e) => blendOf(e) ?? "normal");
  return (
    <PopoverButton label="Transparency" tip="Transparency and blend mode" icon={<IconChecker />} panelClass="cf-tbpop--narrow">
      {() => (
        <div className="cf-tbpop__stack">
          <SliderField
            label="Transparency"
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
            <PopLabel>Blend mode</PopLabel>
            <Select<string>
              size="sm"
              aria-label="Blend mode"
              value={mode.mixed ? null : (mode.value ?? "normal")}
              placeholder="Mixed"
              options={BLEND_OPTIONS}
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
    <TBText tip="Shadows, glow and other effects" active={active} onClick={() => toggleContext({ kind: "effects" })}>
      Effects
    </TBText>
  );
}

export function AnimateButton({ tab = "element" }: { tab?: "element" | "page" }) {
  const active = useContextActive({ kind: "animate", tab });
  return (
    <TBText tip={tab === "page" ? "Animate the page and set transitions" : "Make it enter, leave or move"} active={active} onClick={() => toggleContext({ kind: "animate", tab })}>
      Animate
    </TBText>
  );
}

export function PositionButton() {
  const active = useContextActive({ kind: "position", tab: "arrange" });
  return (
    <TBText tip="Arrange, align and resize" active={active} onClick={() => toggleContext({ kind: "position", tab: "arrange" })}>
      Position
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
      label={armed ? "Paste style" : "Copy style"}
      tip={armed ? "Paste style onto the selection" : "Copy style"}
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
  return <MenuButton label="More actions" tip="More" icon={<IconMore />} placement="bottom-end" items={() => buildContextMenuItems(useEditor.getState())} />;
}

/* ------------------------------------------------------------------ */
/* flip / group / align                                                */
/* ------------------------------------------------------------------ */

export function FlipMenu() {
  const a = getActions();
  // lucide 1.68 names its flip glyphs by the direction of the centre line: "FlipVertical2" (IconFlipV) has a
  // vertical line with triangles left and right - that is the picture of a horizontal flip, and vice versa.
  const items: MenuEntry[] = [
    { id: "flip-h", label: "Flip horizontal", icon: <IconFlipV />, onSelect: () => a.flip("horizontal") },
    { id: "flip-v", label: "Flip vertical", icon: <IconFlipH />, onSelect: () => a.flip("vertical") },
  ];
  return <MenuButton label="Flip" tip="Flip" icon={<IconFlipV />} items={items} />;
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
    align("left", "Left", <IconAlignObjLeft />),
    align("center", "Center", <IconAlignObjCenter />),
    align("right", "Right", <IconAlignObjRight />),
    { type: "divider" },
    align("top", "Top", <IconAlignObjTop />),
    align("middle", "Middle", <IconAlignObjMiddle />),
    align("bottom", "Bottom", <IconAlignObjBottom />),
    { type: "divider" },
    {
      id: "distribute-h",
      label: "Distribute horizontally",
      icon: <IconDistributeH />,
      hint: ids.length < 3 ? "3+" : undefined,
      disabled: ids.length < 3,
      onSelect: () => a.distribute("horizontal"),
    },
    {
      id: "distribute-v",
      label: "Distribute vertically",
      icon: <IconDistributeV />,
      hint: ids.length < 3 ? "3+" : undefined,
      disabled: ids.length < 3,
      onSelect: () => a.distribute("vertical"),
    },
  ];
  return (
    <>
      <TBText icon={<IconGroup />} tip="Group the selected elements" shortcut="Ctrl+G" onClick={() => a.groupSelection()}>
        Group
      </TBText>
      <MenuButton label="Align" tip="Align the selected elements to each other" icon={<IconAlignObjLeft />} iconRight={<IconChevronDown />} text="Align" items={items} />
      {canConnect && (
        <TBText
          icon={<IconConnect />}
          tip="Draw an arrow from the first selected element to the second. It stays attached when they move."
          onClick={() => a.connect(ids[0], ids[1])}
        >
          Connect
        </TBText>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* border + corner radius (shapes and images)                          */
/* ------------------------------------------------------------------ */

type Bordered = ShapeElement | ImageElement;

const STROKE_STYLES: Array<{ value: "none" | StrokeStyle; title: string }> = [
  { value: "none", title: "No border" },
  { value: "solid", title: "Solid" },
  { value: "dashed", title: "Dashed" },
  { value: "dotted", title: "Dotted" },
];

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
    if (el.type !== "shape" && el.type !== "image") return;
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
      if (el.type !== "shape" && el.type !== "image") return;
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
    <PopoverButton label="Border" tip="Border style and weight" icon={<IconBorderBox />} active={hasBorder}>
      {({ close }) => (
        <div className="cf-tbpop__stack">
          <div className="cf-tbpop__field">
            <PopLabel>Border style</PopLabel>
            <Segmented
              size="sm"
              fullWidth
              aria-label="Border style"
              // with mixed borders the first element's style shows (a group with nothing selected cannot be reached by keyboard)
              value={style.value ?? "none"}
              onChange={(v) => setBorderStyle(ids, v)}
              options={STROKE_STYLES.map((s) => ({ value: s.value, title: s.title, icon: <IconStrokeStyle kind={s.value} /> }))}
            />
          </div>
          <SliderField label="Border weight" value={width.value ?? 0} mixed={width.mixed} min={0} max={40} step={1} onChange={(v) => setBorderWeight(ids, v)} />
          <div className="cf-tbpop__split">
            <PopLabel>Border color</PopLabel>
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
              Color
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
    <PopoverButton label="Corner radius" tip="Round the corners" icon={<IconCornerRadius />} panelClass="cf-tbpop--narrow">
      {() => (
        <SliderField
          label="Corner radius"
          value={radius.value ?? 0}
          mixed={radius.mixed}
          min={0}
          max={max}
          step={1}
          onChange={(v) =>
            editElements(
              ids,
              (el) => {
                if (el.type === "shape" || el.type === "image") el.radius = v;
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
      label="Fill color"
      tip={css.mixed ? "Fill color (mixed)" : "Fill color"}
      icon={<Swatch large css={css.mixed ? MIXED_SWATCH_CSS : (css.value ?? NO_FILL_CSS)} />}
      active={active}
      onClick={() => toggleContext({ kind: "color", target: "fill" })}
    />
  );
}
