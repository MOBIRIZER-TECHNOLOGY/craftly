# Frozen documents

These files are what a release of Craftly wrote to a person's browser. They are the proof that old designs still open, so
**they are never edited and never written again by a script.** `design-v1-full.json` has every field a design can hold,
`design-v1-minimal.json` only the required ones (the least any build can have stored), `records-v1.json` the records that sit
beside designs in the library (summary, folder, brand kit, saved version, upload), and `sync-record-v2.json` a record of the
`sync` store that database step 2 made (docs/ACCOUNTS.md).

When the format of a design changes (`docs/MIGRATIONS.md`):

1. add `design-v<N>-full.json` and `design-v<N>-minimal.json` for the new version, made from the new `completeDesign()` and
   `minimalDesign()` (`src/test/schema/complete.ts`), then leave them alone for ever;
2. keep every older file: `src/core/schema/design.test.ts` runs each of them through the migration steps up to the current
   version and opens the result in the editor, and fails when a version has no fixture.
