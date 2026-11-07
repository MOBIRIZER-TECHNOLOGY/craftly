import { useId, type ReactNode } from "react";
import { Button, cx } from "@/ui";
import { navigate } from "@/router";
import "./Page.css";

/** Centred, max-width content column of a dashboard page. */
export function Page({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("cf-dpage", className)}>{children}</div>;
}

interface PageHeaderProps {
  title: ReactNode;
  /** small line under the title */
  subtitle?: ReactNode;
  /** content above the title (a breadcrumb) */
  above?: ReactNode;
  /** buttons at the right edge */
  actions?: ReactNode;
}

export function PageHeader({ title, subtitle, above, actions }: PageHeaderProps) {
  return (
    <header className="cf-dpage__head">
      <div className="cf-dpage__head-text">
        {above}
        <h1 className="cf-dpage__title">{title}</h1>
        {subtitle ? <p className="cf-dpage__subtitle">{subtitle}</p> : null}
      </div>
      {actions ? <div className="cf-dpage__actions">{actions}</div> : null}
    </header>
  );
}

interface SectionProps {
  title: string;
  /** right-aligned control, usually <SeeAll /> */
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}

/** A titled block of the Home page. */
export function Section({ title, action, children, className }: SectionProps) {
  const headingId = useId();
  return (
    <section className={cx("cf-dsection", className)} aria-labelledby={headingId}>
      <header className="cf-dsection__head">
        <h2 id={headingId} className="cf-dsection__title">
          {title}
        </h2>
        {action}
      </header>
      {children}
    </section>
  );
}

/** "See all" button for a section header: goes to a route, or runs a callback. */
export function SeeAll({ to, onClick, label = "See all" }: { to?: string; onClick?: () => void; label?: string }) {
  return (
    <Button variant="ghost" size="sm" className="cf-dsection__more" onClick={() => (onClick ? onClick() : to ? navigate(to) : undefined)}>
      {label}
    </Button>
  );
}
