import { act, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getDesign, getSummary, listDesigns, moveToTrash } from "@/core/library";
import { Hosts, dismissOpenDialogs, emptyLibrary, resetDashboardStores, seedDesign } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { TrashPage } from "./TrashPage";

const DAY = 86_400_000;

function mountTrash() {
  return render(
    <>
      <TrashPage />
      <Hosts />
    </>,
  );
}

/** A design that was put in the trash `ago` milliseconds ago. */
async function trashed(title: string, ago = 5 * 60_000, over: Parameters<typeof seedDesign>[0] = {}) {
  const design = await seedDesign({ title, trashedAt: Date.now() - ago, ...over });
  return design;
}

const cards = () => screen.queryAllByRole("article");
const titlesOnScreen = () => cards().map((card) => card.querySelector(".cf-trash__title")?.textContent);

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
});

afterEach(async () => {
  vi.useRealTimers();
  await dismissOpenDialogs();
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<TrashPage>", () => {
  it("shows placeholders while the library is read", async () => {
    await trashed("Waiting");
    // a freshly loaded page has not read the library yet (the stores of this file already have)
    vi.resetModules();
    const { TrashPage: FreshTrashPage } = await import("./TrashPage");
    render(<FreshTrashPage />);
    expect(screen.getByLabelText("Loading the trash").getAttribute("aria-busy")).toBe("true");
    await waitFor(() => expect(screen.queryByLabelText("Loading the trash")).toBeNull());
    expect(await screen.findByText("Waiting")).toBeTruthy();
  });

  it("says the trash is empty, and has no Empty trash button", async () => {
    await seedDesign({ title: "Alive and well" });
    mountTrash();
    expect(await screen.findByText("The trash is empty")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 1, name: "Trash" })).toBeTruthy();
    // straight under the page title, so one level down from it
    expect(screen.getByRole("heading", { level: 2, name: "The trash is empty" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Empty trash" })).toBeNull();
    expect(screen.queryByText("Alive and well")).toBeNull();
  });

  it("lists the trashed designs, the most recently deleted first, with how long ago and what kind", async () => {
    // "1h ago" is worded by the calendar (only within one day): a fixed clock gives the same words at any hour
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(2026, 10, 5, 12, 0, 0));
    await trashed("Deleted long ago", 3 * DAY, { typeId: "poster" });
    await trashed("Deleted a moment ago", 30_000, { typeId: "logo" });
    await trashed("Deleted an hour ago", 3_600_000 + 60_000, { typeId: "flyer" });
    mountTrash();
    await waitFor(() => expect(cards()).toHaveLength(3));
    expect(titlesOnScreen()).toEqual(["Deleted a moment ago", "Deleted an hour ago", "Deleted long ago"]);
    expect(cards()[0].textContent).toContain("Logo · Deleted just now");
    expect(cards()[1].textContent).toContain("Flyer · Deleted 1h ago");
    expect(cards()[2].textContent).toContain("Poster · Deleted 3 days ago");
    expect(screen.getByText("3 designs in the trash")).toBeTruthy();
  });

  it("says '1 design' for a single one, and shows its thumbnail when it has one", async () => {
    await trashed("Only one", 60_000, { thumbnail: "data:image/jpeg;base64,AAAA" });
    mountTrash();
    expect(await screen.findByText("1 design in the trash")).toBeTruthy();
    expect(cards()[0].querySelector("img")?.getAttribute("src")).toBe("data:image/jpeg;base64,AAAA");
  });

  it("draws a placeholder for a design without a thumbnail", async () => {
    await trashed("No picture");
    mountTrash();
    await screen.findByText("No picture");
    expect(cards()[0].querySelector("img")).toBeNull();
    expect(cards()[0].querySelector(".cf-mock")).toBeTruthy();
  });

  it("leaves the designs that are not trashed out", async () => {
    await trashed("In the bin");
    await seedDesign({ title: "Still here" });
    mountTrash();
    await screen.findByText("In the bin");
    expect(screen.queryByText("Still here")).toBeNull();
  });

  describe("restoring", () => {
    it("brings a design back and offers to open it", async () => {
      const user = userEvent.setup();
      const design = await trashed("Bring me back");
      mountTrash();
      await screen.findByText("Bring me back");
      await user.click(screen.getByRole("button", { name: "Restore" }));
      await waitFor(async () => expect((await getSummary(design.id))?.trashedAt).toBeNull());
      expect(await screen.findByText("Restored “Bring me back”")).toBeTruthy();
      await waitFor(() => expect(screen.getByText("The trash is empty")).toBeTruthy());
      await user.click(screen.getByRole("button", { name: "Open" }));
      expect(window.location.hash).toBe(`#/design/${design.id}`);
    });
  });

  describe("deleting for good", () => {
    it("deletes one design after the user confirms", async () => {
      const user = userEvent.setup();
      const design = await trashed("Doomed");
      await trashed("Survivor", 10 * 60_000);
      mountTrash();
      await waitFor(() => expect(cards()).toHaveLength(2));
      const card = screen.getByText("Doomed").closest("article") as HTMLElement;
      await user.click(within(card).getByRole("button", { name: "Delete forever" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete “Doomed” forever?" });
      await user.click(within(dialog).getByRole("button", { name: "Delete forever" }));
      await waitFor(async () => expect(await getDesign(design.id)).toBeNull());
      await waitFor(() => expect(titlesOnScreen()).toEqual(["Survivor"]));
    });

    it("keeps the design when the user cancels", async () => {
      const user = userEvent.setup();
      const design = await trashed("Spared");
      mountTrash();
      await screen.findByText("Spared");
      await user.click(screen.getByRole("button", { name: "Delete forever" }));
      await user.click(await screen.findByRole("button", { name: "Cancel" }));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(await getDesign(design.id)).not.toBeNull();
    });

    it("empties the whole trash from the header after the user confirms", async () => {
      const user = userEvent.setup();
      await trashed("One");
      await trashed("Two", 10 * 60_000);
      const alive = await seedDesign({ title: "Alive" });
      mountTrash();
      await waitFor(() => expect(cards()).toHaveLength(2));
      await user.click(screen.getByRole("button", { name: "Empty trash" }));
      const dialog = await screen.findByRole("dialog", { name: "Empty the trash?" });
      expect(dialog.textContent).toContain("2 designs will be deleted forever");
      await user.click(within(dialog).getByRole("button", { name: "Empty trash" }));
      await waitFor(async () => expect((await listDesigns()).map((design) => design.id)).toEqual([alive.id]));
      expect(await screen.findByText("The trash is empty")).toBeTruthy();
    });
  });

  describe("right click", () => {
    it("opens Restore and Delete forever at the pointer", async () => {
      const user = userEvent.setup();
      const design = await trashed("Menu me");
      mountTrash();
      await screen.findByText("Menu me");
      fireEvent.contextMenu(cards()[0], { clientX: 30, clientY: 40 });
      const menu = await screen.findByRole("menu", { name: "Context menu" });
      expect(
        within(menu)
          .getAllByRole("menuitem")
          .map((item) => item.textContent),
      ).toEqual(["Restore", "Delete forever"]);
      await user.click(within(menu).getByRole("menuitem", { name: "Restore" }));
      await waitFor(async () => expect((await getSummary(design.id))?.trashedAt).toBeNull());
    });

    it("deletes forever from the menu", async () => {
      const user = userEvent.setup();
      const design = await trashed("Menu me");
      mountTrash();
      await screen.findByText("Menu me");
      fireEvent.contextMenu(cards()[0], { clientX: 30, clientY: 40 });
      await user.click(within(await screen.findByRole("menu", { name: "Context menu" })).getByRole("menuitem", { name: "Delete forever" }));
      const dialog = await screen.findByRole("dialog", { name: "Delete “Menu me” forever?" });
      await user.click(within(dialog).getByRole("button", { name: "Delete forever" }));
      await waitFor(async () => expect(await getDesign(design.id)).toBeNull());
    });
  });

  it("follows the library: a design trashed while the page is open appears", async () => {
    const design = await seedDesign({ title: "Trash me live" });
    mountTrash();
    await screen.findByText("The trash is empty");
    await moveToTrash(design.id);
    expect(await screen.findByText("Trash me live")).toBeTruthy();
  });
});
