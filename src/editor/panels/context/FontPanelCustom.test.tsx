import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCustomFont, deleteCustomFamily } from "@/core/customFonts";
import { createText } from "@/core/factory";
import type { TextElement } from "@/core/types";
import { customFontCss, setCustomFaces } from "@/render/fonts";
import { live, openElements, showPanel } from "@/test/ctxUtils";
import { fontFileOf, installFontFaces, removeFontFaces, sfntBytes, type FontFaces } from "@/test/fontFixtures";
import { clearLibrary, flush, resetEditor } from "@/test/helpers";

let faces: FontFaces;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  faces = installFontFaces();
  setCustomFaces([]);
});
afterEach(() => {
  setCustomFaces([]);
  removeFontFaces();
});

const text = (fontFamily: string) => createText({ text: "Font me", fontFamily, x: 50, y: 50 });
const upload = (family: string, weight = 400) => addCustomFont(fontFileOf(`${family}-${weight}.ttf`, sfntBytes({ family, weight })));
const openFont = async () => {
  const view = showPanel({ kind: "font" });
  await flush();
  return view;
};
const headings = () => screen.getAllByRole("heading", { level: 3 }).map((h) => h.querySelector(".cf-ctx__h-text")?.textContent);
const section = (title: string) => screen.getByRole("heading", { name: new RegExp(`^${title}`) }).parentElement as HTMLElement;
const rowsIn = (title: string) =>
  within(section(title))
    .getAllByRole("button")
    .filter((b) => b.classList.contains("cf-font__row"))
    .map((b) => b.getAttribute("aria-label"));

describe("uploaded fonts in the Font panel", () => {
  it("lists them in a group of their own above every other, written in themselves", async () => {
    await upload("Zed");
    await upload("Acme Sans");
    const t = text("Inter");
    openElements([t], { selected: [t] });
    await openFont();
    await waitFor(() => expect(headings()[0]).toBe("Your fonts"));
    expect(rowsIn("Your fonts")).toEqual(["Acme Sans", "Zed"]);
    const sample = within(section("Your fonts")).getByRole("button", { name: "Acme Sans" }).querySelector(".cf-font__name") as HTMLElement;
    expect(sample.style.fontFamily).toContain(customFontCss("Acme Sans"));
  });

  it("has no such group while nothing was uploaded", async () => {
    const t = text("Inter");
    openElements([t], { selected: [t] });
    await openFont();
    expect(headings()).not.toContain("Your fonts");
  });

  it("gives the text an uploaded font, with its face loaded first", async () => {
    const user = userEvent.setup();
    await upload("Acme Sans");
    const t = text("Inter");
    openElements([t], { selected: [t] });
    await openFont();
    await user.click(await screen.findByRole("button", { name: "Acme Sans" }));
    await waitFor(() => expect(live<TextElement>(t).fontFamily).toBe("Acme Sans"));
    expect([...faces.registered].map((f) => f.family)).toContain(customFontCss("Acme Sans"));
    // it is the font the text has now, here and among the fonts of the document
    await waitFor(() => expect(within(section("Your fonts")).getByRole("button", { name: "Acme Sans" }).getAttribute("aria-current")).toBe("true"));
    expect(rowsIn("Document fonts")).toEqual(["Acme Sans"]);
  });

  it("finds them by name when searching, and hides the group when none of them matches", async () => {
    const user = userEvent.setup();
    await upload("Acme Sans");
    await upload("Zed");
    const t = text("Inter");
    openElements([t], { selected: [t] });
    await openFont();
    await screen.findByRole("heading", { name: /^Your fonts/ });
    await user.type(screen.getByRole("searchbox", { name: "Search fonts" }), "acme");
    await waitFor(() => expect(rowsIn("Your fonts")).toEqual(["Acme Sans"]));
    await user.clear(screen.getByRole("searchbox", { name: "Search fonts" }));
    await user.type(screen.getByRole("searchbox", { name: "Search fonts" }), "lora");
    await waitFor(() => expect(headings()).not.toContain("Your fonts"));
    expect(headings()).toContain("Serif");
  });

  it("keeps them out of the way while one category is chosen", async () => {
    const user = userEvent.setup();
    await upload("Acme Sans");
    const t = text("Inter");
    openElements([t], { selected: [t] });
    await openFont();
    await screen.findByRole("heading", { name: /^Your fonts/ });
    await user.click(screen.getByRole("button", { name: "Serif" }));
    expect(headings()).toEqual(["Serif"]);
  });

  it("follows an upload and a deletion while it is open", async () => {
    const t = text("Inter");
    openElements([t], { selected: [t] });
    await openFont();
    expect(headings()).not.toContain("Your fonts");
    await upload("Acme Sans");
    await waitFor(() => expect(headings()[0]).toBe("Your fonts"));
    await deleteCustomFamily("Acme Sans");
    await waitFor(() => expect(headings()).not.toContain("Your fonts"));
  });
});

describe("a font the design names that is not on this device", () => {
  it("is listed among the fonts of the document under its own name, marked as not on this device", async () => {
    const [a, b] = [text("Ghost Grotesk"), text("Lora")];
    openElements([a, b], { selected: [a] });
    await openFont();
    const row = await screen.findByRole("button", { name: "Ghost Grotesk, not on this device" });
    expect(within(row).getByText("Not on this device")).toBeTruthy();
    expect(row.getAttribute("aria-current")).toBe("true");
    expect(within(section("Document fonts")).getByRole("button", { name: "Lora" })).toBeTruthy();
    // looking at it changed nothing in the design
    expect(live<TextElement>(a).fontFamily).toBe("Ghost Grotesk");
  });

  it("loses the mark as soon as the font is uploaded", async () => {
    const a = text("Ghost Grotesk");
    openElements([a], { selected: [a] });
    await openFont();
    await screen.findByRole("button", { name: "Ghost Grotesk, not on this device" });
    await upload("Ghost Grotesk");
    await waitFor(() => expect(screen.queryByText("Not on this device")).toBeNull());
    expect(rowsIn("Document fonts")).toEqual(["Ghost Grotesk"]);
  });

  it("is what a deleted font becomes: the name stays in the design and in the list", async () => {
    await upload("Acme Sans");
    const a = text("Acme Sans");
    openElements([a], { selected: [a] });
    await openFont();
    await waitFor(() => expect(rowsIn("Document fonts")).toEqual(["Acme Sans"]));
    await deleteCustomFamily("Acme Sans");
    expect(await screen.findByRole("button", { name: "Acme Sans, not on this device" })).toBeTruthy();
    expect(live<TextElement>(a).fontFamily).toBe("Acme Sans");
  });
});

describe("the weights of an uploaded family", () => {
  it("lists a weight that has no common name by its number alone", async () => {
    // a file states its weight on the scale of 100 to 900, but the faces registered here are not limited to the named steps
    const face = (id: string, weight: number) => ({
      id,
      family: "Odd Grotesk",
      minWeight: weight,
      maxWeight: weight,
      italic: false,
      format: "ttf" as const,
      data: new ArrayBuffer(8),
    });
    setCustomFaces([face("f_1", 350), face("f_2", 400), face("f_3", 700)]);
    const a = createText({ text: "Font me", fontFamily: "Odd Grotesk", fontWeight: 350, x: 50, y: 50 });
    openElements([a], { selected: [a] });
    await openFont();
    const weight = await screen.findByRole("combobox", { name: "Weight" });
    expect(weight.textContent).toContain("350");
    expect(weight.textContent).not.toContain("(350)");
    const user = userEvent.setup();
    await user.click(weight);
    expect(screen.getAllByRole("option").map((o) => o.textContent)).toEqual(["350", "Regular (400)", "Bold (700)"]);
  });
});
