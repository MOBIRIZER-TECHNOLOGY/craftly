import { useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";
import { useEditor, type ToolId } from "@/core/store";
import { m } from "@/i18n";
import { ColorPicker, ColorSwatch, IconBrush, IconButton, IconClose, IconComment, IconPenTool, IconSelect, IconShapes, IconText, Popover, Slider, Tooltip, cx } from "@/ui";
import { autoDrawWidth, setDrawSettings, useDrawSettings } from "../shared/drawSettings";
import { IconSlash } from "../shared/icons";
import { ShapePreview } from "../shared/ShapePreview";
import "./ToolsPalette.css";

/** The shapes offered by the Shape tool flyout (ids of the shape catalogue). */
const TOOL_SHAPES: Array<{ id: string; name: string }> = [
  { id: "rect", name: m.panelsTabs.tools.shapes.square },
  { id: "ellipse", name: m.panelsTabs.tools.shapes.circle },
  { id: "triangle", name: m.panelsTabs.tools.shapes.triangle },
  { id: "diamond", name: m.panelsTabs.tools.shapes.diamond },
  { id: "pentagon", name: m.panelsTabs.tools.shapes.pentagon },
  { id: "hexagon", name: m.panelsTabs.tools.shapes.hexagon },
  { id: "star", name: m.panelsTabs.tools.shapes.star },
  { id: "heart", name: m.panelsTabs.tools.shapes.heart },
  { id: "arrow-right", name: m.panelsTabs.tools.shapes.arrow },
  { id: "chevron", name: m.panelsTabs.tools.shapes.chevron },
  { id: "plus", name: m.panelsTabs.tools.shapes.plus },
  { id: "speech", name: m.panelsTabs.tools.shapes.speech },
  { id: "cloud", name: m.panelsTabs.tools.shapes.cloud },
  { id: "lightning", name: m.panelsTabs.tools.shapes.lightning },
  { id: "burst", name: m.panelsTabs.tools.shapes.starburst },
  { id: "blob-1", name: m.panelsTabs.tools.shapes.blob },
];

const PEN_COLORS = ["#0e1318", "#e5484d", "#f59e0b", "#facc15", "#16a34a", "#12c2b9", "#3b82f6", "#7c3aed", "#ec4899", "#ffffff"];

type Flyout = "draw" | "pen" | "shape" | null;

interface ToolDef {
  id: ToolId;
  label: string;
  shortcut?: string;
  icon: ReactNode;
  /** colour of the glyph while the tool is not active */
  tint: string;
  flyout?: Exclude<Flyout, null>;
}

const TOOLS: ToolDef[] = [
  { id: "select", label: m.panelsTabs.tools.tools.select, icon: <IconSelect />, tint: "var(--c-ink-2)" },
  { id: "draw", label: m.panelsTabs.tools.tools.draw, icon: <IconBrush />, tint: "var(--c-danger)", flyout: "draw" },
  { id: "pen", label: m.panelsTabs.tools.tools.pen, shortcut: "P", icon: <IconPenTool />, tint: "var(--c-primary)", flyout: "pen" },
  { id: "shape", label: m.panelsTabs.tools.tools.shape, icon: <IconShapes />, tint: "var(--c-ink)", flyout: "shape" },
  { id: "line", label: m.panelsTabs.tools.tools.line, shortcut: "L", icon: <IconSlash />, tint: "var(--c-blue)" },
  { id: "text", label: m.panelsTabs.tools.tools.text, shortcut: "T", icon: <IconText />, tint: "var(--c-primary)" },
  // a pin with a note where the page is clicked (src/editor/comments); last, so that the tools before it keep their places
  { id: "comment", label: m.panelsTabs.tools.tools.comment, shortcut: "M", icon: <IconComment />, tint: "var(--c-ink-2)" },
];

/**
 * The floating vertical tool palette (opened by the "Tools" rail tab). Choosing a tool calls `actions.setTool`; the
 * canvas controller does the drawing. Draw and Pen open a small flyout for the stroke they make, Shape one for the shape to draw.
 * The palette stays open while a tool is active; Esc returns to Select (handled by the editor hotkeys).
 */
export function ToolsPalette({ onClose }: { onClose: () => void }) {
  const tool = useEditor((s) => s.tool);
  const toolShape = useEditor((s) => s.toolShape);
  const setTool = useEditor((s) => s.actions.setTool);
  const [flyout, setFlyout] = useState<Flyout>(null);
  const anchors = useRef<Partial<Record<Exclude<Flyout, null>, HTMLButtonElement | null>>>({});
  const listRef = useRef<HTMLDivElement>(null);

  const choose = (def: ToolDef) => {
    if (def.flyout) {
      // activate the tool, and toggle its flyout when it was already active
      const wasActive = tool === def.id;
      if (!wasActive) setTool(def.id);
      setFlyout(wasActive && flyout === def.flyout ? null : def.flyout);
      return;
    }
    setFlyout(null);
    setTool(def.id);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>("button") ?? []);
    const i = buttons.findIndex((b) => b === document.activeElement);
    const next = e.key === "ArrowDown" ? (i + 1) % buttons.length : (i - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  return (
    <div className="cf-tools" role="toolbar" aria-label={m.panelsTabs.tools.label} aria-orientation="vertical" onKeyDown={onKeyDown}>
      <Tooltip content={m.panelsTabs.tools.close} placement="right">
        <button type="button" className="cf-tools__close" aria-label={m.panelsTabs.tools.close} onClick={onClose}>
          <IconClose aria-hidden="true" />
        </button>
      </Tooltip>
      <div ref={listRef} className="cf-tools__card">
        {TOOLS.map((def) => (
          <Tooltip key={def.id} content={def.label} shortcut={def.shortcut} placement="right">
            <IconButton
              ref={def.flyout ? (el) => void (anchors.current[def.flyout!] = el) : undefined}
              label={def.label}
              icon={def.icon}
              size="lg"
              tooltip={false}
              active={tool === def.id}
              className={cx("cf-tools__btn", def.flyout && "has-flyout")}
              style={{ "--cf-ib-fg": def.tint } as CSSProperties}
              aria-haspopup={def.flyout ? "dialog" : undefined}
              aria-expanded={def.flyout ? flyout === def.flyout : undefined}
              onClick={() => choose(def)}
            />
          </Tooltip>
        ))}
      </div>

      <Popover
        open={flyout === "shape"}
        anchor={anchors.current.shape ?? null}
        onClose={() => setFlyout(null)}
        placement="right-start"
        offset={12}
        className="cf-tools__flyout"
        aria-label={m.panelsTabs.tools.chooseShape}
      >
        <ShapeFlyout
          current={tool === "shape" ? toolShape : null}
          onPick={(kind) => {
            setTool("shape", kind);
            setFlyout(null);
          }}
        />
      </Popover>

      <Popover
        open={flyout === "draw"}
        anchor={anchors.current.draw ?? null}
        onClose={() => setFlyout(null)}
        placement="right-start"
        offset={12}
        className="cf-tools__flyout cf-tools__flyout--pen"
        aria-label={m.panelsTabs.tools.drawOptions}
      >
        <StrokeFlyout title={m.panelsTabs.tools.tools.draw} hint={m.panelsTabs.tools.drawHint} />
      </Popover>

      <Popover
        open={flyout === "pen"}
        anchor={anchors.current.pen ?? null}
        onClose={() => setFlyout(null)}
        placement="right-start"
        offset={12}
        className="cf-tools__flyout cf-tools__flyout--pen"
        aria-label={m.panelsTabs.tools.penOptions}
      >
        <StrokeFlyout title={m.panelsTabs.tools.tools.pen} hint={m.panelsTabs.tools.penHint} />
      </Popover>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Shape flyout                                                         */
/* ------------------------------------------------------------------ */

function ShapeFlyout({ current, onPick }: { current: string | null; onPick: (kind: string) => void }) {
  return (
    <div className="cf-flyout">
      <p className="cf-flyout__title">{m.panelsTabs.tools.drawShape}</p>
      <p className="cf-flyout__hint">{m.panelsTabs.tools.shapeHint}</p>
      <div className="cf-flyout__shapes" role="listbox" aria-label={m.panelsTabs.tools.shapesLabel}>
        {TOOL_SHAPES.map((s) => {
          const selected = current === s.id;
          return (
            <button
              key={s.id}
              type="button"
              role="option"
              aria-selected={selected}
              aria-label={s.name}
              title={s.name}
              className={cx("cf-flyout__shape", selected && "is-selected")}
              onClick={() => onPick(s.id)}
            >
              <ShapePreview kind={s.id} box={28} />
            </button>
          );
        })}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Draw and Pen flyout: the colour and width of the stroke they make          */
/* ------------------------------------------------------------------ */

function StrokeFlyout({ title, hint }: { title: string; hint: string }) {
  const settings = useDrawSettings();
  const designWidth = useEditor((s) => s.design?.width ?? 1920);
  const [custom, setCustom] = useState(false);
  const width = settings.width ?? autoDrawWidth(designWidth);
  const maxWidth = Math.max(24, Math.round(designWidth * 0.03));
  const isPreset = PEN_COLORS.includes(settings.color.toLowerCase());

  return (
    <div className="cf-flyout">
      <p className="cf-flyout__title">{title}</p>
      <p className="cf-flyout__hint">{hint}</p>
      <div className="cf-flyout__preview" aria-hidden="true">
        <svg viewBox="0 0 200 48" width="100%" height="48" preserveAspectRatio="none">
          <path
            d="M10 30 C 40 6, 60 6, 90 28 S 150 46, 190 14"
            fill="none"
            stroke={settings.color}
            strokeWidth={Math.min(22, Math.max(1.5, (width / maxWidth) * 20))}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
      <div className="cf-flyout__colors" role="group" aria-label={m.panelsTabs.tools.strokeColour(title)}>
        {PEN_COLORS.map((c) => (
          <ColorSwatch key={c} color={c} size={26} selected={settings.color.toLowerCase() === c} title={c} onClick={() => setDrawSettings({ color: c })} />
        ))}
        <button
          type="button"
          className={cx("cf-flyout__custom", (custom || !isPreset) && "is-selected")}
          aria-label={m.panelsTabs.tools.customColour}
          aria-expanded={custom}
          onClick={() => setCustom((v) => !v)}
        >
          <span className="cf-flyout__custom-dot" style={{ background: isPreset ? undefined : settings.color }} />
        </button>
      </div>
      {custom ? <ColorPicker value={settings.color} onChange={(c) => setDrawSettings({ color: c })} className="cf-flyout__picker" /> : null}
      <Slider
        label={m.panelsTabs.tools.width}
        showValue
        format={(v) => m.panelsTabs.tools.widthValue(Math.round(v))}
        min={1}
        max={maxWidth}
        step={1}
        value={width}
        onChange={(v) => setDrawSettings({ width: v })}
      />
    </div>
  );
}
