/**
 * Resolves the lucide icon named in `DESIGN_TYPES[].icon`. Only the icons the catalogue uses are imported (the
 * whole lucide set would add ~1 MB to the dashboard chunk). Lucide 1.x dropped its brand logos, so the social
 * networks map to neutral glyphs; names that are unknown fall back to a generic "shapes" icon.
 */
import {
  AtSign,
  Award,
  Briefcase,
  Camera,
  ChartColumn,
  CreditCard,
  FileText,
  Hexagon,
  Image as ImageGlyph,
  ImagePlus,
  LayoutGrid,
  Mail,
  MailOpen,
  Monitor,
  MonitorPlay,
  PanelTop,
  Pin,
  Play,
  Presentation,
  RectangleHorizontal,
  Shapes,
  Smartphone,
  Square,
  SquareUser,
  ThumbsUp,
  Tv,
  UtensilsCrossed,
} from "lucide-react";
import type { LucideIcon } from "@/ui";
import type { DesignType } from "@/data/designTypes";

const ICONS: Record<string, LucideIcon> = {
  Presentation,
  MonitorPlay,
  Instagram: Camera,
  Facebook: ThumbsUp,
  Youtube: Play,
  Linkedin: Briefcase,
  Twitter: AtSign,
  Square,
  Smartphone,
  Pin,
  PanelTop,
  Tv,
  Image: ImageGlyph,
  ImagePlus,
  FileText,
  CreditCard,
  MailOpen,
  Mail,
  Award,
  UtensilsCrossed,
  UserSquare: SquareUser,
  Hexagon,
  RectangleHorizontal,
  BarChart3: ChartColumn,
  Monitor,
  LayoutGrid,
};

/** Icon for designs that have no catalogue type (custom sizes, uploads). */
export const genericDesignIcon: LucideIcon = Shapes;

/** The icon for a catalogue icon name (never undefined). */
export function designIcon(name: string): LucideIcon {
  return ICONS[name] ?? genericDesignIcon;
}

export function typeIcon(type: Pick<DesignType, "icon">): LucideIcon {
  return designIcon(type.icon);
}
