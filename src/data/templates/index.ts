import type { Template, TemplateCategory } from "@/core/types";
import { m } from "@/i18n";
import { data as en } from "@/i18n/en/data";
import { nameIn } from "../names";
import { PRESENTATIONS_TEMPLATES } from "./presentations";
import { PRINT_TEMPLATES } from "./print";
import { SOCIAL_TEMPLATES } from "./social";

/** All built-in templates (presentations, social media, print). */
export const TEMPLATES: Template[] = [...PRESENTATIONS_TEMPLATES, ...SOCIAL_TEMPLATES, ...PRINT_TEMPLATES];

export const getTemplate = (id: string): Template | undefined => TEMPLATES.find((t) => t.id === id);

export const TEMPLATE_CATEGORY_LABELS: Record<TemplateCategory, string> = m.data.templateCategories;

/** The English name, which search also finds in another language. */
const enName = (t: Template): string => nameIn(en.templates, t.id);

export function searchTemplates(query: string, category?: TemplateCategory | null): Template[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  return TEMPLATES.filter((t) => {
    if (category && t.category !== category) return false;
    if (!words.length) return true;
    const hay = `${t.name} ${enName(t)} ${t.category} ${t.tags.join(" ")}`.toLowerCase();
    return words.every((w) => hay.includes(w));
  });
}
