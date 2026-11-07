import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createFolder, listDesigns, moveToTrash } from "@/core/library";
import { DESIGN_TYPES, POPULAR_DESIGN_TYPES } from "@/data/designTypes";
import { TEMPLATES } from "@/data/templates";
import { Hosts, dismissOpenDialogs, emptyLibrary, imageFile, resetDashboardStores, seedDesign, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeCreateDialog, useCreateDialog } from "./createDialogState";
import { Home } from "./Home";
import { templateCategories } from "./templateLists";
import { closeTemplatePreview, usePreviewTemplate } from "./templatePreview";

const section = (name: string) => screen.getByRole("region", { name });
const queryDesignCards = () => screen.queryAllByRole("article");

function mountHome() {
  return render(
    <>
      <Home />
      <Hosts />
    </>,
  );
}

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeCreateDialog();
    closeTemplatePreview();
    toast.clear();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<Home>", () => {
  it("shows placeholders for the recent designs while the library is read, then makes room for what is saved", async () => {
    await seedDesign({ title: "Loaded later" });
    // a freshly loaded page has not read the library yet (the stores of this file already have)
    vi.resetModules();
    const { Home: FreshHome } = await import("./Home");
    render(<FreshHome />);
    expect(document.querySelectorAll(".cf-dcard-skeleton")).toHaveLength(5);
    expect(await within(section("Recent designs")).findByRole("link", { name: "Loaded later" })).toBeTruthy();
    expect(document.querySelectorAll(".cf-dcard-skeleton")).toHaveLength(0);
  });

  it("welcomes the user with the big heading, the search and the shortcut row", async () => {
    mountHome();
    expect(await screen.findByRole("heading", { level: 1, name: "What will you design today?" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Search designs and templates" })).toBeTruthy();
    expect(screen.getByRole("group", { name: "Start a design" })).toBeTruthy();
  });

  it("has no Recent designs section while the library is empty", async () => {
    mountHome();
    await screen.findByRole("region", { name: "Popular on Craftly" });
    expect(screen.queryByRole("region", { name: "Recent designs" })).toBeNull();
  });

  it("lists the newest designs first and links to all of them", async () => {
    const user = userEvent.setup();
    await seedDesign({ title: "Oldest one", updatedAt: 1_000 });
    await seedDesign({ title: "Newest one", updatedAt: 3_000 });
    await seedDesign({ title: "Middle one", updatedAt: 2_000 });
    mountHome();
    const recent = await screen.findByRole("region", { name: "Recent designs" });
    await waitFor(() => expect(within(recent).getAllByRole("article")).toHaveLength(3));
    expect(
      within(recent)
        .getAllByRole("link")
        .map((link) => link.textContent),
    ).toEqual(["Newest one", "Middle one", "Oldest one"]);
    await user.click(within(recent).getByRole("button", { name: "See all" }));
    expect(window.location.hash).toBe("#/projects");
  });

  it("shows at most twelve recent designs and leaves out trashed ones", async () => {
    for (let i = 1; i <= 14; i += 1) await seedDesign({ title: `Design ${i}`, updatedAt: 1_000 + i });
    const gone = await seedDesign({ title: "Trashed design", updatedAt: 99_999 });
    await moveToTrash(gone.id);
    mountHome();
    const recent = await screen.findByRole("region", { name: "Recent designs" });
    await waitFor(() => expect(within(recent).getAllByRole("article")).toHaveLength(12));
    expect(within(recent).queryByText("Trashed design")).toBeNull();
    expect(within(recent).getByText("Design 14")).toBeTruthy();
    expect(within(recent).queryByText("Design 1")).toBeNull();
  });

  it("follows the library: a trashed design leaves the recent list", async () => {
    const design = await seedDesign({ title: "Short lived" });
    mountHome();
    const recent = await screen.findByRole("region", { name: "Recent designs" });
    await within(recent).findByText("Short lived");
    await moveToTrash(design.id);
    await waitFor(() => expect(screen.queryByRole("region", { name: "Recent designs" })).toBeNull());
  });

  it("offers templates for the user, led by the kind of design made recently", async () => {
    await seedDesign({ title: "A resume", typeId: "resume" });
    mountHome();
    const forYou = await screen.findByRole("region", { name: "Templates for you" });
    const cards = within(forYou).getAllByRole("article");
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.length).toBeLessThanOrEqual(16);
    const first = TEMPLATES.find((template) => template.category === "resume");
    expect(first).toBeTruthy();
    // the design is read a moment after the page appears: the templates then reorder themselves
    await waitFor(() =>
      expect(
        within(forYou)
          .getAllByRole("button", { name: /^Preview template / })[0]
          .getAttribute("aria-label"),
      ).toBe(`Preview template ${first?.name}`),
    );
  });

  it("previews a template when its card is pressed", async () => {
    const user = userEvent.setup();
    mountHome();
    const preview = renderHook(() => usePreviewTemplate());
    const forYou = await screen.findByRole("region", { name: "Templates for you" });
    await user.click(within(forYou).getAllByRole("button", { name: /^Preview template / })[0]);
    expect(preview.result.current).not.toBeNull();
  });

  it("lists the template categories as links to their pages", async () => {
    mountHome();
    const categories = await screen.findByRole("region", { name: "Browse template categories" });
    const links = within(categories).getAllByRole("link");
    expect(links).toHaveLength(templateCategories().length);
    expect(links[0].getAttribute("href")).toBe(`#/templates/${templateCategories()[0].id}`);
  });

  it("links 'See all' of the templates sections to the Templates page", async () => {
    const user = userEvent.setup();
    mountHome();
    const forYou = await screen.findByRole("region", { name: "Templates for you" });
    await user.click(within(forYou).getByRole("button", { name: "See all" }));
    expect(window.location.hash).toBe("#/templates");
  });

  it("creates a blank design when a popular type is chosen", async () => {
    const user = userEvent.setup();
    mountHome();
    const popular = await screen.findByRole("region", { name: "Popular on Craftly" });
    const tiles = within(popular).getAllByRole("button", { name: /,/ });
    expect(tiles).toHaveLength(POPULAR_DESIGN_TYPES.length);
    await user.click(within(popular).getByRole("button", { name: /^Logo,/ }));
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    expect((await listDesigns())[0].typeId).toBe("logo");
  });

  it("shows more sizes to start from, none of them the popular ones", async () => {
    const user = userEvent.setup();
    mountHome();
    const sizes = await screen.findByRole("region", { name: "Start from a size" });
    const tiles = within(sizes).getAllByRole("button", { name: /,/ });
    const others = DESIGN_TYPES.filter((type) => !type.popular).slice(0, 14);
    expect(tiles.map((tile) => tile.getAttribute("aria-label"))).toHaveLength(others.length);
    expect(tiles[0].getAttribute("aria-label")).toContain(others[0].name);
    await user.click(tiles[0]);
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    expect((await listDesigns())[0].typeId).toBe(others[0].id);
  });

  it("opens the Create dialog from the 'See all' buttons of the type sections", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    mountHome();
    const popular = await screen.findByRole("region", { name: "Popular on Craftly" });
    await user.click(within(popular).getByRole("button", { name: "See all" }));
    expect(dialog.result.current.open).toBe(true);
    act(() => closeCreateDialog());
    await user.click(within(section("Start from a size")).getByRole("button", { name: "See all" }));
    expect(dialog.result.current.open).toBe(true);
  });

  it("shows a design in a folder among the recent ones, with the folders to move it to", async () => {
    const user = userEvent.setup();
    const folder = await createFolder("Campaign");
    await seedDesign({ title: "Filed away", folderId: folder.id });
    mountHome();
    const recent = await screen.findByRole("region", { name: "Recent designs" });
    await within(recent).findByText("Filed away");
    await user.click(within(recent).getByRole("button", { name: "More actions" }));
    await user.click(screen.getByRole("menuitem", { name: "Move to folder" }));
    const sub = screen.getByRole("menu", { name: "Move to folder" });
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Campaign" }).getAttribute("aria-checked")).toBe("true");
    expect(queryDesignCards().length).toBeGreaterThan(0);
  });
});

describe("the shortcut row", () => {
  const row = () => screen.getByRole("group", { name: "Start a design" });
  const tile = (name: string) => within(row()).getByRole("button", { name });

  it("has a tile for the common things to start", async () => {
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    expect(
      within(row())
        .getAllByRole("button")
        .map((button) => button.textContent),
    ).toEqual(["Presentation", "Social media", "Printables", "Doc", "Resume", "Logo", "Custom size", "Upload", "More"]);
  });

  it.each([
    ["Presentation", "presentation"],
    ["Doc", "doc-a4"],
    ["Resume", "resume"],
    ["Logo", "logo"],
  ])("creates a blank %s design", async (label, typeId) => {
    const user = userEvent.setup();
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    await user.click(tile(label));
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    const [saved] = await listDesigns();
    expect(saved.typeId).toBe(typeId);
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
  });

  it("opens the Create dialog on the custom size tab", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    await user.click(tile("Custom size"));
    expect(dialog.result.current).toMatchObject({ open: true, tab: "custom" });
  });

  it("opens the Create dialog on its first tab from More", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    await user.click(tile("More"));
    expect(dialog.result.current).toMatchObject({ open: true, tab: "for-you" });
  });

  it("starts a design from a photo chosen with Upload", async () => {
    const user = userEvent.setup();
    stubFilePicker([imageFile("beach.png")]);
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    await user.click(tile("Upload"));
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    expect((await listDesigns())[0].title).toBe("beach");
  });

  it("opens a menu of the social media sizes and creates the one chosen", async () => {
    const user = userEvent.setup();
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    const social = tile("Social media");
    expect(social.getAttribute("aria-haspopup")).toBe("menu");
    expect(social.getAttribute("aria-expanded")).toBe("false");
    await user.click(social);
    expect(social.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu", { name: "Social media" });
    const socialTypes = DESIGN_TYPES.filter((type) => type.category === "social");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(socialTypes.length);
    const story = within(menu).getByRole("menuitem", { name: /Instagram Story/ });
    expect(story.textContent).toContain("1080 × 1920 px");
    await user.click(story);
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    expect((await listDesigns())[0].typeId).toBe("instagram-story");
    expect(screen.queryByRole("menu", { name: "Social media" })).toBeNull();
  });

  it("closes the menu when its tile is pressed again, and switches between the two menu tiles", async () => {
    const user = userEvent.setup();
    mountHome();
    await screen.findByRole("group", { name: "Start a design" });
    await user.click(tile("Printables"));
    expect(screen.getByRole("menu", { name: "Printables" })).toBeTruthy();
    await user.click(tile("Printables"));
    await waitFor(() => expect(screen.queryByRole("menu", { name: "Printables" })).toBeNull());
    await user.click(tile("Social media"));
    expect(screen.getByRole("menu", { name: "Social media" })).toBeTruthy();
    await user.click(tile("Printables"));
    expect(screen.getByRole("menu", { name: "Printables" })).toBeTruthy();
  });
});

describe("<Home> before any templates exist", () => {
  afterEach(() => {
    vi.doUnmock("@/data/templates");
    vi.resetModules();
  });

  it("leaves out the template sections and keeps the rest", async () => {
    vi.resetModules();
    vi.doMock("@/data/templates", () => ({ TEMPLATES: [], TEMPLATE_CATEGORY_LABELS: {}, searchTemplates: () => [] }));
    const { Home: EmptyCatalogueHome } = await import("./Home");
    render(<EmptyCatalogueHome />);
    await screen.findByRole("region", { name: "Popular on Craftly" });
    expect(screen.queryByRole("region", { name: "Templates for you" })).toBeNull();
    expect(screen.queryByRole("region", { name: "Browse template categories" })).toBeNull();
    expect(screen.getByRole("region", { name: "Start from a size" })).toBeTruthy();
  });
});
