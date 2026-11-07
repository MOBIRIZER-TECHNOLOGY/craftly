/** Derived template lists for the dashboard. Everything returns an empty list while TEMPLATES is empty. */
import type { DesignSummary, Template, TemplateCategory } from "@/core/types";
import { getDesignType } from "@/data/designTypes";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS } from "@/data/templates";

export const CATEGORY_ORDER = Object.keys(TEMPLATE_CATEGORY_LABELS) as TemplateCategory[];

export interface CategoryInfo {
  id: TemplateCategory;
  label: string;
  count: number;
  /** first template of the category, used as its picture */
  example: Template;
}

/** Categories that contain at least one template, in catalogue order. */
export function templateCategories(): CategoryInfo[] {
  const groups = new Map<TemplateCategory, Template[]>();
  for (const template of TEMPLATES) {
    const list = groups.get(template.category);
    if (list) list.push(template);
    else groups.set(template.category, [template]);
  }
  const known = CATEGORY_ORDER.filter((id) => groups.has(id));
  // categories outside the label table (should not happen) still show up, after the known ones
  const extra = [...groups.keys()].filter((id) => !CATEGORY_ORDER.includes(id));
  return [...known, ...extra].map((id) => {
    const list = groups.get(id) as Template[];
    return { id, label: TEMPLATE_CATEGORY_LABELS[id] ?? id, count: list.length, example: list[0] };
  });
}

/**
 * "Templates for you": the kinds of design the user made recently come first, then everything else, interleaved
 * category by category so the row stays varied.
 */
export function templatesForYou(designs: DesignSummary[], limit: number): Template[] {
  if (TEMPLATES.length === 0) return [];
  const groups = new Map<TemplateCategory, Template[]>();
  for (const template of TEMPLATES) {
    const list = groups.get(template.category);
    if (list) list.push(template);
    else groups.set(template.category, [template]);
  }
  const preferred: TemplateCategory[] = [];
  for (const design of designs.slice(0, 8)) {
    const category = getDesignType(design.typeId)?.templates;
    if (category && groups.has(category) && !preferred.includes(category)) preferred.push(category);
  }
  const order = [...preferred, ...[...groups.keys()].filter((id) => !preferred.includes(id))];

  const picked: Template[] = [];
  for (let round = 0; picked.length < limit; round += 1) {
    let added = false;
    for (const id of order) {
      const template = groups.get(id)?.[round];
      if (!template) continue;
      picked.push(template);
      added = true;
      if (picked.length >= limit) break;
    }
    if (!added) break;
  }
  return picked;
}
