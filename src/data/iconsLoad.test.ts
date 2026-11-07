import { afterEach, describe, expect, it, vi } from "vitest";

/** A fresh copy of the icon module, so what it remembered about loading lucide starts again. */
async function freshIcons() {
  vi.resetModules();
  return import("./icons");
}

afterEach(() => {
  vi.doUnmock("lucide");
  vi.resetModules();
});

describe("loading the icon library", () => {
  it("says so when the library has no table of icons", async () => {
    vi.doMock("lucide", () => ({ icons: undefined, default: undefined }));
    const { loadIconIndex, getIconSvg } = await freshIcons();
    await expect(loadIconIndex()).rejects.toThrow("lucide did not export an icons table");
    await expect(getIconSvg("heart")).rejects.toThrow("lucide did not export an icons table");
  });

  it("finds the table whether lucide exports it by name or as a default", async () => {
    const heart = [["path", { d: "M0 0L1 1" }]];
    vi.doMock("lucide", () => ({ icons: undefined, default: { icons: { Heart: heart } } }));
    const { loadIconIndex, getIconSvg } = await freshIcons();
    expect((await loadIconIndex()).map((i) => i.id)).toEqual(["heart"]);
    expect(await getIconSvg("heart")).toContain('d="M0 0L1 1"');
  });

  it("tries again, instead of failing for ever, when the library could not be fetched the first time", async () => {
    let reads = 0;
    vi.doMock("lucide", () => ({
      // reading the table fails the first time, as a chunk that did not arrive would
      get icons() {
        if (++reads === 1) throw new Error("the chunk did not load");
        return { Star: [["path", { d: "M2 2" }]] };
      },
      default: undefined,
    }));
    const { loadIconIndex } = await freshIcons();
    await expect(loadIconIndex()).rejects.toThrow("the chunk did not load");
    expect((await loadIconIndex()).map((i) => i.id)).toEqual(["star"]);
    expect(reads).toBe(2);
    // once loaded it is kept
    await loadIconIndex();
    expect(reads).toBe(2);
  });

  it("shares one load between everyone who asks at the same time", async () => {
    let reads = 0;
    vi.doMock("lucide", () => ({
      get icons() {
        reads++;
        return { Star: [["path", { d: "M2 2" }]] };
      },
    }));
    const { loadIconIndex, getIconSvg } = await freshIcons();
    const [index, svg] = await Promise.all([loadIconIndex(), getIconSvg("star")]);
    expect(index).toHaveLength(1);
    expect(svg).toContain("<svg");
    expect(reads).toBe(1);
  });
});
