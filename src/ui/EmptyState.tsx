import type { ReactNode } from "react";
import "./EmptyState.css";
import { cx } from "./cx";

export interface EmptyStateProps {
  /** an icon element; it is drawn inside a soft tinted circle */
  icon: ReactNode;
  title: string;
  text?: string;
  /** call to action, usually a Button */
  action?: ReactNode;
  className?: string;
  /** the heading level that fits the page around it (default 3; 2 when it sits straight under the page title) */
  headingLevel?: 2 | 3 | 4;
}

export function EmptyState({ icon, title, text, action, className, headingLevel = 3 }: EmptyStateProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <div className={cx("cf-empty", className)}>
      <div className="cf-empty__icon" aria-hidden="true">
        {icon}
      </div>
      <Heading className="cf-empty__title">{title}</Heading>
      {text ? <p className="cf-empty__text">{text}</p> : null}
      {action ? <div className="cf-empty__action">{action}</div> : null}
    </div>
  );
}
