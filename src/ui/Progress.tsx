import "./Progress.css";
import { cx } from "./cx";

export interface ProgressProps {
  /** 0 to 1. Leave it out when the end is not known: the bar then keeps moving without announcing a number. */
  value?: number;
  /** what is progressing, for assistive technology */
  label: string;
  className?: string;
}

/** A thin progress bar. */
export function Progress({ value, label, className }: ProgressProps) {
  const percent = value === undefined ? undefined : Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div
      className={cx("cf-progress", percent === undefined && "is-indeterminate", className)}
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div className="cf-progress__bar" style={percent === undefined ? undefined : { width: `${percent}%` }} />
    </div>
  );
}
