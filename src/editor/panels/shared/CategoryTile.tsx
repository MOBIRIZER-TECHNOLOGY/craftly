import type { CSSProperties, ReactNode } from "react";
import { cx } from "@/ui";
import "./CategoryTile.css";

export interface CategoryTileProps {
  label: string;
  /** a lucide icon element, drawn white on the glossy face */
  icon: ReactNode;
  /** gradient start (top-left) and end (bottom-right) of the glossy face */
  from: string;
  to: string;
  /** colour of the card peeking out behind the face (defaults to `to`) */
  plate?: string;
  onClick: () => void;
  /** accessible description, e.g. "Browse shapes" */
  description?: string;
  className?: string;
}

/**
 * The glossy rounded tile used for "Browse categories": a soft gradient face with a highlight, a second
 * card peeking out behind it, an icon and a label underneath. Lifts slightly on hover.
 */
export function CategoryTile({ label, icon, from, to, plate, onClick, description, className }: CategoryTileProps) {
  const style = { "--_from": from, "--_to": to, "--_plate": plate ?? to } as CSSProperties;
  return (
    <button type="button" className={cx("cf-cattile", className)} style={style} onClick={onClick} aria-label={description ?? label}>
      <span className="cf-cattile__art" aria-hidden="true">
        <span className="cf-cattile__plate" />
        <span className="cf-cattile__face">
          <span className="cf-cattile__icon">{icon}</span>
        </span>
      </span>
      <span className="cf-cattile__label">{label}</span>
    </button>
  );
}
