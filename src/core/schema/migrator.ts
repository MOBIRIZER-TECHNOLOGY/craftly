/**
 * The runner behind every format Craftly stores or exports: a design, a project file, a backup. A format has a version
 * number. A *step* turns a document of version n into one of version n + 1, so a document of any older version is brought
 * up one step at a time. Whatever reads a document from somewhere it did not make (the library, a file) passes it through
 * `migrate` first, and the rest of the app only ever sees the current version.
 *
 * The rules this file keeps (docs/MIGRATIONS.md has the reasons and the recipe for changing a format):
 *   - the input is never changed: steps work on a private copy, so a step that fails leaves the stored document alone
 *   - a document from a newer Craftly is refused, never "read as far as possible", so older code cannot damage it
 *   - the version is written by the runner, not by the steps, so a step can neither forget nor lie about it
 *   - a format with version n has exactly n - 1 steps, checked when it is created: a version cannot be raised without one
 */
import { m } from "@/i18n";

export type Doc = Record<string, unknown>;

export interface MigrationStep {
  /** the version this step starts from; it produces `from + 1` */
  readonly from: number;
  /** what changes, in a few words (errors, docs/MIGRATIONS.md) */
  readonly about: string;
  /** gets a private copy it may change in place; returns the document at version `from + 1` */
  up(doc: Doc): Doc;
}

export interface MigratorOptions {
  /** what is migrated, for messages: "design", "project", "backup" */
  kind: string;
  /** the property that holds the version: "version", "craftly", "craftlyBackup" */
  field: string;
  /** the version this build writes */
  current: number;
  /** step n takes a document from version n to n + 1: `current - 1` of them, in order */
  steps: readonly MigrationStep[];
  /** the version of a document that has none at all (written before the field existed); without it such a document cannot be read */
  assume?: number;
}

export type MigrationErrorCode = "newer" | "unreadable" | "failed";

export class MigrationError extends Error {
  readonly code: MigrationErrorCode;
  readonly kind: string;
  /** the version the document had, when it said */
  readonly found: number | null;
  /** the version this build reads and writes */
  readonly current: number | null;
  /** the `from` of the step that failed */
  readonly step: number | null;

  constructor(code: MigrationErrorCode, kind: string, message: string, details: { found?: number; current?: number; step?: number; cause?: unknown } = {}) {
    super(message, "cause" in details ? { cause: details.cause } : undefined);
    this.name = "MigrationError";
    this.code = code;
    this.kind = kind;
    this.found = details.found ?? null;
    this.current = details.current ?? null;
    this.step = details.step ?? null;
  }
}

export interface Migrated {
  doc: Doc;
  /** the version the document had */
  from: number;
  /** the version it has now: the current one */
  to: number;
  /** true when a step ran */
  migrated: boolean;
}

export interface Migrator {
  readonly kind: string;
  readonly field: string;
  readonly current: number;
  /** Brings a document of any version up to the current one. Throws `MigrationError`. */
  migrate(raw: unknown): Migrated;
}

/** The refusal for a document that a newer Craftly wrote (also used where only the version is known, not the document). */
export function newerError(kind: string, found: number, current: number): MigrationError {
  return new MigrationError("newer", kind, m.core.migration.newer(kind), { found, current });
}

const isDoc = (value: unknown): value is Doc => typeof value === "object" && value !== null && !Array.isArray(value);

export function createMigrator(options: MigratorOptions): Migrator {
  const { kind, field, current, steps, assume } = options;
  if (!Number.isInteger(current) || current < 1) throw new Error(`${kind}: the current version must be a whole number of at least 1`);
  if (assume !== undefined && (!Number.isInteger(assume) || assume < 1 || assume > current)) {
    throw new Error(`${kind}: the assumed version must be a whole number from 1 to ${current}`);
  }
  if (steps.length !== current - 1) throw new Error(`${kind}: version ${current} needs ${current - 1} migration steps, found ${steps.length}`);
  steps.forEach((step, index) => {
    if (step.from !== index + 1) throw new Error(`${kind}: migration step ${index + 1} starts from ${step.from}, expected ${index + 1}`);
  });

  const unreadable = () => new MigrationError("unreadable", kind, m.core.migration.unreadable(kind));

  function migrate(raw: unknown): Migrated {
    if (!isDoc(raw)) throw unreadable();
    const stated = raw[field];
    let found: number;
    if (stated === undefined) {
      if (assume === undefined) throw unreadable();
      found = assume;
    } else if (typeof stated === "number" && Number.isInteger(stated) && stated >= 1) {
      found = stated;
    } else throw unreadable();

    if (found > current) throw newerError(kind, found, current);
    if (found === current) return { doc: stated === undefined ? { ...raw, [field]: current } : raw, from: found, to: current, migrated: false };

    let doc: Doc = structuredClone(raw);
    for (let version = found; version < current; version++) {
      try {
        const next = steps[version - 1].up(doc);
        if (!isDoc(next)) throw new TypeError(`migration step ${version} did not return a document`);
        doc = { ...next, [field]: version + 1 };
      } catch (cause) {
        throw new MigrationError("failed", kind, m.core.migration.failed(kind, version, version + 1), {
          found,
          current,
          step: version,
          cause,
        });
      }
    }
    return { doc, from: found, to: current, migrated: true };
  }

  return { kind, field, current, migrate };
}
