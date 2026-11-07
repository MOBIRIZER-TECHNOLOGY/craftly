import { act, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createImage, createShape } from "@/core/factory";
import { live, openElements } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { AltTextDialog } from "./AltTextDialog";
import { openAltTextDialog, useAltTextDialog } from "./altText";

beforeEach(() => {
  resetEditor();
  useAltTextDialog.setState({ id: null });
});

const dialog = () => screen.getByRole("dialog", { name: "Alternative text" });
const field = () => within(dialog()).getByRole("textbox", { name: "Alternative text" }) as HTMLTextAreaElement;

function setup() {
  const photo = createImage({ src: "https://example.test/p.jpg", x: 0, y: 0, width: 100, height: 100, naturalWidth: 100, naturalHeight: 100, alt: "A mountain" });
  const box = createShape("rect");
  openElements([photo, box]);
  render(<AltTextDialog />);
  return { photo, box };
}

describe("<AltTextDialog>", () => {
  it("is closed until it is asked for an element", () => {
    setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openAltTextDialog("anything"));
    expect(dialog()).toBeTruthy();
  });

  it("says where the description goes: screen readers and SVG downloads, which is all that uses it", () => {
    const { photo } = setup();
    act(() => openAltTextDialog(photo.id));
    expect(within(dialog()).getByText("Describe this element for people who use a screen reader. It is also saved in SVG downloads.")).toBeTruthy();
  });

  it("starts with the description the element already has", () => {
    const { photo } = setup();
    act(() => openAltTextDialog(photo.id));
    expect(field().value).toBe("A mountain");
    expect(within(dialog()).getByText("10 / 500")).toBeTruthy();
    expect(field().maxLength).toBe(500);
  });

  it("saves the trimmed text and closes", async () => {
    const user = userEvent.setup();
    const { box } = setup();
    act(() => openAltTextDialog(box.id));
    expect(field().value).toBe("");
    await user.type(field(), "  A purple square ");
    expect(within(dialog()).getByText("18 / 500")).toBeTruthy();
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(live(box).alt).toBe("A purple square");
    expect(useAltTextDialog.getState().id).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("removes the description when it is cleared", async () => {
    const user = userEvent.setup();
    const { photo } = setup();
    act(() => openAltTextDialog(photo.id));
    await user.clear(field());
    await user.click(within(dialog()).getByRole("button", { name: "Save" }));
    expect(live(photo).alt).toBeUndefined();
  });

  it("keeps the old description on Cancel and on Escape", async () => {
    const user = userEvent.setup();
    const { photo } = setup();
    act(() => openAltTextDialog(photo.id));
    await user.type(field(), " at sunrise");
    await user.click(within(dialog()).getByRole("button", { name: "Cancel" }));
    expect(live(photo).alt).toBe("A mountain");
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openAltTextDialog(photo.id));
    await user.type(field(), "!");
    await user.keyboard("{Escape}");
    expect(live(photo).alt).toBe("A mountain");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("saves with Ctrl+Enter and treats a plain Enter as a new line", async () => {
    const user = userEvent.setup();
    const { box } = setup();
    act(() => openAltTextDialog(box.id));
    await user.type(field(), "Line one{Enter}Line two");
    expect(field().value).toBe("Line one\nLine two");
    expect(live(box).alt).toBeUndefined();
    fireEvent.keyDown(field(), { key: "Enter", ctrlKey: true });
    expect(live(box).alt).toBe("Line one\nLine two");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("starts fresh for the next element", () => {
    const { photo, box } = setup();
    act(() => openAltTextDialog(photo.id));
    expect(field().value).toBe("A mountain");
    act(() => openAltTextDialog(box.id));
    expect(field().value).toBe("");
  });
});
