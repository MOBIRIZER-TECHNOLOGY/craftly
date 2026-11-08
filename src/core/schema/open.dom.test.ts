/**
 * The promise that matters: a design that an older release stored still opens in the editor and draws. Every frozen design of
 * every version (src/test/fixtures/schema/README.md) is brought up to date, opened in the store the editor uses, and every
 * page of it is painted. When the format changes, this is the test that fails for a migration that loses or breaks something.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderPageToCanvas } from "@/render/renderPage";
import { resetEditor } from "@/test/helpers";
import { stubDomMatrix } from "@/test/logicPaint";
import { useEditor } from "../store";
import type { Design } from "../types";
import { CURRENT_DESIGN_VERSION, migrateDesign } from "./design";

const files = import.meta.glob<Design>("../../test/fixtures/schema/design-v*.json", { eager: true, import: "default" });
const fixtures = Object.entries(files).map(([path, design]) => ({ name: path.slice(path.lastIndexOf("/") + 1), design }));

let restoreMatrix: () => void;
beforeEach(() => {
  restoreMatrix = stubDomMatrix(); // jsdom has no DOMMatrix, which pattern backgrounds are drawn with
});
afterEach(() => {
  restoreMatrix();
  resetEditor();
});

describe("a frozen design of every version", () => {
  it.each(fixtures)("$name opens in the editor and every page of it draws", async ({ design }) => {
    const { design: current } = migrateDesign(design);
    expect(current.version).toBe(CURRENT_DESIGN_VERSION);

    useEditor.getState().actions.openDesign(current);
    const open = useEditor.getState().design!;
    expect(open.title).toBe(design.title);
    expect(open.pages.map((page) => page.id)).toEqual(design.pages.map((page) => page.id));
    expect(useEditor.getState().activePageId).toBe(design.pages[0].id);

    for (const page of open.pages) {
      const canvas = await renderPageToCanvas(open, page, { width: 240 });
      expect(canvas.width).toBeGreaterThan(0);
    }
  });
});
