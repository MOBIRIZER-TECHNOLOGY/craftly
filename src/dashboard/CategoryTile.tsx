import type { CSSProperties } from "react";
import type { Template, TemplateCategory } from "@/core/types";
import { TemplateThumb } from "@/components/PageThumb";
import { m } from "@/i18n";
import "./CategoryTile.css";

interface CategoryTileProps {
  category: TemplateCategory;
  label: string;
  count: number;
  /** a template shown as the picture of the tile */
  example: Template;
}

const STAGE_HEIGHT = 116;

/** "Browse template categories": a tile with an example thumbnail, the category name and its template count. */
export function CategoryTile({ category, label, count, example }: CategoryTileProps) {
  const aspect = example.width / Math.max(1, example.height);
  const thumbWidth = Math.round(Math.max(52, Math.min(176, STAGE_HEIGHT * 0.78 * aspect)));
  return (
    <a className="cf-ctile" href={`#/templates/${category}`} aria-label={`${label}, ${m.dashboard.counts.templates(count)}`}>
      <span className="cf-ctile__stage" style={{ "--cf-accent": example.accent } as CSSProperties}>
        <TemplateThumb template={example} width={thumbWidth} className="cf-ctile__thumb" />
      </span>
      <span className="cf-ctile__name">{label}</span>
      <span className="cf-ctile__count">{m.dashboard.counts.templates(count)}</span>
    </a>
  );
}
