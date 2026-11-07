import type { CSSProperties } from "react";
import "./Skeleton.css";
import { cx } from "./cx";

export interface SkeletonProps {
  /** CSS length or px number (default 100%) */
  width?: number | string;
  /** CSS length or px number (default 16) */
  height?: number | string;
  /** corner radius in px (default 8) */
  radius?: number | string;
  /** perfect circle (uses `width` for both sides) */
  circle?: boolean;
  className?: string;
  style?: CSSProperties;
}

/** Shimmering placeholder block shown while content loads. */
export function Skeleton({ width = "100%", height = 16, radius = 8, circle = false, className, style }: SkeletonProps) {
  return (
    <span
      className={cx("cf-skeleton", className)}
      aria-hidden="true"
      style={{
        width,
        height: circle ? width : height,
        borderRadius: circle ? "50%" : radius,
        ...style,
      }}
    />
  );
}
