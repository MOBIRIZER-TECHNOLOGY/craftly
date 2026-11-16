/**
 * "Keep a backup file up to date": a file the person chose once, which "Back up now" then writes to without a download
 * each time. It needs the File System Access API (`showSaveFilePicker`), which Chrome and Edge have and Firefox and
 * Safari do not; where it is missing `canKeepBackupFile()` is false and nothing of this is offered.
 *
 * The file's handle is kept in the library's `meta` store under "backupFile" (a handle can be stored in IndexedDB as
 * it is). It is not part of a backup: it means something only to this browser on this computer.
 *
 * Two things the browser decides, and this file only follows:
 *   - Permission to write lasts while the browser says so, and can only be asked for again right after a click. So
 *     nothing here writes on its own; without a click `writePermission` answers "needs-click" and never asks.
 *   - `createWritable()` writes to a temporary file and puts it in the place of the real one when the stream is
 *     closed. A write that fails or is given up leaves the old backup as it was. That is why `keepExistingData` is not
 *     used, and why a stream that failed is aborted and never closed.
 */
import { metaGet, metaSet } from "@/core/persistence";
import { m } from "@/i18n";

const KEY = "backupFile";

export interface WritableBackupStream {
  write(data: Blob): Promise<void>;
  close(): Promise<void>;
  abort(): Promise<void>;
}

/** The part of a `FileSystemFileHandle` that is used here (TypeScript's own type does not know the permission methods yet). */
export interface BackupFileHandle {
  readonly name: string;
  queryPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  requestPermission(descriptor: { mode: "readwrite" }): Promise<PermissionState>;
  createWritable(): Promise<WritableBackupStream>;
}

export interface KeptBackupFile {
  handle: BackupFileHandle;
  /** the file's name, to show; the browser does not tell a page where the file is */
  name: string;
  /** when a backup was last written to it, or null when none was */
  writtenAt: number | null;
}

type SavePicker = (options: { suggestedName: string; types: Array<{ description: string; accept: Record<string, string[]> }> }) => Promise<BackupFileHandle>;
const savePicker = (): SavePicker | null => {
  const picker = typeof window === "undefined" ? undefined : (window as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  return typeof picker === "function" ? (picker as SavePicker).bind(window) : null;
};

export const canKeepBackupFile = (): boolean => savePicker() !== null;

export type BackupFileProblem = "cancelled" | "denied" | "gone" | "no-room" | "failed";

/** Something went wrong with the chosen file. The message is for the person; the browser's own words are not in it. */
export class BackupFileError extends Error {
  readonly code: BackupFileProblem;
  constructor(code: BackupFileProblem, message: string) {
    super(message);
    this.name = "BackupFileError";
    this.code = code;
  }
}

const nameOf = (error: unknown): string => (typeof error === "object" && error !== null ? String((error as { name?: unknown }).name) : "");

function writeFailure(error: unknown, file: string): BackupFileError {
  switch (nameOf(error)) {
    case "NotFoundError":
      return new BackupFileError("gone", m.dashboard.backupFile.gone(file));
    case "NotAllowedError":
    case "SecurityError":
      return new BackupFileError("denied", m.dashboard.backupFile.denied(file));
    case "QuotaExceededError":
      return new BackupFileError("no-room", m.dashboard.backupFile.noRoom(file));
    default:
      return new BackupFileError("failed", m.dashboard.backupFile.failed(file));
  }
}

/** The file that was chosen, or null: none was, or what is stored in its place is not a file that can be written to. */
export async function getKeptBackupFile(): Promise<KeptBackupFile | null> {
  const stored = await metaGet<unknown>(KEY, null).catch(() => null);
  if (typeof stored !== "object" || stored === null) return null;
  const { handle, name, writtenAt } = stored as { handle?: Partial<BackupFileHandle> | null; name?: unknown; writtenAt?: unknown };
  if (!handle || typeof handle.createWritable !== "function" || typeof handle.queryPermission !== "function" || typeof handle.requestPermission !== "function") return null;
  return {
    handle: handle as BackupFileHandle,
    name: typeof name === "string" ? name : String(handle.name),
    writtenAt: typeof writtenAt === "number" && Number.isFinite(writtenAt) ? writtenAt : null,
  };
}

/** "Stop using this file". The file itself, and the backup in it, stay where they are. */
export const forgetBackupFile = () => metaSet(KEY, null);

/**
 * Opens the browser's "Save as" dialog and remembers the file. Call it straight from a click. Null when the dialog was
 * cancelled (or the browser has none). Choosing a file also allows writing to it, for now.
 */
export async function chooseBackupFile(): Promise<KeptBackupFile | null> {
  const picker = savePicker();
  if (!picker) return null;
  let handle: BackupFileHandle;
  try {
    handle = await picker({ suggestedName: "Craftly backup.zip", types: [{ description: m.dashboard.backupFile.pickerDescription, accept: { "application/zip": [".zip"] } }] });
  } catch (error) {
    if (nameOf(error) === "AbortError") return null;
    throw new BackupFileError("failed", m.dashboard.backupFile.noDialog);
  }
  const kept: KeptBackupFile = { handle, name: handle.name, writtenAt: null };
  try {
    await metaSet(KEY, kept);
  } catch {
    throw new BackupFileError("failed", m.dashboard.backupFile.notRemembered);
  }
  return kept;
}

/**
 * Whether the file may be written now. `mayAsk` is true only right after a click: the browser shows its question only
 * then, so without one the answer is "needs-click" and nothing is asked. A question that was closed without an answer,
 * or that the browser refused to show, also needs another click.
 */
export async function writePermission(handle: BackupFileHandle, mayAsk: boolean): Promise<"granted" | "needs-click" | "denied"> {
  const now = await handle.queryPermission({ mode: "readwrite" }).catch((): PermissionState => "prompt");
  if (now === "granted") return "granted";
  if (!mayAsk) return "needs-click";
  const answer = await handle.requestPermission({ mode: "readwrite" }).catch((): PermissionState => "prompt");
  return answer === "granted" ? "granted" : answer === "denied" ? "denied" : "needs-click";
}

/**
 * Writes a backup into the chosen file and remembers when. Throws `BackupFileError`; whenever it throws, the file holds
 * what it held before.
 */
export async function writeBackupFile(kept: KeptBackupFile, backup: Blob, options: { signal?: AbortSignal; now?: number } = {}): Promise<KeptBackupFile> {
  const { signal, now = Date.now() } = options;
  const cancelled = () => new BackupFileError("cancelled", m.dashboard.backupFile.cancelled);
  if (signal?.aborted) throw cancelled();
  let stream: WritableBackupStream;
  try {
    stream = await kept.handle.createWritable();
  } catch (error) {
    throw writeFailure(error, kept.name);
  }
  try {
    await stream.write(backup);
    if (signal?.aborted) throw cancelled();
    await stream.close();
  } catch (error) {
    // giving up throws the temporary file away; a stream that already failed may refuse even that, and nothing is lost by it
    await stream.abort().catch(() => undefined);
    throw error instanceof BackupFileError ? error : writeFailure(error, kept.name);
  }
  const written: KeptBackupFile = { ...kept, writtenAt: now };
  // the file is written whether or not the time is remembered
  await metaSet(KEY, written).catch(() => undefined);
  return written;
}
