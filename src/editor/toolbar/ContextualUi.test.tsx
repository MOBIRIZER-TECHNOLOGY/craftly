import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createImage, createPage, createShape, createText } from "@/core/factory";
import type { ImageElement, ShapeElement, TextElement } from "@/core/types";
import { live, mountEditorOn, store } from "@/test/ctxUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";

/* The toolbars and the panels they open, working together inside the whole editor (as in e2e/features.cjs). */

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout();
});
afterEach(() => restoreLayout());

const headline = () => createText({ text: "Headline", fontSize: 80, x: 100, y: 80 });
const square = () => createShape("rect", { x: 500, y: 300, width: 200, height: 200 });
const photo = () => createImage({ src: "https://example.test/p.jpg", x: 100, y: 300, width: 300, height: 200, naturalWidth: 600, naturalHeight: 400 });

async function open(...elements: Array<ReturnType<typeof headline> | ReturnType<typeof square> | ReturnType<typeof photo>>) {
  const design = createDesign({ title: "contextual", width: 1000, height: 600, pages: [createPage({ elements }), createPage()] });
  await mountEditorOn(design);
  return design.pages[0].elements;
}
const select = (...ids: string[]) => act(() => store().actions.select(ids));
const toolbar = (name = "Selected element common controls") => screen.getByRole("toolbar", { name });
const panel = (name: string) => screen.getByRole("region", { name });

describe("the toolbar and the panels beside the page", () => {
  it("follows the selection: page controls, then text, then shape, then image", async () => {
    const [text, shape, picture] = await open(headline(), square(), photo());
    expect(toolbar("Page controls")).toBeTruthy();
    select(text.id);
    expect(within(toolbar()).getByRole("button", { name: "Bold" })).toBeTruthy();
    select(shape.id);
    expect(within(toolbar()).getByRole("button", { name: "Fill color" })).toBeTruthy();
    expect(within(toolbar()).queryByRole("button", { name: "Bold" })).toBeNull();
    select(picture.id);
    expect(within(toolbar()).getByRole("button", { name: "Edit image" })).toBeTruthy();
    select();
    expect(toolbar("Page controls")).toBeTruthy();
  });

  it("adds a shadow to a text through the Effects button and the Effects panel", async () => {
    const user = userEvent.setup();
    const [text] = await open(headline());
    select(text.id);
    await user.click(within(toolbar()).getByRole("button", { name: "Effects" }));
    expect(panel("Effects")).toBeTruthy();
    await user.click(within(screen.getByRole("group", { name: "Text effect styles" })).getByRole("button", { name: "Shadow" }));
    expect(live<TextElement>(text).effect.kind).toBe("shadow");
    // the toolbar button shows that its panel is open; the panel's X closes it
    expect(within(toolbar()).getByRole("button", { name: "Effects" }).getAttribute("aria-pressed")).toBe("true");
    await user.click(within(panel("Effects")).getByRole("button", { name: "Close panel" }));
    expect(screen.queryByRole("region", { name: "Effects" })).toBeNull();
    expect(within(toolbar()).getByRole("button", { name: "Effects" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("picks a font and a text colour from the panels the text toolbar opens", async () => {
    const user = userEvent.setup();
    const [text] = await open(headline());
    select(text.id);
    await user.click(within(toolbar()).getByRole("button", { name: /Toggle font selector/ }));
    await user.click(await within(panel("Font")).findByRole("button", { name: "Lora" }));
    await waitFor(() => expect(live<TextElement>(text).fontFamily).toBe("Lora"));
    expect(within(toolbar()).getByRole("button", { name: "Toggle font selector, current font: Lora" })).toBeTruthy();

    await user.click(within(toolbar()).getByRole("button", { name: "Text color" }));
    expect(panel("Text color")).toBeTruthy();
    await user.click(within(panel("Text color")).getAllByRole("button", { name: "#7C3AED" })[0]);
    expect(live<TextElement>(text).color).toBe("#7c3aed");
  });

  it("filters a photo through Edit image", async () => {
    const user = userEvent.setup();
    const [, , picture] = await open(headline(), square(), photo());
    select(picture.id);
    await user.click(within(toolbar()).getByRole("button", { name: "Edit image" }));
    await user.click(within(screen.getByRole("group", { name: "Filter presets" })).getByRole("button", { name: "Vivid" }));
    expect(live<ImageElement>(picture).filter.preset).toBe("vivid");
    await user.click(within(panel("Filters")).getByRole("tab", { name: "Adjust" }));
    expect(panel("Adjust")).toBeTruthy();
  });

  it("changes the page background from the page controls", async () => {
    const user = userEvent.setup();
    await open(headline());
    await user.click(within(toolbar("Page controls")).getByRole("button", { name: "Background color" }));
    await user.click(within(panel("Background")).getByRole("button", { name: "Blush" }));
    expect(store().design!.pages[0].background).toEqual({ type: "solid", color: "#fde4e4" });
    await user.click(within(panel("Background")).getByRole("button", { name: "Apply to all pages" }));
    expect(store().design!.pages[1].background).toEqual({ type: "solid", color: "#fde4e4" });
  });

  it("arranges and renames layers from the Position panel", async () => {
    const user = userEvent.setup();
    const [text, shape] = await open(headline(), square());
    select(shape.id);
    await user.click(within(toolbar()).getByRole("button", { name: "Position" }));
    await user.click(within(panel("Position")).getByRole("button", { name: "To back" }));
    expect(store().design!.pages[0].elements[0].id).toBe(shape.id);
    await user.click(within(panel("Position")).getByRole("tab", { name: "Layers" }));
    await user.dblClick(within(panel("Position")).getByRole("button", { name: "Text: Headline" }));
    await user.keyboard("Title{Enter}");
    expect(live<TextElement>(text).name).toBe("Title");
    await user.click(within(panel("Position")).getByRole("button", { name: "Shape: Square" }));
    expect(store().selection).toEqual([shape.id]);
  });

  it("locks, duplicates and deletes with the small bar above the selection", async () => {
    const user = userEvent.setup();
    const [, shape] = await open(headline(), square());
    select(shape.id);
    const quick = () => screen.getByRole("toolbar", { name: "Selected element quick actions" });
    await user.click(within(quick()).getByRole("button", { name: "Lock" }));
    expect(live<ShapeElement>(shape).locked).toBe(true);
    // a locked selection is edited through the Unlock button of the main bar as well
    expect(screen.getByRole("toolbar", { name: "Locked element controls" })).toBeTruthy();
    await user.click(within(quick()).getByRole("button", { name: "Unlock" }));
    await user.click(within(quick()).getByRole("button", { name: "Duplicate" }));
    expect(store().design!.pages[0].elements).toHaveLength(3);
    await user.click(within(quick()).getByRole("button", { name: "Delete" }));
    expect(store().design!.pages[0].elements).toHaveLength(2);
  });
});
