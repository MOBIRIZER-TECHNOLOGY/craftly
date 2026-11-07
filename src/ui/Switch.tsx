import type { ReactNode } from "react";
import "./Switch.css";
import { cx } from "./cx";

export interface SwitchProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** visible label (clicking it toggles the switch) */
  label?: ReactNode;
  /** put the label before the track */
  labelFirst?: boolean;
  disabled?: boolean;
  id?: string;
  className?: string;
  /** accessible name when there is no visible `label` */
  "aria-label"?: string;
}

/** On / off toggle (native checkbox with role="switch", so Space and screen readers just work). */
export function Switch({ checked, onChange, label, labelFirst = false, disabled = false, id, className, "aria-label": ariaLabel }: SwitchProps) {
  return (
    <label className={cx("cf-switch", labelFirst && "cf-switch--label-first", disabled && "is-disabled", className)}>
      <input
        id={id}
        type="checkbox"
        role="switch"
        className="cf-switch__input"
        checked={checked}
        disabled={disabled}
        aria-label={label ? undefined : ariaLabel}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="cf-switch__track" aria-hidden="true">
        <span className="cf-switch__thumb" />
      </span>
      {label ? <span className="cf-switch__label">{label}</span> : null}
    </label>
  );
}
