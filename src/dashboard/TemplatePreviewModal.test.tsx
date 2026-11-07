import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPage, createText, solid } from "@/core/factory";
import * as library from "@/core/library";
import { getDesign, listDesigns } from "@/core/library";
import { metaGet } from "@/core/persistence";
import type { Template } from "@/core/types";
import * as renderPage from "@/render/renderPage";
import { Hosts, dismissOpenDialogs, emptyLibrary, stubBox } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { TemplatePreviewHost } from "./TemplatePreviewModal";
import { closeTemplatePreview, openTemplatePreview, usePreviewTemplate } from "./templatePreview";

let counter = 0;
function makeTemplate(over: Partial<Template> = {}): Template {
  counter += 1;
  return {
    id: `preview-tpl-${counter}`,
    name: `Sunny day ${counter}`,
    category: "poster",
    typeId: "poster",
    width: 1728,
    height: 2304,
    tags: ["summer", "beach"],
    accent: "#ff8800",
    pages: [1, 2, 3].map((n) => createPage({ background: solid("#ffffff"), elements: [createText({ text: `Page ${n}` })] })),
    ...over,
  };
}

function mountPreview() {
  return render(
    <>
      <TemplatePreviewHost />
      <Hosts />
    </>,
  );
}

const open = (template: Template) => act(() => openTemplatePreview(template));
const dialog = (template: Template) => screen.getByRole("dialog", { name: `Template preview: ${template.name}` });
const strip = () => screen.getByRole("group", { name: "Pages" });
const pageButtons = () => within(strip()).getAllByRole("button");
const currentPage = () => pageButtons().findIndex((button) => button.getAttribute("aria-current") === "true");

beforeEach(async () => {
  await emptyLibrary();
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeTemplatePreview();
    toast.clear();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<TemplatePreviewHost>", () => {
  it("shows nothing until a template is opened", () => {
    mountPreview();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("describes the template: name, category, size and number of pages", () => {
    const template = makeTemplate({ name: "Summer sale" });
    mountPreview();
    open(template);
    const el = dialog(template);
    expect(within(el).getByText("Template")).toBeTruthy();
    expect(within(el).getByRole("heading", { level: 2, name: "Summer sale" })).toBeTruthy();
    const facts = Array.from(el.querySelectorAll(".cf-tpreview__facts > div")).map((row) => `${row.querySelector("dt")?.textContent}: ${row.querySelector("dd")?.textContent}`);
    expect(facts).toEqual(["Category: Posters", "Size: 18 × 24 in", "Pages: 3 pages"]);
    expect(within(el).getByText("Customizing makes a copy in your projects. The original template stays as it is.")).toBeTruthy();
  });

  it("falls back to the raw category and to pixels for a type that is not in the catalogue", () => {
    const template = makeTemplate({ category: "mystery" as Template["category"], typeId: "no-such-type", width: 800, height: 600 });
    mountPreview();
    open(template);
    const el = dialog(template);
    expect(el.textContent).toContain("mystery");
    expect(el.textContent).toContain("800 × 600 px");
  });

  it("says '1 page' for a single page and has no page strip", () => {
    const template = makeTemplate({ pages: [createPage({ background: solid("#fff") })] });
    mountPreview();
    open(template);
    expect(dialog(template).textContent).toContain("1 page");
    expect(screen.queryByRole("group", { name: "Pages" })).toBeNull();
  });

  describe("tags", () => {
    it("lists the tags", () => {
      const template = makeTemplate({ tags: ["summer", "beach"] });
      mountPreview();
      open(template);
      expect(
        within(within(dialog(template)).getByRole("list", { name: "Tags" }))
          .getAllByRole("listitem")
          .map((item) => item.textContent),
      ).toEqual(["summer", "beach"]);
    });

    it("shows at most ten", () => {
      const template = makeTemplate({ tags: Array.from({ length: 14 }, (_unused, index) => `tag${index}`) });
      mountPreview();
      open(template);
      expect(within(within(dialog(template)).getByRole("list", { name: "Tags" })).getAllByRole("listitem")).toHaveLength(10);
    });

    it("leaves the list out for a template without tags", () => {
      const template = makeTemplate({ tags: [] });
      mountPreview();
      open(template);
      expect(within(dialog(template)).queryByRole("list", { name: "Tags" })).toBeNull();
    });
  });

  describe("pages", () => {
    it("has a button for every page, the first one current", () => {
      const template = makeTemplate();
      mountPreview();
      open(template);
      expect(pageButtons().map((button) => button.getAttribute("aria-label"))).toEqual(["Page 1 of 3", "Page 2 of 3", "Page 3 of 3"]);
      expect(currentPage()).toBe(0);
    });

    it("shows the page that is chosen in the big preview", async () => {
      const user = userEvent.setup();
      const template = makeTemplate();
      const spy = vi.spyOn(renderPage, "renderPageToCanvas");
      mountPreview();
      open(template);
      await user.click(screen.getByRole("button", { name: "Page 3 of 3" }));
      expect(currentPage()).toBe(2);
      await waitFor(() => expect(spy.mock.calls.some((call) => call[1] === template.pages[2] && call[2].width >= 160)).toBe(true));
    });

    it("moves with the arrow keys, Home and End, and keeps the focus on the page button", async () => {
      const user = userEvent.setup();
      const template = makeTemplate();
      mountPreview();
      open(template);
      pageButtons()[0].focus();
      await user.keyboard("{ArrowRight}");
      expect(currentPage()).toBe(1);
      await waitFor(() => expect(document.activeElement).toBe(pageButtons()[1]));
      await user.keyboard("{End}");
      expect(currentPage()).toBe(2);
      await user.keyboard("{ArrowRight}");
      expect(currentPage()).toBe(2);
      await user.keyboard("{ArrowLeft}");
      expect(currentPage()).toBe(1);
      await user.keyboard("{Home}");
      expect(currentPage()).toBe(0);
      await user.keyboard("{ArrowLeft}");
      expect(currentPage()).toBe(0);
    });

    it("ignores other keys on the strip", async () => {
      const template = makeTemplate();
      mountPreview();
      open(template);
      pageButtons()[0].focus();
      expect(fireEvent.keyDown(pageButtons()[0], { key: "a" })).toBe(true);
      expect(currentPage()).toBe(0);
    });

    it("starts again from the first page for another template", () => {
      const first = makeTemplate();
      const second = makeTemplate();
      mountPreview();
      open(first);
      fireEvent.click(screen.getByRole("button", { name: "Page 2 of 3" }));
      expect(currentPage()).toBe(1);
      open(second);
      expect(dialog(second)).toBeTruthy();
      expect(currentPage()).toBe(0);
    });
  });

  describe("preview size", () => {
    it("is at least 160 pixels wide once the area reports that it has no size", async () => {
      const template = makeTemplate();
      mountPreview();
      open(template);
      await waitFor(() => expect((dialog(template).querySelector(".cf-tpreview__page") as HTMLElement).style.width).toBe("160px"));
    });

    it("fits the area and the window height, keeping the shape of the template", () => {
      stubBox(800);
      const template = makeTemplate();
      mountPreview();
      open(template);
      // the window is 800 high: 56 % of it is 448 px, and a 3:4 page that high is 336 px wide
      expect((dialog(template).querySelector(".cf-tpreview__page") as HTMLElement).style.width).toBe("336px");
      expect((pageButtons()[0].querySelector("div") as HTMLElement).style.width).toBe("45px");
    });

    it("never gets wider than 560 pixels", () => {
      stubBox(2000);
      const template = makeTemplate({ width: 2000, height: 600 });
      mountPreview();
      open(template);
      expect((dialog(template).querySelector(".cf-tpreview__page") as HTMLElement).style.width).toBe("560px");
    });
  });

  describe("customizing", () => {
    it("starts with the focus on the Customize button", () => {
      const template = makeTemplate();
      mountPreview();
      open(template);
      expect(document.activeElement).toBe(screen.getByRole("button", { name: "Customize this template" }));
    });

    it("makes a copy of the template in the user's projects and opens it, closing the preview", async () => {
      const user = userEvent.setup();
      const template = makeTemplate({ name: "Copy me" });
      mountPreview();
      const preview = renderHook(() => usePreviewTemplate());
      open(template);
      await user.click(screen.getByRole("button", { name: "Customize this template" }));
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved).toMatchObject({ title: "Copy me", pageCount: 3 });
      expect(window.location.hash).toBe(`#/design/${saved.id}`);
      expect((await getDesign(saved.id))?.id).not.toBe(template.id);
      expect(preview.result.current).toBeNull();
    });

    it("shows that it is working while the copy is made", async () => {
      const user = userEvent.setup();
      const template = makeTemplate();
      let release: () => void = () => undefined;
      const real = library.createDesignFromPages;
      vi.spyOn(library, "createDesignFromPages").mockImplementationOnce(async (options) => {
        await new Promise<void>((resolve) => (release = resolve));
        return real(options);
      });
      mountPreview();
      open(template);
      const button = screen.getByRole("button", { name: "Customize this template" });
      await user.click(button);
      await waitFor(() => expect(button.getAttribute("aria-busy")).toBe("true"));
      release();
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    });

    it("says what went wrong and lets the user try again", async () => {
      const user = userEvent.setup();
      vi.spyOn(console, "error").mockImplementation(() => undefined);
      vi.spyOn(library, "createDesignFromPages").mockRejectedValueOnce(new Error("Storage is full."));
      const template = makeTemplate();
      mountPreview();
      open(template);
      const button = screen.getByRole("button", { name: "Customize this template" });
      await user.click(button);
      expect(await screen.findByText("Couldn't start a design from this template. Storage is full.")).toBeTruthy();
      await waitFor(() => expect(button.getAttribute("aria-busy")).toBeNull());
      expect(dialog(template)).toBeTruthy();
      await user.click(button);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
    });
  });

  describe("favourites", () => {
    it("adds the template to the favourites and takes it out again", async () => {
      const user = userEvent.setup();
      const template = makeTemplate({ name: "Favourite me" });
      mountPreview();
      open(template);
      const button = screen.getByRole("button", { name: "Add to favourites" });
      expect(button.getAttribute("aria-pressed")).toBe("false");
      await user.click(button);
      const pressed = await screen.findByRole("button", { name: "In your favourites" });
      expect(pressed.getAttribute("aria-pressed")).toBe("true");
      expect(await metaGet<string[]>("favTemplates", [])).toContain(template.id);
      expect(await screen.findByText("Added “Favourite me” to your favourites")).toBeTruthy();
      await user.click(pressed);
      expect(await screen.findByRole("button", { name: "Add to favourites" })).toBeTruthy();
      expect(await metaGet<string[]>("favTemplates", [])).not.toContain(template.id);
    });
  });

  describe("closing", () => {
    it("closes from the Close button", async () => {
      const user = userEvent.setup();
      const template = makeTemplate();
      mountPreview();
      const preview = renderHook(() => usePreviewTemplate());
      open(template);
      await user.click(screen.getByRole("button", { name: "Close" }));
      expect(preview.result.current).toBeNull();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });

    it("closes on Escape and when the backdrop is clicked", async () => {
      const user = userEvent.setup();
      const first = makeTemplate();
      mountPreview();
      const preview = renderHook(() => usePreviewTemplate());
      open(first);
      await user.keyboard("{Escape}");
      expect(preview.result.current).toBeNull();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      open(makeTemplate());
      await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
      expect(preview.result.current).toBeNull();
    });

    it("keeps showing the template while the dialog fades out", async () => {
      const template = makeTemplate({ name: "Fading out" });
      mountPreview();
      open(template);
      act(() => closeTemplatePreview());
      expect(dialog(template)).toBeTruthy();
      expect(within(dialog(template)).getByRole("heading", { level: 2, name: "Fading out" })).toBeTruthy();
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    });
  });
});
