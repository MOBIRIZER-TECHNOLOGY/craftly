import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage } from "@/core/factory";
import { useEditor } from "@/core/store";
import { createFolder, deleteFolder, listDesigns, listFolders, saveDesign } from "@/core/library";
import type { Design, Folder } from "@/core/types";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { mountPanels } from "@/test/tabsHarness";

/* The real library (fake IndexedDB), wrapped so a test can hold back the first read or make a folder fail. */
vi.mock("@/core/library", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/core/library")>();
  return { ...real, listDesigns: vi.fn(real.listDesigns), createFolder: vi.fn(real.createFolder) };
});

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

let seq = 0;
function design(over: Partial<Omit<Design, "pages">> & { pages?: number } = {}): Design {
  const { pages = 1, ...rest } = over;
  const d = createDesign({
    title: rest.title ?? `Design ${++seq}`,
    typeId: rest.typeId ?? "custom",
    width: 1280,
    height: 720,
    pages: Array.from({ length: pages }, (_, i) => createPage({ name: `Page ${i + 1}` })),
  });
  return { ...d, ...rest, id: rest.id ?? d.id };
}

/** Saves the designs and folders and mounts the Projects tab on the first design (the one that is open). */
async function openProjects(designs: Array<Design | [Design, string]>, folders: string[] = []) {
  const saved: Design[] = [];
  for (const [i, entry] of designs.entries()) {
    const [d, thumb] = Array.isArray(entry) ? entry : [entry, undefined];
    // the list is newest first: each design was changed a second after the one before it
    await saveDesign({ ...d, updatedAt: 1_700_000_000_000 + i * 1000 }, thumb);
    saved.push(d);
  }
  const made: Folder[] = [];
  for (const name of folders) made.push(await createFolder(name));
  const user = userEvent.setup();
  mountPanels({ tab: "projects", design: saved[0] ?? design() });
  await screen.findByRole("searchbox", { name: "Search your content" });
  return { user, saved, folders: made };
}

const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const designNames = () => Array.from(document.querySelectorAll(".cf-proj__title")).map((n) => n.textContent);
const folderNames = () => Array.from(document.querySelectorAll(".cf-proj__folder-name")).map((n) => n.firstChild?.textContent ?? n.textContent);

afterEach(() => {
  window.location.hash = "";
});

describe("Projects tab", () => {
  it("gives the selected Show tab a panel to control, named by that tab, and follows the tab that is chosen", async () => {
    const { user } = await openProjects([design({ title: "Here" })], ["Campaign"]);
    await screen.findByText("Here");
    const selected = () => within(screen.getByRole("tablist", { name: "Show" })).getByRole("tab", { selected: true });
    const panelOf = (tab: HTMLElement) => document.getElementById(tab.getAttribute("aria-controls") ?? "");

    expect(selected().textContent).toBe("All");
    expect(panelOf(selected())?.getAttribute("role")).toBe("tabpanel");
    expect(panelOf(selected())?.getAttribute("aria-labelledby")).toBe(selected().id);
    expect(within(panelOf(selected())!).getByText("Here")).toBeTruthy();

    await user.click(screen.getByRole("tab", { name: "Folders" }));
    expect(selected().textContent).toBe("Folders");
    expect(panelOf(selected())?.getAttribute("role")).toBe("tabpanel");
    expect(panelOf(selected())?.getAttribute("aria-labelledby")).toBe(selected().id);
    expect(within(panelOf(selected())!).getByText("Campaign")).toBeTruthy();
  });

  describe("designs", () => {
    it("lists the saved designs, newest first, with their size, page count and star", async () => {
      await openProjects([
        design({ title: "Quarterly deck", typeId: "presentation", pages: 3 }),
        design({ title: "Summer flyer", typeId: "flyer", starred: true }),
        design({ title: "Odd size" }),
      ]);
      await screen.findByText("Odd size");
      expect(designNames()).toEqual(["Odd size", "Summer flyer", "Quarterly deck"]);
      const subs = Array.from(document.querySelectorAll(".cf-proj__sub")).map((n) => n.textContent);
      expect(subs).toEqual(["Custom size", "Flyer", "Presentation - 3 pages"]);
      expect(screen.getAllByLabelText("Starred")).toHaveLength(1);
      expect(within(screen.getByRole("button", { name: "Open Summer flyer" })).getByLabelText("Starred")).toBeTruthy();
    });

    it("shows a thumbnail when the design has one", async () => {
      // the first design is the one that is open
      await openProjects([design({ title: "Without" }), [design({ title: "With picture" }), "data:image/png;base64,AAAA"]]);
      const withPicture = await screen.findByRole("button", { name: "Open With picture" });
      expect(withPicture.querySelector("img")?.getAttribute("src")).toBe("data:image/png;base64,AAAA");
      expect(screen.getByRole("button", { name: "Without (open now)" }).querySelector("img")).toBeNull();
    });

    it("marks the design that is open and does not reopen it", async () => {
      const user = userEvent.setup();
      const open = design({ title: "Open one" });
      const other = design({ title: "Other one" });
      await openProjects([open, other]);
      const current = await screen.findByRole("button", { name: "Open one (open now)" });
      expect(current.getAttribute("aria-disabled")).toBe("true");
      expect(within(current).getByText("Open now")).toBeTruthy();
      await user.click(current);
      expect(window.location.hash).toBe("");
      expect(screen.getByRole("button", { name: "Open Other one" }).getAttribute("aria-disabled")).toBeNull();
    });

    it("lets every design be opened once none is open", async () => {
      await openProjects([design({ title: "Here" }), design({ title: "There" })]);
      await screen.findByRole("button", { name: "Here (open now)" });
      act(() => useEditor.getState().actions.closeDesign());
      expect(await screen.findByRole("button", { name: "Open Here" })).toBeTruthy();
      expect(screen.queryByText("Open now")).toBeNull();
    });

    it("hides designs in the trash", async () => {
      await openProjects([design({ title: "Kept" }), design({ title: "Binned", trashedAt: Date.now() })]);
      await screen.findByText("Kept");
      expect(designNames()).toEqual(["Kept"]);
    });

    it("saves the open design and goes to the design that is clicked", async () => {
      const saveNow = vi.fn();
      window.addEventListener("craftly:save-now", saveNow);
      try {
        const { user, saved } = await openProjects([design({ title: "First" }), design({ id: "second-id", title: "Second" })]);
        await user.click(await screen.findByRole("button", { name: "Open Second" }));
        expect(saveNow).toHaveBeenCalledTimes(1);
        expect(window.location.hash).toBe("#/design/second-id");
        expect(saved).toHaveLength(2);
      } finally {
        window.removeEventListener("craftly:save-now", saveNow);
      }
    });

    it("opens a design from the keyboard", async () => {
      const { user } = await openProjects([design({ title: "First" }), design({ id: "kb-id", title: "Keyboard" })]);
      (await screen.findByRole("button", { name: "Open Keyboard" })).focus();
      await user.keyboard("{Enter}");
      expect(window.location.hash).toBe("#/design/kb-id");
    });

    it("holds placeholders until the library has been read", async () => {
      let release!: (list: Awaited<ReturnType<typeof listDesigns>>) => void;
      vi.mocked(listDesigns).mockImplementationOnce(() => new Promise((resolve) => (release = resolve)));
      mountPanels({ tab: "projects", design: design() });
      await screen.findByRole("searchbox", { name: "Search your content" });
      expect(section("Designs").querySelectorAll(".cf-skeleton")).toHaveLength(2);
      await act(async () => release([]));
      expect(await screen.findByText("No saved designs yet")).toBeTruthy();
      expect(section("Designs").querySelectorAll(".cf-skeleton")).toHaveLength(0);
    });

    it("says there is nothing saved yet", async () => {
      await openProjects([]);
      expect(await screen.findByText("No saved designs yet")).toBeTruthy();
      expect(screen.getByText("Your designs are saved automatically and show up here.")).toBeTruthy();
    });
  });

  describe("creating a new design", () => {
    it("saves this one, leaves a note for the dashboard and goes home", async () => {
      const saveNow = vi.fn();
      window.addEventListener("craftly:save-now", saveNow);
      try {
        const { user } = await openProjects([design({ title: "Here" })]);
        window.location.hash = "#/design/here";
        await user.click(screen.getByRole("button", { name: "Create new design" }));
        expect(sessionStorage.getItem("craftly:open-create")).toBe("1");
        expect(saveNow).toHaveBeenCalledTimes(1);
        expect(window.location.hash).toBe("#/");
      } finally {
        window.removeEventListener("craftly:save-now", saveNow);
      }
    });

    it("still goes home when the browser will not keep the note", async () => {
      const { user } = await openProjects([design({ title: "Here" })]);
      window.location.hash = "#/design/here";
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("storage is off");
      });
      await user.click(screen.getByRole("button", { name: "Create new design" }));
      expect(window.location.hash).toBe("#/");
    });
  });

  describe("views", () => {
    it("shows designs and folders under All, only designs, or only folders", async () => {
      const { user } = await openProjects([design({ title: "Alpha" })], ["Clients"]);
      await screen.findByText("Alpha");
      expect(screen.getByRole("tab", { name: "All" }).getAttribute("aria-selected")).toBe("true");
      expect(screen.getByRole("heading", { name: "Designs" })).toBeTruthy();
      expect(screen.getByRole("heading", { name: "Folders" })).toBeTruthy();

      await user.click(screen.getByRole("tab", { name: "Designs" }));
      expect(screen.getByRole("heading", { name: "Designs" })).toBeTruthy();
      expect(screen.queryByRole("heading", { name: "Folders" })).toBeNull();

      await user.click(screen.getByRole("tab", { name: "Folders" }));
      expect(screen.queryByRole("heading", { name: "Designs" })).toBeNull();
      expect(screen.getByRole("heading", { name: "Folders" })).toBeTruthy();
      expect(folderNames()).toEqual(["Create folder", "Starred", "Clients"]);
    });
  });

  describe("searching", () => {
    it("filters designs and folders by name, ignoring case", async () => {
      const { user } = await openProjects([design({ title: "Birthday card" }), design({ title: "Annual report" })], ["Birthdays", "Work"]);
      await screen.findByText("Birthday card");
      await user.type(screen.getByRole("searchbox"), "BIRTH");
      await waitFor(() => expect(designNames()).toEqual(["Birthday card"]));
      expect(folderNames()).toEqual(["Create folder", "Birthdays"]);
    });

    it("hides the Starred folder unless the search is part of its name", async () => {
      const { user } = await openProjects([design({ title: "Starry night", starred: true })]);
      await screen.findByText("Starry night");
      expect(folderNames()).toContain("Starred");
      await user.type(screen.getByRole("searchbox"), "star");
      await waitFor(() => expect(folderNames()).toContain("Starred"));
      await user.clear(screen.getByRole("searchbox"));
      await user.type(screen.getByRole("searchbox"), "night");
      await waitFor(() => expect(folderNames()).not.toContain("Starred"));
    });

    it("says when no design matches", async () => {
      const { user } = await openProjects([design({ title: "Something" })]);
      await screen.findByText("Something");
      await user.type(screen.getByRole("searchbox"), "ZZZ");
      expect(await screen.findByText("No designs found")).toBeTruthy();
      expect(screen.getByText('No design title contains "zzz".')).toBeTruthy();
    });
  });

  describe("folders", () => {
    it("counts the starred designs, in the singular too", async () => {
      await openProjects([design({ title: "One", starred: true })]);
      await screen.findByText("One");
      expect(screen.getByRole("button", { name: /Starred/ }).textContent).toBe("Starred1 design");
    });

    it("counts several starred designs and none", async () => {
      await openProjects([design({ title: "A", starred: true }), design({ title: "B", starred: true })]);
      await screen.findByText("A");
      expect(screen.getByRole("button", { name: /Starred/ }).textContent).toBe("Starred2 designs");
    });

    describe("making one", () => {
      async function startFolder() {
        const ctx = await openProjects([design({ title: "Anything" })]);
        await ctx.user.click(screen.getByRole("button", { name: "Create folder" }));
        const field = (await screen.findByRole("textbox", { name: "Folder name" })) as HTMLInputElement;
        return { ...ctx, field };
      }

      it("takes the name typed and adds the folder", async () => {
        const { user, field } = await startFolder();
        expect(document.activeElement).toBe(field);
        await user.type(field, "Client work{Enter}");
        expect(await screen.findByText('Folder "Client work" created')).toBeTruthy();
        await waitFor(() => expect(folderNames()).toContain("Client work"));
        expect(screen.queryByRole("textbox", { name: "Folder name" })).toBeNull();
        expect((await listFolders()).map((f) => f.name)).toEqual(["Client work"]);
      });

      it("makes the folder when the field loses focus", async () => {
        const { user, field } = await startFolder();
        await user.type(field, "On blur");
        await user.click(document.body);
        await waitFor(async () => expect((await listFolders()).map((f) => f.name)).toEqual(["On blur"]));
      });

      it("cancels on Escape", async () => {
        const { user, field } = await startFolder();
        await user.type(field, "Never made{Escape}");
        expect(screen.queryByRole("textbox", { name: "Folder name" })).toBeNull();
        expect(await listFolders()).toEqual([]);
      });

      it("makes nothing from an empty name", async () => {
        const { user, field } = await startFolder();
        await user.type(field, "   {Enter}");
        expect(screen.queryByRole("textbox", { name: "Folder name" })).toBeNull();
        expect(await listFolders()).toEqual([]);
        expect(screen.queryByRole("status")).toBeNull();
      });

      it("says so when the folder cannot be made", async () => {
        const { user, field } = await startFolder();
        vi.mocked(createFolder).mockRejectedValueOnce(new Error("disk full"));
        await user.type(field, "Doomed{Enter}");
        expect(await screen.findByText("The folder could not be created.")).toBeTruthy();
        expect(await listFolders()).toEqual([]);
      });
    });

    describe("opening one", () => {
      async function withFolder() {
        const clients = design({ title: "Client logo", folderId: null });
        const loose = design({ title: "Loose design" });
        const ctx = await openProjects([loose, clients], ["Clients"]);
        const folder = ctx.folders[0];
        // put one design into the folder
        const { moveToFolder } = await import("@/core/library");
        await moveToFolder(clients.id, folder.id);
        return { ...ctx, folder, clients, loose };
      }

      it("shows only the designs inside, with a way back", async () => {
        const { user } = await withFolder();
        await user.click(await screen.findByRole("button", { name: "Clients" }));
        expect(screen.getByRole("heading", { name: "Clients" })).toBeTruthy();
        expect(await screen.findByText("1 design")).toBeTruthy();
        await waitFor(() => expect(designNames()).toEqual(["Client logo"]));
        // inside a folder there are no view tabs and no folder list
        expect(screen.queryByRole("tab", { name: "Folders" })).toBeNull();
        expect(screen.queryByRole("heading", { name: "Folders" })).toBeNull();

        await user.click(screen.getByRole("button", { name: "Back to all projects" }));
        expect(await screen.findByRole("tab", { name: "All" })).toBeTruthy();
        expect(designNames()).toContain("Loose design");
      });

      it("shows the starred designs together", async () => {
        const { user } = await openProjects([design({ title: "Plain" }), design({ title: "Shiny", starred: true })]);
        await screen.findByText("Shiny");
        await user.click(screen.getByRole("button", { name: /Starred/ }));
        expect(screen.getByRole("heading", { name: "Starred" })).toBeTruthy();
        expect(designNames()).toEqual(["Shiny"]);
        expect(screen.getByText("1 design")).toBeTruthy();
      });

      it("says when a folder is empty", async () => {
        const { user } = await openProjects([design({ title: "Anything" })], ["Empty one"]);
        await user.click(await screen.findByRole("button", { name: "Empty one" }));
        expect(await screen.findByText("Nothing in here yet")).toBeTruthy();
        expect(screen.getByText("Move designs into this folder from the dashboard.")).toBeTruthy();
        expect(screen.getByText("0 designs")).toBeTruthy();
      });

      it("searches inside the folder", async () => {
        const { user } = await withFolder();
        await user.click(await screen.findByRole("button", { name: "Clients" }));
        await user.type(screen.getByRole("searchbox"), "nothing like it");
        expect(await screen.findByText("No designs found")).toBeTruthy();
      });

      it("calls a folder that was deleted meanwhile just 'Folder'", async () => {
        const { user, folder } = await withFolder();
        await user.click(await screen.findByRole("button", { name: "Clients" }));
        await screen.findByRole("heading", { name: "Clients" });
        await act(async () => deleteFolder(folder.id));
        expect(await screen.findByRole("heading", { name: "Folder" })).toBeTruthy();
      });
    });
  });

  it("adds a design that is saved while the tab is open", async () => {
    await openProjects([design({ title: "First" })]);
    await screen.findByText("First");
    await act(async () => saveDesign(design({ title: "Added later" })));
    await waitFor(() => expect(designNames()).toContain("Added later"));
    expect(designNames()).toContain("First");
  });
});
