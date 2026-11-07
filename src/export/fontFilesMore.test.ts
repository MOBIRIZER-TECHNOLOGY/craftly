import { afterEach, describe, expect, it, vi } from "vitest";

// Loads the renderer and the font table, like fontFiles.test.ts: allow for a busy machine.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

afterEach(() => {
  vi.doUnmock("@fontsource/lobster/files/lobster-latin-400-normal.woff2?url");
  vi.resetModules();
});

describe("a font file that cannot be loaded", () => {
  it("is reported as missing instead of failing the export, and the others still load", async () => {
    vi.resetModules();
    vi.doMock("@fontsource/lobster/files/lobster-latin-400-normal.woff2?url", () => {
      throw new Error("the font chunk did not load");
    });
    const { fontFile, fontFileUrl } = await import("./fontFiles");
    expect(await fontFile("Lobster", 400, false)).toBeNull();
    expect(await fontFileUrl("Lobster")).toBeNull();
    const other = await fontFile("Anton", 400, false);
    expect(other?.url).toMatch(/\.woff2$/);
  });
});
