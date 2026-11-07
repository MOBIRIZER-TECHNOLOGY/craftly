import { useId, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import "./Slider.css";
import { cx } from "./cx";

export type SliderScale = "linear" | "log";

export interface SliderProps {
  value: number;
  min: number;
  max: number;
  /** snapping step (linear: defaults to 1, or 1/100 of the range for small ranges; log: no snapping unless set) */
  step?: number;
  /** fires continuously while dragging and on every keyboard step */
  onChange: (value: number) => void;
  /** fires once when a drag ends and after each keyboard step */
  onChangeEnd?: (value: number) => void;
  /** "log" maps position <-> value logarithmically (needs min > 0); used for zoom */
  scale?: SliderScale;
  /** visible label above the track (also the accessible name) */
  label?: string;
  /** shows the formatted value to the right of the label */
  showValue?: boolean;
  format?: (value: number) => string;
  disabled?: boolean;
  className?: string;
  /** accessible name when there is no visible `label` */
  "aria-label"?: string;
}

/* ---- pure mapping helpers (exported for tests and for components that need the same mapping) ---- */

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

function isLog(min: number, max: number, scale: SliderScale): boolean {
  return scale === "log" && min > 0 && max > 0;
}

/** Value -> position along the track (0..1). */
export function sliderValueToRatio(value: number, min: number, max: number, scale: SliderScale = "linear"): number {
  if (max === min) return 0;
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  const v = clamp(value, lo, hi);
  if (isLog(min, max, scale)) return (Math.log(v) - Math.log(min)) / (Math.log(max) - Math.log(min));
  return (v - min) / (max - min);
}

/** Position along the track (0..1) -> value. */
export function sliderRatioToValue(ratio: number, min: number, max: number, scale: SliderScale = "linear"): number {
  const r = clamp(ratio, 0, 1);
  if (isLog(min, max, scale)) return Math.exp(Math.log(min) + r * (Math.log(max) - Math.log(min)));
  return min + r * (max - min);
}

function decimalsOf(n: number): number {
  if (!Number.isFinite(n) || Number.isInteger(n)) return 0;
  const s = String(n);
  if (s.includes("e-")) return Number.parseInt(s.split("e-")[1], 10);
  return (s.split(".")[1] ?? "").length;
}

function snapTo(value: number, min: number, max: number, step: number | undefined): number {
  const lo = Math.min(min, max);
  const hi = Math.max(min, max);
  if (!step || step <= 0) return clamp(value, lo, hi);
  const snapped = Math.round((value - min) / step) * step + min;
  return clamp(Number(snapped.toFixed(Math.max(decimalsOf(step), decimalsOf(min)))), lo, hi);
}

function defaultFormat(value: number): string {
  return String(Math.round(value * 100) / 100);
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  onChangeEnd,
  scale = "linear",
  label,
  showValue = false,
  format = defaultFormat,
  disabled = false,
  className,
  "aria-label": ariaLabel,
}: SliderProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  const thumbRef = useRef<HTMLDivElement>(null);
  const drag = useRef<{ offset: number; last: number } | null>(null);
  const [dragging, setDragging] = useState(false);
  const labelId = useId();

  const log = isLog(min, max, scale);
  const linearStep = step ?? (Math.abs(max - min) > 20 ? 1 : Math.abs(max - min) / 100);
  const pointerStep = log ? step : linearStep;
  const ratio = sliderValueToRatio(value, min, max, scale);

  const emit = (next: number) => {
    if (drag.current) drag.current.last = next;
    if (next !== value) onChange(next);
  };

  const valueAt = (clientX: number, offset: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return value;
    const r = (clientX - offset - rect.left) / rect.width;
    return snapTo(sliderRatioToValue(r, min, max, scale), min, max, pointerStep);
  };

  const onPointerDown = (e: PointerEvent<HTMLDivElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    const thumb = thumbRef.current;
    if (!thumb) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const onThumb = e.target instanceof Node && thumb.contains(e.target);
    let offset = 0;
    if (onThumb) {
      const box = thumb.getBoundingClientRect();
      offset = e.clientX - (box.left + box.width / 2);
    }
    drag.current = { offset, last: value };
    setDragging(true);
    thumb.focus({ preventScroll: true });
    if (!onThumb) emit(valueAt(e.clientX, 0));
  };

  const onPointerMove = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    emit(valueAt(e.clientX, d.offset));
  };

  const endDrag = (e: PointerEvent<HTMLDivElement>) => {
    const d = drag.current;
    if (!d) return;
    drag.current = null;
    setDragging(false);
    if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
    onChangeEnd?.(d.last);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    const big = e.shiftKey ? 10 : 1;
    const move = (direction: 1 | -1, units: number): number => {
      if (log) {
        return snapTo(sliderRatioToValue(ratio + direction * units * 0.02, min, max, scale), min, max, step);
      }
      return snapTo(value + direction * units * linearStep, min, max, linearStep);
    };
    let next: number;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        next = move(1, big);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        next = move(-1, big);
        break;
      case "PageUp":
        next = move(1, 10);
        break;
      case "PageDown":
        next = move(-1, 10);
        break;
      case "Home":
        next = min;
        break;
      case "End":
        next = max;
        break;
      default:
        return;
    }
    e.preventDefault();
    if (next !== value) onChange(next);
    onChangeEnd?.(next);
  };

  const percent = `${(ratio * 100).toFixed(3)}%`;
  const hasHeader = label !== undefined || showValue;

  return (
    <div className={cx("cf-slider", disabled && "is-disabled", dragging && "is-dragging", className)}>
      {hasHeader ? (
        <div className="cf-slider__head">
          {label !== undefined ? (
            <span id={labelId} className="cf-slider__label">
              {label}
            </span>
          ) : (
            <span />
          )}
          {showValue ? <span className="cf-slider__value">{format(value)}</span> : null}
        </div>
      ) : null}
      <div className="cf-slider__control" onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={endDrag} onPointerCancel={endDrag}>
        <div ref={trackRef} className="cf-slider__track">
          <div className="cf-slider__fill" style={{ width: percent }} />
          <div
            ref={thumbRef}
            className="cf-slider__thumb"
            style={{ left: percent }}
            role="slider"
            tabIndex={disabled ? -1 : 0}
            aria-orientation="horizontal"
            aria-valuemin={min}
            aria-valuemax={max}
            aria-valuenow={Number(value.toFixed(4))}
            aria-valuetext={format(value)}
            aria-disabled={disabled || undefined}
            aria-labelledby={label !== undefined ? labelId : undefined}
            aria-label={label === undefined ? ariaLabel : undefined}
            onKeyDown={onKeyDown}
          />
        </div>
      </div>
    </div>
  );
}
