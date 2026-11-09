/**
 * Persists the open design to IndexedDB shortly after every change, keeps the
 * dashboard thumbnail fresh and records version-history snapshots.
 */
import { saveDesign, saveVersion } from "@/core/library";
import { recordProblem } from "@/core/problems";
import { useEditor } from "@/core/store";
import { renderPageToCanvas } from "@/render/renderPage";

const SAVE_DELAY = 700;
const THUMB_EVERY = 4000;
const VERSION_EVERY = 5 * 60 * 1000;

export function installAutosave(): () => void {
  let timer = 0;
  let lastThumbAt = 0;
  let lastVersionAt = Date.now();
  let lastVersionDoc: unknown = useEditor.getState().design;
  let saving = false;
  let queued = false;

  async function flush() {
    window.clearTimeout(timer);
    timer = 0;
    const s = useEditor.getState();
    const design = s.design;
    if (!design) return;
    if (saving) {
      queued = true;
      return;
    }
    saving = true;
    s.actions.setSaveState("saving");
    try {
      let thumb: string | undefined;
      const now = Date.now();
      if (now - lastThumbAt > THUMB_EVERY) {
        lastThumbAt = now;
        try {
          const canvas = await renderPageToCanvas(design, design.pages[0], { width: 420 });
          thumb = canvas.toDataURL("image/jpeg", 0.82);
        } catch {
          /* thumbnails are optional */
        }
      }
      await saveDesign(design, thumb);
      if (now - lastVersionAt > VERSION_EVERY && design !== lastVersionDoc) {
        lastVersionAt = now;
        lastVersionDoc = design;
        await saveVersion(design);
      }
      const cur = useEditor.getState();
      cur.actions.setSaveState(cur.design === design ? "saved" : "unsaved");
    } catch (error) {
      recordProblem("save", error); // the top bar says that saving failed; the problem is written down for the report
      useEditor.getState().actions.setSaveState("error");
    } finally {
      saving = false;
      if (queued) {
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
  return () => {
    unsub();
    window.removeEventListener("craftly:save-now", onSaveNow);
    window.removeEventListener("pagehide", onHide);
    document.removeEventListener("visibilitychange", onHide);
    window.clearTimeout(timer);
  };
}
