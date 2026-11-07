import { Children, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type Key, type ReactNode } from "react";
import { Skeleton, cx } from "@/ui";
import { useElementWidth, useVisible } from "./hooks";
import { usePanelScroller } from "./PanelLayout";
import "./ItemGrid.css";

/* ------------------------------------------------------------------ */
/* ItemGrid: equal cells                                               */
/* ------------------------------------------------------------------ */

export interface ItemGridProps {
  /** fixed number of columns (2 or 3 in the panels) */
  columns?: number;
  /** when set, columns are as many as fit with at least this many px each (responsive bottom-sheet layout) */
  minCell?: number;
  gap?: number;
  /**
   * Render each child only once its cell nears the viewport (a shimmer holds its place until then). `aspect` is the
   * cells' height / width (default 1). Use it for grids of previews that are costly to draw.
   */
  lazy?: boolean | { aspect?: number; radius?: number };
  children: ReactNode;
  className?: string;
  role?: string;
  "aria-label"?: string;
}

/** Equal-width grid in 2, 3 or more columns, or as many columns as fit (`minCell`), optionally with lazily rendered cells. */
export function ItemGrid({ columns = 2, minCell, gap = 8, lazy, children, className, role, "aria-label": ariaLabel }: ItemGridProps) {
  const style = {
    "--cf-gap": `${gap}px`,
    gridTemplateColumns: minCell ? `repeat(auto-fill, minmax(${minCell}px, 1fr))` : `repeat(${columns}, minmax(0, 1fr))`,
  } as CSSProperties;
  const lazyOpts = lazy ? (lazy === true ? {} : lazy) : null;
  return (
    <div className={cx("cf-itemgrid", className)} style={style} role={role} aria-label={ariaLabel}>
      {lazyOpts
        ? Children.map(children, (child) =>
            child === null || child === undefined || typeof child === "boolean" ? null : (
              <LazyBox aspect={lazyOpts.aspect ?? 1} radius={lazyOpts.radius ?? 12} className="cf-itemgrid__lazy">
                {child}
              </LazyBox>
            ),
          )
        : children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* LazyBox: render children only once the box nears the viewport       */
/* ------------------------------------------------------------------ */

export interface LazyBoxProps {
  /** height / width of the box (reserved before the content renders, so nothing jumps) */
  aspect?: number;
  radius?: number;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  /** show a shimmer until the children are mounted (default true) */
  skeleton?: boolean;
}

export function LazyBox({ aspect = 1, radius = 12, className, style, children, skeleton = true }: LazyBoxProps) {
  const [ref, visible] = useVisible<HTMLDivElement>();
  return (
    <div ref={ref} className={cx("cf-lazybox", className)} style={{ aspectRatio: `${1 / aspect}`, borderRadius: radius, ...style }}>
      {visible ? children : skeleton ? <Skeleton width="100%" height="100%" radius={radius} className="cf-lazybox__skeleton" /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Masonry: columns of items with differing aspect ratios              */
/* ------------------------------------------------------------------ */

export interface MasonryProps<T> {
  items: T[];
  /** number of columns (the minimum when `minColumnWidth` is set) */
  columns?: number;
  /** when set, more columns are used while each stays at least this wide (the wide bottom-sheet layout) */
  minColumnWidth?: number;
  gap?: number;
  /** height / width of an item (used to balance the columns) */
  aspectOf: (item: T) => number;
  keyOf: (item: T) => Key;
  renderItem: (item: T) => ReactNode;
  className?: string;
}

/** Distributes items over columns, always adding to the currently shortest one. */
export function Masonry<T>({ items, columns: minColumns = 2, minColumnWidth, gap = 8, aspectOf, keyOf, renderItem, className }: MasonryProps<T>) {
  const [hostRef, width] = useElementWidth<HTMLDivElement>();
  const columns = minColumnWidth && width > 0 ? Math.max(minColumns, Math.floor((width + gap) / (minColumnWidth + gap))) : minColumns;
  const cols = useMemo(() => {
    const heights = new Array<number>(columns).fill(0);
    const out: T[][] = Array.from({ length: columns }, () => []);
    for (const item of items) {
      let shortest = 0;
      for (let i = 1; i < columns; i++) if (heights[i] < heights[shortest]) shortest = i;
      out[shortest].push(item);
      // the gap is expressed in "column widths" assuming ~150px columns: close enough for balancing
      heights[shortest] += Math.max(0.2, aspectOf(item)) + gap / 150;
    }
    return out;
  }, [items, columns, gap, aspectOf]);

  return (
    <div ref={hostRef} className={cx("cf-masonry", className)} style={{ gap }}>
      {cols.map((col, i) => (
        <div key={i} className="cf-masonry__col" style={{ gap }}>
          {col.map((item) => (
            <div key={keyOf(item)} className="cf-masonry__item">
              {renderItem(item)}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* VirtualGrid: thousands of fixed-height cells (icons)                */
/* ------------------------------------------------------------------ */

export interface VirtualGridProps {
  count: number;
  columns: number;
  /** height of each row in px */
  rowHeight: number;
  gap?: number;
  renderItem: (index: number) => ReactNode;
  /** rows rendered beyond the visible area */
  overscan?: number;
  className?: string;
  "aria-label"?: string;
}

/**
 * Windowed grid that lives inside the panel's scroll area: only the rows near the viewport are mounted,
 * so a library with thousands of icons stays cheap.
 */
export function VirtualGrid({ count, columns, rowHeight, gap = 8, renderItem, overscan = 3, className, "aria-label": ariaLabel }: VirtualGridProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const scroller = usePanelScroller();
  const [range, setRange] = useState({ first: 0, last: 12 });
  const rows = Math.ceil(count / columns);
  const pitch = rowHeight + gap;

  useLayoutEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const view = scroller;
    const compute = () => {
      const viewH = view ? view.clientHeight : window.innerHeight;
      const hostTop = view ? host.getBoundingClientRect().top - view.getBoundingClientRect().top + view.scrollTop : host.getBoundingClientRect().top + window.scrollY;
      const scrollTop = view ? view.scrollTop : window.scrollY;
      const top = Math.max(0, scrollTop - hostTop);
      const first = Math.max(0, Math.floor(top / pitch) - overscan);
      const last = Math.min(rows - 1, Math.ceil((top + viewH) / pitch) + overscan);
      setRange((r) => (r.first === first && r.last === last ? r : { first, last }));
    };
    compute();
    const target: HTMLElement | Window = view ?? window;
    target.addEventListener("scroll", compute, { passive: true });
    const ro = new ResizeObserver(compute);
    if (view) ro.observe(view);
    ro.observe(host);
    return () => {
      target.removeEventListener("scroll", compute);
      ro.disconnect();
    };
  }, [scroller, pitch, rows, overscan]);

  // reset to the top of the list when the data changes underneath
  useEffect(() => {
    setRange((r) => (r.first >= rows ? { first: 0, last: Math.min(rows - 1, 12) } : r));
  }, [rows]);

  const start = range.first * columns;
  const end = Math.min(count, (range.last + 1) * columns);
  const cells: ReactNode[] = [];
  for (let i = start; i < end; i++) cells.push(renderItem(i));

  return (
    <div ref={hostRef} className={cx("cf-vgrid", className)} style={{ height: Math.max(0, rows * pitch - gap) }} role="group" aria-label={ariaLabel}>
      <div
        className="cf-vgrid__window"
        style={{
          top: range.first * pitch,
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridAutoRows: rowHeight,
          gap,
        }}
      >
        {cells}
      </div>
    </div>
  );
}
