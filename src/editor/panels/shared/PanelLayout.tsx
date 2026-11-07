import { createContext, useContext, useState, type ReactNode, type UIEvent } from "react";
import { cx } from "@/ui";
import "./PanelLayout.css";

/* ------------------------------------------------------------------ */
/* The scrolling element of the current panel. Lazy / virtual lists use it as their IntersectionObserver root. */
/* ------------------------------------------------------------------ */

const ScrollContext = createContext<HTMLElement | null>(null);

/** The panel's scrolling element (null on the very first render, then the element). */
export const usePanelScroller = (): HTMLElement | null => useContext(ScrollContext);

/** Column layout every tab renders into: `PanelTop` (fixed) above a `PanelScroll` (scrolling). */
export function Panel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("cf-panel", className)}>{children}</div>;
}

/** Fixed area above the scrolling content: search field, tabs, chips. */
export function PanelTop({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx("cf-panel__top", className)}>{children}</div>;
}

export interface PanelScrollProps {
  children: ReactNode;
  className?: string;
  onScroll?: (e: UIEvent<HTMLDivElement>) => void;
  /** extra top padding is removed (when the content starts with its own heading) */
  flush?: boolean;
  /** when the scrolling area is the panel of a set of tabs: `role="tabpanel"`, its id and the id of the tab that names it */
  role?: "tabpanel";
  id?: string;
  "aria-labelledby"?: string;
}

export function PanelScroll({ children, className, onScroll, flush, role, id, "aria-labelledby": labelledBy }: PanelScrollProps) {
  const [el, setEl] = useState<HTMLDivElement | null>(null);
  return (
    <ScrollContext.Provider value={el}>
      <div ref={setEl} className={cx("cf-panel__scroll", flush && "is-flush", className)} onScroll={onScroll} role={role} id={id} aria-labelledby={labelledBy}>
        {children}
      </div>
    </ScrollContext.Provider>
  );
}

/** A titled block inside the scroll area: 14px bold heading, optional "See all" style action. */
export function PanelSection({
  title,
  action,
  children,
  className,
  headingLevel = 3,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  headingLevel?: 2 | 3 | 4;
}) {
  const Heading = `h${headingLevel}` as "h2" | "h3" | "h4";
  return (
    <section className={cx("cf-panel__section", className)}>
      {title || action ? (
        <div className="cf-panel__section-head">
          {title ? <Heading className="cf-panel__section-title">{title}</Heading> : <span />}
          {action ? <div className="cf-panel__section-action">{action}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

/** Small text-style button used for "See all", "Clear" ... */
export function PanelLink({ children, onClick, label }: { children: ReactNode; onClick: () => void; label?: string }) {
  return (
    <button type="button" className="cf-panel__link" onClick={onClick} aria-label={label}>
      {children}
    </button>
  );
}
