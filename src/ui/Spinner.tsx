import "./Spinner.css";
import { cx } from "./cx";

export interface SpinnerProps {
  /** diameter in px (default 18) */
  size?: number;
  /** accessible name; the spinner is decorative (aria-hidden) when omitted */
  label?: string;
  className?: string;
}

export function Spinner({ size = 18, label, className }: SpinnerProps) {
  return (
    <span
      className={cx("cf-spinner", className)}
      style={{ width: size, height: size }}
      role={label ? "status" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
      <svg viewBox="0 0 24 24" width="100%" height="100%" fill="none" focusable="false">
        <circle className="cf-spinner__track" cx="12" cy="12" r="9" />
        <circle className="cf-spinner__arc" cx="12" cy="12" r="9" pathLength="100" />
      </svg>
    </span>
  );
}
