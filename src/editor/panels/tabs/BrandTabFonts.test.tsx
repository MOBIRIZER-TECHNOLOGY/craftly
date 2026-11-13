import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCustomFont, listCustomFonts } from "@/core/customFonts";
import { createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { TextElement } from "@/core/types";
import { customFontCss, setCustomFaces } from "@/render/fonts";
import { fontFileOf, installFontFaces, removeFontFaces, sfntBytes } from "@/test/fontFixtures";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { emptyDesign, lastElement, mountPanels, pageElements } from "@/test/tabsHarness";

let restoreLayout: () => void;
beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  installFontFaces();
  setCustomFaces([]);
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => {
  restoreLayout();
  setCustomFaces([]);
  removeFontFaces();
});

const section = (title: RegExp | string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const acme = (weight = 400) => fontFileOf(`Acme-${weight}.ttf`, sfntBytes({ family: "Acme Sans", weight }));

async function openBrand() {
  const user = userEvent.setup();
  mountPanels({ tab: "brand", design: emptyDesign() });
  await screen.findByRole("heading", { name: /^Brand colours/ });
  return user;
}

describe("uploaded fonts in the Brand tab", () => {
  it("has a section for them with the upload button and the reminder about the right to use a font", async () => {
    await openBrand();
    const fonts = section("Your fonts");
    expect(within(fonts).getByRole("button", { name: "Upload a font" })).toBeTruthy();
    expect(within(fonts).getByText(/Upload only fonts you have the right to use\./)).toBeTruthy();
    expect(await within(fonts).findByText("No uploaded fonts yet.")).toBeTruthy();
  });

  it("takes an upload and gives the font to the selected text with one click", async () => {
    const user = await openBrand();
    const id = useEditor.getState().actions.addElement(createText({ text: "Hello", fontFamily: "Inter" }));
    useEditor.getState().actions.select([id]);
    fireEvent.change(within(section("Your fonts")).getByLabelText("Font files to upload"), { target: { files: [acme()] } });
    await user.click(await within(section("Your fonts")).findByRole("button", { name: "Use Acme Sans" }));
    await waitFor(() => expect((pageElements().find((el) => el.id === id) as TextElement).fontFamily).toBe("Acme Sans"));
    expect(await listCustomFonts()).toHaveLength(1);
  });

  it("adds a heading in the font when nothing is selected, bold when the family has a bold file", async () => {
    await addCustomFont(acme(400));
    await addCustomFont(acme(700));
    const user = await openBrand();
    await user.click(await within(section("Your fonts")).findByRole("button", { name: "Use Acme Sans" }));
    await waitFor(() => expect((lastElement() as TextElement | undefined)?.fontFamily).toBe("Acme Sans"));
    expect((lastElement() as TextElement).fontWeight).toBe(700);
  });
});

describe("uploaded fonts in the Text tab", () => {
  it("are found by the search, before the bundled ones, as uploaded fonts", async () => {
    await addCustomFont(acme());
    const user = userEvent.setup();
    mountPanels({ tab: "text" });
    await user.type(await screen.findByRole("searchbox", { name: "Search fonts and combinations" }), "acme");
    const row = await screen.findByRole("button", { name: "Add text in Acme Sans" });
    expect(within(row).getByText("Uploaded font")).toBeTruthy();
    expect((row.querySelector(".cf-fontrow__sample") as HTMLElement).style.fontFamily).toContain(customFontCss("Acme Sans"));
    await user.click(row);
    await waitFor(() => expect((lastElement() as TextElement | undefined)?.fontFamily).toBe("Acme Sans"));
    // the family has no bold file: the heading takes the weight it has
    expect((lastElement() as TextElement).fontWeight).toBe(400);
  });
});
