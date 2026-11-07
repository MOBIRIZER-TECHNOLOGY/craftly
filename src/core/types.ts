/**
 * Craftly document model.
 *
 * Everything here is plain JSON (no classes, Maps or Dates) so a design can be
 * stored in IndexedDB, exported as a file, diffed for undo/redo and cloned with
 * structuredClone. All lengths are design pixels ("px" at 100% zoom); angles
 * are degrees, clockwise.
 */

export type ID = string;
/** Any CSS colour string. Prefer #rrggbb, or rgba() when alpha is needed. */
export type Color = string;

/* ------------------------------------------------------------------ */
/* Paint                                                              */
/* ------------------------------------------------------------------ */

export interface GradientStop {
  /** 0..1 */
  offset: number;
  color: Color;
}

export interface SolidFill {
  type: "solid";
  color: Color;
}

export interface LinearGradientFill {
  type: "linear";
  /** CSS convention: 0 = towards top, 90 = towards right, 180 = towards bottom. */
  angle: number;
  stops: GradientStop[];
}

export interface RadialGradientFill {
  type: "radial";
  stops: GradientStop[];
  /** centre as 0..1 of the box, default .5/.5 */
  cx?: number;
  cy?: number;
}

export type PatternKind = "dots" | "grid" | "lines" | "diagonal" | "checker" | "waves" | "zigzag" | "plus" | "bubbles" | "noise";

export interface PatternFill {
  type: "pattern";
  pattern: PatternKind;
  /** ink colour */
  color: Color;
  /** paper colour */
  background: Color;
  /** 0.4..4, 1 = default tile size */
  scale: number;
}

export interface ImageFill {
  type: "image";
  /** same src scheme as ImageElement.src */
  src: string;
  fit: "cover" | "contain" | "tile";
  /** 0..1 overlay darkening/lightening to keep text legible */
  dim?: number;
}

export type Fill = SolidFill | LinearGradientFill | RadialGradientFill | PatternFill | ImageFill;
/** Fills usable on shapes and text (no image / pattern). */
export type PaintFill = SolidFill | LinearGradientFill | RadialGradientFill;

export type StrokeStyle = "solid" | "dashed" | "dotted";

export interface Stroke {
  color: Color;
  width: number;
  style: StrokeStyle;
  cap?: "butt" | "round" | "square";
  join?: "miter" | "round" | "bevel";
}

export interface Shadow {
  color: Color;
  blur: number;
  x: number;
  y: number;
}

/* ------------------------------------------------------------------ */
/* Elements                                                           */
/* ------------------------------------------------------------------ */

export type ElementType = "text" | "shape" | "line" | "image" | "graphic" | "group" | "table" | "chart";

export interface ElementBase {
  id: ID;
  type: ElementType;
  /** layer name shown in the Layers panel (optional, derived when absent) */
  name?: string;
  /** top-left of the *unrotated* box, in parent space (design space, or group-local space) */
  x: number;
  y: number;
  width: number;
  height: number;
  /** degrees clockwise about the box centre */
  rotation: number;
  /** 0..1 */
  opacity: number;
  flipH?: boolean;
  flipV?: boolean;
  locked?: boolean;
  hidden?: boolean;
  shadow?: Shadow | null;
  /** gaussian blur applied to the whole element, px */
  blur?: number;
  /** accessibility text */
  alt?: string;
  /** optional hyperlink (used by PDF/SVG export and presenting) */
  link?: string;
  /** entrance / exit / emphasis animation (only top-level elements animate; a group moves as one) */
  animation?: ElementAnimations;
}

/* ---- animation ---- */

/** Direction of travel for animations and transitions that have one. */
export type AnimDirection = "left" | "right" | "up" | "down";

export interface ElementAnimation {
  /** preset id from src/core/animation.ts (ANIMATION_PRESETS) */
  kind: string;
  /** seconds: the length of an entrance or exit, or one cycle of an emphasis */
  duration: number;
  /** seconds after the page starts (entrance) or before the page ends (exit); not used by emphasis */
  delay: number;
  direction?: AnimDirection;
}

export interface ElementAnimations {
  /** plays when the page starts */
  in?: ElementAnimation | null;
  /** plays at the end of the page */
  out?: ElementAnimation | null;
  /** repeats for the whole time the page is shown */
  loop?: ElementAnimation | null;
}

/** How the presentation (or an animated export) moves from the previous page to this one. */
export interface PageTransition {
  /** preset id from src/core/transition.ts (TRANSITION_PRESETS) */
  kind: string;
  /** seconds */
  duration: number;
  direction?: AnimDirection;
}

/* ---- text ---- */

export type TextAlign = "left" | "center" | "right" | "justify";
export type TextCase = "none" | "upper" | "lower" | "title";
export type ListKind = "bullet" | "number";

/** A run of text sharing one style. Undefined fields inherit from the element. */
export interface TextRun {
  /** may contain "\n" for a soft line break */
  text: string;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: Color;
  /** px, absolute */
  size?: number;
  font?: string;
  /** thousandths of an em */
  spacing?: number;
}

export interface TextParagraph {
  runs: TextRun[];
  align?: TextAlign;
  list?: ListKind | null;
}

export type TextEffectKind = "none" | "shadow" | "lift" | "hollow" | "splice" | "outline" | "echo" | "glitch" | "neon" | "background";

export interface TextEffect {
  kind: TextEffectKind;
  /** effect colour (shadow / outline / neon glow / background box ...) */
  color?: Color;
  /** 0..100 */
  offset?: number;
  /** degrees, -180..180 */
  direction?: number;
  /** 0..100 */
  blur?: number;
  /** 0..100 (lift strength, neon glow strength) */
  intensity?: number;
  /** 0..100 (outline / hollow thickness) */
  thickness?: number;
  /** 0..100 (background corner roundness) */
  roundness?: number;
  /** 0..100 (background padding) */
  spread?: number;
  /** 0..100 */
  transparency?: number;
}

export interface TextElement extends ElementBase {
  type: "text";
  paragraphs: TextParagraph[];
  fontFamily: string;
  /** px */
  fontSize: number;
  /** 100..900 */
  fontWeight: number;
  italic: boolean;
  underline: boolean;
  strike: boolean;
  color: Color;
  /** when set it replaces `color` as the text paint */
  gradient?: LinearGradientFill | null;
  align: TextAlign;
  /** multiplier, 0.5..3 */
  lineHeight: number;
  /** thousandths of an em, -200..800 */
  letterSpacing: number;
  textCase: TextCase;
  /** true: width follows the content (no wrapping); false: text wraps at `width` */
  autoWidth: boolean;
  effect: TextEffect;
  /** -100..100, 0 = straight; positive bends upwards (arch) */
  curve: number;
  /** list style applied to every paragraph that has no own `list` */
  list?: ListKind | null;
}

/* ---- shapes & lines ---- */

/** id of a shape in the shape catalogue (src/data/shapes.ts) or "path" */
export type ShapeKind = string;

export interface ShapeElement extends ElementBase {
  type: "shape";
  shape: ShapeKind;
  fill: Fill | null;
  stroke: Stroke | null;
  /** corner radius in px for rect-like shapes */
  radius: number;
  /** for shape === "path": SVG path data in a 0..100 x 0..100 box that is stretched to the element */
  path?: string;
  /** polygon / star parameters (sides, innerRatio ...) */
  params?: Record<string, number>;
}

export type ArrowKind = "none" | "arrow" | "triangle" | "open-arrow" | "circle" | "square" | "diamond" | "bar";

export interface LineElement extends ElementBase {
  type: "line";
  /** `width` is the line length; `height` is always 0. The line runs from (x, y) to (x+width, y) before rotation. */
  stroke: Stroke;
  startArrow: ArrowKind;
  endArrow: ArrowKind;
}

/* ---- images & frames ---- */

export interface ImageFilter {
  /** preset id from src/data/filters.ts, "none" for unfiltered */
  preset: string;
  /** 0..100 strength of the preset */
  intensity: number;
  /** -100..100 */
  brightness: number;
  contrast: number;
  saturation: number;
  warmth: number;
  /** 0..100 */
  fade: number;
  vignette: number;
  blur: number;
  /** -100..100 hue rotation (maps to -180..180deg) */
  hue: number;
  /** optional duotone */
  duotone?: { dark: Color; light: Color } | null;
}

/**
 * Where the *whole* source image sits inside the element's box, as fractions of
 * the box. {x:0,y:0,w:1,h:1} means the image exactly fills the box. A cropped
 * photo has w,h > 1 and negative x,y. Resizing the element scales everything
 * proportionally, so the crop is preserved.
 */
export interface ImageCrop {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ImageElement extends ElementBase {
  type: "image";
  /**
   * null => empty frame placeholder.
   * "asset:<id>"   uploaded file stored in IndexedDB
   * "builtin:<id>" procedurally generated stock image (src/data/photos.ts)
   * "data:..." / "http(s):..." literal URL
   */
  src: string | null;
  /**
   * The picture `src` was made from, kept when a tool such as "Remove background" replaced it (same schemes as `src`).
   * "Restore original" puts it back. Replacing the picture by hand forgets it.
   */
  originalSrc?: string;
  naturalWidth: number;
  naturalHeight: number;
  crop: ImageCrop;
  /** mask shape id from the shape catalogue ("rect" = no mask) */
  mask: ShapeKind;
  /** corner radius in px when mask is rect-like */
  radius: number;
  filter: ImageFilter;
  stroke?: Stroke | null;
  /** true when the element is a frame placeholder that should accept dropped photos */
  isFrame?: boolean;
}

/* ---- graphics (SVG icons, illustrations, stickers, QR codes ...) ---- */

export interface GraphicElement extends ElementBase {
  type: "graphic";
  /** complete <svg ...>...</svg> markup with a viewBox */
  svg: string;
  viewW: number;
  viewH: number;
  /** recolouring: original colour (lower-case #rrggbb or "currentColor") -> replacement */
  colors: Record<string, Color>;
  /** only for stroke based icons */
  strokeWidth?: number;
  source?: { kind: "icon" | "illustration" | "sticker" | "qr" | "emoji" | "other"; id?: string };
}

/* ---- group ---- */

export interface GroupElement extends ElementBase {
  type: "group";
  /** children use the group's local space: (0,0) is the group's top-left */
  children: DesignElement[];
}

/* ---- table ---- */

export interface TableElement extends ElementBase {
  type: "table";
  cells: string[][];
  colWidths: number[];
  rowHeights: number[];
  headerRow: boolean;
  fontFamily: string;
  fontSize: number;
  color: Color;
  headerFill: Color;
  headerColor: Color;
  stripeFill: Color | null;
  borderColor: Color;
  borderWidth: number;
  align: TextAlign;
}

/* ---- chart ---- */

export type ChartKind = "bar" | "column" | "line" | "area" | "pie" | "donut";

export interface ChartSeries {
  name: string;
  values: number[];
  color?: Color;
}

export interface ChartElement extends ElementBase {
  type: "chart";
  chart: ChartKind;
  labels: string[];
  series: ChartSeries[];
  palette: Color[];
  fontFamily: string;
  textColor: Color;
  showLegend: boolean;
  showValues: boolean;
  showGrid: boolean;
}

export type DesignElement = TextElement | ShapeElement | LineElement | ImageElement | GraphicElement | GroupElement | TableElement | ChartElement;

export type ElementOf<T extends ElementType> = Extract<DesignElement, { type: T }>;

/* ------------------------------------------------------------------ */
/* Pages and designs                                                  */
/* ------------------------------------------------------------------ */

export interface Page {
  id: ID;
  /** optional title shown above the page in the page strip */
  name?: string;
  background: Fill;
  /** back-to-front paint order */
  elements: DesignElement[];
  /** presenter notes */
  notes?: string;
  /** seconds the page stays on screen when played or exported as an animation (default 5) */
  duration?: number;
  /** how the presentation arrives at this page from the previous one */
  transition?: PageTransition | null;
}

export type SizeUnit = "px" | "in" | "mm" | "cm";

export interface Design {
  id: ID;
  title: string;
  /** design type id (src/data/designTypes.ts), "custom" for custom sizes */
  typeId: string;
  /** design pixels */
  width: number;
  height: number;
  /** unit used to display the size in the UI; storage is always px */
  unit: SizeUnit;
  pages: Page[];
  createdAt: number;
  updatedAt: number;
  folderId: ID | null;
  starred: boolean;
  /** epoch ms when moved to trash, null otherwise */
  trashedAt: number | null;
  /** ruler guides in design px */
  guides?: { vertical: number[]; horizontal: number[] };
  /** schema version for migrations */
  version: 1;
}

/** Light-weight record used by the dashboard (no page content). */
export interface DesignSummary {
  id: ID;
  title: string;
  typeId: string;
  width: number;
  height: number;
  pageCount: number;
  createdAt: number;
  updatedAt: number;
  folderId: ID | null;
  starred: boolean;
  trashedAt: number | null;
  /** small JPEG data URL of page 1 */
  thumbnail?: string;
}

export interface Folder {
  id: ID;
  name: string;
  createdAt: number;
  parentId: ID | null;
}

export interface Asset {
  id: ID;
  name: string;
  kind: "image" | "svg";
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  blob: Blob;
}

export interface BrandKit {
  colors: Color[];
  fonts: string[];
  /** asset ids */
  logos: ID[];
}

/* ------------------------------------------------------------------ */
/* Templates                                                          */
/* ------------------------------------------------------------------ */

export type TemplateCategory = "presentation" | "social" | "poster" | "flyer" | "document" | "resume" | "logo" | "invitation" | "card" | "banner" | "certificate" | "menu";

export interface Template {
  id: string;
  name: string;
  category: TemplateCategory;
  /** design type id used when starting a design from this template */
  typeId: string;
  width: number;
  height: number;
  tags: string[];
  /** dominant colour, shown while the thumbnail renders */
  accent: Color;
  pages: Page[];
}

/* ------------------------------------------------------------------ */
/* Geometry                                                           */
/* ------------------------------------------------------------------ */

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
