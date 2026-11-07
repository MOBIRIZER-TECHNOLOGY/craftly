import { act, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { paragraphsToText } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { TextElement } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { lastElement, mountPanels, pageElements } from "@/test/tabsHarness";
import { useAppsNav } from "./appKit";
import { generateLorem } from "./lorem";

beforeEach(() => {
  resetEditor();
  useAppsNav.setState({ app: "lorem", query: "" });
});

async function openLorem() {
  const user = userEvent.setup();
  mountPanels({ tab: "apps" });
  await screen.findByRole("heading", { name: "Lorem ipsum" });
  return user;
}

const preview = () => screen.getByRole("region", { name: "Preview of the text" });
const previewText = () =>
  Array.from(preview().querySelectorAll("p"))
    .map((p) => p.textContent)
    .join("\n\n");
const unit = (name: string) => screen.getByRole("radio", { name });
const count = () => screen.getByRole("spinbutton") as HTMLInputElement;
const wordCount = () => Number(/^(\d+) words$/.exec(document.querySelector(".cf-lorem__preview-field .cf-app__hint")?.textContent ?? "")?.[1]);

async function setCount(user: ReturnType<typeof userEvent.setup>, value: string) {
  await user.clear(count());
  await user.type(count(), `${value}{Enter}`);
}

describe("Lorem ipsum app", () => {
  it("starts with two paragraphs that begin with the classic line", async () => {
    await openLorem();
    expect(screen.getByText("Placeholder text for your layouts")).toBeTruthy();
    expect(unit("Paragraphs").getAttribute("aria-checked")).toBe("true");
    expect(count().value).toBe("2");
    expect(preview().querySelectorAll("p")).toHaveLength(2);
    expect(previewText()).toBe(generateLorem("paragraphs", 2, 7, true));
    expect(previewText().startsWith("Lorem ipsum dolor sit amet, consectetur adipiscing elit.")).toBe(true);
    expect(wordCount()).toBe(previewText().split(/\s+/).length);
  });

  it("gives each unit its own usual amount", async () => {
    const user = await openLorem();
    await user.click(unit("Sentences"));
    expect(count().value).toBe("3");
    expect(previewText()).toBe(generateLorem("sentences", 3, 7, true));
    await user.click(unit("Words"));
    expect(count().value).toBe("30");
    expect(wordCount()).toBe(30);
    await user.click(unit("Paragraphs"));
    expect(count().value).toBe("2");
  });

  it("names the amount after the unit", async () => {
    const user = await openLorem();
    expect(screen.getByRole("spinbutton", { name: "Number of paragraphs" })).toBeTruthy();
    await user.click(unit("Words"));
    expect(screen.getByRole("spinbutton", { name: "Number of words" })).toBeTruthy();
  });

  it("changes the amount by typing or with the + and - buttons", async () => {
    const user = await openLorem();
    await setCount(user, "5");
    expect(preview().querySelectorAll("p")).toHaveLength(5);
    await user.click(screen.getByRole("button", { name: "Decrease Number of paragraphs" }));
    expect(preview().querySelectorAll("p")).toHaveLength(4);
    await user.click(screen.getByRole("button", { name: "Increase Number of paragraphs" }));
    await user.click(screen.getByRole("button", { name: "Increase Number of paragraphs" }));
    expect(preview().querySelectorAll("p")).toHaveLength(6);
  });

  it("never goes beyond the most that makes sense for the unit, or below one", async () => {
    const user = await openLorem();
    await setCount(user, "99");
    expect(count().value).toBe("10");
    expect(preview().querySelectorAll("p")).toHaveLength(10);
    expect(screen.getByRole("button", { name: "Increase Number of paragraphs" }).hasAttribute("disabled")).toBe(true);
    await setCount(user, "0");
    expect(count().value).toBe("1");
    expect(screen.getByRole("button", { name: "Decrease Number of paragraphs" }).hasAttribute("disabled")).toBe(true);
    await user.click(unit("Words"));
    await setCount(user, "9999");
    expect(count().value).toBe("400");
    expect(wordCount()).toBe(400);
  });

  it("writes different text each time it is shuffled, and the same text for the same shuffle", async () => {
    const user = await openLorem();
    const first = previewText();
    await user.click(screen.getByRole("button", { name: "Shuffle" }));
    const second = previewText();
    expect(second).not.toBe(first);
    expect(second).toBe(generateLorem("paragraphs", 2, 8, true));
    await user.click(screen.getByRole("button", { name: "Shuffle" }));
    expect(previewText()).toBe(generateLorem("paragraphs", 2, 9, true));
  });

  it("can start with any words instead of the classic line", async () => {
    const user = await openLorem();
    const toggle = screen.getByRole("switch", { name: 'Start with "Lorem ipsum dolor sit amet"' });
    expect(toggle).toHaveProperty("checked", true);
    await user.click(toggle);
    expect(toggle).toHaveProperty("checked", false);
    expect(previewText()).toBe(generateLorem("paragraphs", 2, 7, false));
    expect(previewText().startsWith("Lorem ipsum dolor sit amet, consectetur")).toBe(false);
  });

  it("writes plain words too, with or without the classic start", async () => {
    const user = await openLorem();
    await user.click(unit("Words"));
    expect(previewText()).toBe(generateLorem("words", 30, 7, true));
    expect(previewText().startsWith("Lorem ipsum dolor sit amet consectetur adipiscing elit")).toBe(true);
    await user.click(screen.getByRole("switch", { name: 'Start with "Lorem ipsum dolor sit amet"' }));
    expect(previewText()).toBe(generateLorem("words", 30, 7, false));
    expect(wordCount()).toBe(30);
  });

  describe("adding it to the design", () => {
    it("puts the text on the page in a box that is 60% of the page wide", async () => {
      const user = await openLorem();
      const before = pageElements().length;
      const text = previewText();
      await user.click(screen.getByRole("button", { name: "Add to design" }));
      const el = lastElement() as TextElement;
      expect(pageElements()).toHaveLength(before + 1);
      expect(el.type).toBe("text");
      expect(paragraphsToText(el.paragraphs)).toBe(text);
      expect(el.width).toBe(Math.round(1280 * 0.6));
      expect(el.autoWidth).toBe(false);
      expect(el.fontSize).toBe(Math.round(720 * 0.028));
      expect(el.lineHeight).toBe(1.5);
      expect(useEditor.getState().selection).toEqual([el.id]);
    });

    it("adds exactly what the preview shows for the chosen amount", async () => {
      const user = await openLorem();
      await user.click(unit("Words"));
      await setCount(user, "12");
      await user.click(screen.getByRole("button", { name: "Add to design" }));
      const text = paragraphsToText((lastElement() as TextElement).paragraphs);
      expect(text.replace(/\.$/, "").split(" ")).toHaveLength(12);
      expect(text).toBe(generateLorem("words", 12, 7, true));
    });

    it("has nowhere to put the text once the design is closed", async () => {
      const user = await openLorem();
      act(() => useEditor.getState().actions.closeDesign());
      await user.click(screen.getByRole("button", { name: "Add to design" }));
      expect(useEditor.getState().design).toBeNull();
      expect(useEditor.getState().selection).toEqual([]);
    });
  });
});
