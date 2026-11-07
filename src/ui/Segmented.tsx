import { useRef, type KeyboardEvent, type ReactNode } from "react";
import "./Segmented.css";
import { cx } from "./cx";
import { Tooltip } from "./Tooltip";

export interface SegmentedOption<T extends string | number = string> {
  value: T;
  label?: ReactNode;
  icon?: ReactNode;
  /** tooltip and accessible name for icon-only options */
  title?: string;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string | number = string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  size?: "sm" | "md";
  /** options share the width of the container equally */
  fullWidth?: boolean;
  className?: string;
  "aria-label"?: string;
}

/** A single-choice toggle group (radio group semantics) with a sliding-white-thumb look. */
export function Segmented<T extends string | number = string>({ value, onChange, options, size = "md", fullWidth = false, className, "aria-label": ariaLabel }: SegmentedProps<T>) {
  const groupRef = useRef<HTMLDivElement>(null);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const enabled = options.filter((o) => !o.disabled);
    const index = enabled.findIndex((o) => o.value === value);
    let next: SegmentedOption<T> | undefined;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") next = enabled[(index + 1) % enabled.length];
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = enabled[(index - 1 + enabled.length) % enabled.length];
    else if (e.key === "Home") next = enabled[0];
    else if (e.key === "End") next = enabled[enabled.length - 1];
    else return;
    e.preventDefault();
    if (!next) return;
    onChange(next.value);
    const nextValue = String(next.value);
    requestAnimationFrame(() => {
      groupRef.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(nextValue)}"]`)?.focus();
    });
  };

  return (
    // eslint-disable-next-line jsx-a11y/interactive-supports-focus -- the options are the focusable parts; the arrow keys move between them
    <div ref={groupRef} role="radiogroup" aria-label={ariaLabel} className={cx("cf-seg", `cf-seg--${size}`, fullWidth && "cf-seg--full", className)} onKeyDown={onKeyDown}>
      {options.map((option) => {
        const selected = option.value === value;
        const iconOnly = option.label === undefined || option.label === null;
        const button = (
          <button
            key={String(option.value)}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={iconOnly ? option.title : undefined}
            disabled={option.disabled}
            tabIndex={selected ? 0 : -1}
            data-value={String(option.value)}
            className={cx("cf-seg__option", selected && "is-selected", iconOnly && "is-icon-only")}
            onClick={() => onChange(option.value)}
          >
            {option.icon ? <span className="cf-seg__icon">{option.icon}</span> : null}
            {iconOnly ? null : <span className="cf-seg__label">{option.label}</span>}
          </button>
        );
        return option.title && iconOnly ? (
          <Tooltip key={String(option.value)} content={option.title} describe={false}>
            {button}
          </Tooltip>
        ) : (
          button
        );
      })}
    </div>
  );
}
