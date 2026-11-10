# Stored formats and migrations

Craftly keeps a person's designs in their own browser, so no release may lose or damage them. This page says what is stored, how each thing is versioned, what happens when versions meet, and the recipe for changing a format. The code is in `src/core/schema/` (the runner, the design format, the database upgrade), in the places that read a format (`src/core/library.ts`, `src/core/persistence.ts`, `src/export/projectFormat.ts`, `src/export/backupFormat.ts`, `src/export/backup.ts`) and in the notices (`src/databaseNotices.ts`, the editor's screens in `src/editor/Editor.tsx`).

**Status.** Everything is still at its first version, so no migration step exists yet. The framework, its tests and the frozen documents come before the first change on purpose: a format cannot be changed safely until old data can be tried against the change.

The library summary also tracks a local save revision. It detects stale writes and is separate from the design format version. Portable project and backup readers discard embedded live credentials, including those in legacy files. Backup preserves other document fields for newer formats where it can copy the record.

## The promise

1. A design saved by any release opens in every later release.
2. An older release never damages what a newer one saved. It refuses to open it, refuses to save over it, and can still star, rename, move, trash and back it up, because those do not depend on the format.
3. A migration that fails changes nothing: the stored copy is only ever replaced by a save, and the first save of an upgraded design keeps the old one in Version history.

## What is stored, and how it is versioned

| What | Where | Version | An older one | A newer one |
| --- | --- | --- | --- | --- |
| A design (the document) | IndexedDB `designs` | `Design.version`, `CURRENT_DESIGN_VERSION` in `src/core/schema/design.ts` | brought up to date in memory when it is read; the stored copy changes at its next save, which first keeps the old one in Version history as "Before the update" | refused: the editor shows "Update Craftly to open this design" with a Reload button; a save over it is refused; star, rename, move and trash patch their own fields in the stored copy and leave the rest; making a copy is refused; a backup holds it as stored |
| The dashboard record of a design | `summaries` | `schema`: the `version` of the design it was made from (none means 1) | read as it is | read as it is. Its `schema` is how a save finds out, without reading the design, that the stored one is newer |
| A saved version of a design | `versions` | the `version` of the design inside it | the design is brought up to date when the version is opened (preview, restore) | not offered: the preview stays empty |
| Folders, uploads, brand kit, small settings | `folders`, `assets`, `meta` | none: every reader gives a missing field a default | missing fields take their defaults | unknown fields stay where they are |
| A project file | `.craftly` | `craftly`, `PROJECT_FORMAT_VERSION`: the layout of the file; the design in it has its own `version` | each is brought up to date on import | "This project was saved by a newer version of Craftly" |
| A backup | ZIP, `craftly-backup.json` | `craftlyBackup`, `BACKUP_FORMAT_VERSION`: the manifest and the layout; every design in it has its own `version` | each design is brought up to date as it is restored | a newer backup is refused as a whole; a newer design inside an older backup is left out, counted, and the result says to reload and restore again |
| The database | IndexedDB `craftly` | the number of steps in `DB_STEPS` (`src/core/persistence.ts`) | upgraded by the steps it has not had, all in one transaction, when it is opened | the browser refuses to open it. The dashboard says "This tab is older than your designs", the editor "Update Craftly to open this design"; nothing is written |
| The model cache | IndexedDB `craftly-models` | 1 | is a cache: the models are downloaded again | same |
| Preferences (view, rail, recent emoji, download settings) | `localStorage` | none | every reader checks what it reads; a bad value is the default | same |

The service worker's caches are not user data: a new build replaces them (`docs/UPDATES.md`).

## The rules of the runner

`src/core/schema/migrator.ts` runs every format the same way. A format has a version number; a *step* turns a document of version n into one of version n + 1; a document of any older version is brought up one step at a time.

- **The input is never changed.** Steps work on a private copy, so a step that throws leaves what was stored alone, and a document that is already current comes back as the very object it was given (no copy).
- **A newer document is refused**, never "read as far as possible": an older release that read half of a newer design and saved it would lose the rest.
- **The version is written by the runner**, after each step, so a step can neither forget nor lie about it.
- **A format at version n has exactly n − 1 steps, in order.** The runner checks it when the module loads: a version cannot be raised without a step, and a step cannot be added without raising it.
- A design with no `version` at all is read as version 1 (a project file or backup written by hand). A version that is not a whole number of at least 1, or a document that is not an object, is "unreadable".

Errors are `MigrationError` with a `code`: `newer`, `unreadable` or `failed` (a step threw; `step` says which, `cause` keeps the error). Their messages are written for the person: they reach toasts as they are.

## When versions meet

| Situation | What happens |
| --- | --- |
| Opening an old design | `getDesign` brings it up to date in memory; nothing is written until the person edits it |
| The first save of an upgraded design | the stored original is copied into Version history ("Before the update"), then the upgraded design is written; later saves add nothing |
| Opening a design from a newer release | the editor shows "Update Craftly to open this design"; the stored design and its dashboard record are not touched |
| A save over a design that a newer release stored (two tabs on different releases) | refused with the same `newer` error; the autosave shows "could not save" |
| Star, rename, move to a folder, trash, restore from trash | patch their own fields in the stored design, whatever its version |
| Make a copy | refused for a newer design ("… was saved by a newer version of Craftly …") |
| Back up | designs are copied **as stored**, a newer one included, so nothing an older tab cannot read is lost |
| Restore, or import a project file | each design is brought up to date; a newer one is skipped and counted (`newer` in the restore result) or refused with the project message |
| A step fails | the editor says "We couldn't bring this design up to date" with the step; nothing is written |
| Another tab upgrades the database | see "Two tabs" |
| This tab is older than the database | the browser refuses to open it (`VersionError`); the dashboard and the editor say so, and nothing is written |

## Two tabs

The browser gives one database to every tab, and a tab that wants a higher version waits until every other connection has closed.

- **A tab on this release lets go.** When another tab asks for an upgrade, this tab's connection hears about it (`versionchange`). The app writes the open design (for at most 2 s, `src/settleSaves.ts`), shows "Craftly was updated in another tab. Reload this tab to keep working." with a Reload button, and closes the connection (`src/core/schema/database.ts`; the wait is bounded at 3 s in any case). Chrome lets the old connection finish a write while the upgrade waits, which `e2e/migrate.cjs` relies on.
- **A tab of a release before this one does not**, because it has no such handler, and holds the upgrade up. The tab that waits says "Your designs are waiting for another Craftly tab that is still on an older version. Close or reload that tab." and goes on by itself when that tab is closed.
- **What brings an old tab forward** is the notice of `docs/UPDATES.md`. A tab that is older than the library, and reloaded, gets the browser's refusal and the messages above.

## Changing what is stored: the recipe

First decide which kind of change it is.

**An optional field is added** (the way `animation` was added to elements, and later `blend`, the blend mode: `BLEND` in `ADDED`). Nothing is migrated and the version stays. Add it to the types and to `completeDesign()` (`src/test/schema/complete.ts`); the compiler fails there until you do. The shape test then names the field as new against the frozen design: list it in `ADDED` in `src/core/schema/persistedShapes.test.ts`, which is the decision to take in a review. Every place that reads the field needs a default, because older designs never get it.

**Anything else** (a field is required, renamed, removed, changes meaning or type) is a new version of the design:

1. Raise `CURRENT_DESIGN_VERSION` and add the step to `DESIGN_MIGRATIONS` in `src/core/schema/design.ts`: a pure function of the stored JSON, with `from` equal to the old version and a short `about`. No store, clock or random ids: migrating the same design twice must give the same result. The runner refuses to start with the wrong number of steps.
2. Change the types and `completeDesign()` / `minimalDesign()` to the new shape.
3. Add `design-v<N>-full.json` and `design-v<N>-minimal.json` to `src/test/fixtures/schema/`, made from the new builders, and never edit them again (`src/test/fixtures/schema/README.md`). The tests fail while a version has no frozen design. Keep every older file.
4. Write the test of the step: take the frozen design of the old version, run it through the step, and say exactly what comes out (see the examples in `src/core/schema/migrator.test.ts`). `design.test.ts` and `open.dom.test.ts` already run every frozen design up to the current version and open and draw the result; they are what catches a step that loses something.
5. Where something must be shown to the person (a design that changes visibly), say so in the CHANGELOG.

**The stores or indexes of the database change**: add a step to `DB_STEPS` in `src/core/persistence.ts` (step n takes the database from n − 1 to n, in one upgrade transaction; records that have to move are moved in it). Test it the way `src/core/schema/database.test.ts` does: build the database as the step before left it, with data in it, open it with the new steps, and look at both. Decide whether the new store belongs in the backup (`docs/BACKUP.md`).

**The layout of a project file or a backup changes** (not what is in a design): add a step to `PROJECT_MIGRATIONS` in `src/export/projectFormat.ts`, or `BACKUP_MIGRATIONS` in `src/export/backupFormat.ts`, and raise its version constant.

**Never**: edit a step that has shipped (add the next one), edit a frozen design, write a version number anywhere but in these places (a test fails when `version: <n>` appears elsewhere), open the library's database anywhere but `openDatabase` (a test fails on any other `indexedDB.open`), or make a migration depend on anything but the document.

## How it is tested

| What | Where |
| --- | --- |
| The runner: order, copying, newer, failing steps, the registry checks | `src/core/schema/migrator.test.ts` |
| The design format: a design of every version from the first comes up to the current one, whole; the versions that have frozen designs | `src/core/schema/design.test.ts` |
| A frozen design of every version opens in the editor store and every page draws | `src/core/schema/open.dom.test.ts` |
| The shape the code writes against the frozen documents; where version numbers and the database are touched | `src/core/schema/persistedShapes.test.ts`, and the compiler for `src/test/schema/complete.ts` |
| The database: steps in order, only the missing ones, a step that throws cancels everything, a newer database is refused, a waiting upgrade, giving the connection up, a connection the browser closed | `src/core/schema/database.test.ts`, `src/core/persistenceWatch.test.ts` |
| The library with a format at version 3: reading, patching, saving over a newer design, keeping the original, copying, saved versions | `src/core/libraryMigration.dom.test.ts` |
| Project files and stored designs: the frozen designs whole, newer, older, failing steps | `src/export/projectFormatSchema.test.ts`, `src/export/projectFormatMigration.test.ts` |
| Backups: a newer design copied as stored, counted apart on restore, the result shown | `src/export/backup.test.ts`, `src/dashboard/BackupDialog.test.tsx` |
| The screens and the notices | `src/editor/Editor.test.tsx`, `src/dashboard/layout.test.tsx`, `src/databaseNotices.dom.test.tsx`, `src/main.dom.test.ts` |
| In real Chrome: an old design opens whole, a newer one is refused and left alone, starring it works, copying is refused, a backup keeps it as stored, another tab upgrades the database while an edit waits, the older code refuses a library that was upgraded | `e2e/migrate.cjs` |

## Not done

- No step exists, so none has run on real data yet. The first one will be the first real test of this page.
- A design from a newer release cannot be opened read-only; it is refused.
- The notice for a tab that holds an upgrade up is only seen by tabs of this release and later. A tab of an earlier release is not told anything and holds the other tab up until it is closed.
- Preferences and the small `meta` values have no version; a change to one of them is a reader that copes with the old value.
- Two tabs on the same design with the same release still overwrite each other (the older limitation, unchanged).
