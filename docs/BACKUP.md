# Backup and restore

Everything Craftly stores lives in the browser (IndexedDB). Clearing the site's data, resetting the browser or moving to another computer would take it away. **Back up & restore**, in the account menu (the round avatar at the bottom of the left bar, or at the top right on a phone), writes the whole library to one file and brings it back. This page says what the file holds, how a restore treats what is already there, and where the code and its tests are.

## Using it

- **Back up everything.** "Download backup" saves `Craftly backup 2026-11-08.zip` (the day it was made). A bar shows how far it is, Cancel stops it, and nothing is downloaded when it stops. Keep the file somewhere safe: a cloud drive or an external disk.
- **Restore from a backup.** "Choose backup file" reads the file and only then says what a restore would do: what will be added, what is here already, which designs were edited since and will come back as copies. Nothing is changed until you press Restore. A progress bar and Stop follow; Stop keeps whatever was read until then.
- The dialog also says when the last backup was made (it is remembered in this browser), how much room Craftly uses, and warns from 80 % of the room the browser allows. **Protect** asks the browser not to clear the data when the device is low on space. Craftly asks the same, once, the first time a design is saved (`askForPersistentStorageOnce` in `src/core/storage.ts`, called by `saveDesign`); Chrome usually answers without asking, Firefox asks the person.

## What is in a backup

In: every design, the trash included, with its pages, folder, star and dates, as stored; the dashboard preview of each design; every uploaded picture, byte for byte, also those that no design uses; folders; the brand kit (only when this browser saved one of its own); and the saved versions of each design (the Version history list, up to 25 per design; the versions that crash recovery makes, "Before the problem" and "Before going back", are in it like any other, see [`CRASH-RECOVERY.md`](CRASH-RECOVERY.md)).

Not in: the list of problems that Craftly wrote down on this device (`localStorage`, key `craftly.problems.v1`), the crash counts of a tab (`sessionStorage`, key `craftly.crashes.v1`), favourite templates, recent colours, the editor's own preferences (such as whether the left bar is open), the on-device AI models (88.1 MB and 4.9 MB: **File > On-device models** downloads them again) and the app itself.

## The file

A backup is an ordinary ZIP that any unzip tool opens. Nothing is compressed: pictures are compressed already, and a stored archive can be written and read without holding it in memory.

```
craftly-backup.json            the manifest (always the first file): what is in the archive, and the small things
designs/<id>.json              one design each, with live credentials omitted (pictures are stored separately)
previews/<id>.jpg              the dashboard thumbnail of a design
uploads/<id>.<ext>             an uploaded picture, as it was uploaded
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

Tests: `zipRead.test.ts` (archives built the way other tools build them, `src/test/zipBuilder.ts`), `backupFormat.test.ts`, `backup.test.ts` (a library with designs, trash, folders, uploads, versions and a brand kit is backed up, wiped and restored; damaged and cancelled and re-zipped files), `storage.test.ts`, `BackupDialog.test.tsx`, and the browser journey `e2e/backup.cjs` (a backup made in one browser profile, restored in an empty one, restored twice, a file that is not a backup, a damaged file, the dialog on a phone).

**When you add something that is stored**, a new IndexedDB store or a new key in the `meta` store, decide whether it belongs in the backup and say so here. `core/persistence.dom.test.ts` pins the list of stores, so a new store fails a test that points here.

## Not checked

- **Other browsers.** The journey ran in Chrome only. Firefox and Safari should work (the writer uses nothing newer than Blobs and a download link; reading a backup that another tool compressed needs `DecompressionStream`, Firefox 113 and Safari 16.4, and says so when it is missing), but nobody has tried.
- **A big library.** The tests and the journey use a few dozen files. The design keeps memory to about one picture at a time and writes in batches, but a library of a gigabyte or more was not made or restored, and neither was a restore into a browser whose storage was nearly full (only the message for the browser's "no room" error is tested).
- **Two tabs.** A restore never overwrites, so a design that is edited in another tab while the restore runs is not lost, but that was reasoned out and not tried.

## Not done

- Saving the backup straight to a chosen file or folder again and again (the File System Access API, Chrome and Edge only), so a backup would not depend on remembering to make one.
- A reminder when the last backup is old.
- Backups over 4 GB (they would have to be split over several files), and encryption.
- Cloud sync, which needs a server.
