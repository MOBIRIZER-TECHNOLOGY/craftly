/**
 * Whole-design actions shared by the File menu, the Share popover and the dialogs:
 * saving, copying, trashing, printing, copying a page as an image, saving a project file.
 * None of these are React components; they read the store imperatively and report with toasts.
 */
import { duplicateDesign, restoreFromTrash, saveDesign } from "@/core/library";
import { getActivePage, useEditor } from "@/core/store";
import { downloadBlob } from "@/export/exporters";
import { exportProjectFile } from "@/export/projectFile";
import { renderPageToCanvas } from "@/render/renderPage";
import { designPath, navigate } from "@/router";
import { confirm as askConfirm, toast } from "@/ui";

/** Asks the autosave service to persist the open design now (it also reacts to Ctrl+S). */
export function requestSave(): void {
  window.dispatchEvent(new CustomEvent("craftly:save-now"));
}

/** Resolves when the open design has been written to IndexedDB (or the save failed / took too long). */
export function waitForSaved(timeoutMs = 6000): Promise<"saved" | "error" | "timeout"> {
  return new Promise((resolve) => {
    let timer = 0;
    let unsubscribe: () => void = () => {};
    const done = (result: "saved" | "error" | "timeout") => {
      unsubscribe();
      window.clearTimeout(timer);
      resolve(result);
    };
    unsubscribe = useEditor.subscribe((s) => {
      if (s.saveState === "saved") done("saved");
      else if (s.saveState === "error") done("error");
    });
    timer = window.setTimeout(() => done("timeout"), timeoutMs);
    const now = useEditor.getState().saveState;
    if (now === "saved") done("saved");
    else if (now === "error") done("error");
  });
}

/** File > Save: flush now and tell the user how it went. */
export async function saveNow(): Promise<void> {
  requestSave();
  const result = await waitForSaved();
  if (result === "saved") toast.success("All changes saved");
  else if (result === "error") toast.error("Couldn't save - storage is full or blocked. Free some space or download your design.");
}

/** File > Create new design: the home page opens its "Create a design" dialog when it sees this flag. */
export function startNewDesign(): void {
  try {
    sessionStorage.setItem("craftly:open-create", "1");
  } catch {
    /* storage can be blocked; the user then lands on the home page and clicks Create */
  }
  navigate("/");
}

let copying = false;

/** File > Make a copy: stores the latest edits, duplicates the design and opens the copy. */
export async function makeCopy(): Promise<void> {
  const design = useEditor.getState().design;
  if (!design || copying) return;
  copying = true;
  requestSave();
  try {
    // the copy is made from what is stored, so write the in-memory design first
    await saveDesign(design);
    const copy = await duplicateDesign(design.id);
    if (!copy) throw new Error("missing");
    navigate(designPath(copy.id));
    toast.success("Copy created");
  } catch {
    toast.error("Couldn't make a copy. Check that your browser has free storage and try again.");
  } finally {
    copying = false;
  }
}

/** File > Move to trash: asks first, stores the trashed state, leaves the editor and offers an undo. */
export async function moveToTrash(): Promise<void> {
  const design = useEditor.getState().design;
  if (!design) return;
  const ok = await askConfirm({
    title: "Move to trash?",
    message: `"${design.title}" will move to the trash. You can restore it from there at any time.`,
    confirmLabel: "Move to trash",
    danger: true,
  });
  if (!ok) return;
  const id = design.id;
  useEditor.getState().actions.updateMeta({ trashedAt: Date.now() });
  const trashed = useEditor.getState().design;
  requestSave();
  try {
    if (trashed) await saveDesign(trashed);
  } catch {
    /* the autosave request above retries */
  }
  navigate("/");
  toast.success("Moved to trash", { actionLabel: "Undo", onAction: () => void restoreFromTrash(id) });
}

export function safeFileName(title: string, fallback = "design"): string {
  const cleaned = title
    // eslint-disable-next-line no-control-regex -- a file name has no control characters
    .replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || fallback;
}

/** Share > Save project file. */
export async function saveProjectFile(): Promise<void> {
  const design = useEditor.getState().design;
  if (!design) return;
  try {
    const blob = await exportProjectFile(design);
    downloadBlob(blob, `${safeFileName(design.title)}.craftly`);
    toast.success("Project file saved to your downloads");
  } catch {
    toast.error("Couldn't create the project file. Try again, or download the design as an image or PDF instead.");
  }
}

/** Share > Copy as image: puts the current page on the clipboard as a PNG. */
export async function copyPageAsImage(): Promise<void> {
  const state = useEditor.getState();
  const design = state.design;
  const page = getActivePage(state);
  if (!design || !page) return;
  const number = design.pages.indexOf(page) + 1;
  if (typeof ClipboardItem === "undefined" || !navigator.clipboard?.write) {
    toast.error("This browser can't copy images to the clipboard. Use Download instead.");
    return;
  }
  try {
    // handing the clipboard a promise keeps the click's permission while the page renders
    const blob = renderPageToCanvas(design, page, { width: Math.round(Math.min(2400, design.width)) }).then(
      (canvas) =>
        new Promise<Blob>((resolve, reject) => {
          canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/png");
        }),
    );
    await navigator.clipboard.write([new ClipboardItem({ "image/png": blob })]);
    toast.success(`Page ${number} copied as an image`);
  } catch {
    toast.error("Couldn't copy the image. Your browser may have blocked clipboard access - try Download instead.");
  }
}

const HTML_ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const escapeHtml = (text: string) => text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c] ?? c);

/** Prints a set of page images through a hidden iframe; resolves when the print dialog is done (or after a long timeout). */
function printImages(urls: string[], landscape: boolean, title: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.setAttribute("aria-hidden", "true");
    frame.tabIndex = -1;
    frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
    let timer = 0;
    const cleanup = () => {
      window.clearTimeout(timer);
      frame.remove();
      resolve();
    };
    frame.onload = async () => {
      const win = frame.contentWindow;
      if (!win) {
        cleanup();
        return;
      }
      try {
        await Promise.all(Array.from(frame.contentDocument?.images ?? []).map((img) => img.decode().catch(() => undefined)));
      } catch {
        /* printing still works with images that are not decoded yet */
      }
      win.addEventListener("afterprint", cleanup, { once: true });
      timer = window.setTimeout(cleanup, 120_000);
      win.focus();
      win.print();
    };
    const css = `@page{size:${landscape ? "landscape" : "portrait"};margin:0}html,body{margin:0;padding:0;background:#fff}img{display:block;width:100vw;height:100vh;object-fit:contain;break-after:page;page-break-after:always}img:last-child{break-after:auto;page-break-after:auto}`;
    frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(title)}</title><style>${css}</style></head><body>${urls.map((u) => `<img src="${u}" alt="">`).join("")}</body></html>`;
    document.body.appendChild(frame);
  });
}

let printing = false;

/** File > Print: renders every page and opens the browser's print dialog. */
export async function printDesign(): Promise<void> {
  const design = useEditor.getState().design;
  if (!design || printing) return;
  printing = true;
  const preparing = toast.info("Preparing pages for printing...", { duration: 0 });
  const urls: string[] = [];
  try {
    const width = Math.round(Math.min(2400, design.width * 2));
    for (const page of design.pages) {
      const canvas = await renderPageToCanvas(design, page, { width });
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("encode");
      urls.push(URL.createObjectURL(blob));
    }
    toast.dismiss(preparing);
    await printImages(urls, design.width >= design.height, design.title);
  } catch {
    toast.dismiss(preparing);
    toast.error("Couldn't prepare the pages for printing. Try downloading a PDF and printing that.");
  } finally {
    urls.forEach((u) => URL.revokeObjectURL(u));
    printing = false;
  }
}
