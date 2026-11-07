import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { IconDef } from "@/data/icons";
import { resetEditor, stubLayout } from "@/test/helpers";
import { fakeDataTransfer, lastElement, mountPanels, pageElements, resetElementsNav } from "@/test/tabsHarness";
import { useElementsNav } from "./nav";
import type { GraphicElement } from "@/core/types";

/*
 * The icon library is a separate chunk (lucide) that arrives after the panel is shown, and it can fail to arrive.
 * Here its loader is replaced by one the test controls, with a three icon library, to see both of those states.
 */
const library = vi.hoisted(() => {
  const state = {
    gate: null as null | { resolve: (v: unknown[]) => void; reject: (e: Error) => void },
  };
  return state;
});

const ICONS: IconDef[] = [
  { id: "heart", name: "Heart", tags: ["love"] },
  { id: "star", name: "Star", tags: ["favourite"] },
  { id: "zap", name: "Zap", tags: ["bolt"] },
];

vi.mock("@/data/icons", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/data/icons")>();
  return {
    ...real,
    loadIconIndex: vi.fn(
      () =>
        new Promise<IconDef[]>((resolve, reject) => {
          library.gate = { resolve: resolve as (v: unknown[]) => void, reject };
        }),
    ),
    getIconSvg: vi.fn(async (id: string) =>
      id === "ghost" ? null : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z" stroke="currentColor" data-icon="${id}"/></svg>`,
    ),
  };
});

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  library.gate = null;
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

async function openIcons() {
  resetElementsNav("graphics");
  useElementsNav.setState({ graphicsPane: "icons" });
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: "Search icons" });
  await waitFor(() => expect(library.gate).not.toBeNull());
  return user;
}

describe("the icon library while it loads", () => {
  it("shows placeholders until the library arrives, then the icons", async () => {
    await openIcons();
    expect(document.querySelectorAll(".cf-itemgrid .cf-skeleton").length).toBeGreaterThanOrEqual(24);
    expect(screen.queryByText(/icons/)).toBeNull();

    await act(async () => library.gate?.resolve(ICONS));
    expect(await screen.findByText("3 icons - popular ones first")).toBeTruthy();
    expect(document.querySelectorAll(".cf-itemgrid .cf-skeleton")).toHaveLength(0);
    expect(Array.from(document.querySelectorAll(".cf-cell--icon")).map((c) => c.getAttribute("aria-label"))).toEqual(["Heart", "Star", "Zap"]);
  });

  it("puts the curated popular icons ahead of the alphabetical rest", async () => {
    await openIcons();
    await act(async () =>
      library.gate?.resolve([{ id: "aardvark", name: "Aardvark", tags: [] }, { id: "zebra-crossing", name: "Zebra crossing", tags: [] }, ...ICONS.slice(0, 2)]),
    );
    await screen.findByText("4 icons - popular ones first");
    // "heart" and "star" have curated synonyms; the other two come after them in their own order
    expect(Array.from(document.querySelectorAll(".cf-cell--icon")).map((c) => c.getAttribute("aria-label"))).toEqual(["Heart", "Star", "Aardvark", "Zebra crossing"]);
  });

  it("says the icons could not load when the library cannot be fetched", async () => {
    await openIcons();
    await act(async () => library.gate?.reject(new Error("offline")));
    expect(await screen.findByText("Icons could not load")).toBeTruthy();
    expect(screen.getByText("Check your connection and reopen this panel.")).toBeTruthy();
    expect(document.querySelectorAll(".cf-cell--icon")).toHaveLength(0);
  });

  it("cancels a drag of an icon whose drawing has not arrived yet", async () => {
    await openIcons();
    await act(async () => library.gate?.resolve([{ id: "ghost", name: "Ghost", tags: [] }]));
    const cell = await screen.findByRole("button", { name: "Ghost" });
    const dt = fakeDataTransfer();
    const proceeded = fireEvent.dragStart(cell, { dataTransfer: dt });
    expect(proceeded).toBe(false);
    expect(dt.data.size).toBe(0);
  });

  it("adds nothing when an icon has no drawing", async () => {
    const user = await openIcons();
    await act(async () => library.gate?.resolve([{ id: "ghost", name: "Ghost", tags: [] }, ...ICONS]));
    const before = pageElements().length;
    await user.click(await screen.findByRole("button", { name: "Ghost" }));
    await act(async () => void (await Promise.resolve()));
    expect(pageElements()).toHaveLength(before);
    // while a real icon still goes onto the page
    await user.click(within(screen.getByRole("group", { name: "Icons" })).getByRole("button", { name: "Star" }));
    await waitFor(() => expect(pageElements()).toHaveLength(before + 1));
    expect((lastElement() as GraphicElement).source).toEqual({ kind: "icon", id: "star" });
  });
});
