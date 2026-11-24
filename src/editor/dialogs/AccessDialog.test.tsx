import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createDesign, createGroup, createImage, createPage, createShape, createText, solid } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { AltTextDialog } from "@/editor/toolbar/AltTextDialog";
import { useAltTextDialog } from "@/editor/toolbar/altText";
import { resetEditor } from "@/test/helpers";
import { DialogHost } from "./DialogHost";

const state = () => useEditor.getState();

beforeEach(() => {
  resetEditor();
  useAltTextDialog.setState({ id: null });
});
afterEach(() => resetEditor());

/** A design with a pale text on the first page, and on the second a picture without a description inside a group. */
function design(): { design: Design; paleId: string; groupId: string; photoId: string } {
  const pale = createText({ text: "Hard to read", color: "#dddddd", fontSize: 16, x: 100, y: 100 });
  const fine = createText({ text: "Easy to read", color: "#111111", fontSize: 16, x: 100, y: 300 });
  const photo = createImage({ src: "asset:1", name: "Team photo", x: 0, y: 0, width: 200, height: 100, naturalWidth: 400, naturalHeight: 200 });
  const group = createGroup([photo], { x: 300, y: 200 });
  const first = createPage({ background: solid("#ffffff"), elements: [pale, fine] });
  const second = createPage({ background: solid("#ffffff"), elements: [group] });
  return { design: createDesign({ title: "Poster", width: 1280, height: 720, pages: [first, second] }), paleId: pale.id, groupId: group.id, photoId: photo.id };
}

function mount(d: Design) {
  act(() => state().actions.openDesign(d));
  const view = render(
    <>
      <DialogHost />
      <AltTextDialog />
    </>,
  );
  act(() => state().actions.openDialog("accessibility"));
  return view;
}

const dialog = () => screen.getByRole("dialog", { name: "Check accessibility" });

describe("<AccessDialog>", () => {
  it("lists what was found, page by page, and says what it does not look at", () => {
    mount(design().design);
    expect(within(dialog()).getByRole("status").textContent).toBe("2 things to look at");
    const first = within(dialog()).getByRole("region", { name: "Page 1" });
    expect(within(first).getByText("“Hard to read” has a contrast of 1.36 to 1 with what is behind it, and needs 4.5 to 1.")).toBeTruthy();
    expect(within(first).queryByText(/Easy to read/)).toBeNull();
    const second = within(dialog()).getByRole("region", { name: "Page 2" });
    expect(within(second).getByText("The picture “Team photo” has no alternative text.")).toBeTruthy();
    expect(within(dialog()).getByText(/A text over a picture, a gradient or a see-through shape is not judged/)).toBeTruthy();
    // the sample of a text shows its two colours as they meet
    const sample = first.querySelector<HTMLElement>(".cf-access__sample");
    expect([sample?.style.color, sample?.style.background]).toEqual(["rgb(221, 221, 221)", "rgb(255, 255, 255)"]);
  });

  it("says so when nothing was found", () => {
    const d = createDesign({
      width: 1280,
      height: 720,
      pages: [createPage({ background: solid("#ffffff"), elements: [createText({ text: "Fine", color: "#000000" }), createShape("rect")] })],
    });
    mount(d);
    expect(within(dialog()).getByRole("status").textContent).toBe("Nothing found.");
    expect(within(dialog()).queryByRole("region")).toBeNull();
    expect(within(dialog()).queryByRole("button", { name: /^Show/ })).toBeNull();
  });

  it("counts one thing in the singular", () => {
    const d = createDesign({ width: 1280, height: 720, pages: [createPage({ background: solid("#ffffff"), elements: [createText({ text: "Pale", color: "#eeeeee" })] })] });
    mount(d);
    expect(within(dialog()).getByRole("status").textContent).toBe("1 thing to look at");
  });

  it("goes to the page of a finding, selects the element and closes", async () => {
    const user = userEvent.setup();
    const { design: d, paleId } = design();
    mount(d);
    act(() => state().actions.setActivePage(d.pages[1].id));
    await user.click(within(dialog()).getByRole("button", { name: /^Show on the page: “Hard to read”/ }));
    expect(state().activePageId).toBe(d.pages[0].id);
    expect(state().selection).toEqual([paleId]);
    expect(state().dialog).toBeNull();
  });

  it("selects the group of a picture that is inside one, and opens the alternative text of the picture itself", async () => {
    const user = userEvent.setup();
    const { design: d, groupId, photoId } = design();
    mount(d);
    await user.click(within(dialog()).getByRole("button", { name: /^Add alternative text: The picture “Team photo”/ }));
    expect(state().activePageId).toBe(d.pages[1].id);
    expect(state().selection).toEqual([groupId]);
    expect(useAltTextDialog.getState().id).toBe(photoId);
    const alt = await screen.findByRole("dialog", { name: "Alternative text" });
    await user.type(within(alt).getByRole("textbox", { name: "Alternative text" }), "Five people at a table");
    await user.click(within(alt).getByRole("button", { name: "Save" }));
    // the picture is described now: the check finds one thing less
    act(() => state().actions.openDialog("accessibility"));
    await waitFor(() => expect(within(dialog()).getByRole("status").textContent).toBe("1 thing to look at"));
    expect(within(dialog()).queryByRole("region", { name: "Page 2" })).toBeNull();
  });

  it("finds a design that changes while it is open again", () => {
    const { design: d, paleId } = design();
    mount(d);
    act(() => state().actions.updateElements([paleId], { color: "#000000" } as never));
    expect(within(dialog()).getByRole("status").textContent).toBe("1 thing to look at");
    expect(within(dialog()).queryByRole("region", { name: "Page 1" })).toBeNull();
  });
});
