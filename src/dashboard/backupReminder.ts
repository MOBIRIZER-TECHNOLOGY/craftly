/**
 * When the dashboard reminds a person to back up, and in which words. Pure: the answer depends only on the time, the
 * time of the last backup, the designs and the person's settings, so every rule has a test (backupReminder.test.ts).
 * Reading and writing the settings is in backupReminderState.ts.
 *
 * The rules:
 *   - nothing when reminders are off, when there is no design outside the trash, or while a "Remind me later" runs;
 *   - a backup was made: remind when it is at least as old as the interval (14 days unless chosen otherwise) and at
 *     least one design was made or edited since. When nothing changed, the file still holds every design;
 *   - no backup was ever made here: remind once the oldest design is 3 days old or there are 5 designs. A library
 *     that someone started a minute ago is left alone.
 */

import { m } from "@/i18n";

const DAY_MS = 86_400_000;

/** The intervals the dialog offers, in days. 0 turns reminders off. */
export const REMINDER_INTERVALS = [7, 14, 30, 0] as const;
export type ReminderInterval = (typeof REMINDER_INTERVALS)[number];

export const SNOOZE_DAYS = 7;
const NEVER_MIN_AGE_DAYS = 3;
const NEVER_MIN_DESIGNS = 5;

export interface ReminderSettings {
  intervalDays: ReminderInterval;
  /** "Remind me later" was pressed: nothing is shown before this time */
  snoozedUntil: number | null;
}

export const DEFAULT_REMINDER_SETTINGS: ReminderSettings = { intervalDays: 14, snoozedUntil: null };

/** The settings as stored in the `meta` store, with the defaults for anything that is missing or not understood. */
export function readReminderSettings(stored: unknown): ReminderSettings {
  if (typeof stored !== "object" || stored === null) return DEFAULT_REMINDER_SETTINGS;
  const { intervalDays, snoozedUntil } = stored as { intervalDays?: unknown; snoozedUntil?: unknown };
  const interval = REMINDER_INTERVALS.find((days) => days === intervalDays);
  return {
    intervalDays: interval ?? DEFAULT_REMINDER_SETTINGS.intervalDays,
    snoozedUntil: typeof snoozedUntil === "number" && Number.isFinite(snoozedUntil) ? snoozedUntil : null,
  };
}

export const snoozedUntil = (now: number): number => now + SNOOZE_DAYS * DAY_MS;

export interface ReminderInput {
  now: number;
  /** when the last backup was made in this browser, or null when none was */
  lastBackupAt: number | null;
  /** the designs that are not in the trash */
  designs: ReadonlyArray<{ createdAt: number; updatedAt: number }>;
  settings: ReminderSettings;
}

export type BackupReminder = { kind: "old"; lastBackupAt: number; changed: number } | { kind: "never"; designs: number };

export function backupReminder({ now, lastBackupAt, designs, settings }: ReminderInput): BackupReminder | null {
  if (settings.intervalDays === 0 || designs.length === 0) return null;
  // A snooze never ends later than a week from now. One that does was set under another clock, and is not believed:
  // otherwise a clock that was once wrong by a year would keep the reminder away for a year. A day of slack, because
  // the dashboard's "now" is refreshed once a minute and so is a little behind the moment the button was pressed.
  const snooze = settings.snoozedUntil;
  if (snooze !== null && snooze > now && snooze <= snoozedUntil(now) + DAY_MS) return null;

  if (lastBackupAt === null) {
    const oldest = Math.min(...designs.map((design) => design.createdAt));
    return designs.length >= NEVER_MIN_DESIGNS || now - oldest >= NEVER_MIN_AGE_DAYS * DAY_MS ? { kind: "never", designs: designs.length } : null;
  }
  if (now - lastBackupAt < settings.intervalDays * DAY_MS) return null;
  const changed = designs.filter((design) => design.updatedAt > lastBackupAt).length;
  return changed > 0 ? { kind: "old", lastBackupAt, changed } : null;
}

/** "13 days", "3 weeks", "6 months", "over a year": never more exact than a person would say it. */
function ageWords(ms: number): string {
  const words = m.dashboard.reminder;
  const days = Math.floor(ms / DAY_MS);
  if (days < 14) return words.days(days);
  if (days < 60) return words.weeks(Math.floor(days / 7));
  if (days < 365) return words.months(Math.floor(days / 30));
  return words.overAYear;
}

export function reminderWords(reminder: BackupReminder, now: number): string {
  if (reminder.kind === "never") return m.dashboard.reminder.never(reminder.designs);
  return m.dashboard.reminder.old(ageWords(now - reminder.lastBackupAt), reminder.changed);
}
