import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import type { TextElement } from "@/core/types";
import { DRAG_MIME } from "@/editor/insert";
import { resetEditor } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements } from "@/test/tabsHarness";
import { useAppsNav } from "./appKit";
import { ALL_EMOJI, EMOJI_CATEGORIES } from "./emojiData";

const KEY = "craftly:recent-emoji";

beforeEach(() => {
  resetEditor();
  useAppsNav.setState({ app: "emoji", query: "" });
});

async function openEmoji() {
  const user = userEvent.setup();
  mountPanels({ tab: "apps" });
  await screen.findByRole("heading", { name: "Emoji" });
  return user;
}

const labelOf = (e: { name: string }) => e.name.split(" ").slice(0, 4).join(" ");
/** The emoji in the catalogue (the "Recently used" copy, when there is one, comes first in the page). */
const cell = (e: { name: string }) => screen.getAllByRole("button", { name: labelOf(e) }).at(-1)!;
const recents = () => JSON.parse(localStorage.getItem(KEY) ?? "[]") as string[];
const section = (title: string) => screen.getByRole("heading", { name: title }).closest("section") as HTMLElement;
const textOf = (el: unknown) => (el as TextElement).paragraphs[0].runs[0].text;

/** A few emoji from different places of the catalogue, with names that are unique inside their label. */
const SAMPLE = [EMOJI_CATEGORIES[0].items[0], EMOJI_CATEGORIES[1].items[2], EMOJI_CATEGORIES[2].items[3]];

describe("Emoji app", () => {
  it("shows every category as a section, with a chip for each", async () => {
    await openEmoji();
    expect(screen.getByText("Click one to add it as text")).toBeTruthy();
    const chips = within(screen.getByRole("group", { name: "Emoji categories" })).getAllByRole("button");
    expect(chips.map((c) => c.textContent)).toEqual(["All", ...EMOJI_CATEGORIES.map((c) => `${c.icon} ${c.label}`)]);
    expect(chips[0].getAttribute("aria-pressed")).toBe("true");
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(EMOJI_CATEGORIES.map((c) => c.label));
    expect(screen.queryByRole("heading", { name: "Recently used" })).toBeNull();
  });

  it("puts the emoji on the page as large text", async () => {
    const user = await openEmoji();
    const [wanted] = SAMPLE;
    const before = pageElements().length;
    await user.click(cell(wanted));
    const el = lastElement() as TextElement;
    expect(pageElements()).toHaveLength(before + 1);
    expect(textOf(el)).toBe(wanted.char);
    expect(el.fontSize).toBe(Math.round(720 * 0.16));
    expect(useEditor.getState().selection).toEqual([el.id]);
  });

  it("adds it from the keyboard", async () => {
    const user = await openEmoji();
    cell(SAMPLE[1]).focus();
    await user.keyboard("{Enter}");
    expect(textOf(lastElement())).toBe(SAMPLE[1].char);
  });

  it("hands an emoji to the canvas when dragged, without remembering it", async () => {
    await openEmoji();
    const before = pageElements().length;
    const dt = fakeDataTransfer();
    fireEvent.dragStart(cell(SAMPLE[0]), { dataTransfer: dt });
    const payload = JSON.parse(dt.data.get(DRAG_MIME) ?? "null");
    expect(textOf(payload.elements[0])).toBe(SAMPLE[0].char);
    expect(pageElements()).toHaveLength(before);
    expect(recents()).toEqual([]);
  });

  describe("recently used", () => {
    it("keeps the emoji that were used, the latest first, and shows them at the top", async () => {
      const user = await openEmoji();
      await user.click(cell(SAMPLE[0]));
      await user.click(cell(SAMPLE[1]));
      expect(recents()).toEqual([SAMPLE[1].char, SAMPLE[0].char]);
      const recent = within(section("Recently used")).getAllByRole("button");
      expect(recent).toHaveLength(2);
      expect(recent[0].textContent).toBe(SAMPLE[1].char);
      expect(screen.getAllByRole("heading", { level: 3 })[0].textContent).toBe("Recently used");
    });

    it("lists an emoji once, moving it to the front when it is used again", async () => {
      const user = await openEmoji();
      await user.click(cell(SAMPLE[0]));
      await user.click(cell(SAMPLE[1]));
      await user.click(within(section("Recently used")).getAllByRole("button")[1]);
      expect(recents()).toEqual([SAMPLE[0].char, SAMPLE[1].char]);
    });

    it("keeps no more than 14", async () => {
      localStorage.setItem(KEY, JSON.stringify(ALL_EMOJI.slice(100, 114).map((e) => e.char)));
      const user = await openEmoji();
      expect(within(section("Recently used")).getAllByRole("button")).toHaveLength(14);
      await user.click(cell(SAMPLE[2]));
      expect(recents()).toHaveLength(14);
      expect(recents()[0]).toBe(SAMPLE[2].char);
      expect(recents()).not.toContain(ALL_EMOJI[113].char);
    });

    it("starts with the ones remembered from before", async () => {
      localStorage.setItem(KEY, JSON.stringify([SAMPLE[2].char, SAMPLE[0].char]));
      await openEmoji();
      expect(
        within(section("Recently used"))
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual([SAMPLE[2].char, SAMPLE[0].char]);
    });

    it("calls a remembered emoji that is no longer in the catalogue just 'emoji'", async () => {
      localStorage.setItem(KEY, JSON.stringify(["🫥"]));
      await openEmoji();
      expect(within(section("Recently used")).getByRole("button", { name: "emoji" })).toBeTruthy();
    });

    it("ignores what it cannot read", async () => {
      localStorage.setItem(KEY, "this is not json");
      await openEmoji();
      expect(screen.queryByRole("heading", { name: "Recently used" })).toBeNull();
    });

    it("ignores a list that is not a list, and entries that are not text", async () => {
      localStorage.setItem(KEY, JSON.stringify({ not: "a list" }));
      await openEmoji();
      expect(screen.queryByRole("heading", { name: "Recently used" })).toBeNull();
    });

    it("keeps only the text entries of a mixed list", async () => {
      localStorage.setItem(KEY, JSON.stringify([5, null, SAMPLE[0].char, { x: 1 }]));
      await openEmoji();
      expect(
        within(section("Recently used"))
          .getAllByRole("button")
          .map((b) => b.textContent),
      ).toEqual([SAMPLE[0].char]);
    });

    it("still adds the emoji when the browser will not remember it", async () => {
      const user = await openEmoji();
      vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
        throw new Error("storage is off");
      });
      const before = pageElements().length;
      await user.click(cell(SAMPLE[0]));
      expect(pageElements()).toHaveLength(before + 1);
    });
  });

  describe("categories", () => {
    it("narrows to one category with its chip, and hides the recently used list", async () => {
      localStorage.setItem(KEY, JSON.stringify([SAMPLE[0].char]));
      const user = await openEmoji();
      const animals = EMOJI_CATEGORIES[1];
      await user.click(screen.getByRole("button", { name: `${animals.icon} ${animals.label}` }));
      expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual([animals.label]);
      expect(screen.queryByRole("heading", { name: "Recently used" })).toBeNull();
      expect(within(section(animals.label)).getAllByRole("button")).toHaveLength(animals.items.length);
      await user.click(screen.getByRole("button", { name: "All" }));
      expect(screen.getAllByRole("heading", { level: 3 })).toHaveLength(EMOJI_CATEGORIES.length + 1);
    });
  });

  describe("searching", () => {
    it("finds emoji whose names contain every word, and counts them", async () => {
      const user = await openEmoji();
      await user.type(screen.getByRole("searchbox", { name: "Search emoji" }), "face tears");
      const found = ALL_EMOJI.filter((e) => ["face", "tears"].every((w) => e.name.toLowerCase().includes(w)));
      expect(found.length).toBeGreaterThan(0);
      await waitFor(() => expect(screen.getByRole("heading", { name: `${found.length} result${found.length === 1 ? "" : "s"}` })).toBeTruthy());
      expect(screen.queryByRole("group", { name: "Emoji categories" })).toBeNull();
      expect(screen.queryByRole("heading", { name: "Smileys" })).toBeNull();
    });

    it("says '1 result' for a single match", async () => {
      const user = await openEmoji();
      const unique = ALL_EMOJI.find((e) => ALL_EMOJI.filter((o) => o.name.toLowerCase().includes(e.name.toLowerCase())).length === 1)!;
      await user.type(screen.getByRole("searchbox", { name: "Search emoji" }), unique.name);
      expect(await screen.findByRole("heading", { name: "1 result" })).toBeTruthy();
    });

    it("adds a found emoji like any other", async () => {
      const user = await openEmoji();
      await user.type(screen.getByRole("searchbox", { name: "Search emoji" }), "heart");
      // The search waits a moment after the last key. On a busy machine the keys come slower than that, so the list is first
      // shown for "h" and built again for each longer word: a click on a cell of one of those lists can land on a cell that is
      // gone by the time it arrives, and nothing is added. So the wait is for the list of the whole word, not for any list.
      const found = ALL_EMOJI.filter((e) => e.name.toLowerCase().includes("heart"));
      await waitFor(() => expect(screen.getByRole("heading", { name: `${found.length} results` })).toBeTruthy());
      const before = pageElements().length;
      await user.click(within(screen.getByRole("heading", { level: 3 }).closest("section") as HTMLElement).getAllByRole("button")[0]);
      expect(pageElements()).toHaveLength(before + 1);
    });

    it("says when nothing matches", async () => {
      const user = await openEmoji();
      await user.type(screen.getByRole("searchbox", { name: "Search emoji" }), "zzzz");
      expect(await screen.findByText("No emoji found")).toBeTruthy();
      expect(screen.getByText('Nothing matches "zzzz". Try "heart", "cat" or "party".')).toBeTruthy();
    });

    it("goes back to the categories when the search is cleared", async () => {
      const user = await openEmoji();
      await user.type(screen.getByRole("searchbox", { name: "Search emoji" }), "cat");
      await user.click(await screen.findByRole("button", { name: "Clear search" }));
      expect(await screen.findByRole("group", { name: "Emoji categories" })).toBeTruthy();
    });
  });
});
