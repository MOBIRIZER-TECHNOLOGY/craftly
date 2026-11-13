import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addCustomFont, listCustomFonts } from "@/core/customFonts";
import { customFontCss, getFontDef, setCustomFaces } from "@/render/fonts";
import { brokenFont, fontFileOf, installFontFaces, removeFontFaces, sfntBytes, woffBytes } from "@/test/fontFixtures";
import { wipeDatabase } from "@/test/logicDb";
import { ConfirmHost, ToastHost, toast } from "@/ui";
import { CustomFonts } from "./CustomFonts";

beforeEach(async () => {
  await wipeDatabase();
  installFontFaces();
  setCustomFaces([]);
});

afterEach(async () => {
  act(() => toast.clear());
  setCustomFaces([]);
  removeFontFaces();
});

function mount(onUse?: (family: string) => void) {
  return render(
    <>
      <CustomFonts onUse={onUse} />
      <ToastHost />
      <ConfirmHost />
    </>,
  );
}

const input = () => screen.getByLabelText("Font files to upload") as HTMLInputElement;
const upload = (...files: File[]) => fireEvent.change(input(), { target: { files } });
const rows = () => Array.from(document.querySelectorAll(".cf-customfonts__row")).map((row) => row.querySelector(".cf-customfonts__name")?.textContent);
const toasts = () => Array.from(document.querySelectorAll(".cf-toast")).map((el) => el.textContent ?? "");
const acme = (over: Parameters<typeof sfntBytes>[0] = {}) => sfntBytes({ family: "Acme Sans", ...over });

describe("<CustomFonts>: the uploaded fonts of the brand kit", () => {
  it("starts empty, with an upload button and the reminder about the right to use a font", async () => {
    mount();
    expect(await screen.findByText("No uploaded fonts yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload a font" })).toBeTruthy();
    expect(screen.getByText(/Upload only fonts you have the right to use\./)).toBeTruthy();
    expect(input().accept).toBe(".ttf,.otf,.woff,.woff2");
    expect(input().multiple).toBe(true);
  });

  it("opens the file dialog from the button", async () => {
    const user = userEvent.setup();
    mount();
    const click = vi.spyOn(input(), "click").mockImplementation(() => undefined);
    await user.click(screen.getByRole("button", { name: "Upload a font" }));
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("adds an uploaded font to the list, written in itself, and says so", async () => {
    mount();
    upload(fontFileOf("AcmeSans-Bold.ttf", acme({ weight: 700 })));
    await waitFor(() => expect(rows()).toEqual(["Acme Sans"]));
    expect(screen.getByText("Bold · 1 file")).toBeTruthy();
    expect((document.querySelector(".cf-customfonts__name") as HTMLElement).style.fontFamily).toContain(customFontCss("Acme Sans"));
    await waitFor(() => expect(toasts().some((t) => t.includes("Acme Sans was added to your fonts"))).toBe(true));
    expect(input().value).toBe("");
  });

  it("shows the files of one family as one row with every style", async () => {
    mount();
    upload(
      fontFileOf("a.ttf", acme()),
      fontFileOf("b.ttf", acme({ weight: 700 })),
      fontFileOf("c.ttf", acme({ italic: true })),
      fontFileOf("v.ttf", sfntBytes({ family: "Flex", range: [200, 800] })),
    );
    await waitFor(() => expect(rows()).toEqual(["Acme Sans", "Flex"]));
    expect(screen.getByText("Regular, Bold, Regular italic · 3 files")).toBeTruthy();
    expect(screen.getByText("Every weight from 200 to 800 · 1 file")).toBeTruthy();
    await waitFor(() => expect(toasts().some((t) => t.includes("4 font files were added"))).toBe(true));
  });

  it("says that the name of a compressed font came from its file name", async () => {
    mount();
    upload(fontFileOf("House Font-Regular.woff2", woffBytes("woff2")));
    await waitFor(() => expect(rows()).toEqual(["House Font"]));
    await waitFor(() =>
      expect(toasts().some((t) => t.includes("House Font was added to your fonts. The name comes from the file name; rename it if it is not the font's name."))).toBe(true),
    );
  });

  it("refuses what is no font, in plain words with the name of the file, and keeps the fonts beside it", async () => {
    mount();
    upload(
      fontFileOf("virus.ttf", new TextEncoder().encode("<script>alert(1)</script>")),
      fontFileOf("ok.ttf", acme()),
      fontFileOf("bad.otf", brokenFont(sfntBytes({ flavor: "otf" }))),
    );
    await waitFor(() => expect(rows()).toEqual(["Acme Sans"]));
    await waitFor(() => {
      expect(toasts().some((t) => t.includes("virus.ttf: This is not a font file. Craftly takes .ttf, .otf, .woff and .woff2 files."))).toBe(true);
      expect(toasts().some((t) => t.includes("bad.otf: This file could not be read as a font. It may be damaged."))).toBe(true);
    });
    expect(await listCustomFonts()).toHaveLength(1);
  });

  it("says so when a font is fine but cannot be stored", async () => {
    const persistence = await import("@/core/persistence");
    vi.spyOn(persistence, "dbPut").mockRejectedValueOnce(new Error("disk full"));
    mount();
    upload(fontFileOf("ok.ttf", acme()));
    await waitFor(() => expect(toasts().some((t) => t.includes("ok.ttf could not be saved on this device."))).toBe(true));
  });

  it("lists the fonts that were uploaded before", async () => {
    await addCustomFont(fontFileOf("z.ttf", sfntBytes({ family: "Zed" })));
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    await waitFor(() => expect(rows()).toEqual(["Acme Sans", "Zed"]));
    expect(screen.queryByText("No uploaded fonts yet.")).toBeNull();
  });

  it("renames a family in place and warns that designs keep the old name", async () => {
    const user = userEvent.setup();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    await user.click(await screen.findByRole("button", { name: "Rename Acme Sans" }));
    const field = screen.getByRole("textbox", { name: "Family name" }) as HTMLInputElement;
    expect(field.value).toBe("Acme Sans");
    expect(screen.getByText(/Designs that already use Acme Sans keep that name/)).toBeTruthy();
    await user.clear(field);
    await user.type(field, "House{Enter}");
    await waitFor(() => expect(rows()).toEqual(["House"]));
    expect(getFontDef("House")).toBeDefined();
    expect(screen.queryByRole("textbox", { name: "Family name" })).toBeNull();
  });

  it("says which name a family got when the wanted one belongs to a bundled font", async () => {
    const user = userEvent.setup();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    await user.click(await screen.findByRole("button", { name: "Rename Acme Sans" }));
    const field = screen.getByRole("textbox", { name: "Family name" });
    await user.clear(field);
    await user.type(field, "Inter");
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(rows()).toEqual(["Inter (uploaded)"]));
    await waitFor(() => expect(toasts().some((t) => t.includes("Craftly already has a font called Inter, so yours is called Inter (uploaded)."))).toBe(true));
  });

  it("leaves the name alone when renaming is cancelled, with the button or with Escape", async () => {
    const user = userEvent.setup();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    await user.click(await screen.findByRole("button", { name: "Rename Acme Sans" }));
    await user.type(screen.getByRole("textbox", { name: "Family name" }), "xx");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(rows()).toEqual(["Acme Sans"]);
    await user.click(screen.getByRole("button", { name: "Rename Acme Sans" }));
    await user.type(screen.getByRole("textbox", { name: "Family name" }), "yy{Escape}");
    expect(screen.queryByRole("textbox", { name: "Family name" })).toBeNull();
    expect((await listCustomFonts())[0].family).toBe("Acme Sans");
  });

  it("asks before it deletes a family, and says what happens to the designs", async () => {
    const user = userEvent.setup();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    await addCustomFont(fontFileOf("b.ttf", acme({ weight: 700 })));
    mount();
    await user.click(await screen.findByRole("button", { name: "Delete Acme Sans" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Delete Acme Sans?")).toBeTruthy();
    expect(within(dialog).getByText(/Text that uses it, in any design, is then shown in a substitute font/)).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    expect(await listCustomFonts()).toHaveLength(2);

    await user.click(screen.getByRole("button", { name: "Delete Acme Sans" }));
    const again = await screen.findByRole("dialog");
    await user.click(within(again).getByRole("button", { name: "Delete font" }));
    await waitFor(() => expect(rows()).toEqual([]));
    expect(await listCustomFonts()).toEqual([]);
    expect(await screen.findByText("No uploaded fonts yet.")).toBeTruthy();
  });

  it("says so when a family cannot be renamed or deleted, and keeps it", async () => {
    const user = userEvent.setup();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    const persistence = await import("@/core/persistence");
    vi.spyOn(persistence, "dbPut").mockRejectedValueOnce(new Error("closed"));
    await user.click(await screen.findByRole("button", { name: "Rename Acme Sans" }));
    await user.type(screen.getByRole("textbox", { name: "Family name" }), " Two{Enter}");
    await waitFor(() => expect(toasts().some((t) => t.includes("Acme Sans could not be renamed."))).toBe(true));

    vi.spyOn(persistence, "dbDelete").mockRejectedValueOnce(new Error("closed"));
    await user.click(screen.getByRole("button", { name: "Delete Acme Sans" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Delete font" }));
    await waitFor(() => expect(toasts().some((t) => t.includes("Acme Sans could not be deleted."))).toBe(true));
    expect(rows()).toEqual(["Acme Sans"]);
  });

  it("does nothing when a family is given the name it has, or none", async () => {
    const user = userEvent.setup();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    for (const typed of ["{Enter}", "{Control>}a{/Control}{Backspace}   {Enter}"]) {
      await user.click(await screen.findByRole("button", { name: "Rename Acme Sans" }));
      await user.type(screen.getByRole("textbox", { name: "Family name" }), typed);
      await waitFor(() => expect(screen.queryByRole("textbox", { name: "Family name" })).toBeNull());
    }
    expect((await listCustomFonts())[0].family).toBe("Acme Sans");
    expect(toasts()).toEqual([]);
  });

  it("shows an empty list when the library cannot be read", async () => {
    const persistence = await import("@/core/persistence");
    vi.spyOn(persistence, "dbGetAllKeys").mockRejectedValue(new Error("closed"));
    mount();
    expect(await screen.findByText("No uploaded fonts yet.")).toBeTruthy();
  });

  it("offers to use a font where the host can", async () => {
    const user = userEvent.setup();
    const onUse = vi.fn();
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount(onUse);
    await user.click(await screen.findByRole("button", { name: "Use Acme Sans" }));
    expect(onUse).toHaveBeenCalledWith("Acme Sans");
  });

  it("has no such button where the host cannot", async () => {
    await addCustomFont(fontFileOf("a.ttf", acme()));
    mount();
    await waitFor(() => expect(rows()).toEqual(["Acme Sans"]));
    expect(screen.queryByRole("button", { name: "Use Acme Sans" })).toBeNull();
  });
});
