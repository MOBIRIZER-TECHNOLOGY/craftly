import { useEffect, useRef, type ReactNode } from "react";
import "./Checkbox.css";
import { cx } from "./cx";

export interface CheckboxProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  /** mixed state for "select all" boxes; shown instead of the check mark while `checked` is false */
  indeterminate?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** accessible name when there is no visible `label` */
  "aria-label"?: string;
}

export function Checkbox({ checked, onChange, label, indeterminate = false, disabled = false, id, className, "aria-label": ariaLabel }: CheckboxProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (inputRef.current) inputRef.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);

  return (
    <label className={cx("cf-check", disabled && "is-disabled", className)}>
      <input
        ref={inputRef}
        id={id}
        type="checkbox"
        className="cf-check__input"
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="cf-check__box" aria-hidden="true">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" focusable="false">
          <path className="cf-check__tick" d="M3.5 8.5l3 3 6-7" />
          <path className="cf-check__dash" d="M4 8h8" />
        </svg>
      </span>
      {label ? <span className="cf-check__label">{label}</span> : null}
    </label>
  );
}
