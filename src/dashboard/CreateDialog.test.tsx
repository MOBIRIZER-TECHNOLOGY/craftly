import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as assets from "@/core/assets";
import { createFolder, getDesign, listDesigns } from "@/core/library";
import { DESIGN_CATEGORY_LABELS, DESIGN_TYPES, POPULAR_DESIGN_TYPES } from "@/data/designTypes";
import { Hosts, dismissOpenDialogs, emptyLibrary, imageFile, resetDashboardStores, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { CreateDialog } from "./CreateDialog";
import { closeCreateDialog, openCreateDialog, useCreateDialog, type CreateTab } from "./createDialogState";

function mountDialog(options: { tab?: CreateTab; query?: string; folderId?: string | null } = {}) {
  const view = render(
    <>
      <CreateDialog />
      <Hosts />
    </>,
  );
  act(() => openCreateDialog(options));
  return view;
}

const dialog = () => screen.getByRole("dialog", { name: "Create a design" });
const tabs = () => within(dialog()).getAllByRole("tab");
const tab = (name: string) => within(dialog()).getByRole("tab", { name });
const selectedTab = () => tabs().find((el) => el.getAttribute("aria-selected") === "true")?.textContent;
const panel = () => within(dialog()).getByRole("tabpanel");
const search = () => within(dialog()).getByRole("searchbox", { name: "Search design types" }) as HTMLInputElement;
const tileLabels = () =>
  within(panel())
    .queryAllByRole("button", { name: /, / })
    .map((el) => el.getAttribute("aria-label"));
const hint = () => panel().querySelector(".cf-custom__hint, .cf-custom__error")?.textContent;
const field = (name: "Width" | "Height") => within(panel()).getByRole("spinbutton", { name }) as HTMLInputElement;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function setNumber(user: ReturnType<typeof userEvent.setup>, name: "Width" | "Height", value: string) {
  await user.clear(field(name));
  await user.type(field(name), `${value}{Enter}`);
}

async function chooseUnit(user: ReturnType<typeof userEvent.setup>, unit: string) {
  await user.click(within(panel()).getByRole("combobox", { name: "Units" }));
  await user.click(screen.getByRole("option", { name: unit }));
}

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeCreateDialog();
    toast.clear();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<CreateDialog>", () => {
  it("is closed until it is opened", () => {
    render(<CreateDialog />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("opens with the cursor in the search and a list of categories on the side", () => {
    mountDialog();
    expect(dialog()).toBeTruthy();
    expect(search().placeholder).toBe("What would you like to create?");
    expect(document.activeElement).toBe(search());
    expect(within(dialog()).getByRole("tablist", { name: "Design categories" }).getAttribute("aria-orientation")).toBe("vertical");
    expect(tabs().map((el) => el.textContent)).toEqual([
      "For you",
      ...(["presentation", "social", "print", "document", "branding", "marketing"] as const).map((id) => DESIGN_CATEGORY_LABELS[id]),
      "Custom size",
      "Upload",
    ]);
    expect(selectedTab()).toBe("For you");
  });

  it("opens on the tab it is asked to, with the search it is given", () => {
    mountDialog({ tab: "print" });
    expect(selectedTab()).toBe("Printables");
    act(() => closeCreateDialog());
  });

  describe("For you and the categories", () => {
    it("shows the popular design types first", () => {
      mountDialog();
      expect(within(panel()).getByRole("heading", { level: 3, name: "Popular on Craftly" })).toBeTruthy();
      expect(tileLabels()).toHaveLength(POPULAR_DESIGN_TYPES.length);
    });

    it("lists the types of a category when its tab is chosen", async () => {
      const user = userEvent.setup();
      mountDialog();
      await user.click(tab("Social media"));
      expect(selectedTab()).toBe("Social media");
      expect(panel().getAttribute("aria-label")).toBe("Social media");
      expect(within(panel()).getByRole("heading", { level: 3, name: "Social media" })).toBeTruthy();
      expect(tileLabels()).toHaveLength(DESIGN_TYPES.filter((type) => type.category === "social").length);
      expect(tileLabels()).toContain("Instagram Story, 1080 × 1920 px");
    });

    it("creates a blank design of the type pressed and closes", async () => {
      const user = userEvent.setup();
      const state = renderHook(() => useCreateDialog());
      mountDialog();
      await user.click(tab("Printables"));
      await user.click(within(panel()).getByRole("button", { name: /^Business Card,/ }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved.typeId).toBe("business-card");
      expect(window.location.hash).toBe(`#/design/${saved.id}`);
      expect(state.result.current.open).toBe(false);
    });

    it("files the new design in the folder the dialog was opened for, and says so", async () => {
      const user = userEvent.setup();
      const folder = await createFolder("Campaign");
      mountDialog({ folderId: folder.id });
      expect(await within(dialog()).findByText("New designs are saved in “Campaign”.")).toBeTruthy();
      await user.click(within(panel()).getByRole("button", { name: /^Logo,/ }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0].folderId).toBe(folder.id);
    });

    it("moves between the tabs with the arrow keys, Home and End, wrapping around", async () => {
      const user = userEvent.setup();
      mountDialog();
      // focus follows the selection one frame after a key press: wait for it before pressing the next key
      const press = async (key: string, expected: string) => {
        await user.keyboard(key);
        expect(selectedTab()).toBe(expected);
        await waitFor(() => expect(document.activeElement).toBe(tab(expected)));
      };
      tab("For you").focus();
      await press("{ArrowDown}", "Presentations");
      await press("{ArrowRight}", "Social media");
      await press("{ArrowUp}", "Presentations");
      await press("{ArrowLeft}", "For you");
      await press("{ArrowLeft}", "Upload");
      await press("{ArrowDown}", "For you");
      await press("{End}", "Upload");
      await press("{Home}", "For you");
    });

    it("clears the search when the keyboard moves to another tab", async () => {
      const user = userEvent.setup();
      mountDialog({ query: "poster" });
      tab("For you").focus();
      await user.keyboard("{ArrowDown}");
      expect(search().value).toBe("");
      expect(selectedTab()).toBe("Presentations");
    });

    it("ignores other keys on the tab list", () => {
      mountDialog();
      tab("For you").focus();
      expect(fireEvent.keyDown(tab("For you"), { key: "a" })).toBe(true);
      expect(selectedTab()).toBe("For you");
    });

    it("keeps only the selected tab in the tab order", () => {
      mountDialog({ tab: "document" });
      expect(tab("Docs").tabIndex).toBe(0);
      expect(tab("For you").tabIndex).toBe(-1);
    });
  });

  describe("search", () => {
    it("shows the design types that match what is typed, and deselects every tab", async () => {
      const user = userEvent.setup();
      mountDialog();
      await user.type(search(), "insta");
      expect(within(panel()).getByRole("heading", { level: 3, name: "Results for “insta”" })).toBeTruthy();
      expect(panel().getAttribute("aria-label")).toBe("Search results");
      expect(tileLabels().length).toBeGreaterThan(0);
      expect(tileLabels().every((label) => /insta/i.test(label ?? ""))).toBe(true);
      expect(selectedTab()).toBeUndefined();
    });

    it("also looks at the category and the size", async () => {
      const user = userEvent.setup();
      mountDialog();
      await user.type(search(), "1080 × 1920");
      expect(tileLabels()).toContain("Instagram Story, 1080 × 1920 px");
    });

    it("creates a blank design of a type pressed among the results", async () => {
      const user = userEvent.setup();
      const folder = await createFolder("Stories");
      mountDialog({ folderId: folder.id });
      await user.type(search(), "story");
      await user.click(within(panel()).getByRole("button", { name: "Instagram Story, 1080 × 1920 px" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0]).toMatchObject({ typeId: "instagram-story", folderId: folder.id });
    });

    it("offers a custom size for a size typed as width x height, and creates it", async () => {
      const user = userEvent.setup();
      mountDialog();
      await user.type(search(), "1200x628");
      const tile = within(panel()).getByRole("button", { name: "Custom size, 1200 × 628 px" });
      await user.click(tile);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved).toMatchObject({ typeId: "custom", width: 1200, height: 628 });
      expect((await getDesign(saved.id))?.unit).toBe("px");
    });

    it("keeps a typed size inside 40 to 8000 pixels", async () => {
      const user = userEvent.setup();
      mountDialog();
      await user.type(search(), "9000x30");
      await user.click(within(panel()).getByRole("button", { name: "Custom size, 9000 × 30 px" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0]).toMatchObject({ width: 8000, height: 40 });
    });

    it("starts from the search the dialog was opened with", () => {
      mountDialog({ query: "poster" });
      expect(search().value).toBe("poster");
      expect(within(panel()).getByRole("heading", { level: 3, name: "Results for “poster”" })).toBeTruthy();
    });

    it("says nothing matches and leads to the custom size tab", async () => {
      const user = userEvent.setup();
      mountDialog();
      await user.type(search(), "zzzqqq");
      expect(within(panel()).getByText("No design types match “zzzqqq”")).toBeTruthy();
      await user.click(within(panel()).getByRole("button", { name: "Create a custom size" }));
      expect(selectedTab()).toBe("Custom size");
      expect(search().value).toBe("");
    });

    it("goes back to the tabs when a tab is pressed", async () => {
      const user = userEvent.setup();
      mountDialog({ query: "poster" });
      await user.click(tab("Docs"));
      expect(search().value).toBe("");
      expect(selectedTab()).toBe("Docs");
    });

    it("clears the search with Escape before it closes the dialog", async () => {
      const user = userEvent.setup();
      mountDialog({ query: "poster" });
      search().focus();
      await user.keyboard("{Escape}");
      expect(search().value).toBe("");
      expect(dialog()).toBeTruthy();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
  });

  describe("custom size", () => {
    it("starts at 1080 x 1080 pixels and creates exactly that", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      expect(field("Width").value).toBe("1080");
      expect(field("Height").value).toBe("1080");
      expect(hint()).toBe("Between 40 - 8000 px per side.");
      await user.click(within(panel()).getByRole("button", { name: "Create new design" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0]).toMatchObject({ typeId: "custom", width: 1080, height: 1080 });
    });

    it("creates the size that was typed", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await setNumber(user, "Width", "1200");
      await setNumber(user, "Height", "628");
      expect(within(panel()).getByText("1200 × 628 px")).toBeTruthy();
      await user.click(within(panel()).getByRole("button", { name: "Create new design" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0]).toMatchObject({ width: 1200, height: 628 });
    });

    it.each([
      ["20", "1080", "Width must be between 40 - 8000 px."],
      ["1080", "9000", "Height must be between 40 - 8000 px."],
      ["20", "9000", "Width and height must be between 40 - 8000 px."],
    ])("refuses width %s and height %s", async (width, height, message) => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await setNumber(user, "Width", width);
      await setNumber(user, "Height", height);
      expect(panel().querySelector(".cf-custom__error")?.textContent).toBe(message);
      expect(panel().querySelector(".cf-custom__error")?.getAttribute("role")).toBe("alert");
      expect((within(panel()).getByRole("button", { name: "Create new design" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("checks a side while it is typed, before the field is left (B8)", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      const create = () => within(panel()).getByRole("button", { name: "Create new design" }) as HTMLButtonElement;
      const error = () => panel().querySelector(".cf-custom__error")?.textContent ?? null;
      await user.clear(field("Width"));
      // nothing typed yet: the button waits, nobody is told off
      expect(create().disabled).toBe(true);
      expect(error()).toBeNull();
      await user.type(field("Width"), "9000");
      expect(document.activeElement).toBe(field("Width"));
      expect(error()).toBe("Width must be between 40 - 8000 px.");
      expect(create().disabled).toBe(true);
      // "2" may still become "200": the button is off, with no message yet
      await user.clear(field("Width"));
      await user.type(field("Width"), "2");
      expect(create().disabled).toBe(true);
      expect(error()).toBeNull();
      await user.type(field("Width"), "00");
      expect(create().disabled).toBe(false);
      await user.clear(field("Width"));
      await user.type(field("Width"), "abc");
      expect(error()).toBe("Width must be between 40 - 8000 px.");
      expect(create().disabled).toBe(true);
      // the field is left: the text was no number, so the size is as it was
      await user.tab();
      expect(error()).toBeNull();
      expect(create().disabled).toBe(false);
    });

    it("tells about a side that is too small once the field is left", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await user.clear(field("Width"));
      await user.type(field("Width"), "20");
      expect(panel().querySelector(".cf-custom__error")).toBeNull();
      expect((within(panel()).getByRole("button", { name: "Create new design" }) as HTMLButtonElement).disabled).toBe(true);
      await user.tab();
      expect(panel().querySelector(".cf-custom__error")?.textContent).toBe("Width must be between 40 - 8000 px.");
    });

    it.each([["40"], ["8000"]])("accepts a side of %s px, the limit itself", async (side) => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await setNumber(user, "Width", side);
      await setNumber(user, "Height", side);
      expect(panel().querySelector(".cf-custom__error")).toBeNull();
      const create = within(panel()).getByRole("button", { name: "Create new design" }) as HTMLButtonElement;
      expect(create.disabled).toBe(false);
      await user.click(create);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0]).toMatchObject({ width: Number(side), height: Number(side) });
    });

    it.each([["39"], ["8001"]])("refuses a side of %s px, one past a limit", async (side) => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await setNumber(user, "Width", side);
      expect(panel().querySelector(".cf-custom__error")?.textContent).toBe("Width must be between 40 - 8000 px.");
      expect((within(panel()).getByRole("button", { name: "Create new design" }) as HTMLButtonElement).disabled).toBe(true);
    });

    it("shows and accepts sizes in the unit that is chosen, converting at 96 pixels to the inch", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await chooseUnit(user, "in");
      expect(field("Width").value).toBe("11.25");
      expect(hint()).toBe("1080 × 1080 px. Between 0.42 - 83.33 in per side.");
      await setNumber(user, "Width", "8.5");
      await setNumber(user, "Height", "11");
      await user.click(within(panel()).getByRole("button", { name: "Create new design" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved).toMatchObject({ width: 816, height: 1056 });
      expect((await getDesign(saved.id))?.unit).toBe("in");
    });

    it("converts to millimetres and centimetres too", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await chooseUnit(user, "mm");
      expect(field("Width").value).toBe("285.8");
      await chooseUnit(user, "cm");
      expect(field("Width").value).toBe("28.57");
      await chooseUnit(user, "px");
      expect(field("Width").value).toBe("1080");
    });

    it("keeps the shape when the aspect ratio is locked", async () => {
      const user = userEvent.setup();
      mountDialog({ tab: "custom" });
      await setNumber(user, "Width", "1200");
      await setNumber(user, "Height", "600");
      const lock = within(panel()).getByRole("button", { name: "Lock aspect ratio" });
      expect(lock.getAttribute("aria-pressed")).toBe("false");
      await user.click(lock);
      expect(within(panel()).getByRole("button", { name: "Unlock aspect ratio" }).getAttribute("aria-pressed")).toBe("true");
      await setNumber(user, "Width", "600");
      expect(field("Height").value).toBe("300");
      await setNumber(user, "Height", "900");
      expect(field("Width").value).toBe("1800");
      await user.click(within(panel()).getByRole("button", { name: "Unlock aspect ratio" }));
      await setNumber(user, "Width", "100");
      expect(field("Height").value).toBe("900");
    });

    it("files the design in the folder the dialog was opened for", async () => {
      const user = userEvent.setup();
      const folder = await createFolder("Sizes");
      mountDialog({ tab: "custom", folderId: folder.id });
      await user.click(within(panel()).getByRole("button", { name: "Create new design" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0].folderId).toBe(folder.id);
    });
  });

  describe("upload", () => {
    const zone = () => panel().querySelector(".cf-upload__zone") as HTMLElement;

    it("starts a design from the image chosen in the file dialog", async () => {
      const user = userEvent.setup();
      const picker = stubFilePicker([imageFile("holiday.png")]);
      mountDialog({ tab: "upload" });
      expect(within(panel()).getByText("Start a design from your photo")).toBeTruthy();
      await user.click(within(panel()).getByRole("button", { name: "Choose an image" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0].title).toBe("holiday");
      expect(picker.lastMultiple()).toBe(false);
    });

    it("does nothing when the file dialog is cancelled", async () => {
      const user = userEvent.setup();
      stubFilePicker([]);
      mountDialog({ tab: "upload" });
      await user.click(within(panel()).getByRole("button", { name: "Choose an image" }));
      await sleep(30);
      expect(await listDesigns()).toEqual([]);
      expect(panel().querySelector(".cf-upload__error")).toBeNull();
    });

    it("explains that a file that is not an image cannot be used", async () => {
      const user = userEvent.setup();
      stubFilePicker([new File(["x"], "notes.txt", { type: "text/plain" })]);
      mountDialog({ tab: "upload" });
      await user.click(within(panel()).getByRole("button", { name: "Choose an image" }));
      expect((await within(panel()).findByRole("alert")).textContent).toBe("That file is not an image. Choose a PNG, JPG, WebP, GIF or SVG file.");
      expect(await listDesigns()).toEqual([]);
    });

    it("shows the reason when the image cannot be read", async () => {
      const user = userEvent.setup();
      vi.spyOn(assets, "addAssetFromFile").mockRejectedValueOnce(new Error("corrupt"));
      stubFilePicker([imageFile("broken.png")]);
      mountDialog({ tab: "upload" });
      await user.click(within(panel()).getByRole("button", { name: "Choose an image" }));
      expect((await within(panel()).findByRole("alert")).textContent).toBe("Craftly could not read that image. Try a different file.");
    });

    it("takes an image dropped on the drop zone, which lights up while one is dragged over it", async () => {
      mountDialog({ tab: "upload" });
      const dataTransfer = { dropEffect: "", files: [imageFile("dropped.png")] };
      fireEvent.dragOver(zone(), { dataTransfer });
      expect(dataTransfer.dropEffect).toBe("copy");
      expect(zone().classList.contains("is-dragging")).toBe(true);
      fireEvent.drop(zone(), { dataTransfer });
      expect(zone().classList.contains("is-dragging")).toBe(false);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0].title).toBe("dropped");
    });

    it("stops lighting up when the drag leaves the zone, but not over its own contents", () => {
      mountDialog({ tab: "upload" });
      fireEvent.dragOver(zone(), { dataTransfer: { dropEffect: "" } });
      fireEvent(zone(), new MouseEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: zone().querySelector("button") }));
      expect(zone().classList.contains("is-dragging")).toBe(true);
      fireEvent(zone(), new MouseEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: document.body }));
      expect(zone().classList.contains("is-dragging")).toBe(false);
    });

    it("explains a dropped file that is not an image, and ignores a drop with no file", async () => {
      mountDialog({ tab: "upload" });
      fireEvent.drop(zone(), { dataTransfer: { files: [] } });
      expect(panel().querySelector(".cf-upload__error")).toBeNull();
      fireEvent.drop(zone(), { dataTransfer: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
      expect((await within(panel()).findByRole("alert")).textContent).toContain("That file is not an image.");
      expect(await listDesigns()).toEqual([]);
    });

    it("clears an earlier message when another file is tried", async () => {
      mountDialog({ tab: "upload" });
      fireEvent.drop(zone(), { dataTransfer: { files: [new File(["x"], "notes.txt", { type: "text/plain" })] } });
      await within(panel()).findByRole("alert");
      fireEvent.drop(zone(), { dataTransfer: { files: [imageFile("good.png")] } });
      await waitFor(() => expect(panel().querySelector(".cf-upload__error")).toBeNull());
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    });
  });

  describe("closing", () => {
    it("closes from the Close button and on Escape", async () => {
      const user = userEvent.setup();
      const state = renderHook(() => useCreateDialog());
      mountDialog();
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(state.result.current.open).toBe(false);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      act(() => openCreateDialog());
      await user.keyboard("{Escape}");
      expect(state.result.current.open).toBe(false);
    });

    it("closes when the backdrop is clicked", async () => {
      const user = userEvent.setup();
      const state = renderHook(() => useCreateDialog());
      mountDialog();
      await user.click(dialog().parentElement as HTMLElement);
      expect(state.result.current.open).toBe(false);
    });
  });
});
