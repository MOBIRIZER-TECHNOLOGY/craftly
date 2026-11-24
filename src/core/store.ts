/**
 * The editor store. One Zustand store holds the open design, the selection,
 * undo/redo history, view state (zoom, panels) and every action that changes them.
 *
 * Rules:
 *  - Components read with selectors and call `useEditor.getState().actions.*`.
 *  - Every document change goes through `commit`, which handles history,
 *    text re-measuring and the "unsaved" flag.
 *  - Gestures (drag, resize, slider scrubbing) wrap their updates in
 *    `beginTransaction()` / `endTransaction()` so they become ONE undo step,
 *    or pass `{ coalesce: "key" }` for repeated discrete edits.
 */
import { applyOps, diffDesign, type Op } from "@/collab/ops";
import { m } from "@/i18n";
import { withShared } from "@/collab/session";
import { animatableElements, getPageAnimationPreset, MAX_PAGE_DURATION, MIN_PAGE_DURATION, pageAnimationFor, type AnimPhase } from "./animation";
import { cloneDeep } from "./clone";
import { produce, type Draft } from "immer";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import { connectable, rebindClones, reflowLines } from "./connectors";
import { createPage, cloneElement, createLine, DEFAULT_INK, solid } from "./factory";
import { boundsOfElements } from "./geometry";
import { uid } from "./ids";
import * as ops from "./ops";
import { carryComments, cleanCommentText, COMMENT_COORD_MAX, MAX_COMMENTS, MAX_REPLIES, settleComments } from "./comments";
import type {
  Anchor,
  CommentAnchor,
  CommentAuthor,
  Design,
  DesignComment,
  DesignElement,
  ElementAnimation,
  Fill,
  ID,
  LiveLink,
  Page,
  PageTransition,
  Point,
  SizeUnit,
  TextElement,
  TextParagraph,
} from "./types";
import { alignAnchor, measureTextElement } from "@/render/textLayout";
import { onFontsChange } from "@/render/fonts";
import { rotatePoint } from "./geometry";

/* ------------------------------------------------------------------ */
/* state types                                                         */
/* ------------------------------------------------------------------ */

export type LeftTab = "templates" | "elements" | "text" | "brand" | "uploads" | "tools" | "projects" | "apps";

export type ColorTarget = "text" | "fill" | "stroke" | "shadow" | "page" | "graphic" | "effect" | "table" | "chart" | "highlight";

export type ContextPanelState =
  | { kind: "position"; tab: "arrange" | "layers" }
  | { kind: "effects" }
  | { kind: "color"; target: ColorTarget; /** for graphics: the original colour being replaced */ key?: string }
  | { kind: "font" }
  | { kind: "filters"; tab: "filters" | "adjust" | "tools" }
  | { kind: "background" }
  | { kind: "data"; /** a table's cell to put the keyboard into, as a double click on the table asks for */ cell?: { row: number; col: number } }
  | { kind: "animate"; tab: "element" | "page" };

export type ToolId = "select" | "text" | "shape" | "line" | "draw" | "pen" | "hand" | "comment";

export type DialogName = "resize" | "shortcuts" | "findReplace" | "download" | "share" | "settings" | "versions" | "rename" | "newDesign" | "models" | "accessibility";

export interface SnapGuide {
  /** "v" = vertical line at x, "h" = horizontal line at y (design px) */
  axis: "v" | "h";
  pos: number;
  /** extent of the guide along the other axis */
  from: number;
  to: number;
  kind?: "edge" | "center" | "page" | "spacing";
}

export interface EditorState {
  design: Design | null;
  activePageId: ID;
  selection: ID[];
  /** group being edited from the inside (double click) */
  focusGroupId: ID | null;
  hoverId: ID | null;
  editingTextId: ID | null;
  croppingId: ID | null;
  tool: ToolId;
  toolShape: string;
  mode: "edit" | "view";

  zoom: number;
  zoomMode: "fit" | "fill" | "custom";
  viewport: { w: number; h: number };
  showRulers: boolean;
  snapEnabled: boolean;
  /** snap to the design's grid, and draw it over the page */
  snapToGrid: boolean;
  /** the margins of the page are drawn (src/core/geometry.ts `pageMargin`), and elements snap to them */
  showMargins: boolean;
  /**
   * The browser marks misspelt words while a text box is typed in. Off unless somebody asks for it, and remembered on this device
   * (SPELL_CHECK_KEY): the checking is the browser's own, and what a browser does with the words is its affair, not Craftly's.
   */
  spellCheck: boolean;

  leftTab: LeftTab;
  context: ContextPanelState | null;
  panelOpen: boolean;
  showPageStrip: boolean;
  gridView: boolean;
  notesOpen: boolean;
  presenting: boolean;
  dialog: DialogName | null;

  past: Design[];
  future: Design[];
  canUndo: boolean;
  canRedo: boolean;
  /** the design is being edited together with other people: undo and redo then take back this person's own steps (see startLive) */
  live: boolean;

  saveState: "saved" | "saving" | "unsaved" | "error";
  lastSavedAt: number;
  /** increments on every document change; renderers key off it */
  docVersion: number;

  snapGuides: SnapGuide[];
  clipboard: { elements: DesignElement[]; pasted: number } | null;
  styleClipboard: Record<string, unknown> | null;
  /** "Add page" menu / template picker support: last template page applied */
  actions: EditorActions;
}

/** What the store tells the connection to the people who share the design with this person (src/collab): every change, as the design before and after. */
export interface LiveBridge {
  change(before: Design, after: Design): void;
  /**
   * Who else is typing in this text box, by the name they are shown under, or null. Text typed into one box by two people is
   * one value, of which one side would be lost, so a box that somebody is typing in is not opened here (docs/COLLABORATION.md).
   */
  textHolder?(id: ID): string | null;
  /** A text box was not opened for typing because `holder` is typing in it: where the person is told. */
  textRefused?(id: ID, holder: string): void;
  /**
   * Whether the comments are shared with the others (the server said so in its welcome). When they are not, or the connection does
   * not say, what others did never replaces this person's own comments (docs/COLLABORATION.md, "Comments").
   */
  sharesComments?(): boolean;
}

/** What a new comment is made of; the id, the time and the state are the store's. */
export interface NewComment {
  pageId: ID;
  anchor: CommentAnchor;
  text: string;
  author: CommentAuthor;
}

/** One step of this person's own work in a shared design, as operations: to do it again, and to take it back. */
interface LiveStep {
  forward: Op[];
  inverse: Op[];
}

export interface AddOptions {
  select?: boolean;
  /** centre the new elements on the page (default true) or at `at` */
  center?: boolean;
  at?: Point;
  pageId?: ID;
}

export interface UpdateOptions {
  /** merge consecutive updates with the same key into one undo step */
  coalesce?: string;
}

export interface EditorActions {
  /* document */
  openDesign(design: Design): void;
  closeDesign(): void;
  setTitle(title: string): void;
  /** set the page margin in design px; values are kept within half the shorter page side */
  setMargin(margin: number): void;
  /** set grid spacing in design px */
  setGridSize(size: number): void;
  /** library metadata that lives on the document (stored with it, so autosave never overwrites it) */
  updateMeta(patch: Partial<Pick<Design, "starred" | "folderId" | "trashedAt">>): void;
  resizeDesign(width: number, height: number, scaleContent: boolean, unit?: SizeUnit, smart?: boolean): void;
  replaceDesign(design: Design): void;
  /**
   * The design is shared with other people from now on: every change is told to the bridge, and undo and redo take back this person's
   * own steps (as operations, so that another person's changes since are not undone). The history so far is dropped.
   */
  startLive(bridge: LiveBridge): void;
  /** Back to a design of one's own: the connection is detached and the history is empty. */
  stopLive(): void;
  /** The design as the people who share it now have it: shown at once, without a step of undo and without being told back. */
  applyShared(shared: Design): void;
  /** Where this design is shared, or null: stored with the design on this device, never sent. */
  setLiveLink(link: LiveLink | null): void;

  /* pages */
  setActivePage(id: ID): void;
  addPage(opts?: { index?: number; page?: Page; blank?: boolean }): ID;
  duplicatePage(id?: ID): void;
  deletePage(id?: ID): void;
  movePage(id: ID, toIndex: number): void;
  setPageBackground(fill: Fill, pageId?: ID): void;
  setPageName(pageId: ID, name: string): void;
  setPageNotes(pageId: ID, notes: string): void;

  /* animation */
  /** set (or, with null, remove) one phase of the animation on these elements */
  setAnimation(ids: ID[], phase: AnimPhase, anim: ElementAnimation | null): void;
  /** change some settings (duration, delay, direction) of one phase; merged into one undo step while scrubbing */
  patchAnimation(ids: ID[], phase: AnimPhase, patch: Partial<ElementAnimation>): void;
  /** give every element of the page the same staggered entrance (null removes all entrances) */
  setPageAnimation(presetId: string | null, pageId?: ID): void;
  /** how the presentation arrives at the page ("all" = every page except the first) */
  setPageTransition(transition: PageTransition | null, scope?: "page" | "all", pageId?: ID): void;
  /** seconds the page stays on screen when played or exported */
  setPageDuration(seconds: number, scope?: "page" | "all", pageId?: ID): void;
  /** put a template page's content on the active page (replace) or as a new page (add) */
  applyTemplatePage(page: Page, mode: "replace" | "add"): void;

  /* elements */
  addElements(els: DesignElement[], opts?: AddOptions): ID[];
  addElement(el: DesignElement, opts?: AddOptions): ID;
  /**
   * Draws an arrow from one element of the open page to another and attaches it to both: it follows them when they move, change
   * size or turn (src/core/connectors.ts). The sides are the ones that face each other unless `fromAnchor` / `toAnchor` say
   * otherwise. Returns the id of the line, "" when the elements cannot be joined (the same one twice, one that is not at the top
   * level of the page, a line) or the document is only being viewed.
   */
  connect(fromId: ID, toId: ID, opts?: { fromAnchor?: Anchor; toAnchor?: Anchor }): ID;
  updateElements(ids: ID[], patch: Partial<DesignElement> | ((el: DesignElement) => void), opts?: UpdateOptions): void;
  updateSelection(patch: Partial<DesignElement> | ((el: DesignElement) => void), opts?: UpdateOptions): void;
  /** Like `updateElements` for a page that may not be the open one: a slow job finishing after the person turned the page. */
  updateElementsOnPage(pageId: ID, ids: ID[], patch: Partial<DesignElement> | ((el: DesignElement) => void), opts?: UpdateOptions): void;
  deleteElements(ids?: ID[]): void;
  duplicateSelection(): void;
  groupSelection(): void;
  ungroupSelection(): void;
  arrange(mode: ops.ArrangeMode, ids?: ID[]): void;
  align(mode: ops.AlignMode, relativeTo?: "page" | "selection"): void;
  distribute(axis: "horizontal" | "vertical"): void;
  flip(axis: "horizontal" | "vertical"): void;
  setLocked(ids: ID[], locked: boolean): void;
  setHidden(ids: ID[], hidden: boolean): void;
  nudge(dx: number, dy: number): void;
  moveToIndex(id: ID, index: number): void;
  renameElement(id: ID, name: string): void;
  /** replace the image of an image element / frame (keeps the box, resets crop) */
  replaceImage(id: ID, src: string, naturalWidth: number, naturalHeight: number): void;
  /**
   * Takes elements off a page (the open one unless `pageId` says otherwise) and puts a copy of `el`, with an id of its own, where
   * the top-most of them was: one undo step, and the new element is selected when the page is the open one. Returns its id, or ""
   * when nothing was done (an element is missing, locked or inside a group).
   */
  replaceElements(ids: ID[], el: DesignElement, pageId?: ID): ID;

  /* ruler guides ("v" = vertical line at x, "h" = horizontal line at y, design px) */
  addGuide(axis: "v" | "h", pos: number): void;
  moveGuide(axis: "v" | "h", index: number, pos: number): void;
  removeGuide(axis: "v" | "h", index: number): void;
  clearGuides(): void;

  /* selection */
  select(ids: ID[], opts?: { additive?: boolean }): void;
  toggleSelect(id: ID): void;
  selectAll(): void;
  clearSelection(): void;
  setHover(id: ID | null): void;
  enterGroup(id: ID | null): void;

  /* text */
  setTextProps(ids: ID[] | null, patch: Partial<TextElement>, opts?: UpdateOptions): void;
  setTextParagraphs(id: ID, paragraphs: TextParagraph[]): void;
  /** `selectId` keeps another element (e.g. the enclosing group) as the visible selection */
  startTextEdit(id: ID, selectId?: ID): void;
  endTextEdit(): void;
  /** Who else is typing in this text box in a shared design, or null: such a box is not opened for typing here. */
  textHolder(id: ID): string | null;

  /*
   * comments (src/core/comments.ts): no steps of undo, alone or in a shared design, because they are what people said and in a
   * shared design what others answered; undo of a step around them leaves them as they are. Nothing is done while the design is
   * only looked at. Texts are cleaned to plain text first; a text that is empty then does nothing.
   */
  /** Pins a new comment: its id, or "" when nothing was added (an empty text, no such page, the most comments a design may hold). */
  addComment(comment: NewComment): ID;
  /** Answers a comment: the id of the reply, or "" when nothing was added. */
  replyToComment(commentId: ID, text: string, author: CommentAuthor): ID;
  /** Changes the text of a comment, or of one of its replies, and notes when. */
  editComment(commentId: ID, text: string, replyId?: ID): void;
  setCommentResolved(commentId: ID, resolved: boolean): void;
  /** Deletes a comment with its thread, or one of its replies. */
  deleteComment(commentId: ID, replyId?: ID): void;

  /* crop */
  startCrop(id: ID): void;
  endCrop(): void;

  /* clipboard */
  copy(): void;
  cut(): void;
  paste(at?: Point): void;
  copyStyle(): void;
  pasteStyle(): void;

  /* history */
  undo(): void;
  redo(): void;
  beginTransaction(): void;
  endTransaction(): void;

  /* view */
  setZoom(zoom: number, mode?: "fit" | "fill" | "custom"): void;
  zoomBy(factor: number): void;
  setZoomMode(mode: "fit" | "fill"): void;
  setViewport(w: number, h: number): void;
  setGuides(guides: SnapGuide[]): void;
  toggle(key: "showRulers" | "snapEnabled" | "snapToGrid" | "showMargins" | "spellCheck" | "showPageStrip" | "gridView" | "notesOpen" | "panelOpen"): void;
  setPresenting(on: boolean): void;

  /* chrome */
  setLeftTab(tab: LeftTab): void;
  openContext(ctx: ContextPanelState): void;
  closeContext(): void;
  openDialog(name: DialogName): void;
  closeDialog(): void;
  setTool(tool: ToolId, shape?: string): void;
  setMode(mode: "edit" | "view"): void;
  setSaveState(state: EditorState["saveState"]): void;
}

/* ------------------------------------------------------------------ */
/* what is remembered on this device                                   */
/* ------------------------------------------------------------------ */

/** Where the choice to check spelling is kept: "1" when it is on, nothing when it is off. */
export const SPELL_CHECK_KEY = "craftly.spellcheck";

/** The remembered choice. Off where there is no storage (a test in Node, a private window that refuses it). */
function storedSpellCheck(): boolean {
  try {
    return typeof localStorage !== "undefined" && localStorage.getItem(SPELL_CHECK_KEY) === "1";
  } catch {
    return false;
  }
}

function rememberSpellCheck(on: boolean): void {
  try {
    if (on) localStorage.setItem(SPELL_CHECK_KEY, "1");
    else localStorage.removeItem(SPELL_CHECK_KEY);
  } catch {
    /* no storage: the choice holds until the page is closed */
  }
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 120;
/** keep in sync with MARGIN_X / MARGIN_Y in editor/canvas/viewStore.ts */
const FIT_PAD_X = 72;
const FIT_PAD_Y = 48;

export const pageOf = (design: Design | null, id: ID): Page | null => design?.pages.find((p) => p.id === id) ?? null;

/** Below this width (a phone), the margin beside the page is a share of the width, not FIT_PAD_X (B13). */
const NARROW_VIEWPORT = 600;
/** On a phone a fitted page leaves this share of the width free on each side: the page takes 88% of the width. */
const NARROW_PAD_SHARE = 0.06;

/**
 * The room kept on the left and on the right of the page in a workspace `viewW` px wide: 72 px, or 6% of a phone's width, where
 * 72 px on each side would leave the page 60% of the screen. The workspace lays the page out with the same margin
 * (editor/canvas/viewStore.ts), so that a fitted page sits in the middle without scrolling.
 */
export function pageMarginX(viewW: number): number {
  return viewW < NARROW_VIEWPORT ? viewW * NARROW_PAD_SHARE : FIT_PAD_X;
}

function fitZoomFor(design: Design, vw: number, vh: number, mode: "fit" | "fill", stripH: number): number {
  const padX = pageMarginX(vw);
  const availW = Math.max(120, vw - padX * 2);
  const availH = Math.max(120, vh - FIT_PAD_Y * 2 - stripH);
  const z = mode === "fit" ? Math.min(availW / design.width, availH / design.height) : Math.max(availW / design.width, availH / design.height);
  return Math.min(4, Math.max(0.05, z));
}

/** A wrapping box narrower than this is no use: a box whose anchor is this close to the edge of the page keeps growing with its text. */
const MIN_WRAP_WIDTH = 80;

/**
 * A text box that grows as wide as its text (`autoWidth`) and was inside the page until now would reach past the left or right edge
 * of the page with its new text or size: the box it becomes instead, which is as wide as the page allows from the side its alignment
 * holds (left edge, right edge or middle) and wraps its lines. Null when the box may keep growing: it fits, it already reached past
 * the page (someone put it there), or it is turned, where "the edge of the page" is not one side of the box.
 */
function wrapAtPageEdge(el: TextElement, before: DesignElement, measuredWidth: number, pageWidth: number): { x: number; width: number; height: number } | null {
  if (!el.autoWidth || el.rotation || before.x < -0.5 || before.x + before.width > pageWidth + 0.5) return null;
  const anchor = alignAnchor(el.align);
  const held = el.x + anchor * el.width;
  const left = held - anchor * measuredWidth;
  if (left >= -0.5 && left + measuredWidth <= pageWidth + 0.5) return null;
  const width = anchor === 0 ? pageWidth - held : anchor === 1 ? held : 2 * Math.min(held, pageWidth - held);
  if (width < MIN_WRAP_WIDTH) return null;
  const x = held - anchor * width;
  return { x, width, height: measureTextElement({ ...el, autoWidth: false, width }).height };
}

/** Re-measure text elements whose object changed; returns the same design when nothing needs fixing. */
function normalizeTexts(next: Design, prev: Design | null, all = false): Design {
  type Fix = { id: ID; width: number; height: number; x: number; y: number; wraps?: true };
  const fixes: Fix[] = [];
  const prevById = new Map<ID, DesignElement>();
  if (prev && !all)
    ops.walk(
      prev.pages.flatMap((p) => p.elements),
      (e) => prevById.set(e.id, e),
    );
  for (const page of next.pages) {
    const onPage = new Set<DesignElement>(page.elements);
    ops.walk(page.elements, (el) => {
      if (el.type !== "text") return;
      const before = prevById.get(el.id);
      if (!all && before === el) return;
      const size = measureTextElement(el);
      if (Math.abs(size.width - el.width) < 0.5 && Math.abs(size.height - el.height) < 0.5) return;
      const wrapped = before && onPage.has(el) ? wrapAtPageEdge(el, before, size.width, next.width) : null;
      if (wrapped) {
        fixes.push({ id: el.id, ...wrapped, y: el.y, wraps: true });
        return;
      }
      let x = el.x;
      let y = el.y;
      if (prevById.has(el.id)) {
        // An existing box changed size: keep its anchor (top edge, horizontal position by alignment)
        // fixed in page space, also when the box is rotated.
        const a = el.autoWidth ? alignAnchor(el.align) : 0;
        const origin = { x: 0, y: 0 };
        const oldCentre = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
        const oldOff = rotatePoint({ x: (a - 0.5) * el.width, y: -el.height / 2 }, origin, el.rotation);
        const newOff = rotatePoint({ x: (a - 0.5) * size.width, y: -size.height / 2 }, origin, el.rotation);
        const centre = { x: oldCentre.x + oldOff.x - newOff.x, y: oldCentre.y + oldOff.y - newOff.y };
        x = centre.x - size.width / 2;
        y = centre.y - size.height / 2;
      }
      fixes.push({ id: el.id, width: size.width, height: size.height, x, y });
    });
  }
  if (!fixes.length) return next;
  const byId = new Map(fixes.map((f) => [f.id, f]));
  return produce(next, (d) => {
    for (const page of d.pages) {
      ops.walk(page.elements, (el) => {
        const fix = byId.get(el.id);
        if (fix && el.type === "text") {
          if (fix.wraps) el.autoWidth = false;
          el.width = fix.width;
          el.height = fix.height;
          el.x = fix.x;
          el.y = fix.y;
        }
      });
    }
  });
}

/** Text measurement and connector routing for a design generated outside editor actions. */
export function normalizeGeneratedDesign(next: Design, before: Design): Design {
  return reflowLines(normalizeTexts(next, before), before);
}

/** Content stays centred on the page / `at` after insertion. */
function placeElements(els: DesignElement[], design: Design, opts: AddOptions): void {
  for (const el of els) if (el.type === "text") Object.assign(el, measureTextElement(el));
  if (opts.center === false && !opts.at) return;
  const b = boundsOfElements(els);
  if (!b) return;
  const cx = opts.at ? opts.at.x : design.width / 2;
  const cy = opts.at ? opts.at.y : design.height / 2;
  const dx = cx - (b.x + b.w / 2);
  const dy = cy - (b.y + b.h / 2);
  for (const el of els) {
    el.x += dx;
    el.y += dy;
  }
}

const STYLE_KEYS: Record<string, string[]> = {
  text: ["fontFamily", "fontSize", "fontWeight", "italic", "underline", "strike", "color", "gradient", "align", "lineHeight", "letterSpacing", "textCase", "effect", "curve"],
  shape: ["fill", "stroke", "radius"],
  line: ["stroke", "startArrow", "endArrow"],
  image: ["filter", "radius", "stroke"],
  graphic: ["colors", "strokeWidth"],
};

/* ------------------------------------------------------------------ */
/* store                                                               */
/* ------------------------------------------------------------------ */

export const useEditor = create<EditorState>()((set, get) => {
  let txnDepth = 0;
  let txnBase: Design | null = null;
  let lastCoalesce: { key: string; at: number } | null = null;
  // a design that is shared: the connection, and this person's own steps (undo and redo are theirs alone)
  let bridge: LiveBridge | null = null;
  let liveUndo: LiveStep[] = [];
  let liveRedo: LiveStep[] = [];
  let txnSteps: LiveStep[] = [];
  const joinSteps = (a: LiveStep, b: LiveStep): LiveStep => ({ forward: [...a.forward, ...b.forward], inverse: [...b.inverse, ...a.inverse] });
  const detachLive = () => {
    bridge = null;
    liveUndo = [];
    liveRedo = [];
    txnSteps = [];
  };

  /** the page strip and bottom bar sit outside the workspace, so the viewport already excludes them */
  const stripHeight = () => 0;

  function recalcZoom(design: Design, mode: "fit" | "fill" | "custom", viewport = get().viewport): number | null {
    if (mode === "custom") return null;
    return fitZoomFor(design, viewport.w, viewport.h, mode, stripHeight());
  }

  /** the single door for document changes; `history: false` is a change that is no step of undo (comments) */
  function commit(recipe: (d: Draft<Design>) => void, opts: UpdateOptions & { history?: false } = {}): boolean {
    const s = get();
    if (!s.design || s.mode === "view") return false;
    const base = s.design;
    const produced = produce(base, (d) => {
      recipe(d);
    });
    if (produced === base) return false;
    settle(base, produced, opts);
    return true;
  }

  /**
   * A change of the document that has been made: what the editor works out by itself (text boxes, attached lines), the history, and
   * the people who share the design. record: false leaves the history alone (undo and redo themselves).
   */
  function settle(base: Design, produced: Design, opts: UpdateOptions & { record?: boolean; history?: false } = {}): void {
    const s = get();
    // (the comments of a page that went go with it, and a pin on an element that went stays where the element was: src/core/comments.ts)
    const normalized = normalizeTexts(produced, base);
    const fitted = produce(normalized, (d) => {
      if (txnDepth > 0 || !s.focusGroupId) return;
      const page = pageOf(d, s.activePageId);
      const group = page?.elements.find((el) => el.id === s.focusGroupId && el.type === "group");
      if (group?.type === "group") ops.fitGroup(group);
    });
    let next = settleComments(base, reflowLines(fitted, base));
    next = produce(next, (d) => {
      d.updatedAt = Date.now();
    });
    // a change of the comments is no step of undo (see `addComment`): it changes nothing of the history
    const history = opts.history !== false;

    let past = s.past;
    let future = s.future;
    let canUndo: boolean;
    let canRedo: boolean;
    let told = false;
    if (bridge) {
      // shared: history is made of this person's own steps as operations; a change that is not for the others (a star) is not a step
      const forward = diffDesign(base, next);
      if (forward.length) {
        told = true;
        if (opts.record !== false && history) recordLive({ forward, inverse: diffDesign(next, base) }, opts);
      }
      canUndo = liveUndo.length > 0;
      canRedo = liveRedo.length > 0;
    } else {
      if (txnDepth > 0 || !history) {
        // inside a transaction history is handled by endTransaction; a change of the comments makes none
      } else {
        const now = Date.now();
        const merge = opts.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < 1200;
        if (merge) {
          lastCoalesce = { key: opts.coalesce as string, at: now };
        } else {
          past = [...past.slice(-(HISTORY_LIMIT - 1)), base];
          future = [];
          lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
        }
      }
      canUndo = past.length > 0;
      canRedo = future.length > 0;
    }
    set({ design: next, past, future, canUndo, canRedo, docVersion: s.docVersion + 1, saveState: "unsaved" });
    if (told) bridge?.change(base, next);
  }

  /** This person's own step in a shared design: one with the others of a gesture or of edits that are coalesced. */
  function recordLive(step: LiveStep, opts: UpdateOptions): void {
    if (txnDepth > 0) {
      txnSteps.push(step);
      return;
    }
    const now = Date.now();
    const merge = opts.coalesce && lastCoalesce && lastCoalesce.key === opts.coalesce && now - lastCoalesce.at < 1200 && liveUndo.length > 0;
    if (merge) {
      lastCoalesce = { key: opts.coalesce as string, at: now };
      liveUndo = [...liveUndo.slice(0, -1), joinSteps(liveUndo[liveUndo.length - 1], step)];
    } else {
      liveUndo = [...liveUndo.slice(-(HISTORY_LIMIT - 1)), step];
      liveRedo = [];
      lastCoalesce = opts.coalesce ? { key: opts.coalesce, at: now } : null;
    }
  }

  /** Undo or redo of this person's own step in a shared design: the operations of the step, applied to the design as it is now. */
  function liveStep(way: "undo" | "redo"): void {
    const s = get();
    const step = (way === "undo" ? liveUndo : liveRedo).at(-1);
    if (!step || !s.design) return;
    if (way === "undo") {
      liveUndo = liveUndo.slice(0, -1);
      liveRedo = [...liveRedo.slice(-(HISTORY_LIMIT - 1)), step];
    } else {
      liveRedo = liveRedo.slice(0, -1);
      liveUndo = [...liveUndo.slice(-(HISTORY_LIMIT - 1)), step];
    }
    lastCoalesce = null;
    const next = applyOps(s.design, way === "undo" ? step.inverse : step.forward);
    if (next !== s.design) settle(s.design, next, { record: false });
    const now = get();
    const activeId = now.design && pageOf(now.design, now.activePageId) ? now.activePageId : (now.design?.pages[0].id ?? "");
    set({
      canUndo: liveUndo.length > 0,
      canRedo: liveRedo.length > 0,
      activePageId: activeId,
      selection: sanitizeSelection(now.design, activeId, now.selection),
      editingTextId: null,
      croppingId: null,
    });
  }

  const activePage = (): Page | null => {
    const s = get();
    return pageOf(s.design, s.activePageId);
  };

  /**
   * A change of the comments: told to the others like any change, and no step of undo. Undo of the steps around it leaves the
   * comments alone (`carryComments`), and in a shared design undo is made of this person's steps as operations, of which a comment
   * is none: taking back a comment would take the answers of others with it, and bringing one back would bring an old copy of them.
   */
  const commitComments = (recipe: (d: Draft<Design>) => void): boolean => commit(recipe, { history: false });

  const withActivePage = (fn: (page: Draft<Page>, d: Draft<Design>) => void, opts?: UpdateOptions) => {
    const id = get().activePageId;
    commit((d) => {
      const page = d.pages.find((p) => p.id === id);
      if (page) fn(page, d);
    }, opts);
  };

  const sanitizeSelection = (design: Design | null, pageId: ID, ids: ID[]): ID[] => {
    const page = pageOf(design, pageId);
    if (!page) return [];
    return ids.filter((id) => ops.locate(page.elements, id));
  };

  const actions: EditorActions = {
    /* ---------------- document ---------------- */
    openDesign(design) {
      const normalized = reflowLines(normalizeTexts(design, null, true), null);
      detachLive();
      txnDepth = 0;
      txnBase = null;
      lastCoalesce = null;
      const s = get();
      const zoom = fitZoomFor(normalized, s.viewport.w, s.viewport.h, "fit", 0);
      set({
        design: normalized,
        activePageId: normalized.pages[0].id,
        selection: [],
        focusGroupId: null,
        hoverId: null,
        editingTextId: null,
        croppingId: null,
        tool: "select",
        mode: "edit",
        zoom,
        zoomMode: "fit",
        past: [],
        future: [],
        canUndo: false,
        canRedo: false,
        live: false,
        saveState: "saved",
        docVersion: s.docVersion + 1,
        context: null,
        gridView: false,
        presenting: false,
        dialog: null,
        snapGuides: [],
      });
    },
    closeDesign() {
      detachLive();
      set({ design: null, selection: [], past: [], future: [], canUndo: false, canRedo: false, live: false, editingTextId: null, croppingId: null, context: null });
    },
    startLive(next) {
      detachLive();
      bridge = next;
      lastCoalesce = null;
      set({ live: true, past: [], future: [], canUndo: false, canRedo: false });
    },
    stopLive() {
      detachLive();
      set({ live: false, past: [], future: [], canUndo: false, canRedo: false });
    },
    applyShared(shared) {
      const s = get();
      if (!bridge || !s.design) return;
      const merged = withShared(s.design, shared, bridge.sharesComments?.() ?? false);
      if (merged === s.design) return;
      // what is derived is worked out here and not sent: the sizes of texts and the lines that follow shapes
      const design = reflowLines(normalizeTexts(merged, s.design), null);
      const activeId = pageOf(design, s.activePageId) ? s.activePageId : design.pages[0].id;
      const open = pageOf(design, activeId)!.elements;
      const there = (id: ID | null) => (id && ops.locate(open, id) ? id : null);
      set({
        design,
        activePageId: activeId,
        selection: sanitizeSelection(design, activeId, s.selection),
        editingTextId: there(s.editingTextId),
        croppingId: there(s.croppingId),
        focusGroupId: there(s.focusGroupId),
        docVersion: s.docVersion + 1,
        saveState: "unsaved",
      });
    },
    setLiveLink(link) {
      const s = get();
      if (!s.design) return;
      const { live: _live, ...rest } = s.design;
      set({ design: link ? { ...rest, live: link } : rest, saveState: "unsaved", docVersion: s.docVersion + 1 });
    },
    setTitle(title) {
      commit((d) => {
        d.title = title.trim() || m.core.untitledDesign;
      });
    },
    setMargin(margin) {
      commit((d) => {
        if (Number.isFinite(margin)) d.margin = Math.max(0, Math.min(Math.min(d.width, d.height) / 2, Math.round(margin)));
      });
    },
    setGridSize(size) {
      commit((d) => {
        if (Number.isFinite(size)) d.gridSize = Math.max(1, Math.min(1000, Math.round(size)));
      });
    },
    updateMeta(patch) {
      commit((d) => {
        Object.assign(d, patch);
      });
    },
    resizeDesign(width, height, scaleContent, unit, smart) {
      commit((d) => {
        ops.resizeDesign(d, Math.max(16, Math.round(width)), Math.max(16, Math.round(height)), scaleContent, smart);
        d.typeId = "custom";
        if (unit) d.unit = unit;
      });
      const s = get();
      if (s.design) {
        const z = recalcZoom(s.design, s.zoomMode);
        if (z) set({ zoom: z });
      }
    },
    replaceDesign(design) {
      // used by version restore: keeps history, swaps the content
      commit((d) => {
        d.pages = cloneDeep(design.pages) as Draft<Design>["pages"];
        d.width = design.width;
        d.height = design.height;
      });
      const s = get();
      set({ activePageId: s.design!.pages[0].id, selection: [] });
    },

    /* ---------------- pages ---------------- */
    setActivePage(id) {
      const s = get();
      if (s.activePageId === id || !pageOf(s.design, id)) return;
      set({ activePageId: id, selection: [], focusGroupId: null, editingTextId: null, croppingId: null, hoverId: null });
    },
    addPage(opts = {}) {
      const s = get();
      const design = s.design;
      if (!design) return "";
      const cur = design.pages.findIndex((p) => p.id === s.activePageId);
      const page = opts.page ? ops.clonePageWithIds(opts.page) : createPage();
      const index = opts.index ?? cur + 1;
      commit((d) => ops.insertPage(d, page, index));
      set({ activePageId: page.id, selection: [], editingTextId: null });
      return page.id;
    },
    duplicatePage(id) {
      const s = get();
      const pageId = id ?? s.activePageId;
      const page = pageOf(s.design, pageId);
      if (!page || !s.design) return;
      const copy = ops.clonePageWithIds(page);
      const index = s.design.pages.findIndex((p) => p.id === pageId) + 1;
      commit((d) => ops.insertPage(d, copy, index));
      set({ activePageId: copy.id, selection: [] });
    },
    deletePage(id) {
      const s = get();
      const design = s.design;
      if (!design || design.pages.length <= 1) return;
      const pageId = id ?? s.activePageId;
      const idx = design.pages.findIndex((p) => p.id === pageId);
      if (idx < 0) return;
      commit((d) => ops.removePage(d, pageId));
      if (pageId === s.activePageId) {
        const pages = get().design!.pages;
        set({ activePageId: pages[Math.min(idx, pages.length - 1)].id, selection: [], editingTextId: null });
      }
    },
    movePage(id, toIndex) {
      commit((d) => ops.movePage(d, id, toIndex));
    },
    setPageBackground(fill, pageId) {
      const id = pageId ?? get().activePageId;
      commit((d) => {
        const p = d.pages.find((x) => x.id === id);
        if (p) p.background = fill as Draft<Fill>;
      });
    },
    setPageName(pageId, name) {
      commit((d) => {
        const p = d.pages.find((x) => x.id === pageId);
        if (p) p.name = name.trim() || undefined;
      });
    },
    setPageNotes(pageId, notes) {
      commit(
        (d) => {
          const p = d.pages.find((x) => x.id === pageId);
          if (p) p.notes = notes;
        },
        { coalesce: `notes:${pageId}` },
      );
    },
    setAnimation(ids, phase, anim) {
      actions.updateElements(ids, (el) => {
        const next = { ...(el.animation ?? {}) } as NonNullable<DesignElement["animation"]>;
        if (anim) next[phase] = { ...anim };
        else delete next[phase];
        if (next.in || next.out || next.loop) el.animation = next;
        else delete el.animation;
      });
    },
    patchAnimation(ids, phase, patch) {
      actions.updateElements(
        ids,
        (el) => {
          const cur = el.animation?.[phase];
          if (!cur) return;
          el.animation = { ...el.animation, [phase]: { ...cur, ...patch } };
        },
        { coalesce: `anim:${phase}:${Object.keys(patch).join(",")}` },
      );
    },
    setPageAnimation(presetId, pageId) {
      const id = pageId ?? get().activePageId;
      const preset = presetId ? getPageAnimationPreset(presetId) : undefined;
      commit((d) => {
        const page = d.pages.find((x) => x.id === id);
        if (!page) return;
        const targets = preset ? animatableElements(page as Page, d) : page.elements.filter((el) => !el.locked);
        targets.forEach((el, i) => {
          if (preset) el.animation = { ...(el.animation ?? {}), in: pageAnimationFor(preset, i).in };
          else if (el.animation) {
            const { in: _drop, ...rest } = el.animation;
            if (rest.out || rest.loop) el.animation = rest;
            else delete el.animation;
          }
        });
      });
    },
    setPageTransition(transition, scope = "page", pageId) {
      const id = pageId ?? get().activePageId;
      commit((d) => {
        d.pages.forEach((page, i) => {
          if (scope === "all" ? i === 0 : page.id !== id) return;
          if (transition) page.transition = { ...transition };
          else delete page.transition;
        });
      });
    },
    setPageDuration(seconds, scope = "page", pageId) {
      const id = pageId ?? get().activePageId;
      const value = Math.min(MAX_PAGE_DURATION, Math.max(MIN_PAGE_DURATION, Math.round(seconds * 10) / 10));
      commit(
        (d) => {
          for (const page of d.pages) if (scope === "all" || page.id === id) page.duration = value;
        },
        { coalesce: `pdur:${scope === "all" ? "all" : id}` },
      );
    },
    applyTemplatePage(page, mode) {
      const s = get();
      if (!s.design) return;
      const fresh = ops.clonePageWithIds(page);
      if (mode === "add") {
        actions.addPage({ page: fresh });
        return;
      }
      const id = s.activePageId;
      commit((d) => {
        const p = d.pages.find((x) => x.id === id);
        if (!p) return;
        p.elements = fresh.elements as Draft<Page>["elements"];
        p.background = fresh.background as Draft<Fill>;
      });
      set({ selection: [], editingTextId: null });
    },

    /* ---------------- elements ---------------- */
    addElements(els, opts = {}) {
      const s = get();
      const design = s.design;
      if (!design || !els.length) return [];
      const pageId = opts.pageId ?? s.activePageId;
      const items = els.map((e) => cloneElement(e));
      rebindClones(els, items);
      placeElements(items, design, opts);
      commit((d) => {
        const p = d.pages.find((x) => x.id === pageId);
        if (p) p.elements.push(...(items as Draft<DesignElement>[]));
      });
      const ids = items.map((e) => e.id);
      if (opts.select !== false) set({ selection: ids, activePageId: pageId, focusGroupId: null });
      return ids;
    },
    addElement(el, opts) {
      return actions.addElements([el], opts)[0] ?? "";
    },
    connect(fromId, toId, opts = {}) {
      const s = get();
      const page = activePage();
      if (!s.design || !page || !connectable(page, [fromId, toId])) return "";
      // the same weight as the arrows of the Elements panel; the geometry is set by `commit`, which aims every attached line
      const line = createLine({
        stroke: { color: DEFAULT_INK, width: Math.max(4, Math.round(Math.min(s.design.width, s.design.height) * 0.006)), style: "solid", cap: "round" },
        endArrow: "arrow",
        start: { elementId: fromId, anchor: opts.fromAnchor ?? "auto" },
        end: { elementId: toId, anchor: opts.toAnchor ?? "auto" },
      });
      const done = commit((d) => {
        d.pages.find((p) => p.id === page.id)?.elements.push(line as Draft<DesignElement>);
      });
      if (!done) return "";
      set({ selection: [line.id], focusGroupId: null });
      return line.id;
    },
    updateElements(ids, patch, opts) {
      withActivePage((page) => ops.patchElements(page as Page, ids, patch as never), opts);
    },
    updateSelection(patch, opts) {
      actions.updateElements(get().selection, patch, opts);
    },
    updateElementsOnPage(pageId, ids, patch, opts) {
      commit((d) => {
        const page = d.pages.find((p) => p.id === pageId);
        if (page) ops.patchElements(page as Page, ids, patch as never);
      }, opts);
    },
    deleteElements(ids) {
      const target = ids ?? get().selection;
      if (!target.length) return;
      withActivePage((page) => {
        ops.removeElements(
          page as Page,
          target.filter((id) => !ops.findElement(page as Page, id)?.locked),
        );
      });
      set((s) => ({
        selection: s.selection.filter((id) => !target.includes(id)),
        editingTextId: target.includes(s.editingTextId ?? "") ? null : s.editingTextId,
        croppingId: target.includes(s.croppingId ?? "") ? null : s.croppingId,
      }));
    },
    duplicateSelection() {
      const ids = get().selection;
      if (!ids.length) return;
      let created: ID[] = [];
      withActivePage((page) => {
        created = ops.duplicateElements(page as Page, ids);
      });
      set({ selection: created });
    },
    groupSelection() {
      const ids = get().selection;
      if (ids.length < 2) return;
      let gid = "";
      withActivePage((page) => {
        gid = ops.groupElements(page as Page, ids)?.id ?? "";
      });
      if (gid) set({ selection: [gid], focusGroupId: null });
    },
    ungroupSelection() {
      const ids = get().selection;
      const out: ID[] = [];
      withActivePage((page) => {
        for (const id of ids) {
          const el = ops.findElement(page as Page, id);
          if (el?.type === "group") out.push(...ops.ungroup(page as Page, id));
          else out.push(id);
        }
      });
      set({ selection: out, focusGroupId: null });
    },
    arrange(mode, ids) {
      const target = ids ?? get().selection;
      if (!target.length) return;
      withActivePage((page) => ops.reorder(page as Page, target, mode));
    },
    align(mode, relativeTo = "page") {
      const s = get();
      const design = s.design;
      if (!design || !s.selection.length) return;
      const ref = relativeTo === "page" || s.selection.length === 1 ? { x: 0, y: 0, w: design.width, h: design.height } : null;
      withActivePage((page) => ops.alignElements(page as Page, s.selection, mode, ref));
    },
    distribute(axis) {
      const ids = get().selection;
      withActivePage((page) => ops.distributeElements(page as Page, ids, axis));
    },
    flip(axis) {
      const ids = get().selection;
      withActivePage((page) => ops.flipElements(page as Page, ids, axis));
    },
    setLocked(ids, locked) {
      withActivePage((page) => ops.patchElements(page as Page, ids, { locked }));
    },
    setHidden(ids, hidden) {
      withActivePage((page) => ops.patchElements(page as Page, ids, { hidden }));
      if (hidden) set((s) => ({ selection: s.selection.filter((id) => !ids.includes(id)) }));
    },
    nudge(dx, dy) {
      const ids = get().selection;
      if (!ids.length) return;
      withActivePage((page) => ops.moveBy(page as Page, ids, dx, dy), { coalesce: "nudge" });
    },
    moveToIndex(id, index) {
      withActivePage((page) => ops.moveToIndex(page as Page, id, index));
    },
    renameElement(id, name) {
      withActivePage((page) => ops.patchElements(page as Page, [id], { name: name.trim() || undefined }));
    },
    replaceElements(ids, el, pageId) {
      const target = pageId ?? get().activePageId;
      const item = cloneElement(el);
      let done = false;
      commit((d) => {
        const page = d.pages.find((p) => p.id === target);
        if (!page || ids.some((id) => ops.findElement(page as Page, id)?.locked)) return;
        done = ops.replaceElements(page as Page, ids, item);
      });
      if (!done) return "";
      if (target === get().activePageId) set({ selection: [item.id], focusGroupId: null });
      return item.id;
    },
    replaceImage(id, src, naturalWidth, naturalHeight) {
      withActivePage((page) => {
        const el = ops.findElement(page as Page, id);
        if (!el || el.type !== "image") return;
        el.src = src;
        delete el.originalSrc;
        el.naturalWidth = naturalWidth;
        el.naturalHeight = naturalHeight;
        const s = Math.max(el.width / naturalWidth, el.height / naturalHeight);
        const iw = (naturalWidth * s) / el.width;
        const ih = (naturalHeight * s) / el.height;
        el.crop = { x: (1 - iw) / 2, y: (1 - ih) / 2, w: iw, h: ih };
        el.isFrame = el.isFrame ?? false;
      });
    },

    /* ---------------- guides ---------------- */
    addGuide(axis, pos) {
      commit((d) => {
        d.guides ??= { vertical: [], horizontal: [] };
        d.guides[axis === "v" ? "vertical" : "horizontal"].push(Math.round(pos * 10) / 10);
      });
    },
    moveGuide(axis, index, pos) {
      commit((d) => {
        const list = d.guides?.[axis === "v" ? "vertical" : "horizontal"];
        if (list && index >= 0 && index < list.length) list[index] = Math.round(pos * 10) / 10;
      });
    },
    removeGuide(axis, index) {
      commit((d) => {
        d.guides?.[axis === "v" ? "vertical" : "horizontal"].splice(index, 1);
      });
    },
    clearGuides() {
      commit((d) => {
        if (d.guides) d.guides = { vertical: [], horizontal: [] };
      });
    },

    /* ---------------- selection ---------------- */
    select(ids, opts) {
      const s = get();
      const valid = sanitizeSelection(s.design, s.activePageId, ids);
      const next = opts?.additive ? Array.from(new Set([...s.selection, ...valid])) : valid;
      set({
        selection: next,
        editingTextId: next.length === 1 && next[0] === s.editingTextId ? s.editingTextId : null,
        croppingId: next.length === 1 && next[0] === s.croppingId ? s.croppingId : null,
      });
    },
    toggleSelect(id) {
      const s = get();
      set({ selection: s.selection.includes(id) ? s.selection.filter((x) => x !== id) : [...s.selection, id], editingTextId: null, croppingId: null });
    },
    selectAll() {
      const page = activePage();
      if (!page) return;
      set({ selection: page.elements.filter((e) => !e.hidden).map((e) => e.id), editingTextId: null, croppingId: null });
    },
    clearSelection() {
      const s = get();
      if (!s.selection.length && !s.editingTextId && !s.croppingId) return;
      set({ selection: [], editingTextId: null, croppingId: null, focusGroupId: null });
    },
    setHover(id) {
      if (get().hoverId !== id) set({ hoverId: id });
    },
    enterGroup(id) {
      set({ focusGroupId: id });
    },

    /* ---------------- text ---------------- */
    setTextProps(ids, patch, opts) {
      const target = ids ?? get().selection;
      withActivePage((page) => {
        for (const id of target) {
          const el = ops.findElement(page as Page, id);
          if (el?.locked) continue;
          if (el?.type === "text") ops.applyTextProps(el, patch);
          else if (el?.type === "group") ops.walk(el.children, (c) => c.type === "text" && ops.applyTextProps(c, patch));
        }
      }, opts);
    },
    setTextParagraphs(id, paragraphs) {
      withActivePage(
        (page) => {
          const el = ops.findElement(page as Page, id);
          if (el?.type === "text") el.paragraphs = ops.normalizeParagraphs(paragraphs);
        },
        { coalesce: `text:${id}` },
      );
    },
    startTextEdit(id, selectId) {
      const s = get();
      const page = pageOf(s.design, s.activePageId);
      const el = page && ops.findElement(page, id);
      if (!el || el.type !== "text" || el.locked || s.mode === "view") return;
      // one person at a time types in a text box of a shared design: the box stays closed here, and the person is told who has it
      const holder = bridge?.textHolder?.(id) ?? null;
      if (holder !== null) return void bridge?.textRefused?.(id, holder);
      set({ editingTextId: id, selection: [selectId ?? id], croppingId: null });
    },
    endTextEdit() {
      if (get().editingTextId) set({ editingTextId: null });
    },
    textHolder: (id) => bridge?.textHolder?.(id) ?? null,

    /* ---------------- crop ---------------- */
    startCrop(id) {
      const s = get();
      const page = pageOf(s.design, s.activePageId);
      const el = page && ops.findElement(page, id);
      if (!el || el.type !== "image" || !el.src || el.locked) return;
      set({ croppingId: id, selection: [id], editingTextId: null });
    },
    endCrop() {
      if (get().croppingId) set({ croppingId: null });
    },

    /* ---------------- clipboard ---------------- */
    copy() {
      const s = get();
      const page = activePage();
      if (!page || !s.selection.length) return;
      const els = ops
        .topLevelIds(page, s.selection)
        .map((id) => ops.findElement(page, id))
        .filter((e): e is DesignElement => !!e);
      set({ clipboard: { elements: cloneDeep(els), pasted: 0 } });
    },
    cut() {
      actions.copy();
      actions.deleteElements();
    },
    paste(at) {
      const s = get();
      const clip = s.clipboard;
      if (!clip || !s.design) return;
      const n = clip.pasted + 1;
      const copies = clip.elements.map((e) => {
        const c = cloneElement(e);
        c.locked = false;
        return c;
      });
      rebindClones(clip.elements, copies);
      if (at) {
        actions.addElements(copies, { at });
      } else {
        for (const c of copies) {
          c.x += 24 * n;
          c.y += 24 * n;
        }
        actions.addElements(copies, { center: false });
      }
      set({ clipboard: { ...clip, pasted: n } });
    },
    copyStyle() {
      const s = get();
      const page = activePage();
      const el = page && s.selection.length === 1 ? ops.findElement(page, s.selection[0]) : null;
      if (!el) return;
      const keys = STYLE_KEYS[el.type];
      if (!keys) return;
      const style: Record<string, unknown> = { __type: el.type };
      for (const k of keys) style[k] = cloneDeep((el as unknown as Record<string, unknown>)[k]);
      set({ styleClipboard: style });
    },
    pasteStyle() {
      const s = get();
      const style = s.styleClipboard;
      if (!style) return;
      const type = style.__type as string;
      const patch = { ...style };
      delete patch.__type;
      actions.updateSelection((el) => {
        if (el.type !== type) return;
        if (el.type === "text") ops.applyTextProps(el, patch as Partial<TextElement>);
        else Object.assign(el, cloneDeep(patch));
      });
    },

    /* ---------------- comments ---------------- */
    addComment({ pageId, anchor, text, author }) {
      const s = get();
      const clean = cleanCommentText(text);
      const list = s.design?.comments ?? [];
      if (!clean || !pageOf(s.design, pageId) || list.length >= MAX_COMMENTS) return "";
      const hold = (n: number) => Math.max(-COMMENT_COORD_MAX, Math.min(COMMENT_COORD_MAX, Number.isFinite(n) ? n : 0));
      const at: CommentAnchor = { x: hold(anchor.x), y: hold(anchor.y) };
      if (anchor.elementId !== undefined) Object.assign(at, { elementId: anchor.elementId, dx: hold(anchor.dx ?? 0), dy: hold(anchor.dy ?? 0) });
      const comment: DesignComment = { id: uid("c"), pageId, anchor: at, author: { ...author }, createdAt: Date.now(), text: clean, resolved: false, replies: [] };
      return commitComments((d) => {
        d.comments = [...(d.comments ?? []), comment] as Draft<DesignComment>[];
      })
        ? comment.id
        : "";
    },
    replyToComment(commentId, text, author) {
      const clean = cleanCommentText(text);
      const id = uid("r");
      let added = false;
      commitComments((d) => {
        const c = d.comments?.find((x) => x.id === commentId);
        if (!clean || !c || c.replies.length >= MAX_REPLIES) return;
        c.replies.push({ id, author: { ...author }, createdAt: Date.now(), text: clean });
        added = true;
      });
      return added ? id : "";
    },
    editComment(commentId, text, replyId) {
      const clean = cleanCommentText(text);
      if (!clean) return;
      commitComments((d) => {
        const c = d.comments?.find((x) => x.id === commentId);
        const target = replyId === undefined ? c : c?.replies.find((r) => r.id === replyId);
        if (!target || target.text === clean) return;
        target.text = clean;
        target.editedAt = Date.now();
      });
    },
    setCommentResolved(commentId, resolved) {
      commitComments((d) => {
        const c = d.comments?.find((x) => x.id === commentId);
        if (c) c.resolved = resolved;
      });
    },
    deleteComment(commentId, replyId) {
      commitComments((d) => {
        const c = d.comments?.find((x) => x.id === commentId);
        if (!c || !d.comments) return;
        if (replyId === undefined) d.comments = d.comments.filter((x) => x.id !== commentId);
        else if (c.replies.some((r) => r.id === replyId)) c.replies = c.replies.filter((r) => r.id !== replyId);
      });
    },

    /* ---------------- history ---------------- */
    undo() {
      const s = get();
      if (bridge) return txnDepth > 0 ? undefined : liveStep("undo");
      if (txnDepth > 0 || !s.past.length || !s.design) return;
      // the comments are no step: they stay as they are now (those of a page that comes back with the step come back with it)
      const prev = carryComments(s.design, s.past[s.past.length - 1]);
      const past = s.past.slice(0, -1);
      const future = [s.design, ...s.future].slice(0, HISTORY_LIMIT);
      lastCoalesce = null;
      const activeId = prev.pages.some((p) => p.id === s.activePageId) ? s.activePageId : prev.pages[0].id;
      set({
        design: prev,
        past,
        future,
        canUndo: past.length > 0,
        canRedo: true,
        activePageId: activeId,
        selection: sanitizeSelection(prev, activeId, s.selection),
        editingTextId: null,
        croppingId: null,
        docVersion: s.docVersion + 1,
        saveState: "unsaved",
      });
    },
    redo() {
      const s = get();
      if (bridge) return txnDepth > 0 ? undefined : liveStep("redo");
      if (txnDepth > 0 || !s.future.length || !s.design) return;
      const next = carryComments(s.design, s.future[0]);
      const future = s.future.slice(1);
      const past = [...s.past, s.design];
      lastCoalesce = null;
      const activeId = next.pages.some((p) => p.id === s.activePageId) ? s.activePageId : next.pages[0].id;
      set({
        design: next,
        past,
        future,
        canUndo: true,
        canRedo: future.length > 0,
        activePageId: activeId,
        selection: sanitizeSelection(next, activeId, s.selection),
        editingTextId: null,
        croppingId: null,
        docVersion: s.docVersion + 1,
        saveState: "unsaved",
      });
    },
    beginTransaction() {
      if (txnDepth === 0) txnBase = get().design;
      txnDepth++;
    },
    endTransaction() {
      if (txnDepth === 0) return;
      txnDepth--;
      if (txnDepth > 0) return;
      const beforeFit = get().design;
      if (beforeFit && get().focusGroupId) {
        const fitted = produce(beforeFit, (d) => {
          const page = pageOf(d, get().activePageId);
          const group = page?.elements.find((el) => el.id === get().focusGroupId && el.type === "group");
          if (group?.type === "group") ops.fitGroup(group);
        });
        if (fitted !== beforeFit) settle(beforeFit, fitted, { record: false, history: false });
      }
      const s = get();
      const base = txnBase;
      txnBase = null;
      if (bridge) {
        // a gesture is one step of this person's own work, whatever the others did while it lasted
        const steps = txnSteps;
        txnSteps = [];
        if (!steps.length) return;
        liveUndo = [...liveUndo.slice(-(HISTORY_LIMIT - 1)), steps.reduce(joinSteps)];
        liveRedo = [];
        lastCoalesce = null;
        set({ canUndo: true, canRedo: false });
        return;
      }
      if (!base || !s.design || base === s.design) return;
      const past = [...s.past.slice(-(HISTORY_LIMIT - 1)), base];
      lastCoalesce = null;
      set({ past, future: [], canUndo: true, canRedo: false });
    },

    /* ---------------- view ---------------- */
    setZoom(zoom, mode = "custom") {
      set({ zoom: Math.min(4, Math.max(0.05, zoom)), zoomMode: mode });
    },
    zoomBy(factor) {
      const z = get().zoom;
      set({ zoom: Math.min(4, Math.max(0.05, z * factor)), zoomMode: "custom" });
    },
    setZoomMode(mode) {
      const s = get();
      if (!s.design) return;
      set({ zoomMode: mode, zoom: fitZoomFor(s.design, s.viewport.w, s.viewport.h, mode, stripHeight()) });
    },
    setViewport(w, h) {
      const s = get();
      if (Math.abs(s.viewport.w - w) < 1 && Math.abs(s.viewport.h - h) < 1) return;
      const patch: Partial<EditorState> = { viewport: { w, h } };
      if (s.design && s.zoomMode !== "custom") patch.zoom = fitZoomFor(s.design, w, h, s.zoomMode, stripHeight());
      set(patch as EditorState);
    },
    setGuides(guides) {
      const cur = get().snapGuides;
      if (cur.length === 0 && guides.length === 0) return;
      set({ snapGuides: guides });
    },
    toggle(key) {
      const s = get();
      set({ [key]: !s[key] } as Partial<EditorState> as EditorState);
      if (key === "spellCheck") rememberSpellCheck(!s[key]);
    },
    setPresenting(on) {
      set({ presenting: on, selection: on ? [] : get().selection });
    },

    /* ---------------- chrome ---------------- */
    setLeftTab(tab) {
      set({ leftTab: tab, context: null, panelOpen: true });
    },
    openContext(ctx) {
      set({ context: ctx, panelOpen: true });
    },
    closeContext() {
      if (get().context) set({ context: null });
    },
    openDialog(name) {
      set({ dialog: name });
    },
    closeDialog() {
      set({ dialog: null });
    },
    setTool(tool, shape) {
      set({ tool, toolShape: shape ?? get().toolShape, selection: tool === "select" ? get().selection : [], editingTextId: null });
    },
    setMode(mode) {
      set({ mode, selection: mode === "view" ? [] : get().selection, editingTextId: null, croppingId: null });
    },
    setSaveState(state) {
      set({ saveState: state, lastSavedAt: state === "saved" ? Date.now() : get().lastSavedAt });
    },
  };

  // when a font finishes loading, text boxes must be re-measured (silently, no history)
  if (typeof window !== "undefined") {
    onFontsChange(() => {
      const s = get();
      if (!s.design) return;
      const fixed = reflowLines(normalizeTexts(s.design, null, true), s.design);
      if (fixed !== s.design) {
        const patch = { design: fixed, docVersion: s.docVersion + 1 };
        // keep history snapshots consistent so undo does not resurrect stale boxes
        set(patch as EditorState);
      } else {
        set({ docVersion: s.docVersion + 1 });
      }
    });
  }

  return {
    design: null,
    activePageId: "",
    selection: [],
    focusGroupId: null,
    hoverId: null,
    editingTextId: null,
    croppingId: null,
    tool: "select",
    toolShape: "rect",
    mode: "edit",
    zoom: 0.5,
    zoomMode: "fit",
    viewport: { w: 1000, h: 700 },
    showRulers: false,
    snapEnabled: true,
    snapToGrid: false,
    showMargins: false,
    spellCheck: storedSpellCheck(),
    leftTab: "elements",
    context: null,
    panelOpen: true,
    showPageStrip: true,
    gridView: false,
    notesOpen: false,
    presenting: false,
    dialog: null,
    past: [],
    future: [],
    canUndo: false,
    canRedo: false,
    live: false,
    saveState: "saved",
    lastSavedAt: 0,
    docVersion: 0,
    snapGuides: [],
    clipboard: null,
    styleClipboard: null,
    actions,
  };
});

/* ------------------------------------------------------------------ */
/* convenience selectors                                               */
/* ------------------------------------------------------------------ */

export const getActions = () => useEditor.getState().actions;

export function getActivePage(s: EditorState): Page | null {
  return pageOf(s.design, s.activePageId);
}

export function getSelectedElements(s: EditorState): DesignElement[] {
  const page = getActivePage(s);
  if (!page || !s.selection.length) return [];
  return s.selection.map((id) => ops.findElement(page, id)).filter((e): e is DesignElement => !!e);
}

/** The page being edited (re-renders when its content changes). */
export function useActivePage(): Page | null {
  return useEditor((s) => getActivePage(s));
}

/** Selected elements, in selection order. Re-renders only when they change. */
export function useSelectedElements(): DesignElement[] {
  const page = useEditor((s) => getActivePage(s));
  const selection = useEditor(useShallow((s) => s.selection));
  return useMemo(() => (page ? selection.map((id) => ops.findElement(page, id)).filter((e): e is DesignElement => !!e) : []), [page, selection]);
}

export { solid, uid };
