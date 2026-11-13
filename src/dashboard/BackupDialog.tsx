import { useEffect, useId, useRef, useState } from "react";
import { HardDrive } from "lucide-react";
import { requestPersistence, storageIsNearlyFull, storageStatus, type StorageStatus } from "@/core/storage";
import {
  BackupError,
  createBackup,
  getLastBackupAt,
  inspectBackup,
  markBackedUp,
  restoreBackup,
  type BackupCounts,
  type BackupInspection,
  type BackupProgress,
  type BrandKitAction,
  type RestorePlan,
  type RestoreResult,
} from "@/export/backup";
import { downloadBlob } from "@/export/download";
import { navigate } from "@/router";
import { Button, IconAlert, IconDownload, IconSuccess, IconUpload, IconWarning, Modal, Progress, Segmented, Spinner } from "@/ui";
import { BackupFileError, canKeepBackupFile, chooseBackupFile, forgetBackupFile, getKeptBackupFile, writeBackupFile, writePermission, type KeptBackupFile } from "./backupFile";
import type { ReminderInterval } from "./backupReminder";
import { noteBackedUp, setReminderInterval, snoozeBackupReminder, useReminderState } from "./backupReminderState";
import { useAssets, useDesigns, useFolders } from "./data";
import { pickFiles } from "./files";
import { formatBytes, formatRelative, plural } from "./format";
import "./BackupDialog.css";

type Phase =
  | { name: "idle" }
  | { name: "backing-up"; progress: BackupProgress | null; /** the chosen file that is being written, once the backup is packed */ writing?: string }
  | { name: "backed-up"; fileName: string; bytes: number; counts: BackupCounts; /** the chosen file it was written to; null for a download */ savedTo: string | null }
  | { name: "reading" }
  | { name: "review"; file: File; found: BackupInspection }
  | { name: "restoring"; progress: { done: number; total: number } | null }
  | { name: "restored"; result: RestoreResult }
  | { name: "stopped" }
  | { name: "failed"; title: string; message: string };

const IDLE: Phase = { name: "idle" };
const ACCEPT = ".zip,application/zip,application/x-zip-compressed";
const REMINDER_OPTIONS: Array<{ value: ReminderInterval; label: string }> = [
  { value: 7, label: "1 week" },
  { value: 14, label: "2 weeks" },
  { value: 30, label: "1 month" },
  { value: 0, label: "Never" },
];

/* ------------------------------------------------------------------ */
/* Words                                                              */
/* ------------------------------------------------------------------ */

/** "2 designs, 1 in the trash, 1 folder, 3 uploads, 4 saved versions": whatever is not zero. */
function describeCounts(counts: BackupCounts): string {
  return [
    counts.designs && plural(counts.designs, "design"),
    counts.trashed && `${counts.trashed} in the trash`,
    counts.folders && plural(counts.folders, "folder"),
    counts.uploads && plural(counts.uploads, "upload"),
    counts.fonts && plural(counts.fonts, "uploaded font"),
    counts.versions && plural(counts.versions, "saved version"),
  ]
    .filter(Boolean)
    .join(", ");
}

const brandKitWords = (action: BrandKitAction) => (action === "restore" ? "your brand kit" : action === "merge" ? "your brand kit, merged with the one here" : "");

function listOf(n: { designs: number; folders: number; uploads: number; fonts?: number; versions: number; brandKit: BrandKitAction }): string {
  return [
    n.designs && plural(n.designs, "design"),
    n.folders && plural(n.folders, "folder"),
    n.uploads && plural(n.uploads, "upload"),
    n.fonts && plural(n.fonts, "uploaded font"),
    n.versions && plural(n.versions, "saved version"),
    brandKitWords(n.brandKit),
  ]
    .filter(Boolean)
    .join(", ");
}

/** What is already in the library: designs, folders, uploads and uploaded fonts that need nothing. */
const alreadyHere = (n: { designs: number; folders: number; uploads: number; fonts?: number }) =>
  [n.designs && plural(n.designs, "design"), n.folders && plural(n.folders, "folder"), n.uploads && plural(n.uploads, "upload"), n.fonts && plural(n.fonts, "uploaded font")]
    .filter(Boolean)
    .join(", ");

function reviewFacts(plan: RestorePlan, skipped: number): string[] {
  const facts: string[] = [];
  const added = listOf({
    designs: plan.designs.add,
    folders: plan.folders.add,
    uploads: plan.uploads.add,
    fonts: plan.fonts?.add,
    versions: plan.versions.add,
    brandKit: plan.brandKit,
  });
  if (added) facts.push(`Will be added: ${added}.`);
  const copies = plan.designs.copy;
  if (copies === 1) facts.push("1 design has been edited since this backup. It comes back as a copy named “… (restored)”, so your edit stays.");
  else if (copies > 1) facts.push(`${copies} designs have been edited since this backup. They come back as copies named “… (restored)”, so your edits stay.`);
  const here = alreadyHere({ designs: plan.designs.same, folders: plan.folders.same, uploads: plan.uploads.same, fonts: plan.fonts?.same });
  if (here) facts.push(`Already here and left as they are: ${here}.`);
  if (skipped) facts.push(`${plural(skipped, "item")} in the backup could not be used.`);
  return facts;
}

function resultFacts(result: RestoreResult): string[] {
  const facts: string[] = [];
  const added = listOf({
    designs: result.designs.added,
    folders: result.folders.added,
    uploads: result.uploads.added,
    fonts: result.fonts?.added,
    versions: result.versions.added,
    brandKit: result.brandKit,
  });
  if (added) facts.push(`Added: ${added}.`);
  const copies = result.designs.copied;
  if (copies === 1) facts.push("1 design came back as a copy named “… (restored)”, because it was edited after the backup.");
  else if (copies > 1) facts.push(`${copies} designs came back as copies named “… (restored)”, because they were edited after the backup.`);
  const here = alreadyHere({ designs: result.designs.same, folders: 0, uploads: result.uploads.same, fonts: result.fonts?.same });
  if (here) facts.push(`Already here: ${here}.`);
  // (a font that turned out to be no font, or has the name of a bundled one, is counted here too)
  const unreadable = result.designs.damaged + result.uploads.damaged + result.versions.damaged + (result.fonts?.damaged ?? 0) + result.skipped;
  if (unreadable) facts.push(`${plural(unreadable, "item")} could not be read, because the backup file is damaged.`);
  if (result.newer) {
    const be = result.newer === 1 ? "was" : "were";
    facts.push(
      `${plural(result.newer, "item")} ${be} made by a newer version of Craftly and ${be} left out. Reload the page to get the newest version, then restore this backup again.`,
    );
  }
  return facts;
}

/** The first half of the bar is reading the library, the second half packing the file. */
function backupBar(progress: BackupProgress | null): { text: string; value?: number } {
  if (!progress) return { text: "Getting ready…" };
  const share = progress.total > 0 ? progress.done / progress.total : 1;
  return progress.phase === "collecting"
    ? { text: `Reading your library: ${progress.done} of ${progress.total}`, value: share / 2 }
    : { text: `Packing the file: ${progress.done} of ${progress.total}`, value: 0.5 + share / 2 };
}

function backupDate(exportedAt: string): string {
  const when = new Date(exportedAt);
  return when.getTime() > 0 ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(when) : "";
}

/* ------------------------------------------------------------------ */
/* Dialog                                                             */
/* ------------------------------------------------------------------ */

/**
 * "Back up & restore": one file with the whole library, and the way back. Opened from the account menu, and by the
 * dashboard's backup reminder, which sets `startNow`: the backup then starts as the dialog opens.
 */
export function BackupDialog({ open, onClose, startNow = false }: { open: boolean; onClose: () => void; startNow?: boolean }) {
  const [phase, setPhase] = useState<Phase>(IDLE);
  const [lastBackup, setLastBackup] = useState<number | null | undefined>(undefined);
  const [storage, setStorage] = useState<StorageStatus | null>(null);
  const [asking, setAsking] = useState(false);
  // the file that "Back up now" writes to: undefined until it was looked up, null when there is none
  const [kept, setKept] = useState<KeptBackupFile | null | undefined>(undefined);
  const [fileNote, setFileNote] = useState<string | null>(null);
  const canKeepFile = canKeepBackupFile();
  const reminder = useReminderState();
  const started = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const visible = useRef(open);
  const titleId = useId();

  const { active, trashed, ready: designsReady } = useDesigns();
  const { folders } = useFolders();
  const { assets } = useAssets();
  const live: BackupCounts = { designs: active.length, trashed: trashed.length, folders: folders.length, uploads: assets.length, versions: 0 };
  const nothingToBackUp = designsReady && active.length + trashed.length + assets.length === 0;

  const cannotBackUp = !designsReady || nothingToBackUp;
  const busy = phase.name === "backing-up" || phase.name === "reading" || phase.name === "restoring";

  const stopWork = () => {
    abort.current?.abort();
    abort.current = null;
  };
  const begin = () => {
    stopWork();
    started.current = true; // whatever the person starts by hand, the reminder's own start is no longer wanted
    abort.current = new AbortController();
    return abort.current.signal;
  };

  // every visit starts at the beginning, and a dialog that goes away takes its work with it
  useEffect(() => {
    visible.current = open;
    if (!open) {
      stopWork();
      return;
    }
    setPhase(IDLE);
    setFileNote(null);
    started.current = false;
    let live = true;
    if (canKeepBackupFile()) void getKeptBackupFile().then((file) => live && setKept(file));
    else setKept(null);
    getLastBackupAt().then(
      (value) => live && setLastBackup(value),
      () => live && setLastBackup(null),
    );
    void storageStatus().then((status) => live && setStorage(status));
    return () => {
      live = false;
    };
  }, [open]);
  useEffect(
    () => () => {
      abort.current?.abort();
    },
    [],
  );

  // the keyboard follows the screen: each step puts its main button under the cursor
  useEffect(() => {
    body.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus();
  }, [phase.name]);

  const close = () => {
    stopWork();
    onClose();
  };

  const fail = (error: unknown, title: string, fallback: string) => {
    if (error instanceof BackupError && error.code === "cancelled") return false;
    setPhase({ name: "failed", title, message: error instanceof BackupError ? error.message : fallback });
    return true;
  };

  /** Makes the backup and hands it over: into `target`, the file the person chose to keep up to date, or as a download. */
  const startBackup = async (target: KeptBackupFile | null = null) => {
    const signal = begin();
    setFileNote(null);
    setPhase({ name: "backing-up", progress: null });
    try {
      const made = await createBackup({ signal, onProgress: (progress) => setPhase((now) => (now.name === "backing-up" ? { name: "backing-up", progress } : now)) });
      if (target) {
        setPhase({ name: "backing-up", progress: null, writing: target.name });
        setKept(await writeBackupFile(target, made.blob, { signal }));
      } else downloadBlob(made.blob, made.fileName);
      const when = Date.now();
      await markBackedUp(when).catch(() => undefined); // the file is on its way whether or not this is remembered
      setLastBackup(when);
      noteBackedUp(when);
      setPhase({ name: "backed-up", fileName: made.fileName, bytes: made.blob.size, counts: made.counts, savedTo: target ? target.name : null });
    } catch (error) {
      if (error instanceof BackupFileError) {
        if (error.code === "cancelled") setPhase(IDLE);
        else setPhase({ name: "failed", title: "Couldn't write the backup file", message: error.message });
      } else if (!fail(error, "Couldn't back up", "Something went wrong while making the backup. Nothing was changed.")) setPhase(IDLE);
    }
  };

  /**
   * "Back up now": into the chosen file. The browser's permission comes first, before the backup is made: it may only
   * be asked for right after a click (`clicked`), and making the backup can take longer than a click stays fresh.
   */
  const backUpToFile = async (target: KeptBackupFile, clicked: boolean) => {
    setFileNote(null);
    const permission = await writePermission(target.handle, clicked);
    if (!visible.current) return;
    if (permission === "granted") await startBackup(target);
    else if (permission === "denied")
      setFileNote(`Your browser did not allow Craftly to write to “${target.name}”. Press “Back up now” to be asked again, or download the backup.`);
    else setFileNote(`Press “Back up now” so that your browser lets Craftly write to “${target.name}”.`);
  };

  const chooseFileToKeep = async () => {
    try {
      // straight from the click: the browser only opens its "Save as" dialog for a click
      const chosen = await chooseBackupFile();
      if (!chosen || !visible.current) return;
      setKept(chosen);
      // the file the browser just made is empty: a first backup goes into it now, while the permission is fresh
      if (!cannotBackUp) await startBackup(chosen);
    } catch (error) {
      setPhase({ name: "failed", title: "Couldn't use that file", message: error instanceof BackupFileError ? error.message : "Something went wrong with that file." });
    }
  };

  const stopUsingFile = async () => {
    await forgetBackupFile().catch(() => undefined);
    setKept(null);
    setFileNote(null);
  };

  // The dashboard's reminder opened the dialog with "Back up now": start once what is needed is known. A chosen file is
  // only written when the browser still allows it; that click was on another button a moment ago, so nothing is asked.
  useEffect(() => {
    // An empty library may only be a list that is still being read again, so it does not use the one start up.
    if (!open || !startNow || started.current || !designsReady || kept === undefined || nothingToBackUp) return;
    started.current = true;
    if (kept) void backUpToFile(kept, false);
    else void startBackup();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs once per opening, when the library and the chosen file are known
  }, [open, startNow, designsReady, kept, nothingToBackUp]);

  const chooseFile = () => {
    // straight from the click: the browser only opens its file dialog for a click
    void pickFiles({ accept: ACCEPT }).then(async ([file]) => {
      if (!file || !visible.current) return; // a file chosen after the dialog was closed is not wanted
      const signal = begin();
      setPhase({ name: "reading" });
      try {
        setPhase({ name: "review", file, found: await inspectBackup(file, { signal }) });
      } catch (error) {
        if (!fail(error, "Couldn't read that file", "Something went wrong while reading that file.")) setPhase(IDLE);
      }
    });
  };

  const startRestore = async (file: File) => {
    const signal = begin();
    setPhase({ name: "restoring", progress: null });
    try {
      const result = await restoreBackup(file, { signal, onProgress: (progress) => setPhase((now) => (now.name === "restoring" ? { name: "restoring", progress } : now)) });
      setPhase({ name: "restored", result });
      // A browser that never made a backup has just been filled from one: "you have not backed up yet" can wait a week.
      if (lastBackup === null) void snoozeBackupReminder();
    } catch (error) {
      if (!fail(error, "Couldn't restore", "Something went wrong while restoring. Anything restored before the problem is kept.")) setPhase({ name: "stopped" });
    }
  };

  const protect = async () => {
    setAsking(true);
    await requestPersistence().catch(() => false);
    setStorage(await storageStatus());
    setAsking(false);
  };

  // while the chosen file is written there is nothing to count: the browser writes it in one piece
  const bar = phase.name !== "backing-up" ? null : phase.writing ? { text: `Writing “${phase.writing}”…`, value: undefined } : backupBar(phase.progress);
  const restoreProgress = phase.name === "restoring" ? phase.progress : null;
  const nearlyFull = storage ? storageIsNearlyFull(storage) : false;
  const showStorage = storage !== null && (storage.usage !== undefined || storage.persisted !== undefined);

  return (
    <Modal open={open} onClose={close} title="Back up & restore" size="md" className="cf-backup-modal" closeOnEscape={!busy} closeOnBackdrop={!busy}>
      <div className="cf-backup" ref={body}>
        {phase.name === "idle" ? (
          <>
            <p className="cf-backup__lead">
              Your designs, uploads and brand kit live only in this browser. A backup is one file that holds all of it: keep a copy somewhere safe, or use it to move to another
              browser or computer.
            </p>

            <section className="cf-backup__card" aria-labelledby={`${titleId}-backup`}>
              <h3 className="cf-backup__title" id={`${titleId}-backup`}>
                Back up everything
              </h3>
              <p className="cf-backup__text">{nothingToBackUp ? "Nothing to back up yet." : describeCounts(live)}</p>
              {lastBackup === undefined ? null : <p className="cf-backup__when">{lastBackup === null ? "No backup yet" : `Last backup: ${formatRelative(lastBackup)}`}</p>}
              <div className="cf-backup__actions">
                <Button
                  variant={kept ? "secondary" : "primary"}
                  icon={<IconDownload aria-hidden="true" />}
                  disabled={cannotBackUp}
                  onClick={() => void startBackup()}
                  data-autofocus={cannotBackUp || kept ? undefined : true}
                >
                  Download backup
                </Button>
              </div>
              <div className="cf-backup__remind">
                <p className="cf-backup__remind-label" id={`${titleId}-remind`}>
                  Remind me when my last backup is older than
                </p>
                <Segmented
                  size="sm"
                  aria-label="Remind me when my last backup is older than"
                  value={reminder.settings.intervalDays}
                  options={REMINDER_OPTIONS}
                  onChange={(days) => void setReminderInterval(days)}
                />
                <p className="cf-backup__when">A quiet line on the dashboard, and only when designs changed since the last backup.</p>
              </div>
            </section>

            {canKeepFile ? (
              <section className="cf-backup__card" aria-labelledby={`${titleId}-keep`}>
                <h3 className="cf-backup__title" id={`${titleId}-keep`}>
                  Keep a backup file up to date
                </h3>
                {kept ? (
                  <>
                    <p className="cf-backup__text">
                      “{kept.name}”, {kept.writtenAt === null ? "nothing written to it yet" : `last written ${formatRelative(kept.writtenAt)}`}.
                    </p>
                    <p className="cf-backup__when">
                      “Back up now” replaces what is in the file with a new backup, with no download. Craftly writes when you press the button, not on its own, and your browser may
                      ask you to allow it again.
                    </p>
                  </>
                ) : (
                  <p className="cf-backup__text">
                    Choose a file once, and “Back up now” writes each new backup into it, with no download to find and file away. Craftly writes when you press the button, not on
                    its own: a browser lets a page write to your file only after a click.
                  </p>
                )}
                <div role="status">{fileNote ? <p className="cf-backup__note">{fileNote}</p> : null}</div>
                <div className="cf-backup__actions">
                  {kept ? (
                    <>
                      <Button variant="ghost" onClick={() => void stopUsingFile()}>
                        Stop using this file
                      </Button>
                      <Button variant="primary" disabled={cannotBackUp} onClick={() => void backUpToFile(kept, true)} data-autofocus={cannotBackUp ? undefined : true}>
                        Back up now
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => void chooseFileToKeep()}>Choose a file to keep up to date</Button>
                  )}
                </div>
              </section>
            ) : null}

            <section className="cf-backup__card" aria-labelledby={`${titleId}-restore`}>
              <h3 className="cf-backup__title" id={`${titleId}-restore`}>
                Restore from a backup
              </h3>
              <p className="cf-backup__text">Adds everything in a backup file that is not here yet. Nothing you have now is replaced or deleted.</p>
              <div className="cf-backup__actions">
                <Button icon={<IconUpload aria-hidden="true" />} onClick={chooseFile} data-autofocus={cannotBackUp ? true : undefined}>
                  Choose backup file
                </Button>
              </div>
            </section>

            {showStorage ? (
              <div className="cf-backup__storage">
                <span className="cf-backup__storage-icon" aria-hidden="true">
                  <HardDrive />
                </span>
                <div className="cf-backup__storage-text">
                  {storage.usage !== undefined && storage.quota !== undefined ? (
                    <p className="cf-backup__storage-title">
                      {formatBytes(storage.usage)} of {formatBytes(storage.quota)} used
                    </p>
                  ) : null}
                  {storage.persisted === undefined ? null : (
                    <p className="cf-backup__storage-sub">
                      {storage.persisted ? "Your browser will not clear it on its own." : "Your browser may clear it when the device is low on space."}
                    </p>
                  )}
                </div>
                {storage.persisted === false ? (
                  <Button size="sm" variant="soft" loading={asking} onClick={() => void protect()}>
                    Protect
                  </Button>
                ) : null}
              </div>
            ) : null}
            {nearlyFull && storage?.usage !== undefined && storage.quota ? (
              <p className="cf-backup__warning" role="status">
                <IconWarning aria-hidden="true" />
                <span>Storage is almost full ({Math.round((storage.usage / storage.quota) * 100)}%). Download a backup, then delete uploads or designs you no longer need.</span>
              </p>
            ) : null}
          </>
        ) : null}

        {phase.name === "backing-up" && bar ? (
          <>
            <div role="status">
              <h3 className="cf-backup__title">Backing up…</h3>
            </div>
            <Progress label="Backup progress" value={bar.value} />
            <p className="cf-backup__text">{bar.text}</p>
            <div className="cf-backup__actions">
              <Button onClick={() => stopWork()} data-autofocus>
                Cancel
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "backed-up" ? (
          <>
            <div className="cf-backup__done" role="status">
              <IconSuccess className="cf-backup__done-icon" aria-hidden="true" />
              <h3 className="cf-backup__title">{phase.savedTo === null ? "Backup downloaded" : "Backup saved"}</h3>
            </div>
            <p className="cf-backup__text">
              {phase.savedTo === null ? phase.fileName : `“${phase.savedTo}”`}, {formatBytes(phase.bytes)}. It holds {describeCounts(phase.counts) || "nothing"}.
            </p>
            <p className="cf-backup__text">
              {phase.savedTo === null
                ? "Keep it somewhere safe, such as a cloud drive or an external disk. To get everything back, choose “Restore from a backup”."
                : "It replaced the backup that was in the file before. A file on this computer is lost with the computer: keep it in a folder that a cloud drive copies, or on an external disk."}
            </p>
            <div className="cf-backup__actions">
              <Button onClick={() => setPhase(IDLE)}>Make another backup</Button>
              <Button variant="primary" onClick={close} data-autofocus>
                Done
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "reading" ? (
          <>
            <div className="cf-backup__reading" role="status">
              <Spinner size={18} />
              <h3 className="cf-backup__title">Reading the backup…</h3>
            </div>
            <div className="cf-backup__actions">
              <Button onClick={() => stopWork()} data-autofocus>
                Cancel
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "review" ? (
          <>
            <h3 className="cf-backup__title">{phase.found.plan.nothingNew ? "Nothing to restore" : "Ready to restore"}</h3>
            <p className="cf-backup__text">
              {backupDate(phase.found.exportedAt) ? `Backup from ${backupDate(phase.found.exportedAt)}. It holds` : "This backup holds"}{" "}
              {describeCounts(phase.found.counts) || "nothing"}.
            </p>
            {phase.found.plan.nothingNew ? <p className="cf-backup__text">Everything in this backup is already here.</p> : null}
            <ul className="cf-backup__facts">
              {reviewFacts(phase.found.plan, phase.found.skipped).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <div className="cf-backup__actions">
              {phase.found.plan.nothingNew ? (
                <>
                  <Button onClick={() => setPhase(IDLE)}>Choose another file</Button>
                  <Button variant="primary" onClick={close} data-autofocus>
                    Done
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => setPhase(IDLE)}>Cancel</Button>
                  <Button variant="primary" onClick={() => void startRestore(phase.file)} data-autofocus>
                    Restore
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}

        {phase.name === "restoring" ? (
          <>
            <div role="status">
              <h3 className="cf-backup__title">Restoring…</h3>
            </div>
            <Progress label="Restore progress" value={restoreProgress && restoreProgress.total > 0 ? restoreProgress.done / restoreProgress.total : undefined} />
            <p className="cf-backup__text">{restoreProgress ? `Adding to your library: ${restoreProgress.done} of ${restoreProgress.total}` : "Getting ready…"}</p>
            <div className="cf-backup__actions">
              <Button onClick={() => stopWork()} data-autofocus>
                Stop
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "restored" ? (
          <>
            <div className="cf-backup__done" role="status">
              <IconSuccess className="cf-backup__done-icon" aria-hidden="true" />
              <h3 className="cf-backup__title">Restore finished</h3>
            </div>
            <ul className="cf-backup__facts">
              {resultFacts(phase.result).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <div className="cf-backup__actions">
              <Button onClick={close}>Done</Button>
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  navigate("/projects");
                }}
                data-autofocus
              >
                Open Projects
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "stopped" ? (
          <>
            <div role="status">
              <h3 className="cf-backup__title">Stopped</h3>
            </div>
            <p className="cf-backup__text">What was restored until now is kept.</p>
            <div className="cf-backup__actions">
              <Button variant="primary" onClick={close} data-autofocus>
                Done
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "failed" ? (
          <>
            <div className="cf-backup__problem" role="alert">
              <IconAlert className="cf-backup__problem-icon" aria-hidden="true" />
              <div>
                <h3 className="cf-backup__title">{phase.title}</h3>
                <p className="cf-backup__text">{phase.message}</p>
              </div>
            </div>
            <div className="cf-backup__actions">
              <Button variant="primary" onClick={() => setPhase(IDLE)} data-autofocus>
                Try again
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
