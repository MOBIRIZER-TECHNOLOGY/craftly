import { describe, expect, it } from "vitest";
import { createMigrator, MigrationError, type Doc, type MigrationStep } from "./migrator";

const step = (from: number, up: MigrationStep["up"], about = `step ${from}`): MigrationStep => ({ from, about, up });

/** A made-up format at version 4: its three steps rename a field, add one and split one. */
const seen: number[] = [];
const STEPS: MigrationStep[] = [
  step(
    1,
    (doc) => {
      seen.push(doc.v as number);
      const { name, ...rest } = doc;
      return { ...rest, title: name };
    },
    "name becomes title",
  ),
  step(
    2,
    (doc) => {
      seen.push(doc.v as number);
      return { ...doc, tags: [] };
    },
    "tags are added",
  ),
  step(
    3,
    (doc) => {
      seen.push(doc.v as number);
      const [first = "", ...others] = String(doc.title).split(" ");
      return { ...doc, first, others: others.join(" ") };
    },
    "the title is split",
  ),
];
const notes = () => createMigrator({ kind: "note", field: "v", current: 4, steps: STEPS, assume: 1 });

const deepFreeze = <T>(value: T): T => {
  if (typeof value === "object" && value !== null) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
};

function failure(run: () => unknown): MigrationError {
  try {
    run();
  } catch (error) {
    expect(error).toBeInstanceOf(MigrationError);
    return error as MigrationError;
  }
  throw new Error("expected a MigrationError");
}

describe("migrate", () => {
  it("hands back a document that is already current, as it is", () => {
    const doc = { v: 4, title: "A" };
    const result = notes().migrate(doc);
    expect(result.doc).toBe(doc);
    expect(result).toMatchObject({ from: 4, to: 4, migrated: false });
  });

  it("brings an old document up through every step, in order", () => {
    seen.length = 0;
    const result = notes().migrate({ v: 1, name: "Big Red" });
    expect(result.doc).toEqual({ v: 4, title: "Big Red", tags: [], first: "Big", others: "Red" });
    expect(result).toMatchObject({ from: 1, to: 4, migrated: true });
    // each step sees the version it starts from, and only its own
    expect(seen).toEqual([1, 2, 3]);
  });

  it("starts from the version the document has", () => {
    seen.length = 0;
    const result = notes().migrate({ v: 3, title: "A B" });
    expect(result.doc).toEqual({ v: 4, title: "A B", first: "A", others: "B" });
    expect(seen).toEqual([3]);
  });

  it("never changes what it was given, even when a step changes its argument in place", () => {
    const meddling = createMigrator({
      kind: "note",
      field: "v",
      current: 2,
      steps: [
        step(1, (doc) => {
          doc.touched = true;
          (doc.list as number[]).push(9);
          return doc;
        }),
      ],
    });
    const input = { v: 1, list: [1, 2] };
    const result = meddling.migrate(input);
    expect(result.doc).toEqual({ v: 2, touched: true, list: [1, 2, 9] });
    expect(input).toEqual({ v: 1, list: [1, 2] });
    expect(result.doc.list).not.toBe(input.list);
    // and a frozen document is no obstacle
    expect(() => notes().migrate(deepFreeze({ v: 1, name: "x" }))).not.toThrow();
  });

  it("writes the version itself after each step, so a step can neither forget nor lie about it", () => {
    const liar = createMigrator({ kind: "note", field: "v", current: 3, steps: [step(1, (doc) => ({ ...doc, v: 99 })), step(2, (doc) => ({ ...doc, v: undefined }))] });
    expect(liar.migrate({ v: 1 }).doc.v).toBe(3);
  });

  it("is a no-op the second time", () => {
    const first = notes().migrate({ v: 1, name: "Big Red" });
    const second = notes().migrate(first.doc);
    expect(second.doc).toBe(first.doc);
    expect(second.migrated).toBe(false);
  });

  it("reads a document with no version as the version it was told to assume, and writes it down", () => {
    const result = notes().migrate({ name: "Big" });
    expect(result.from).toBe(1);
    expect(result.doc.v).toBe(4);
    // current and assumed are the same: nothing to migrate, but the version is on the document afterwards
    const same = createMigrator({ kind: "note", field: "v", current: 1, steps: [], assume: 1 }).migrate({ title: "x" });
    expect(same).toMatchObject({ from: 1, to: 1, migrated: false });
    expect(same.doc).toEqual({ title: "x", v: 1 });
  });

  it("cannot read a document with no version when nothing was assumed", () => {
    const strict = createMigrator({ kind: "note", field: "v", current: 1, steps: [] });
    expect(failure(() => strict.migrate({ title: "x" })).code).toBe("unreadable");
  });

  it.each([0, -1, 1.5, Number.NaN, Infinity, "2", null, true, [], {}])("does not accept %j as a version", (version) => {
    const error = failure(() => notes().migrate({ v: version }));
    expect(error.code).toBe("unreadable");
    expect(error.message).toBe("This note is not in a format Craftly can read.");
  });

  it.each([null, undefined, 5, "text", true, []])("does not accept %j as a document", (value) => {
    expect(failure(() => notes().migrate(value)).code).toBe("unreadable");
  });
});

describe("a document from a newer version", () => {
  it("is refused with the version it was found at, and left alone", () => {
    const doc = deepFreeze({ v: 5, title: "from the future" });
    const error = failure(() => notes().migrate(doc));
    expect(error).toMatchObject({ name: "MigrationError", code: "newer", kind: "note", found: 5, current: 4, step: null });
    expect(error.message).toBe("This note was saved by a newer version of Craftly. Reload the page to get the newest version, then try again.");
  });
});

describe("a step that goes wrong", () => {
  it("says which step it was, keeps the cause, and gives nothing half done", () => {
    const boom = new Error("boom");
    const broken = createMigrator({
      kind: "note",
      field: "v",
      current: 4,
      steps: [
        STEPS[0],
        step(2, () => {
          throw boom;
        }),
        STEPS[2],
      ],
    });
    const input = { v: 1, name: "x" };
    const error = failure(() => broken.migrate(input));
    expect(error).toMatchObject({ code: "failed", kind: "note", step: 2, found: 1, current: 4 });
    expect(error.cause).toBe(boom);
    expect(error.message).toBe("Craftly could not bring this note up to date (format 2 to 3).");
    expect(input).toEqual({ v: 1, name: "x" });
  });

  it.each([undefined, null, [], "text", 7])("counts a step that returns %j instead of a document as a failure", (returned) => {
    const wrong = createMigrator({ kind: "note", field: "v", current: 2, steps: [step(1, () => returned as unknown as Doc)] });
    const error = failure(() => wrong.migrate({ v: 1 }));
    expect(error.code).toBe("failed");
    expect(error.cause).toBeInstanceOf(TypeError);
  });

  it("keeps something that is not an Error as the cause too", () => {
    const odd = createMigrator({
      kind: "note",
      field: "v",
      current: 2,
      steps: [
        step(1, () => {
          throw "just text";
        }),
      ],
    });
    expect(failure(() => odd.migrate({ v: 1 })).cause).toBe("just text");
  });
});

describe("createMigrator", () => {
  it("wants one step for every version below the current one", () => {
    expect(() => createMigrator({ kind: "note", field: "v", current: 3, steps: [STEPS[0]] })).toThrow("note: version 3 needs 2 migration steps, found 1");
    expect(() => createMigrator({ kind: "note", field: "v", current: 1, steps: [STEPS[0]] })).toThrow("note: version 1 needs 0 migration steps, found 1");
    expect(() => createMigrator({ kind: "note", field: "v", current: 1, steps: [] })).not.toThrow();
  });

  it("wants the steps in order, starting from version 1", () => {
    expect(() => createMigrator({ kind: "note", field: "v", current: 3, steps: [STEPS[1], STEPS[2]] })).toThrow("note: migration step 1 starts from 2, expected 1");
    expect(() => createMigrator({ kind: "note", field: "v", current: 3, steps: [STEPS[0], STEPS[0]] })).toThrow("note: migration step 2 starts from 1, expected 2");
  });

  it("wants a current version that is a whole number of at least 1", () => {
    for (const current of [0, -1, 1.5, Number.NaN]) {
      expect(() => createMigrator({ kind: "note", field: "v", current, steps: [] })).toThrow("note: the current version must be a whole number of at least 1");
    }
  });

  it("wants an assumed version that exists", () => {
    for (const assume of [0, 5, 1.5]) {
      expect(() => createMigrator({ kind: "note", field: "v", current: 4, steps: STEPS, assume })).toThrow("note: the assumed version must be a whole number from 1 to 4");
    }
  });

  it("tells a caller what it reads and writes", () => {
    const migrator = notes();
    expect(migrator).toMatchObject({ kind: "note", field: "v", current: 4 });
  });
});
