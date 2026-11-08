import { describe, expect, it } from "vitest";
import { isUsableElement } from "@/export/projectFormat";
import { createDesign } from "../factory";
import type { Design, DesignElement } from "../types";
import { CURRENT_DESIGN_VERSION, DESIGN_MIGRATIONS, migrateDesign } from "./design";
import { MigrationError } from "./migrator";

/** Every frozen design, by file name: `design-v<version>-<name>.json` (src/test/fixtures/schema/README.md). */
const files = import.meta.glob<Design>("../../test/fixtures/schema/design-v*.json", { eager: true, import: "default" });
const fixtures = Object.entries(files).map(([path, design]) => {
  const name = path.slice(path.lastIndexOf("/") + 1);
  const match = /^design-v(\d+)-.+\.json$/.exec(name);
  if (!match) throw new Error(`a fixture file must be named design-v<version>-<name>.json: ${name}`);
  return { name, version: Number(match[1]), design };
});

const everyElement = (elements: DesignElement[]): DesignElement[] => elements.flatMap((el) => (el.type === "group" ? [el, ...everyElement(el.children)] : [el]));

describe("the design format", () => {
  it("is written at the current version by every way of making a design", () => {
    expect(createDesign({ width: 100, height: 100 }).version).toBe(CURRENT_DESIGN_VERSION);
  });

  it("has a migration step for every version below the current one", () => {
    expect(DESIGN_MIGRATIONS).toHaveLength(CURRENT_DESIGN_VERSION - 1);
    DESIGN_MIGRATIONS.forEach((step, index) => {
      expect(step.from).toBe(index + 1);
      expect(step.about.length).toBeGreaterThan(5);
    });
  });
});

describe("the frozen designs of every version", () => {
  it("exist: a design of each version from the first to the current one, each saying which version it is", () => {
    expect(fixtures.length).toBeGreaterThanOrEqual(2);
    for (const fixture of fixtures) expect(fixture.design.version, fixture.name).toBe(fixture.version);
    const versions = [...new Set(fixtures.map((fixture) => fixture.version))].sort((a, b) => a - b);
    expect(versions, "raising CURRENT_DESIGN_VERSION needs frozen designs of the new version (src/test/fixtures/schema/README.md)").toEqual(
      Array.from({ length: CURRENT_DESIGN_VERSION }, (_unused, index) => index + 1),
    );
  });

  it.each(fixtures)("$name comes up to the current version, whole and usable", ({ design, version }) => {
    const before = structuredClone(design);
    const result = migrateDesign(design);
    expect(result.from).toBe(version);
    expect(result.migrated).toBe(version < CURRENT_DESIGN_VERSION);
    expect(result.design.version).toBe(CURRENT_DESIGN_VERSION);
    // the stored original is never touched
    expect(design).toEqual(before);
    // and what comes out is a design the editor can open
    expect(result.design.pages.length).toBeGreaterThan(0);
    for (const page of result.design.pages) {
      expect(Array.isArray(page.elements)).toBe(true);
      for (const element of everyElement(page.elements)) expect(isUsableElement(element), `${element.type} ${element.id}`).toBe(true);
    }
  });

  it.each(fixtures.filter((fixture) => fixture.version === CURRENT_DESIGN_VERSION))("$name is the very document that comes back when it is already current", ({ design }) => {
    expect(migrateDesign(design).design).toBe(design);
  });
});

describe("migrateDesign", () => {
  const { design: minimal } = fixtures.find((fixture) => fixture.name === "design-v1-minimal.json")!;

  it("reads a design that has no version as the first version", () => {
    const { version: _version, ...unversioned } = minimal;
    const result = migrateDesign(unversioned);
    expect(result.from).toBe(1);
    expect(result.design.version).toBe(CURRENT_DESIGN_VERSION);
    expect(result.design.title).toBe(minimal.title);
  });

  it("refuses a design from a newer Craftly, with the version it found", () => {
    const newer = { ...minimal, version: CURRENT_DESIGN_VERSION + 1 };
    try {
      migrateDesign(newer);
      throw new Error("expected a refusal");
    } catch (error) {
      expect(error).toBeInstanceOf(MigrationError);
      expect(error).toMatchObject({ code: "newer", kind: "design", found: CURRENT_DESIGN_VERSION + 1, current: CURRENT_DESIGN_VERSION });
    }
  });

  it.each([null, "a design", 3, [], { version: "1" }, { version: 0 }])("does not take %j for a design", (value) => {
    expect(() => migrateDesign(value)).toThrowError(MigrationError);
  });
});
