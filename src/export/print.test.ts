import { beforeAll, describe, expect, it, vi } from "vitest";

// This file loads the renderer and the font table, which takes a few seconds when many test files do the same at once:
// give it more time than the defaults so a busy machine does not fail it.
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 });

type PrintModule = typeof import("./print");
let print: PrintModule;

beforeAll(async () => {
  vi.stubGlobal("Path2D", class {}); // render/renderPage.ts builds a Path2D at import time
  print = await import("./print");
});

describe("printDocumentHtml", () => {
  it("lays out one full-bleed image per page and sizes @page like the design", () => {
    const html = print.printDocumentHtml({ title: "Menu", width: 1920, height: 1080 }, ["blob:a", "blob:b", "blob:c"]);
    expect(html).toContain("@page { size: 1920px 1080px; margin: 0; }");
    expect(html).toContain("width: 1920px; height: 1080px;");
    expect(html.match(/<img /g)).toHaveLength(3);
    expect(html).toContain('<img src="blob:a" alt="Page 1">');
    expect(html).toContain('<img src="blob:c" alt="Page 3">');
    // no stray blank sheet after the last page
    expect(html).toContain("img:last-child { break-after: auto; page-break-after: auto; }");
  });

  it("escapes the title and URLs", () => {
    const html = print.printDocumentHtml({ title: 'A "quoted" <title> & more', width: 100.4, height: 50.6 }, ['blob:x" onerror="evil()']);
    expect(html).toContain("<title>A &quot;quoted&quot; &lt;title> &amp; more</title>");
    expect(html).not.toContain('onerror="evil()"');
    expect(html).toContain("size: 100px 51px");
  });

  it("refuses to print without a document or pages", async () => {
    await expect(print.printDesign({ title: "x", width: 1, height: 1, pages: [] } as never)).rejects.toMatchObject({ code: "unsupported" });
  });
});
