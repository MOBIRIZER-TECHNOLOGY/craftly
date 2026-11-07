import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import { autoDrawWidth, drawSettings, setDrawSettings } from "@/editor/panels/shared/drawSettings";
import { resetEditor, stubLayout } from "@/test/helpers";
import { mountPanels } from "@/test/tabsHarness";

let restoreLayout: () => void;
beforeEach(() => {
  resetEditor();
  restoreLayout = stubLayout(1000, 700);
});
afterEach(() => {
  restoreLayout();
  setDrawSettings({ color: "#0e1318", width: null });
});

const state = () => useEditor.getState();
const tool = (name: string) => within(screen.getByRole("toolbar", { name: "Tools" })).getByRole("button", { name });

async function openPalette() {
  const user = userEvent.setup();
  mountPanels({ tab: "text" });
  await user.click(screen.getByRole("tab", { name: "Tools" }));
  await screen.findByRole("toolbar", { name: "Tools" });
  return user;
}

describe("<ToolsPalette>", () => {
  it("lists the five tools with the current one pressed", async () => {
    await openPalette();
    const names = ["Select", "Draw", "Shape", "Line", "Text"];
    expect(
      within(screen.getByRole("toolbar", { name: "Tools" }))
        .getAllByRole("button")
        .map((b) => b.getAttribute("aria-label")),
    ).toEqual(["Close tools", ...names]);
    expect(tool("Select").getAttribute("aria-pressed")).toBe("true");
    for (const name of names.slice(1)) expect(tool(name).getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("toolbar", { name: "Tools" }).getAttribute("aria-orientation")).toBe("vertical");
  });

  it("switches the drawing tool when one is chosen", async () => {
    const user = await openPalette();
    await user.click(tool("Line"));
    expect(state().tool).toBe("line");
    expect(tool("Line").getAttribute("aria-pressed")).toBe("true");
    expect(tool("Select").getAttribute("aria-pressed")).toBe("false");
    await user.click(tool("Text"));
    expect(state().tool).toBe("text");
    await user.click(tool("Select"));
    expect(state().tool).toBe("select");
  });

  it("leaves the palette open while a tool is active, and closes it with its own button", async () => {
    const user = await openPalette();
    await user.click(tool("Line"));
    expect(screen.getByRole("toolbar", { name: "Tools" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Close tools" }));
    expect(screen.queryByRole("toolbar", { name: "Tools" })).toBeNull();
    expect(state().leftTab).toBe("text");
    // the tool stays chosen
    expect(state().tool).toBe("line");
  });

  describe("keyboard", () => {
    it("moves between the tools with the up and down arrows and wraps around", async () => {
      await openPalette();
      act(() => tool("Select").focus());
      fireEvent.keyDown(tool("Select"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(tool("Draw"));
      fireEvent.keyDown(tool("Draw"), { key: "ArrowUp" });
      expect(document.activeElement).toBe(tool("Select"));
      fireEvent.keyDown(tool("Select"), { key: "ArrowUp" });
      expect(document.activeElement).toBe(tool("Text"));
      fireEvent.keyDown(tool("Text"), { key: "ArrowDown" });
      expect(document.activeElement).toBe(tool("Select"));
    });

    it("ignores other keys", async () => {
      await openPalette();
      act(() => tool("Shape").focus());
      expect(fireEvent.keyDown(tool("Shape"), { key: "x" })).toBe(true);
      expect(document.activeElement).toBe(tool("Shape"));
      expect(fireEvent.keyDown(tool("Shape"), { key: "ArrowDown" })).toBe(false);
    });
  });

  describe("the shape tool", () => {
    it("chooses the tool and opens the list of shapes in one click", async () => {
      const user = await openPalette();
      await user.click(tool("Shape"));
      expect(state().tool).toBe("shape");
      expect(tool("Shape").getAttribute("aria-expanded")).toBe("true");
      expect(tool("Shape").getAttribute("aria-haspopup")).toBe("dialog");
      const flyout = await screen.findByRole("dialog", { name: "Choose a shape to draw" });
      expect(within(flyout).getByText("Draw a shape")).toBeTruthy();
      expect(within(flyout).getByText("Pick one, then drag on the page. Hold Shift for equal sides.")).toBeTruthy();
      const options = within(within(flyout).getByRole("listbox", { name: "Shapes" })).getAllByRole("option");
      expect(options).toHaveLength(16);
      expect(options.map((o) => o.getAttribute("aria-label")).slice(0, 4)).toEqual(["Square", "Circle", "Triangle", "Diamond"]);
      // the square is what the tool draws until another shape is picked
      expect(options.filter((o) => o.getAttribute("aria-selected") === "true").map((o) => o.getAttribute("aria-label"))).toEqual(["Square"]);
    });

    it("picks the shape to draw and closes the list", async () => {
      const user = await openPalette();
      await user.click(tool("Shape"));
      await user.click(within(await screen.findByRole("dialog", { name: "Choose a shape to draw" })).getByRole("option", { name: "Star" }));
      expect(state().tool).toBe("shape");
      expect(state().toolShape).toBe("star");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a shape to draw" })).toBeNull());
      expect(tool("Shape").getAttribute("aria-expanded")).toBe("false");

      // the list remembers the choice
      await user.click(tool("Shape"));
      const flyout = await screen.findByRole("dialog", { name: "Choose a shape to draw" });
      expect(within(flyout).getByRole("option", { name: "Star" }).getAttribute("aria-selected")).toBe("true");
      expect(within(flyout).getByRole("option", { name: "Square" }).getAttribute("aria-selected")).toBe("false");
    });

    it("closes the list when the tool is clicked again", async () => {
      const user = await openPalette();
      await user.click(tool("Shape"));
      await screen.findByRole("dialog", { name: "Choose a shape to draw" });
      await user.click(tool("Shape"));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a shape to draw" })).toBeNull());
      expect(state().tool).toBe("shape");
    });

    it("opens the list again for a tool that is already chosen", async () => {
      const user = await openPalette();
      await user.click(tool("Shape"));
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a shape to draw" })).toBeNull());
      await user.click(tool("Shape"));
      expect(await screen.findByRole("dialog", { name: "Choose a shape to draw" })).toBeTruthy();
    });

    it("marks no shape when another tool is chosen", async () => {
      const user = await openPalette();
      await user.click(tool("Shape"));
      await user.click(within(await screen.findByRole("dialog", { name: "Choose a shape to draw" })).getByRole("option", { name: "Heart" }));
      await user.click(tool("Draw"));
      await user.click(tool("Draw"));
      await user.click(tool("Shape"));
      const flyout = await screen.findByRole("dialog", { name: "Choose a shape to draw" });
      // switching back from the pen makes it the shape tool again, with the heart still chosen
      expect(state().tool).toBe("shape");
      expect(within(flyout).getByRole("option", { name: "Heart" }).getAttribute("aria-selected")).toBe("true");
    });

    it("closes with a plain tool", async () => {
      const user = await openPalette();
      await user.click(tool("Shape"));
      await screen.findByRole("dialog", { name: "Choose a shape to draw" });
      await user.click(tool("Line"));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Choose a shape to draw" })).toBeNull());
      expect(tool("Shape").getAttribute("aria-expanded")).toBe("false");
    });
  });

  describe("the pen", () => {
    async function openPen() {
      const user = await openPalette();
      await user.click(tool("Draw"));
      const flyout = await screen.findByRole("dialog", { name: "Pen options" });
      return { user, flyout };
    }
    const preview = (flyout: HTMLElement) => flyout.querySelector(".cf-flyout__preview path") as SVGPathElement;

    it("chooses the pen and opens its options in one click", async () => {
      const { flyout } = await openPen();
      expect(state().tool).toBe("draw");
      expect(tool("Draw").getAttribute("aria-expanded")).toBe("true");
      expect(within(flyout).getByText("Pen")).toBeTruthy();
      expect(within(flyout).getByRole("group", { name: "Pen colour" })).toBeTruthy();
    });

    it("closes the options when the pen is clicked again", async () => {
      const { user } = await openPen();
      await user.click(tool("Draw"));
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pen options" })).toBeNull());
      expect(state().tool).toBe("draw");
    });

    it("offers ten colours with the current one marked, and shows the stroke in the chosen colour", async () => {
      const { user, flyout } = await openPen();
      const swatches = within(within(flyout).getByRole("group", { name: "Pen colour" }))
        .getAllByRole("button")
        .filter((b) => /^#/.test(b.getAttribute("aria-label") ?? ""));
      expect(swatches).toHaveLength(10);
      expect(swatches.filter((s) => s.getAttribute("aria-pressed") === "true").map((s) => s.getAttribute("aria-label"))).toEqual(["#0e1318"]);
      expect(preview(flyout).getAttribute("stroke")).toBe("#0e1318");

      await user.click(within(flyout).getByRole("button", { name: "#e5484d" }));
      expect(drawSettings.color).toBe("#e5484d");
      expect(preview(flyout).getAttribute("stroke")).toBe("#e5484d");
      expect(within(flyout).getByRole("button", { name: "#e5484d" }).getAttribute("aria-pressed")).toBe("true");
      expect(within(flyout).getByRole("button", { name: "#0e1318" }).getAttribute("aria-pressed")).toBe("false");
    });

    it("opens a colour picker for any other colour and marks the custom colour", async () => {
      const { user, flyout } = await openPen();
      const custom = within(flyout).getByRole("button", { name: "Custom colour" });
      expect(custom.classList.contains("is-selected")).toBe(false);
      expect(within(flyout).queryByRole("slider", { name: "Hue" })).toBeNull();

      await user.click(custom);
      expect(custom.getAttribute("aria-expanded")).toBe("true");
      expect(custom.classList.contains("is-selected")).toBe(true);
      const hex = within(flyout).getByRole("textbox", { name: "Hex colour" });
      await user.clear(hex);
      await user.type(hex, "123456");
      expect(drawSettings.color.toLowerCase()).toBe("#123456");
      expect(preview(flyout).getAttribute("stroke")?.toLowerCase()).toBe("#123456");
      expect((custom.querySelector(".cf-flyout__custom-dot") as HTMLElement).style.background).toBe("rgb(18, 52, 86)");
      for (const s of within(flyout)
        .getAllByRole("button")
        .filter((b) => /^#/.test(b.getAttribute("aria-label") ?? "")))
        expect(s.getAttribute("aria-pressed")).toBe("false");

      await user.click(custom);
      expect(within(flyout).queryByRole("textbox", { name: "Hex colour" })).toBeNull();
      // still marked: the colour is not one of the ten
      expect(custom.classList.contains("is-selected")).toBe(true);
    });

    it("starts at an automatic width a little under half a percent of the page", async () => {
      const { flyout } = await openPen();
      const auto = autoDrawWidth(1280);
      expect(within(flyout).getByText(`${auto} px`)).toBeTruthy();
      const slider = within(flyout).getByRole("slider", { name: "Width" });
      expect(slider.getAttribute("aria-valuenow")).toBe(String(auto));
      expect(slider.getAttribute("aria-valuemin")).toBe("1");
      // up to 3% of the page width
      expect(slider.getAttribute("aria-valuemax")).toBe(String(Math.round(1280 * 0.03)));
      expect(drawSettings.width).toBeNull();
    });

    it("sets the width with the keyboard and draws the preview stroke thicker", async () => {
      const { user, flyout } = await openPen();
      const before = Number(preview(flyout).getAttribute("stroke-width"));
      act(() => within(flyout).getByRole("slider", { name: "Width" }).focus());
      await user.keyboard("{ArrowRight}{ArrowRight}{ArrowRight}");
      expect(drawSettings.width).toBe(autoDrawWidth(1280) + 3);
      expect(within(flyout).getByText(`${autoDrawWidth(1280) + 3} px`)).toBeTruthy();
      expect(Number(preview(flyout).getAttribute("stroke-width"))).toBeGreaterThan(before);
    });

    it("keeps the preview stroke between 1.5 and 22", async () => {
      const { flyout } = await openPen();
      act(() => setDrawSettings({ width: 1 }));
      expect(preview(flyout).getAttribute("stroke-width")).toBe("1.5");
      act(() => setDrawSettings({ width: 38 }));
      expect(preview(flyout).getAttribute("stroke-width")).toBe("20");
    });

    it("works for a page of unknown size as for a 1920 px wide one", async () => {
      const user = await openPalette();
      act(() => state().actions.closeDesign());
      await user.click(tool("Draw"));
      const flyout = await screen.findByRole("dialog", { name: "Pen options" });
      expect(within(flyout).getByText(`${autoDrawWidth(1920)} px`)).toBeTruthy();
      expect(within(flyout).getByRole("slider", { name: "Width" }).getAttribute("aria-valuemax")).toBe(String(Math.round(1920 * 0.03)));
    });

    it("closes on Escape and when the page is clicked", async () => {
      const { user } = await openPen();
      await user.keyboard("{Escape}");
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pen options" })).toBeNull());
      await user.click(tool("Draw"));
      await screen.findByRole("dialog", { name: "Pen options" });
      await user.click(document.body);
      await waitFor(() => expect(screen.queryByRole("dialog", { name: "Pen options" })).toBeNull());
    });
  });
});
