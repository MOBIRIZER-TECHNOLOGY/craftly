import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { addCustomFont, listCustomFonts } from "@/core/customFonts";
import { getBrandKit } from "@/core/library";
import { customFontCss, setCustomFaces } from "@/render/fonts";
import { Hosts, dismissOpenDialogs, emptyLibrary, resetDashboardStores } from "@/test/dashuiUtils";
import { fontFileOf, installFontFaces, removeFontFaces, sfntBytes } from "@/test/fontFixtures";
import { toast } from "@/ui";
import { BrandPage } from "./BrandPage";

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
  installFontFaces();
  setCustomFaces([]);
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => toast.clear());
  setCustomFaces([]);
  removeFontFaces();
  await emptyLibrary();
});

function mountBrand() {
  return render(
    <>
      <BrandPage />
      <Hosts />
    </>,
  );
}

const card = (title: string) => screen.getByRole("heading", { level: 2, name: title }).closest("section") as HTMLElement;
const acme = (weight = 400) => fontFileOf(`Acme-${weight}.ttf`, sfntBytes({ family: "Acme Sans", weight }));

describe("uploaded fonts on the Brand page", () => {
  it("has a card for them with the upload button and the reminder about the right to use a font", async () => {
    mountBrand();
    const fonts = await waitFor(() => card("Your fonts"));
    expect(within(fonts).getByText("Fonts you uploaded. Use them in every design, like the ones Craftly comes with.")).toBeTruthy();
    expect(within(fonts).getByRole("button", { name: "Upload a font" })).toBeTruthy();
    expect(within(fonts).getByText(/Upload only fonts you have the right to use\./)).toBeTruthy();
    // a font is managed here; there is no design to use it on
    expect(within(fonts).queryByRole("button", { name: /^Use / })).toBeNull();
  });

  it("stores an uploaded font and lists it", async () => {
    mountBrand();
    const fonts = await waitFor(() => card("Your fonts"));
    fireEvent.change(within(fonts).getByLabelText("Font files to upload"), { target: { files: [acme(), acme(700)] } });
    expect(await within(fonts).findByText("Regular, Bold · 2 files")).toBeTruthy();
    expect(await listCustomFonts()).toHaveLength(2);
  });

  it("offers an uploaded font as a brand font, first in the list, and shows it as one", async () => {
    const user = userEvent.setup();
    await addCustomFont(acme());
    mountBrand();
    await waitFor(() => card("Brand fonts"));
    await user.click(screen.getByRole("button", { name: "Add font" }));
    // the page reads the uploaded fonts from the library after it first shows, so the list may open before they are in
    const options = await waitFor(() => {
      const found = within(screen.getByRole("listbox", { name: "Fonts" })).getAllByRole("option");
      expect(found[0].textContent).toContain("Acme Sans");
      return found;
    });
    expect(options[0].textContent).toContain("Uploaded font");
    await user.click(options[0]);
    await waitFor(async () => expect((await getBrandKit()).fonts).toContain("Acme Sans"));
    const row = await waitFor(() => {
      const found = Array.from(card("Brand fonts").querySelectorAll(".cf-brand__font")).find((li) => li.textContent?.includes("Acme Sans"));
      expect(found).toBeTruthy();
      return found as HTMLElement;
    });
    expect(row.querySelector(".cf-brand__font-meta")?.textContent).toContain("Uploaded font");
    expect((row.querySelector(".cf-brand__font-name") as HTMLElement).style.fontFamily).toContain(customFontCss("Acme Sans"));
  });

  it("finds an uploaded font in the list of brand fonts by its name", async () => {
    const user = userEvent.setup();
    await addCustomFont(acme());
    mountBrand();
    await waitFor(() => card("Brand fonts"));
    await user.click(screen.getByRole("button", { name: "Add font" }));
    await user.type(screen.getByRole("searchbox", { name: "Search fonts" }), "acme uploaded");
    // (the uploaded fonts arrive from the library a moment after the page shows: wait for them rather than read the list once)
    await waitFor(() => {
      const options = within(screen.getByRole("listbox", { name: "Fonts" })).getAllByRole("option");
      expect(options.map((o) => o.textContent)).toEqual([expect.stringContaining("Acme Sans")]);
    });
  });
});
