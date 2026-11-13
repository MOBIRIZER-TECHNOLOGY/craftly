import { useEffect, type ReactNode } from "react";
import { cssFontFamily, ensureFont, getFontDef, isCustomFamily, type FontDef } from "@/render/fonts";
import { cx } from "@/ui";
import { useVisible } from "../../shared/hooks";
import "./FontRow.css";

const CATEGORY_LABELS: Record<FontDef["category"], string> = {
  sans: "Sans serif",
  serif: "Serif",
  display: "Display",
  script: "Script",
  handwriting: "Handwriting",
  mono: "Monospace",
};

export const fontCategoryLabel = (family: string): string => {
  if (isCustomFamily(family)) return "Uploaded font";
  const def = getFontDef(family);
  return def ? CATEGORY_LABELS[def.category] : "Custom font";
};

export interface FontRowProps {
  family: string;
  /** called on click; the row is a plain button so it works with Enter / Space */
  onPick: () => void;
  /** small action at the right edge (remove, ...). Clicking it does not trigger `onPick`. */
  trailing?: ReactNode;
  label?: string;
  className?: string;
  /** sample text; defaults to the family name */
  sample?: string;
}

/**
 * One font in its own face. The font file is requested only once the row scrolls near the viewport, so a list
 * of sixty families does not fetch sixty files up front.
 */
export function FontRow({ family, onPick, trailing, label, className, sample }: FontRowProps) {
  const [ref, visible] = useVisible<HTMLDivElement>({ rootMargin: "200px 0px" });
  useEffect(() => {
    if (visible) void ensureFont(family, 400);
  }, [visible, family]);

  return (
    <div ref={ref} className={cx("cf-fontrow", className)}>
      <button type="button" className="cf-fontrow__main" aria-label={label ?? `Add text in ${family}`} onClick={onPick}>
        <span className="cf-fontrow__sample" style={{ fontFamily: cssFontFamily(family) }}>
          {sample ?? family}
        </span>
        <span className="cf-fontrow__meta">{fontCategoryLabel(family)}</span>
      </button>
      {trailing ? <span className="cf-fontrow__trailing">{trailing}</span> : null}
    </div>
  );
}
