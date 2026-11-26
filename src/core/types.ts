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

export type ElementType = "text" | "shape" | "line" | "image" | "graphic" | "group" | "table" | "chart" | "video";

/** How an element mixes its colours with what is under it (src/core/blend.ts). The names are those of a canvas's `globalCompositeOperation` and of a style sheet's `mix-blend-mode`. */
export type BlendMode =
  | "darken"
  | "multiply"
  | "color-burn"
  | "lighten"
  | "screen"
  | "color-dodge"
  | "overlay"
  | "soft-light"
  | "hard-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

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
  /** how the element mixes with what is under it; absent is Normal (a group mixes as one, its elements inside it) */
  blend?: BlendMode;
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
  /** numeric font weight when it is more specific than bold, 100..900 */
  weight?: number;
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

/** Where on an element a line is attached: the middle of one of its sides, or "auto" for the side that faces the other end. */
export type Anchor = "auto" | "top" | "right" | "bottom" | "left";

/** An end of a line that is attached to an element of the same page. */
export interface LineBinding {
  elementId: ID;
  anchor: Anchor;
}

export type LineRouting = "straight" | "elbow" | "curved";

export interface LineElement extends ElementBase {
  type: "line";
  /** a straight line runs from (x, y) to (x+width, y); a route is expressed in the same local box */
  stroke: Stroke;
  routing?: LineRouting;
  /** elbow points, or four cubic Bezier points when routing is curved */
  route?: Point[];
  /** optional text drawn at the middle of the route */
  label?: string;
  startArrow: ArrowKind;
  endArrow: ArrowKind;
  /**
   * The ends that are attached to elements of the page (src/core/connectors.ts): such an end follows its element when that moves,
   * changes size or turns, and the line goes when the element does. Null or absent: a free end, at the place that the line puts it.
   */
  start?: LineBinding | null;
  end?: LineBinding | null;
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
  highlights?: number;
  shadows?: number;
  sharpen?: number;
  tint?: number;
  curves?: number;
  levels?: number;
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
  /** straighten angle in degrees inside the frame */
  rotation?: number;
}

export interface ImageElement extends ElementBase {
  type: "image";
  /**
   * null => empty frame placeholder.
   * "asset:<id>"   uploaded file stored in IndexedDB
   * "builtin:<id>" procedurally generated stock image (src/data/photos.ts)
   * "data:..." / "blob:..." the picture itself
   * (never an address on the web: src/core/imageSources.ts says why, and takes such an address out where a design comes in)
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
  /** custom normalized path when mask is "path" */
  maskPath?: string;
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

export interface TableCell {
  row: number;
  col: number;
}

export interface TableMerge extends TableCell {
  rowSpan: number;
  colSpan: number;
}

export interface TableCellStyle {
  fill?: Color;
  color?: Color;
  bold?: boolean;
  align?: TextAlign;
}

export interface TableElement extends ElementBase {
  type: "table";
  cells: string[][];
  merges?: TableMerge[];
  /** optional overrides keyed "row:column" */
  cellStyles?: Record<string, TableCellStyle>;
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

export type ChartKind = "bar" | "column" | "line" | "area" | "combo" | "scatter" | "pie" | "donut";

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
  /** bar, column and area charts with several series: the series of a category on top of each other, not side by side (absent: side by side) */
  stacked?: boolean;
  /** stacked values as a share of each category's total */
  percent?: boolean;
  /** the words along the axis of the values; none when absent or empty (a pie or donut has no axis) */
  valueAxisTitle?: string;
  /** the words along the axis of the categories; none when absent or empty */
  categoryAxisTitle?: string;
}

/* ---- video ---- */

/**
 * An uploaded clip on the page (src/render/videos.ts). It is drawn like a picture (crop, frame shape, corners, outline): at rest
 * as the frame at `trimStart`, and in Present, an animation preview and a recorded video as the clip playing from `trimStart`
 * to `trimEnd` at `speed`, over and over. Still downloads (PNG, PDF, SVG, PowerPoint) hold that first frame.
 */
/** How a clip's captions look (each part optional: see clipCaptionStyle in core/animation.ts for the defaults). */
export interface CaptionStyle {
  /** where on the clip: over its bottom (the default), its middle or its top */
  place?: "bottom" | "middle" | "top";
  /** small, medium (the default) or large, against the size of the clip */
  size?: "s" | "m" | "l";
  /** the kind of letters: sans-serif (the default), serif or monospaced; the browser's own fonts of that kind */
  font?: "sans" | "serif" | "mono";
  /** colour of the words, "#rrggbb" (white by default) */
  color?: string;
  /** what is behind the words: a dark band (the default), a light one, or none, the words then outlined to stay readable */
  band?: "dark" | "light" | "none";
}

/** One line of a clip's captions. */
export interface ClipCaption {
  start: number;
  end: number;
  text: string;
}

export interface VideoElement extends ElementBase {
  type: "video";
  /** "asset:<id>": a clip stored in this browser's uploads (no other scheme: a design never plays a clip from the web) */
  src: string;
  naturalWidth: number;
  naturalHeight: number;
  /** seconds: the length of the whole clip */
  duration: number;
  /** seconds into the clip where it starts and stops playing (0 <= trimStart < trimEnd <= duration) */
  trimStart: number;
  trimEnd: number;
  /** how fast it plays, 0.25 to 4 (1 = as recorded) */
  speed: number;
  /** without its sound in Present (a clip is always silent while editing) */
  muted?: boolean;
  /**
   * Lines of text shown over the bottom of the clip while it plays, each from `start` to `end` seconds of one play of the clip (from
   * when it starts on its page, at its speed); they come again with every play. See clipCaptions in core/animation.ts.
   */
  captions?: ClipCaption[];
  /** how its captions look (white words on a dark band over its bottom when absent) */
  captionStyle?: CaptionStyle;
  /** seconds into its page at which it starts playing; until then it shows its first frame, silent (0 when absent) */
  startAt?: number;
  /** plays once and then holds its last frame, silent, for the rest of its page (it plays over and over when absent) */
  once?: boolean;
  /**
   * Seconds into one play of a clip that plays over and over (seconds of the page, at its speed) at which its first play begins: a
   * loop carried on from the page it was split from (0 when absent; not read for a clip that plays once). See clipLoopFrom.
   */
  loopFrom?: number;
  /** how loud it plays, from 0 to 1 (1 when absent): see clipVolume in core/animation.ts */
  volume?: number;
  /** seconds over which its sound rises at the start of every play of it, and falls at the end (0 to 5, 0 when absent) */
  fadeIn?: number;
  fadeOut?: number;
  crop: ImageCrop;
  /** a picture's filter and adjustments, on every frame (none when absent): see clipFilter in core/factory.ts */
  filter?: ImageFilter;
  /** frame shape from the shape catalogue ("rect" = none) */
  mask: ShapeKind;
  maskPath?: string;
  radius: number;
  stroke?: Stroke | null;
}

export type DesignElement = TextElement | ShapeElement | LineElement | ImageElement | GraphicElement | GroupElement | TableElement | ChartElement | VideoElement;

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

/**
 * Where a design that is edited together with other people lives on a server (src/collab, docs/COLLABORATION.md): the server's
 * address (http:// or https://; the socket is on the same address), the room, the key that was given for it and what that key
 * allows. The person who started sharing also keeps the key that only lets people look, to hand it out again. Kept on this device
 * with the local design. Portable project files and backups omit the link and all its credentials.
 */
export interface LiveLink {
  server: string;
  room: string;
  key: string;
  role: "edit" | "view";
  viewKey?: string;
  ownerKey?: string;
}

/**
 * Who wrote a comment or a reply: the name they gave (plain text, shown as text) and the index of their colour in the fixed list of
 * presence colours (src/editor/live/presence.ts). No colour itself is ever stored or sent, only its place in that list.
 */
export interface CommentAuthor {
  name: string;
  colorIndex: number;
}

/**
 * Where the pin of a comment is, in design pixels from the corner of its page. With `elementId` the pin follows that element (at
 * `dx`, `dy` from its corner); `x`, `y` is where it was last known to be, and is where it stays when the element is gone.
 */
export interface CommentAnchor {
  x: number;
  y: number;
  elementId?: ID;
  dx?: number;
  dy?: number;
}

/** An answer in the thread of a comment. */
export interface CommentReply {
  id: ID;
  author: CommentAuthor;
  /** epoch ms */
  createdAt: number;
  /** epoch ms of the last change of the text, when it was changed */
  editedAt?: number;
  /** plain text, never markup (src/core/comments.ts has the limits) */
  text: string;
}

/** A note pinned to a place of a page (docs/COLLABORATION.md, "Comments"). It is never drawn into the design or an export. */
export interface DesignComment {
  id: ID;
  pageId: ID;
  anchor: CommentAnchor;
  author: CommentAuthor;
  createdAt: number;
  editedAt?: number;
  text: string;
  resolved: boolean;
  replies: CommentReply[];
}

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
  /** margin in design px; absent means the default 5% of the shorter page side */
  margin?: number;
  /** grid spacing in design px; absent means 20 */
  gridSize?: number;
  /** present while the design is shared with other people; see `LiveLink` */
  live?: LiveLink;
  /** notes pinned to places of the pages; none is the same as an empty list (an older design has none) */
  comments?: DesignComment[];
  /**
   * The format of this document (src/core/schema/design.ts): CURRENT_DESIGN_VERSION when this build wrote it. A design read
   * from storage or a file passes through `migrateDesign` first, so the editor only ever holds the current version.
   */
  version: number;
}

/** Light-weight record used by the dashboard (no page content). */
export interface DesignSummary {
  revision?: string;
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
  /**
   * The `version` of the stored design this record was made from (a record without one is from before it was kept: 1).
   * Saving refuses to write over a design that a newer release stored, without reading the design to find out.
   */
  schema?: number;
  /**
   * The space on an account server that the design belongs to (docs/ACCOUNTS.md): the person's own space (their id) or a team's.
   * None for a design that is on this device only, which is every design of a person who never signed in.
   */
  space?: string;
}

export interface Folder {
  id: ID;
  name: string;
  createdAt: number;
  parentId: ID | null;
  /** The space of an account server the folder belongs to; none for a folder on this device only (as `DesignSummary.space`). */
  space?: string;
}

/** The details of a design that sync compares and sends apart from its content (`PATCH …/meta`, docs/ACCOUNTS.md). */
export interface SyncedMeta {
  title: string;
  folderId: ID | null;
  starred: boolean;
  trashedAt: number | null;
}

/**
 * What this device knows of a design's copy on an account server: a record of the `sync` store (database step 2), keyed by the
 * design's id. It belongs to the device: a backup leaves it out. The design is dirty when its summary's `revision` is not
 * `syncedRevision`, its details when they are not `syncedMeta`. `tombstone` is a design deleted for good here whose deletion the
 * server has not had yet.
 */
export interface SyncRecord {
  id: ID;
  space: string;
  /** the server's revision the copy here was last in step with; null for a design the server has never had */
  serverRev: number | null;
  /** the summary's `revision` at that moment; null when the copy here never was in step */
  syncedRevision: string | null;
  syncedMeta: SyncedMeta | null;
  tombstone?: boolean;
}

export interface Asset {
  id: ID;
  name: string;
  kind: "image" | "svg" | "video";
  mime: string;
  size: number;
  width: number;
  height: number;
  createdAt: number;
  blob: Blob;
  /** The space of an account server the upload came from or was sent to; none for an upload on this device only. */
  space?: string;
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
