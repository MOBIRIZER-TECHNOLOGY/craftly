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
import { animatableElements, getPageAnimationPreset, MAX_PAGE_DURATION, MIN_PAGE_DURATION, pageAnimationFor, type AnimPhase } from "./animation";
import { cloneDeep } from "./clone";
import { produce, type Draft } from "immer";
import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { useMemo } from "react";
import { createPage, cloneElement, solid } from "./factory";
import { boundsOfElements } from "./geometry";
import { uid } from "./ids";
import * as ops from "./ops";
import type { Design, DesignElement, ElementAnimation, Fill, ID, Page, PageTransition, Point, SizeUnit, TextElement, TextParagraph } from "./types";
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
  | { kind: "data" }
  | { kind: "animate"; tab: "element" | "page" };

export type ToolId = "select" | "text" | "shape" | "line" | "draw" | "pen" | "hand";

export type DialogName = "resize" | "shortcuts" | "findReplace" | "download" | "share" | "settings" | "versions" | "rename" | "newDesign" | "models";

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
  /** library metadata that lives on the document (stored with it, so autosave never overwrites it) */
  updateMeta(patch: Partial<Pick<Design, "starred" | "folderId" | "trashedAt">>): void;
  resizeDesign(width: number, height: number, scaleContent: boolean, unit?: SizeUnit): void;
  replaceDesign(design: Design): void;

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
  toggle(key: "showRulers" | "snapEnabled" | "showPageStrip" | "gridView" | "notesOpen" | "panelOpen"): void;
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
/* helpers                                                             */
/* ------------------------------------------------------------------ */

const HISTORY_LIMIT = 120;
/** keep in sync with MARGIN_X / MARGIN_Y in editor/canvas/viewStore.ts */
const FIT_PAD_X = 72;
const FIT_PAD_Y = 48;

export const pageOf = (design: Design | null, id: ID): Page | null => design?.pages.find((p) => p.id === id) ?? null;

function fitZoomFor(design: Design, vw: number, vh: number, mode: "fit" | "fill", stripH: number): number {
  const availW = Math.max(120, vw - FIT_PAD_X * 2);
  const availH = Math.max(120, vh - FIT_PAD_Y * 2 - stripH);
  const z = mode === "fit" ? Math.min(availW / design.width, availH / design.height) : Math.max(availW / design.width, availH / design.height);
  return Math.min(4, Math.max(0.05, z));
}

/** Re-measure text elements whose object changed; returns the same design when nothing needs fixing. */
function normalizeTexts(next: Design, prev: Design | null, all = false): Design {
  type Fix = { id: ID; width: number; height: number; x: number; y: number };
  const fixes: Fix[] = [];
  const prevById = new Map<ID, DesignElement>();
  if (prev && !all)
    ops.walk(
      prev.pages.flatMap((p) => p.elements),
      (e) => prevById.set(e.id, e),
    );
  for (const page of next.pages) {
    ops.walk(page.elements, (el) => {
      if (el.type !== "text") return;
      if (!all) {
        const before = prevById.get(el.id);
        if (before === el) return;
      }
      const m = measureTextElement(el);
      if (Math.abs(m.width - el.width) < 0.5 && Math.abs(m.height - el.height) < 0.5) return;
      let x = el.x;
      let y = el.y;
      if (prevById.has(el.id)) {
        // An existing box changed size: keep its anchor (top edge, horizontal position by alignment)
        // fixed in page space, also when the box is rotated.
        const a = el.autoWidth ? alignAnchor(el.align) : 0;
        const origin = { x: 0, y: 0 };
        const oldCentre = { x: el.x + el.width / 2, y: el.y + el.height / 2 };
        const oldOff = rotatePoint({ x: (a - 0.5) * el.width, y: -el.height / 2 }, origin, el.rotation);
        const newOff = rotatePoint({ x: (a - 0.5) * m.width, y: -m.height / 2 }, origin, el.rotation);
        const centre = { x: oldCentre.x + oldOff.x - newOff.x, y: oldCentre.y + oldOff.y - newOff.y };
        x = centre.x - m.width / 2;
        y = centre.y - m.height / 2;
      }
      fixes.push({ id: el.id, width: m.width, height: m.height, x, y });
    });
  }
  if (!fixes.length) return next;
  const byId = new Map(fixes.map((f) => [f.id, f]));
  return produce(next, (d) => {
    for (const page of d.pages) {
      ops.walk(page.elements, (el) => {
        const fix = byId.get(el.id);
        if (fix && el.type === "text") {
          el.width = fix.width;
          el.height = fix.height;
          el.x = fix.x;
          el.y = fix.y;
        }
      });
    }
  });
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

  /** the page strip and bottom bar sit outside the workspace, so the viewport already excludes them */
  const stripHeight = () => 0;

  function recalcZoom(design: Design, mode: "fit" | "fill" | "custom", viewport = get().viewport): number | null {
    if (mode === "custom") return null;
    return fitZoomFor(design, viewport.w, viewport.h, mode, stripHeight());
  }

  /** the single door for document changes */
  function commit(recipe: (d: Draft<Design>) => void, opts: UpdateOptions = {}): boolean {
    const s = get();
    if (!s.design || s.mode === "view") return false;
    const base = s.design;
    let next = produce(base, (d) => {
      recipe(d);
    });
    if (next === base) return false;
    next = normalizeTexts(next, base);
    next = produce(next, (d) => {
      d.updatedAt = Date.now();
    });

    let past = s.past;
    let future = s.future;
    if (txnDepth > 0) {
      // inside a transaction: history is handled by endTransaction
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
    set({ design: next, past, future, canUndo: past.length > 0, canRedo: future.length > 0, docVersion: s.docVersion + 1, saveState: "unsaved" });
    return true;
  }

  const activePage = (): Page | null => {
    const s = get();
    return pageOf(s.design, s.activePageId);
  };

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
      const normalized = normalizeTexts(design, null, true);
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
      set({ design: null, selection: [], past: [], future: [], canUndo: false, canRedo: false, editingTextId: null, croppingId: null, context: null });
    },
    setTitle(title) {
      commit((d) => {
        d.title = title.trim() || "Untitled design";
      });
    },
    updateMeta(patch) {
      commit((d) => {
        Object.assign(d, patch);
      });
    },
    resizeDesign(width, height, scaleContent, unit) {
      commit((d) => {
        ops.resizeDesign(d, Math.max(16, Math.round(width)), Math.max(16, Math.round(height)), scaleContent);
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
      set({ editingTextId: id, selection: [selectId ?? id], croppingId: null });
    },
    endTextEdit() {
      if (get().editingTextId) set({ editingTextId: null });
    },

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

    /* ---------------- history ---------------- */
    undo() {
      const s = get();
      if (txnDepth > 0 || !s.past.length || !s.design) return;
      const prev = s.past[s.past.length - 1];
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
      if (txnDepth > 0 || !s.future.length || !s.design) return;
      const next = s.future[0];
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
      const s = get();
      const base = txnBase;
      txnBase = null;
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
      const fixed = normalizeTexts(s.design, null, true);
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
