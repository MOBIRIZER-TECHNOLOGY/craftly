import { beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createImage, createPage, createShape, solid } from "@/core/factory";
import type { Design } from "@/core/types";
import { ExportError } from "./errors";
import { exportDesign, type ExportFile } from "./exporters";
import { exportWebPage, webPageOptions } from "./webPageExport";

vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn() };
});

function designOf(init: Partial<Pick<Design, "title" | "width" | "height">> = {}): Design {
  const first = createPage({ background: solid("#ffffff"), elements: [createImage({ src: "a.png", alt: "A plate of pasta" }), createShape("rect", {})] });
  first.name = "Starters";
  first.notes = "Mention the secret price";
  const second = createPage({ background: solid("#ffffff"), elements: [createShape("rect", {})] });
  const third = createPage({ background: solid("#ffffff"), elements: [] });
  third.name = "Desserts";
  return createDesign({ title: "Menu", width: 400, height: 300, ...init, pages: [first, second, third] });
}

const jpeg = (text: string) => new Blob([text], { type: "image/jpeg" });
const base64 = (text: string) => `data:image/jpeg;base64,${btoa(text)}`;
const parse = async (file: ExportFile) => new DOMParser().parseFromString(await file.blob.text(), "text/html");

beforeEach(() => {
  vi.mocked(exportDesign).mockReset();
  vi.mocked(exportDesign).mockImplementation(async (_design, options) => ({ name: "page.jpg", blob: jpeg(`picture of page ${options.pages[0] + 1}`) }));
});

describe("webPageOptions", () => {
  it("paints a page as a JPEG of about 1920 pixels on its longer side, never more than twice its size", () => {
    expect(webPageOptions({ width: 1920, height: 1080 }, 2)).toMatchObject({ format: "jpg", pages: [2], scale: 1, quality: 0.9, transparent: false });
    expect(webPageOptions({ width: 2560, height: 1440 }, 0).scale).toBe(0.75);
    expect(webPageOptions({ width: 1080, height: 1920 }, 0).scale).toBe(1);
    expect(webPageOptions({ width: 400, height: 300 }, 0).scale).toBe(2);
  });
});

describe("exportWebPage", () => {
  it("makes one .html file named after the design, with the chosen pages as pictures in it", async () => {
    const file = await exportWebPage(designOf(), { pages: [0, 2], notes: false, lang: "en-GB" });
    expect(file.name).toBe("Menu.html");
    expect(file.blob.type).toBe("text/html;charset=utf-8");
    const doc = await parse(file);
    expect(doc.title).toBe("Menu");
    expect(doc.documentElement.lang).toBe("en-GB");
    const images = [...doc.querySelectorAll("img")];
    expect(images.map((i) => i.getAttribute("src"))).toEqual([base64("picture of page 1"), base64("picture of page 3")]);
    expect(images.map((i) => i.getAttribute("width"))).toEqual(["400", "400"]);
    expect(vi.mocked(exportDesign).mock.calls.map(([, options]) => options)).toEqual([
      webPageOptions({ width: 400, height: 300 }, 0),
      webPageOptions({ width: 400, height: 300 }, 2),
    ]);
  });

  it("describes a page by the alt texts of what is on it, and by its number and name without them", async () => {
    const doc = await parse(await exportWebPage(designOf(), { pages: [0, 1, 2], notes: false }));
    expect([...doc.querySelectorAll("img")].map((i) => i.getAttribute("alt"))).toEqual(["A plate of pasta", "Page 2", "Page 3: Desserts"]);
    expect(doc.querySelector(".slide")?.getAttribute("aria-label")).toBe("Page 1 of 3: Starters");
  });

  it("never has the comments of the design in it, also with the presenter notes", async () => {
    const design = designOf();
    const noted: Design = {
      ...design,
      comments: [
        {
          id: "c",
          pageId: design.pages[0].id,
          anchor: { x: 1, y: 1 },
          author: { name: "Ann", colorIndex: 0 },
          createdAt: 1,
          text: "A private remark",
          resolved: false,
          replies: [],
        },
      ],
    };
    const file = await exportWebPage(noted, { pages: [0, 1, 2], notes: true });
    expect(await file.blob.text()).not.toContain("private remark");
  });

  it("leaves the presenter notes out unless they are asked for", async () => {
    const without = await exportWebPage(designOf(), { pages: [0, 1, 2], notes: false });
    expect(await without.blob.text()).not.toContain("secret");
    const doc = await parse(await exportWebPage(designOf(), { pages: [0, 1, 2], notes: true }));
    expect(doc.querySelector(".notes p")?.textContent).toBe("Mention the secret price");
  });

  it("keeps a hostile title as text and out of the file name", async () => {
    const file = await exportWebPage(designOf({ title: '</title><script>alert("x")</script>' }), { pages: [0], notes: false });
    expect(file.name).toBe("title script alert( x ) script.html");
    const doc = await parse(file);
    expect(doc.title).toBe('</title><script>alert("x")</script>');
    expect(doc.querySelectorAll("script")).toHaveLength(1);
  });

  it("counts the pages as they are painted", async () => {
    const seen: Array<[number, number]> = [];
    await exportWebPage(designOf(), { pages: [0, 1, 2], notes: false }, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("tells once what the exporter had to say about the pictures", async () => {
    vi.mocked(exportDesign).mockImplementation(async () => ({ name: "x", blob: jpeg("x"), note: "An image could not be loaded." }));
    expect((await exportWebPage(designOf(), { pages: [0, 1], notes: false })).note).toBe("An image could not be loaded.");
  });

  it("asks for a page when none is chosen", async () => {
    await expect(exportWebPage(designOf(), { pages: [9], notes: false })).rejects.toMatchObject({ code: "no-pages" });
    expect(exportDesign).not.toHaveBeenCalled();
  });

  it("stops between pages when it is cancelled, whether before or while a page is painted", async () => {
    const controller = new AbortController();
    vi.mocked(exportDesign).mockImplementation(async (_d, _o, _p, signal) => {
      expect(signal).toBe(controller.signal);
      controller.abort();
      return { name: "x", blob: jpeg("x") };
    });
    await expect(exportWebPage(designOf(), { pages: [0, 1, 2], notes: false }, undefined, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(exportDesign).toHaveBeenCalledTimes(1);
    await expect(exportWebPage(designOf(), { pages: [0], notes: false }, undefined, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(exportDesign).toHaveBeenCalledTimes(1);
  });

  it("gives up with the exporter's own error when a page cannot be painted", async () => {
    vi.mocked(exportDesign).mockRejectedValue(new ExportError("too-large", "This design is too large to export at this size - try a smaller size."));
    await expect(exportWebPage(designOf(), { pages: [0, 1], notes: false })).rejects.toMatchObject({ code: "too-large" });
  });

  it("stops as soon as the pictures are more than one file may hold, without painting the rest", async () => {
    const heavy = "x".repeat(16 * 1024 * 1024);
    vi.mocked(exportDesign).mockImplementation(async () => ({ name: "x", blob: jpeg(heavy) }));
    await expect(exportWebPage(designOf(), { pages: [0, 1, 2], notes: false })).rejects.toMatchObject({
      code: "too-large",
      message: "These pages make a web page of more than 40 MB. Choose fewer pages.",
    });
    expect(exportDesign).toHaveBeenCalledTimes(2);
  });
});
