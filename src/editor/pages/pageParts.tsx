/**
 * Pieces shared by the page strip and the grid view: drag-to-reorder, the per-page menu,
 * the page title caption with its inline rename field, and page deletion with undo.
 */
import { useEffect, useRef, useState, type DragEvent } from "react";
import { useEditor } from "@/core/store";
import type { Page } from "@/core/types";
import { IconArrowLeft, IconArrowRight, IconDuplicate, IconPen, IconPlay, IconTrash, toast, useLatest, type MenuEntry } from "@/ui";
import "./pageParts.css";

export const PAGE_MIME = "application/x-craftly-page";

/** Trailing throttle: follows `value` at most once per `ms` (used so thumbnails do not repaint on every frame of a drag). */
export function useThrottled<T>(value: T, ms: number): T {
  const [shown, setShown] = useState(value);
  const last = useRef(0);
  useEffect(() => {
    const wait = last.current + ms - Date.now();
    if (wait <= 0) {
      last.current = Date.now();
      setShown(value);
      return;
    }
    const id = window.setTimeout(() => {
      last.current = Date.now();
      setShown(value);
    }, wait);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return shown;
}

/**
 * The value as it was before `hold` began, for as long as it lasts; the value itself otherwise. The page strip holds its
 * thumbnails while something is dragged on the canvas: painting a thumbnail is painting the whole page, and on a page
 * with much text the drag then had tasks of 50 to 110 ms in it (docs/PERFORMANCE.md).
 */
export function useHeld<T>(value: T, hold: boolean): T {
  const [kept, setKept] = useState(value);
  // state worked out from the properties while rendering, as React describes it: no frame shows a stale value
  if (!hold && kept !== value) setKept(value);
  return hold ? kept : value;
}

/* ------------------------------------------------------------------ */
/* drag to reorder                                                    */
/* ------------------------------------------------------------------ */

export interface ReorderItemProps {
  draggable: boolean;
  onDragStart: (e: DragEvent<HTMLElement>) => void;
  onDragEnd: () => void;
  onDragOver: (e: DragEvent<HTMLElement>) => void;
  onDrop: (e: DragEvent<HTMLElement>) => void;
}

/**
 * HTML5 drag and drop for a row / grid of pages. `slot` is the insertion position (0..count) the pointer
 * is over: the item at index i shows its drop marker on the left edge when slot === i, and the last item
 * on its right edge when slot === count.
 */
export function usePageReorder(ids: string[], onMove: (id: string, toIndex: number) => void, enabled: boolean) {
  const [dragId, setDragId] = useState<string | null>(null);
  const [slot, setSlotState] = useState<number | null>(null);
  const slotRef = useRef<number | null>(null);
  const idsRef = useLatest(ids);
  const moveRef = useLatest(onMove);
  const dragRef = useRef<string | null>(null);

  const setSlot = (value: number | null) => {
    slotRef.current = value;
    setSlotState(value);
  };
  const end = () => {
    dragRef.current = null;
    setDragId(null);
    setSlot(null);
  };

  const drop = (e: DragEvent<HTMLElement>) => {
    const id = dragRef.current;
    if (!id) return;
    e.preventDefault();
    const to = slotRef.current;
    const from = idsRef.current.indexOf(id);
    end();
    if (to === null || from < 0) return;
    // the page is removed first, so every slot after it shifts down by one
    const target = to > from ? to - 1 : to;
    if (target !== from) moveRef.current(id, target);
  };

  const over = (e: DragEvent<HTMLElement>, index: number) => {
    if (!dragRef.current) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = e.currentTarget.getBoundingClientRect();
    setSlot(e.clientX > r.left + r.width / 2 ? index + 1 : index);
  };

  return {
    dragId,
    slot,
    item(id: string, index: number): ReorderItemProps {
      return {
        draggable: enabled,
        onDragStart: (e) => {
          if (!enabled) return;
          e.dataTransfer.setData(PAGE_MIME, id);
          e.dataTransfer.effectAllowed = "move";
          dragRef.current = id;
          setDragId(id);
        },
        onDragEnd: end,
        onDragOver: (e) => over(e, index),
        onDrop: drop,
      };
    },
    /** drop zone after the last item (the add tile) */
    tail(): Pick<ReorderItemProps, "onDragOver" | "onDrop"> {
      return {
        onDragOver: (e) => {
          if (!dragRef.current) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          setSlot(idsRef.current.length);
        },
        onDrop: drop,
      };
    },
  };
}

/* ------------------------------------------------------------------ */
/* menu and delete                                                    */
/* ------------------------------------------------------------------ */

/** Deletes a page; the toast offers Ctrl+Z as a button. */
export function deletePageWithUndo(id: string): void {
  const s = useEditor.getState();
  if (!s.design || s.design.pages.length <= 1 || s.mode === "view") return;
  s.actions.deletePage(id);
  toast.info("Page deleted", { actionLabel: "Undo", onAction: () => useEditor.getState().actions.undo() });
}

export interface PageMenuOptions {
  pageId: string;
  index: number;
  count: number;
  hasName: boolean;
  readOnly: boolean;
  onRename: () => void;
}

export function pageMenuItems(o: PageMenuOptions): MenuEntry[] {
  const a = useEditor.getState().actions;
  return [
    { id: "title", label: o.hasName ? "Edit page title" : "Add page title", icon: <IconPen aria-hidden="true" />, disabled: o.readOnly, onSelect: o.onRename },
    { id: "duplicate", label: "Duplicate page", icon: <IconDuplicate aria-hidden="true" />, disabled: o.readOnly, onSelect: () => a.duplicatePage(o.pageId) },
    {
      id: "present",
      label: "Present from this page",
      icon: <IconPlay aria-hidden="true" />,
      onSelect: () => {
        a.setActivePage(o.pageId);
        a.setPresenting(true);
      },
    },
    { type: "divider" },
    { id: "left", label: "Move left", icon: <IconArrowLeft aria-hidden="true" />, disabled: o.readOnly || o.index === 0, onSelect: () => a.movePage(o.pageId, o.index - 1) },
    {
      id: "right",
      label: "Move right",
      icon: <IconArrowRight aria-hidden="true" />,
      disabled: o.readOnly || o.index >= o.count - 1,
      onSelect: () => a.movePage(o.pageId, o.index + 1),
    },
    { type: "divider" },
    {
      id: "delete",
      label: "Delete page",
      icon: <IconTrash aria-hidden="true" />,
      danger: true,
      disabled: o.readOnly || o.count <= 1,
      onSelect: () => deletePageWithUndo(o.pageId),
    },
  ];
}

/* ------------------------------------------------------------------ */
/* caption with inline rename                                         */
/* ------------------------------------------------------------------ */

function RenameInput({ page, onDone }: { page: Page; onDone: () => void }) {
  const ref = useRef<HTMLInputElement>(null);
  const cancelled = useRef(false);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const finish = () => {
    if (!cancelled.current) {
      const value = ref.current?.value.trim() ?? "";
      if (value !== (page.name ?? "")) useEditor.getState().actions.setPageName(page.id, value);
    }
    onDone();
  };

  return (
    <input
      ref={ref}
      className="cf-pagecap__input"
      defaultValue={page.name ?? ""}
      placeholder="Page title"
      maxLength={60}
      aria-label="Page title"
      spellCheck={false}
      onBlur={finish}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export interface PageCaptionProps {
  page: Page;
  index: number;
  editing: boolean;
  onDone: () => void;
  /** show the page number before the title (grid view) */
  showNumber?: boolean;
}

export function PageCaption({ page, index, editing, onDone, showNumber = false }: PageCaptionProps) {
  if (editing) {
    return (
      <span className="cf-pagecap is-editing">
        {showNumber ? <span className="cf-pagecap__num">{index + 1}</span> : null}
        <RenameInput page={page} onDone={onDone} />
      </span>
    );
  }
  return (
    <span className="cf-pagecap" title={page.name}>
      {showNumber ? <span className="cf-pagecap__num">{index + 1}</span> : null}
      {page.name ? <span className="cf-pagecap__name">{page.name}</span> : null}
    </span>
  );
}
