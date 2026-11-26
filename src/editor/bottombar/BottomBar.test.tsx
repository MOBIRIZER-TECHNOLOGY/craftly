import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import { chromeDesign, renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { BottomBar } from "./BottomBar";
import { useTimeline } from "@/editor/timeline/timelineStore";
import { NotesPanel } from "./NotesPanel";

const actions = () => useEditor.getState().actions;
const state = () => useEditor.getState();

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(1000, 700);
});

afterEach(() => {
  useTimeline.setState({ open: false, time: 0, playing: false });
  restoreLayout();
  resetEditor();
});

const mount = async (title = "Bottom bar") => {
  const view = await renderChrome(<BottomBar />, chromeDesign(title));
  act(() => actions().setZoom(0.5));
  return view;
};
const button = (name: string | RegExp) => screen.getByRole("button", { name });
const zoomSlider = () => screen.getByRole("slider", { name: "Zoom" });

describe("<BottomBar>: the timeline", () => {
  it("opens and closes the timeline, and says whether it is open", async () => {
    await mount();
    expect(button("Timeline").getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(button("Timeline"));
    expect(useTimeline.getState().open).toBe(true);
    expect(button("Timeline").getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(button("Timeline"));
    expect(useTimeline.getState().open).toBe(false);
  });
});

describe("<BottomBar>: the controls", () => {
  it("offers notes, timer, zoom, pages, grid view, full screen and help", async () => {
    await mount();
    expect(screen.getByRole("contentinfo", { name: "View controls" })).toBeTruthy();
    expect(button("Notes").getAttribute("aria-pressed")).toBe("false");
    expect(button("Timer")).toBeTruthy();
    expect(zoomSlider()).toBeTruthy();
    expect(button("Zoom, 50%").textContent).toBe("50%");
    expect(button("Pages").getAttribute("aria-pressed")).toBe("true");
    expect(button("Grid view")).toBeTruthy();
    expect(button("Present in full screen")).toBeTruthy();
    expect(button("Help").getAttribute("aria-haspopup")).toBe("menu");
  });

  it("shows which page is open, and says it in words to a screen reader (a plain span cannot carry a label)", async () => {
    const { design } = await mount();
    const counter = (n: number) => screen.getByText(`Page ${n} of 3`).closest(".cf-bottombar__pageof") as HTMLElement;
    expect(counter(1).querySelector("[aria-hidden=true]")?.textContent).toBe("1 / 3");
    expect(counter(1).getAttribute("role")).toBe("status");
    expect(counter(1).hasAttribute("aria-label")).toBe(false);
    act(() => actions().setActivePage(design.pages[2].id));
    expect(counter(3).querySelector("[aria-hidden=true]")?.textContent).toBe("3 / 3");
  });

  it("shows and hides the notes", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Notes"));
    expect(state().notesOpen).toBe(true);
    expect(button("Notes").getAttribute("aria-pressed")).toBe("true");
    await user.click(button("Notes"));
    expect(state().notesOpen).toBe(false);
  });

  it("puts the keyboard in the notes it opens, so typing goes there, and leaves it alone when closing them", async () => {
    // the bar with the notes under it, as the editor lays them out
    function WithNotes() {
      const open = useEditor((s) => s.notesOpen);
      return (
        <>
          <BottomBar />
          {open ? <NotesPanel /> : null}
        </>
      );
    }
    await renderChrome(<WithNotes />, chromeDesign("Notes focus"));
    const user = userEvent.setup({ delay: null });
    await user.click(button("Notes"));
    const notes = screen.getByRole("textbox", { name: "Notes for page 1" });
    await waitFor(() => expect(document.activeElement).toBe(notes));
    // at the end of the notes the page already has
    await user.keyboard(" Hello");
    expect((notes as HTMLTextAreaElement).value).toBe("Welcome everyone Hello");
    await user.click(button("Notes"));
    await act(() => new Promise((resolve) => setTimeout(resolve)));
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(document.activeElement).toBe(button("Notes"));
  });

  it("shows and hides the page thumbnails", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Pages"));
    expect(state().showPageStrip).toBe(false);
    expect(button("Pages").getAttribute("aria-pressed")).toBe("false");
    await user.click(button("Pages"));
    expect(state().showPageStrip).toBe(true);
  });

  it("starts the presentation", async () => {
    await mount();
    await userEvent.setup({ delay: null }).click(button("Present in full screen"));
    expect(state().presenting).toBe(true);
  });

  it("finds the keyboard shortcuts under Help", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Help"));
    const menu = screen.getByRole("menu", { name: "Help" });
    await user.click(within(menu).getByRole("menuitem", { name: /^Keyboard shortcuts/ }));
    expect(state().dialog).toBe("shortcuts");
    expect(screen.queryByRole("menu", { name: "Help" })).toBeNull();
  });
});

describe("<BottomBar>: zoom", () => {
  it("zooms with the keyboard on the slider", async () => {
    await mount();
    const slider = zoomSlider();
    expect(slider.getAttribute("aria-valuetext")).toBe("50%");
    fireEvent.keyDown(slider, { key: "ArrowRight" });
    expect(state().zoom).toBeGreaterThan(0.5);
    expect(state().zoomMode).toBe("custom");
    const larger = state().zoom;
    fireEvent.keyDown(slider, { key: "ArrowLeft" });
    expect(state().zoom).toBeLessThan(larger);
    fireEvent.keyDown(slider, { key: "End" });
    expect(state().zoom).toBe(3);
    expect(slider.getAttribute("aria-valuetext")).toBe("300%");
    fireEvent.keyDown(slider, { key: "Home" });
    expect(state().zoom).toBeCloseTo(0.1, 5);
  });

  it("zooms to the point of the track that is clicked", async () => {
    await mount();
    // the track is 1000 px wide and logarithmic: the middle is the geometric mean of 10% and 300%
    fireEvent.pointerDown(zoomSlider().closest(".cf-slider__control")!, { clientX: 500, clientY: 5, button: 0, pointerId: 1 });
    expect(state().zoom).toBeCloseTo(Math.sqrt(0.1 * 3), 3);
    expect(button(/^Zoom, 55%/)).toBeTruthy();
  });

  it("offers preset zoom levels and marks the current one", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    act(() => actions().setZoom(1));
    await user.click(button("Zoom, 100%"));
    const menu = screen.getByRole("menu", { name: "Zoom" });
    expect(
      within(menu)
        .getAllByRole("menuitemcheckbox")
        .map((i) => i.textContent),
    ).toEqual(["300%", "200%", "125%", "100%", "75%", "50%", "25%", "10%", "Fit", "Fill"]);
    expect(within(menu).getByRole("menuitemcheckbox", { name: "100%" }).getAttribute("aria-checked")).toBe("true");
    expect(within(menu).getByRole("menuitemcheckbox", { name: "200%" }).getAttribute("aria-checked")).toBe("false");
    await user.click(within(menu).getByRole("menuitemcheckbox", { name: "200%" }));
    expect(state().zoom).toBe(2);
    expect(state().zoomMode).toBe("custom");
    expect(screen.queryByRole("menu", { name: "Zoom" })).toBeNull();
    expect(button("Zoom, 200%")).toBeTruthy();
  });

  it("fits and fills the page in the window", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Zoom, 50%"));
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Fit" }));
    expect(state().zoomMode).toBe("fit");
    const fit = state().zoom;
    await user.click(button(/^Zoom, \d+%$/));
    const checked = screen.getAllByRole("menuitemcheckbox").filter((i) => i.getAttribute("aria-checked") === "true");
    // a fitted zoom is not any of the presets: only Fit is ticked
    expect(checked.map((i) => i.textContent)).toEqual(["Fit"]);
    await user.click(screen.getByRole("menuitemcheckbox", { name: "Fill" }));
    expect(state().zoomMode).toBe("fill");
    expect(state().zoom).toBeGreaterThanOrEqual(fit);
  });
});

describe("<BottomBar>: grid view", () => {
  it("switches to the grid view and back, leaving only what the grid needs", async () => {
    const { container } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(button("Grid view"));
    expect(state().gridView).toBe(true);
    expect(button("Exit grid view").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector(".cf-bottombar")?.classList.contains("is-grid")).toBe(true);
    for (const gone of ["Notes", "Timer", "Pages"]) expect(screen.queryByRole("button", { name: gone })).toBeNull();
    expect(screen.queryByRole("slider", { name: "Zoom" })).toBeNull();
    expect(screen.queryByLabelText(/^Page \d of \d$/)).toBeNull();
    expect(button("Present in full screen")).toBeTruthy();
    expect(button("Help")).toBeTruthy();

    await user.click(button("Exit grid view"));
    expect(state().gridView).toBe(false);
    expect(button("Notes")).toBeTruthy();
    expect(zoomSlider()).toBeTruthy();
  });
});
