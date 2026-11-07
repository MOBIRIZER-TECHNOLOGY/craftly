import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createPage, createShape } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { TEMPLATES } from "@/data/templates";
import { stubLayout } from "@/test/helpers";
import { emptyDesign, mountPanels, pageElements } from "@/test/tabsHarness";

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = stubLayout(400, 700);
});
afterEach(() => restoreLayout());

const state = () => useEditor.getState();
const template = (name: string) => TEMPLATES.find((t) => t.name === name)!;

/** A design of a built-in size, with something on its page when `content` is set. */
function designOf(typeId: string, width: number, height: number, content = false): Design {
  const page = createPage({ elements: content ? [createShape("rect", { x: 20, y: 20, width: 100, height: 100 })] : [] });
  return createDesign({ title: `Design for ${typeId}`, typeId, width, height, pages: [page] });
}

const certificates = () => designOf("certificate", 1123, 794);
const presentation = (content = false) => designOf("presentation", 1920, 1080, content);

async function openTemplates(design: Design) {
  const user = userEvent.setup();
  mountPanels({ design, tab: "templates" });
  await screen.findByRole("searchbox");
  return user;
}

/** The names of the templates on show (their cards are buttons named after them). */
const cardNames = () =>
  screen
    .getAllByRole("button")
    .map((b) => b.getAttribute("aria-label") ?? "")
    .filter((label) => TEMPLATES.some((t) => label === t.name || label.startsWith(`${t.name}, `)));

describe("browsing templates", () => {
  it("starts with the templates that suit the design, and says so in the search box", async () => {
    await openTemplates(certificates());
    expect(screen.getByRole("searchbox", { name: "Search Certificate templates" })).toBeTruthy();
    expect(await screen.findByRole("button", { name: "Gold and Navy Achievement Certificate" })).toBeTruthy();
    expect(cardNames().sort()).toEqual(["Burgundy Appreciation Certificate", "Gold and Navy Achievement Certificate", "Teal Course Completion Certificate"]);
    expect(screen.getByRole("button", { name: "Certificates" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("puts the design's own category first among the chips, right after All", async () => {
    await openTemplates(certificates());
    const chips = within(screen.getByRole("group", { name: "Template categories" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent).slice(0, 3)).toEqual(["All", "Certificates", "Presentations"]);
    expect(chips).toHaveLength(13);
  });

  it("shows every category in the catalogue order for a custom size, with All selected", async () => {
    await openTemplates(emptyDesign());
    expect(screen.getByRole("searchbox", { name: "Search templates" })).toBeTruthy();
    const chips = within(screen.getByRole("group", { name: "Template categories" })).getAllByRole("button");
    expect(chips[0].textContent).toBe("All");
    expect(chips[1].textContent).toBe("Presentations");
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
  });

  it("switches category with a chip", async () => {
    const user = await openTemplates(certificates());
    await user.click(screen.getByRole("button", { name: "Logos" }));
    await waitFor(() => expect(cardNames().sort()).toEqual(["Atelier Marlowe Monogram", "Harbor and Pine Badge", "Hearth and Honey Wordmark", "Quadra Abstract Mark"]));
    expect(screen.getByRole("button", { name: "Logos" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Certificates" }).getAttribute("aria-pressed")).toBe("false");
  });

  it("filters by what is typed (every word has to match the name, category or a tag)", async () => {
    const user = await openTemplates(emptyDesign());
    await user.click(screen.getByRole("button", { name: "Menus" }));
    await user.type(screen.getByRole("searchbox"), "cocktail");
    await waitFor(() => expect(cardNames()).toEqual(["The Gilded Fern Cocktail Menu"]));
  });

  it("marks a template of several pages with its page count", async () => {
    await openTemplates(presentation());
    const deck = await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" });
    expect(within(deck).getByText("7")).toBeTruthy();
    expect(within(deck).getByText("Startup Pitch Deck")).toBeTruthy();
  });

  it("explains when nothing matches and offers to show everything again", async () => {
    const user = await openTemplates(certificates());
    await user.type(screen.getByRole("searchbox"), "zzzz");
    expect(await screen.findByText("No templates found")).toBeTruthy();
    expect(screen.getByText('Nothing matches "zzzz". Try a broader word or another category.')).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "Show all templates" }));
    expect((screen.getByRole("searchbox") as HTMLInputElement).value).toBe("");
    expect(screen.getByRole("button", { name: "All" }).getAttribute("aria-pressed")).toBe("true");
    expect(await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" })).toBeTruthy();
    expect(screen.queryByText("No templates found")).toBeNull();
  });

  describe("the shape filter", () => {
    it("is off until chosen, and keeps only templates with the design's proportions", async () => {
      const user = await openTemplates(certificates());
      await user.click(screen.getByRole("button", { name: "Logos" }));
      await waitFor(() => expect(cardNames()).toHaveLength(4));

      await user.click(screen.getByRole("button", { name: "Filter templates" }));
      const menu = screen.getByRole("menu", { name: "Template filters" });
      expect(within(menu).getByRole("menuitemcheckbox", { name: "All templates" }).getAttribute("aria-checked")).toBe("true");
      expect(within(menu).getByRole("menuitemcheckbox", { name: "Same shape as this design" }).getAttribute("aria-checked")).toBe("false");
      expect(within(menu).getByText("This design is 1123 × 794 px")).toBeTruthy();

      await user.click(within(menu).getByRole("menuitemcheckbox", { name: "Same shape as this design" }));
      // no logo is wider than tall: the list is empty and says so
      expect(await screen.findByText("No templates found")).toBeTruthy();
      expect(screen.getByText("No templates in this category yet.")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Filter templates" }).getAttribute("aria-pressed")).toBe("true");

      await user.click(screen.getByRole("button", { name: "Filter templates" }));
      await user.click(screen.getByRole("menuitemcheckbox", { name: "All templates" }));
      await waitFor(() => expect(cardNames()).toHaveLength(4));
      expect(screen.getByRole("button", { name: "Filter templates" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("shows landscape A4 certificates for a landscape A4 design", async () => {
      const user = await openTemplates(certificates());
      await user.click(screen.getByRole("button", { name: "Filter templates" }));
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Same shape as this design" }));
      await waitFor(() => expect(cardNames()).toHaveLength(3));
    });

    it("lets 'Show all templates' switch the filter off too", async () => {
      const user = await openTemplates(certificates());
      await user.click(screen.getByRole("button", { name: "Logos" }));
      await user.click(screen.getByRole("button", { name: "Filter templates" }));
      await user.click(screen.getByRole("menuitemcheckbox", { name: "Same shape as this design" }));
      await user.click(await screen.findByRole("button", { name: "Show all templates" }));
      expect(screen.getByRole("button", { name: "Filter templates" }).getAttribute("aria-pressed")).toBe("false");
      expect(await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" })).toBeTruthy();
    });
  });
});

describe("without a design", () => {
  it("shows nothing when the design closes", async () => {
    await openTemplates(certificates());
    expect(screen.getByRole("searchbox")).toBeTruthy();
    act(() => state().actions.closeDesign());
    await waitFor(() => expect(screen.queryByRole("searchbox")).toBeNull());
  });

  it("shows nothing in the detail view either", async () => {
    const user = await openTemplates(presentation());
    await user.click(await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" }));
    await screen.findByRole("heading", { name: "Startup Pitch Deck" });
    act(() => state().actions.closeDesign());
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Startup Pitch Deck" })).toBeNull());
  });
});

describe("using a one page template", () => {
  async function pickFernwood(design: Design) {
    const user = await openTemplates(design);
    await user.click(screen.getByRole("button", { name: "Social media" }));
    await user.type(screen.getByRole("searchbox"), "Fernwood");
    // the search waits 140 ms before it filters: let the wall settle, then take the card that is really on it
    await waitFor(() => expect(cardNames()).toEqual(["Fernwood Plant Spotlight"]));
    return { user, card: screen.getByRole("button", { name: "Fernwood Plant Spotlight" }) };
  }

  it("puts it on an empty page straight away, scaled to the design", async () => {
    const { user, card } = await pickFernwood(emptyDesign());
    await user.click(card);
    const fernwood = template("Fernwood Plant Spotlight");
    await waitFor(() => expect(pageElements()).toHaveLength(fernwood.pages[0].elements.length));
    expect(screen.queryByRole("dialog")).toBeNull();
    // the design is 1280 x 720 and the template 1080 x 1350, so nothing sticks out of the page
    const design = state().design!;
    for (const el of pageElements()) {
      expect(el.x).toBeGreaterThanOrEqual(-1);
      expect(el.x + el.width).toBeLessThanOrEqual(design.width + 1);
      expect(el.y + el.height).toBeLessThanOrEqual(design.height + 1);
    }
  });

  it("asks before it replaces a page with content, and keeps the page when you cancel", async () => {
    const design = designOf("custom", 1080, 1350, true);
    const { user, card } = await pickFernwood(design);
    await user.click(card);
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Replace this page?")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(pageElements().map((e) => e.type)).toEqual(["shape"]);
  });

  it("replaces the page's content once you confirm, and it can be undone", async () => {
    const design = designOf("custom", 1080, 1350, true);
    const { user, card } = await pickFernwood(design);
    await user.click(card);
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Replace" }));
    await waitFor(() => expect(pageElements()).toHaveLength(template("Fernwood Plant Spotlight").pages[0].elements.length));
    expect(state().selection).toEqual([]);
    state().actions.undo();
    expect(pageElements().map((e) => e.type)).toEqual(["shape"]);
  });

  it("works from the keyboard", async () => {
    const { user, card } = await pickFernwood(emptyDesign());
    card.focus();
    await user.keyboard("{Enter}");
    await waitFor(() => expect(pageElements().length).toBeGreaterThan(1));
  });
});

describe("using a template of several pages", () => {
  async function openDeck(design: Design) {
    const user = await openTemplates(design);
    await user.click(await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" }));
    await screen.findByRole("heading", { name: "Startup Pitch Deck" });
    return user;
  }

  it("opens a detail view with every page and the size of the template", async () => {
    await openDeck(presentation());
    expect(screen.getByText("7 pages - 1920 × 1080 px")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Apply all 7 pages" })).toBeTruthy();
    for (let n = 1; n <= 7; n++) {
      expect(screen.getByText(`Page ${n}`)).toBeTruthy();
      expect(screen.getByRole("button", { name: `Use page ${n} on the current page` })).toBeTruthy();
    }
    expect(screen.getAllByRole("button", { name: "Add as new page" })).toHaveLength(7);
    // nothing has been applied yet
    expect(pageElements()).toHaveLength(0);
  });

  it("goes back to the list with the search and category as they were", async () => {
    const user = await openTemplates(presentation());
    await user.type(screen.getByRole("searchbox"), "startup");
    await user.click(await screen.findByRole("button", { name: "Startup Pitch Deck, 7 pages" }));
    await user.click(await screen.findByRole("button", { name: "Back to templates" }));
    expect((await screen.findByRole("searchbox")) as HTMLInputElement).toHaveProperty("value", "startup");
    expect(screen.getByRole("button", { name: "Presentations" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("applies the whole deck to an empty page: page one replaces it and the rest follow", async () => {
    const user = await openDeck(presentation());
    const firstId = state().activePageId;
    await user.click(screen.getByRole("button", { name: "Apply all 7 pages" }));
    await waitFor(() => expect(state().design?.pages).toHaveLength(7));
    expect(screen.queryByRole("dialog")).toBeNull();
    const deck = template("Startup Pitch Deck");
    expect(state().design?.pages.map((p) => p.elements.length)).toEqual(deck.pages.map((p) => p.elements.length));
    expect(state().activePageId).toBe(firstId);
    await waitFor(() => expect(screen.getByRole("button", { name: "Apply all 7 pages" }).getAttribute("aria-busy")).toBeNull());
  });

  it("asks first when the page has content, explaining what will be added", async () => {
    const user = await openDeck(presentation(true));
    await user.click(screen.getByRole("button", { name: "Apply all 7 pages" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("The first template page replaces the content of this page, and 6 more pages are added after it. You can undo this with Ctrl+Z.")).toBeTruthy();
    await user.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(state().design?.pages).toHaveLength(1);
    expect(pageElements().map((e) => e.type)).toEqual(["shape"]);

    await user.click(screen.getByRole("button", { name: "Apply all 7 pages" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Apply all" }));
    await waitFor(() => expect(state().design?.pages).toHaveLength(7));
  });

  it("adds a single page as a new page without touching the current one", async () => {
    const user = await openDeck(presentation(true));
    await user.click(screen.getAllByRole("button", { name: "Add as new page" })[2]);
    expect(screen.queryByRole("dialog")).toBeNull();
    const pages = state().design!.pages;
    expect(pages).toHaveLength(2);
    expect(pages[0].elements.map((e) => e.type)).toEqual(["shape"]);
    expect(pages[1].elements).toHaveLength(template("Startup Pitch Deck").pages[2].elements.length);
  });

  it("uses a single page on the current page after a confirmation", async () => {
    const user = await openDeck(presentation(true));
    await user.click(screen.getByRole("button", { name: "Use page 2 on the current page" }));
    await user.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Replace" }));
    const wanted = template("Startup Pitch Deck").pages[1].elements.length;
    await waitFor(() => expect(pageElements()).toHaveLength(wanted));
    expect(state().design?.pages).toHaveLength(1);
  });

  it("uses a page on an empty page without asking", async () => {
    const user = await openDeck(presentation());
    await user.click(screen.getByRole("button", { name: "Use page 1 on the current page" }));
    await waitFor(() => expect(pageElements()).toHaveLength(template("Startup Pitch Deck").pages[0].elements.length));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
