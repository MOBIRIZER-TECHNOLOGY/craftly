import type { SizeUnit, TemplateCategory } from "@/core/types";
import { m } from "@/i18n";
import { nameIn } from "./names";

export type DesignCategory = "presentation" | "social" | "print" | "document" | "marketing" | "branding";

export interface DesignType {
  id: string;
  name: string;
  category: DesignCategory;
  /** design pixels (print sizes are converted at 96 dpi) */
  width: number;
  height: number;
  /** unit the size is shown in */
  unit: SizeUnit;
  /** name of a lucide-react icon used for the tile */
  icon: string;
  /** accent colour of the illustrated tile */
  color: string;
  /** template category shown first for this design type */
  templates: TemplateCategory;
  popular?: boolean;
}

const inch = (n: number) => Math.round(n * 96);

const SIZES: Array<Omit<DesignType, "name">> = [
  { id: "presentation", category: "presentation", width: 1920, height: 1080, unit: "px", icon: "Presentation", color: "#f97316", templates: "presentation", popular: true },
  { id: "presentation-4-3", category: "presentation", width: 1024, height: 768, unit: "px", icon: "MonitorPlay", color: "#fb923c", templates: "presentation" },
  { id: "instagram-post", category: "social", width: 1080, height: 1350, unit: "px", icon: "Instagram", color: "#ec4899", templates: "social", popular: true },
  { id: "instagram-square", category: "social", width: 1080, height: 1080, unit: "px", icon: "Square", color: "#f43f5e", templates: "social" },
  { id: "instagram-story", category: "social", width: 1080, height: 1920, unit: "px", icon: "Smartphone", color: "#d946ef", templates: "social" },
  { id: "facebook-post", category: "social", width: 940, height: 788, unit: "px", icon: "Facebook", color: "#3b82f6", templates: "social", popular: true },
  { id: "youtube-thumbnail", category: "social", width: 1280, height: 720, unit: "px", icon: "Youtube", color: "#ef4444", templates: "social", popular: true },
  { id: "linkedin-post", category: "social", width: 1200, height: 627, unit: "px", icon: "Linkedin", color: "#0ea5e9", templates: "social" },
  { id: "twitter-post", category: "social", width: 1600, height: 900, unit: "px", icon: "Twitter", color: "#0f172a", templates: "social" },
  { id: "pinterest-pin", category: "social", width: 1000, height: 1500, unit: "px", icon: "Pin", color: "#dc2626", templates: "social" },
  { id: "facebook-cover", category: "social", width: 1640, height: 624, unit: "px", icon: "PanelTop", color: "#2563eb", templates: "banner" },
  { id: "youtube-banner", category: "social", width: 2560, height: 1440, unit: "px", icon: "Tv", color: "#b91c1c", templates: "banner" },
  { id: "poster", category: "print", width: inch(18), height: inch(24), unit: "in", icon: "Image", color: "#8b5cf6", templates: "poster", popular: true },
  { id: "poster-a3", category: "print", width: 1123, height: 1587, unit: "mm", icon: "ImagePlus", color: "#a78bfa", templates: "poster" },
  { id: "flyer", category: "print", width: inch(8.5), height: inch(11), unit: "in", icon: "FileText", color: "#7c3aed", templates: "flyer", popular: true },
  { id: "flyer-a4", category: "print", width: 794, height: 1123, unit: "mm", icon: "FileText", color: "#6d28d9", templates: "flyer" },
  { id: "business-card", category: "print", width: inch(3.5), height: inch(2), unit: "in", icon: "CreditCard", color: "#0d9488", templates: "card" },
  { id: "invitation", category: "print", width: inch(5), height: inch(7), unit: "in", icon: "MailOpen", color: "#db2777", templates: "invitation" },
  { id: "postcard", category: "print", width: inch(6), height: inch(4), unit: "in", icon: "Mail", color: "#ea580c", templates: "card" },
  { id: "certificate", category: "print", width: 1123, height: 794, unit: "mm", icon: "Award", color: "#ca8a04", templates: "certificate" },
  { id: "menu", category: "print", width: inch(8.5), height: inch(11), unit: "in", icon: "UtensilsCrossed", color: "#16a34a", templates: "menu" },
  { id: "doc-a4", category: "document", width: 794, height: 1123, unit: "mm", icon: "FileText", color: "#0891b2", templates: "document", popular: true },
  { id: "doc-letter", category: "document", width: inch(8.5), height: inch(11), unit: "in", icon: "FileText", color: "#0e7490", templates: "document" },
  { id: "resume", category: "document", width: inch(8.5), height: inch(11), unit: "in", icon: "UserSquare", color: "#475569", templates: "resume", popular: true },
  { id: "logo", category: "branding", width: 500, height: 500, unit: "px", icon: "Hexagon", color: "#4f46e5", templates: "logo", popular: true },
  { id: "banner", category: "marketing", width: 1920, height: 480, unit: "px", icon: "RectangleHorizontal", color: "#2dd4bf", templates: "banner" },
  { id: "infographic", category: "marketing", width: 800, height: 2000, unit: "px", icon: "BarChart3", color: "#059669", templates: "document" },
  { id: "wallpaper", category: "marketing", width: 1920, height: 1080, unit: "px", icon: "Monitor", color: "#6366f1", templates: "banner" },
  { id: "photo-collage", category: "marketing", width: 1080, height: 1080, unit: "px", icon: "LayoutGrid", color: "#e11d48", templates: "social" },
];

export const DESIGN_TYPES: DesignType[] = SIZES.map(({ id, ...type }) => ({ id, name: nameIn(m.data.designTypes, id), ...type }));

export const getDesignType = (id: string): DesignType | undefined => DESIGN_TYPES.find((t) => t.id === id);

export const POPULAR_DESIGN_TYPES = DESIGN_TYPES.filter((t) => t.popular);

export const DESIGN_CATEGORY_LABELS: Record<DesignCategory, string> = m.data.designCategories;

/**
 * "1920 × 1080 px", "8.5 × 11 in", "210 × 297 mm".
 *
 * A page is a whole number of pixels, and a pixel is 0.26 mm: A4 is stored as 794 × 1123 px, which is 210.08 × 297.13 mm. The
 * figures after the point there say nothing about the paper, so millimetres are given to a tenth (and centimetres to a hundredth),
 * and a size within a pixel's worth of a round one is given as the round one: "210 × 297 mm".
 */
export function describeSize(width: number, height: number, unit: SizeUnit): string {
  const f = (n: number) => String(Math.round(n * 100) / 100);
  /** to `step`, or to `round` when that is no further away than `near` */
  const snapped = (n: number, round: number, near: number, step: number) => {
    const whole = Math.round(n / round) * round;
    // (toFixed takes away what multiplying by the step leaves behind: 338.70000000000005)
    return String(Number((Math.abs(n - whole) <= near ? whole : Math.round(n / step) * step).toFixed(3)));
  };
  const mm = (px: number) => snapped((px / 96) * 25.4, 1, 0.15, 0.1);
  const cm = (px: number) => snapped((px / 96) * 2.54, 0.1, 0.015, 0.01);
  if (unit === "in") return `${f(width / 96)} × ${f(height / 96)} in`;
  if (unit === "mm") return `${mm(width)} × ${mm(height)} mm`;
  if (unit === "cm") return `${cm(width)} × ${cm(height)} cm`;
  return `${Math.round(width)} × ${Math.round(height)} px`;
}

/** Converts a value typed in `unit` to design pixels (96 dpi). */
export function toPx(value: number, unit: SizeUnit): number {
  if (unit === "in") return value * 96;
  if (unit === "mm") return (value / 25.4) * 96;
  if (unit === "cm") return (value / 2.54) * 96;
  return value;
}

export function fromPx(px: number, unit: SizeUnit): number {
  if (unit === "in") return px / 96;
  if (unit === "mm") return (px / 96) * 25.4;
  if (unit === "cm") return (px / 96) * 2.54;
  return px;
}
