/**
 * What the person was looking at in the editor, kept over a reload that the person did not ask to lose it in: changing the
 * language of the interface reloads the page (src/i18n/index.ts), and the design then opened again on page 1 with nothing
 * selected at the zoom of a fresh start (B12). The page, the selection and a zoom of the person's own are written to this
 * tab's session storage just before the reload and given back once, when the same design is opened again.
 */
import { useEditor } from "@/core/store";
import type { DesignElement } from "@/core/types";

const KEY = "craftly.keptView";

interface KeptView {
  designId: string;
  pageId: string;
  selection: string[];
  /** only a zoom the person chose; "fit" and "fill" are worked out again for the window */
  zoom: number | null;
}

/** Writes down the view of the open design, if one is open. */
export function keepView(): void {
  const s = useEditor.getState();
  if (!s.design) return;
  const view: KeptView = { designId: s.design.id, pageId: s.activePageId, selection: [...s.selection], zoom: s.zoomMode === "custom" ? s.zoom : null };
  try {
    sessionStorage.setItem(KEY, JSON.stringify(view));
  } catch {
    /* no session storage: the design opens on its first page, as before */
  }
}

/** Gives the view kept for `designId` back to the design that has just been opened, once. */
export function restoreKeptView(designId: string): void {
  let view: KeptView | null = null;
  try {
    const text = sessionStorage.getItem(KEY);
    if (text === null) return;
    sessionStorage.removeItem(KEY);
    view = JSON.parse(text) as KeptView;
  } catch {
    return;
  }
  const s = useEditor.getState();
  if (!view || view.designId !== designId || !s.design || s.design.id !== designId) return;
  const page = s.design.pages.find((p) => p.id === view.pageId);
  if (!page) return;
  if (page.id !== s.activePageId) s.actions.setActivePage(page.id);
  const present = new Set<string>();
  const collect = (elements: DesignElement[]) => {
    for (const e of elements) {
      present.add(e.id);
      if (e.type === "group") collect(e.children);
    }
  };
  collect(page.elements);
  const ids = Array.isArray(view.selection) ? view.selection.filter((id) => present.has(id)) : [];
  if (ids.length) s.actions.select(ids);
  if (typeof view.zoom === "number" && Number.isFinite(view.zoom)) s.actions.setZoom(view.zoom);
}
