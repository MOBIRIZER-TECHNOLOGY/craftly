/**
 * The project file and the stored-design reader when the design format has moved on. The format is replaced here by one at
 * version 3 with two steps (a language is added, then a subtitle), the way src/core/libraryMigration.dom.test.ts does it.
 */
import { describe, expect, it, vi } from "vitest";
import { MigrationError } from "@/core/schema/migrator";
import minimal from "@/test/fixtures/schema/design-v1-minimal.json";
import { parseProjectFile, parseStoredDesign, prepareImportedDesign, ProjectFileError } from "./projectFormat";

vi.mock("@/core/schema/design", async () => {
  const { createMigrator } = await import("@/core/schema/migrator");
  const steps = [
    { from: 1, about: "adds a language", up: (doc: Record<string, unknown>) => ({ ...doc, language: "en" }) },
    {
      from: 2,
      about: "adds a subtitle",
      up: (doc: Record<string, unknown>) => {
        if (doc.explode) throw new Error("boom");
        return { ...doc, subtitle: "" };
      },
    },
  ];
  const migrator = createMigrator({ kind: "design", field: "version", current: 3, steps, assume: 1 });
  return {
    CURRENT_DESIGN_VERSION: 3,
    DESIGN_MIGRATIONS: steps,
    migrateDesign: (raw: unknown) => {
      const { doc, from, migrated } = migrator.migrate(raw);
      return { design: doc, from, migrated };
    },
  };
});

const file = (design: unknown) => JSON.stringify({ craftly: 1, design, assets: {} });

describe("a project file with an older design in it", () => {
  it("brings the design up to date and keeps everything in it", () => {
    const { design } = parseProjectFile(file(minimal));
    expect(design).toMatchObject({ version: 3, language: "en", subtitle: "", title: minimal.title });
    expect(design.pages).toEqual(minimal.pages);
  });

  it("leaves a design that is current as it is, whatever the format has grown", () => {
    const current = { ...minimal, version: 3, language: "de", subtitle: "kept" };
    expect(parseProjectFile(file(current)).design).toMatchObject({ version: 3, language: "de", subtitle: "kept" });
  });

  it("says the project could not be brought up to date when a step fails", () => {
    const error = (() => {
      try {
        parseProjectFile(file({ ...minimal, version: 2, explode: true }));
      } catch (caught) {
        return caught as Error;
      }
      throw new Error("expected a ProjectFileError");
    })();
    expect(error).toBeInstanceOf(ProjectFileError);
    expect(error.message).toBe("This project could not be brought up to date for this version of Craftly.");
  });
});

describe("a stored design", () => {
  it("is brought up to date, with the library's own state kept", () => {
    const old = { ...minimal, folderId: "f_1", starred: true, trashedAt: 9 };
    expect(parseStoredDesign(old)).toMatchObject({ version: 3, language: "en", subtitle: "", folderId: "f_1", starred: true, trashedAt: 9 });
  });

  it("is damaged when a step fails", () => {
    expect(() => parseStoredDesign({ ...minimal, version: 2, explode: true })).toThrowError(ProjectFileError);
  });

  it("from a release newer than this one is passed on as a refusal, not as damage", () => {
    expect(() => parseStoredDesign({ ...minimal, version: 4 })).toThrowError(MigrationError);
  });
});

describe("importing", () => {
  it("makes the design at the version the format has now", () => {
    expect(prepareImportedDesign({ ...minimal, version: 1 } as never, "d_new").version).toBe(3);
  });
});
