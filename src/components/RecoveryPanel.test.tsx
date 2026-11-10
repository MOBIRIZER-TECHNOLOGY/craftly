/** The ways back for a design that cannot be used: the earlier versions to put back, and a copy of the design to save to a file. */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import * as library from "@/core/library";
import { getDesign, listVersions, saveDesign, saveVersion } from "@/core/library";
import { downloadBlob } from "@/export/download";
import { wipeDatabase } from "@/test/logicDb";
import { clearToasts } from "@/test/tabsHarness";
import { ToastHost } from "@/ui";
import { RecoveryPanel } from "./RecoveryPanel";

vi.mock("@/export/download", () => ({ downloadBlob: vi.fn() }));

const reload = vi.fn();
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

beforeEach(async () => {
  await wipeDatabase();
  clearToasts();
  reload.mockReset();
  vi.mocked(downloadBlob).mockClear();
  vi.stubGlobal("location", { ...window.location, reload });
});

const storedDesign = async (elements = 2, title = "Poster") => {
  const design = createDesign({
    title,
    width: 800,
    height: 600,
    pages: [createPage({ elements: Array.from({ length: elements }, () => createShape("rect", { width: 5, height: 5 })) })],
  });
  await saveDesign(design);
  return design;
};

const show = (designId: string, open = true) =>
  render(
    <>
      <RecoveryPanel designId={designId} open={open} />
      <ToastHost />
    </>,
  );

const folded = () => screen.getByText("Go back to an earlier version").closest("details")!;

describe("<RecoveryPanel>", () => {
  it("is open or folded away as it is told: somebody who cannot open the design has no use for a folded section", async () => {
    const design = await storedDesign();
    show(design.id, true);
    expect(folded().open).toBe(true);
    show(design.id, false);
    expect(screen.getAllByText("Go back to an earlier version").map((summary) => summary.closest("details")!.open)).toEqual([true, false]);
  });

  it("says that it is looking, and then lists the earlier versions of this design, newest first, with where each came from", async () => {
    const design = await storedDesign(3);
    await saveVersion(design, "Before the problem");
    await tick();
    await saveVersion({ ...design, updatedAt: design.updatedAt + 1 });
    const another = await storedDesign(1, "Another design");
    await saveVersion(another, "Before going back"); // not this design's: not listed
    show(design.id);
    expect(screen.getByText("Looking for earlier versions…")).toBeTruthy();
    const rows = await screen.findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain("Saved automatically");
    expect(rows[1].textContent).toContain("Before the problem");
  });

  it("says that there is nothing to go back to when there are no versions, and still offers a copy", async () => {
    const design = await storedDesign();
    show(design.id);
    expect(await screen.findByText("There are no earlier versions of this design yet.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Save a copy of the design to a file" })).toBeTruthy();
  });

  it("says the same, and goes on, when the library cannot be read", async () => {
    const versions = vi.spyOn(library, "listVersions").mockRejectedValueOnce(new Error("The library is not available"));
    try {
      const design = await storedDesign();
      show(design.id);
      expect(await screen.findByText("There are no earlier versions of this design yet.")).toBeTruthy();
    } finally {
      versions.mockRestore();
    }
  });

  it("puts the chosen version in the design and reloads", async () => {
    const user = userEvent.setup();
    const design = await storedDesign(3);
    await saveVersion(design, "Before the problem");
    await saveDesign({ ...design, pages: [createPage({ elements: [createShape("ellipse", { width: 4, height: 4 })] })], updatedAt: design.updatedAt + 9_000 });
    show(design.id);
    await user.click(await screen.findByRole("button", { name: "Use this version" }));
    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect((await getDesign(design.id))!.pages[0].elements).toHaveLength(3);
    expect((await listVersions(design.id)).map((v) => v.label)).toContain("Before going back");
  });

  it("says so, and does not reload, when the version could not be put back", async () => {
    const user = userEvent.setup();
    const design = await storedDesign();
    await saveVersion(design, "Before the problem");
    show(design.id);
    const button = await screen.findByRole("button", { name: "Use this version" });
    await wipeDatabase(); // the version is gone by the time it is chosen
    await user.click(button);
    expect(await screen.findByText("That version could not be restored. Try another one.")).toBeTruthy();
    expect(reload).not.toHaveBeenCalled();
    expect((button as HTMLButtonElement).disabled).toBe(false); // another one can be tried
  });

  it("saves a copy of the design to a file, without opening it", async () => {
    const user = userEvent.setup();
    const design = await storedDesign();
    show(design.id);
    await user.click(await screen.findByRole("button", { name: "Save a copy of the design to a file" }));
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toMatch(/^Poster.*\.craftly$/);
    expect(JSON.parse(await blob.text()).design.title).toBe("Poster");
    expect(await screen.findByText("Saved a copy of the design")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save a copy of the design to a file" }) as HTMLButtonElement).disabled).toBe(false); // and another copy can be made
  });

  it("says so when the copy could not be saved", async () => {
    const user = userEvent.setup();
    show("not-stored");
    await user.click(await screen.findByRole("button", { name: "Save a copy of the design to a file" }));
    expect(await screen.findByText("The copy could not be saved.")).toBeTruthy();
    expect(downloadBlob).not.toHaveBeenCalled();
  });
});
