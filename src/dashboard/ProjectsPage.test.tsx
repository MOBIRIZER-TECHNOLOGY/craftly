import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { addAssetFromFile, listAssets } from "@/core/assets";
import { createFolder, deleteFolder, getDesign, getSummary, listDesigns, listFolders, moveToTrash, saveDesign } from "@/core/library";
import { Hosts, dismissOpenDialogs, emptyLibrary, imageFile, resetDashboardStores, seedDesign, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeCreateDialog, useCreateDialog } from "./createDialogState";
import { DESIGN_DRAG_TYPE } from "./DesignCard";
import { ProjectsPage } from "./ProjectsPage";
import { TrashPage } from "./TrashPage";
import { applySession } from "@/cloud/state";

const VIEW_KEY = "craftly:projects-view";
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function mountProjects(folderId?: string) {
  return render(
    <>
      <ProjectsPage folderId={folderId} />
      <Hosts />
    </>,
  );
}

/** Two folders, four designs (one starred, one inside a folder) and one uploaded image. */
async function seedLibrary() {
  const campaign = await createFolder("Campaign A");
  await sleep(4);
  const logos = await createFolder("Logos");
  const flyer = await seedDesign({ title: "Spring flyer", typeId: "flyer", starred: true, updatedAt: 3000 });
  const insta = await seedDesign({ title: "Instagram teaser", typeId: "instagram-post", updatedAt: 4000 });
  const logo = await seedDesign({ title: "Logo draft", typeId: "logo", folderId: logos.id, updatedAt: 2000 });
  const poster = await seedDesign({ title: "Old poster", typeId: "poster", updatedAt: 1000 });
  const photo = await addAssetFromFile(imageFile("beach.png"));
  return { campaign, logos, flyer, insta, logo, poster, photo };
}

const group = (name: "Folders" | "Designs" | "Images") => screen.getByRole("region", { name });
const queryGroup = (name: "Folders" | "Designs" | "Images") => screen.queryByRole("region", { name });
const titles = (region: HTMLElement) =>
  within(region)
    .getAllByRole("link")
    .map((link) => link.textContent);
const imageNames = () =>
  within(group("Images"))
    .getAllByRole("article")
    .map((card) => card.querySelector(".cf-icard__title")?.textContent);
const tab = (name: string) => screen.getByRole("tab", { name });
const searchBox = () => screen.getByRole("searchbox", { name: "Search your content" }) as HTMLInputElement;

async function choose(user: ReturnType<typeof userEvent.setup>, selectName: string, optionName: string) {
  await user.click(screen.getByRole("combobox", { name: selectName }));
  await user.click(screen.getByRole("option", { name: optionName }));
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

describe("<ProjectsPage> loading and empty states", () => {
  it("shows placeholders while the library is read", async () => {
    await seedDesign({ title: "Eventually" });
    // a freshly loaded page has not read the library yet (the stores of this file already have)
    vi.resetModules();
    const { ProjectsPage: FreshProjectsPage } = await import("./ProjectsPage");
    render(<FreshProjectsPage />);
    expect(screen.getByLabelText("Loading your projects").getAttribute("aria-busy")).toBe("true");
    expect(await screen.findByRole("link", { name: "Eventually" })).toBeTruthy();
    expect(screen.queryByLabelText("Loading your projects")).toBeNull();
  });

  it("invites the user to start a first project when nothing is saved, without the search tools", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    mountProjects();
    expect(await screen.findByText("Start your first project")).toBeTruthy();
    // straight under the page title, so one level down from it
    expect(screen.getByRole("heading", { level: 2, name: "Start your first project" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("searchbox")).toBeNull();
    await user.click(screen.getAllByRole("button", { name: "Create a design" })[0]);
    expect(dialog.result.current.open).toBe(true);
  });

  it("creates a folder from the empty state", async () => {
    const user = userEvent.setup();
    mountProjects();
    await screen.findByText("Start your first project");
    const [, emptyStateButton] = screen.getAllByRole("button", { name: "Create folder" });
    await user.click(emptyStateButton);
    const dialog = await screen.findByRole("dialog", { name: "Create folder" });
    await user.type(within(dialog).getByRole("textbox"), "First folder{Enter}");
    await waitFor(async () => expect((await listFolders()).map((folder) => folder.name)).toEqual(["First folder"]));
  });

  it("has Create folder, Upload and Create design buttons in the header", async () => {
    mountProjects();
    await screen.findByText("Start your first project");
    expect(screen.getByRole("heading", { level: 1, name: "Projects" })).toBeTruthy();
    expect(screen.getByText("Your designs, folders and uploads, saved on this device.")).toBeTruthy();
    for (const name of ["Create folder", "Upload", "Create design"]) expect(screen.getAllByRole("button", { name }).length).toBeGreaterThan(0);
  });
});

describe("<ProjectsPage> and <TrashPage> in a team's space (B11)", () => {
  const ANN = { id: "user_ann_0000000000001", email: "ann@example.org", name: "Ann Lee" };
  const TEAM = { id: "team_studio_000000001", name: "Studio", role: "editor" as const };
  const signIn = (activeSpace: string) =>
    act(() => applySession({ server: "https://accounts.example.org", token: "T".repeat(43), user: ANN, device: "Test", teams: [TEAM], activeSpace }));
  afterEach(() => act(() => applySession(null)));

  it("says that what is there is synced to the team's server, not saved on this device", async () => {
    signIn(TEAM.id);
    mountProjects();
    await screen.findByText("Start your first project");
    expect(screen.getByText("The designs, folders and uploads of Studio, synced to the team's server.")).toBeTruthy();
    expect(screen.getByText(/^Designs you create here are synced to the team's server/)).toBeTruthy();
    expect(screen.queryByText(/on this device/)).toBeNull();
  });

  it("says the trash of a team is kept on the team's server", async () => {
    signIn(TEAM.id);
    render(<TrashPage />);
    expect(await screen.findByText("Designs in the trash are kept on the team's server until you delete them.")).toBeTruthy();
  });

  it("still says on this device in the person's own space", async () => {
    signIn(ANN.id);
    mountProjects();
    await screen.findByText("Start your first project");
    expect(screen.getByText("Your designs, folders and uploads, saved on this device.")).toBeTruthy();
  });
});

describe("<ProjectsPage> content", () => {
  it("groups folders, designs and images, newest first, with the folders' contents counted", async () => {
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    // the folders, designs and images come from three stores that load on their own: this total is there once all have
    expect(await screen.findByText("6 items shown")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Folders" })).toBeTruthy();
    expect(titles(group("Folders"))).toEqual(["Logos", "Campaign A"]);
    expect(within(group("Folders")).getByText("1 design")).toBeTruthy();
    expect(within(group("Folders")).getByText("0 designs")).toBeTruthy();
    expect(titles(group("Designs"))).toEqual(["Instagram teaser", "Spring flyer", "Old poster"]);
    expect(imageNames()).toEqual(["beach"]);
    expect(screen.getByText("6 items shown")).toBeTruthy();
  });

  it("shows no group headings when only one kind of thing is there", async () => {
    await seedDesign({ title: "Alone" });
    mountProjects();
    await screen.findByRole("link", { name: "Alone" });
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.getByText("1 items shown")).toBeTruthy();
  });

  it("puts a design back at the top level when its folder no longer exists", async () => {
    const { logos } = await seedLibrary();
    await deleteFolder(logos.id);
    // deleteFolder moves its designs out; put the stale folder id back, as if the folder had been removed elsewhere
    const logo = (await listDesigns()).find((design) => design.title === "Logo draft");
    const full = await getDesign(logo!.id);
    await saveDesign({ ...full!, folderId: logos.id });
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    expect(titles(group("Designs"))).toContain("Logo draft");
  });

  it("opens a design from its card", async () => {
    const user = userEvent.setup();
    const { insta } = await seedLibrary();
    mountProjects();
    await user.click(await screen.findByRole("link", { name: "Instagram teaser" }));
    expect(window.location.hash).toBe(`#/design/${insta.id}`);
  });

  it("opens a folder from its card", async () => {
    const user = userEvent.setup();
    const { logos } = await seedLibrary();
    mountProjects();
    await user.click(await screen.findByRole("link", { name: "Logos" }));
    expect(window.location.hash).toBe(`#/projects/${logos.id}`);
  });
});

describe("<ProjectsPage> tabs", () => {
  it("narrows the page to designs, folders or images", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual(["All", "Designs", "Folders", "Images"]);
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    await user.click(tab("Designs"));
    expect(queryGroup("Folders")).toBeNull();
    expect(queryGroup("Images")).toBeNull();
    expect(titles(group("Designs"))).toHaveLength(3);
    await user.click(tab("Folders"));
    expect(queryGroup("Designs")).toBeNull();
    expect(titles(group("Folders"))).toEqual(["Logos", "Campaign A"]);
    await user.click(tab("Images"));
    expect(imageNames()).toEqual(["beach"]);
    expect(queryGroup("Folders")).toBeNull();
    await user.click(tab("All"));
    expect(group("Folders")).toBeTruthy();
  });

  it("only offers the type and starred filters on the tabs that show designs", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    expect(screen.getByRole("combobox", { name: "Filter by design type" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Starred" })).toBeTruthy();
    await user.click(tab("Folders"));
    expect(screen.queryByRole("combobox", { name: "Filter by design type" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Starred" })).toBeNull();
    expect(screen.getByRole("combobox", { name: "Sort by" })).toBeTruthy();
  });

  it("explains an empty Folders tab and offers to create a folder", async () => {
    const user = userEvent.setup();
    await seedDesign({ title: "Only a design" });
    mountProjects();
    await screen.findByRole("link", { name: "Only a design" });
    await user.click(tab("Folders"));
    expect(screen.getByText("No folders yet")).toBeTruthy();
    await user.click(within(screen.getByText("No folders yet").closest(".cf-empty") as HTMLElement).getByRole("button", { name: "Create folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Create folder" });
    await user.type(within(dialog).getByRole("textbox"), "Fresh{Enter}");
    await waitFor(() => expect(titles(group("Folders"))).toEqual(["Fresh"]));
  });

  it("explains an empty Images tab and offers to upload", async () => {
    const user = userEvent.setup();
    await seedDesign({ title: "Only a design" });
    mountProjects();
    await screen.findByRole("link", { name: "Only a design" });
    await user.click(tab("Images"));
    expect(screen.getByText("No uploads yet")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Upload images" })).toBeTruthy();
  });

  it("explains an empty Designs tab and offers to create one", async () => {
    const user = userEvent.setup();
    await createFolder("Just a folder");
    mountProjects();
    await screen.findByRole("link", { name: "Just a folder" });
    await user.click(tab("Designs"));
    expect(screen.getByText("No designs here yet")).toBeTruthy();
    const dialog = renderHook(() => useCreateDialog());
    await user.click(within(screen.getByText("No designs here yet").closest(".cf-empty") as HTMLElement).getByRole("button", { name: "Create a design" }));
    expect(dialog.result.current.open).toBe(true);
  });
});

describe("<ProjectsPage> search, sort and filters", () => {
  it("looks through every folder when something is typed", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await user.type(searchBox(), "logo");
    expect(titles(group("Designs"))).toEqual(["Logo draft"]);
    expect(titles(group("Folders"))).toEqual(["Logos"]);
    expect(queryGroup("Images")).toBeNull();
    expect(screen.getByText("2 items shown")).toBeTruthy();
  });

  it("finds a design by the name of its type", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await user.type(searchBox(), "flyer");
    expect(titles(group("Designs"))).toEqual(["Spring flyer"]);
  });

  it("finds an uploaded image by name", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await user.type(searchBox(), "beach");
    expect(imageNames()).toEqual(["beach"]);
    expect(queryGroup("Designs")).toBeNull();
  });

  it("says nothing matches, and the button clears the search and every filter", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await user.click(screen.getByRole("button", { name: "Starred" }));
    await user.type(searchBox(), "zzzqqq");
    expect(screen.getByText("Nothing matches “zzzqqq”")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Clear search and filters" }));
    expect(searchBox().value).toBe("");
    expect(screen.getByRole("button", { name: "Starred" }).getAttribute("aria-pressed")).toBe("false");
    expect(titles(group("Designs"))).toHaveLength(3);
  });

  it("sorts oldest first, then by name", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await choose(user, "Sort by", "Oldest");
    expect(titles(group("Designs"))).toEqual(["Old poster", "Spring flyer", "Instagram teaser"]);
    expect(titles(group("Folders"))).toEqual(["Campaign A", "Logos"]);
    await choose(user, "Sort by", "A-Z");
    expect(titles(group("Designs"))).toEqual(["Instagram teaser", "Old poster", "Spring flyer"]);
    expect(titles(group("Folders"))).toEqual(["Campaign A", "Logos"]);
    await choose(user, "Sort by", "Most recent");
    expect(titles(group("Designs"))).toEqual(["Instagram teaser", "Spring flyer", "Old poster"]);
    expect(titles(group("Folders"))).toEqual(["Logos", "Campaign A"]);
  });

  it("sorts the images too", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    await sleep(4);
    await addAssetFromFile(imageFile("apple.png"));
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    expect(imageNames()).toEqual(["apple", "beach"]);
    await choose(user, "Sort by", "Oldest");
    expect(imageNames()).toEqual(["beach", "apple"]);
    await choose(user, "Sort by", "A-Z");
    expect(imageNames()).toEqual(["apple", "beach"]);
  });

  it("filters by design type, listing only the types that exist", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await user.click(screen.getByRole("combobox", { name: "Filter by design type" }));
    expect(screen.getAllByRole("option").map((el) => el.textContent)).toEqual(["All types", "Flyer (US Letter)", "Instagram Post (4:5)", "Logo", "Poster (18 × 24 in)"]);
    await user.click(screen.getByRole("option", { name: "Flyer (US Letter)" }));
    expect(titles(group("Designs"))).toEqual(["Spring flyer"]);
    expect(queryGroup("Folders")).toBeNull();
    expect(queryGroup("Images")).toBeNull();
  });

  it("goes back to all types when the last design of the chosen type goes away", async () => {
    const user = userEvent.setup();
    const { flyer } = await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    await choose(user, "Filter by design type", "Flyer (US Letter)");
    expect(titles(group("Designs"))).toEqual(["Spring flyer"]);
    await moveToTrash(flyer.id);
    await waitFor(() => expect(screen.getByRole("combobox", { name: "Filter by design type" }).textContent).toBe("All types"));
    expect(titles(group("Designs"))).toContain("Instagram teaser");
  });

  it("shows only starred designs with the Starred button", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    const starred = screen.getByRole("button", { name: "Starred" });
    expect(starred.getAttribute("aria-pressed")).toBe("false");
    await user.click(starred);
    expect(starred.getAttribute("aria-pressed")).toBe("true");
    expect(titles(group("Designs"))).toEqual(["Spring flyer"]);
    expect(queryGroup("Folders")).toBeNull();
    expect(queryGroup("Images")).toBeNull();
    await user.click(starred);
    expect(titles(group("Designs"))).toHaveLength(3);
  });

  it("says no filter matches when the filters leave nothing", async () => {
    const user = userEvent.setup();
    await seedDesign({ title: "Plain", typeId: "logo" });
    mountProjects();
    await screen.findByRole("link", { name: "Plain" });
    await user.click(screen.getByRole("button", { name: "Starred" }));
    expect(screen.getByText("Nothing matches your filters")).toBeTruthy();
  });
});

describe("<ProjectsPage> view", () => {
  it("switches between grid and list and remembers the choice", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    const view = screen.getByRole("radiogroup", { name: "View" });
    expect(within(view).getByRole("radio", { name: "Grid view" }).getAttribute("aria-checked")).toBe("true");
    expect(document.querySelector(".cf-projects__listhead")).toBeNull();
    await user.click(within(view).getByRole("radio", { name: "List view" }));
    expect(document.querySelector(".cf-projects__listhead")).toBeTruthy();
    expect(localStorage.getItem(VIEW_KEY)).toBe("list");
    expect(group("Designs").querySelector(".cf-dcard--row")).toBeTruthy();
    await user.click(within(view).getByRole("radio", { name: "Grid view" }));
    expect(localStorage.getItem(VIEW_KEY)).toBe("grid");
  });

  it("starts in the view that was chosen before", async () => {
    localStorage.setItem(VIEW_KEY, "list");
    await seedDesign({ title: "Listed" });
    mountProjects();
    await screen.findByRole("link", { name: "Listed" });
    expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe("true");
  });

  it("works when the browser will not let it remember the view", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    await seedDesign({ title: "Listed" });
    mountProjects();
    await screen.findByRole("link", { name: "Listed" });
    await user.click(screen.getByRole("radio", { name: "List view" }));
    expect(screen.getByRole("radio", { name: "List view" }).getAttribute("aria-checked")).toBe("true");
  });
});

describe("<ProjectsPage> uploads and new things", () => {
  it("stores the chosen images, says so, and shows them on the Images tab", async () => {
    const user = userEvent.setup();
    const picker = stubFilePicker([imageFile("one.png"), imageFile("two.png")]);
    await seedDesign({ title: "A design" });
    mountProjects();
    await screen.findByRole("link", { name: "A design" });
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText("Uploaded 2 images")).toBeTruthy();
    expect(picker.lastMultiple()).toBe(true);
    expect((await listAssets()).map((asset) => asset.name).sort()).toEqual(["one", "two"]);
    await waitFor(() => expect(tab("Images").getAttribute("aria-selected")).toBe("true"));
    await waitFor(() => expect(imageNames().sort()).toEqual(["one", "two"])); // the list follows the library a moment after the write
  });

  it("does nothing when the file dialog is cancelled", async () => {
    const user = userEvent.setup();
    stubFilePicker([]);
    await seedDesign({ title: "A design" });
    mountProjects();
    await screen.findByRole("link", { name: "A design" });
    await user.click(screen.getByRole("button", { name: "Upload" }));
    await sleep(30);
    expect(await listAssets()).toEqual([]);
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
  });

  it("stays on the current tab when nothing could be stored", async () => {
    const user = userEvent.setup();
    stubFilePicker([new File(["x"], "notes.txt", { type: "text/plain" })]);
    await seedDesign({ title: "A design" });
    mountProjects();
    await screen.findByRole("link", { name: "A design" });
    await user.click(screen.getByRole("button", { name: "Upload" }));
    expect(await screen.findByText(/Couldn't upload notes\.txt/)).toBeTruthy();
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
  });

  it("uploads from the empty Images tab too", async () => {
    const user = userEvent.setup();
    stubFilePicker([imageFile("late.png")]);
    await seedDesign({ title: "A design" });
    mountProjects();
    await screen.findByRole("link", { name: "A design" });
    await user.click(tab("Images"));
    await user.click(screen.getByRole("button", { name: "Upload images" }));
    await waitFor(() => expect(imageNames()).toEqual(["late"]));
  });

  it("creates a folder from the header", async () => {
    const user = userEvent.setup();
    await seedDesign({ title: "A design" });
    mountProjects();
    await screen.findByRole("link", { name: "A design" });
    await user.click(screen.getAllByRole("button", { name: "Create folder" })[0]);
    const dialog = await screen.findByRole("dialog", { name: "Create folder" });
    await user.type(within(dialog).getByRole("textbox"), "Brand{Enter}");
    await waitFor(() => expect(titles(group("Folders"))).toEqual(["Brand"]));
  });

  it("opens the Create dialog from the header", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    await seedDesign({ title: "A design" });
    mountProjects();
    await screen.findByRole("link", { name: "A design" });
    await user.click(screen.getByRole("button", { name: "Create design" }));
    expect(dialog.result.current).toMatchObject({ open: true, folderId: null });
  });
});

describe("<ProjectsPage> inside a folder", () => {
  it("shows the folder's name, its path and only the designs inside it", async () => {
    const { logos } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("heading", { level: 1, name: "Logos" });
    const crumbs = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(within(crumbs).getByRole("link", { name: "Projects" }).getAttribute("href")).toBe("#/projects");
    expect(crumbs.querySelector("[aria-current=page]")?.textContent).toBe("Logos");
    expect(screen.getByText("1 design")).toBeTruthy();
    expect(titles(group("Designs"))).toEqual(["Logo draft"]);
    expect(queryGroup("Folders")).toBeNull();
    expect(queryGroup("Images")).toBeNull();
    expect(screen.getAllByRole("tab").map((el) => el.textContent)).toEqual(["All", "Designs"]);
  });

  it("searches only inside the folder", async () => {
    const user = userEvent.setup();
    const { logos } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("link", { name: "Logo draft" });
    await user.type(searchBox(), "flyer");
    expect(screen.getByText("Nothing matches “flyer”")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Spring flyer" })).toBeNull();
  });

  it("creates a design in the folder", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    const { logos } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("heading", { level: 1, name: "Logos" });
    await user.click(screen.getByRole("button", { name: "Create design" }));
    expect(dialog.result.current).toMatchObject({ open: true, folderId: logos.id });
  });

  it("says the folder is empty and offers to create a design in it", async () => {
    const user = userEvent.setup();
    const dialog = renderHook(() => useCreateDialog());
    const { campaign } = await seedLibrary();
    mountProjects(campaign.id);
    expect(await screen.findByText("This folder is empty")).toBeTruthy();
    await user.click(within(screen.getByText("This folder is empty").closest(".cf-empty") as HTMLElement).getByRole("button", { name: "Create design" }));
    expect(dialog.result.current).toMatchObject({ open: true, folderId: campaign.id });
  });

  it("renames the folder from its options menu", async () => {
    const user = userEvent.setup();
    const { campaign } = await seedLibrary();
    mountProjects(campaign.id);
    await screen.findByRole("heading", { level: 1, name: "Campaign A" });
    await user.click(screen.getByRole("button", { name: "Folder options" }));
    await user.click(screen.getByRole("menuitem", { name: "Rename folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Rename folder" });
    await user.clear(within(dialog).getByRole("textbox"));
    await user.type(within(dialog).getByRole("textbox"), "Campaign B{Enter}");
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "Campaign B" })).toBeTruthy());
  });

  it("deletes the folder from its options menu and goes back to Projects", async () => {
    const user = userEvent.setup();
    const { logos } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("heading", { level: 1, name: "Logos" });
    await user.click(screen.getByRole("button", { name: "Folder options" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    const dialog = await screen.findByRole("dialog", { name: "Delete “Logos”?" });
    await user.click(within(dialog).getByRole("button", { name: "Delete folder" }));
    await waitFor(() => expect(window.location.hash).toBe("#/projects"));
    expect((await listFolders()).map((folder) => folder.name)).toEqual(["Campaign A"]);
  });

  it("stays on the folder when deleting it is cancelled", async () => {
    const user = userEvent.setup();
    const { logos } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("heading", { level: 1, name: "Logos" });
    window.location.hash = `#/projects/${logos.id}`;
    await user.click(screen.getByRole("button", { name: "Folder options" }));
    await user.click(screen.getByRole("menuitem", { name: "Delete folder" }));
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    await sleep(30);
    expect(window.location.hash).toBe(`#/projects/${logos.id}`);
    expect(await listFolders()).toHaveLength(2);
  });

  it("says when the folder does not exist, with a way back", async () => {
    const user = userEvent.setup();
    await seedLibrary();
    mountProjects("f_gone");
    expect(await screen.findByText("This folder doesn't exist")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Folder not found" })).toBeTruthy();
    expect(screen.queryByRole("tablist")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Back to Projects" }));
    expect(window.location.hash).toBe("#/projects");
  });

  it("starts each folder with fresh filters", async () => {
    const user = userEvent.setup();
    const { logos, campaign } = await seedLibrary();
    await seedDesign({ title: "Campaign design", folderId: campaign.id });
    const view = render(
      <>
        <ProjectsPage folderId={logos.id} />
        <Hosts />
      </>,
    );
    await screen.findByRole("link", { name: "Logo draft" });
    await user.type(searchBox(), "logo");
    await user.click(screen.getByRole("button", { name: "Starred" }));
    view.rerender(
      <>
        <ProjectsPage folderId={campaign.id} />
        <Hosts />
      </>,
    );
    await screen.findByRole("link", { name: "Campaign design" });
    expect(searchBox().value).toBe("");
    expect(screen.getByRole("button", { name: "Starred" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("falls back to the All tab inside a folder, which has no Folders or Images tabs", async () => {
    const user = userEvent.setup();
    const { logos } = await seedLibrary();
    const view = render(
      <>
        <ProjectsPage />
        <Hosts />
      </>,
    );
    await screen.findByRole("link", { name: "Instagram teaser" });
    await user.click(tab("Images"));
    view.rerender(
      <>
        <ProjectsPage folderId={logos.id} />
        <Hosts />
      </>,
    );
    await screen.findByRole("heading", { level: 1, name: "Logos" });
    expect(tab("All").getAttribute("aria-selected")).toBe("true");
    expect(titles(group("Designs"))).toEqual(["Logo draft"]);
  });
});

describe("<ProjectsPage> moving designs by dragging", () => {
  const carrying = (id: string) => ({ types: [DESIGN_DRAG_TYPE], getData: (type: string) => (type === DESIGN_DRAG_TYPE ? id : ""), dropEffect: "" });

  it("files a design in the folder it is dropped on", async () => {
    const { campaign, insta } = await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    // the folders load on their own, so they can come after the designs
    const folderCard = (await screen.findByRole("link", { name: "Campaign A" })).closest("article") as HTMLElement;
    fireEvent.dragOver(folderCard, { dataTransfer: carrying(insta.id) });
    expect(folderCard.classList.contains("is-drop-target")).toBe(true);
    fireEvent.drop(folderCard, { dataTransfer: carrying(insta.id) });
    await waitFor(async () => expect((await getSummary(insta.id))?.folderId).toBe(campaign.id));
    expect(await screen.findByText("Moved to “Campaign A”")).toBeTruthy();
    await waitFor(() => expect(titles(group("Designs"))).not.toContain("Instagram teaser"));
  });

  it("makes design cards draggable", async () => {
    await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    const card = screen.getByRole("link", { name: "Instagram teaser" }).closest("article") as HTMLElement;
    expect(card.getAttribute("draggable")).toBe("true");
  });

  it("takes a design out of its folder when it is dropped on 'Projects' in the breadcrumb", async () => {
    const { logos, logo } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("link", { name: "Logo draft" });
    const crumb = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Projects" });
    fireEvent.dragOver(crumb, { dataTransfer: carrying(logo.id) });
    expect(crumb.classList.contains("is-drop-target")).toBe(true);
    fireEvent.drop(crumb, { dataTransfer: carrying(logo.id) });
    await waitFor(async () => expect((await getSummary(logo.id))?.folderId).toBeNull());
    expect(await screen.findByText("Moved to Projects")).toBeTruthy();
  });

  it("lets the breadcrumb ignore drags that are not designs, and stop lighting up when the drag leaves", async () => {
    const { logos, logo } = await seedLibrary();
    mountProjects(logos.id);
    await screen.findByRole("link", { name: "Logo draft" });
    const crumb = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Projects" });
    const files = { types: ["Files"], getData: () => "", dropEffect: "" };
    fireEvent.dragOver(crumb, { dataTransfer: files });
    expect(crumb.classList.contains("is-drop-target")).toBe(false);
    fireEvent.drop(crumb, { dataTransfer: files });
    fireEvent.dragOver(crumb, { dataTransfer: carrying(logo.id) });
    expect(crumb.classList.contains("is-drop-target")).toBe(true);
    fireEvent.dragLeave(crumb);
    expect(crumb.classList.contains("is-drop-target")).toBe(false);
    fireEvent.drop(crumb, { dataTransfer: carrying("") });
    await sleep(30);
    expect((await getSummary(logo.id))?.folderId).toBe(logos.id);
  });

  it("ignores a drop of a design that has since gone", async () => {
    const { campaign } = await seedLibrary();
    mountProjects();
    await screen.findByRole("link", { name: "Instagram teaser" });
    const folderCard = (await screen.findByRole("link", { name: "Campaign A" })).closest("article") as HTMLElement;
    fireEvent.drop(folderCard, { dataTransfer: carrying("d_missing") });
    await sleep(30);
    expect(document.querySelector(".cf-toast")).toBeNull();
    expect((await listDesigns()).every((design) => design.folderId !== campaign.id)).toBe(true);
  });

  it("takes no action for a design dropped on the breadcrumb of a folder that does not exist", async () => {
    const { logo, logos } = await seedLibrary();
    mountProjects("f_gone");
    await screen.findByText("This folder doesn't exist");
    const crumb = within(screen.getByRole("navigation", { name: "Breadcrumb" })).getByRole("link", { name: "Projects" });
    fireEvent.drop(crumb, { dataTransfer: carrying(logo.id) });
    await sleep(30);
    expect((await getSummary(logo.id))?.folderId).toBe(logos.id);
    expect(document.querySelector(".cf-toast")).toBeNull();
  });
});
