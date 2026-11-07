import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, listAssets } from "@/core/assets";
import { createPage, createText, solid } from "@/core/factory";
import { createFolder, getDesign, getSummary, listDesigns, listFolders } from "@/core/library";
import { metaGet } from "@/core/persistence";
import type { DesignSummary, Folder, Template } from "@/core/types";
import { Hosts, dismissOpenDialogs, emptyLibrary, imageFile, seedDesign } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { DESIGN_DRAG_TYPE, DesignCard, DesignCardSkeleton } from "./DesignCard";
import { FolderCard } from "./FolderCard";
import { ImageCard } from "./ImageCard";
import { TemplateCard, templateWidthFor } from "./TemplateCard";
import { closeTemplatePreview, usePreviewTemplate } from "./templatePreview";

const user = () => userEvent.setup();
const summaryOf = async (id: string): Promise<DesignSummary> => (await getSummary(id)) as DesignSummary;

beforeEach(async () => {
  await emptyLibrary();
  render(<Hosts />);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    toast.clear();
    closeTemplatePreview();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

/* ------------------------------------------------------------------ */
/* DesignCard                                                         */
/* ------------------------------------------------------------------ */

describe("<DesignCard>", () => {
  async function mountCard(over: Parameters<typeof seedDesign>[0] = {}, props: Partial<Parameters<typeof DesignCard>[0]> = {}) {
    const design = await seedDesign({ title: "Poster night", typeId: "poster", ...over });
    const summary = await summaryOf(design.id);
    const folders = await listFolders();
    const view = render(<DesignCard design={summary} folders={folders} now={summary.updatedAt + 5 * 60_000} {...props} />);
    return { design, summary, folders, ...view };
  }
  const card = () => screen.getByRole("article");
  const openMenu = async (u: ReturnType<typeof user>, title = "Poster night") => {
    await u.click(screen.getByRole("button", { name: "More actions" }));
    return screen.getByRole("menu", { name: `Actions for ${title}` });
  };

  it("shows the title as a link to the editor, with the type and when it was edited", async () => {
    const { design } = await mountCard();
    const link = screen.getByRole("link", { name: "Poster night" });
    expect(link.getAttribute("href")).toBe(`#/design/${design.id}`);
    expect(card().getAttribute("aria-labelledby")).toBe(link.id);
    expect(link.getAttribute("aria-describedby")).toBeTruthy();
    const description = document.getElementById(link.getAttribute("aria-describedby") as string);
    expect(description?.textContent).toBe("Poster · Edited 5 min ago");
  });

  it("shows the thumbnail when the design has one, and a drawn placeholder when it has not", async () => {
    const { unmount } = await mountCard({ thumbnail: "data:image/jpeg;base64,AAAA" });
    expect(card().querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
    expect(card().querySelector(".cf-mock")).toBeNull();
    unmount();
    await mountCard({ title: "No picture yet" });
    expect(card().querySelector("img")).toBeNull();
    expect(card().querySelector(".cf-mock")).toBeTruthy();
  });

  it("takes its look from the layout, and shows a star on starred designs", async () => {
    await mountCard({ starred: true }, { layout: "row" });
    expect(card().classList.contains("cf-dcard--row")).toBe(true);
    expect(card().classList.contains("is-starred")).toBe(true);
    expect(screen.getByRole("button", { name: "Star" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("stars and unstars the design from the star button", async () => {
    const u = user();
    const { design } = await mountCard();
    const star = screen.getByRole("button", { name: "Star" });
    expect(star.getAttribute("aria-pressed")).toBe("false");
    await u.click(star);
    await waitFor(async () => expect((await summaryOf(design.id)).starred).toBe(true));
  });

  it("lists the actions in the More menu", async () => {
    const u = user();
    await mountCard();
    const menu = await openMenu(u);
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Open", "Rename", "Make a copy", "Star", "Move to folder", "Move to trash"]);
    expect(card().classList.contains("is-menu-open")).toBe(true);
  });

  it("offers 'Unstar' for a starred design", async () => {
    const u = user();
    const { design } = await mountCard({ starred: true });
    const menu = await openMenu(u);
    await u.click(within(menu).getByRole("menuitem", { name: "Unstar" }));
    await waitFor(async () => expect((await summaryOf(design.id)).starred).toBe(false));
  });

  it("opens the design from the menu", async () => {
    const u = user();
    const { design } = await mountCard();
    await u.click(within(await openMenu(u)).getByRole("menuitem", { name: "Open" }));
    expect(window.location.hash).toBe(`#/design/${design.id}`);
  });

  it("renames the design from the menu", async () => {
    const u = user();
    const { design } = await mountCard();
    await u.click(within(await openMenu(u)).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename design" });
    await u.clear(within(dialog).getByRole("textbox"));
    await u.type(within(dialog).getByRole("textbox"), "Gala poster{Enter}");
    await waitFor(async () => expect((await summaryOf(design.id)).title).toBe("Gala poster"));
  });

  it("makes a copy from the menu", async () => {
    const u = user();
    await mountCard();
    await u.click(within(await openMenu(u)).getByRole("menuitem", { name: "Make a copy" }));
    await waitFor(async () => expect((await listDesigns()).map((d) => d.title).sort()).toEqual(["Poster night", "Poster night (copy)"]));
  });

  it("moves the design to the trash from the menu", async () => {
    const u = user();
    const { design } = await mountCard();
    await u.click(within(await openMenu(u)).getByRole("menuitem", { name: "Move to trash" }));
    await waitFor(async () => expect((await summaryOf(design.id)).trashedAt).toEqual(expect.any(Number)));
  });

  it("moves the design into a folder from the Move to folder submenu, which marks where it is now", async () => {
    const u = user();
    const folder = await createFolder("Campaign");
    const { design } = await mountCard();
    const menu = await openMenu(u);
    await u.click(within(menu).getByRole("menuitem", { name: "Move to folder" }));
    const sub = screen.getByRole("menu", { name: "Move to folder" });
    const names = Array.from(sub.querySelectorAll("[role^=menuitem]")).map((el) => el.textContent);
    expect(names).toEqual(["Projects", "Campaign", "New folder…"]);
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Projects" }).getAttribute("aria-checked")).toBe("true");
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Projects" }).getAttribute("aria-disabled")).toBe("true");
    await u.click(within(sub).getByRole("menuitemcheckbox", { name: "Campaign" }));
    await waitFor(async () => expect((await summaryOf(design.id)).folderId).toBe(folder.id));
  });

  it("marks the folder the design is in, and lets it go back to Projects", async () => {
    const u = user();
    const folder = await createFolder("Campaign");
    const { design } = await mountCard({ folderId: folder.id });
    const menu = await openMenu(u);
    await u.click(within(menu).getByRole("menuitem", { name: "Move to folder" }));
    const sub = screen.getByRole("menu", { name: "Move to folder" });
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Campaign" }).getAttribute("aria-checked")).toBe("true");
    expect(within(sub).getByRole("menuitemcheckbox", { name: "Projects" }).getAttribute("aria-checked")).toBe("false");
    await u.click(within(sub).getByRole("menuitemcheckbox", { name: "Projects" }));
    await waitFor(async () => expect((await summaryOf(design.id)).folderId).toBeNull());
  });

  it("creates a folder for the design from the submenu", async () => {
    const u = user();
    const { design } = await mountCard();
    const menu = await openMenu(u);
    await u.click(within(menu).getByRole("menuitem", { name: "Move to folder" }));
    await u.click(within(screen.getByRole("menu", { name: "Move to folder" })).getByRole("menuitem", { name: "New folder…" }));
    const dialog = await screen.findByRole("dialog", { name: "New folder" });
    await u.type(within(dialog).getByRole("textbox"), "Fresh{Enter}");
    await waitFor(async () => expect((await listFolders()).map((f) => f.name)).toEqual(["Fresh"]));
    const [folder] = await listFolders();
    await waitFor(async () => expect((await summaryOf(design.id)).folderId).toBe(folder.id));
  });

  it("opens the same actions on a right click, at the pointer", async () => {
    await mountCard();
    fireEvent.contextMenu(card(), { clientX: 40, clientY: 60 });
    const menu = await screen.findByRole("menu", { name: "Context menu" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Open", "Rename", "Make a copy", "Star", "Move to folder", "Move to trash"]);
    expect((menu.closest("[data-cf-layer]") as HTMLElement).style.left).toBe("40px");
  });

  describe("dragging onto a folder", () => {
    it("is not draggable unless asked", async () => {
      await mountCard();
      expect(card().getAttribute("draggable")).toBe("false");
    });

    it("carries its id and title when dragged, and shows that it is being dragged", async () => {
      await mountCard({}, { draggable: true });
      const setData = vi.fn();
      const dataTransfer = { setData, effectAllowed: "" };
      expect(card().getAttribute("draggable")).toBe("true");
      fireEvent.dragStart(card(), { dataTransfer });
      expect(setData).toHaveBeenCalledWith(DESIGN_DRAG_TYPE, expect.stringMatching(/^d_/));
      expect(setData).toHaveBeenCalledWith("text/plain", "Poster night");
      expect(dataTransfer.effectAllowed).toBe("move");
      expect(card().classList.contains("is-dragging")).toBe(true);
      fireEvent.dragEnd(card());
      expect(card().classList.contains("is-dragging")).toBe(false);
    });

    it("ignores drag events when it is not draggable", async () => {
      await mountCard();
      const setData = vi.fn();
      fireEvent.dragStart(card(), { dataTransfer: { setData, effectAllowed: "" } });
      expect(setData).not.toHaveBeenCalled();
      expect(card().classList.contains("is-dragging")).toBe(false);
    });
  });
});

describe("<DesignCardSkeleton>", () => {
  it("is a hidden placeholder in the grid or carousel shape", () => {
    const { container, rerender } = render(<DesignCardSkeleton />);
    const skeleton = container.querySelector(".cf-dcard-skeleton") as HTMLElement;
    expect(skeleton.getAttribute("aria-hidden")).toBe("true");
    expect(skeleton.classList.contains("cf-dcard-skeleton--carousel")).toBe(false);
    rerender(<DesignCardSkeleton layout="carousel" />);
    expect(container.querySelector(".cf-dcard-skeleton")?.classList.contains("cf-dcard-skeleton--carousel")).toBe(true);
  });
});

/* ------------------------------------------------------------------ */
/* FolderCard                                                         */
/* ------------------------------------------------------------------ */

describe("<FolderCard>", () => {
  const folder: Folder = { id: "f_one", name: "Campaign A", createdAt: Date.now() - 2 * 3_600_000, parentId: null };
  const mountFolder = (props: Partial<Parameters<typeof FolderCard>[0]> = {}) => render(<FolderCard folder={folder} count={3} now={Date.now()} {...props} />);
  const card = () => screen.getByRole("article");
  const carrying = (id: string) => ({ types: [DESIGN_DRAG_TYPE], getData: (type: string) => (type === DESIGN_DRAG_TYPE ? id : ""), dropEffect: "" });

  it("shows the name as a link to the folder, with how many designs are inside", () => {
    mountFolder();
    const link = screen.getByRole("link", { name: "Campaign A" });
    expect(link.getAttribute("href")).toBe("#/projects/f_one");
    expect(card().textContent).toContain("3 designs");
    expect(card().textContent).toContain("Folder");
  });

  it("says '1 design' and encodes odd ids in the link", () => {
    mountFolder({ folder: { ...folder, id: "a b/c" }, count: 1 });
    expect(screen.getByRole("link").getAttribute("href")).toBe("#/projects/a%20b%2Fc");
    expect(card().textContent).toContain("1 design");
  });

  it("opens the folder, renames it or deletes it from the menu", async () => {
    const u = user();
    const real = await createFolder("Campaign A");
    mountFolder({ folder: real });
    await u.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "Actions for folder Campaign A" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Open", "Rename", "Delete folder"]);
    await u.click(within(menu).getByRole("menuitem", { name: "Open" }));
    expect(window.location.hash).toBe(`#/projects/${real.id}`);

    await u.click(screen.getByRole("button", { name: "More actions" }));
    await u.click(screen.getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename folder" });
    await u.clear(within(dialog).getByRole("textbox"));
    await u.type(within(dialog).getByRole("textbox"), "Campaign B{Enter}");
    await waitFor(async () => expect((await listFolders())[0].name).toBe("Campaign B"));
  });

  it("asks before deleting a folder, then deletes it", async () => {
    const u = user();
    const real = await createFolder("Doomed");
    mountFolder({ folder: real, count: 2 });
    await u.click(screen.getByRole("button", { name: "More actions" }));
    await u.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete “Doomed”?" });
    expect(dialog.textContent).toContain("The 2 designs inside will move back to Projects.");
    await u.click(within(dialog).getByRole("button", { name: "Delete folder" }));
    await waitFor(async () => expect(await listFolders()).toEqual([]));
  });

  it("opens the same actions on a right click", () => {
    mountFolder();
    fireEvent.contextMenu(card(), { clientX: 10, clientY: 20 });
    expect(
      within(screen.getByRole("menu", { name: "Context menu" }))
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Open", "Rename", "Delete folder"]);
  });

  describe("receiving a dragged design", () => {
    it("lights up while a design is dragged over it and hands the design's id over when dropped", () => {
      const onDropDesign = vi.fn();
      mountFolder({ onDropDesign });
      const transfer = carrying("d_42");
      fireEvent.dragEnter(card(), { dataTransfer: transfer });
      expect(card().classList.contains("is-drop-target")).toBe(true);
      fireEvent.dragOver(card(), { dataTransfer: transfer });
      expect(transfer.dropEffect).toBe("move");
      fireEvent.drop(card(), { dataTransfer: transfer });
      expect(onDropDesign).toHaveBeenCalledWith("d_42");
      expect(card().classList.contains("is-drop-target")).toBe(false);
    });

    it("stops lighting up when the drag leaves it, but not when it moves over its own children", () => {
      mountFolder({ onDropDesign: vi.fn() });
      fireEvent.dragOver(card(), { dataTransfer: carrying("d_1") });
      const inner = screen.getByRole("link");
      // jsdom has no DragEvent: a mouse event of type "dragleave" carries the relatedTarget
      fireEvent(card(), new MouseEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: inner }));
      expect(card().classList.contains("is-drop-target")).toBe(true);
      fireEvent(card(), new MouseEvent("dragleave", { bubbles: true, cancelable: true, relatedTarget: document.body }));
      expect(card().classList.contains("is-drop-target")).toBe(false);
    });

    it("ignores anything that is not a design, and drops without an id", () => {
      const onDropDesign = vi.fn();
      mountFolder({ onDropDesign });
      const files = { types: ["Files"], getData: () => "", dropEffect: "" };
      fireEvent.dragEnter(card(), { dataTransfer: files });
      fireEvent.dragOver(card(), { dataTransfer: files });
      expect(card().classList.contains("is-drop-target")).toBe(false);
      fireEvent.drop(card(), { dataTransfer: files });
      fireEvent.drop(card(), { dataTransfer: carrying("") });
      expect(onDropDesign).not.toHaveBeenCalled();
    });

    it("does not take drops at all without a drop handler", () => {
      mountFolder();
      fireEvent.dragEnter(card(), { dataTransfer: carrying("d_1") });
      fireEvent.dragOver(card(), { dataTransfer: carrying("d_1") });
      fireEvent.drop(card(), { dataTransfer: carrying("d_1") });
      expect(card().classList.contains("is-drop-target")).toBe(false);
    });
  });
});

/* ------------------------------------------------------------------ */
/* ImageCard                                                          */
/* ------------------------------------------------------------------ */

describe("<ImageCard>", () => {
  /** Ages are worded by the calendar ("2h ago" only within one day): a fixed noon gives the same words at any hour. */
  const NOON = new Date(2026, 10, 5, 12, 0, 0).getTime();
  async function mountImage(name = "holiday.png", mime = "image/png", props: Partial<Parameters<typeof ImageCard>[0]> = {}) {
    const asset = { ...(await addAssetFromFile(imageFile(name, mime))), createdAt: NOON };
    render(<ImageCard asset={asset} now={NOON + 3_600_000 * 2} {...props} />);
    return asset;
  }
  const card = () => screen.getByRole("article");

  it("shows the name, the dimensions and the file size, with the picture once it is ready", async () => {
    await mountImage();
    expect(card().querySelector(".cf-icard__img, .cf-skeleton")).toBeTruthy();
    await waitFor(() => expect(card().querySelector("img")?.getAttribute("src")).toMatch(/^blob:/));
    expect(screen.getByText("holiday")).toBeTruthy();
    expect(card().textContent).toContain("64 × 48 px · 8 B");
    expect(card().textContent).toContain("PNG image");
    expect(card().textContent).toContain("2h ago");
  });

  it("names the kind of file after its type", async () => {
    await mountImage("vector.svg", "image/svg+xml");
    expect(card().textContent).toContain("SVG image");
  });

  it("falls back to a generic kind for a type without a subtype", async () => {
    const asset = await addAssetFromFile(imageFile("odd.png"));
    render(<ImageCard asset={{ ...asset, mime: "image" }} now={asset.createdAt} />);
    expect(screen.getAllByText("IMAGE image").length).toBeGreaterThan(0);
  });

  it("starts a design from the picture with the Use in new design button", async () => {
    const u = user();
    const asset = await mountImage();
    await u.click(screen.getByRole("button", { name: "Use in new design" }));
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    const [saved] = await listDesigns();
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
    expect(saved.title).toBe(asset.name);
  });

  it("lists Use in new design, Rename and Delete in the menu, and renames from it", async () => {
    const u = user();
    await mountImage();
    await u.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "Actions for holiday" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Use in new design", "Rename", "Delete"]);
    await u.click(within(menu).getByRole("menuitem", { name: "Rename" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename image" });
    await u.clear(within(dialog).getByRole("textbox"));
    await u.type(within(dialog).getByRole("textbox"), "beach{Enter}");
    await waitFor(async () => expect((await listAssets())[0].name).toBe("beach"));
  });

  it("starts a design from the picture with the menu entry too", async () => {
    const u = user();
    await mountImage();
    await u.click(screen.getByRole("button", { name: "More actions" }));
    await u.click(within(screen.getByRole("menu", { name: "Actions for holiday" })).getByRole("menuitem", { name: "Use in new design" }));
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    expect((await listDesigns())[0].title).toBe("holiday");
  });

  it("deletes the image from the menu after the user confirms", async () => {
    const u = user();
    await mountImage();
    await u.click(screen.getByRole("button", { name: "More actions" }));
    await u.click(within(screen.getByRole("menu", { name: "Actions for holiday" })).getByRole("menuitem", { name: "Delete" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete “holiday”?" });
    await u.click(within(dialog).getByRole("button", { name: "Delete image" }));
    await waitFor(async () => expect(await listAssets()).toEqual([]));
  });

  it("opens the same actions on a right click", async () => {
    await mountImage();
    fireEvent.contextMenu(card(), { clientX: 10, clientY: 20 });
    expect(
      within(screen.getByRole("menu", { name: "Context menu" }))
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Use in new design", "Rename", "Delete"]);
  });

  it("takes its look from the layout", async () => {
    await mountImage("a.png", "image/png", { layout: "row" });
    expect(card().classList.contains("cf-icard--row")).toBe(true);
  });

  it("does not show a picture that arrives after the card is gone", async () => {
    const asset = await addAssetFromFile(imageFile("late.png"));
    const { unmount } = render(<ImageCard asset={asset} now={asset.createdAt} />);
    unmount();
    await act(async () => void (await new Promise((resolve) => setTimeout(resolve, 20))));
    expect(document.querySelector("img")).toBeNull();
  });
});

/* ------------------------------------------------------------------ */
/* TemplateCard                                                       */
/* ------------------------------------------------------------------ */

describe("<TemplateCard>", () => {
  let counter = 0;
  const makeTemplate = (over: Partial<Template> = {}): Template => ({
    id: `card-tpl-${(counter += 1)}`,
    name: "Sunny day",
    category: "social",
    typeId: "instagram-post",
    width: 1080,
    height: 1350,
    tags: ["summer"],
    accent: "#ff8800",
    pages: [createPage({ background: solid("#ffffff"), elements: [createText({ text: "Hello" })] })],
    ...over,
  });

  it("shows a thumbnail button that previews the template", async () => {
    const u = user();
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    const preview = renderHook(() => usePreviewTemplate());
    await u.click(screen.getByRole("button", { name: "Preview template Sunny day" }));
    expect(preview.result.current).toBe(template);
  });

  it("previews from the Preview button too", async () => {
    const u = user();
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    const preview = renderHook(() => usePreviewTemplate());
    await u.click(screen.getByRole("button", { name: "Preview" }));
    expect(preview.result.current).toBe(template);
  });

  it("shows its name only when asked to", () => {
    const template = makeTemplate();
    const { rerender } = render(<TemplateCard template={template} />);
    expect(screen.queryByText("Sunny day")).toBeNull();
    rerender(<TemplateCard template={template} showName />);
    expect(screen.getByText("Sunny day")).toBeTruthy();
  });

  it("stars and unstars the template, remembering it on this device", async () => {
    const u = user();
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    const article = screen.getByRole("article");
    await u.click(screen.getByRole("button", { name: "Add to favourites" }));
    expect(await screen.findByRole("button", { name: "Remove from favourites" })).toBeTruthy();
    expect(article.classList.contains("is-favourite")).toBe(true);
    expect(await metaGet<string[]>("favTemplates", [])).toContain(template.id);
    expect(await screen.findByText("Added “Sunny day” to your favourites")).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "Remove from favourites" }));
    expect(await screen.findByRole("button", { name: "Add to favourites" })).toBeTruthy();
    expect(article.classList.contains("is-favourite")).toBe(false);
    expect(await metaGet<string[]>("favTemplates", [])).not.toContain(template.id);
  });

  it("offers Preview, Customize and the favourite toggle in the menu", async () => {
    const u = user();
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    await u.click(screen.getByRole("button", { name: "More actions" }));
    const menu = screen.getByRole("menu", { name: "Actions for template Sunny day" });
    expect(
      within(menu)
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Preview", "Customize this template", "Add to favourites"]);
    await u.click(within(menu).getByRole("menuitem", { name: "Add to favourites" }));
    expect(await screen.findByRole("button", { name: "Remove from favourites" })).toBeTruthy();
    await u.click(screen.getByRole("button", { name: "More actions" }));
    expect(screen.getByRole("menuitem", { name: "Remove from favourites" })).toBeTruthy();
  });

  it("previews from the menu", async () => {
    const u = user();
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    const preview = renderHook(() => usePreviewTemplate());
    await u.click(screen.getByRole("button", { name: "More actions" }));
    await u.click(screen.getByRole("menuitem", { name: "Preview" }));
    expect(preview.result.current).toBe(template);
  });

  it("starts a design from the template from the menu", async () => {
    const u = user();
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    await u.click(screen.getByRole("button", { name: "More actions" }));
    await u.click(screen.getByRole("menuitem", { name: "Customize this template" }));
    await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    const [saved] = await listDesigns();
    expect(saved.title).toBe("Sunny day");
    expect(window.location.hash).toBe(`#/design/${saved.id}`);
    expect((await getDesign(saved.id))?.pages).toHaveLength(1);
  });

  it("opens the same actions on a right click", () => {
    const template = makeTemplate();
    render(<TemplateCard template={template} />);
    fireEvent.contextMenu(screen.getByRole("article"), { clientX: 5, clientY: 5 });
    expect(
      within(screen.getByRole("menu", { name: "Context menu" }))
        .getAllByRole("menuitem")
        .map((el) => el.textContent),
    ).toEqual(["Preview", "Customize this template", "Add to favourites"]);
  });

  describe("width", () => {
    it("is the width it is given", () => {
      render(<TemplateCard template={makeTemplate()} width={222.4} />);
      expect(screen.getByRole("article").style.width).toBe("222px");
    });

    it("follows the shape of the template at the height it is given", () => {
      render(<TemplateCard template={makeTemplate()} height={200} />);
      expect(screen.getByRole("article").style.width).toBe("160px");
    });

    it("is 190 pixels high by default", () => {
      render(<TemplateCard template={makeTemplate()} />);
      expect(screen.getByRole("article").style.width).toBe("152px");
    });

    it("keeps a template between 110 and 340 pixels wide", () => {
      expect(templateWidthFor(makeTemplate({ width: 4000, height: 500 }), 190)).toBe(340);
      expect(templateWidthFor(makeTemplate({ width: 100, height: 1000 }), 190)).toBe(110);
      expect(templateWidthFor(makeTemplate({ width: 500, height: 0 }), 100)).toBe(340);
    });
  });
});
