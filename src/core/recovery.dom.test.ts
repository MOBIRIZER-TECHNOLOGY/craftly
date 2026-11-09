/**
 * Getting back to work after Craftly stopped: how often a design has stopped it, keeping the last saved state before a crashed
 * state is written over it, and going back to an earlier version without the editor, which may be what cannot open.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { wipeDatabase } from "@/test/logicDb";
import { createDesign, createPage, createShape } from "./factory";
import { getDesign, getVersion, listVersions, saveDesign, saveVersion } from "./library";
import { crashCount, earlierVersions, goBackToVersion, isCrashing, keepBeforeProblem, markCrashing, noteCrash, savedAt } from "./recovery";
import type { Design } from "./types";

/** versions are named by the millisecond they were made in */
const tick = () => new Promise((resolve) => setTimeout(resolve, 3));

const withShapes = (title: string, count: number, updatedAt = 1_000): Design => {
  const base = createDesign({
    title,
    width: 800,
    height: 600,
    pages: [createPage({ elements: Array.from({ length: count }, (_v, i) => createShape("rect", { x: i * 10, y: 0, width: 5, height: 5 })) })],
  });
  return { ...base, updatedAt };
};

beforeEach(async () => {
  await wipeDatabase();
  sessionStorage.clear();
  markCrashing(false);
});

describe("counting how often a design stopped Craftly", () => {
  it("counts again within two minutes, and starts again after them", () => {
    expect(noteCrash("d1", 1_000)).toBe(1);
    expect(noteCrash("d1", 60_000)).toBe(2);
    expect(crashCount("d1", 61_000)).toBe(2);
    expect(noteCrash("d1", 60_000 + 119_000)).toBe(3);
    expect(crashCount("d1", 60_000 + 119_000 + 121_000)).toBe(0);
    expect(noteCrash("d1", 60_000 + 119_000 + 121_000)).toBe(1);
  });

  it("keeps a count for each design, and asking does not count", () => {
    noteCrash("d1", 1_000);
    expect(crashCount("d2", 1_500)).toBe(0);
    expect(crashCount("d1", 1_500)).toBe(1);
    expect(crashCount("d1", 1_600)).toBe(1);
    expect(noteCrash("d2", 2_000)).toBe(1);
  });

  it("is kept for the tab, so that a reload does not forget it", () => {
    noteCrash("d1", 1_000);
    expect(sessionStorage.getItem("craftly.crashes.v1")).toContain("d1");
  });

  it("starts again from nothing when what is stored cannot be read, and goes on when it cannot be written", () => {
    sessionStorage.setItem("craftly.crashes.v1", "{broken");
    expect(crashCount("d1", 1_000)).toBe(0);
    sessionStorage.setItem("craftly.crashes.v1", JSON.stringify([1, 2]));
    expect(crashCount("d1", 1_000)).toBe(0);
    expect(noteCrash("d1", 1_000)).toBe(1);
    const original = Storage.prototype.setItem;
    Storage.prototype.setItem = () => {
      throw new DOMException("full", "QuotaExceededError");
    };
    try {
      expect(noteCrash("d9", 5_000)).toBe(1);
    } finally {
      Storage.prototype.setItem = original;
    }
  });

  it("knows whether a crash is going on", () => {
    expect(isCrashing()).toBe(false);
    markCrashing(true);
    expect(isCrashing()).toBe(true);
    markCrashing(false);
    expect(isCrashing()).toBe(false);
  });
});

describe("keeping the last saved state before a crashed one is written over it", () => {
  it("saves the stored design as a version called Before the problem", async () => {
    const stored = withShapes("Poster", 3);
    await saveDesign(stored);
    expect(await keepBeforeProblem(stored.id)).toBe("kept");
    const [only] = await listVersions(stored.id);
    expect(only.label).toBe("Before the problem");
    expect((await getVersion(only.id))!.design.pages[0].elements).toHaveLength(3);
  });

  it("does not make a second one of a state that it has kept already", async () => {
    const stored = withShapes("Poster", 3);
    await saveDesign(stored);
    await keepBeforeProblem(stored.id);
    await tick();
    expect(await keepBeforeProblem(stored.id)).toBe("kept");
    expect(await listVersions(stored.id)).toHaveLength(1);
    await tick();
    await saveDesign({ ...stored, updatedAt: stored.updatedAt + 5_000 });
    await keepBeforeProblem(stored.id);
    expect(await listVersions(stored.id)).toHaveLength(2);
  });

  it("has nothing to keep for a design that is not stored", async () => {
    expect(await keepBeforeProblem("nope")).toBe("nothing");
  });
});

describe("the versions to go back to", () => {
  it("are the newest first, at most five, with a name that says where each came from", async () => {
    const stored = withShapes("Poster", 1);
    await saveDesign(stored);
    for (const label of [undefined, "Saved by you", "Before the problem", "Before restoring", "Before going back", undefined]) {
      await tick();
      await saveVersion(stored, label);
    }
    const list = await earlierVersions(stored.id);
    expect(list).toHaveLength(5);
    expect(list.map((v) => v.label)).toEqual(["Saved automatically", "Before going back", "Before restoring", "Before the problem", "Saved by you"]);
    expect(list.every((v, i) => i === 0 || v.at < list[i - 1].at)).toBe(true);
    expect(await earlierVersions(stored.id, 2)).toHaveLength(2);
  });

  it("name the version that was kept before a design was brought up to date", async () => {
    const stored = withShapes("Poster", 1);
    await saveDesign(stored);
    await saveVersion(stored, "Before the update");
    expect((await earlierVersions(stored.id)).map((v) => v.label)).toEqual(["Before the update"]);
  });

  it("are not those of another design", async () => {
    const a = withShapes("A", 1);
    const b = withShapes("B", 1);
    await saveDesign(a);
    await saveDesign(b);
    await saveVersion(a);
    expect(await earlierVersions(b.id)).toEqual([]);
  });
});

describe("going back to a version", () => {
  it("puts its pages in the design, keeps the title and everything else, and keeps what was there as a version", async () => {
    const stored = withShapes("Poster", 2, 1_000);
    await saveDesign(stored);
    await tick();
    await saveVersion(stored, "Saved by you");
    const [old] = await listVersions(stored.id);
    await tick();
    await saveDesign({ ...stored, title: "Poster, edited", pages: [createPage({ elements: [createShape("ellipse", { width: 9, height: 9 })] })], updatedAt: 9_000 });
    await tick();

    expect(await goBackToVersion(stored.id, old.id)).toBe(true);

    const now = (await getDesign(stored.id))!;
    expect(now.title).toBe("Poster, edited");
    expect(now.pages[0].elements).toHaveLength(2);
    expect(now.updatedAt).toBeGreaterThan(9_000);
    const labels = (await listVersions(stored.id)).map((v) => v.label);
    expect(labels).toContain("Before going back");
    const kept = (await listVersions(stored.id)).find((v) => v.label === "Before going back")!;
    expect((await getVersion(kept.id))!.design.pages[0].elements).toHaveLength(1);
  });

  it("does not touch the design for a version that is not there, or is another design's", async () => {
    const a = withShapes("A", 1);
    const b = withShapes("B", 4);
    await saveDesign(a);
    await saveDesign(b);
    await tick();
    await saveVersion(b);
    const [theirs] = await listVersions(b.id);
    expect(await goBackToVersion(a.id, theirs.id)).toBe(false);
    expect(await goBackToVersion(a.id, "nope")).toBe(false);
    expect((await getDesign(a.id))!.pages[0].elements).toHaveLength(1);
    expect(await listVersions(a.id)).toEqual([]);
  });

  it("makes the design from the version when the design itself is gone", async () => {
    const stored = withShapes("Poster", 2);
    await saveDesign(stored);
    await saveVersion(stored);
    const [v] = await listVersions(stored.id);
    const { deleteForever } = await import("./library");
    await deleteForever(stored.id);
    await saveVersion(stored); // deleteForever takes the versions along: put one back
    const [again] = await listVersions(stored.id);
    expect(await goBackToVersion(stored.id, again.id)).toBe(true);
    expect((await getDesign(stored.id))!.title).toBe("Poster");
    expect(v.designId).toBe(stored.id);
  });
});

describe("when it was last saved", () => {
  it("is the time on the design's record, or nothing", async () => {
    const stored = withShapes("Poster", 1, 123_456);
    await saveDesign(stored);
    expect(await savedAt(stored.id)).toBe(123_456);
    expect(await savedAt("nope")).toBeNull();
  });
});
