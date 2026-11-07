import type { ReactNode } from "react";
import "./Badge.css";
import { cx } from "./cx";

export type BadgeTone = "neutral" | "primary" | "success" | "danger" | "warning" | "info";

export interface BadgeProps {
  tone?: BadgeTone;
  /** "soft" (tinted, default) or "solid" (filled) */
  variant?: "soft" | "solid";
  children: ReactNode;
  className?: string;
}

/** Small status / count pill. */
export function Badge({ tone = "neutral", variant = "soft", children, className }: BadgeProps) {
  return <span className={cx("cf-badge", `cf-badge--${tone}`, `cf-badge--${variant}`, className)}>{children}</span>;
}
