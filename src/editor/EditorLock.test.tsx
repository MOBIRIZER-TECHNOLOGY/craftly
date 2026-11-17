/**
 * The editor reads the design only once it holds the design's lock (src/cloud/locks.ts): a write of sync under way when the design
 * is opened ends first, and the editor opens what it wrote. Where the lock does not come, it opens the design after a moment.
 */
import { cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it } from "vitest";
import { designLock } from "@/cloud/locks";
import { createPage } from "@/core/factory";
import { getDesignForEditing, saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import { clearLibrary, resetEditor, sampleDesign, stubLayout } from "@/test/helpers";
import { Editor } from "./Editor";

/** Web Locks as a browser has them, within this page: one holder per name at a time, the others wait their turn. */
function fakeLocks() {
  const busy = new Set<string>();
  const queues = new Map<string, Promise<unknown>>();
  return {
    request(name: string, options: { ifAvailable?: boolean }, callback: (lock: unknown) => Promise<unknown>) {
      if (options.ifAvailable && busy.has(name)) return Promise.resolve(callback(null));
      const turn = (queues.get(name) ?? Promise.resolve()).then(async () => {
        busy.add(name);
        try {
          return await callback({ name });
        } finally {
          busy.delete(name);
        }
      });
      queues.set(
        name,
        turn.catch(() => undefined),
      );
      return turn;
    },
    query: async () => ({ held: [...busy].map((name) => ({ name })) }),
  };
}

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout();
  Object.defineProperty(navigator, "locks", { value: fakeLocks(), configurable: true });
});

afterEach(() => {
  cleanup();
  restoreLayout();
  resetEditor();
  delete (navigator as { locks?: unknown }).locks;
});

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

it("waits for a write of sync under way, and opens what it wrote", async () => {
  const design = sampleDesign();
  await saveDesign(design);
  // sync holds the design: it is writing the server's copy
  let done: () => void = () => undefined;
  const writing = new Promise<void>((resolve) => (done = resolve));
  const syncing = (navigator as unknown as { locks: ReturnType<typeof fakeLocks> }).locks.request(designLock(design.id), {}, () => writing);
  render(<Editor designId={design.id} />);
  await pause(300);
  expect(useEditor.getState().design).toBeNull();
  const open = await getDesignForEditing(design.id);
  await saveDesign({ ...open!.design, pages: [...open!.design.pages, createPage(), createPage()] }, undefined, open!.revision);
  done();
  await syncing;
  await waitFor(() => expect(useEditor.getState().design?.pages).toHaveLength(design.pages.length + 2), { timeout: 10_000 });
});

it("opens the design after a moment when the lock does not come", async () => {
  const design = sampleDesign();
  await saveDesign(design);
  const never = new Promise<void>(() => undefined);
  void (navigator as unknown as { locks: ReturnType<typeof fakeLocks> }).locks.request(designLock(design.id), {}, () => never);
  render(<Editor designId={design.id} />);
  await waitFor(() => expect(useEditor.getState().design?.id).toBe(design.id), { timeout: 10_000 });
});
