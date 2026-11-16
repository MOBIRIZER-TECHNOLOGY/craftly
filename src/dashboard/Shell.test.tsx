import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesign, listDesigns } from "@/core/library";
import * as projectFile from "@/export/projectFile";
import { createDesign, createImage, createPage, createShape } from "@/core/factory";
import { exportProjectFile } from "@/export/projectFile";
import { buildProjectFile, serializeProjectFile } from "@/export/projectFormat";
import { Hosts, dismissOpenDialogs, emptyLibrary, seedDesign, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeProblemsDialog, useProblemsDialog } from "@/components/problemsDialogState";
import { closeCreateDialog, useCreateDialog } from "./createDialogState";
import { Shell, activeNav } from "./Shell";

const RAIL_KEY = "craftly:rail-expanded";

function mountShell(route: { name: string; id?: string } = { name: "home" }) {
  return render(
    <>
      <Shell route={route}>
        <p>the page</p>
      </Shell>
      <Hosts />
    </>,
  );
}

const railNav = () => screen.getAllByRole("navigation", { name: "Main" })[0];
const tabBar = () => screen.getAllByRole("navigation", { name: "Main" })[1];
const current = (nav: HTMLElement) => within(nav).queryByRole("link", { current: "page" })?.textContent;

beforeEach(async () => {
  await emptyLibrary();
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

describe("activeNav", () => {
  it("is the page of the route, or Home for a route that is not in the menu", () => {
    for (const name of ["home", "projects", "templates", "brand", "trash"]) expect(activeNav({ name })).toBe(name);
    expect(activeNav({ name: "design", id: "d_1" })).toBe("home");
    expect(activeNav({ name: "whatever" })).toBe("home");
  });
});

describe("<Shell>", () => {
  describe("navigation", () => {
    it("shows the page inside the main area", () => {
      mountShell();
      expect(within(screen.getByRole("main")).getByText("the page")).toBeTruthy();
    });

    it("lists the five pages in the rail and marks the one that is open", () => {
      mountShell({ name: "projects" });
      expect(
        within(railNav())
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Home", "Projects", "Templates", "Brand", "Trash"]);
      expect(current(railNav())).toBe("Projects");
      expect(within(railNav()).getByRole("link", { name: "Trash" }).getAttribute("href")).toBe("#/trash");
      expect(within(railNav()).getByRole("link", { name: "Home" }).getAttribute("href")).toBe("#/");
    });

    it("marks Home for a route outside the menu", () => {
      mountShell({ name: "design", id: "d_1" });
      expect(current(railNav())).toBe("Home");
    });

    it("tells the page layout which page is open", () => {
      const { container } = mountShell({ name: "brand" });
      expect(container.querySelector(".cf-dash")?.getAttribute("data-route")).toBe("brand");
    });

    it("has a tab bar for phones with four pages and a Create button between them", () => {
      mountShell({ name: "templates" });
      expect(
        within(tabBar())
          .getAllByRole("link")
          .map((link) => link.textContent),
      ).toEqual(["Home", "Projects", "Templates", "Brand"]);
      expect(current(tabBar())).toBe("Templates");
      expect(within(tabBar()).getByRole("button", { name: "Create a design" })).toBeTruthy();
    });

    it("links the logo in the phone header to Home", () => {
      mountShell();
      expect(screen.getByRole("link", { name: "Craftly home" }).getAttribute("href")).toBe("#/");
    });

    it("scrolls the page back to the top when the route changes", () => {
      const scrollTo = vi.spyOn(HTMLElement.prototype, "scrollTo").mockImplementation(() => undefined);
      const { rerender } = mountShell({ name: "home" });
      scrollTo.mockClear();
      rerender(
        <>
          <Shell route={{ name: "projects" }}>
            <p>the page</p>
          </Shell>
          <Hosts />
        </>,
      );
      expect(scrollTo).toHaveBeenCalledWith({ top: 0 });
    });
  });

  describe("the rail", () => {
    it("starts collapsed and expands from its toggle, remembering the choice", async () => {
      const user = userEvent.setup();
      const { container } = mountShell();
      const toggle = screen.getByRole("button", { name: "Expand sidebar" });
      expect(toggle.getAttribute("aria-expanded")).toBe("false");
      expect(container.querySelector(".cf-dash")?.classList.contains("is-rail-expanded")).toBe(false);
      await user.click(toggle);
      const collapse = screen.getByRole("button", { name: "Collapse sidebar" });
      expect(collapse.getAttribute("aria-expanded")).toBe("true");
      expect(container.querySelector(".cf-dash")?.classList.contains("is-rail-expanded")).toBe(true);
      expect(within(railNav()).getByText("Craftly")).toBeTruthy();
      expect(localStorage.getItem(RAIL_KEY)).toBe("1");
      await user.click(collapse);
      expect(localStorage.getItem(RAIL_KEY)).toBe("0");
      expect(screen.getByRole("button", { name: "Expand sidebar" })).toBeTruthy();
    });

    it("starts expanded when the choice was made before", () => {
      localStorage.setItem(RAIL_KEY, "1");
      mountShell();
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
    });

    it("still works when the browser will not let it remember the choice", async () => {
      const user = userEvent.setup();
      vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("blocked");
      });
      mountShell();
      await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
      expect(screen.getByRole("button", { name: "Collapse sidebar" })).toBeTruthy();
    });

    it("opens the Create dialog from the narrow rail, the wide rail and the tab bar", async () => {
      const user = userEvent.setup();
      const dialog = renderHook(() => useCreateDialog());
      mountShell();
      await user.click(within(railNav()).getByRole("button", { name: "Create a design" }));
      expect(dialog.result.current.open).toBe(true);
      act(() => closeCreateDialog());
      await user.click(within(tabBar()).getByRole("button", { name: "Create a design" }));
      expect(dialog.result.current.open).toBe(true);
      act(() => closeCreateDialog());
      await user.click(screen.getByRole("button", { name: "Expand sidebar" }));
      await user.click(within(railNav()).getByRole("button", { name: "Create a design" }));
      expect(dialog.result.current.open).toBe(true);
      expect(dialog.result.current.tab).toBe("for-you");
    });
  });

  describe("the account menu", () => {
    it("lists the things that are stored on this device", async () => {
      const user = userEvent.setup();
      mountShell();
      await user.click(within(railNav()).getByRole("button", { name: "Account" }));
      const menu = screen.getByRole("menu", { name: "Account" });
      expect(within(menu).getByText("On this device")).toBeTruthy();
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Import project file", "Back up & restore", "Report a problem", "About Craftly", "LanguageEnglish"]);
    });

    it("offers the languages of the interface, each in its own language, with the one in use checked", async () => {
      const user = userEvent.setup();
      mountShell();
      await user.click(within(railNav()).getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("menuitem", { name: /Language/ }));
      const english = await screen.findByRole("menuitemcheckbox", { name: "English" });
      expect(english.getAttribute("aria-checked")).toBe("true");
      expect(screen.getByRole("menuitemcheckbox", { name: "हिन्दी" }).getAttribute("aria-checked")).toBe("false");
    });

    it("also offers Trash in the phone header, where the tab bar has no room for it", async () => {
      const user = userEvent.setup();
      mountShell();
      const [, phoneAccount] = screen.getAllByRole("button", { name: "Account" });
      await user.click(phoneAccount);
      const menu = screen.getByRole("menu", { name: "Account" });
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Import project file", "Back up & restore", "Trash", "Report a problem", "About Craftly", "LanguageEnglish"]);
      await user.click(within(menu).getByRole("menuitem", { name: "Trash" }));
      expect(window.location.hash).toBe("#/trash");
    });

    it("uses the wide account button when the rail is expanded", async () => {
      const user = userEvent.setup();
      localStorage.setItem(RAIL_KEY, "1");
      mountShell();
      const wide = within(railNav()).getByRole("button", { name: /^You/ });
      expect(wide.getAttribute("aria-haspopup")).toBe("menu");
      expect(wide.getAttribute("aria-expanded")).toBe("false");
      await user.click(wide);
      expect(wide.getAttribute("aria-expanded")).toBe("true");
      expect(screen.getByRole("menu", { name: "Account" })).toBeTruthy();
    });

    it("opens the Report a problem dialog", async () => {
      const user = userEvent.setup();
      mountShell();
      await user.click(within(railNav()).getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("menuitem", { name: "Report a problem" }));
      expect(useProblemsDialog.getState().open).toBe(true);
      act(() => closeProblemsDialog());
    });

    it("opens the About dialog", async () => {
      const user = userEvent.setup();
      mountShell();
      await user.click(within(railNav()).getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("menuitem", { name: "About Craftly" }));
      expect(await screen.findByRole("dialog", { name: "About Craftly" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("opens the Back up & restore dialog, and closes it again", async () => {
      const user = userEvent.setup();
      mountShell();
      await user.click(within(railNav()).getByRole("button", { name: "Account" }));
      await user.click(screen.getByRole("menuitem", { name: "Back up & restore" }));
      expect(await screen.findByRole("dialog", { name: "Back up & restore" })).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Close" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("opens it from the phone header too, and again after it was closed", async () => {
      const user = userEvent.setup();
      mountShell();
      for (let visit = 0; visit < 2; visit += 1) {
        const [, phoneAccount] = screen.getAllByRole("button", { name: "Account" });
        await user.click(phoneAccount);
        await user.click(within(screen.getByRole("menu", { name: "Account" })).getByRole("menuitem", { name: "Back up & restore" }));
        expect(await screen.findByRole("dialog", { name: "Back up & restore" })).toBeTruthy();
        await user.click(screen.getByRole("button", { name: "Close" }));
        await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      }
    });

    describe("importing a project file", () => {
      async function projectFileOf(title: string) {
        const design = await seedDesign({ title });
        const blob = await exportProjectFile((await getDesign(design.id))!);
        return new File([blob], `${title}.craftly`, { type: "application/json" });
      }

      async function chooseImport(user: ReturnType<typeof userEvent.setup>) {
        await user.click(within(railNav()).getByRole("button", { name: "Account" }));
        await user.click(screen.getByRole("menuitem", { name: "Import project file" }));
      }

      it("saves the design under a new id, says so, and opens it", async () => {
        const user = userEvent.setup();
        const file = await projectFileOf("Travelled");
        await emptyLibrary();
        const picker = stubFilePicker([file]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText("Imported “Travelled”")).toBeTruthy();
        expect(picker.lastAccept()).toBe(".craftly,.json,application/json");
        const [imported] = await listDesigns();
        expect(imported.title).toBe("Travelled");
        expect(window.location.hash).toBe(`#/design/${imported.id}`);
      });

      it("does nothing when the file dialog is cancelled", async () => {
        const user = userEvent.setup();
        stubFilePicker([]);
        mountShell();
        await chooseImport(user);
        await new Promise((resolve) => setTimeout(resolve, 30));
        expect(await listDesigns()).toEqual([]);
        expect(document.querySelector(".cf-toast")).toBeNull();
        expect(window.location.hash).toBe("");
      });

      it("explains that a file that is not a project cannot be opened", async () => {
        const user = userEvent.setup();
        stubFilePicker([new File(["this is not json"], "notes.craftly", { type: "application/json" })]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText(/^Couldn't import that file\./)).toBeTruthy();
        expect(await listDesigns()).toEqual([]);
        expect(window.location.hash).toBe("");
      });

      it("says what is wrong with the file in the file's own words", async () => {
        const user = userEvent.setup();
        stubFilePicker([new File(["this is not json"], "notes.craftly", { type: "application/json" })]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText("Couldn't import that file. That does not look like a Craftly project file")).toBeTruthy();
      });

      it("does not show the browser's own words when the design cannot be stored", async () => {
        const user = userEvent.setup();
        vi.spyOn(projectFile, "importProjectFile").mockRejectedValueOnce(new Error("Failed to execute 'put' on 'IDBObjectStore': Maximum call stack size exceeded"));
        stubFilePicker([new File(["{}"], "x.craftly")]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText("Couldn't import that file. It could not be saved on this device. Check that your browser has free storage and try again.")).toBeTruthy();
        expect(screen.queryByText(/IDBObjectStore/)).toBeNull();
      });

      it("says when pictures that pointed to the web were taken out", async () => {
        const user = userEvent.setup();
        const design = createDesign({
          width: 800,
          height: 600,
          title: "Tracked",
          pages: [createPage({ elements: [createImage({ src: "https://tracker.example/pixel.png", width: 10, height: 10 })] })],
        });
        stubFilePicker([new File([serializeProjectFile(buildProjectFile(design, {}))], "tracked.craftly", { type: "application/json" })]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText("Imported “Tracked”. 1 picture that pointed to the web was taken out.")).toBeTruthy();
        const [imported] = await listDesigns();
        expect(JSON.stringify(await getDesign(imported.id))).not.toContain("tracker.example");
      });

      it("says when comments of the file could not be read, and keeps those that could", async () => {
        const user = userEvent.setup();
        const page = createPage({ id: "p" });
        const good = { id: "c_ok", pageId: "p", anchor: { x: 1, y: 2 }, author: { name: "Ann", colorIndex: 1 }, createdAt: 1, text: "Keep me", resolved: false, replies: [] };
        const design = {
          ...createDesign({ width: 800, height: 600, title: "Noted", pages: [page] }),
          comments: [good, { ...good, id: "c bad" }, { ...good, id: "c_gone", pageId: "gone" }],
        };
        stubFilePicker([new File([serializeProjectFile(buildProjectFile(design, {}))], "noted.craftly", { type: "application/json" })]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText("Imported “Noted”. 2 comments in the file could not be read and were left out.")).toBeTruthy();
        const [imported] = await listDesigns();
        expect((await getDesign(imported.id))?.comments?.map((c) => c.id)).toEqual(["c_ok"]);
      });

      it("says how many items of the file were left out", async () => {
        const user = userEvent.setup();
        const design = createDesign({ width: 800, height: 600, title: "Patchy", pages: [createPage({ elements: [createShape("rect")] })] });
        const raw = JSON.parse(serializeProjectFile(buildProjectFile(design, {})));
        raw.design.pages[0].elements.push({ id: "x1", type: "hologram" }, { id: "x2", type: "hologram" });
        stubFilePicker([new File([JSON.stringify(raw)], "patchy.craftly", { type: "application/json" })]);
        mountShell();
        await chooseImport(user);
        expect(await screen.findByText("Imported “Patchy”. 2 items in the file could not be read and were left out.")).toBeTruthy();
        const [imported] = await listDesigns();
        expect(window.location.hash).toBe(`#/design/${imported.id}`);
      });
    });
  });
});
