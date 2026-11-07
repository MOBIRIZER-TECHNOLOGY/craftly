import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage } from "@/core/factory";
import { listVersions, saveVersion } from "@/core/library";
import { dbPut } from "@/core/persistence";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { chromeDesign, clearToasts, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { VersionsDialog } from "./VersionsDialog";

// The real library, except that a test can make listing or saving fail or wait.
vi.mock("@/core/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library")>();
  return { ...actual, listVersions: vi.fn(actual.listVersions), saveVersion: vi.fn(actual.saveVersion) };
});

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const stamp = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  vi.mocked(listVersions).mockClear();
  vi.mocked(saveVersion).mockClear();
});

afterEach(async () => {
  resetEditor();
  await clearToasts();
});

/** A version of `design` that was stored `age` ms ago, optionally with another title / size / pages. */
async function seed(design: Design, age: number, label?: string, snapshot: Partial<Design> = {}): Promise<number> {
  const createdAt = Date.now() - age;
  await dbPut("versions", { id: `${design.id}:${createdAt}`, designId: design.id, createdAt, label, design: { ...design, ...snapshot } });
  return createdAt;
}

const mount = (design: Design, onClose = vi.fn()) => renderChrome(<VersionsDialog open onClose={onClose} />, design);
const rows = () => within(screen.getByRole("listbox", { name: "Versions" })).getAllByRole("option");
const fact = (name: string) => screen.getByText(name, { selector: "dt" }).nextElementSibling!.textContent;

describe("<VersionsDialog>: the list", () => {
  it("explains when there are no versions yet", async () => {
    await mount(chromeDesign("No versions"));
    expect(await screen.findByText("No saved versions yet.")).toBeTruthy();
    expect(screen.getByText(/Craftly saves a version about every five minutes/)).toBeTruthy();
    expect(screen.getByText("Versions you save show up here.")).toBeTruthy();
    expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("shows placeholders while the versions are loading", async () => {
    vi.mocked(listVersions).mockReturnValueOnce(new Promise(() => undefined));
    await mount(chromeDesign("Loading"));
    expect(document.querySelector(".cf-versions__skeleton")?.children).toHaveLength(3);
    expect(screen.queryByRole("listbox", { name: "Versions" })).toBeNull();
    expect(screen.queryByText("No saved versions yet.")).toBeNull();
  });

  it("falls back to the empty state when the versions cannot be read", async () => {
    vi.mocked(listVersions).mockRejectedValueOnce(new Error("blocked"));
    await mount(chromeDesign("Unreadable"));
    expect(await screen.findByText("No saved versions yet.")).toBeTruthy();
  });

  it("lists the versions of this design, newest first, with their age and label", async () => {
    const design = chromeDesign("Many versions");
    const other = chromeDesign("Somebody else's");
    const a = await seed(design, 10_000, "Saved by you");
    const b = await seed(design, 5 * MINUTE);
    const c = await seed(design, 3 * HOUR, "Before restoring");
    const d = await seed(design, 1 * DAY);
    const e = await seed(design, 2 * DAY + HOUR);
    await seed(other, 1000, "Not this design");
    await mount(design);
    await screen.findByRole("listbox", { name: "Versions" });
    const items = rows();
    expect(items).toHaveLength(5);
    expect(items.map((r) => r.querySelector(".cf-versions__when")?.textContent)).toEqual([a, b, c, d, e].map((t) => stamp.format(t)));
    expect(items.map((r) => r.querySelector(".cf-versions__meta")?.textContent)).toEqual([
      "Saved by you - just now",
      "Autosave - 5 minutes ago",
      "Before restoring - 3 hours ago",
      "Autosave - yesterday",
      "Autosave - 2 days ago",
    ]);
    expect(screen.queryByText("Not this design")).toBeNull();
  });

  it("selects the newest version and previews it", async () => {
    const design = chromeDesign("Preview");
    const newest = await seed(design, MINUTE, undefined, { title: "Newer title", width: 800, height: 600, pages: [createPage(), createPage()] });
    await seed(design, HOUR, undefined, { title: "Older title" });
    await mount(design);
    await screen.findByRole("listbox", { name: "Versions" });
    expect(rows()[0].getAttribute("aria-selected")).toBe("true");
    expect(rows()[1].getAttribute("aria-selected")).toBe("false");
    await waitFor(() => expect(fact("Title")).toBe("Newer title"));
    expect(fact("Saved")).toBe(stamp.format(newest));
    expect(fact("Size")).toBe("800 × 600 px");
    expect(fact("Pages")).toBe("2");
    await waitFor(() => expect(document.querySelector(".cf-versions__thumb canvas")).toBeTruthy());
  });

  it("previews another version when it is clicked", async () => {
    const design = chromeDesign("Pick one");
    await seed(design, MINUTE, undefined, { title: "Newer title" });
    await seed(design, HOUR, undefined, { title: "Older title" });
    await mount(design);
    await screen.findByRole("listbox", { name: "Versions" });
    await userEvent.setup({ delay: null }).click(rows()[1]);
    expect(rows()[1].getAttribute("aria-selected")).toBe("true");
    await waitFor(() => expect(fact("Title")).toBe("Older title"));
  });
});

describe("<VersionsDialog>: saving a version", () => {
  it("saves the open design as a version and shows it", async () => {
    const design = chromeDesign("Save a version");
    await mount(design);
    await screen.findByText("No saved versions yet.");
    act(() => useEditor.getState().actions.setTitle("Edited before saving"));
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Save version now" }));
    expect(await screen.findByText("Version saved")).toBeTruthy();
    const items = await screen.findAllByRole("option");
    expect(items).toHaveLength(1);
    expect(items[0].querySelector(".cf-versions__meta")?.textContent).toBe("Saved by you - just now");
    await waitFor(() => expect(fact("Title")).toBe("Edited before saving"));
    expect(saveVersion).toHaveBeenCalledWith(expect.objectContaining({ id: design.id, title: "Edited before saving" }), "Saved by you");
  });

  it("keeps the version that was selected when the list is refreshed", async () => {
    const design = chromeDesign("Keep selection");
    await seed(design, 10 * MINUTE, undefined, { title: "Second" });
    await seed(design, HOUR, undefined, { title: "Third" });
    await mount(design);
    await screen.findByRole("listbox", { name: "Versions" });
    const user = userEvent.setup({ delay: null });
    await user.click(rows()[1]);
    await waitFor(() => expect(fact("Title")).toBe("Third"));
    await user.click(screen.getByRole("button", { name: "Save version now" }));
    await waitFor(() => expect(rows()).toHaveLength(3));
    expect(rows().map((r) => r.getAttribute("aria-selected"))).toEqual(["false", "false", "true"]);
    expect(fact("Title")).toBe("Third");
  });

  it("explains when the version could not be saved", async () => {
    vi.mocked(saveVersion).mockRejectedValueOnce(new Error("quota"));
    await mount(chromeDesign("Cannot save"));
    await screen.findByText("No saved versions yet.");
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Save version now" }));
    expect(await screen.findByText(/Couldn't save a version/)).toBeTruthy();
    expect((screen.getByRole("button", { name: "Save version now" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("does not save without an open design", async () => {
    await mount(chromeDesign("Closed underneath"));
    await screen.findByText("No saved versions yet.");
    act(() => useEditor.getState().actions.closeDesign());
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Save version now" }));
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("cannot save or restore while the design is only being viewed", async () => {
    const design = chromeDesign("Viewing versions");
    await seed(design, MINUTE);
    await mount(design);
    await screen.findByRole("listbox", { name: "Versions" });
    act(() => useEditor.getState().actions.setMode("view"));
    expect(
      screen.getByRole("button", { name: "Save version now" }).getAttribute("aria-disabled") === "true" ||
        (screen.getByRole("button", { name: "Save version now" }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe("<VersionsDialog>: restoring a version", () => {
  const oldPages = () => [createPage({ name: "Old only" })];

  it("asks first, keeps the current design as a version, goes back and closes", async () => {
    const design = chromeDesign("Restore me");
    const when = await seed(design, HOUR, undefined, { width: 640, height: 480, pages: oldPages() });
    const onClose = vi.fn();
    await mount(design, onClose);
    await screen.findByRole("listbox", { name: "Versions" });
    const user = userEvent.setup({ delay: null });
    await waitFor(() => expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Restore this version?" });
    expect(confirmDialog.textContent).toContain(stamp.format(when));
    expect(confirmDialog.textContent).toContain("you can also undo with Ctrl+Z");
    await user.click(within(confirmDialog).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Version restored")).toBeTruthy();
    expect(onClose).toHaveBeenCalledTimes(1);
    const restored = storeDesign();
    expect(restored.pages).toHaveLength(1);
    expect(restored.pages[0].name).toBe("Old only");
    expect([restored.width, restored.height]).toEqual([640, 480]);
    expect(useEditor.getState().activePageId).toBe(restored.pages[0].id);
    // the design as it was before is kept as a version, and Ctrl+Z goes back to it
    expect(saveVersion).toHaveBeenCalledWith(expect.objectContaining({ id: design.id }), "Before restoring");
    const versions = await listVersions(design.id);
    expect(versions.map((v) => v.label)).toContain("Before restoring");
    act(() => useEditor.getState().actions.undo());
    expect(storeDesign().pages).toHaveLength(3);
  });

  it("explains itself when the design disappears while the question is open", async () => {
    const design = chromeDesign("Gone");
    await seed(design, HOUR, undefined, { pages: oldPages() });
    const onClose = vi.fn();
    await mount(design, onClose);
    await screen.findByRole("listbox", { name: "Versions" });
    const user = userEvent.setup({ delay: null });
    await waitFor(() => expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Restore this version?" });
    act(() => useEditor.getState().actions.closeDesign());
    await user.click(within(confirmDialog).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Couldn't restore that version. Try again.")).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("changes nothing when the person says no", async () => {
    const design = chromeDesign("Do not restore");
    await seed(design, HOUR, undefined, { pages: oldPages() });
    const onClose = vi.fn();
    await mount(design, onClose);
    await screen.findByRole("listbox", { name: "Versions" });
    const user = userEvent.setup({ delay: null });
    await waitFor(() => expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(false));
    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    const confirmDialog = await screen.findByRole("dialog", { name: "Restore this version?" });
    await user.click(within(confirmDialog).getByRole("button", { name: "Cancel" }));
    expect(storeDesign().pages).toHaveLength(3);
    expect(onClose).not.toHaveBeenCalled();
    expect(saveVersion).not.toHaveBeenCalled();
  });

  it("explains when the version could not be restored and stays open", async () => {
    const design = chromeDesign("Restore fails");
    await seed(design, HOUR, undefined, { pages: oldPages() });
    const onClose = vi.fn();
    await mount(design, onClose);
    await screen.findByRole("listbox", { name: "Versions" });
    const user = userEvent.setup({ delay: null });
    await waitFor(() => expect((screen.getByRole("button", { name: "Restore this version" }) as HTMLButtonElement).disabled).toBe(false));
    vi.mocked(saveVersion).mockRejectedValueOnce(new Error("quota"));
    await user.click(screen.getByRole("button", { name: "Restore this version" }));
    await user.click(within(await screen.findByRole("dialog", { name: "Restore this version?" })).getByRole("button", { name: "Restore" }));
    expect(await screen.findByText("Couldn't restore that version. Try again.")).toBeTruthy();
    expect(storeDesign().pages).toHaveLength(3);
    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes with the Close button of its footer and with the corner button", async () => {
    const onClose = vi.fn();
    await mount(chromeDesign("Close versions"), onClose);
    const user = userEvent.setup({ delay: null });
    const [footer, corner] = screen.getAllByRole("button", { name: "Close" });
    await user.click(footer);
    expect(onClose).toHaveBeenCalledTimes(1);
    await user.click(corner);
    expect(onClose).toHaveBeenCalledTimes(2);
  });
});
