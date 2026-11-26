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
export const CURRENT_DESIGN_VERSION = 3;

/**
 * Step n takes a design from version n to n + 1 and is never edited once it has shipped.
 * A step is a pure function of the stored JSON (a document it may change in place; the runner gives it a private copy):
 * no store, no clock, no random ids, so that migrating the same design twice gives the same result.
 */
export const DESIGN_MIGRATIONS: readonly MigrationStep[] = [
  {
    // 2026-11-24. An element may now be a "video" (VideoElement in src/core/types.ts). A design of version 1 has none, so it is
    // version 2 as it is. The version is raised all the same because a release before it cannot use a design that has one: it
    // refuses the element where a design comes in from outside (src/core/usableElement.ts), so a copy or a shared design would lose
    // it. With the number raised, such a release refuses the design whole, which docs/MIGRATIONS.md promises, instead of losing a
    // part of it. Every optional field added to version 1 before this day is part of the frozen designs of version 2.
    from: 1,
    about: "video elements",
    up: (doc) => doc,
  },
  {
    // 2026-11-27. A design may now have sounds that play across its pages (`audio`, AudioTrack in src/core/types.ts). A design of
    // version 2 has none, so it is version 3 as it is. The version is raised because a release before it does not know the field:
    // it would keep a stored design's sounds, but a copy, a project file or a backup made there would come back without them, and
    // its video download would be silent. With the number raised it refuses the design whole instead (docs/MIGRATIONS.md). The
    // optional fields of clips added to version 2 before this day (volume, fades, once, start time, captions and their look, where a
    // loop begins) are part of the frozen designs of version 3.
    from: 2,
    about: "sounds across the pages",
    up: (doc) => doc,
  },
];

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
