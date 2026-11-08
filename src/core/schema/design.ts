/**
 * The format of a stored design (`Design.version`) and the steps that bring an older one up to date.
 *
 * Raising the version is a decision with a recipe (docs/MIGRATIONS.md): add a step here, add frozen designs of the new
 * version to src/test/fixtures/schema/, raise CURRENT_DESIGN_VERSION. The runner refuses to start when the number of steps and
 * the version disagree, and the tests fail when a version has no frozen design or an old one no longer opens.
 */
import type { Design } from "../types";
import { createMigrator, type MigrationStep } from "./migrator";

/** The version of the designs this build writes. */
export const CURRENT_DESIGN_VERSION = 1;

/**
 * Step n takes a design from version n to n + 1 and is never edited once it has shipped. Empty: version 1 is the first.
 * A step is a pure function of the stored JSON (a document it may change in place; the runner gives it a private copy):
 * no store, no clock, no random ids, so that migrating the same design twice gives the same result.
 */
export const DESIGN_MIGRATIONS: readonly MigrationStep[] = [];

const migrator = createMigrator({ kind: "design", field: "version", current: CURRENT_DESIGN_VERSION, steps: DESIGN_MIGRATIONS, assume: 1 });

export interface MigratedDesign {
  design: Design;
  /** the version the stored design had */
  from: number;
  /** true when a step ran, so what was stored differs from `design` */
  migrated: boolean;
}

/**
 * A design from storage, a project file or a backup, at the current version. Throws `MigrationError` for a design from a
 * newer Craftly ("newer"), one that is not a design ("unreadable") or a step that failed ("failed"). A design that is current
 * already comes back as the very object that was given.
 */
export function migrateDesign(raw: unknown): MigratedDesign {
  const { doc, from, migrated } = migrator.migrate(raw);
  return { design: doc as unknown as Design, from, migrated };
}
