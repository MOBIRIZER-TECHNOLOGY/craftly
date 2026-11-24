/**
 * Bulk create in the editor: the sheet somebody imported (kept while the editor is open, never stored) and the step that makes
 * a page for every row of it. The maths is in `@/core/bulk`; here the pages are put into the design as one step of undo.
 */
import { create } from "zustand";
import { BULK_LIMITS, applyFill, bulkData, pageFills, recordValues, type BulkData, type BulkFill } from "@/core/bulk";
import { MAX_CELL_CHARS, oneLine, parseDelimited } from "@/core/delimited";
import { getActions, getActivePage, normalizeGeneratedDesign, useEditor } from "@/core/store";
import { m } from "@/i18n";
import type { ImportReport } from "../../context/dataImport";
import { clonePageWithIds, findElement, flatten } from "@/core/ops";
import { assetSrc, listAssets } from "@/core/assets";
import { createDesign } from "@/core/factory";
import { cloneDeep } from "@/core/clone";
import { saveDesign } from "@/core/library";
import type { Asset, Design } from "@/core/types";
import { nextMacrotask } from "@/export/yield";

const BULK_BATCH_SIZE = 50;

/** A page is named after the first column of its row, up to this many characters. */
const MAX_PAGE_NAME = 80;

interface BulkStore {
  data: BulkData | null;
  imageColumns: Record<string, string>;
  setData(data: BulkData | null): void;
  setImageColumn(id: string, field: string): void;
}

/** The imported sheet survives switching to another tab of the side panel and back. */
export const useBulkData = create<BulkStore>()((set) => ({
  data: null,
  imageColumns: {},
  setData: (data) => set({ data }),
  setImageColumn: (id, field) => set((state) => ({ imageColumns: { ...state.imageColumns, [id]: field } })),
}));

/** Reads pasted text or the text of a file as the sheet for bulk create, and says what was read and what was left out. */
export function readBulkData(text: string): ImportReport {
  const parsed = parseDelimited(text, BULK_LIMITS);
  const data = bulkData(parsed);
  if (!data) return { ok: false, clean: false, message: m.panelsTabs.bulk.needRows };
  useBulkData.getState().setData(data);
  const notes: string[] = [];
  if (parsed.cut.rows) notes.push(m.panelsTabs.bulk.onlyRows(BULK_LIMITS.rows - 1));
  if (parsed.cut.cols) notes.push(m.panelsTabs.bulk.onlyCols(BULK_LIMITS.cols));
  if (parsed.cut.cells) notes.push(m.panelsContext.dataImport.cellsShortened(parsed.cut.cells, MAX_CELL_CHARS));
  if (parsed.cut.input) notes.push(m.panelsContext.dataImport.tooLong);
  return { ok: true, clean: notes.length === 0, message: [m.panelsTabs.bulk.read(data.records.length, data.fields.length), ...notes].join(" ") };
}

/**
 * Makes a copy of the open page for every row of the sheet, after that page and in the order of the rows, with the names in
 * braces filled from the row. The open page stays as it is, so the same can be done again with other data. All of it is one step
 * of undo. Returns the number of pages made: 0 without a sheet, without a design, or in a design that is only looked at.
 */
export async function createBulkPages(): Promise<number> {
  const state = useEditor.getState();
  const data = useBulkData.getState().data;
  const template = getActivePage(state);
  if (!data || !template || !state.design || state.mode === "view") return 0;
  const actions = getActions();
  const at = state.design.pages.findIndex((p) => p.id === template.id);
  const imageColumns = useBulkData.getState().imageColumns;
  const templateImages = flatten(template.elements).filter((el) => el.type === "image");
  const assets = Object.keys(imageColumns).length ? await listAssets() : [];
  const made: string[] = [];
  actions.beginTransaction();
  try {
    for (const [i, record] of data.records.entries()) {
      const pageId = actions.addPage({ page: template, index: at + 1 + i });
      const page = useEditor.getState().design?.pages.find((p) => p.id === pageId);
      if (page) {
        // the copy is filled after it is on its page, so that a box which changes size keeps its place as it does when somebody
        // types into it: a centred name stays centred. A locked box is filled too: the page is new and nobody's work yet
        const fills = new Map<string, BulkFill>(pageFills(page, recordValues(data, record)).map((fill) => [fill.id, fill]));
        const locked = [...fills.values()].filter((fill) => fill.locked).map((fill) => fill.id);
        if (locked.length) actions.updateElementsOnPage(pageId, locked, { locked: false });
        if (fills.size) actions.updateElementsOnPage(pageId, [...fills.keys()], (el) => applyFill(el, fills.get(el.id) as BulkFill));
        if (locked.length) actions.updateElementsOnPage(pageId, locked, { locked: true });
        const copyImages = flatten(page.elements).filter((el) => el.type === "image");
        templateImages.forEach((original, index) => {
          const fieldKey = imageColumns[original.id];
          const copy = copyImages[index];
          if (!fieldKey || !copy) return;
          const field = data.fields.find((item) => item.key === fieldKey);
          const wanted = (record[field?.col ?? -1] ?? "")
            .trim()
            .replace(/\.[^.]+$/, "")
            .toLowerCase();
          const asset = assets.find((item) => item.name.toLowerCase() === wanted);
          actions.updateElementsOnPage(pageId, [copy.id], (el) => {
            if (el.type !== "image") return;
            el.src = asset ? assetSrc(asset.id) : null;
            el.naturalWidth = asset?.width ?? 1;
            el.naturalHeight = asset?.height ?? 1;
            el.crop = { x: 0, y: 0, w: 1, h: 1 };
          });
        });
        const name = oneLine(record[data.fields[0].col] ?? "").slice(0, MAX_PAGE_NAME);
        if (name) actions.setPageName(pageId, name);
        made.push(pageId);
      }
      if ((i + 1) % BULK_BATCH_SIZE === 0) await nextMacrotask();
    }
  } finally {
    actions.endTransaction();
  }
  if (made.length) actions.setActivePage(made[0]);
  return made.length;
}

function fillStandalonePage(
  page: Design["pages"][number],
  template: Design["pages"][number],
  data: BulkData,
  record: string[],
  imageColumns: Record<string, string>,
  assets: Asset[],
): void {
  const values = recordValues(data, record);
  for (const fill of pageFills(page, values)) {
    const el = findElement(page, fill.id);
    if (el) applyFill(el, fill);
  }
  const templateImages = flatten(template.elements).filter((el) => el.type === "image");
  const copies = flatten(page.elements).filter((el) => el.type === "image");
  templateImages.forEach((original, index) => {
    const fieldKey = imageColumns[original.id];
    const copy = copies[index];
    if (!fieldKey || !copy) return;
    const field = data.fields.find((item) => item.key === fieldKey);
    const wanted = (record[field?.col ?? -1] ?? "")
      .trim()
      .replace(/\.[^.]+$/, "")
      .toLowerCase();
    const asset = assets.find((item) => item.name.toLowerCase() === wanted);
    copy.src = asset ? assetSrc(asset.id) : null;
    copy.naturalWidth = asset?.width ?? 1;
    copy.naturalHeight = asset?.height ?? 1;
    copy.crop = { x: 0, y: 0, w: 1, h: 1 };
  });
}

/** Saves one independent, single-page design for every row, leaving the open design unchanged. */
export async function createBulkDesigns(): Promise<Design[]> {
  const state = useEditor.getState();
  const data = useBulkData.getState().data;
  const template = getActivePage(state);
  if (!data || !template || !state.design || state.mode === "view") return [];
  const source = state.design;
  const imageColumns = useBulkData.getState().imageColumns;
  const assets = Object.keys(imageColumns).length ? await listAssets() : [];
  const made: Design[] = [];
  for (const [index, record] of data.records.entries()) {
    const page = clonePageWithIds(template);
    const before = createDesign({ title: source.title, typeId: source.typeId, width: source.width, height: source.height, unit: source.unit, pages: [cloneDeep(page)] });
    fillStandalonePage(page, template, data, record, imageColumns, assets);
    const row = oneLine(record[data.fields[0].col] ?? "").slice(0, MAX_PAGE_NAME) || m.panelsTabs.bulk.row(index + 1);
    page.name = row;
    let design = createDesign({
      title: m.panelsTabs.bulk.designTitle(source.title, row),
      typeId: source.typeId,
      width: source.width,
      height: source.height,
      unit: source.unit,
      pages: [page],
    });
    design.folderId = source.folderId;
    design.guides = source.guides ? cloneDeep(source.guides) : undefined;
    design.margin = source.margin;
    design.gridSize = source.gridSize;
    design = normalizeGeneratedDesign(design, before);
    await saveDesign(design);
    made.push(design);
    if ((index + 1) % BULK_BATCH_SIZE === 0) await nextMacrotask();
  }
  return made;
}
