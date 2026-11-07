import "./Divider.css";
import { cx } from "./cx";

export interface DividerProps {
  /** vertical rule for use inside a flex row */
  vertical?: boolean;
  className?: string;
}

export function Divider({ vertical = false, className }: DividerProps) {
  return <div role="separator" aria-orientation={vertical ? "vertical" : "horizontal"} className={cx("cf-divider", vertical && "cf-divider--vertical", className)} />;
}
