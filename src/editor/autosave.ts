/**
 * Persists the open design to IndexedDB shortly after every change, keeps the
 * dashboard thumbnail fresh and records version-history snapshots.
 */
import { saveDesign, saveThumbnail, saveVersion } from "@/core/library";
import { recordProblem } from "@/core/problems";
import { useEditor } from "@/core/store";
import { toast } from "@/ui";
import { renderPageToCanvas } from "@/render/renderPage";

const SAVE_DELAY = 700;
const THUMB_EVERY = 4000;
const VERSION_EVERY = 5 * 60 * 1000;

export function installAutosave(revision?: string | null): (() => void) & { flush: (reportFailure?: boolean) => Promise<void> } {
  const designId = useEditor.getState().design?.id;
  let active = true;
  let lastError = "";
  let timer = 0;
  let lastThumbAt = 0;
  let lastVersionAt = Date.now();
  let lastVersionDoc: unknown = useEditor.getState().design;
  let saving = false;
  let queued = false;

  async function flush(reportFailure = true) {
    window.clearTimeout(timer);
    timer = 0;
    const s = useEditor.getState();
    const design = s.design;
    if (!design || design.id !== designId || s.saveState === "saved") return;
    if (saving) {
      queued = true;
      return;
    }
    saving = true;
    s.actions.setSaveState("saving");
    try {
      const committed = await saveDesign(design, undefined, revision);
      if (revision !== undefined) revision = committed;
      lastError = "";
      const cur = useEditor.getState();
      if (active && cur.design?.id === designId) cur.actions.setSaveState(cur.design === design ? "saved" : "unsaved");
      const now = Date.now();
      if (now - lastThumbAt > THUMB_EVERY) {
        lastThumbAt = now;
        void renderPageToCanvas(design, design.pages[0], { width: 420 })
          .then((canvas) => saveThumbnail(design.id, committed, canvas.toDataURL("image/jpeg", 0.82)))
          .catch(() => undefined);
      }
      if (now - lastVersionAt > VERSION_EVERY && design !== lastVersionDoc) {
        lastVersionAt = now;
        lastVersionDoc = design;
        void saveVersion(design, undefined, committed).catch((error: unknown) => recordProblem("save", error));
      }
    } catch (error) {
      if (reportFailure) recordProblem("save", error);
      const cur = useEditor.getState();
      if (active && cur.design?.id === designId) {
        cur.actions.setSaveState("error");
        const message =
          error instanceof Error && error.name === "DesignSaveConflict" ? error.message : "Could not save your design. Try again or download a project file to keep your edits.";
        if (message !== lastError) {
          toast.error(message, {
            duration: 0,
            actionLabel: "Download copy",
            onAction: () =>
              void import("@/export/projectFile")
                .then(async ({ exportProjectFile, projectFileName }) => {
                  const { downloadBlob } = await import("@/export/download");
                  downloadBlob(await exportProjectFile(cur.design ?? design), projectFileName(design.title));
                })
                .catch(() => toast.error("Could not download the recovery copy.")),
          });
        }
        lastError = message;
      }
    } finally {
      saving = false;
      if (queued && active) {
        queued = false;
        void flush();
      }
    }
  }

  const schedule = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => void flush(), SAVE_DELAY);
  };

  const unsub = useEditor.subscribe((s, prev) => {
    if (s.design && s.design !== prev.design && s.saveState === "unsaved") schedule();
  });
  const onSaveNow = () => void flush();
  const onHide = () => {
    if (useEditor.getState().saveState === "unsaved") void flush();
  };
  window.addEventListener("craftly:save-now", onSaveNow);
  window.addEventListener("pagehide", onHide);
  document.addEventListener("visibilitychange", onHide);
  const onUnload = (event: BeforeUnloadEvent) => {
    if (useEditor.getState().saveState !== "saved") {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  window.addEventListener("beforeunload", onUnload);
  const uninstall = () => {
    active = false;
    window.removeEventListener("beforeunload", onUnload);
    unsub();
    window.removeEventListener("craftly:save-now", onSaveNow);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onHide);
    window.clearTimeout(timer);
  };
  return Object.assign(uninstall, { flush });
}
