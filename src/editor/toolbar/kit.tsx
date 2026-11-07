/**
 * Building blocks shared by every toolbar: toolbar buttons (icon / text), popover and menu triggers,
 * slider + number fields and helpers that open / toggle the editor's context panels.
 *
 * All of them are thin wrappers over the UI kit. Toolbar buttons never take focus on mouse press
 * (`onMouseDown` is cancelled) so a text selection inside the text editor survives a click.
 */
import { forwardRef, useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from "react";
import { useEditor, type ContextPanelState } from "@/core/store";
import { Button, IconButton, MenuPopover, NumberField, Popover, Slider, Tooltip, cx, type ButtonProps, type IconButtonProps, type MenuEntry, type PopoverPlacement } from "@/ui";
import { captureEditorSelection, restoreEditorSelection, type EditorSelectionSnapshot } from "./editorSelection";
import { clampNumber } from "./selection";
import "./ToolbarKit.css";

/** onMouseDown handler that keeps focus where it is (text editor, canvas). */
export const keepFocus = (e: MouseEvent) => e.preventDefault();

type Popup = "dialog" | "menu";
type PopupAria = { "aria-haspopup"?: Popup; "aria-expanded"?: boolean; "aria-pressed"?: boolean | "mixed" };

/* ------------------------------------------------------------------ */
/* buttons                                                             */
/* ------------------------------------------------------------------ */

export interface TBIconProps extends Omit<IconButtonProps, "tooltip" | "label" | "icon"> {
  /** accessible name (also the tooltip unless `tip` is given) */
  label: string;
  icon: ReactNode;
  /** tooltip text when it should differ from the accessible name */
  tip?: string;
  /** the selection disagrees about this toggle */
  mixed?: boolean;
  /** the button opens a popover / menu: `active` then means "open" and is announced as aria-expanded */
  popup?: Popup;
}

/** Square 36px icon button with tooltip + shortcut. */
export const TBIcon = forwardRef<HTMLButtonElement, TBIconProps>(function TBIcon({ label, icon, tip, mixed, popup, active, shortcut, className, onMouseDown, ...rest }, ref) {
  const aria: PopupAria = {};
  if (popup) {
    aria["aria-haspopup"] = popup;
    aria["aria-expanded"] = !!active;
    aria["aria-pressed"] = undefined;
  } else if (mixed) aria["aria-pressed"] = "mixed";
  return (
    <Tooltip content={tip ?? label} shortcut={shortcut} describe={false}>
      <IconButton
        ref={ref}
        label={label}
        icon={icon}
        shortcut={shortcut}
        tooltip={false}
        active={popup ? !!active : mixed ? false : active}
        className={cx(mixed && "is-mixed", className)}
        onMouseDown={onMouseDown ?? keepFocus}
        {...aria}
        {...rest}
      />
    </Tooltip>
  );
});

export interface TBTextProps extends Omit<ButtonProps, "aria-label"> {
  /** accessible name when it differs from the visible text */
  label?: string;
  tip?: string;
  shortcut?: string;
  active?: boolean;
  popup?: Popup;
}

/** Text (and optional icon) button: "Effects", "Position", "Done" ... */
export const TBText = forwardRef<HTMLButtonElement, TBTextProps>(function TBText(
  { label, tip, shortcut, active, popup, variant = "ghost", size = "md", className, onMouseDown, children, ...rest },
  ref,
) {
  const tooltip = tip ?? label ?? (typeof children === "string" ? children : undefined);
  return (
    <Tooltip content={tooltip} shortcut={shortcut} describe={false} disabled={!tooltip}>
      <Button
        ref={ref}
        variant={variant}
        size={size}
        aria-label={label}
        aria-haspopup={popup}
        aria-expanded={popup ? !!active : undefined}
        aria-pressed={popup || active === undefined ? undefined : active}
        aria-keyshortcuts={shortcut}
        className={cx("cf-tb__text", active && "is-active", className)}
        onMouseDown={onMouseDown ?? keepFocus}
        {...rest}
      >
        {children}
      </Button>
    </Tooltip>
  );
});

/* ------------------------------------------------------------------ */
/* popover / menu triggers                                             */
/* ------------------------------------------------------------------ */

export interface PopoverButtonProps {
  label: string;
  tip?: string;
  shortcut?: string;
  icon: ReactNode;
  /** show as "on" even while closed */
  active?: boolean;
  mixed?: boolean;
  placement?: PopoverPlacement;
  /** extra class for the popover panel */
  panelClass?: string;
  children: (api: { close: () => void }) => ReactNode;
}

/** Icon button that toggles a popover panel anchored below it. */
export function PopoverButton({ label, tip, shortcut, icon, active, mixed, placement = "bottom-start", panelClass, children }: PopoverButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);

  // A number field inside the panel takes the document selection away from the text editor. Remember which
  // characters were selected when the panel opened and select them again when it closes.
  const savedSelection = useRef<EditorSelectionSnapshot | null>(null);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const snapshot = savedSelection.current;
    savedSelection.current = null;
    const root = document.querySelector<HTMLElement>("[data-cf-text-editor]");
    if (snapshot && root && (document.activeElement === root || document.activeElement === document.body)) {
      root.focus({ preventScroll: true });
      restoreEditorSelection(snapshot);
    }
  }, [open]);
  const toggle = () => {
    if (!open) savedSelection.current = document.querySelector("[data-cf-text-editor]") ? captureEditorSelection() : null;
    setOpen(!open);
  };

  return (
    <>
      <TBIcon ref={ref} label={label} tip={tip} shortcut={shortcut} icon={icon} mixed={mixed} popup="dialog" active={open || !!active} onClick={toggle} />
      <Popover open={open} anchor={ref.current} onClose={close} placement={placement} offset={10} className={cx("cf-tbpop", panelClass)} aria-label={label}>
        {children({ close })}
      </Popover>
    </>
  );
}

export interface MenuButtonProps {
  label: string;
  tip?: string;
  icon: ReactNode;
  /** a function is evaluated when the menu is open (fresh state for "..." menus) */
  items: MenuEntry[] | (() => MenuEntry[]);
  placement?: PopoverPlacement;
  /** render as a text button (icon + label + chevron) instead of an icon button */
  text?: ReactNode;
  iconRight?: ReactNode;
  active?: boolean;
  disabled?: boolean;
}

/** Icon / text button that opens a menu below it. */
export function MenuButton({ label, tip, icon, items, placement = "bottom-start", text, iconRight, active, disabled }: MenuButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  return (
    <>
      {text !== undefined ? (
        <TBText ref={ref} label={label} tip={tip} icon={icon} iconRight={iconRight} popup="menu" active={open || !!active} disabled={disabled} onClick={() => setOpen((v) => !v)}>
          {text}
        </TBText>
      ) : (
        <TBIcon ref={ref} label={label} tip={tip} icon={icon} popup="menu" active={open || !!active} disabled={disabled} onClick={() => setOpen((v) => !v)} />
      )}
      <MenuPopover
        open={open}
        anchor={ref.current}
        onClose={close}
        items={open ? (typeof items === "function" ? items() : items) : []}
        placement={placement}
        offset={8}
        aria-label={label}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* popover content                                                     */
/* ------------------------------------------------------------------ */

export function PopLabel({ children }: { children: ReactNode }) {
  return <div className="cf-tbpop__label">{children}</div>;
}

export interface SliderFieldProps {
  label: string;
  value: number;
  /** values differ across the selection: the number box stays blank */
  mixed?: boolean;
  min: number;
  max: number;
  step?: number;
  /** step of the number box arrows when different from the slider step */
  numberStep?: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}

/** "Label / slider + number box", the layout of the Transparency and Advanced settings popovers. */
export function SliderField({ label, value, mixed, min, max, step = 1, numberStep, onChange, disabled }: SliderFieldProps) {
  const shown = Number.isFinite(value) ? clampNumber(value, min, max) : min;
  return (
    <div className="cf-tbpop__field">
      <PopLabel>{label}</PopLabel>
      <div className="cf-tbpop__row">
        <Slider value={shown} min={min} max={max} step={step} onChange={onChange} aria-label={label} disabled={disabled} />
        <NumberField
          className="cf-tbpop__num"
          size="sm"
          value={mixed ? Number.NaN : value}
          min={min}
          max={max}
          step={numberStep ?? step}
          aria-label={`${label} value`}
          disabled={disabled}
          onChange={(v) => {
            if (Number.isFinite(v)) onChange(v);
          }}
        />
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* context panels (Position, Effects, Colour, Font ...)                */
/* ------------------------------------------------------------------ */

function sameContext(a: ContextPanelState, b: ContextPanelState): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "color" && b.kind === "color") return a.target === b.target && (a.key ?? "") === (b.key ?? "");
  if (a.kind === "animate" && b.kind === "animate") return a.tab === b.tab;
  return true;
}

/** Is this context panel the one currently shown? (re-renders when it opens / closes) */
export function useContextActive(panel: ContextPanelState): boolean {
  return useEditor((s) => !!s.context && sameContext(s.context, panel));
}

/** Opens the panel, or closes it when it is already showing. */
export function toggleContext(panel: ContextPanelState): void {
  const { context, actions } = useEditor.getState();
  if (context && sameContext(context, panel)) actions.closeContext();
  else actions.openContext(panel);
}
