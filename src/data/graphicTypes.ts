/** Shared by the illustration data files (graphicsA.ts, graphicsB.ts) and the Graphics panel. */
import { m } from "@/i18n";

export type GraphicCategory =
  | "abstract"
  | "nature"
  | "objects"
  | "business"
  | "food"
  | "travel"
  | "education"
  | "celebration"
  | "decor"
  | "arrows"
  | "frames"
  | "badges"
  | "doodles"
  | "dividers"
  | "tech";

export interface GraphicDef {
  /** unique, kebab-case, stable (templates may reference it) */
  id: string;
  name: string;
  category: GraphicCategory;
  /** search keywords, lower-case */
  tags: string[];
  /** complete standalone <svg> markup with a viewBox. Use literal hex colours so the user can recolour them. */
  svg: string;
  /** "sticker" items get a soft outline in the panel preview and are inserted as sticker graphics */
  kind?: "illustration" | "sticker";
}

/** A graphic as the data files write it: its name is the catalog's, by id (graphics.ts). */
export type GraphicDraft = Omit<GraphicDef, "name">;

/** In the order of the panel. */
export const GRAPHIC_CATEGORY_LABELS: Record<GraphicCategory, string> = m.data.graphicCategories;
