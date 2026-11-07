/**
 * A programmatic file picker. The <input> lives in the overlay root (never made inert by modals) and is reused,
 * so a menu item or a button that unmounts right after it was clicked cannot lose the selection.
 */
import { getOverlayRoot } from "@/ui";

let input: HTMLInputElement | null = null;
let cancelPending: (() => void) | null = null;

export interface PickOptions {
  /** accept attribute, e.g. "image/*" or ".craftly,application/json" */
  accept?: string;
  multiple?: boolean;
}

/**
 * Opens the system file dialog. Must be called straight from a click / key handler (no `await` before it).
 * Resolves with the chosen files, or with an empty list when the dialog was cancelled.
 */
export function pickFiles(options: PickOptions = {}): Promise<File[]> {
  return new Promise<File[]>((resolve) => {
    cancelPending?.();
    if (!input) {
      input = document.createElement("input");
      input.type = "file";
      input.hidden = true;
      input.tabIndex = -1;
      input.setAttribute("aria-hidden", "true");
      getOverlayRoot().appendChild(input);
    }
    const element = input;
    element.accept = options.accept ?? "";
    element.multiple = options.multiple ?? false;
    element.value = "";

    const cleanup = () => {
      element.removeEventListener("change", onChange);
      element.removeEventListener("cancel", onCancel);
      if (cancelPending === onCancel) cancelPending = null;
    };
    const onChange = () => {
      const files = Array.from(element.files ?? []);
      cleanup();
      element.value = "";
      resolve(files);
    };
    const onCancel = () => {
      cleanup();
      resolve([]);
    };
    cancelPending = onCancel;
    element.addEventListener("change", onChange);
    element.addEventListener("cancel", onCancel);
    element.click();
  });
}
