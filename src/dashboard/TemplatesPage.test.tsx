import { act, fireEvent, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TEMPLATES, TEMPLATE_CATEGORY_LABELS, searchTemplates } from "@/data/templates";
import { Hosts, dismissOpenDialogs, emptyLibrary, resetDashboardStores, stubBox } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeCreateDialog } from "./createDialogState";
import { CATEGORY_ORDER } from "./templateLists";
import { takePresetTemplateSearch, presetTemplateSearch } from "./templatePreview";
import { TemplatesPage } from "./TemplatesPage";

const PAGE = 24;

function mountTemplates(category?: string) {
  return render(
    <>
      <TemplatesPage category={category} />
      <Hosts />
    </>,
  );
}

const searchBox = () => screen.getByRole("searchbox", { name: "Search templates" }) as HTMLInputElement;
const chips = () => screen.getAllByRole("tab").filter((tab) => tab.closest("[aria-label='Template categories']"));
const chip = (name: string) => screen.getByRole("tab", { name });
const cards = () => screen.queryAllByRole("article");
const count = () => document.querySelector(".cf-tplpage__count")?.textContent;
const plural = (n: number) => `${n} ${n === 1 ? "template" : "templates"}`;
const countedText = (n: number, shown: number) => (n > shown ? `Showing ${shown} of ${plural(n)}` : plural(n));

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
  takePresetTemplateSearch();
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeCreateDialog();
    toast.clear();
  });
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<TemplatesPage>", () => {
  it("has a hero with a search and a pill per template category, plus All and Favourites", async () => {
    stubBox(960);
    mountTemplates();
    expect(screen.getByRole("heading", { level: 1, name: "Start with a great template" })).toBeTruthy();
    expect(searchBox().placeholder).toBe("Search templates, e.g. birthday, resume or pitch");
    const present = CATEGORY_ORDER.filter((id) => TEMPLATES.some((template) => template.category === id));
    expect(chips().map((el) => el.textContent)).toEqual(["All", ...present.map((id) => TEMPLATE_CATEGORY_LABELS[id]), "Favourites"]);
    expect(chip("All").getAttribute("aria-selected")).toBe("true");
  });

  describe("the list", () => {
    it("counts the templates and shows the first page of them, newest first by catalogue order", async () => {
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBe(Math.min(PAGE, TEMPLATES.length)));
      expect(count()).toBe(countedText(TEMPLATES.length, PAGE));
      expect(screen.getAllByRole("button", { name: /^Preview template / })[0].getAttribute("aria-label")).toBe(`Preview template ${TEMPLATES[0].name}`);
    });

    it("shows the name under each template", async () => {
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
      expect(within(cards()[0]).getByText(TEMPLATES[0].name)).toBeTruthy();
    });

    it("shows 24 more each time Show more is pressed, until everything is there", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBe(PAGE));
      let shown = PAGE;
      while (shown < TEMPLATES.length) {
        await user.click(screen.getByRole("button", { name: "Show more" }));
        shown = Math.min(TEMPLATES.length, shown + PAGE);
        await waitFor(() => expect(cards().length).toBe(shown));
        expect(count()).toBe(countedText(TEMPLATES.length, shown));
      }
      expect(screen.queryByRole("button", { name: "Show more" })).toBeNull();
    });

    it("waits for the width of the area before drawing the templates", () => {
      mountTemplates();
      expect(cards()).toHaveLength(0);
      expect(count()).toBe(countedText(TEMPLATES.length, PAGE));
    });
  });

  describe("the grid", () => {
    it.each([
      [960, 4, 228],
      [800, 3, 256],
      [400, 2, 192],
      [1500, 6, 236],
    ])("fits the cards to a %s px wide area: %s columns of %s px", async (width, columns, cardWidth) => {
      stubBox(width);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
      expect((document.querySelector(".cf-tplpage__masonry") as HTMLElement).style.columnCount).toBe(String(columns));
      expect(cards()[0].style.width).toBe(`${cardWidth}px`);
    });

    it("never goes below two columns on a narrow phone, nor below 80 px per card", async () => {
      stubBox(200);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
      expect((document.querySelector(".cf-tplpage__masonry") as HTMLElement).style.columnCount).toBe("2");
      expect(parseInt(cards()[0].style.width, 10)).toBeGreaterThanOrEqual(80);
    });
  });

  describe("search", () => {
    it("narrows the list to the templates that match every word", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
      const query = "social";
      await user.type(searchBox(), query);
      const expected = searchTemplates(query);
      expect(expected.length).toBeGreaterThan(0);
      await waitFor(() => expect(count()).toBe(countedText(expected.length, PAGE)));
      expect(within(cards()[0]).getByText(expected[0].name)).toBeTruthy();
    });

    it("says nothing matches and offers to clear the search", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await user.type(searchBox(), "zzzqqq");
      expect(await screen.findByText("No templates match “zzzqqq”")).toBeTruthy();
      expect(screen.getByText("Check the spelling, try a more general word, or pick another category.")).toBeTruthy();
      expect(count()).toBeUndefined();
      await user.click(within(screen.getByText("No templates match “zzzqqq”").closest(".cf-empty") as HTMLElement).getByRole("button", { name: "Clear search" }));
      expect(searchBox().value).toBe("");
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    });

    it("starts with the search that was typed on Home", async () => {
      presetTemplateSearch("social");
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(searchBox().value).toBe("social"));
      expect(count()).toBe(countedText(searchTemplates("social").length, PAGE));
      expect(takePresetTemplateSearch()).toBe("");
    });

    it("goes back to the first page of results when the search changes", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBe(PAGE));
      await user.click(screen.getByRole("button", { name: "Show more" }));
      await waitFor(() => expect(cards().length).toBe(Math.min(2 * PAGE, TEMPLATES.length)));
      await user.type(searchBox(), "a");
      await waitFor(() => expect(count()).toBe(countedText(searchTemplates("a").length, PAGE)));
    });
  });

  describe("categories", () => {
    it("shows only one category when the route names it, with its pill selected", async () => {
      stubBox(960);
      mountTemplates("social");
      const expected = TEMPLATES.filter((template) => template.category === "social");
      await waitFor(() => expect(count()).toBe(countedText(expected.length, PAGE)));
      expect(chip(TEMPLATE_CATEGORY_LABELS.social).getAttribute("aria-selected")).toBe("true");
      expect(chip("All").getAttribute("aria-selected")).toBe("false");
    });

    it("shows everything for a category name it does not know", async () => {
      stubBox(960);
      mountTemplates("bogus");
      await waitFor(() => expect(count()).toBe(countedText(TEMPLATES.length, PAGE)));
      expect(chip("All").getAttribute("aria-selected")).toBe("true");
    });

    it("goes to the page of a category when its pill is pressed, and back to all with All", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await user.click(chip(TEMPLATE_CATEGORY_LABELS.social));
      expect(window.location.hash).toBe("#/templates/social");
      await user.click(chip("All"));
      expect(window.location.hash).toBe("#/templates");
    });
  });

  describe("favourites", () => {
    it("says there are none yet, with a way back to all templates", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await user.click(chip("Favourites"));
      expect(chip("Favourites").getAttribute("aria-selected")).toBe("true");
      expect(await screen.findByText("No favourite templates yet")).toBeTruthy();
      expect(screen.getByText("Tap the star on a template to keep it here.")).toBeTruthy();
      await user.click(screen.getByRole("button", { name: "Show all templates" }));
      expect(chip("All").getAttribute("aria-selected")).toBe("true");
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    });

    it("shows the templates that were starred", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
      const first = TEMPLATES[0];
      await user.click(within(cards()[0]).getByRole("button", { name: "Add to favourites" }));
      await screen.findByText(`Added “${first.name}” to your favourites`);
      await user.click(chip("Favourites"));
      await waitFor(() => expect(cards()).toHaveLength(1));
      expect(count()).toBe("1 template");
      expect(within(cards()[0]).getByText(first.name)).toBeTruthy();
      await user.click(within(cards()[0]).getByRole("button", { name: "Remove from favourites" }));
      expect(await screen.findByText("No favourite templates yet")).toBeTruthy();
    });

    it("shows every favourite when Favourites is picked from inside another category", async () => {
      const user = userEvent.setup();
      stubBox(960);
      const first = TEMPLATES[0];
      const other = CATEGORY_ORDER.find((id) => id !== first.category && TEMPLATES.some((template) => template.category === id))!;
      const view = mountTemplates();
      await waitFor(() => expect(cards().length).toBeGreaterThan(0));
      await user.click(within(cards()[0]).getByRole("button", { name: "Add to favourites" }));
      await screen.findByText(`Added “${first.name}” to your favourites`);
      // the route moves to another category, as clicking its chip does
      view.rerender(
        <>
          <TemplatesPage category={other} />
          <Hosts />
        </>,
      );
      await waitFor(() => expect(chip(TEMPLATE_CATEGORY_LABELS[other]).getAttribute("aria-selected")).toBe("true"));
      await user.click(chip("Favourites"));
      await waitFor(() => expect(cards()).toHaveLength(1));
      expect(within(cards()[0]).getByText(first.name)).toBeTruthy();
      expect(screen.queryByText("No favourite templates yet")).toBeNull();
    });

    it("tells apart 'no favourites' from 'nothing matches' when searching among them", async () => {
      const user = userEvent.setup();
      stubBox(960);
      mountTemplates();
      await user.click(chip("Favourites"));
      await user.type(searchBox(), "zzzqqq");
      expect(await screen.findByText("No templates match “zzzqqq”")).toBeTruthy();
    });

    it("leaves the favourites when another category is chosen", async () => {
      const user = userEvent.setup();
      stubBox(960);
      const view = mountTemplates();
      await user.click(chip("Favourites"));
      expect(chip("Favourites").getAttribute("aria-selected")).toBe("true");
      view.rerender(
        <>
          <TemplatesPage category="social" />
          <Hosts />
        </>,
      );
      await waitFor(() => expect(chip("Favourites").getAttribute("aria-selected")).toBe("false"));
      expect(chip(TEMPLATE_CATEGORY_LABELS.social).getAttribute("aria-selected")).toBe("true");
    });
  });

  it("opens the preview of a template from its card", async () => {
    const user = userEvent.setup();
    const { usePreviewTemplate } = await import("./templatePreview");
    stubBox(960);
    mountTemplates();
    const preview = renderHook(() => usePreviewTemplate());
    await waitFor(() => expect(cards().length).toBeGreaterThan(0));
    await user.click(screen.getAllByRole("button", { name: /^Preview template / })[0]);
    expect(preview.result.current?.id).toBe(TEMPLATES[0].id);
    fireEvent.keyDown(document.body, { key: "Escape" });
  });
});

describe("<TemplatesPage> before any templates exist", () => {
  afterEach(() => {
    vi.doUnmock("@/data/templates");
    vi.resetModules();
  });

  it("says templates are on their way and offers the design types instead", async () => {
    const user = userEvent.setup();
    vi.resetModules();
    vi.doMock("@/data/templates", () => ({ TEMPLATES: [], TEMPLATE_CATEGORY_LABELS: { social: "Social media" }, searchTemplates: () => [] }));
    const { TemplatesPage: EmptyCataloguePage } = await import("./TemplatesPage");
    // the dialog state lives in the freshly loaded modules, not in the ones imported at the top of this file
    const fresh = await import("./createDialogState");
    const dialog = renderHook(() => fresh.useCreateDialog());
    render(<EmptyCataloguePage />);
    expect(await screen.findByText("Templates are on their way")).toBeTruthy();
    expect(screen.getByRole("heading", { level: 2, name: "Templates are on their way" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Browse design types" }));
    expect(dialog.result.current.open).toBe(true);
  });
});

describe("<TemplatesPage> with a category that has no templates", () => {
  afterEach(() => {
    vi.doUnmock("@/data/templates");
    vi.resetModules();
  });

  /** A catalogue with one social template, whose label table also knows the (empty) poster category. */
  async function withSocialOnlyCatalogue() {
    vi.resetModules();
    const { createPage, createText, solid } = await import("@/core/factory");
    const only = {
      id: "only-social",
      name: "Only social",
      category: "social",
      typeId: "instagram-post",
      width: 1080,
      height: 1350,
      tags: [],
      accent: "#ff8800",
      pages: [createPage({ background: solid("#ffffff"), elements: [createText({ text: "Hi" })] })],
    };
    const templates = [only];
    vi.doMock("@/data/templates", () => ({
      TEMPLATES: templates,
      TEMPLATE_CATEGORY_LABELS: { social: "Social media", poster: "Posters" },
      searchTemplates: (_query: string, category?: string | null) => templates.filter((template) => !category || template.category === category),
    }));
    return import("./TemplatesPage");
  }

  it("keeps the pill of the category the page is on, says it has no templates, and leads back to all of them", async () => {
    const user = userEvent.setup();
    const { TemplatesPage: SocialOnlyPage } = await withSocialOnlyCatalogue();
    stubBox(960);
    render(<SocialOnlyPage category="poster" />);
    expect(chips().map((el) => el.textContent)).toEqual(["All", "Social media", "Posters", "Favourites"]);
    expect(chip("Posters").getAttribute("aria-selected")).toBe("true");
    expect(await screen.findByText("No templates in this category")).toBeTruthy();
    expect(screen.getByText("Try another category, or look at all templates.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Show all templates" }));
    expect(window.location.hash).toBe("#/templates");
  });

  it("shows the templates of the other categories as usual", async () => {
    const { TemplatesPage: SocialOnlyPage } = await withSocialOnlyCatalogue();
    stubBox(960);
    render(<SocialOnlyPage />);
    await waitFor(() => expect(cards()).toHaveLength(1));
    expect(count()).toBe("1 template");
    expect(within(cards()[0]).getByText("Only social")).toBeTruthy();
    expect(chips().map((el) => el.textContent)).toEqual(["All", "Social media", "Favourites"]);
  });
});
