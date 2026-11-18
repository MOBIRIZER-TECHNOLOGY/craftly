import { forwardRef, useRef, useState, type ChangeEvent, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from "react";
import { m } from "@/i18n";
import "./NumberField.css";
import { cx } from "./cx";
import { useMergedRefs } from "./hooks";
import { IconMinus, IconPlus } from "./icons";

export interface NumberFieldProps {
  value: number;
  /** fires for every value change: arrow keys, scrubbing, and when typed text is committed */
  onChange: (value: number) => void;
  /** fires once an edit is finished: Enter / blur after typing, each arrow step, the end of a scrub */
  onCommit?: (value: number) => void;
  /** the text being typed, at every key (null once the edit ends): for a form that checks the value before it is committed */
  onDraft?: (text: string | null) => void;
  min?: number;
  max?: number;
  /** arrow-key / scrub step (default 1). Shift = x10, Alt = x0.1 */
  step?: number;
  /** decimals shown and kept (default: up to 2, trailing zeros trimmed) */
  precision?: number;
  /** small leading content (an icon or a letter such as "W"); dragging it scrubs the value */
  prefix?: ReactNode;
  /** unit shown after the number, e.g. "px", "%", "deg" */
  suffix?: string;
  /** accessible name; also shown inside the field (as scrub handle) when no `prefix` is given */
  label?: string;
  /** accessible name without a visible label (e.g. a toolbar font-size field) */
  "aria-label"?: string;
  /** show - and + buttons on both sides (the font-size control in the text toolbar) */
  stepper?: boolean;
  /** drag the prefix / label horizontally to change the value (default true) */
  scrub?: boolean;
  width?: number | string;
  disabled?: boolean;
  size?: "sm" | "md";
  className?: string;
  id?: string;
  title?: string;
}

function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  if (s.includes("e-")) return Number.parseInt(s.split("e-")[1], 10);
  return (s.split(".")[1] ?? "").length;
}

function formatValue(value: number, precision?: number): string {
  if (!Number.isFinite(value)) return "";
  if (precision !== undefined) return value.toFixed(precision);
  return String(Math.round(value * 100) / 100);
}

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** Math.min(Math.max(decimals, 0), 8);
  return Math.round(value * factor) / factor;
}

function parseNumber(text: string): number | null {
  const cleaned = text.trim().replace(/−/g, "-").replace(",", ".");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)/.test(cleaned)) return null;
  const n = Number.parseFloat(cleaned);
  return Number.isFinite(n) ? n : null;
}

export const NumberField = forwardRef<HTMLInputElement, NumberFieldProps>(function NumberField(
  {
    value,
    onChange,
    onCommit,
    onDraft,
    min,
    max,
    step = 1,
    precision,
    prefix,
    suffix,
    label,
    scrub = true,
    width,
    disabled = false,
    size = "md",
    className,
    id,
    title,
    stepper = false,
    "aria-label": ariaLabel,
  },
  ref,
) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mergedRef = useMergedRefs<HTMLInputElement>(inputRef, ref);
  const [draft, setDraftState] = useState<string | null>(null);
  const setDraft = (text: string | null) => {
    setDraftState(text);
    onDraft?.(text);
  };
  const revert = useRef(false);
  const scrubState = useRef<{ lastX: number; exact: number; moved: boolean; last: number; startX: number } | null>(null);

  const clampValue = (v: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, v));
  const normalise = (v: number) => clampValue(roundTo(v, precision ?? Math.max(decimalsOf(step) + 1, 2)));

  const commitText = (text: string) => {
    const parsed = parseNumber(text);
    setDraft(null);
    if (parsed === null) return;
    const next = normalise(parsed);
    if (next !== value) {
      onChange(next);
      onCommit?.(next);
    }
  };

  const stepBy = (direction: 1 | -1, e: { shiftKey: boolean; altKey: boolean }) => {
    const base = draft !== null ? (parseNumber(draft) ?? value) : value;
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    const next = normalise(base + direction * step * mult);
    setDraft(null);
    if (next !== value) {
      onChange(next);
      onCommit?.(next);
    }
    requestAnimationFrame(() => inputRef.current?.select());
  };

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    switch (e.key) {
      case "ArrowUp":
        e.preventDefault();
        stepBy(1, e);
        break;
      case "ArrowDown":
        e.preventDefault();
        stepBy(-1, e);
        break;
      case "Enter":
        e.preventDefault();
        e.currentTarget.blur();
        break;
      case "Escape":
        // Keep Esc for the field while it is being edited; a second press reaches the surrounding popover / dialog.
        e.stopPropagation();
        e.preventDefault();
        revert.current = true;
        e.currentTarget.blur();
        break;
      default:
        break;
    }
  };

  const onFocus = (e: FocusEvent<HTMLInputElement>) => {
    revert.current = false;
    const text = formatValue(value, precision);
    setDraft(text);
    const input = e.currentTarget;
    // select the number so typing replaces it - unless something was typed before the frame came, which must survive
    requestAnimationFrame(() => {
      if (input.value === text) input.select();
    });
  };

  const onBlur = () => {
    if (revert.current) {
      revert.current = false;
      setDraft(null);
      return;
    }
    if (draft !== null) commitText(draft);
  };

  /* ---- scrubbing the prefix / label ---- */

  const hasHandle = !stepper && (prefix !== undefined || label !== undefined);
  const scrubbable = scrub && hasHandle && !disabled;

  const onScrubDown = (e: PointerEvent<HTMLElement>) => {
    if (!scrubbable || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    scrubState.current = { lastX: e.clientX, startX: e.clientX, exact: value, moved: false, last: value };
  };

  const onScrubMove = (e: PointerEvent<HTMLElement>) => {
    const s = scrubState.current;
    if (!s) return;
    if (!s.moved) {
      if (Math.abs(e.clientX - s.startX) < 3) return;
      s.moved = true;
      s.lastX = s.startX;
      document.documentElement.classList.add("cf-scrubbing");
      inputRef.current?.blur();
    }
    const mult = e.shiftKey ? 10 : e.altKey ? 0.1 : 1;
    s.exact = clampValue(s.exact + ((e.clientX - s.lastX) / 2) * step * mult);
    s.lastX = e.clientX;
    const next = normalise(s.exact);
    if (next !== s.last) {
      s.last = next;
      onChange(next);
    }
  };

  const onScrubEnd = (e: PointerEvent<HTMLElement>) => {
    const s = scrubState.current;
    if (!s) return;
    scrubState.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    document.documentElement.classList.remove("cf-scrubbing");
    if (s.moved) onCommit?.(s.last);
    else inputRef.current?.focus();
  };

  const shown = draft ?? formatValue(value, precision);

  return (
    <div
      className={cx("cf-num", `cf-num--${size}`, stepper && "cf-num--stepper", disabled && "is-disabled", scrubbable && "is-scrub", className)}
      style={width === undefined ? undefined : { width }}
      title={title}
    >
      {stepper ? (
        <button
          type="button"
          tabIndex={-1}
          className="cf-num__step"
          aria-label={m.ui.numberField.decrease(label ?? ariaLabel ?? m.ui.numberField.value)}
          disabled={disabled || (min !== undefined && value <= min)}
          // keep focus (and any typed draft) in the input while stepping with the mouse
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => stepBy(-1, e)}
        >
          <IconMinus aria-hidden="true" />
        </button>
      ) : null}
      {hasHandle ? (
        <span className="cf-num__handle" onPointerDown={onScrubDown} onPointerMove={onScrubMove} onPointerUp={onScrubEnd} onPointerCancel={onScrubEnd}>
          {prefix ?? <span className="cf-num__label">{label}</span>}
        </span>
      ) : null}
      <input
        ref={mergedRef}
        id={id}
        className="cf-num__input"
        type="text"
        inputMode="decimal"
        role="spinbutton"
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        aria-label={label ?? ariaLabel}
        aria-valuenow={Number.isFinite(value) ? value : undefined}
        aria-valuemin={min}
        aria-valuemax={max}
        value={shown}
        onChange={(e: ChangeEvent<HTMLInputElement>) => setDraft(e.target.value)}
        onFocus={onFocus}
        onBlur={onBlur}
        onKeyDown={onKeyDown}
      />
      {suffix ? <span className="cf-num__suffix">{suffix}</span> : null}
      {stepper ? (
        <button
          type="button"
          tabIndex={-1}
          className="cf-num__step"
          aria-label={m.ui.numberField.increase(label ?? ariaLabel ?? m.ui.numberField.value)}
          disabled={disabled || (max !== undefined && value >= max)}
          onPointerDown={(e) => e.preventDefault()}
          onClick={(e) => stepBy(1, e)}
        >
          <IconPlus aria-hidden="true" />
        </button>
      ) : null}
    </div>
  );
});
