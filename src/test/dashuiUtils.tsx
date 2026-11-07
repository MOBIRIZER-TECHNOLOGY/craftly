/**
 * Helpers for the UI-kit (`src/ui`), `src/components` and dashboard (`src/dashboard`) tests: the global hosts (toast /
 * confirm / context menu / prompt), a stand-in for the system file dialog, seeding the library and mounting the whole
 * app on a hash route. Layout stubs live in `dashuiLayout.ts`.
 */
import { act, configure, fireEvent, render, screen, waitFor, type RenderResult } from "@testing-library/react";
import { expect, vi } from "vitest";
import { createDesign, createPage, createText } from "@/core/factory";
import { saveDesign } from "@/core/library";
import { openDb } from "@/core/persistence";
import type { Design } from "@/core/types";
import { assetsStore, brandStore, designsStore, foldersStore } from "@/dashboard/data";
import { PromptHost } from "@/dashboard/prompt";
import { ConfirmHost, ContextMenuHost, ToastHost } from "@/ui";

export { rect, stubBox, stubOffsets, stubRects } from "./dashuiLayout";

// The machine running the suite may be busy (IndexedDB round trips, many workers): give findBy* and waitFor more room.
configure({ asyncUtilTimeout: 20_000 });

/**
 * Empty every IndexedDB store. The same as `clearLibrary()` in `helpers.tsx`, which is not used here because that file
 * imports the whole editor and the dashboard tests do not need it.
 */
export async function emptyLibrary(): Promise<void> {
  const db = await openDb();
  await Promise.all(
    Array.from(db.objectStoreNames).map(
      (name) =>
        new Promise<void>((resolve, reject) => {
          const request = db.transaction(name, "readwrite").objectStore(name).clear();
          request.onsuccess = () => resolve();
          request.onerror = () => reject(request.error);
        }),
    ),
  );
}

/** The app-wide hosts the dashboard relies on (the real `<App />` mounts the same ones). */
export function Hosts() {
  return (
    <>
      <ToastHost />
      <ConfirmHost />
      <ContextMenuHost />
      <PromptHost />
    </>
  );
}

/** A small image file. The harness decodes every image as 64 x 48. */
export function imageFile(name = "photo.png", type = "image/png"): File {
  return new File([new Uint8Array([137, 80, 78, 71, 1, 2, 3, 4])], name, { type });
}

/**
 * Stands in for the operating system's file dialog. `pickFiles()` creates a hidden `<input type=file>` and clicks it:
 * here that click answers at once with `files` (an empty list means "cancelled"). `answer` changes the reply for the
 * following dialogs. Also reports how many dialogs were opened and the accept / multiple attributes of the last one.
 */
export function stubFilePicker(files: File[] = []): {
  answer: (next: File[]) => void;
  opened: () => number;
  lastAccept: () => string;
  lastMultiple: () => boolean;
} {
  let current = files;
  let opened = 0;
  let accept = "";
  let multiple = false;
  vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
    if (this.type !== "file") return;
    opened += 1;
    accept = this.accept;
    multiple = this.multiple;
    if (current.length === 0) {
      this.dispatchEvent(new Event("cancel"));
      return;
    }
    Object.defineProperty(this, "files", { configurable: true, value: current });
    this.dispatchEvent(new Event("change", { bubbles: true }));
  });
  return { answer: (next) => void (current = next), opened: () => opened, lastAccept: () => accept, lastMultiple: () => multiple };
}

/** Save a design to the library (page 1 holds one text element). Pass `thumbnail` to give it a picture. */
export async function seedDesign(over: Partial<Design> & { thumbnail?: string } = {}): Promise<Design> {
  const { thumbnail, ...fields } = over;
  const base = createDesign({
    title: fields.title ?? "Seed design",
    typeId: fields.typeId ?? "instagram-post",
    width: fields.width ?? 1080,
    height: fields.height ?? 1350,
    pages: [createPage({ elements: [createText({ text: "Seed", x: 40, y: 40, width: 400 })] })],
  });
  const design: Design = { ...base, ...fields };
  await saveDesign(design, thumbnail);
  return design;
}

/**
 * Close whatever dialog is still open with Escape (a pending prompt resolves null, a pending confirm resolves false),
 * until none is left. The prompt and confirm queues live outside React, so a test that leaves one open would hold up
 * the dialogs of every test after it.
 */
export async function dismissOpenDialogs(): Promise<void> {
  for (let round = 0; round < 10 && screen.queryByRole("dialog"); round += 1) {
    fireEvent.keyDown(document.body, { key: "Escape" });
    await waitFor(() => expect(screen.queryAllByRole("dialog").filter((el) => !el.parentElement?.classList.contains("is-closing"))).toHaveLength(0), { timeout: 400 }).catch(
      () => undefined,
    );
  }
  await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull(), { timeout: 2000 });
}

/** Wait until the last dialog has finished its exit animation. */
export function dialogGone(): Promise<void> {
  return waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
}

/** Let promises, timers of 0 ms and React effects settle. */
export async function settle(): Promise<void> {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

/** Change the hash like a link click would and wait until the app has seen it. */
export async function goTo(hash: string): Promise<void> {
  await act(async () => {
    window.location.hash = hash;
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await waitFor(() => expect(window.location.hash).toBe(hash));
}

/** Mount the whole app (`<App />`) on a hash route. Its views are lazy: use `findBy*` afterwards. */
export async function mountApp(hash = "#/"): Promise<RenderResult> {
  window.location.hash = hash;
  const { App } = await import("@/App");
  return render(<App />);
}

/**
 * The dashboard keeps what it read from the library between screens ("instant paint, then a silent refresh"), so the
 * data of the previous test would show first. Call this after emptying the library to make the stores read it again
 * and wait until they have.
 */
export async function resetDashboardStores(): Promise<void> {
  const brandBefore = brandStore.getSnapshot();
  designsStore.reload();
  foldersStore.reload();
  assetsStore.reload();
  brandStore.reload();
  await waitFor(() => {
    expect(designsStore.getSnapshot()).toMatchObject({ ready: true, value: [] });
    expect(foldersStore.getSnapshot()).toMatchObject({ ready: true, value: [] });
    expect(assetsStore.getSnapshot()).toMatchObject({ ready: true, value: [] });
    // the brand kit is never an empty list, and it is `ready` from the first test on: only a new snapshot says the reload is over
    expect(brandStore.getSnapshot()).not.toBe(brandBefore);
    expect(brandStore.getSnapshot().ready).toBe(true);
  });
}
