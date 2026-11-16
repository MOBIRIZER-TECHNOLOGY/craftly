import { useCallback, useEffect, useRef, useState } from "react";
import { m } from "@/i18n";
import { IconButton, IconChevronLeft, IconChevronRight, cx } from "@/ui";
import "./ChipRow.css";

export interface Chip {
  id: string;
  label: string;
}

export interface ChipRowProps {
  chips: Chip[];
  /** selected chip id (`null` = none) */
  value: string | null;
  onChange: (id: string) => void;
  "aria-label": string;
  className?: string;
}

/**
 * Single-choice pill chips in a horizontally scrolling row with fading edges and small arrows that appear
 * when more chips are hidden. Chips are plain buttons (`aria-pressed`) so they work with the keyboard.
 */
export function ChipRow({ chips, value, onChange, "aria-label": ariaLabel, className }: ChipRowProps) {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setEdges({ left: el.scrollLeft > 2, right: el.scrollLeft + el.clientWidth < el.scrollWidth - 2 });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure, chips.length]);

  // keep the selected chip in view
  useEffect(() => {
    const el = scrollerRef.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    el?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [value]);

  const scrollBy = (dir: 1 | -1) => scrollerRef.current?.scrollBy({ left: dir * 180, behavior: "smooth" });

  return (
    <div className={cx("cf-chiprow", edges.left && "has-left", edges.right && "has-right", className)}>
      <div ref={scrollerRef} className="cf-chiprow__scroller" role="group" aria-label={ariaLabel} onScroll={measure}>
        {chips.map((chip) => (
          <button key={chip.id} type="button" className={cx("cf-chip", chip.id === value && "is-selected")} aria-pressed={chip.id === value} onClick={() => onChange(chip.id)}>
            {chip.label}
          </button>
        ))}
      </div>
      {edges.left ? (
        <span className="cf-chiprow__arrow cf-chiprow__arrow--left">
          <IconButton label={m.panelsTabs.shared.scrollLeft} icon={<IconChevronLeft />} size="sm" tabIndex={-1} tooltip={false} onClick={() => scrollBy(-1)} />
        </span>
      ) : null}
      {edges.right ? (
        <span className="cf-chiprow__arrow cf-chiprow__arrow--right">
          <IconButton label={m.panelsTabs.shared.scrollRight} icon={<IconChevronRight />} size="sm" tabIndex={-1} tooltip={false} onClick={() => scrollBy(1)} />
        </span>
      ) : null}
    </div>
  );
}
