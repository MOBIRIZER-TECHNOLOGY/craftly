import { useRef } from "react";
import { m } from "@/i18n";
import { Button, IconArchive } from "@/ui";
import { reminderWords } from "./backupReminder";
import { openBackupDialog, snoozeBackupReminder, useBackupReminder } from "./backupReminderState";
import { useNow } from "./data";
import "./BackupReminderNotice.css";

/**
 * The quiet line at the top of the dashboard when the last backup is old (the rules are in backupReminder.ts). It is
 * never a dialog and never on the editor's screen, and it takes nothing from the keyboard: the region is a polite
 * status that is on the page from the start, so a screen reader says the words when they arrive and no more.
 */
export function BackupReminderNotice() {
  const reminder = useBackupReminder();
  const now = useNow();
  const region = useRef<HTMLDivElement>(null);

  const later = () => {
    // The button under the keyboard is about to go. Focus stays at this place of the page, so the next Tab goes on
    // from here and not from the top.
    region.current?.focus();
    void snoozeBackupReminder();
  };

  return (
    <div className="cf-dremind-region" role="status" aria-label={m.dashboard.reminder.label} tabIndex={-1} ref={region}>
      {reminder ? (
        <div className="cf-dremind">
          <IconArchive className="cf-dremind__icon" aria-hidden="true" />
          <p className="cf-dremind__text">{reminderWords(reminder, now)}</p>
          <div className="cf-dremind__actions">
            <Button size="sm" variant="secondary" onClick={() => openBackupDialog({ start: true })}>
              {m.dashboard.shared.backUpNow}
            </Button>
            <Button size="sm" variant="ghost" onClick={later}>
              {m.dashboard.reminder.later}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
