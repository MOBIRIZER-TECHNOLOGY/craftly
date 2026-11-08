import { act, cleanup, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BackupError,
  createBackup,
  getLastBackupAt,
  inspectBackup,
  markBackedUp,
  restoreBackup,
  type BackupInspection,
  type CreateBackupOptions,
  type CreatedBackup,
  type RestoreOptions,
  type RestoreResult,
} from "@/export/backup";
import { downloadBlob } from "@/export/download";
import { Hosts, dismissOpenDialogs, emptyLibrary, resetDashboardStores, seedDesign, stubFilePicker } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { BackupDialog } from "./BackupDialog";

vi.mock("@/export/backup", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/export/backup")>();
  return { ...actual, createBackup: vi.fn(), inspectBackup: vi.fn(), restoreBackup: vi.fn(), getLastBackupAt: vi.fn(async () => null), markBackedUp: vi.fn(async () => undefined) };
});
vi.mock("@/export/download", () => ({ downloadBlob: vi.fn() }));

type StorageStub = { estimate?: () => Promise<{ usage?: number; quota?: number }>; persisted?: () => Promise<boolean>; persist?: () => Promise<boolean> };
const stubStorage = (storage: StorageStub | undefined) => Object.defineProperty(navigator, "storage", { configurable: true, value: storage });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const COUNTS = { designs: 2, trashed: 1, folders: 1, uploads: 3, versions: 4 };
const created = (over: Partial<CreatedBackup> = {}): CreatedBackup => ({
  blob: new Blob([new Uint8Array(2048)]),
  fileName: "Craftly backup 2026-11-08.zip",
  counts: COUNTS,
  ...over,
});
const inspection = (over: Partial<BackupInspection> = {}): BackupInspection => ({
  exportedAt: "2026-11-08T12:30:00.000Z",
  counts: COUNTS,
  plan: { designs: { add: 2, same: 0, copy: 0 }, uploads: { add: 3, same: 0 }, folders: { add: 1, same: 0 }, versions: { add: 4 }, brandKit: "restore", nothingNew: false },
  skipped: 0,
  ...over,
});
const restored = (over: Partial<RestoreResult> = {}): RestoreResult => ({
  designs: { added: 2, copied: 0, same: 0, damaged: 0 },
  uploads: { added: 3, same: 0, damaged: 0 },
  folders: { added: 1 },
  versions: { added: 4, damaged: 0 },
  brandKit: "restore",
  skipped: 0,
  newer: 0,
  ...over,
});
const backupFile = () => new File([new Uint8Array([80, 75, 3, 4])], "Craftly backup 2026-11-08.zip", { type: "application/zip" });

/** Closes like the account menu's parent does: the dialog stays until it is told to go. */
const onClose = vi.fn();
function Parent({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <>
      <BackupDialog
        open={open}
        onClose={() => {
          onClose();
          setOpen(false);
        }}
      />
      <Hosts />
      <button type="button" onClick={() => setOpen(true)}>
        Open it again
      </button>
    </>
  );
}
function mount(open = true) {
  return render(<Parent initiallyOpen={open} />);
}
const dialog = () => screen.getByRole("dialog", { name: "Back up & restore" });
const button = (name: string | RegExp) => within(dialog()).getByRole("button", { name });
const setup = () => userEvent.setup();

beforeEach(async () => {
  vi.mocked(createBackup).mockReset();
  vi.mocked(inspectBackup).mockReset();
  vi.mocked(restoreBackup).mockReset();
  vi.mocked(markBackedUp).mockClear();
  vi.mocked(getLastBackupAt).mockReset().mockResolvedValue(null);
  vi.mocked(downloadBlob).mockReset();
  onClose.mockReset();
  stubStorage(undefined);
  await emptyLibrary();
  await resetDashboardStores();
});

afterEach(async () => {
  cleanup();
  await dismissOpenDialogs();
  act(() => toast.clear());
  delete (navigator as unknown as { storage?: unknown }).storage;
  vi.restoreAllMocks();
  window.location.hash = "";
});

describe("<BackupDialog>", () => {
  it("renders nothing while closed", () => {
    mount(false);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  describe("at the start", () => {
    it("explains what a backup is and that restoring never replaces anything", async () => {
      await seedDesign({ title: "One" });
      mount();
      const text = dialog().textContent!;
      expect(text).toContain("live only in this browser");
      expect(text).toContain("one file");
      expect(text).toContain("Nothing you have now is replaced or deleted");
      expect(button("Download backup")).toBeTruthy();
      expect(button("Choose backup file")).toBeTruthy();
    });

    it("counts what a backup would hold, from the library as it is now", async () => {
      await seedDesign({ title: "A" });
      await seedDesign({ title: "B" });
      await seedDesign({ title: "Gone", trashedAt: Date.now() });
      mount();
      await waitFor(() => expect(dialog().textContent).toContain("2 designs, 1 in the trash"));
    });

    it("has nothing to back up in an empty library, and says so", async () => {
      mount();
      await waitFor(() => expect(dialog().textContent).toContain("Nothing to back up yet"));
      expect((button("Download backup") as HTMLButtonElement).disabled).toBe(true);
    });

    it("starts the keyboard on the first button that works", async () => {
      mount();
      await waitFor(() => expect(document.activeElement).toBe(button("Choose backup file")));
    });

    it("says when the last backup was made, or that there was none", async () => {
      await seedDesign();
      const first = mount();
      expect(await within(dialog()).findByText("No backup yet")).toBeTruthy();
      first.unmount();
      vi.mocked(getLastBackupAt).mockResolvedValue(Date.now() - 3 * 86_400_000);
      mount();
      expect(await within(dialog()).findByText("Last backup: 3 days ago")).toBeTruthy();
    });
  });

  it("says there was no backup when the time of the last one cannot be read", async () => {
    await seedDesign();
    vi.mocked(getLastBackupAt).mockRejectedValue(new Error("blocked"));
    mount();
    expect(await within(dialog()).findByText("No backup yet")).toBeTruthy();
  });

  describe("making a backup", () => {
    async function backUp(user: ReturnType<typeof setup>) {
      await seedDesign();
      mount();
      await user.click(await waitForEnabled("Download backup"));
    }
    const waitForEnabled = async (name: string) => {
      await waitFor(() => expect((button(name) as HTMLButtonElement).disabled).toBe(false));
      return button(name);
    };

    it("shows how far it is, then hands the file over and remembers when", async () => {
      const user = setup();
      const run = deferred<CreatedBackup>();
      let options!: CreateBackupOptions;
      vi.mocked(createBackup).mockImplementation((given) => {
        options = given!;
        return run.promise;
      });
      await backUp(user);

      expect(within(dialog()).getByRole("progressbar", { name: "Backup progress" })).toBeTruthy();
      expect(dialog().textContent).toContain("Getting ready");
      act(() => options.onProgress?.({ phase: "collecting", done: 4, total: 8 }));
      expect(dialog().textContent).toContain("Reading your library: 4 of 8");
      expect(within(dialog()).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("25"); // the first half is reading
      act(() => options.onProgress?.({ phase: "packing", done: 5, total: 10 }));
      expect(dialog().textContent).toContain("Packing the file: 5 of 10");
      expect(within(dialog()).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("75");

      const result = created();
      run.resolve(result);
      expect(await within(dialog()).findByText("Backup downloaded")).toBeTruthy();
      expect(downloadBlob).toHaveBeenCalledWith(result.blob, "Craftly backup 2026-11-08.zip");
      expect(markBackedUp).toHaveBeenCalledTimes(1);
      const text = dialog().textContent!;
      expect(text).toContain("Craftly backup 2026-11-08.zip");
      expect(text).toContain("2.0 KB");
      expect(text).toContain("2 designs, 1 in the trash, 1 folder, 3 uploads, 4 saved versions");
      expect(text).toContain("somewhere safe");

      await user.click(button("Done"));
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("shows a half-full bar for the reading step when there is nothing to count", async () => {
      const user = setup();
      let options!: CreateBackupOptions;
      vi.mocked(createBackup).mockImplementation((given) => {
        options = given!;
        return new Promise(() => undefined);
      });
      await backUp(user);
      act(() => options.onProgress?.({ phase: "collecting", done: 0, total: 0 }));
      expect(within(dialog()).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("50");
    });

    it("says that nothing was in a backup of nothing", async () => {
      const user = setup();
      vi.mocked(createBackup).mockResolvedValue(created({ counts: { designs: 0, trashed: 0, folders: 0, uploads: 0, versions: 0 } }));
      await backUp(user);
      await within(dialog()).findByText("Backup downloaded");
      expect(dialog().textContent).toContain("It holds nothing.");
    });

    it("ignores progress that arrives after the backup was cancelled", async () => {
      const user = setup();
      let options!: CreateBackupOptions;
      vi.mocked(createBackup).mockImplementation((given) => {
        options = given!;
        return new Promise((_, reject) => given!.signal!.addEventListener("abort", () => reject(new BackupError("cancelled"))));
      });
      await backUp(user);
      await user.click(button("Cancel"));
      await waitFor(() => expect(button("Download backup")).toBeTruthy());
      act(() => options.onProgress?.({ phase: "packing", done: 1, total: 2 }));
      expect(within(dialog()).queryByRole("progressbar")).toBeNull();
    });

    it("shows the time of the backup it just made", async () => {
      const user = setup();
      vi.mocked(createBackup).mockResolvedValue(created());
      await backUp(user);
      await within(dialog()).findByText("Backup downloaded");
      await user.click(button("Make another backup"));
      expect(await within(dialog()).findByText("Last backup: just now")).toBeTruthy();
    });

    it("does not mind that remembering the time fails: the file is already on its way", async () => {
      const user = setup();
      vi.mocked(createBackup).mockResolvedValue(created());
      vi.mocked(markBackedUp).mockRejectedValueOnce(new Error("blocked"));
      await backUp(user);
      expect(await within(dialog()).findByText("Backup downloaded")).toBeTruthy();
      expect(downloadBlob).toHaveBeenCalledTimes(1);
    });

    it("stops when Cancel is pressed, hands over nothing and goes back to the start", async () => {
      const user = setup();
      let signal!: AbortSignal;
      vi.mocked(createBackup).mockImplementation(
        (given) =>
          new Promise((_, reject) => {
            signal = given!.signal!;
            signal.addEventListener("abort", () => reject(new BackupError("cancelled")));
          }),
      );
      await backUp(user);
      await user.click(button("Cancel"));
      await waitFor(() => expect(button("Download backup")).toBeTruthy());
      expect(signal.aborted).toBe(true);
      expect(downloadBlob).not.toHaveBeenCalled();
      expect(dialog().querySelector("[role=alert]")).toBeNull();
    });

    it("says what went wrong, in words, and offers to try again", async () => {
      const user = setup();
      vi.mocked(createBackup).mockRejectedValueOnce(new BackupError("too-large"));
      await backUp(user);
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Couldn't back up");
      expect(alert.textContent).toContain("larger than one backup file can hold");
      await user.click(button("Try again"));
      expect(button("Download backup")).toBeTruthy();
    });

    it("does not show a browser's own error text for a failure it does not know", async () => {
      const user = setup();
      vi.mocked(createBackup).mockRejectedValueOnce(new Error("TypeError: x is not a function"));
      await backUp(user);
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Something went wrong while making the backup");
      expect(alert.textContent).not.toContain("TypeError");
    });
  });

  describe("restoring a backup", () => {
    async function pickBackup(user: ReturnType<typeof setup>, found: BackupInspection = inspection()) {
      stubFilePicker([backupFile()]);
      vi.mocked(inspectBackup).mockResolvedValue(found);
      mount();
      await user.click(button("Choose backup file"));
      return within(dialog()).findByRole("heading", { name: /Ready to restore|Nothing to restore/ });
    }

    it("asks for a zip file, reads it, and says what restoring it will do before doing it", async () => {
      const user = setup();
      const picker = stubFilePicker([backupFile()]);
      vi.mocked(inspectBackup).mockResolvedValue(inspection());
      mount();
      await user.click(button("Choose backup file"));
      expect(await within(dialog()).findByRole("heading", { name: "Ready to restore" })).toBeTruthy();
      expect(picker.lastAccept()).toBe(".zip,application/zip,application/x-zip-compressed");
      expect(inspectBackup).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ signal: expect.any(AbortSignal) }));
      const text = dialog().textContent!;
      expect(text).toContain("2 designs, 1 in the trash, 1 folder, 3 uploads, 4 saved versions");
      expect(text).toContain("Will be added: 2 designs, 1 folder, 3 uploads, 4 saved versions, your brand kit.");
      expect(restoreBackup).not.toHaveBeenCalled();
    });

    it("says that what is here already stays as it is, and what has been edited since comes back as a copy", async () => {
      const user = setup();
      await pickBackup(
        user,
        inspection({
          plan: { designs: { add: 1, same: 2, copy: 3 }, uploads: { add: 0, same: 2 }, folders: { add: 0, same: 1 }, versions: { add: 0 }, brandKit: "merge", nothingNew: false },
          skipped: 2,
        }),
      );
      const text = dialog().textContent!;
      expect(text).toContain("Will be added: 1 design, your brand kit, merged with the one here.");
      expect(text).toContain("3 designs have been edited since this backup. They come back as copies named “… (restored)”, so your edits stay.");
      expect(text).toContain("Already here and left as they are: 2 designs, 1 folder, 2 uploads.");
      expect(text).toContain("2 items in the backup could not be used.");
    });

    it("says it in the singular too", async () => {
      const user = setup();
      await pickBackup(
        user,
        inspection({
          plan: { designs: { add: 0, same: 0, copy: 1 }, uploads: { add: 0, same: 0 }, folders: { add: 0, same: 0 }, versions: { add: 0 }, brandKit: "none", nothingNew: false },
          skipped: 1,
        }),
      );
      const text = dialog().textContent!;
      expect(text).toContain("1 design has been edited since this backup. It comes back as a copy named “… (restored)”, so your edit stays.");
      expect(text).toContain("1 item in the backup could not be used.");
      expect(text).not.toContain("Will be added");
    });

    it("has nothing to do when everything is here already, and does not offer to do it", async () => {
      const user = setup();
      const heading = await pickBackup(
        user,
        inspection({
          plan: { designs: { add: 0, same: 3, copy: 0 }, uploads: { add: 0, same: 3 }, folders: { add: 0, same: 1 }, versions: { add: 0 }, brandKit: "none", nothingNew: true },
          counts: { ...COUNTS, designs: 3, trashed: 0 },
        }),
      );
      expect(heading.textContent).toBe("Nothing to restore");
      expect(dialog().textContent).toContain("Everything in this backup is already here.");
      expect(within(dialog()).queryByRole("button", { name: "Restore" })).toBeNull();
      await user.click(button("Choose another file"));
      expect(button("Download backup")).toBeTruthy();
    });

    it("names the day of the backup, and leaves the day out when the file does not say", async () => {
      const user = setup();
      await pickBackup(user);
      expect(dialog().textContent).toMatch(/Backup from .*2026/);
      await user.click(button("Cancel"));
      vi.mocked(inspectBackup).mockResolvedValue(inspection({ exportedAt: new Date(0).toISOString() }));
      await user.click(button("Choose backup file"));
      await within(dialog()).findByRole("heading", { name: "Ready to restore" });
      expect(dialog().textContent).not.toMatch(/Backup from/);
      expect(dialog().textContent).toContain("This backup holds");
    });

    it("ignores a file that is chosen after the dialog was closed", async () => {
      const user = setup();
      const waiting: HTMLInputElement[] = [];
      vi.spyOn(HTMLInputElement.prototype, "click").mockImplementation(function (this: HTMLInputElement) {
        if (this.type === "file") waiting.push(this);
      });
      mount();
      await user.click(button("Choose backup file"));
      await user.click(button("Close"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      Object.defineProperty(waiting[0], "files", { configurable: true, value: [backupFile()] });
      act(() => {
        waiting[0].dispatchEvent(new Event("change", { bubbles: true }));
      });
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(inspectBackup).not.toHaveBeenCalled();
    });

    it("goes back to the start when the file dialog is cancelled", async () => {
      const user = setup();
      stubFilePicker([]);
      mount();
      await user.click(button("Choose backup file"));
      expect(inspectBackup).not.toHaveBeenCalled();
      expect(button("Choose backup file")).toBeTruthy();
    });

    it("says why a file cannot be restored, and lets the person pick another", async () => {
      const user = setup();
      stubFilePicker([backupFile()]);
      vi.mocked(inspectBackup).mockRejectedValueOnce(new BackupError("not-a-backup"));
      mount();
      await user.click(button("Choose backup file"));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Couldn't read that file");
      expect(alert.textContent).toContain("That file is not a Craftly backup.");
      await user.click(button("Try again"));
      expect(button("Choose backup file")).toBeTruthy();
    });

    it("shows that it is reading the file, and Cancel stops that", async () => {
      const user = setup();
      let signal!: AbortSignal;
      stubFilePicker([backupFile()]);
      vi.mocked(inspectBackup).mockImplementation(
        (_file, given) =>
          new Promise((_, reject) => {
            signal = given!.signal!;
            signal.addEventListener("abort", () => reject(new BackupError("cancelled")));
          }),
      );
      mount();
      await user.click(button("Choose backup file"));
      expect(await within(dialog()).findByText("Reading the backup…")).toBeTruthy();
      await user.click(button("Cancel"));
      await waitFor(() => expect(button("Choose backup file")).toBeTruthy());
      expect(signal.aborted).toBe(true);
      expect(dialog().querySelector("[role=alert]")).toBeNull();
    });

    it("does not show a browser's own error text when reading the file fails for another reason", async () => {
      const user = setup();
      stubFilePicker([backupFile()]);
      vi.mocked(inspectBackup).mockRejectedValueOnce(new Error("NotReadableError: gone"));
      mount();
      await user.click(button("Choose backup file"));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Something went wrong while reading that file.");
      expect(alert.textContent).not.toContain("NotReadableError");
    });

    it("says that a backup of nothing holds nothing", async () => {
      const user = setup();
      await pickBackup(user, inspection({ counts: { designs: 0, trashed: 0, folders: 0, uploads: 0, versions: 0 } }));
      expect(dialog().textContent).toMatch(/holds nothing\./);
    });

    it("ignores progress that arrives after the restore was stopped", async () => {
      const user = setup();
      let options!: RestoreOptions;
      vi.mocked(restoreBackup).mockImplementation((_file, given) => {
        options = given!;
        return new Promise((_, reject) => given!.signal!.addEventListener("abort", () => reject(new BackupError("cancelled"))));
      });
      await pickBackup(user);
      await user.click(button("Restore"));
      await user.click(button("Stop"));
      await within(dialog()).findByRole("heading", { name: "Stopped" });
      act(() => options.onProgress?.({ done: 1, total: 9 }));
      expect(within(dialog()).queryByRole("progressbar")).toBeNull();
      expect(within(dialog()).getByRole("heading", { name: "Stopped" })).toBeTruthy();
    });

    it("restores, shows how far it is, and then what came back", async () => {
      const user = setup();
      const run = deferred<RestoreResult>();
      let options!: RestoreOptions;
      vi.mocked(restoreBackup).mockImplementation((_file, given) => {
        options = given!;
        return run.promise;
      });
      await pickBackup(user);
      await user.click(button("Restore"));

      expect(restoreBackup).toHaveBeenCalledWith(expect.any(File), expect.objectContaining({ signal: expect.any(AbortSignal) }));
      expect(within(dialog()).getByRole("progressbar", { name: "Restore progress" })).toBeTruthy();
      act(() => options.onProgress?.({ done: 3, total: 9 }));
      expect(dialog().textContent).toContain("Adding to your library: 3 of 9");
      expect(within(dialog()).getByRole("progressbar").getAttribute("aria-valuenow")).toBe("33");

      run.resolve(restored());
      expect(await within(dialog()).findByRole("heading", { name: "Restore finished" })).toBeTruthy();
      expect(dialog().textContent).toContain("Added: 2 designs, 1 folder, 3 uploads, 4 saved versions, your brand kit.");

      await user.click(button("Open Projects"));
      expect(window.location.hash).toBe("#/projects");
      expect(onClose).toHaveBeenCalled();
    });

    it("tells about copies, what was already here, and what could not be read", async () => {
      const user = setup();
      vi.mocked(restoreBackup).mockResolvedValue(
        restored({
          designs: { added: 0, copied: 2, same: 3, damaged: 1 },
          uploads: { added: 0, same: 1, damaged: 1 },
          folders: { added: 0 },
          versions: { added: 0, damaged: 0 },
          brandKit: "none",
          skipped: 1,
        }),
      );
      await pickBackup(user);
      await user.click(button("Restore"));
      await within(dialog()).findByRole("heading", { name: "Restore finished" });
      const text = dialog().textContent!;
      expect(text).not.toContain("Added:");
      expect(text).toContain("2 designs came back as copies named “… (restored)”, because they were edited after the backup.");
      expect(text).toContain("Already here: 3 designs, 1 upload.");
      expect(text).toContain("3 items could not be read, because the backup file is damaged.");
    });

    it("says what a newer Craftly made and was left out, and how to get it back", async () => {
      const user = setup();
      vi.mocked(restoreBackup).mockResolvedValue(restored({ newer: 2 }));
      await pickBackup(user);
      await user.click(button("Restore"));
      await within(dialog()).findByRole("heading", { name: "Restore finished" });
      expect(dialog().textContent).toContain(
        "2 items were made by a newer version of Craftly and were left out. Reload the page to get the newest version, then restore this backup again.",
      );
    });

    it("says it in the singular, and when the brand kit was merged", async () => {
      const user = setup();
      vi.mocked(restoreBackup).mockResolvedValue(
        restored({
          designs: { added: 1, copied: 1, same: 0, damaged: 1 },
          uploads: { added: 0, same: 0, damaged: 0 },
          folders: { added: 0 },
          versions: { added: 0, damaged: 0 },
          brandKit: "merge",
          newer: 1,
        }),
      );
      await pickBackup(user);
      await user.click(button("Restore"));
      await within(dialog()).findByRole("heading", { name: "Restore finished" });
      const text = dialog().textContent!;
      expect(text).toContain("Added: 1 design, your brand kit, merged with the one here.");
      expect(text).toContain("1 design came back as a copy named “… (restored)”, because it was edited after the backup.");
      expect(text).toContain("1 item could not be read, because the backup file is damaged.");
      expect(text).toContain("1 item was made by a newer version of Craftly and was left out.");
    });

    it("stops when Stop is pressed, and says that what was restored stays", async () => {
      const user = setup();
      vi.mocked(restoreBackup).mockImplementation(
        (_file, given) =>
          new Promise((_, reject) => {
            given!.signal!.addEventListener("abort", () => reject(new BackupError("cancelled")));
          }),
      );
      await pickBackup(user);
      await user.click(button("Restore"));
      await user.click(button("Stop"));
      expect(await within(dialog()).findByRole("heading", { name: "Stopped" })).toBeTruthy();
      expect(dialog().textContent).toContain("What was restored until now is kept.");
      await user.click(button("Done"));
      expect(onClose).toHaveBeenCalled();
    });

    it("says why the restore failed, in words", async () => {
      const user = setup();
      vi.mocked(restoreBackup).mockRejectedValueOnce(new BackupError("storage"));
      await pickBackup(user);
      await user.click(button("Restore"));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Couldn't restore");
      expect(alert.textContent).toContain("no room left");
      await user.click(button("Try again"));
      expect(button("Choose backup file")).toBeTruthy();
    });

    it("does not show a browser's own error text for a failure it does not know", async () => {
      const user = setup();
      vi.mocked(restoreBackup).mockRejectedValueOnce(new Error("DataError: key is bad"));
      await pickBackup(user);
      await user.click(button("Restore"));
      const alert = await within(dialog()).findByRole("alert");
      expect(alert.textContent).toContain("Something went wrong while restoring");
      expect(alert.textContent).toContain("restored before the problem is kept");
      expect(alert.textContent).not.toContain("DataError");
    });
  });

  describe("storage", () => {
    it("says how much room is used, and that the browser promised to keep it", async () => {
      stubStorage({ estimate: async () => ({ usage: 5 * 1024 * 1024, quota: 100 * 1024 * 1024 }), persisted: async () => true });
      await seedDesign();
      mount();
      expect(await within(dialog()).findByText("5.0 MB of 100 MB used")).toBeTruthy();
      expect(dialog().textContent).toContain("Your browser will not clear it on its own.");
      expect(within(dialog()).queryByRole("button", { name: "Protect" })).toBeNull();
      expect(dialog().textContent).not.toContain("almost full");
    });

    it("offers to ask the browser to keep it when it did not promise", async () => {
      const user = setup();
      let persisted = false;
      const persist = vi.fn(async () => (persisted = true));
      stubStorage({ estimate: async () => ({ usage: 1024, quota: 1024 * 1024 }), persisted: async () => persisted, persist });
      mount();
      expect(await within(dialog()).findByText(/may clear it when the device is low on space/)).toBeTruthy();
      await user.click(button("Protect"));
      await waitFor(() => expect(dialog().textContent).toContain("Your browser will not clear it on its own."));
      expect(persist).toHaveBeenCalledTimes(1);
    });

    it("warns when the browser's room for Craftly is nearly used up, and what to do about it", async () => {
      stubStorage({ estimate: async () => ({ usage: 85, quota: 100 }), persisted: async () => true });
      mount();
      const warning = await within(dialog()).findByText(/Storage is almost full \(85%\)/);
      expect(warning.textContent).toContain("Download a backup, then delete uploads or designs you no longer need.");
    });

    it("shows nothing about storage when the browser cannot say", async () => {
      mount();
      await seedDesign();
      await new Promise((resolve) => setTimeout(resolve, 30));
      expect(dialog().textContent).not.toContain("used");
      expect(within(dialog()).queryByRole("button", { name: "Protect" })).toBeNull();
    });

    it("leaves the promise out when the browser gives only the numbers", async () => {
      stubStorage({ estimate: async () => ({ usage: 2048, quota: 1024 * 1024 }) });
      mount();
      expect(await within(dialog()).findByText("2.0 KB of 1.0 MB used")).toBeTruthy();
      expect(dialog().textContent).not.toMatch(/clear it/);
    });

    it("leaves the numbers out when the browser gives only the promise", async () => {
      stubStorage({ persisted: async () => true });
      mount();
      await within(dialog()).findByText(/Your browser will not clear it on its own/);
      expect(dialog().textContent).not.toMatch(/\d used/);
    });
  });

  describe("closing", () => {
    it("closes from the Close button", async () => {
      const user = setup();
      mount();
      await user.click(button("Close"));
      expect(onClose).toHaveBeenCalledTimes(1);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("closes on Escape while nothing is running", async () => {
      const user = setup();
      mount();
      await user.keyboard("{Escape}");
      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it("starts at the beginning each time it is opened", async () => {
      const user = setup();
      await seedDesign();
      vi.mocked(createBackup).mockResolvedValue(created());
      const view = mount();
      await waitFor(() => expect((button("Download backup") as HTMLButtonElement).disabled).toBe(false));
      await user.click(button("Download backup"));
      await within(dialog()).findByText("Backup downloaded");
      await user.click(button("Close"));
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await user.click(screen.getByRole("button", { name: "Open it again" }));
      expect(button("Download backup")).toBeTruthy();
      expect(dialog().textContent).not.toContain("Backup downloaded");
      view.unmount();
    });

    it("does not close on Escape while a backup is being made, but the Close button stops it", async () => {
      const user = setup();
      await seedDesign();
      let signal!: AbortSignal;
      vi.mocked(createBackup).mockImplementation(
        (given) =>
          new Promise((_, reject) => {
            signal = given!.signal!;
            signal.addEventListener("abort", () => reject(new BackupError("cancelled")));
          }),
      );
      mount();
      await waitFor(() => expect((button("Download backup") as HTMLButtonElement).disabled).toBe(false));
      await user.click(button("Download backup"));
      await user.keyboard("{Escape}");
      expect(onClose).not.toHaveBeenCalled();
      expect(signal.aborted).toBe(false);
      await user.click(button("Close"));
      expect(onClose).toHaveBeenCalledTimes(1);
      expect(signal.aborted).toBe(true);
    });

    it("stops a running restore when the dialog goes away", async () => {
      const user = setup();
      let signal!: AbortSignal;
      stubFilePicker([backupFile()]);
      vi.mocked(inspectBackup).mockResolvedValue(inspection());
      vi.mocked(restoreBackup).mockImplementation(
        (_file, given) =>
          new Promise((_, reject) => {
            signal = given!.signal!;
            signal.addEventListener("abort", () => reject(new BackupError("cancelled")));
          }),
      );
      const view = mount();
      await user.click(button("Choose backup file"));
      await within(dialog()).findByRole("heading", { name: "Ready to restore" });
      await user.click(button("Restore"));
      view.unmount();
      expect(signal.aborted).toBe(true);
    });
  });
});
