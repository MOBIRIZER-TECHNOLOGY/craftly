/** Which template (if any) the preview modal shows. A module store so every template card can open it. */
import { useSyncExternalStore } from "react";
import type { Template } from "@/core/types";

let current: Template | null = null;
const listeners = new Set<() => void>();

function set(next: Template | null): void {
  current = next;
  listeners.forEach((listener) => listener());
}

export const openTemplatePreview = (template: Template): void => set(template);
export const closeTemplatePreview = (): void => {
  if (current) set(null);
};

export function usePreviewTemplate(): Template | null {
  return useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => current,
    () => current,
  );
}

/** A search typed on Home that the Templates page should start with (consumed once). */
let presetQuery = "";
export const presetTemplateSearch = (query: string): void => {
  presetQuery = query;
};
export function takePresetTemplateSearch(): string {
  const value = presetQuery;
  presetQuery = "";
  return value;
}
