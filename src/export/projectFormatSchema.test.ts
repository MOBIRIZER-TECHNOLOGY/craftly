/** The project file and the stored-design reader against the frozen designs and the versions they can meet (docs/MIGRATIONS.md). */
import { describe, expect, it } from "vitest";
import { createDesign } from "@/core/factory";
import { CURRENT_DESIGN_VERSION } from "@/core/schema/design";
import { MigrationError } from "@/core/schema/migrator";
import type { Design } from "@/core/types";
import full from "@/test/fixtures/schema/design-v1-full.json";
import minimal from "@/test/fixtures/schema/design-v1-minimal.json";
import {
  buildProjectFile,
  NEWER_PROJECT_MESSAGE,
  NOT_A_PROJECT_MESSAGE,
  parseProjectFile,
  parseStoredDesign,
  prepareImportedDesign,
  PROJECT_FORMAT_VERSION,
  ProjectFileError,
  serializeProjectFile,
} from "./projectFormat";

const fixture = (design: unknown) => design as Design;

function message(text: string): string {
  try {
    parseProjectFile(text);
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectFileError);
    return (error as Error).message;
  }
  throw new Error("expected a ProjectFileError");
}

const wrap = (design: unknown, craftly: unknown = 1) => JSON.stringify({ craftly, exportedAt: "2026-11-08T00:00:00.000Z", design, assets: {} });

describe("a project file around a frozen design", () => {
  it("keeps every page and element of the design that has every field", () => {
    const parsed = parseProjectFile(wrap(full));
    expect(parsed.design.pages).toEqual(fixture(full).pages);
    expect(parsed.design).toMatchObject({ title: full.title, typeId: full.typeId, width: full.width, height: full.height, unit: full.unit, guides: full.guides });
    // a file brings a design in as a new one: the library's own state is not part of it
    expect(parsed.design).toMatchObject({ folderId: null, starred: false, trashedAt: null });
    expect(parsed.design.version).toBe(CURRENT_DESIGN_VERSION);
  });

  it("keeps the design that has only the required fields", () => {
    const parsed = parseProjectFile(wrap(minimal));
    expect(parsed.design.pages).toEqual(fixture(minimal).pages);
    expect(parsed.design.version).toBe(CURRENT_DESIGN_VERSION);
  });

  it("is what an export of that design reads back as", () => {
    const design = fixture(full);
    const file = parseProjectFile(serializeProjectFile(buildProjectFile(design, {})));
    expect(file.craftly).toBe(PROJECT_FORMAT_VERSION);
    expect(file.design.pages).toEqual(design.pages);
    expect(buildProjectFile(design, {}).design.version).toBe(design.version);
  });
});

describe("the version of the file and of the design in it", () => {
  it("reads a design that has no version as the first one", () => {
    const { version: _version, ...unversioned } = fixture(minimal);
    expect(parseProjectFile(wrap(unversioned)).design.version).toBe(CURRENT_DESIGN_VERSION);
  });

  it("explains a file from a newer Craftly", () => {
    expect(message(wrap(minimal, PROJECT_FORMAT_VERSION + 1))).toBe(NEWER_PROJECT_MESSAGE);
  });

  it("explains a design from a newer Craftly inside a file of the version this one reads", () => {
    expect(message(wrap({ ...minimal, version: CURRENT_DESIGN_VERSION + 1 }))).toBe(NEWER_PROJECT_MESSAGE);
  });

  it.each([0, -1, 1.5, "1", null])("does not take %j for the version of a file", (version) => {
    expect(message(wrap(minimal, version))).toBe(NOT_A_PROJECT_MESSAGE);
  });

  it.each([0, "1", null, 2.5])("does not take %j for the version of a design", (version) => {
    expect(message(wrap({ ...minimal, version }))).toBe(NOT_A_PROJECT_MESSAGE);
  });
});

describe("a design as the library stored it (what a backup holds)", () => {
  const stored = { ...fixture(full), folderId: "f_1", starred: true, trashedAt: 123 };

  it("keeps the library's own state, and the version it is now", () => {
    expect(parseStoredDesign(stored)).toMatchObject({ id: full.id, folderId: "f_1", starred: true, trashedAt: 123, version: CURRENT_DESIGN_VERSION });
    expect(parseStoredDesign(stored).pages).toEqual(stored.pages);
  });

  it("passes a design from a newer Craftly on as it is, for the caller to count", () => {
    try {
      parseStoredDesign({ ...stored, version: CURRENT_DESIGN_VERSION + 1 });
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      expect(error).toMatchObject({ code: "newer" });
    }
  });

  it.each([0, "1"])("calls a design with the version %j damaged", (version) => {
    expect(() => parseStoredDesign({ ...stored, version })).toThrowError(ProjectFileError);
  });
});

describe("a design that is imported", () => {
  it("is made at the current version", () => {
    expect(prepareImportedDesign(createDesign({ width: 10, height: 10 }), "d_new").version).toBe(CURRENT_DESIGN_VERSION);
    expect(prepareImportedDesign({ ...createDesign({ width: 10, height: 10 }), version: 99 }, "d_new").version).toBe(CURRENT_DESIGN_VERSION);
  });
});
