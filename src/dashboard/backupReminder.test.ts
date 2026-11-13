import { describe, expect, it } from "vitest";
import { backupReminder, DEFAULT_REMINDER_SETTINGS, readReminderSettings, reminderWords, snoozedUntil, type ReminderInput } from "./backupReminder";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 14, 12);
const design = (createdDaysAgo: number, editedDaysAgo: number = createdDaysAgo) => ({ createdAt: NOW - createdDaysAgo * DAY, updatedAt: NOW - editedDaysAgo * DAY });
const input = (over: Partial<ReminderInput> = {}): ReminderInput => ({
  now: NOW,
  lastBackupAt: NOW - 21 * DAY,
  designs: [design(40, 2), design(30, 25)],
  settings: DEFAULT_REMINDER_SETTINGS,
  ...over,
});

describe("backupReminder", () => {
  describe("a backup that is old", () => {
    it("reminds when the last backup is older than two weeks and a design changed since", () => {
      expect(backupReminder(input())).toEqual({ kind: "old", lastBackupAt: NOW - 21 * DAY, changed: 1 });
    });

    it("counts the designs that were made or edited after the backup", () => {
      const designs = [design(40, 2), design(5), design(1), design(30, 25)];
      expect(backupReminder(input({ designs }))).toMatchObject({ changed: 3 });
    });

    it("says nothing while the backup is younger than the interval", () => {
      expect(backupReminder(input({ lastBackupAt: NOW - 14 * DAY + 1 }))).toBeNull();
    });

    it("reminds from the moment the backup is as old as the interval", () => {
      expect(backupReminder(input({ lastBackupAt: NOW - 14 * DAY }))).not.toBeNull();
    });

    it("says nothing when no design changed since the backup: the file still holds them all", () => {
      expect(backupReminder(input({ designs: [design(40, 30), design(30, 25)] }))).toBeNull();
    });

    it("follows the interval the person chose", () => {
      const tenDays = input({ lastBackupAt: NOW - 10 * DAY });
      expect(backupReminder(tenDays)).toBeNull();
      expect(backupReminder({ ...tenDays, settings: { intervalDays: 7, snoozedUntil: null } })).not.toBeNull();
      expect(backupReminder(input({ settings: { intervalDays: 30, snoozedUntil: null } }))).toBeNull();
    });

    it("says nothing about a backup dated in the future (the clock was changed)", () => {
      expect(backupReminder(input({ lastBackupAt: NOW + 5 * DAY }))).toBeNull();
    });
  });

  describe("a library that was never backed up", () => {
    it("leaves a new, small library alone", () => {
      expect(backupReminder(input({ lastBackupAt: null, designs: [design(0), design(1), design(2), design(2.9)] }))).toBeNull();
    });

    it("reminds once the oldest design is three days old", () => {
      expect(backupReminder(input({ lastBackupAt: null, designs: [design(0), design(3)] }))).toEqual({ kind: "never", designs: 2 });
    });

    it("reminds once there are five designs, however new", () => {
      expect(backupReminder(input({ lastBackupAt: null, designs: [design(0), design(0), design(0), design(0), design(0)] }))).toEqual({ kind: "never", designs: 5 });
    });
  });

  describe("when it stays quiet", () => {
    it("says nothing when there is no design to protect", () => {
      expect(backupReminder(input({ designs: [] }))).toBeNull();
      expect(backupReminder(input({ lastBackupAt: null, designs: [] }))).toBeNull();
    });

    it("says nothing when reminders are turned off", () => {
      expect(backupReminder(input({ settings: { intervalDays: 0, snoozedUntil: null } }))).toBeNull();
      expect(backupReminder(input({ lastBackupAt: null, designs: [design(9)], settings: { intervalDays: 0, snoozedUntil: null } }))).toBeNull();
    });

    it("says nothing until the snooze is over, and reminds again afterwards", () => {
      expect(backupReminder(input({ settings: { intervalDays: 14, snoozedUntil: NOW + 1 } }))).toBeNull();
      expect(backupReminder(input({ settings: { intervalDays: 14, snoozedUntil: NOW } }))).not.toBeNull();
      expect(backupReminder(input({ settings: { intervalDays: 14, snoozedUntil: NOW - DAY } }))).not.toBeNull();
    });

    it("does not believe a snooze that ends later than a snooze can (the clock was changed)", () => {
      expect(backupReminder(input({ settings: { intervalDays: 14, snoozedUntil: NOW + 8 * DAY + 1 } }))).not.toBeNull();
    });

    it("believes a snooze that was set a moment after the time it is asked about (the dashboard's clock ticks once a minute)", () => {
      expect(backupReminder(input({ settings: { intervalDays: 14, snoozedUntil: NOW + 7 * DAY + 59_000 } }))).toBeNull();
    });
  });
});

describe("snoozedUntil", () => {
  it("is a week from now", () => {
    expect(snoozedUntil(NOW)).toBe(NOW + 7 * DAY);
  });
});

describe("reminderWords", () => {
  const old = (days: number, changed: number) => reminderWords({ kind: "old", lastBackupAt: NOW - days * DAY, changed }, NOW);

  it("says how old the backup is and how many designs changed since", () => {
    expect(old(21, 12)).toBe("Your last backup is 3 weeks old. 12 designs changed since.");
  });

  it("says it for one design", () => {
    expect(old(21, 1)).toBe("Your last backup is 3 weeks old. 1 design changed since.");
  });

  it.each([
    [7, "7 days"],
    [13, "13 days"],
    [14, "2 weeks"],
    [20, "2 weeks"],
    [59, "8 weeks"],
    [60, "2 months"],
    [200, "6 months"],
    [364, "12 months"],
    [365, "over a year"],
    [900, "over a year"],
  ])("calls %i days “%s”", (days, words) => {
    expect(old(days, 2)).toContain(`is ${words} old.`);
  });

  it("says that there is no backup yet, and what that means", () => {
    expect(reminderWords({ kind: "never", designs: 6 }, NOW)).toBe("You have not backed up in this browser yet. Your 6 designs live only here.");
    expect(reminderWords({ kind: "never", designs: 1 }, NOW)).toBe("You have not backed up in this browser yet. Your design lives only here.");
  });
});

describe("readReminderSettings", () => {
  it("starts with a reminder every two weeks and no snooze", () => {
    expect(readReminderSettings(null)).toEqual({ intervalDays: 14, snoozedUntil: null });
    expect(DEFAULT_REMINDER_SETTINGS).toEqual({ intervalDays: 14, snoozedUntil: null });
  });

  it("reads what was stored", () => {
    expect(readReminderSettings({ intervalDays: 30, snoozedUntil: 99 })).toEqual({ intervalDays: 30, snoozedUntil: 99 });
    expect(readReminderSettings({ intervalDays: 0, snoozedUntil: null })).toEqual({ intervalDays: 0, snoozedUntil: null });
  });

  it("falls back for anything it does not know", () => {
    expect(readReminderSettings("often")).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(readReminderSettings({ intervalDays: 3, snoozedUntil: "soon" })).toEqual(DEFAULT_REMINDER_SETTINGS);
    expect(readReminderSettings({ intervalDays: 7, snoozedUntil: Number.NaN })).toEqual({ intervalDays: 7, snoozedUntil: null });
  });
});
