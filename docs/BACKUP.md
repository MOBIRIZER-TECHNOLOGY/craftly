# Backup and restore

Everything Craftly stores lives in the browser (IndexedDB). Clearing the site's data, resetting the browser or moving to another computer would take it away. **Back up & restore**, in the account menu (the round avatar at the bottom of the left bar, or at the top right on a phone), writes the whole library to one file and brings it back. This page says what the file holds, how a restore treats what is already there, and where the code and its tests are.

## Using it

- **Back up everything.** "Download backup" saves `Craftly backup 2026-11-08.zip` (the day it was made). A bar shows how far it is, Cancel stops it, and nothing is downloaded when it stops. Keep the file somewhere safe: a cloud drive or an external disk.
- **Restore from a backup.** "Choose backup file" reads the file and only then says what a restore would do: what will be added, what is here already, which designs were edited since and will come back as copies. Nothing is changed until you press Restore. A progress bar and Stop follow; Stop keeps whatever was read until then.
- **A reminder when the last backup is old.** The dashboard shows one quiet line above the page: "Your last backup is 3 weeks old. 12 designs changed since.", with **Back up now** and **Remind me later**. Back up now opens this dialog and starts the backup; Remind me later keeps it away for a week. The rules are under [The reminder](#the-reminder). The first card of the dialog chooses the interval: 1 week, 2 weeks (the start), 1 month, or Never.
- **Keep a backup file up to date** (Chrome and Edge only). "Choose a file to keep up to date" opens the browser's "Save as" dialog once and writes a first backup into the file. From then on **Back up now** replaces what is in that file with a new backup, with no download to find and file away. The card shows the file's name and when it was last written; **Stop using this file** forgets the file and leaves it where it is. "Download backup" stays next to it. See [The chosen file](#the-chosen-file) for what the browser allows and what it does not: Craftly writes when you press the button, never on its own.
- The dialog also says when the last backup was made (it is remembered in this browser), how much room Craftly uses, and warns from 80 % of the room the browser allows. **Protect** asks the browser not to clear the data when the device is low on space. Craftly asks the same, once, the first time a design is saved (`askForPersistentStorageOnce` in `src/core/storage.ts`, called by `saveDesign`); Chrome usually answers without asking, Firefox asks the person.

## What is in a backup

In: every design, the trash included, with its pages, folder, star and dates, as stored; the dashboard preview of each design; every uploaded picture, byte for byte, also those that no design uses; every uploaded font file (Brand kit > Your fonts), also those that no design uses; folders; the brand kit (only when this browser saved one of its own); and the saved versions of each design (the Version history list, up to 25 per design; the versions that crash recovery makes, "Before the problem" and "Before going back", are in it like any other, see [`CRASH-RECOVERY.md`](CRASH-RECOVERY.md)).

Not in: the list of problems that Craftly wrote down on this device (`localStorage`, key `craftly.problems.v1`), the crash counts of a tab (`sessionStorage`, key `craftly.crashes.v1`), favourite templates, recent colours, the backup reminder's interval and snooze and the file chosen to be kept up to date (`meta` keys `backupReminder` and `backupFile`: both mean something only to this browser), the editor's own preferences (such as whether the left bar is open), the on-device AI models (88.1 MB and 4.9 MB: **File > On-device models** downloads them again) and the app itself.

**An account and its sync are not in a backup** ([`ACCOUNTS.md`](ACCOUNTS.md)). Left out: the session (`meta` key `cloudSession`, the token that lets whoever holds it in, with the server's address and the teams), the store `sync` (what the server has of each design: its revision, the details last in step, deletions not sent yet), and the cursors of the changes feed and the folders last in step (`meta` keys `cloudCursors`, `cloudFolders`). They belong to this browser, and a backup is a file that may travel. The designs of the account and of its teams are in a backup like any other design, with their previews, uploads, folders and versions, but not which space they belong to: restored, in this browser or another, a design is on that device only, and is in an account again only when it is moved in. A restore never touches the copy on the server. A backup of a team's designs holds what the team made: keep it as you would keep the team's files. `src/cloud/backup.dom.test.ts` checks that a backup holds no session, no sync record and no space.

## The file

A backup is an ordinary ZIP that any unzip tool opens. Nothing is compressed: pictures are compressed already, and a stored archive can be written and read without holding it in memory.

```
craftly-backup.json            the manifest (always the first file): what is in the archive, and the small things
designs/<id>.json              one design each, with live credentials omitted (pictures are stored separately)
previews/<id>.jpg              the dashboard thumbnail of a design
uploads/<id>.<ext>             an uploaded picture, as it was uploaded
fonts/<id>.<ext>               an uploaded font file, as it was uploaded (only in a library that has any; the manifest then lists them under "fonts")
versions/<designId>/<n>.json   one saved version of a design, newest first (n = 0, 1, 2 ...)
```

The manifest lists every file, so a restore never has to guess from names:

```json
{
  "craftlyBackup": 1,
  "app": "Craftly",
  "exportedAt": "2026-11-08T12:30:00.000Z",
  "designs": [{ "id": "d_x", "title": "Poster", "createdAt": 1, "updatedAt": 2, "trashed": false, "folderId": "f_y", "file": "designs/d_x.json", "preview": "previews/d_x.jpg" }],
  "uploads": [{ "id": "a_z", "name": "Logo", "kind": "image", "mime": "image/png", "size": 9, "width": 64, "height": 32, "createdAt": 5, "file": "uploads/a_z.png" }],
  "folders": [{ "id": "f_y", "name": "Work", "createdAt": 3, "parentId": null }],
  "versions": [{ "id": "d_x:1731000000000", "designId": "d_x", "createdAt": 1731000000000, "label": "first", "file": "versions/d_x/0.json" }],
  "brandKit": { "colors": ["#7c3aed"], "fonts": ["Lora"], "logos": ["a_z"] }
}
```

`craftlyBackup` is the format version (1). A file with a higher number is refused with "made by a newer version of Craftly", so an old app never half-reads a new file. A design inside a backup has a version of its own (`docs/MIGRATIONS.md`): each is brought up to date as it is restored, and one that a newer release made is left out, counted apart from the damaged ones ("N items were made by a newer version of Craftly and were left out"). A backup copies the designs of the library as they are stored, a newer one included, so nothing an older tab cannot read is lost. Ids are kept as they were: a design, an upload and a folder come back under the ids they had, which is how a design finds its pictures again, a brand kit its logos and a saved version its design. A backup made in one browser and restored in another therefore gives the same links (`#/design/<id>`).

Backups omit active live links and credentials from designs and saved versions. A restored design is an independent local copy. The ZIP includes shared pictures that this browser has already cached in its library. The room on the collaboration server and the tab's pending replay queue are separate. Restore also discards embedded live links from older backups. Handle an older backup that contains keys as a secret.

Limits: one ZIP holds at most 4 GB and 65,535 files. A library that is larger gets a plain message ("larger than one backup file can hold") before any packing, with the advice to delete uploads you no longer need or to save the biggest designs one by one (**Share > Save project file**).

## Restoring

A restore only ever adds. It never overwrites and never deletes.

| In the backup | What a restore does |
| --- | --- |
| A design that is not here | Added under its own id, with its trash, star, folder and dates as in the backup |
| A design that is here and has the same last-edited time | Left alone ("already here") |
| A design that is here but differs (edited since, or the backup is the older state) | The backup's version is added as a second design named "... (restored)", with a new id. The one that is here is not touched, and neither is its history |
| A folder, an upload | Added when its id is not here; one that is here is left alone. A design whose folder did not come back goes to the top level; a folder whose parent is missing, or that would sit inside itself, goes to the top level. An upload is checked like a new upload (`checkUpload` in `src/core/assets.ts`): an SVG that is more than plain drawing comes back as a PNG picture, and one that cannot be drawn is counted with the damaged files |
| Saved versions | Added for every design that is here under its own id (new or unchanged), when the version is not here yet. Not for the copy of an edited design |
| The brand kit | Taken as it is when this browser never saved one; otherwise the colours, fonts and logos that are missing are added to the end |
| An uploaded font | Added under the id, family name and date it had, when this library has neither that file nor another one for the same family, weight and style. It is checked like an upload first (its first bytes, then loaded with the browser's FontFace) and is never taken under the name of a bundled family; one that is refused is counted with what could not be read |

Things that can be wrong, and what the person is told:

| Problem | Result |
| --- | --- |
| Not a ZIP, or a ZIP without the manifest, or a manifest that is not ours | "That file is not a Craftly backup." |
| A newer format version | "This backup was made by a newer version of Craftly. Update the app, then try again." |
| The manifest is damaged (its checksum does not match) | "This backup is damaged." (the file is named) |
| One design, picture or version is damaged or missing | It is skipped and counted: "3 items could not be read, because the backup file is damaged." The rest is restored |
| An entry in the manifest with an id that is not safe (see below), with no file name, or with an id that an earlier entry of the same list already has | Skipped and counted as "could not be used"; the first entry of a repeated id is the one that is used |
| Encrypted, ZIP64 (over 4 GB) or multi-part archive | Said not to be supported |
| The browser has no room left | "Your browser has no room left for this. Free some space and try again." What was restored until then stays |
| Cancelled | What was read until then is kept; nothing is half written, because every group of up to 20 designs (25 pictures) is written in one transaction |

The file is treated as untrusted, like a `.craftly` file: ids may only use letters, digits, `_`, `:` and `-` (they end up in links and file names); every design goes through the same checks as a project file (an element that would crash the painter is dropped, sizes are bounded); every file in the archive is checked against its CRC-32 as it is read; a compressed file may unpack to at most 512 MB and may not unpack to more than it says (no zip bombs); a JSON file is read up to 64 MB.

A backup that was unzipped and zipped again by Explorer, Finder or 7-Zip still restores: the reader understands deflate, files inside a folder (it finds the manifest at any depth) and extra header fields.

## The reminder

`backupReminder` in `src/dashboard/backupReminder.ts` decides, from the time, the time of the last backup, the designs outside the trash and the person's settings, and from nothing else:

| Situation | Shown? |
| --- | --- |
| Reminders are set to Never, or there is no design outside the trash | No |
| "Remind me later" was pressed less than a week ago | No |
| A backup was made, and it is younger than the interval (14 days unless chosen otherwise) | No |
| A backup was made, it is at least as old as the interval, and no design was made or edited since | No: the file still holds every design. Uploads and the brand kit are not looked at |
| A backup was made, it is at least as old as the interval, and designs changed since | Yes: "Your last backup is 3 weeks old. 12 designs changed since." |
| No backup was ever made in this browser, the oldest design is under 3 days old and there are fewer than 5 designs | No: a library that was just started is left alone |
| No backup was ever made in this browser, and the oldest design is 3 days old or there are 5 designs | Yes: "You have not backed up in this browser yet. Your 6 designs live only here." |

It is a line in the page, never a dialog, and only on the dashboard, never in the editor. It is shown at most once per visit: after it went away (a backup was made, Remind me later, reminders turned off) it does not come back until the page is loaded again. A restore into a browser that never made a backup starts a week of quiet, so that someone who has just restored is not told that they have no backup. A snooze that would end more than eight days from now, or a backup dated in the future, comes from a clock that was changed: the snooze is not believed and the backup is taken as fresh.

What is remembered is in the library's `meta` store, not in `localStorage`, so it goes with the designs it is about: `lastBackupAt` (the time of the last backup, as before) and `backupReminder` (`{ intervalDays, snoozedUntil }`). The number of changed designs is not stored: it is counted from the designs' own last-edited times. For screen readers the line is a polite `status` region that is on the page from the start; it never takes the focus, and after Remind me later the focus stays at its place on the page.

## The chosen file

This uses the File System Access API (`showSaveFilePicker`), which Chrome and Edge have. Firefox and Safari do not: there the card is not shown, nothing else changes, and "Download backup" works as before. There is no stand-in for them.

- **The file is remembered as a handle** in the `meta` store under `backupFile` (`{ handle, name, writtenAt }`). The browser does not tell a page where the file is, only its name.
- **Permission is the browser's.** Choosing the file allows writing to it for now. Later, often after the browser was restarted, the browser wants to ask again, and it only lets a page ask right after a click. So **Back up now** in the dialog asks (before the backup is made, because making it can take longer than a click stays fresh), and nothing else does. The reminder's Back up now writes to the file straight away when the browser still allows it; when it does not, the dialog opens and says "Press “Back up now” so that your browser lets Craftly write to …", and that one more click asks. A person who says no gets a line saying so, and no backup is made.
- **No backups on a timer.** A page cannot get the permission back on its own after a restart, so a backup "every night" would work until the browser is closed and then stop without a word. What is built is the honest version: one click, from the reminder or the dialog.
- **A failed write leaves the old backup.** `createWritable()` writes to a temporary file, and the browser puts it in the place of the real one when the stream is closed. `writeBackupFile` never uses `keepExistingData`, and it gives a stream up (`abort()`) instead of closing it when anything went wrong or Cancel was pressed. What the person is told: the file was not found ("It may have been moved, renamed or deleted, or its disk is not connected"), the browser did not allow it, there is no room left where the file is kept, or "Writing “…” did not finish. The backup that was in the file before is unchanged." "Download backup" is still there after each of them.
- **One file, one backup.** Each backup replaces the one before. A file on the same disk as the browser is lost together with it: the dialog says to keep it in a folder that a cloud drive copies, or on an external disk.

## Why it is built this way

- **A ZIP, not one JSON file.** A `.craftly` file embeds pictures as base64 text, which is a third bigger and has to be built as one string; a library with a few hundred megabytes of photos would not fit in one (a JavaScript string tops out around 512 MB) and would freeze the tab. A ZIP keeps each picture as a Blob that is never copied, is read one file at a time, and can be opened by hand by someone who does not trust the app.
- **Add, never replace.** A backup is what people reach for when something went wrong, and a restore that overwrites can be the second thing that goes wrong. Keeping both versions of an edited design costs a copy to delete; replacing one costs the edit.
- **The manifest is the index.** It carries the titles, times and counts, so the dialog can say what a restore would do after reading one small file, and a restore does not depend on how an archive tool names or orders its files.
- **Batches.** A write of 500 designs one by one would make the dashboard reload its lists 500 times; the library notifies once per batch.

## Where it is

| File | What it holds |
| --- | --- |
| `src/export/zip.ts`, `zipRead.ts` | the ZIP writer (stored files, Blob parts) and the reader (file list from the end of the archive, slices, CRC check, stored and deflate) |
| `src/export/backupFormat.ts` | the pure half: names, the manifest and its validation, and the rules of a restore (`planRestore`, `designAction`, `mergeBrandKit`, `foldersToRestore`) |
| `src/export/backup.ts` | `createBackup`, `inspectBackup`, `restoreBackup` and the time of the last backup (the IndexedDB half) |
| `src/export/projectFormat.ts` | `parseStoredDesign`: a design as the library stores it, checked as strictly as a project file |
| `src/core/library.ts`, `assets.ts`, `persistence.ts` | `restoreRecords`, `restoreAssets` (one transaction, one notification), `getStoredBrandKit`, `dbGetAllKeys` |
| `src/core/storage.ts` | storage estimate, the request to keep the data, the 80 % rule |
| `src/dashboard/BackupDialog.tsx` | the dialog (opened from `Shell.tsx`, loaded when first used) |
| `src/dashboard/backupReminder.ts` | the pure rules of the reminder and its words |
| `src/dashboard/backupReminderState.ts` | what the reminder remembers (`meta`), the once-per-visit rule, and the request that opens the dialog from the notice |
| `src/dashboard/BackupReminderNotice.tsx` | the line on the dashboard (rendered by `Dashboard.tsx`) |
| `src/dashboard/backupFile.ts` | the chosen file: choosing, remembering and forgetting it, the permission, the write |

Tests: `zipRead.test.ts` (archives built the way other tools build them, `src/test/zipBuilder.ts`), `backupFormat.test.ts`, `backup.test.ts` (a library with designs, trash, folders, uploads, versions and a brand kit is backed up, wiped and restored; damaged and cancelled and re-zipped files), `storage.test.ts`, `BackupDialog.test.tsx`, `backupReminder.test.ts` (every rule), `BackupReminderNotice.test.tsx`, `BackupReminder.app.test.tsx` (the notice in the whole app: on the dashboard, not in the editor), `backupFile.dom.test.ts` and `BackupDialog.file.test.tsx` (a stand-in for the file: permission granted, to be asked, refused; a write that fails midway; a file that is gone; Cancel while writing), and the browser journey `e2e/backup.cjs` (a backup made in one browser profile, restored in an empty one, restored twice, a file that is not a backup, a damaged file, the dialog on a phone).

**When you add something that is stored**, a new IndexedDB store or a new key in the `meta` store, decide whether it belongs in the backup and say so here. `core/persistence.dom.test.ts` pins the list of stores, so a new store fails a test that points here.

## Not checked

- **Other browsers.** The journey ran in Chrome only. Firefox and Safari should work (the writer uses nothing newer than Blobs and a download link; reading a backup that another tool compressed needs `DecompressionStream`, Firefox 113 and Safari 16.4, and says so when it is missing), but nobody has tried.
- **A big library.** The tests and the journey use a few dozen files. The design keeps memory to about one picture at a time and writes in batches, but a library of a gigabyte or more was not made or restored, and neither was a restore into a browser whose storage was nearly full (only the message for the browser's "no room" error is tested).
- **Two tabs.** A restore never overwrites, so a design that is edited in another tab while the restore runs is not lost, but that was reasoned out and not tried.

- **The chosen file in a real browser.** Everything about it was tested against a stand-in object in jsdom, which has no File System Access API. Not tried in Chrome or Edge: the "Save as" dialog, the browser's permission question and how long a permission lasts, that IndexedDB stores the handle and gives it back after a restart, that a failed write really leaves the old file (this is what the API promises; the code only makes sure never to close a failed stream), a file on a disk that was unplugged, and how the new card and the reminder look. `e2e/backup.cjs` and `e2e/dashboard.cjs` were not run with these changes.
- **The reminder with a screen reader**, and its contrast and target sizes on the screen: they come from the tokens (28 px buttons, `--c-ink-2` on `--c-bg-subtle`), not from a measurement.

## Not done

- Backups on a timer, with no click at all (see [The chosen file](#the-chosen-file) for why), and a choice of several files or a folder of dated backups.
- Backups over 4 GB (they would have to be split over several files), and encryption.
- Cloud sync, which needs a server.
