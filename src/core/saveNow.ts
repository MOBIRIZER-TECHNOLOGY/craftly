/** Saving the open design on demand: ask the autosave to write it now, and wait until it has. */
import { useEditor } from "./store";

/** Asks the autosave service to persist the open design now (it also reacts to Ctrl+S). */
export function requestSave(): void {
  window.dispatchEvent(new CustomEvent("craftly:save-now"));
}

/** Resolves when the open design has been written to IndexedDB (or the save failed / took too long). */
export function waitForSaved(timeoutMs = 6000): Promise<"saved" | "error" | "timeout"> {
  return new Promise((resolve) => {
    let timer = 0;
    // the store never calls a listener while it is being added, so `unsubscribe` is set before `done` can run
    const done = (result: "saved" | "error" | "timeout") => {
      unsubscribe();
      window.clearTimeout(timer);
      resolve(result);
    };
    const unsubscribe = useEditor.subscribe((s) => {
      if (s.saveState === "saved") done("saved");
      else if (s.saveState === "error") done("error");
    });
    timer = window.setTimeout(() => done("timeout"), timeoutMs);
    const now = useEditor.getState().saveState;
    if (now === "saved") done("saved");
    else if (now === "error") done("error");
  });
}
