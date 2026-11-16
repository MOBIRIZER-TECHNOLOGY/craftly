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
import { restoredCopyTitle } from "@/export/backupFormat";
import { date, m } from "@/i18n";
import { navigate } from "@/router";
import { Button, IconAlert, IconDownload, IconSuccess, IconUpload, IconWarning, Modal, Progress, Segmented, Spinner } from "@/ui";
import { BackupFileError, canKeepBackupFile, chooseBackupFile, forgetBackupFile, getKeptBackupFile, writeBackupFile, writePermission, type KeptBackupFile } from "./backupFile";
import type { ReminderInterval } from "./backupReminder";
import { noteBackedUp, setReminderInterval, snoozeBackupReminder, useReminderState } from "./backupReminderState";
import { useAssets, useDesigns, useFolders } from "./data";
import { pickFiles } from "./files";
import { formatBytes, formatRelative } from "./format";
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
  { value: 7, label: m.dashboard.backup.week },
  { value: 14, label: m.dashboard.backup.twoWeeks },
  { value: 30, label: m.dashboard.backup.month },
  { value: 0, label: m.dashboard.backup.never },
];

/* ------------------------------------------------------------------ */
/* Words                                                              */
/* ------------------------------------------------------------------ */

const count = m.dashboard.counts;
const words = m.dashboard.backup;

/** "2 designs, 1 in the trash, 1 folder, 3 uploads, 4 saved versions": whatever is not zero. */
function describeCounts(counts: BackupCounts): string {
  return [
    counts.designs && count.designs(counts.designs),
    counts.trashed && words.inTrash(counts.trashed),
    counts.folders && count.folders(counts.folders),
    counts.uploads && count.uploads(counts.uploads),
    counts.fonts && count.uploadedFonts(counts.fonts),
    counts.versions && count.savedVersions(counts.versions),
  ]
    .filter(Boolean)
    .join(", ");
}

const brandKitWords = (action: BrandKitAction) => (action === "restore" ? words.yourBrandKit : action === "merge" ? words.brandKitMerged : "");

function listOf(n: { designs: number; folders: number; uploads: number; fonts?: number; versions: number; brandKit: BrandKitAction }): string {
  return [
    n.designs && count.designs(n.designs),
    n.folders && count.folders(n.folders),
    n.uploads && count.uploads(n.uploads),
    n.fonts && count.uploadedFonts(n.fonts),
    n.versions && count.savedVersions(n.versions),
    brandKitWords(n.brandKit),
  ]
    .filter(Boolean)
    .join(", ");
}

/** What is already in the library: designs, folders, uploads and uploaded fonts that need nothing. */
const alreadyHere = (n: { designs: number; folders: number; uploads: number; fonts?: number }) =>
  [n.designs && count.designs(n.designs), n.folders && count.folders(n.folders), n.uploads && count.uploads(n.uploads), n.fonts && count.uploadedFonts(n.fonts)]
    .filter(Boolean)
    .join(", ");

/** The name a design that comes back as a copy is given, with "…" for its own title. */
const copyName = restoredCopyTitle("…");

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
  if (added) facts.push(words.willBeAdded(added));
  const copies = plan.designs.copy;
  if (copies > 0) facts.push(words.editedSince(copies, copyName));
  const here = alreadyHere({ designs: plan.designs.same, folders: plan.folders.same, uploads: plan.uploads.same, fonts: plan.fonts?.same });
  if (here) facts.push(words.alreadyHereLeft(here));
  if (skipped) facts.push(words.unusable(skipped));
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
  if (added) facts.push(words.added(added));
  const copies = result.designs.copied;
  if (copies > 0) facts.push(words.cameBackAsCopies(copies, copyName));
  const here = alreadyHere({ designs: result.designs.same, folders: 0, uploads: result.uploads.same, fonts: result.fonts?.same });
  if (here) facts.push(words.alreadyHere(here));
  // (a font that turned out to be no font, or has the name of a bundled one, is counted here too)
  const unreadable = result.designs.damaged + result.uploads.damaged + result.versions.damaged + (result.fonts?.damaged ?? 0) + result.skipped;
  if (unreadable) facts.push(words.damaged(unreadable));
  if (result.newer) facts.push(words.newer(result.newer));
  return facts;
}

/** The first half of the bar is reading the library, the second half packing the file. */
function backupBar(progress: BackupProgress | null): { text: string; value?: number } {
  if (!progress) return { text: words.gettingReady };
  const share = progress.total > 0 ? progress.done / progress.total : 1;
  return progress.phase === "collecting"
    ? { text: words.readingLibrary(progress.done, progress.total), value: share / 2 }
    : { text: words.packing(progress.done, progress.total), value: 0.5 + share / 2 };
}

function backupDate(exportedAt: string): string {
  const when = new Date(exportedAt);
  return when.getTime() > 0 ? date(when, { dateStyle: "medium", timeStyle: "short" }) : "";
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
        else setPhase({ name: "failed", title: words.writeFailedTitle, message: error.message });
      } else if (!fail(error, words.backupFailedTitle, words.backupFailed)) setPhase(IDLE);
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
    else if (permission === "denied") setFileNote(words.fileDenied(target.name));
    else setFileNote(words.fileNeedsClick(target.name));
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
      setPhase({ name: "failed", title: words.useFileFailedTitle, message: error instanceof BackupFileError ? error.message : words.useFileFailed });
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
        if (!fail(error, words.readFailedTitle, words.readFailed)) setPhase(IDLE);
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
      if (!fail(error, words.restoreFailedTitle, words.restoreFailed)) setPhase({ name: "stopped" });
    }
  };

  const protect = async () => {
    setAsking(true);
    await requestPersistence().catch(() => false);
    setStorage(await storageStatus());
    setAsking(false);
  };

  // while the chosen file is written there is nothing to count: the browser writes it in one piece
  const bar = phase.name !== "backing-up" ? null : phase.writing ? { text: words.writing(phase.writing), value: undefined } : backupBar(phase.progress);
  const restoreProgress = phase.name === "restoring" ? phase.progress : null;
  const nearlyFull = storage ? storageIsNearlyFull(storage) : false;
  const showStorage = storage !== null && (storage.usage !== undefined || storage.persisted !== undefined);

  return (
    <Modal open={open} onClose={close} title={m.dashboard.account.backup} size="md" className="cf-backup-modal" closeOnEscape={!busy} closeOnBackdrop={!busy}>
      <div className="cf-backup" ref={body}>
        {phase.name === "idle" ? (
          <>
            <p className="cf-backup__lead">{words.lead}</p>

            <section className="cf-backup__card" aria-labelledby={`${titleId}-backup`}>
              <h3 className="cf-backup__title" id={`${titleId}-backup`}>
                {words.backUpEverything}
              </h3>
              <p className="cf-backup__text">{nothingToBackUp ? words.nothingToBackUp : describeCounts(live)}</p>
              {lastBackup === undefined ? null : <p className="cf-backup__when">{lastBackup === null ? words.noBackupYet : words.lastBackup(formatRelative(lastBackup))}</p>}
              <div className="cf-backup__actions">
                <Button
                  variant={kept ? "secondary" : "primary"}
                  icon={<IconDownload aria-hidden="true" />}
                  disabled={cannotBackUp}
                  onClick={() => void startBackup()}
                  data-autofocus={cannotBackUp || kept ? undefined : true}
                >
                  {words.download}
                </Button>
              </div>
              <div className="cf-backup__remind">
                <p className="cf-backup__remind-label" id={`${titleId}-remind`}>
                  {words.remindWhen}
                </p>
                <Segmented
                  size="sm"
                  aria-label={words.remindWhen}
                  value={reminder.settings.intervalDays}
                  options={REMINDER_OPTIONS}
                  onChange={(days) => void setReminderInterval(days)}
                />
                <p className="cf-backup__when">{words.remindNote}</p>
              </div>
            </section>

            {canKeepFile ? (
              <section className="cf-backup__card" aria-labelledby={`${titleId}-keep`}>
                <h3 className="cf-backup__title" id={`${titleId}-keep`}>
                  {words.keepTitle}
                </h3>
                {kept ? (
                  <>
                    <p className="cf-backup__text">{kept.writtenAt === null ? words.keptNothingYet(kept.name) : words.keptWritten(kept.name, formatRelative(kept.writtenAt))}</p>
                    <p className="cf-backup__when">{words.keptNote}</p>
                  </>
                ) : (
                  <p className="cf-backup__text">{words.keepIntro}</p>
                )}
                <div role="status">{fileNote ? <p className="cf-backup__note">{fileNote}</p> : null}</div>
                <div className="cf-backup__actions">
                  {kept ? (
                    <>
                      <Button variant="ghost" onClick={() => void stopUsingFile()}>
                        {words.stopUsingFile}
                      </Button>
                      <Button variant="primary" disabled={cannotBackUp} onClick={() => void backUpToFile(kept, true)} data-autofocus={cannotBackUp ? undefined : true}>
                        {m.dashboard.shared.backUpNow}
                      </Button>
                    </>
                  ) : (
                    <Button onClick={() => void chooseFileToKeep()}>{words.chooseFileToKeep}</Button>
                  )}
                </div>
              </section>
            ) : null}

            <section className="cf-backup__card" aria-labelledby={`${titleId}-restore`}>
              <h3 className="cf-backup__title" id={`${titleId}-restore`}>
                {words.restoreTitle}
              </h3>
              <p className="cf-backup__text">{words.restoreText}</p>
              <div className="cf-backup__actions">
                <Button icon={<IconUpload aria-hidden="true" />} onClick={chooseFile} data-autofocus={cannotBackUp ? true : undefined}>
                  {words.chooseBackupFile}
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
                    <p className="cf-backup__storage-title">{words.storageUsed(formatBytes(storage.usage), formatBytes(storage.quota))}</p>
                  ) : null}
                  {storage.persisted === undefined ? null : <p className="cf-backup__storage-sub">{storage.persisted ? words.notCleared : m.dashboard.shared.mayClear}</p>}
                </div>
                {storage.persisted === false ? (
                  <Button size="sm" variant="soft" loading={asking} onClick={() => void protect()}>
                    {m.dashboard.shared.protect}
                  </Button>
                ) : null}
              </div>
            ) : null}
            {nearlyFull && storage?.usage !== undefined && storage.quota ? (
              <p className="cf-backup__warning" role="status">
                <IconWarning aria-hidden="true" />
                <span>{words.almostFull(Math.round((storage.usage / storage.quota) * 100))}</span>
              </p>
            ) : null}
          </>
        ) : null}

        {phase.name === "backing-up" && bar ? (
          <>
            <div role="status">
              <h3 className="cf-backup__title">{words.backingUp}</h3>
            </div>
            <Progress label={words.backupProgress} value={bar.value} />
            <p className="cf-backup__text">{bar.text}</p>
            <div className="cf-backup__actions">
              <Button onClick={() => stopWork()} data-autofocus>
                {m.common.cancel}
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "backed-up" ? (
          <>
            <div className="cf-backup__done" role="status">
              <IconSuccess className="cf-backup__done-icon" aria-hidden="true" />
              <h3 className="cf-backup__title">{phase.savedTo === null ? words.downloaded : words.saved}</h3>
            </div>
            <p className="cf-backup__text">
              {words.holdsSummary(phase.savedTo === null ? phase.fileName : `“${phase.savedTo}”`, formatBytes(phase.bytes), describeCounts(phase.counts) || words.nothing)}
            </p>
            <p className="cf-backup__text">{phase.savedTo === null ? words.keepSafeDownload : words.keepSafeFile}</p>
            <div className="cf-backup__actions">
              <Button onClick={() => setPhase(IDLE)}>{words.makeAnother}</Button>
              <Button variant="primary" onClick={close} data-autofocus>
                {m.common.done}
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "reading" ? (
          <>
            <div className="cf-backup__reading" role="status">
              <Spinner size={18} />
              <h3 className="cf-backup__title">{words.readingBackup}</h3>
            </div>
            <div className="cf-backup__actions">
              <Button onClick={() => stopWork()} data-autofocus>
                {m.common.cancel}
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "review" ? (
          <>
            <h3 className="cf-backup__title">{phase.found.plan.nothingNew ? words.nothingToRestore : words.readyToRestore}</h3>
            <p className="cf-backup__text">
              {backupDate(phase.found.exportedAt)
                ? words.holdsFrom(backupDate(phase.found.exportedAt), describeCounts(phase.found.counts) || words.nothing)
                : words.holds(describeCounts(phase.found.counts) || words.nothing)}
            </p>
            {phase.found.plan.nothingNew ? <p className="cf-backup__text">{words.allHere}</p> : null}
            <ul className="cf-backup__facts">
              {reviewFacts(phase.found.plan, phase.found.skipped).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <div className="cf-backup__actions">
              {phase.found.plan.nothingNew ? (
                <>
                  <Button onClick={() => setPhase(IDLE)}>{words.chooseAnother}</Button>
                  <Button variant="primary" onClick={close} data-autofocus>
                    {m.common.done}
                  </Button>
                </>
              ) : (
                <>
                  <Button onClick={() => setPhase(IDLE)}>{m.common.cancel}</Button>
                  <Button variant="primary" onClick={() => void startRestore(phase.file)} data-autofocus>
                    {m.dashboard.shared.restore}
                  </Button>
                </>
              )}
            </div>
          </>
        ) : null}

        {phase.name === "restoring" ? (
          <>
            <div role="status">
              <h3 className="cf-backup__title">{words.restoring}</h3>
            </div>
            <Progress label={words.restoreProgress} value={restoreProgress && restoreProgress.total > 0 ? restoreProgress.done / restoreProgress.total : undefined} />
            <p className="cf-backup__text">{restoreProgress ? words.adding(restoreProgress.done, restoreProgress.total) : words.gettingReady}</p>
            <div className="cf-backup__actions">
              <Button onClick={() => stopWork()} data-autofocus>
                {words.stop}
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "restored" ? (
          <>
            <div className="cf-backup__done" role="status">
              <IconSuccess className="cf-backup__done-icon" aria-hidden="true" />
              <h3 className="cf-backup__title">{words.restoreFinished}</h3>
            </div>
            <ul className="cf-backup__facts">
              {resultFacts(phase.result).map((fact) => (
                <li key={fact}>{fact}</li>
              ))}
            </ul>
            <div className="cf-backup__actions">
              <Button onClick={close}>{m.common.done}</Button>
              <Button
                variant="primary"
                onClick={() => {
                  close();
                  navigate("/projects");
                }}
                data-autofocus
              >
                {words.openProjects}
              </Button>
            </div>
          </>
        ) : null}

        {phase.name === "stopped" ? (
          <>
            <div role="status">
              <h3 className="cf-backup__title">{words.stopped}</h3>
            </div>
            <p className="cf-backup__text">{words.keptSoFar}</p>
            <div className="cf-backup__actions">
              <Button variant="primary" onClick={close} data-autofocus>
                {m.common.done}
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
                {m.common.retry}
              </Button>
            </div>
          </>
        ) : null}
      </div>
    </Modal>
  );
}
