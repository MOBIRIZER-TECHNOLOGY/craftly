import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { solid } from "@/core/factory";
import { getActivePage, useEditor } from "@/core/store";
import { BACKGROUND_GROUPS } from "@/data/backgrounds";
import { DRAG_MIME } from "@/editor/insert";
import { resetEditor, stubLayout } from "@/test/helpers";
import { fakeDataTransfer, mountPanels, resetElementsNav } from "@/test/tabsHarness";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout(340, 700);
});
afterEach(() => restoreLayout());

async function openPage(query = "") {
  resetElementsNav("backgrounds", query);
  const user = userEvent.setup();
  mountPanels({ tab: "elements" });
  await screen.findByRole("searchbox", { name: "Search backgrounds" });
  return user;
}

const background = () => getActivePage(useEditor.getState())!.background;
const preset = (group: string, name: string) => BACKGROUND_GROUPS.find((g) => g.id === group)!.presets.find((p) => p.name === name)!;
const GROUP_LABEL: Record<string, string> = { solid: "Solid colours", gradient: "Gradients", pattern: "Patterns", photo: "Photos & textures" };
/** A preset button; several groups reuse a name ("Midnight" is a colour and a gradient), so the group can be named. */
const cell = (name: string, group?: keyof typeof GROUP_LABEL) =>
  within(group ? (screen.getByRole("heading", { name: GROUP_LABEL[group] }).closest("section") as HTMLElement) : document.body).getByRole("button", { name });

describe("Elements > Backgrounds", () => {
  it("groups the backgrounds under four headings", async () => {
    await openPage();
    expect(screen.getByText("Click one to colour the page")).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Solid colours", "Gradients", "Patterns", "Photos & textures"]);
    for (const group of BACKGROUND_GROUPS) {
      const section = screen.getByRole("heading", { name: group.label }).closest("section") as HTMLElement;
      // the photo cells draw themselves once they come near the viewport
      await waitFor(() => expect(within(section).getAllByRole("button")).toHaveLength(group.presets.length));
    }
  });

  it("marks the background the page has now", async () => {
    await openPage("white");
    expect(cell("White").getAttribute("aria-pressed")).toBe("true");
    expect(background()).toEqual(solid("#ffffff"));
  });

  it("colours the page with the clicked solid colour and moves the mark", async () => {
    const user = await openPage("");
    await user.click(cell("Navy"));
    expect(background()).toEqual(preset("solid", "Navy").fill);
    expect(cell("Navy").getAttribute("aria-pressed")).toBe("true");
    expect(cell("White").getAttribute("aria-pressed")).toBe("false");
  });

  it("applies a gradient, a pattern and a photo fill", async () => {
    const user = await openPage("");
    await user.click(cell("Peach sorbet"));
    expect(background()).toEqual(preset("gradient", "Peach sorbet").fill);
    expect(background().type).toBe("linear");

    await user.click(cell("Polka cream"));
    expect(background().type).toBe("pattern");
    expect(background()).toEqual(preset("pattern", "Polka cream").fill);

    await user.click(await screen.findByRole("button", { name: "Mesh sunrise" }));
    const fill = background();
    expect(fill.type).toBe("image");
    expect(fill.type === "image" && fill.src.startsWith("builtin:")).toBe(true);
  });

  it("can be undone", async () => {
    const user = await openPage("");
    await user.click(cell("Midnight", "solid"));
    expect(background()).toEqual(preset("solid", "Midnight").fill);
    useEditor.getState().actions.undo();
    expect(background()).toEqual(solid("#ffffff"));
  });

  it("works from the keyboard", async () => {
    const user = await openPage("");
    cell("Sage").focus();
    await user.keyboard("{Enter}");
    expect(background()).toEqual(preset("solid", "Sage").fill);
  });

  it("hands the fill to the canvas when dragged, without changing the page", async () => {
    await openPage("");
    const dt = fakeDataTransfer();
    fireEvent.dragStart(cell("Mint breeze"), { dataTransfer: dt });
    expect(JSON.parse(dt.data.get(DRAG_MIME) ?? "null")).toEqual({ type: "background", fill: preset("gradient", "Mint breeze").fill });
    expect(background()).toEqual(solid("#ffffff"));
  });

  it("shows each fill: a colour, a gradient, a drawn pattern and a picture", async () => {
    await openPage("");
    expect((cell("Navy").querySelector(".cf-bgcell__fill") as HTMLElement).style.background).toBe("rgb(20, 33, 61)");
    expect((cell("Peach sorbet").querySelector(".cf-bgcell__fill") as HTMLElement).style.background).toContain("linear-gradient");
    await waitFor(() => expect(cell("Polka cream").querySelector("canvas")).toBeTruthy());
    await waitFor(() => expect(cell("Mesh sunrise").querySelector("img.cf-cell__img")).toBeTruthy());
  });

  it("finds backgrounds by name or by the name of their group", async () => {
    const user = await openPage("");
    await user.type(screen.getByRole("searchbox"), "sunrise");
    await waitFor(() => expect(screen.queryByRole("button", { name: "Navy" })).toBeNull());
    expect(await screen.findByRole("button", { name: "Mesh sunrise" })).toBeTruthy();
    // a gradient has "sunrise" in its name too; groups with no match are left out
    expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Gradients", "Photos & textures"]);

    await user.clear(screen.getByRole("searchbox"));
    await user.type(screen.getByRole("searchbox"), "gradients");
    await waitFor(() => expect(screen.getAllByRole("heading", { level: 3 }).map((h) => h.textContent)).toEqual(["Gradients"]));
    expect(within(screen.getByRole("heading", { name: "Gradients" }).closest("section") as HTMLElement).getAllByRole("button")).toHaveLength(35);
  });

  it("says when nothing matches", async () => {
    const user = await openPage("");
    await user.type(screen.getByRole("searchbox"), "zzzz");
    await waitFor(() => expect(screen.getByText("No backgrounds found")).toBeTruthy());
    expect(screen.getByText('Nothing matches "zzzz". Try "sunset", "dots" or "blue".')).toBeTruthy();
  });
});
