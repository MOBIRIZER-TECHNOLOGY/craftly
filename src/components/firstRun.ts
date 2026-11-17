/**
 * What a person has already been shown on their first visit: the welcome panel of the dashboard (src/dashboard/WelcomePanel.tsx)
 * and the hint on an empty canvas (src/editor/canvas/EmptyCanvasHint.tsx). Nothing of it is ever a dialog, and each is put away
 * for good when it is dismissed or has done its job.
 *
 * Kept in localStorage, which is read at once: a returning person never sees a panel flash in and go. When the browser refuses
 * storage (a private window, blocked site data) the choice still holds for this visit, and is only not remembered.
 */
import { useSyncExternalStore } from "react";

export type FirstRunStep = "welcome" | "canvasHint";

const KEY_PREFIX = "craftly:first-run:";

/** The steps put away during this visit, whether or not the browser could keep them. */
const doneThisVisit = new Set<FirstRunStep>();
const listeners = new Set<() => void>();
let version = 0;

export const firstRunKey = (step: FirstRunStep) => KEY_PREFIX + step;

/** Whether `step` was dismissed or done, on this device or during this visit. */
export function isFirstRunDone(step: FirstRunStep): boolean {
  if (doneThisVisit.has(step)) return true;
  try {
    return localStorage.getItem(firstRunKey(step)) === "1";
  } catch {
    return false;
  }
}

/** Puts `step` away: now, and on this device from now on. */
export function markFirstRunDone(step: FirstRunStep): void {
  if (isFirstRunDone(step)) return;
  doneThisVisit.add(step);
  try {
    localStorage.setItem(firstRunKey(step), "1");
  } catch {
    /* not remembered on this device; it stays away for this visit */
  }
  version += 1;
  listeners.forEach((listener) => listener());
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  return () => listeners.delete(callback);
}

const getVersion = () => version;

/** Whether `step` is done, and renders again when it is put away. */
export function useFirstRunDone(step: FirstRunStep): boolean {
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return isFirstRunDone(step);
}

/** Back to a first visit. For tests: the module outlives a test otherwise. */
export function resetFirstRun(): void {
  doneThisVisit.clear();
  for (const step of ["welcome", "canvasHint"] as const) {
    try {
      localStorage.removeItem(firstRunKey(step));
    } catch {
      /* nothing kept */
    }
  }
  version += 1;
  listeners.forEach((listener) => listener());
}
