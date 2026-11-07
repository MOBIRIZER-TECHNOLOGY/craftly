import { act, render, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getDesign, listDesigns } from "@/core/library";
import { searchTemplates } from "@/data/templates";
import { Hosts, dismissOpenDialogs, emptyLibrary, resetDashboardStores, seedDesign } from "@/test/dashuiUtils";
import { toast } from "@/ui";
import { closeCreateDialog, useCreateDialog } from "./createDialogState";
import { designsStore } from "./data";
import { HomeSearch } from "./HomeSearch";
import { closeTemplatePreview, takePresetTemplateSearch, usePreviewTemplate } from "./templatePreview";

const box = () => screen.getByRole("combobox");
const panel = () => screen.getByRole("listbox", { name: "Search results" });
const queryPanel = () => screen.queryByRole("listbox", { name: "Search results" });
const options = () => within(panel()).getAllByRole("option");
const optionNames = () => options().map((el) => el.querySelector(".cf-hsearch__name")?.textContent);
const highlighted = () => options().findIndex((el) => el.getAttribute("aria-selected") === "true");

/** Save a design and wait until the dashboard has read it, so a search typed straight away can find it. */
async function seed(over: Parameters<typeof seedDesign>[0]) {
  const design = await seedDesign(over);
  await waitFor(() => expect(designsStore.getSnapshot().value.some((item) => item.id === design.id)).toBe(true));
  return design;
}

async function search(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(box());
  await user.type(box(), text);
}

beforeEach(async () => {
  await emptyLibrary();
  await resetDashboardStores();
  render(
    <>
      <HomeSearch />
      <button>Elsewhere</button>
      <Hosts />
    </>,
  );
});

afterEach(async () => {
  await dismissOpenDialogs();
  act(() => {
    closeCreateDialog();
    closeTemplatePreview();
    toast.clear();
  });
  takePresetTemplateSearch();
  await waitFor(() => expect(document.querySelector(".cf-toast")).toBeNull());
  await emptyLibrary();
});

describe("<HomeSearch>", () => {
  it("is a search box with a hint of what it finds, and no results panel until something is typed", async () => {
    const user = userEvent.setup();
    expect(box().getAttribute("placeholder")).toBe("Search designs and templates");
    expect(box().getAttribute("aria-label")).toBe("Search designs and templates");
    await user.click(box());
    expect(queryPanel()).toBeNull();
    expect(box().getAttribute("aria-expanded")).toBe("false");
  });

  it("behaves as a combobox that points at the highlighted result", async () => {
    const user = userEvent.setup();
    await search(user, "poster");
    expect(box().getAttribute("role")).toBe("combobox");
    expect(box().getAttribute("aria-autocomplete")).toBe("list");
    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(box().getAttribute("aria-controls")).toBe(panel().id);
    expect(box().getAttribute("aria-activedescendant")).toBe(options()[0].id);
  });

  describe("your designs", () => {
    it("finds designs by title or by type and opens one when it is chosen", async () => {
      const user = userEvent.setup();
      const design = await seed({ title: "Birthday invite", typeId: "invitation" });
      await seed({ title: "Quarterly report", typeId: "doc-a4" });
      await search(user, "birthday");
      const group = within(panel()).getByRole("group", { name: "Your designs" });
      expect(within(group).getAllByRole("option")).toHaveLength(1);
      expect(group.textContent).toContain("Birthday invite");
      expect(group.textContent).toMatch(/Invitation · Edited just now/);
      await user.click(within(group).getByRole("option"));
      expect(window.location.hash).toBe(`#/design/${design.id}`);
      expect((box() as HTMLInputElement).value).toBe("");
      expect(queryPanel()).toBeNull();
    });

    it("matches the type name too", async () => {
      const user = userEvent.setup();
      await seed({ title: "Untitled", typeId: "business-card" });
      await search(user, "business");
      expect(within(panel()).getByRole("group", { name: "Your designs" }).textContent).toContain("Untitled");
    });

    it("shows at most four, and a picture when the design has one", async () => {
      const user = userEvent.setup();
      for (let i = 1; i <= 6; i += 1) await seed({ title: `Moodboard ${i}`, thumbnail: i === 1 ? "data:image/jpeg;base64,AAAA" : undefined });
      await search(user, "moodboard");
      const group = within(panel()).getByRole("group", { name: "Your designs" });
      expect(within(group).getAllByRole("option")).toHaveLength(4);
      expect(group.querySelectorAll("img").length).toBeLessThanOrEqual(1);
    });

    it("leaves out trashed designs", async () => {
      const user = userEvent.setup();
      await seed({ title: "Thrown away", trashedAt: Date.now() });
      await search(user, "thrown");
      expect(within(panel()).queryByRole("group", { name: "Your designs" })).toBeNull();
    });
  });

  describe("templates", () => {
    it("lists matching templates and opens the preview of the one chosen", async () => {
      const user = userEvent.setup();
      const preview = renderHook(() => usePreviewTemplate());
      await search(user, "birthday");
      const matches = searchTemplates("birthday");
      expect(matches.length).toBeGreaterThan(0);
      const group = within(panel()).getByRole("group", { name: "Templates" });
      const templates = within(group).getAllByRole("option");
      const first = matches[0];
      expect(templates[0].textContent).toContain(first.name);
      await user.click(templates[0]);
      expect(preview.result.current?.id).toBe(first.id);
      expect((box() as HTMLInputElement).value).toBe("");
    });

    it("shows five and a way to see all of them on the Templates page, carrying the search over", async () => {
      const user = userEvent.setup();
      const query = "social";
      const matches = searchTemplates(query);
      expect(matches.length).toBeGreaterThan(5);
      await search(user, query);
      const group = within(panel()).getByRole("group", { name: "Templates" });
      expect(within(group).getAllByRole("option")).toHaveLength(6);
      const all = within(group).getByRole("option", { name: new RegExp(`See all ${matches.length} templates`) });
      await user.click(all);
      expect(window.location.hash).toBe("#/templates");
      expect(takePresetTemplateSearch()).toBe(query);
    });
  });

  describe("design types", () => {
    it("offers blank designs of the matching types and creates the one chosen", async () => {
      const user = userEvent.setup();
      await search(user, "business card");
      const group = within(panel()).getByRole("group", { name: "Design types" });
      const option = within(group).getByRole("option", { name: /Business Card/ });
      expect(option.textContent).toContain("Create blank · 3.5 × 2 in");
      await user.click(option);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved.typeId).toBe("business-card");
      expect(window.location.hash).toBe(`#/design/${saved.id}`);
    });

    it("shows at most five types", async () => {
      const user = userEvent.setup();
      await search(user, "a");
      expect(within(panel()).getByRole("group", { name: "Design types" }).querySelectorAll("[role=option]")).toHaveLength(5);
    });

    it("offers a custom size for a size typed as width x height", async () => {
      const user = userEvent.setup();
      await search(user, "1200x628");
      const group = within(panel()).getByRole("group", { name: "Design types" });
      const first = within(group).getAllByRole("option")[0];
      expect(first.textContent).toContain("Custom size");
      expect(first.textContent).toContain("Create blank · 1200 × 628 px");
      await user.click(first);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved).toMatchObject({ typeId: "custom", width: 1200, height: 628 });
    });

    it("keeps a typed size inside 40 to 8000 pixels", async () => {
      const user = userEvent.setup();
      await search(user, "99999x20");
      await user.click(within(panel()).getAllByRole("option")[0]);
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      const [saved] = await listDesigns();
      expect(saved).toMatchObject({ width: 8000, height: 40 });
      expect((await getDesign(saved.id))?.unit).toBe("px");
    });
  });

  describe("nothing found", () => {
    it("says so and offers the design types instead", async () => {
      const user = userEvent.setup();
      const dialog = renderHook(() => useCreateDialog());
      await search(user, "zzzqqq");
      expect(within(panel()).getByText("Nothing found for “zzzqqq”")).toBeTruthy();
      expect(within(panel()).queryAllByRole("option")).toHaveLength(0);
      await user.click(within(panel()).getByRole("button", { name: "Browse design types" }));
      expect(dialog.result.current.open).toBe(true);
      expect(dialog.result.current.query).toBe("zzzqqq");
      expect(queryPanel()).toBeNull();
    });
  });

  describe("keyboard", () => {
    it("moves the highlight with the arrow keys, wrapping around, and the mouse moves it too", async () => {
      const user = userEvent.setup();
      await search(user, "poster");
      const count = options().length;
      expect(count).toBeGreaterThan(1);
      expect(highlighted()).toBe(0);
      await user.keyboard("{ArrowDown}");
      expect(highlighted()).toBe(1);
      await user.keyboard("{ArrowUp}{ArrowUp}");
      expect(highlighted()).toBe(count - 1);
      await user.keyboard("{ArrowDown}");
      expect(highlighted()).toBe(0);
      await user.hover(options()[2]);
      expect(highlighted()).toBe(2);
      expect(box().getAttribute("aria-activedescendant")).toBe(options()[2].id);
    });

    it("chooses the highlighted result with Enter, the first one if the arrows were not used", async () => {
      const user = userEvent.setup();
      const design = await seed({ title: "Xylophone lessons", typeId: "flyer" });
      await search(user, "xylophone");
      expect(optionNames()).toEqual(["Xylophone lessons"]);
      await user.keyboard("{Enter}");
      expect(window.location.hash).toBe(`#/design/${design.id}`);
    });

    it("creates the design type that is highlighted when Enter is pressed", async () => {
      const user = userEvent.setup();
      await search(user, "1200x628");
      await user.keyboard("{Enter}");
      await waitFor(async () => expect(await listDesigns()).toHaveLength(1));
      expect((await listDesigns())[0]).toMatchObject({ typeId: "custom", width: 1200, height: 628 });
    });

    it("chooses the result the arrows moved to", async () => {
      const user = userEvent.setup();
      const first = await seed({ title: "Poster one", typeId: "poster", updatedAt: 2000 });
      const second = await seed({ title: "Poster two", typeId: "poster", updatedAt: 1000 });
      await search(user, "poster");
      expect(optionNames().slice(0, 2)).toEqual(["Poster one", "Poster two"]);
      await user.keyboard("{ArrowDown}{Enter}");
      expect(window.location.hash).toBe(`#/design/${second.id}`);
      expect(first.id).not.toBe(second.id);
    });

    it("does nothing on Enter or the arrows when there is nothing to choose", async () => {
      const user = userEvent.setup();
      await search(user, "zzzqqq");
      await user.keyboard("{ArrowDown}{Enter}");
      expect(window.location.hash).toBe("");
      expect(await listDesigns()).toEqual([]);
    });

    it("clears the text with Escape, which closes the panel", async () => {
      const user = userEvent.setup();
      await search(user, "poster");
      await user.keyboard("{Escape}");
      expect((box() as HTMLInputElement).value).toBe("");
      expect(queryPanel()).toBeNull();
    });
  });

  describe("closing", () => {
    it("closes when the user presses outside, and opens again when the field is used again", async () => {
      const user = userEvent.setup();
      await search(user, "poster");
      await user.click(screen.getByRole("button", { name: "Elsewhere" }));
      expect(queryPanel()).toBeNull();
      await user.click(box());
      expect(panel()).toBeTruthy();
    });

    it("closes when focus moves out of the search", async () => {
      const user = userEvent.setup();
      await search(user, "poster");
      await user.tab();
      await user.tab();
      expect(queryPanel()).toBeNull();
    });

    it("stays open while focus moves between the field and its own buttons", async () => {
      const user = userEvent.setup();
      await search(user, "zzzqqq");
      await user.tab();
      expect(within(panel()).getByRole("button", { name: "Browse design types" })).toBeTruthy();
    });

    it("keeps the panel from stealing focus when it is pressed", async () => {
      const user = userEvent.setup();
      await search(user, "poster");
      await user.pointer({ keys: "[MouseLeft>]", target: panel() });
      expect(document.activeElement).toBe(box());
    });
  });
});

describe("<HomeSearch> with another placeholder", () => {
  it("shows the placeholder it is given", () => {
    render(<HomeSearch placeholder="Find something" />);
    expect(screen.getByRole("combobox", { name: "Find something" })).toBeTruthy();
  });
});
