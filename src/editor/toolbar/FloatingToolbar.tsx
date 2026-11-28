/**
 * The contextual toolbar docked at the top centre of the workspace. It follows the selection:
 * text, shape, line, image / frame, graphic, group, table / chart, several elements, a locked
 * selection, the crop mode - or the page itself when nothing is selected.
 *
 * Render it as a child of <Workspace> (it positions itself in workspace coordinates). It also hosts
 * the "Alternative text" dialog that the context menu opens.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type WheelEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { findElement } from "@/core/ops";
import { elementPath } from "@/core/penShape";
import { useActivePage, useEditor, useSelectedElements } from "@/core/store";
import type {
  ChartElement,
  DesignElement,
  ElementOf,
  ElementType,
  GraphicElement,
  GroupElement,
  ImageElement,
  LineElement,
  Page,
  ShapeElement,
  TableElement,
  TextElement,
  VideoElement,
} from "@/core/types";
import { useGesture } from "@/editor/canvas/gestureStore";
import { usePathEdit } from "@/editor/canvas/pathEditStore";
import { m } from "@/i18n";
import { AltTextDialog } from "./AltTextDialog";
import { LinkDialog } from "./LinkDialog";
import { CropBar, FrameBar, ImageBar } from "./bars/ImageBar";
import { VideoBar } from "./bars/VideoBar";
import { PathBar } from "./bars/PathBar";
import { GraphicBar } from "./bars/GraphicBar";
import { DataBar, GroupBar, LockedBar, MultiBar, PageBar } from "./bars/MiscBars";
import { LineBar, ShapeBar } from "./bars/ShapeBar";
import { TextBar } from "./bars/TextBar";
import { sameIds } from "./selection";
import { isBarLetter } from "../barLetters";
import "./FloatingToolbar.css";

function allOfType<T extends ElementType>(els: DesignElement[], type: T): els is ElementOf<T>[] {
  return els.every((e) => e.type === type);
}

interface Resolved {
  /** aria-label of the toolbar */
  label: string;
  kind: string;
  content: ReactNode;
}

/** Decides which toolbar the current selection / mode needs. */
function resolveBar(page: Page, targets: DesignElement[], selection: string[], cropId: string | null, pathEditId: string | null): Resolved {
  const crop = cropId ? findElement(page, cropId) : null;
  if ((crop?.type === "image" || crop?.type === "video") && crop.src) return { label: m.editor.toolbar.bars.crop, kind: "crop", content: <CropBar el={crop} /> };
  const editing = pathEditId ? findElement(page, pathEditId) : null;
  if (editing?.type === "shape" && elementPath(editing)) return { label: m.editor.toolbar.bars.path, kind: "path", content: <PathBar el={editing} /> };

  if (!targets.length) return { label: m.editor.toolbar.bars.page, kind: "page", content: <PageBar background={page.background} /> };

  // Locked elements cannot be edited: the toolbar acts on the rest of the selection.
  const editable = targets.filter((e) => !e.locked);
  if (!editable.length) return { label: m.editor.toolbar.bars.locked, kind: "locked", content: <LockedBar ids={targets.map((e) => e.id)} /> };

  const ids = editable.map((e) => e.id);
  /** copy / paste style work on the real selection only (not on a text edited inside a group) */
  const copyEnabled = sameIds(selection, ids);
  const common = { label: m.editor.toolbar.bars.selected };

  if (allOfType(editable, "text")) return { ...common, kind: "text", content: <TextBar els={editable as TextElement[]} ids={ids} copyEnabled={copyEnabled} /> };
  if (allOfType(editable, "shape")) return { ...common, kind: "shape", content: <ShapeBar els={editable as ShapeElement[]} ids={ids} copyEnabled={copyEnabled} /> };
  if (allOfType(editable, "line")) return { ...common, kind: "line", content: <LineBar els={editable as LineElement[]} ids={ids} copyEnabled={copyEnabled} /> };
  if (allOfType(editable, "graphic")) return { ...common, kind: "graphic", content: <GraphicBar els={editable as GraphicElement[]} ids={ids} copyEnabled={copyEnabled} /> };
  if (allOfType(editable, "image")) {
    const images = editable as ImageElement[];
    if (images.length === 1 && images[0].isFrame && !images[0].src) return { ...common, kind: "frame", content: <FrameBar el={images[0]} /> };
    if (images.every((i) => i.src)) return { ...common, kind: "image", content: <ImageBar els={images} ids={ids} copyEnabled={copyEnabled} /> };
  }
  if (allOfType(editable, "video")) return { ...common, kind: "video", content: <VideoBar els={editable as VideoElement[]} ids={ids} copyEnabled={copyEnabled} /> };
  if (editable.length === 1 && editable[0].type === "group") return { ...common, kind: "group", content: <GroupBar els={editable as GroupElement[]} ids={ids} /> };
  if (editable.length === 1 && (editable[0].type === "table" || editable[0].type === "chart")) {
    return { ...common, kind: "data", content: <DataBar els={editable as Array<TableElement | ChartElement>} ids={ids} /> };
  }
  return { ...common, kind: "multi", content: <MultiBar els={editable} ids={ids} /> };
}

/**
 * The canvas hotkeys listen on `window` and only skip text fields: arrows would nudge the selection while a slider
 * thumb or menu has focus, Enter / Space would be swallowed instead of pressing the focused button, and letters
 * would add elements. Keys pressed inside the toolbars, popovers, menus and dialogs therefore stop at `document`
 * (Escape and anything with Ctrl / Cmd / Alt - undo, copy, lock ... - still pass, and so does a letter on a button of a
 * toolbar, where a closed popover hands the keyboard back: src/editor/barLetters.ts).
 */
function isolateOverlayKeys(e: KeyboardEvent): void {
  if (e.key === "Escape" || e.ctrlKey || e.metaKey || e.altKey || isBarLetter(e)) return;
  if (e.target instanceof Element && e.target.closest("[data-cf-ui], [data-cf-layer]")) e.stopPropagation();
}

export function FloatingToolbar() {
  useEffect(() => {
    document.addEventListener("keydown", isolateOverlayKeys);
    return () => document.removeEventListener("keydown", isolateOverlayKeys);
  }, []);

  const design = useEditor((s) => s.design);
  const mode = useEditor((s) => s.mode);
  const presenting = useEditor((s) => s.presenting);
  const cropId = useEditor((s) => s.croppingId);
  const pathEditId = usePathEdit((s) => s.id);
  const editingId = useEditor((s) => s.editingTextId);
  const selection = useEditor(useShallow((s) => s.selection));
  const gesture = useGesture((s) => s.active);
  const page = useActivePage();
  const selected = useSelectedElements();

  let bar: Resolved | null = null;
  if (design && page && mode === "edit" && !presenting && !gesture) {
    // A text edited inside a group is the real target even though the group is what stays selected.
    const editing = editingId ? findElement(page, editingId) : null;
    const targets = editing?.type === "text" ? [editing] : selected;
    bar = resolveBar(page, targets, selection, cropId, pathEditId);
  }

  return (
    <>
      {bar && (
        <ToolbarFrame label={bar.label} kind={bar.kind}>
          {bar.content}
        </ToolbarFrame>
      )}
      <AltTextDialog />
      <LinkDialog />
    </>
  );
}

/** The white pill: scrolls sideways (with edge fades) when the content is wider than the workspace. */
function ToolbarFrame({ label, kind, children }: { label: string; kind: string; children: ReactNode }) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const [fade, setFade] = useState("");

  const measure = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    const next = max > 2 ? `${el.scrollLeft > 2 ? "l" : ""}${el.scrollLeft < max - 2 ? "r" : ""}` : "";
    setFade((prev) => (prev === next ? prev : next));
  }, []);

  // Contents change with the selection: re-measure after every render.
  useLayoutEffect(() => {
    measure();
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    if (el.firstElementChild) ro.observe(el.firstElementChild);
    return () => ro.disconnect();
  }, [measure]);

  const onWheel = (e: WheelEvent<HTMLDivElement>) => {
    const el = scrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
    el.scrollLeft += e.deltaY;
  };

  return (
    <div className="cf-tbwrap">
      <div className="cf-tb" role="toolbar" aria-label={label} aria-orientation="horizontal" data-cf-ui data-cf-toolbar={kind}>
        <div ref={scrollRef} className="cf-tb__scroll" data-fade={fade || undefined} onScroll={measure} onWheel={onWheel}>
          {children}
        </div>
      </div>
    </div>
  );
}
