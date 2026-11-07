import type { ReactNode, Ref } from "react";
import { getActions } from "@/core/store";
import { cx, EmptyState, IconButton, IconClose } from "@/ui";
import "./PanelShell.css";

export interface PanelShellProps {
  title: string;
  /** rendered between the header and the scrolling body (usually <Tabs/>) */
  tabs?: ReactNode;
  /** buttons left of the close button */
  headerActions?: ReactNode;
  /** pinned below the scrolling body */
  footer?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** Header (title + close), optional tabs, scrolling body with 16px gutters. Every context panel renders inside one. */
export function PanelShell({ title, tabs, headerActions, footer, className, children }: PanelShellProps) {
  return (
    <section className={cx("cf-ctx", className)} aria-label={title}>
      <header className="cf-ctx__head">
        <h2 className="cf-ctx__title">{title}</h2>
        <div className="cf-ctx__head-actions">
          {headerActions}
          <IconButton label="Close panel" icon={<IconClose />} onClick={() => getActions().closeContext()} />
        </div>
      </header>
      {tabs ? <div className="cf-ctx__tabs">{tabs}</div> : null}
      <div className="cf-ctx__body">{children}</div>
      {footer ? <footer className="cf-ctx__foot">{footer}</footer> : null}
    </section>
  );
}

export interface SectionProps {
  ref?: Ref<HTMLDivElement>;
  title?: ReactNode;
  /** small text / link at the right of the title */
  aside?: ReactNode;
  icon?: ReactNode;
  className?: string;
  children?: ReactNode;
}

/** A titled block of the panel body. */
export function Section({ ref, title, aside, icon, className, children }: SectionProps) {
  return (
    <div ref={ref} className={cx("cf-ctx__section", className)}>
      {title ? (
        <h3 className="cf-ctx__h">
          {icon ? <span className="cf-ctx__h-icon">{icon}</span> : null}
          <span className="cf-ctx__h-text">{title}</span>
          {aside ? <span className="cf-ctx__h-aside">{aside}</span> : null}
        </h3>
      ) : null}
      {children}
    </div>
  );
}

/** Small label above a form control. */
export function FieldLabel({ children, htmlFor }: { children: ReactNode; htmlFor?: string }) {
  return (
    <label className="cf-ctx__label" htmlFor={htmlFor}>
      {children}
    </label>
  );
}

export interface PanelEmptyProps {
  icon: ReactNode;
  title: string;
  text?: string;
  action?: ReactNode;
}

/** Calm explanatory state for "the selection does not match this panel". */
export function PanelEmpty({ icon, title, text, action }: PanelEmptyProps) {
  return <EmptyState className="cf-ctx__empty" icon={icon} title={title} text={text} action={action} />;
}
