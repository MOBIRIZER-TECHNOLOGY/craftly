import type { ReactNode } from "react";
import { EmptyState, cx } from "@/ui";
import "./EmptyHint.css";

export interface EmptyHintProps {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
  /** tighter padding for hints inside a section */
  compact?: boolean;
  className?: string;
}

/** Friendly "nothing here" block (no results, empty library, still loading) built on the kit's EmptyState. */
export function EmptyHint({ icon, title, text, action, compact, className }: EmptyHintProps) {
  return <EmptyState className={cx("cf-hint", compact && "cf-hint--compact", className)} icon={icon} title={title} text={text} action={action} />;
}
