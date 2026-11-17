import { act, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { firstRunKey, isFirstRunDone, resetFirstRun } from "@/components/firstRun";
import { createShape } from "@/core/factory";
import { openElements, store } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { EmptyCanvasHint } from "./EmptyCanvasHint";

const hint = () => screen.queryByRole("note", { name: "Getting started" });

/** The hint inside a stand-in for the workspace, which is where the keyboard goes when it is dismissed. */
function mount() {
  return render(
    <div data-cf-workspace tabIndex={0} aria-label="Design canvas">
      <EmptyCanvasHint />
    </div>,
  );
}

beforeEach(() => {
  resetEditor();
  resetFirstRun();
});
afterEach(() => {
  resetEditor();
  resetFirstRun();
});

describe("<EmptyCanvasHint>", () => {
  it("says how to add text, shapes and photos on a first empty page, as a note that is not a heading or a dialog", () => {
    openElements([]);
    mount();
    const note = hint();
    expect(note).toBeTruthy();
    expect(note?.textContent).toContain("Your page is empty");
    expect(note?.textContent).toContain("Add text, shapes and photos from the Text, Elements and Uploads tabs");
    expect(note?.querySelectorAll("kbd")).toHaveLength(4);
    expect(note?.hasAttribute("data-cf-ui")).toBe(true);
    expect(screen.queryByRole("heading")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is never shown for a design that has something on it", () => {
    openElements([createShape("rect")]);
    mount();
    expect(hint()).toBeNull();
    expect(isFirstRunDone("canvasHint")).toBe(false);
  });

  it("is not shown to somebody who can only look", () => {
    openElements([]);
    act(() => store().actions.setMode("view"));
    mount();
    expect(hint()).toBeNull();
  });

  it("goes with the first element, and stays gone when the page is empty again or another empty design opens", () => {
    openElements([]);
    mount();
    expect(hint()).toBeTruthy();
    act(() => {
      store().actions.addElement(createShape("rect"));
    });
    expect(hint()).toBeNull();
    expect(localStorage.getItem(firstRunKey("canvasHint"))).toBe("1");
    act(() => store().actions.undo());
    expect(store().design?.pages[0].elements).toHaveLength(0);
    expect(hint()).toBeNull();
    openElements([]);
    expect(hint()).toBeNull();
  });

  it("is put away by its close button, from the keyboard, and the keyboard goes back to the canvas", async () => {
    const user = userEvent.setup();
    openElements([]);
    mount();
    const close = screen.getByRole("button", { name: "Dismiss this hint" });
    close.focus();
    await user.keyboard("{Enter}");
    expect(hint()).toBeNull();
    expect(document.activeElement?.getAttribute("aria-label")).toBe("Design canvas");
    expect(isFirstRunDone("canvasHint")).toBe(true);
  });
});
