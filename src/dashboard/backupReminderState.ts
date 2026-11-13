/**
 * What the backup reminder remembers, and the request to open "Back up & restore" from somewhere other than the
 * account menu. A module store, like createDialogState.ts: the notice on the dashboard, the dialog and the shell all
 * read it, and none of them is the parent of the others.
 *
 * Kept in the library's `meta` store, so it lives and dies with the designs it is about:
 *   - "lastBackupAt": when the last backup was made (written by `markBackedUp` in src/export/backup.ts);
 *   - "backupReminder": the interval the person chose and the end of a "Remind me later".
 * How many designs changed since the backup is not stored: it is counted from the designs' own last-edited times.
 *
 * The backup code itself (the ZIP writer and reader) is only loaded with the dialog, so this file reads the time of
 * the last backup by its key and does not import src/export/backup.ts. A test pins that the two agree.
 */
import { useEffect, useSyncExternalStore } from "react";
import { metaGet, metaSet } from "@/core/persistence";
import { backupReminder, DEFAULT_REMINDER_SETTINGS, readReminderSettings, snoozedUntil, type BackupReminder, type ReminderInterval, type ReminderSettings } from "./backupReminder";
import { useDesigns, useNow } from "./data";

const LAST_BACKUP_KEY = "lastBackupAt";
const SETTINGS_KEY = "backupReminder";

/* ------------------------------------------------------------------ */
/* What is remembered                                                 */
/* ------------------------------------------------------------------ */

export interface ReminderState {
  /** false until the `meta` store was read; nothing is shown before, and nothing when it cannot be read */
  ready: boolean;
  lastBackupAt: number | null;
  settings: ReminderSettings;
}

const INITIAL: ReminderState = { ready: false, lastBackupAt: null, settings: DEFAULT_REMINDER_SETTINGS };

let state: ReminderState = INITIAL;
const listeners = new Set<() => void>();
/** The notice was on the screen during this visit, and it went away: it does not come back before the page is loaded again. */
let shown = false;
let closed = false;

function publish(next: ReminderState): void {
  state = next;
  listeners.forEach((listener) => listener());
}

async function load(): Promise<void> {
  try {
    const [last, settings] = await Promise.all([metaGet<unknown>(LAST_BACKUP_KEY, null), metaGet<unknown>(SETTINGS_KEY, null)]);
    publish({ ready: true, lastBackupAt: typeof last === "number" && Number.isFinite(last) ? last : null, settings: readReminderSettings(settings) });
  } catch {
    // a library that cannot be read has its own notice (StorageNotice); a reminder to back it up would be noise
  }
}

function subscribe(callback: () => void): () => void {
  listeners.add(callback);
  // read again whenever the first reader arrives: another tab, or a restore, may have changed it since
  if (listeners.size === 1) void load();
  return () => listeners.delete(callback);
}

const getState = () => state;

export function useReminderState(): ReminderState {
  return useSyncExternalStore(subscribe, getState, getState);
}

/** A backup was just made. The dialog writes the time to the library itself (`markBackedUp`); this tells the notice. */
export function noteBackedUp(when: number): void {
  publish({ ...state, lastBackupAt: when });
}

async function saveSettings(settings: ReminderSettings): Promise<void> {
  publish({ ...state, settings });
  // when it cannot be written the choice still holds for this visit, and is only not remembered
  await metaSet(SETTINGS_KEY, settings).catch(() => undefined);
}

/** "Remind me later": quiet for a week. */
export const snoozeBackupReminder = (now: number = Date.now()) => saveSettings({ ...state.settings, snoozedUntil: snoozedUntil(now) });

export const setReminderInterval = (intervalDays: ReminderInterval) => saveSettings({ ...state.settings, intervalDays });

/**
 * The reminder to show on the dashboard now, or null. It is shown at most once per visit: after it went away (a backup
 * was made, "Remind me later", reminders turned off) it stays away until the page is loaded again, whatever happens.
 */
export function useBackupReminder(): BackupReminder | null {
  const { ready, lastBackupAt, settings } = useReminderState();
  const { active, ready: designsReady, error } = useDesigns();
  const now = useNow();
  const known = ready && designsReady && !error;
  const due = known ? backupReminder({ now, lastBackupAt, designs: active, settings }) : null;
  const visible = due !== null && !closed;
  useEffect(() => {
    if (visible) shown = true;
    else if (known && shown) closed = true;
  }, [visible, known]);
  return visible ? due : null;
}

/* ------------------------------------------------------------------ */
/* Opening the dialog from the notice                                 */
/* ------------------------------------------------------------------ */

export interface BackupDialogRequest {
  open: boolean;
  /** start a backup as soon as the dialog is open (the reminder's "Back up now") */
  start: boolean;
  /** true once it was asked for: the dialog's code is loaded then, and stays */
  loaded: boolean;
}

let request: BackupDialogRequest = { open: false, start: false, loaded: false };
const requestListeners = new Set<() => void>();

function setRequest(next: BackupDialogRequest): void {
  request = next;
  requestListeners.forEach((listener) => listener());
}

export function openBackupDialog(options: { start?: boolean } = {}): void {
  setRequest({ open: true, start: options.start ?? false, loaded: true });
}

export function closeBackupDialog(): void {
  if (request.open) setRequest({ ...request, open: false });
}

export function useBackupDialogRequest(): BackupDialogRequest {
  return useSyncExternalStore(
    (callback) => {
      requestListeners.add(callback);
      return () => requestListeners.delete(callback);
    },
    () => request,
    () => request,
  );
}

/** Back to how a freshly loaded page starts. For tests: the store outlives a test otherwise. */
export function resetBackupReminderState(): void {
  shown = false;
  closed = false;
  setRequest({ open: false, start: false, loaded: false });
  publish(INITIAL);
}
