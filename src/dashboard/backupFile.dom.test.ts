import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { metaGet, metaSet } from "@/core/persistence";
import {
  BackupFileError,
  canKeepBackupFile,
  chooseBackupFile,
  forgetBackupFile,
  getKeptBackupFile,
  writeBackupFile,
  writePermission,
  type BackupFileHandle,
  type KeptBackupFile,
  type WritableBackupStream,
} from "./backupFile";

/**
 * The library's `meta` store, as a Map. The real one copies what it stores (structured clone), and a stand-in handle
 * made of functions cannot be copied; a real FileSystemFileHandle can. So what is pinned here is what is asked of the
 * store, not that a browser can store a handle (see "Not checked" in docs/BACKUP.md).
 */
const meta = new Map<string, unknown>();
vi.mock("@/core/persistence", () => ({
  metaGet: vi.fn(async (key: string, fallback: unknown) => (meta.has(key) ? meta.get(key) : fallback)),
  metaSet: vi.fn(async (key: string, value: unknown) => void meta.set(key, value)),
}));

const domError = (name: string) => new DOMException(`the browser's own words for ${name}`, name);

/** A file on disk that swaps its content only when the stream is closed, like the real one. */
function standIn(over: { permission?: PermissionState; afterAsking?: PermissionState | Error; name?: string } = {}) {
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
      if (over.afterAsking instanceof Error) throw over.afterAsking;
      permission = over.afterAsking ?? permission;
      return permission;
    }),
    createWritable: vi.fn(async (): Promise<WritableBackupStream> => stream),
  };
  return { handle: handle satisfies BackupFileHandle, stream, disk };
}
const kept = (handle: BackupFileHandle, writtenAt: number | null = null): KeptBackupFile => ({ handle, name: handle.name, writtenAt });
const backup = () => new Blob(["the new backup"], { type: "application/zip" });

type PickerWindow = { showSaveFilePicker?: unknown };
const setPicker = (picker: unknown) => Object.defineProperty(window, "showSaveFilePicker", { configurable: true, writable: true, value: picker });

beforeEach(() => {
  meta.clear();
  vi.mocked(metaGet).mockClear();
  vi.mocked(metaSet).mockClear();
});

afterEach(() => {
  delete (window as PickerWindow).showSaveFilePicker;
});

describe("canKeepBackupFile", () => {
  it("is false where the browser cannot save to a chosen file (Firefox, Safari)", () => {
    expect(canKeepBackupFile()).toBe(false);
  });

  it("is true where it can (Chrome, Edge)", () => {
    setPicker(vi.fn());
    expect(canKeepBackupFile()).toBe(true);
  });
});

describe("chooseBackupFile", () => {
  it("asks for a zip file to save to, and remembers the one that was chosen", async () => {
    const { handle } = standIn({ name: "My designs.zip" });
    const picker = vi.fn(async () => handle);
    setPicker(picker);
    const chosen = await chooseBackupFile();
    expect(chosen).toEqual({ handle, name: "My designs.zip", writtenAt: null });
    expect(picker).toHaveBeenCalledWith({ suggestedName: "Craftly backup.zip", types: [{ description: "Craftly backup", accept: { "application/zip": [".zip"] } }] });
    expect(await getKeptBackupFile()).toEqual(chosen);
    expect(meta.get("backupFile")).toEqual(chosen);
  });

  it("gives nothing, and remembers nothing, when the file dialog is cancelled", async () => {
    setPicker(vi.fn().mockRejectedValue(domError("AbortError")));
    expect(await chooseBackupFile()).toBeNull();
    expect(await getKeptBackupFile()).toBeNull();
  });

  it("says in plain words that the file dialog could not be opened", async () => {
    setPicker(vi.fn().mockRejectedValue(domError("SecurityError")));
    const error = await chooseBackupFile().catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupFileError);
    expect((error as BackupFileError).code).toBe("failed");
    expect((error as BackupFileError).message).toBe("Your browser did not open its file dialog. Try again, or download the backup.");
  });

  it("says when the chosen file cannot be remembered, and does not pretend it was", async () => {
    const { handle } = standIn();
    setPicker(vi.fn(async () => handle));
    vi.mocked(metaSet).mockRejectedValueOnce(domError("DataCloneError"));
    const error = await chooseBackupFile().catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("failed");
    expect((error as BackupFileError).message).toBe("Craftly could not remember that file in this browser. Download the backup instead.");
    expect(await getKeptBackupFile()).toBeNull();
  });

  it("gives nothing where the browser has no such dialog", async () => {
    expect(await chooseBackupFile()).toBeNull();
  });
});

describe("getKeptBackupFile", () => {
  it("is null when no file was chosen", async () => {
    expect(await getKeptBackupFile()).toBeNull();
  });

  it("is null for anything in its place that is not a file to write to", async () => {
    for (const stored of ["Craftly backup.zip", { name: "x.zip" }, { handle: null, name: "x.zip" }, { handle: { name: "x.zip" }, name: "x.zip", writtenAt: 1 }]) {
      meta.set("backupFile", stored);
      expect(await getKeptBackupFile()).toBeNull();
    }
  });

  it("takes the name from the file itself and a missing time for never written", async () => {
    const { handle } = standIn({ name: "On disk.zip" });
    meta.set("backupFile", { handle, name: 7, writtenAt: "then" });
    expect(await getKeptBackupFile()).toEqual({ handle, name: "On disk.zip", writtenAt: null });
  });

  it("is null when the library cannot be read", async () => {
    vi.mocked(metaGet).mockRejectedValueOnce(new Error("closed"));
    expect(await getKeptBackupFile()).toBeNull();
  });
});

describe("forgetBackupFile", () => {
  it("stops using the file and leaves the file itself alone", async () => {
    const { handle, disk } = standIn();
    meta.set("backupFile", kept(handle, 5));
    await forgetBackupFile();
    expect(await getKeptBackupFile()).toBeNull();
    expect(disk.content).toBe("the old backup");
    expect(handle.createWritable).not.toHaveBeenCalled();
  });
});

describe("writePermission", () => {
  it("is granted without asking when the browser still allows writing", async () => {
    const { handle } = standIn({ permission: "granted" });
    expect(await writePermission(handle, true)).toBe("granted");
    expect(handle.queryPermission).toHaveBeenCalledWith({ mode: "readwrite" });
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it("does not ask when there was no click, and says that one is needed", async () => {
    const { handle } = standIn({ permission: "prompt" });
    expect(await writePermission(handle, false)).toBe("needs-click");
    expect(handle.requestPermission).not.toHaveBeenCalled();
  });

  it("asks after a click, and is granted when the person allows it", async () => {
    const { handle } = standIn({ permission: "prompt", afterAsking: "granted" });
    expect(await writePermission(handle, true)).toBe("granted");
    expect(handle.requestPermission).toHaveBeenCalledWith({ mode: "readwrite" });
  });

  it("is denied when the person says no", async () => {
    const { handle } = standIn({ permission: "prompt", afterAsking: "denied" });
    expect(await writePermission(handle, true)).toBe("denied");
  });

  it("asks again after a click when it was denied before: the person may have changed their mind", async () => {
    const { handle } = standIn({ permission: "denied", afterAsking: "granted" });
    expect(await writePermission(handle, false)).toBe("needs-click");
    expect(await writePermission(handle, true)).toBe("granted");
  });

  it("needs another click when the browser's question was closed without an answer", async () => {
    const { handle } = standIn({ permission: "prompt", afterAsking: "prompt" });
    expect(await writePermission(handle, true)).toBe("needs-click");
  });

  it("needs another click when the browser refuses to ask (the click was too long ago)", async () => {
    const { handle } = standIn({ permission: "prompt", afterAsking: domError("SecurityError") });
    expect(await writePermission(handle, true)).toBe("needs-click");
  });

  it("takes a browser that cannot say for one that has to be asked", async () => {
    const { handle } = standIn({ afterAsking: "granted" });
    handle.queryPermission.mockRejectedValueOnce(domError("NotFoundError"));
    expect(await writePermission(handle, false)).toBe("needs-click");
  });
});

describe("writeBackupFile", () => {
  it("writes the backup through a stream, closes it, and remembers when", async () => {
    const { handle, stream, disk } = standIn();
    meta.set("backupFile", kept(handle));
    const after = await writeBackupFile(kept(handle), backup(), { now: 1234 });
    expect(disk.content).toBe("the new backup");
    expect(stream.close).toHaveBeenCalledTimes(1);
    expect(stream.abort).not.toHaveBeenCalled();
    expect(after).toEqual({ handle, name: "Craftly backup.zip", writtenAt: 1234 });
    expect(await getKeptBackupFile()).toEqual(after);
  });

  it("never asks to keep what the file held: the new backup replaces it whole or not at all", async () => {
    const { handle } = standIn();
    await writeBackupFile(kept(handle), backup());
    expect(handle.createWritable).toHaveBeenCalledWith();
  });

  it("leaves the old backup in the file when writing fails midway, and says so", async () => {
    const { handle, stream, disk } = standIn();
    stream.write.mockImplementationOnce(async () => {
      stream.pending = "half of the new";
      throw domError("InvalidStateError");
    });
    const error = await writeBackupFile(kept(handle, 99), backup()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(BackupFileError);
    expect((error as BackupFileError).code).toBe("failed");
    expect((error as BackupFileError).message).toBe(
      "Writing “Craftly backup.zip” did not finish. The backup that was in the file before is unchanged. Try again, or download the backup.",
    );
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(stream.close).not.toHaveBeenCalled();
    expect(disk.content).toBe("the old backup");
    expect(metaSet).not.toHaveBeenCalled();
  });

  it("leaves the old backup when the swap at the end fails, even if giving up fails too", async () => {
    const { handle, stream, disk } = standIn();
    stream.close.mockRejectedValueOnce(domError("NoModificationAllowedError"));
    stream.abort.mockRejectedValueOnce(new TypeError("the stream is closed"));
    const error = await writeBackupFile(kept(handle), backup()).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("failed");
    expect(disk.content).toBe("the old backup");
  });

  it("says that the disk is full", async () => {
    const { handle, stream } = standIn();
    stream.write.mockRejectedValueOnce(domError("QuotaExceededError"));
    const error = await writeBackupFile(kept(handle), backup()).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("no-room");
    expect((error as BackupFileError).message).toBe("There is no room left where “Craftly backup.zip” is kept. The backup that was in the file before is unchanged.");
  });

  it("says that the file is gone when it was moved, renamed or deleted", async () => {
    const { handle } = standIn({ name: "Old place.zip" });
    handle.createWritable.mockRejectedValueOnce(domError("NotFoundError"));
    const error = await writeBackupFile(kept(handle), backup()).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("gone");
    expect((error as BackupFileError).message).toBe(
      "Craftly could not find “Old place.zip”. It may have been moved, renamed or deleted, or its disk is not connected. Choose the file again, or download the backup.",
    );
  });

  it("says that the browser did not allow it", async () => {
    const { handle } = standIn();
    handle.createWritable.mockRejectedValueOnce(domError("NotAllowedError"));
    const error = await writeBackupFile(kept(handle), backup()).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("denied");
    expect((error as BackupFileError).message).toBe("Your browser did not let Craftly write to “Craftly backup.zip”. Allow it when the browser asks, or download the backup.");
  });

  it("does not show the browser's own words for a failure it does not know", async () => {
    const { handle } = standIn();
    handle.createWritable.mockRejectedValueOnce("nope");
    const error = await writeBackupFile(kept(handle), backup()).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("failed");
    expect((error as BackupFileError).message).not.toContain("nope");
  });

  it("throws the half-written file away when the backup is cancelled, and keeps the old one", async () => {
    const { handle, stream, disk } = standIn();
    const stop = new AbortController();
    stream.write.mockImplementationOnce(async () => stop.abort());
    const error = await writeBackupFile(kept(handle), backup(), { signal: stop.signal }).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("cancelled");
    expect(stream.abort).toHaveBeenCalledTimes(1);
    expect(disk.content).toBe("the old backup");
  });

  it("does not start when the backup was cancelled already", async () => {
    const { handle } = standIn();
    const stop = new AbortController();
    stop.abort();
    const error = await writeBackupFile(kept(handle), backup(), { signal: stop.signal }).catch((e: unknown) => e);
    expect((error as BackupFileError).code).toBe("cancelled");
    expect(handle.createWritable).not.toHaveBeenCalled();
  });

  it("has written the file even when the time cannot be remembered", async () => {
    const { handle, disk } = standIn();
    vi.mocked(metaSet).mockRejectedValueOnce(new Error("no room"));
    const after = await writeBackupFile(kept(handle), backup(), { now: 77 });
    expect(disk.content).toBe("the new backup");
    expect(after.writtenAt).toBe(77);
  });
});
