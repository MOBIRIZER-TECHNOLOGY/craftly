import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaGet } from "@/core/persistence";
import { BackupError, createBackup, getLastBackupAt, inspectBackup, markBackedUp, restoreBackup, type CreatedBackup, type RestoreResult } from "@/export/backup";
import { downloadBlob } from "@/export/download";
import { Hosts, dismissOpenDialogs, emptyLibrary, resetDashboardStores, seedDesign, settle, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { BackupDialog } from "./BackupDialog";
import type { BackupFileHandle, WritableBackupStream } from "./backupFile";
import { resetBackupReminderState, useReminderState } from "./backupReminderState";

/**
 * The reminder's setting and "Keep a backup file up to date" in the Back up & restore dialog. The file is a stand-in:
 * jsdom has no File System Access API, and no test can open a real "Save as" dialog or a browser's permission question.
 */

vi.mock("@/export/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/export/backup")>();
  return { ...actual, createBackup: vi.fn(), inspectBackup: vi.fn(), restoreBackup: vi.fn(), getLastBackupAt: vi.fn(async () => null), markBackedUp: vi.fn(async () => undefined) };
});
vi.mock("@/export/download", () => ({ downloadBlob: vi.fn() }));

// The library copies what it stores, and a stand-in file made of functions cannot be copied (a real handle can): the
// one key that holds the file is kept in a variable, everything else goes to the real store.
const keptFile = vi.hoisted(() => ({ stored: null as unknown }));
vi.mock("@/core/persistence", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/persistence")>();
  return {
    ...actual,
    metaGet: vi.fn(async (key: string, fallback: unknown) => (key === "backupFile" ? (keptFile.stored ?? fallback) : actual.metaGet(key, fallback))),
    metaSet: vi.fn(async (key: string, value: unknown) => (key === "backupFile" ? void (keptFile.stored = value) : actual.metaSet(key, value))),
  };
});

const DAY = 86_400_000;
const domError = (name: string) => new DOMException(`the browser's own words for ${name}`, name);

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

/** A file on disk that swaps its content only when the stream is closed, like the real one. */
function standIn(over: { permission?: PermissionState; afterAsking?: PermissionState; name?: string } = {}) {
  const disk = { content: "the old backup" };
  let permission = over.permission ?? "granted";
  const stream = {
    pending: "",
    write: vi.fn(async (data: Blob) => {
      stream.pending += await data.text();
    }),
    close: vi.fn(async () => {
      disk.content = stream.pending;
    }),
    abort: vi.fn(async () => {
      stream.pending = "";
    }),
  };
  const handle = {
    name: over.name ?? "Craftly backup.zip",
    queryPermission: vi.fn(async () => permission),
    requestPermission: vi.fn(async () => {
      permission = over.afterAsking ?? permission;
      return permission;
    }),
    createWritable: vi.fn(async (): Promise<WritableBackupStream> => stream),
  };
  return { handle: handle satisfies BackupFileHandle, stream, disk };
}

const COUNTS = { designs: 2, trashed: 0, folders: 0, uploads: 0, versions: 0 };
const created = (): CreatedBackup => ({ blob: new Blob(["the new backup"]), fileName: "Craftly backup 2026-11-14.zip", counts: COUNTS });
const restored = (): RestoreResult => ({
  designs: { added: 2, copied: 0, same: 0, damaged: 0 },
  uploads: { added: 0, same: 0, damaged: 0 },
  folders: { added: 0 },
  versions: { added: 0, damaged: 0 },
  brandKit: "none",
  skipped: 0,
  newer: 0,
});

const picker = vi.fn();
/** Chrome and Edge: the browser can save to a chosen file. */
const withFileApi = () => Object.defineProperty(window, "showSaveFilePicker", { configurable: true, writable: true, value: picker });
/** A file that was chosen on an earlier visit. */
const keep = (file: ReturnType<typeof standIn>, writtenAt: number | null = null) => {
  keptFile.stored = { handle: file.handle, name: file.handle.name, writtenAt };
};

function Parent({ startNow }: { startNow: boolean }) {
  const [open, setOpen] = useState(true);
  const reminder = useReminderState();
  return (
    <>
      <BackupDialog open={open} onClose={() => setOpen(false)} startNow={startNow} />
      <Hosts />
      <button type="button" onClick={() => setOpen(true)}>
        Open it again
      </button>
      <output data-testid="reminder">{JSON.stringify(reminder)}</output>
    </>
  );
}
const mount = (options: { startNow?: boolean } = {}) => render(<Parent startNow={options.startNow ?? false} />);
const dialog = () => screen.getByRole("dialog", { name: "Back up & restore" });
const button = (name: string) => within(dialog()).getByRole("button", { name });
const queryButton = (name: string) => within(dialog()).queryByRole("button", { name });
const words = () => dialog().textContent ?? "";
const reminderState = () =>
  JSON.parse(screen.getByTestId("reminder").textContent ?? "{}") as {
    ready: boolean;
    lastBackupAt: number | null;
    settings: { intervalDays: number; snoozedUntil: number | null };
  };
/** The dialog has read the library and the chosen file. */
async function opened(options: { startNow?: boolean } = {}) {
  mount(options);
  await waitFor(() => expect(words()).not.toContain("Nothing to back up yet"));
  await settle();
}

beforeEach(async () => {
  keptFile.stored = null;
  picker.mockReset();
  vi.mocked(createBackup).mockReset().mockResolvedValue(created());
  vi.mocked(inspectBackup).mockReset();
  vi.mocked(restoreBackup).mockReset();
  vi.mocked(markBackedUp).mockClear();
  vi.mocked(getLastBackupAt).mockReset().mockResolvedValue(null);
  vi.mocked(downloadBlob).mockReset();
  await emptyLibrary();
  await resetDashboardStores();
  act(() => resetBackupReminderState());
  await seedDesign({ title: "One" });
  await seedDesign({ title: "Two" });
});

afterEach(async () => {
  cleanup();
  await dismissOpenDialogs();
  act(() => toast.clear());
  delete (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  vi.restoreAllMocks();
});

describe("<BackupDialog>: the reminder's setting", () => {
  it("offers a week, two weeks, a month and never, and starts at two weeks", async () => {
    await opened();
    const group = within(dialog()).getByRole("radiogroup", { name: "Remind me when my last backup is older than" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((radio) => radio.textContent),
    ).toEqual(["1 week", "2 weeks", "1 month", "Never"]);
    await waitFor(() => expect(within(group).getByRole("radio", { name: "2 weeks" }).getAttribute("aria-checked")).toBe("true"));
  });

  it("remembers the choice in the library, and turns reminders off with Never", async () => {
    const user = userEvent.setup();
    await opened();
    await user.click(within(dialog()).getByRole("radio", { name: "1 month" }));
    await waitFor(async () => expect(await metaGet("backupReminder", null)).toEqual({ intervalDays: 30, snoozedUntil: null }));
    await user.click(within(dialog()).getByRole("radio", { name: "Never" }));
    await waitFor(async () => expect(await metaGet("backupReminder", null)).toEqual({ intervalDays: 0, snoozedUntil: null }));
    expect(within(dialog()).getByRole("radio", { name: "Never" }).getAttribute("aria-checked")).toBe("true");
  });

  it("tells the dashboard's reminder that a backup was made", async () => {
    const user = userEvent.setup();
    await opened();
    const before = Date.now();
    await user.click(button("Download backup"));
    await waitFor(() => expect(words()).toContain("Backup downloaded"));
    expect(reminderState().lastBackupAt).toBeGreaterThanOrEqual(before);
  });

  it("keeps the reminder quiet for a week after a restore into a browser that never made a backup", async () => {
    const user = userEvent.setup();
    stubFilePicker([new File([new Uint8Array([80, 75, 3, 4])], "Craftly backup.zip", { type: "application/zip" })]);
    vi.mocked(inspectBackup).mockResolvedValue({
      exportedAt: "2026-11-08T12:30:00.000Z",
      counts: COUNTS,
      plan: { designs: { add: 2, same: 0, copy: 0 }, uploads: { add: 0, same: 0 }, folders: { add: 0, same: 0 }, versions: { add: 0 }, brandKit: "none", nothingNew: false },
      skipped: 0,
    });
    vi.mocked(restoreBackup).mockResolvedValue(restored());
    await opened();
    await user.click(button("Choose backup file"));
    await user.click(await within(dialog()).findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(words()).toContain("Restore finished"));
    await waitFor(() => expect(reminderState().settings.snoozedUntil).toBeGreaterThan(Date.now() + 6.9 * DAY));
  });

  it("does not put the reminder off after a restore when a backup was made here before", async () => {
    const user = userEvent.setup();
    vi.mocked(getLastBackupAt).mockResolvedValue(Date.now() - 30 * DAY);
    stubFilePicker([new File([new Uint8Array([80, 75, 3, 4])], "Craftly backup.zip", { type: "application/zip" })]);
    vi.mocked(inspectBackup).mockResolvedValue({
      exportedAt: "2026-11-08T12:30:00.000Z",
      counts: COUNTS,
      plan: { designs: { add: 2, same: 0, copy: 0 }, uploads: { add: 0, same: 0 }, folders: { add: 0, same: 0 }, versions: { add: 0 }, brandKit: "none", nothingNew: false },
      skipped: 0,
    });
    vi.mocked(restoreBackup).mockResolvedValue(restored());
    await opened();
    await user.click(button("Choose backup file"));
    await user.click(await within(dialog()).findByRole("button", { name: "Restore" }));
    await waitFor(() => expect(words()).toContain("Restore finished"));
    await settle();
    expect(reminderState().settings.snoozedUntil).toBeNull();
  });
});

describe("<BackupDialog>: where the browser cannot save to a chosen file (Firefox, Safari)", () => {
  it("shows nothing about keeping a file, and the download works as before", async () => {
    const user = userEvent.setup();
    await opened();
    expect(words()).not.toContain("Keep a backup file up to date");
    expect(queryButton("Choose a file to keep up to date")).toBeNull();
    expect(queryButton("Back up now")).toBeNull();
    await user.click(button("Download backup"));
    await waitFor(() => expect(words()).toContain("Backup downloaded"));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("downloads straight away when it was opened by the reminder's Back up now", async () => {
    await opened({ startNow: true });
    await waitFor(() => expect(words()).toContain("Backup downloaded"));
    expect(downloadBlob).toHaveBeenCalledTimes(1);
    expect(markBackedUp).toHaveBeenCalledTimes(1);
  });

  it("starts nothing for the reminder when there is nothing to back up", async () => {
    await emptyLibrary();
    await resetDashboardStores();
    mount({ startNow: true });
    await waitFor(() => expect(words()).toContain("Nothing to back up yet"));
    await settle();
    expect(createBackup).not.toHaveBeenCalled();
  });

  it("starts one backup for one click on the reminder, and none when the dialog is opened again by hand", async () => {
    const user = userEvent.setup();
    await opened({ startNow: true });
    await waitFor(() => expect(words()).toContain("Backup downloaded"));
    await user.click(button("Make another backup"));
    await settle();
    expect(createBackup).toHaveBeenCalledTimes(1);
  });
});

describe("<BackupDialog>: keeping a backup file up to date (Chrome, Edge)", () => {
  beforeEach(() => {
    withFileApi();
  });

  describe("choosing the file", () => {
    it("explains what it does, and that Craftly only writes when the button is pressed", async () => {
      await opened();
      const card = within(dialog()).getByRole("region", { name: "Keep a backup file up to date" });
      expect(card.textContent).toContain("Choose a file once");
      expect(card.textContent).toContain("not on its own");
      expect(within(card).getByRole("button", { name: "Choose a file to keep up to date" })).toBeTruthy();
      expect(queryButton("Back up now")).toBeNull();
      expect(queryButton("Stop using this file")).toBeNull();
    });

    it("writes a first backup into the file that was chosen, without a download, and says so", async () => {
      const user = userEvent.setup();
      const file = standIn({ name: "My designs.zip" });
      picker.mockResolvedValue(file.handle);
      await opened();
      await user.click(button("Choose a file to keep up to date"));
      await waitFor(() => expect(words()).toContain("Backup saved"));
      expect(words()).toContain("“My designs.zip”");
      expect(words()).toContain("It holds 2 designs.");
      expect(file.disk.content).toBe("the new backup");
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(markBackedUp).toHaveBeenCalledTimes(1);
      expect(within(dialog()).getByRole("status").textContent).toContain("Backup saved");
    });

    it("shows the file and when it was written once it is back at the start", async () => {
      const user = userEvent.setup();
      const file = standIn({ name: "My designs.zip" });
      picker.mockResolvedValue(file.handle);
      await opened();
      await user.click(button("Choose a file to keep up to date"));
      await user.click(await within(dialog()).findByRole("button", { name: "Make another backup" }));
      const card = within(dialog()).getByRole("region", { name: "Keep a backup file up to date" });
      expect(card.textContent).toContain("“My designs.zip”, last written just now.");
      expect(document.activeElement).toBe(button("Back up now"));
    });

    it("changes nothing when the browser's file dialog is cancelled", async () => {
      const user = userEvent.setup();
      picker.mockRejectedValue(domError("AbortError"));
      await opened();
      await user.click(button("Choose a file to keep up to date"));
      await settle();
      expect(button("Choose a file to keep up to date")).toBeTruthy();
      expect(createBackup).not.toHaveBeenCalled();
    });

    it("says in plain words when the file dialog cannot be opened", async () => {
      const user = userEvent.setup();
      picker.mockRejectedValue(domError("SecurityError"));
      await opened();
      await user.click(button("Choose a file to keep up to date"));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Couldn't use that file");
      expect(alert.textContent).toContain("Your browser did not open its file dialog.");
      expect(alert.textContent).not.toContain("the browser's own words");
    });

    it("only remembers the file in an empty library: there is nothing to write yet", async () => {
      const user = userEvent.setup();
      await emptyLibrary();
      await resetDashboardStores();
      const file = standIn();
      picker.mockResolvedValue(file.handle);
      mount();
      await waitFor(() => expect(words()).toContain("Nothing to back up yet"));
      await user.click(button("Choose a file to keep up to date"));
      await waitFor(() => expect(words()).toContain("“Craftly backup.zip”, nothing written to it yet."));
      expect(createBackup).not.toHaveBeenCalled();
      expect((button("Back up now") as HTMLButtonElement).disabled).toBe(true);
    });

    it("forgets a file that is chosen after the dialog was closed from the screen, but keeps it for the next visit", async () => {
      const user = userEvent.setup();
      const chosen = deferred<BackupFileHandle>();
      picker.mockReturnValue(chosen.promise);
      await opened();
      await user.click(button("Choose a file to keep up to date"));
      await user.click(button("Close"));
      await act(async () => chosen.resolve(standIn().handle));
      await settle();
      expect(createBackup).not.toHaveBeenCalled();
    });
  });

  describe("Back up now", () => {
    it("shows the file's name and when it was last written", async () => {
      keep(standIn({ name: "Safe place.zip" }), Date.now() - 3 * DAY);
      await opened();
      const card = within(dialog()).getByRole("region", { name: "Keep a backup file up to date" });
      await waitFor(() => expect(card.textContent).toContain("“Safe place.zip”, last written 3 days ago."));
      expect(card.textContent).toContain("not on its own");
      expect(within(card).getByRole("button", { name: "Back up now" })).toBeTruthy();
      expect(within(card).getByRole("button", { name: "Stop using this file" })).toBeTruthy();
      expect(button("Download backup")).toBeTruthy();
    });

    it("writes to the file without asking and without a download while the browser still allows it", async () => {
      const user = userEvent.setup();
      const file = standIn({ permission: "granted" });
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      await waitFor(() => expect(words()).toContain("Backup saved"));
      expect(file.handle.requestPermission).not.toHaveBeenCalled();
      expect(file.disk.content).toBe("the new backup");
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(words()).toContain("It replaced the backup that was in the file before.");
    });

    it("says that it is writing the file while it does", async () => {
      const user = userEvent.setup();
      const file = standIn();
      const writing = deferred<void>();
      file.stream.write.mockImplementationOnce(() => writing.promise);
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      await waitFor(() => expect(words()).toContain("Writing “Craftly backup.zip”…"));
      expect(within(dialog()).getByRole("progressbar", { name: "Backup progress" }).getAttribute("aria-valuenow")).toBeNull();
      await act(async () => writing.resolve());
      await waitFor(() => expect(words()).toContain("Backup saved"));
    });

    it("asks the browser for permission first, straight from the click, and writes when it is given", async () => {
      const user = userEvent.setup();
      const file = standIn({ permission: "prompt", afterAsking: "granted" });
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      await waitFor(() => expect(words()).toContain("Backup saved"));
      expect(file.handle.requestPermission).toHaveBeenCalledTimes(1);
      expect(file.handle.requestPermission.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(createBackup).mock.invocationCallOrder[0]);
    });

    it("makes no backup when the person does not allow it, and says what to do", async () => {
      const user = userEvent.setup();
      const file = standIn({ permission: "prompt", afterAsking: "denied" });
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      const note = await within(dialog()).findByText(/did not allow/);
      expect(note.textContent).toBe("Your browser did not allow Craftly to write to “Craftly backup.zip”. Press “Back up now” to be asked again, or download the backup.");
      expect(note.closest("[role=status]")).not.toBeNull();
      expect(createBackup).not.toHaveBeenCalled();
      expect(file.handle.createWritable).not.toHaveBeenCalled();
      expect(markBackedUp).not.toHaveBeenCalled();
    });

    it("keeps the old backup and says so when writing fails midway", async () => {
      const user = userEvent.setup();
      const file = standIn();
      file.stream.write.mockRejectedValueOnce(domError("InvalidStateError"));
      keep(file, 5);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Couldn't write the backup file");
      expect(alert.textContent).toContain("Writing “Craftly backup.zip” did not finish. The backup that was in the file before is unchanged.");
      expect(alert.textContent).not.toContain("the browser's own words");
      expect(file.disk.content).toBe("the old backup");
      expect(markBackedUp).not.toHaveBeenCalled();
      expect(downloadBlob).not.toHaveBeenCalled();
      await user.click(button("Try again"));
      expect(button("Download backup")).toBeTruthy();
    });

    it("says that the file is gone when it was moved or deleted, and still offers the download", async () => {
      const user = userEvent.setup();
      const file = standIn();
      file.handle.createWritable.mockRejectedValueOnce(domError("NotFoundError"));
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Craftly could not find “Craftly backup.zip”.");
      await user.click(button("Try again"));
      expect(button("Download backup")).toBeTruthy();
      expect(button("Stop using this file")).toBeTruthy();
    });

    it("goes back to the start, with the old backup in the file, when Cancel is pressed while it writes", async () => {
      const user = userEvent.setup();
      const file = standIn();
      const writing = deferred<void>();
      file.stream.write.mockImplementationOnce(() => writing.promise);
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      await waitFor(() => expect(words()).toContain("Writing “Craftly backup.zip”…"));
      await user.click(button("Cancel"));
      await act(async () => writing.resolve());
      await waitFor(() => expect(button("Download backup")).toBeTruthy());
      expect(file.stream.abort).toHaveBeenCalledTimes(1);
      expect(file.disk.content).toBe("the old backup");
      expect(markBackedUp).not.toHaveBeenCalled();
      expect(within(dialog()).queryByRole("alert")).toBeNull();
    });

    it("says what went wrong when the backup itself cannot be made, and leaves the file alone", async () => {
      const user = userEvent.setup();
      const file = standIn();
      vi.mocked(createBackup).mockRejectedValue(new BackupError("too-large"));
      keep(file);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Back up now" }));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Couldn't back up");
      expect(file.handle.createWritable).not.toHaveBeenCalled();
    });
  });

  describe("Stop using this file", () => {
    it("forgets the file, leaves it on the disk, and offers to choose one again", async () => {
      const user = userEvent.setup();
      const file = standIn();
      keep(file, 5);
      await opened();
      await user.click(await within(dialog()).findByRole("button", { name: "Stop using this file" }));
      await waitFor(() => expect(button("Choose a file to keep up to date")).toBeTruthy());
      expect(queryButton("Back up now")).toBeNull();
      expect(keptFile.stored).toBeNull();
      expect(file.disk.content).toBe("the old backup");
      expect(file.handle.createWritable).not.toHaveBeenCalled();
    });
  });

  describe("opened by the reminder's Back up now", () => {
    it("writes to the file straight away while the browser still allows it", async () => {
      const file = standIn({ permission: "granted" });
      keep(file);
      await opened({ startNow: true });
      await waitFor(() => expect(words()).toContain("Backup saved"));
      expect(file.disk.content).toBe("the new backup");
      expect(downloadBlob).not.toHaveBeenCalled();
    });

    it("does not ask for permission without a click on the button itself: it says that one more click is needed", async () => {
      const user = userEvent.setup();
      const file = standIn({ permission: "prompt", afterAsking: "granted" });
      keep(file);
      await opened({ startNow: true });
      const note = await within(dialog()).findByText(/so that your browser/);
      expect(note.textContent).toBe("Press “Back up now” so that your browser lets Craftly write to “Craftly backup.zip”.");
      expect(file.handle.requestPermission).not.toHaveBeenCalled();
      expect(createBackup).not.toHaveBeenCalled();
      expect(downloadBlob).not.toHaveBeenCalled();

      await user.click(button("Back up now"));
      await waitFor(() => expect(words()).toContain("Backup saved"));
      expect(file.handle.requestPermission).toHaveBeenCalledTimes(1);
    });
  });
});
