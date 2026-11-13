import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBackup, getLastBackupAt, markBackedUp } from "@/export/backup";
import { downloadBlob } from "@/export/download";
import { dismissOpenDialogs, emptyLibrary, goTo, mountApp, resetDashboardStores, seedDesign, settle } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeBackupDialog, resetBackupReminderState } from "./backupReminderState";

/** The backup reminder in the whole app: where it is shown, and what its "Back up now" does. */

vi.mock("@/export/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/export/backup")>();
  return { ...actual, createBackup: vi.fn() };
});
vi.mock("@/export/download", () => ({ downloadBlob: vi.fn() }));

const DAY = 86_400_000;
const daysAgo = (days: number) => Date.now() - days * DAY;
const reminder = () => screen.findByRole("status", { name: "Backup reminder" });

beforeEach(async () => {
  vi.mocked(createBackup)
    .mockReset()
    .mockResolvedValue({ blob: new Blob(["zip"]), fileName: "Craftly backup 2026-11-14.zip", counts: { designs: 1, trashed: 0, folders: 0, uploads: 0, versions: 0 } });
  vi.mocked(downloadBlob).mockReset();
  await emptyLibrary();
  await resetDashboardStores();
  act(() => resetBackupReminderState());
});

afterEach(async () => {
  act(() => closeBackupDialog());
  await dismissOpenDialogs();
  act(() => toast.clear());
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("the backup reminder on the dashboard", () => {
  it("is shown above every dashboard page when the last backup is old, and backs up from its button", async () => {
    const user = userEvent.setup();
    await seedDesign({ title: "Poster", createdAt: daysAgo(40), updatedAt: daysAgo(2) });
    await markBackedUp(daysAgo(21));
    await mountApp("#/");
    await waitFor(async () => expect((await reminder()).textContent).toContain("Your last backup is 3 weeks old. 1 design changed since."));
    // it is the first thing in the page's own area, so it covers nothing and nothing covers it
    expect(document.getElementById("cf-dash-main")?.querySelector(".cf-dash__scroll")?.firstElementChild).toBe(await reminder());
    expect(screen.queryByRole("dialog")).toBeNull();

    await goTo("#/projects");
    expect((await reminder()).textContent).toContain("Your last backup is 3 weeks old.");

    const before = Date.now();
    await user.click(within(await reminder()).getByRole("button", { name: "Back up now" }));
    const dialog = await screen.findByRole("dialog", { name: "Back up & restore" });
    await waitFor(() => expect(dialog.textContent).toContain("Backup downloaded"));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(await getLastBackupAt()).toBeGreaterThanOrEqual(before);

    await user.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect((await reminder()).textContent).toBe("");
  });

  it("is not shown in a library that was just started", async () => {
    await seedDesign({ title: "First" });
    await seedDesign({ title: "Second" });
    await mountApp("#/");
    await screen.findByRole("heading", { level: 1, name: "What will you design today?" });
    await settle();
    expect((await reminder()).textContent).toBe("");
    expect(screen.queryByRole("button", { name: "Back up now" })).toBeNull();
  });

  it("is never shown on the editor's screen", async () => {
    const design = await seedDesign({ title: "Poster", createdAt: daysAgo(40), updatedAt: daysAgo(2) });
    await markBackedUp(daysAgo(21));
    await mountApp(`#/design/${design.id}`);
    await waitFor(() => expect(document.title).toContain("Poster"), { timeout: 20_000 });
    await settle();
    expect(screen.queryByRole("status", { name: "Backup reminder" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Back up now" })).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
