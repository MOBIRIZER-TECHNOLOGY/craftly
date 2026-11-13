import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaGet, metaSet } from "@/core/persistence";
import { getLastBackupAt, markBackedUp } from "@/export/backup";
import { emptyLibrary, resetDashboardStores, seedDesign, settle } from "@/test/dashuiUtils";
import { BackupReminderNotice } from "./BackupReminderNotice";
import { closeBackupDialog, noteBackedUp, resetBackupReminderState, setReminderInterval, useBackupDialogRequest, useReminderState } from "./backupReminderState";
import { designsStore } from "./data";

vi.mock("@/core/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/persistence")>();
  return { ...actual, metaGet: vi.fn(actual.metaGet), metaSet: vi.fn(actual.metaSet) };
});

const DAY = 86_400_000;
const daysAgo = (days: number) => Date.now() - days * DAY;
/** A design made `created` days ago and last edited `edited` days ago. */
const seed = (created: number, edited: number = created, over: { trashedAt?: number } = {}) =>
  seedDesign({ title: `Made ${created} days ago`, createdAt: daysAgo(created), updatedAt: daysAgo(edited), ...over });

const region = () => screen.getByRole("status", { name: "Backup reminder" });
const shownWords = () => region().textContent ?? "";
/** The stores have been read, and whatever was going to be shown is shown. */
async function mount() {
  const view = render(<BackupReminderNotice />);
  await waitFor(() => expect(designsStore.getSnapshot().ready).toBe(true));
  await settle();
  return view;
}

function Probe() {
  const request = useBackupDialogRequest();
  const state = useReminderState();
  return <output data-testid="probe">{JSON.stringify({ request, state })}</output>;
}
const probe = () =>
  JSON.parse(screen.getByTestId("probe").textContent ?? "{}") as { request: { open: boolean; start: boolean; loaded: boolean }; state: { lastBackupAt: number | null } };

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
  act(() => resetBackupReminderState());
});

afterEach(() => {
  cleanup();
  vi.mocked(metaGet).mockClear();
  vi.mocked(metaSet).mockClear();
});

describe("<BackupReminderNotice>", () => {
  describe("when it speaks", () => {
    it("says how old the last backup is and how many designs changed since, with two buttons", async () => {
      await seed(40, 2);
      await seed(30, 1);
      await seed(30, 25);
      await markBackedUp(daysAgo(21));
      await mount();
      await waitFor(() => expect(shownWords()).toContain("Your last backup is 3 weeks old. 2 designs changed since."));
      expect(
        within(region())
          .getAllByRole("button")
          .map((button) => button.textContent),
      ).toEqual(["Back up now", "Remind me later"]);
    });

    it("reads the time of the last backup that the backup code wrote", async () => {
      await seed(40, 2);
      await markBackedUp(daysAgo(15));
      expect(await getLastBackupAt()).not.toBeNull();
      await mount();
      await waitFor(() => expect(shownWords()).toContain("Your last backup is 2 weeks old."));
    });

    it("says that there is no backup yet once the library is a few days old", async () => {
      await seed(4);
      await seed(0);
      await mount();
      await waitFor(() => expect(shownWords()).toContain("You have not backed up in this browser yet. Your 2 designs live only here."));
    });

    it("does not count designs in the trash", async () => {
      await seed(40, 2, { trashedAt: Date.now() });
      await markBackedUp(daysAgo(21));
      await mount();
      expect(shownWords()).toBe("");
    });
  });

  describe("when it stays quiet", () => {
    it("is an empty, polite status region in a library that was just started, and does not take the keyboard", async () => {
      await seed(0);
      await seed(1);
      await mount();
      expect(region().textContent).toBe("");
      expect(region().children).toHaveLength(0);
      expect(document.activeElement).toBe(document.body);
    });

    it("says nothing in an empty library", async () => {
      await mount();
      expect(shownWords()).toBe("");
    });

    it("says nothing while the backup is recent", async () => {
      await seed(40, 2);
      await markBackedUp(daysAgo(3));
      await mount();
      expect(shownWords()).toBe("");
    });

    it("says nothing when reminders are turned off", async () => {
      await seed(40, 2);
      await markBackedUp(daysAgo(21));
      await metaSet("backupReminder", { intervalDays: 0, snoozedUntil: null });
      await mount();
      expect(shownWords()).toBe("");
    });

    it("says nothing when what it remembers cannot be read", async () => {
      await seed(9);
      vi.mocked(metaGet).mockRejectedValue(new Error("the database is closed"));
      await mount();
      expect(shownWords()).toBe("");
      vi.mocked(metaGet).mockReset();
    });

    it("takes a time of the last backup that is not a number for no backup", async () => {
      await seed(0);
      await metaSet("lastBackupAt", "yesterday");
      render(<Probe />);
      await mount();
      expect(probe().state.lastBackupAt).toBeNull();
    });
  });

  describe("Remind me later", () => {
    it("takes the notice away, remembers it for a week, and keeps the keyboard where it was", async () => {
      const user = userEvent.setup();
      await seed(9);
      const view = await mount();
      await user.click(await screen.findByRole("button", { name: "Remind me later" }));
      await waitFor(() => expect(shownWords()).toBe(""));
      expect(document.activeElement).toBe(region());
      const stored = await metaGet<{ intervalDays: number; snoozedUntil: number } | null>("backupReminder", null);
      expect(stored?.intervalDays).toBe(14);
      expect(stored?.snoozedUntil).toBeGreaterThan(Date.now() + 6.9 * DAY);
      expect(stored?.snoozedUntil).toBeLessThanOrEqual(Date.now() + 7 * DAY);

      // the page is loaded again the next day: still quiet
      view.unmount();
      act(() => resetBackupReminderState());
      await mount();
      expect(shownWords()).toBe("");
    });

    it("still goes away when the choice cannot be written down", async () => {
      const user = userEvent.setup();
      await seed(9);
      await mount();
      vi.mocked(metaSet).mockRejectedValueOnce(new Error("no room"));
      await user.click(await screen.findByRole("button", { name: "Remind me later" }));
      await waitFor(() => expect(shownWords()).toBe(""));
    });
  });

  describe("Back up now", () => {
    it("asks for the Back up & restore dialog with a backup started, and stays until the backup is made", async () => {
      const user = userEvent.setup();
      await seed(9);
      render(<Probe />);
      await mount();
      expect(probe().request).toEqual({ open: false, start: false, loaded: false });
      await user.click(await screen.findByRole("button", { name: "Back up now" }));
      expect(probe().request).toEqual({ open: true, start: true, loaded: true });
      expect(shownWords()).toContain("You have not backed up");

      // the dialog was closed without a backup: the notice is still there, and so is the dialog's code
      act(() => closeBackupDialog());
      act(() => closeBackupDialog());
      expect(probe().request).toEqual({ open: false, start: true, loaded: true });
      expect(shownWords()).toContain("You have not backed up");

      act(() => noteBackedUp(Date.now()));
      expect(shownWords()).toBe("");
    });
  });

  describe("once per visit", () => {
    it("does not come back after it went away, until the page is loaded again", async () => {
      await seed(40, 2);
      await markBackedUp(daysAgo(21));
      const view = await mount();
      await waitFor(() => expect(shownWords()).toContain("Your last backup"));

      // reminders are turned off in the dialog, and on again
      await act(() => setReminderInterval(0));
      expect(shownWords()).toBe("");
      await act(() => setReminderInterval(7));
      expect(shownWords()).toBe("");

      // back from the editor: the same visit
      view.unmount();
      await mount();
      expect(shownWords()).toBe("");

      // a new visit
      cleanup();
      act(() => resetBackupReminderState());
      await mount();
      await waitFor(() => expect(shownWords()).toContain("Your last backup"));
    });

    it("is still there after a look at the editor when nothing was done about it", async () => {
      await seed(9);
      const view = await mount();
      await waitFor(() => expect(shownWords()).toContain("You have not backed up"));
      view.unmount();
      await mount();
      expect(shownWords()).toContain("You have not backed up");
    });
  });
});
