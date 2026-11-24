import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";
import { createShape, createText } from "@/core/factory";
import { useEditor } from "@/core/store";
import { live, openElements } from "@/test/ctxUtils";
import { resetEditor } from "@/test/helpers";
import { LinkDialog } from "./LinkDialog";
import { openLinkDialog, useLinkDialog } from "./link";

beforeEach(() => {
  resetEditor();
  useLinkDialog.setState({ id: null });
});

const dialog = () => screen.getByRole("dialog", { name: "Link" });
const field = () => within(dialog()).getByRole("textbox", { name: "Address" }) as HTMLInputElement;
const press = (name: string) => within(dialog()).getByRole("button", { name });

function setup() {
  const linked = createShape("rect", { link: "https://example.org/pricing" });
  const plain = createText({ text: "Read more" });
  openElements([linked, plain]);
  render(<LinkDialog />);
  return { linked, plain };
}

describe("<LinkDialog>", () => {
  it("is closed until it is asked for an element", () => {
    const { plain } = setup();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => openLinkDialog(plain.id));
    expect(dialog()).toBeTruthy();
    expect(within(dialog()).getByText("A click on this element opens the address: in the presenter, in a PDF and in an SVG download.")).toBeTruthy();
  });

  it("starts with the address the element has, and offers to remove it only then", () => {
    const { linked, plain } = setup();
    act(() => openLinkDialog(linked.id));
    expect(field().value).toBe("https://example.org/pricing");
    expect(press("Remove link")).toBeTruthy();
    act(() => openLinkDialog(plain.id));
    expect(field().value).toBe("");
    expect(within(dialog()).queryByRole("button", { name: "Remove link" })).toBeNull();
  });

  it("stores a web address in full, as one step of undo", async () => {
    const user = userEvent.setup();
    const { plain } = setup();
    act(() => openLinkDialog(plain.id));
    await user.type(field(), "  example.com/about ");
    await user.click(press("Save"));
    expect(live(plain).link).toBe("https://example.com/about");
    expect(useLinkDialog.getState().id).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useEditor.getState().actions.undo());
    expect(live(plain).link).toBeUndefined();
  });

  it("takes mail and phone addresses as they are, and saves on Enter", async () => {
    const user = userEvent.setup();
    const { plain, linked } = setup();
    act(() => openLinkDialog(plain.id));
    await user.type(field(), "mailto:hello@example.org{Enter}");
    expect(live(plain).link).toBe("mailto:hello@example.org");
    act(() => openLinkDialog(linked.id));
    await user.clear(field());
    await user.type(field(), "tel:+4930123456{Enter}");
    expect(live(linked).link).toBe("tel:+4930123456");
  });

  it("refuses an address that could run code or is no address, says so, and changes nothing", async () => {
    const user = userEvent.setup();
    const { linked } = setup();
    act(() => openLinkDialog(linked.id));
    for (const bad of ["javascript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "just some words"]) {
      await user.clear(field());
      await user.type(field(), bad);
      await user.click(press("Save"));
      expect(within(dialog()).getByRole("alert").textContent).toBe(
        "This is not an address a link can lead to. Use a web address such as example.com, or one that starts with https://, mailto: or tel:.",
      );
      expect(field().getAttribute("aria-invalid")).toBe("true");
      expect(field().getAttribute("aria-describedby")).toBe(within(dialog()).getByRole("alert").id);
      expect(live(linked).link).toBe("https://example.org/pricing");
    }
    // the message goes as soon as the address is changed
    await user.type(field(), "!");
    expect(within(dialog()).queryByRole("alert")).toBeNull();
    expect(field().getAttribute("aria-invalid")).toBeNull();
  });

  it("removes the link with the button, and when the field is saved empty", async () => {
    const user = userEvent.setup();
    const { linked } = setup();
    act(() => openLinkDialog(linked.id));
    await user.click(press("Remove link"));
    expect(live(linked).link).toBeUndefined();
    expect(screen.queryByRole("dialog")).toBeNull();
    act(() => useEditor.getState().actions.undo());
    expect(live(linked).link).toBe("https://example.org/pricing");
    act(() => openLinkDialog(linked.id));
    await user.clear(field());
    await user.type(field(), "   ");
    await user.click(press("Save"));
    expect(live(linked).link).toBeUndefined();
  });

  it("keeps the old address on Cancel and on Escape", async () => {
    const user = userEvent.setup();
    const { linked } = setup();
    act(() => openLinkDialog(linked.id));
    await user.type(field(), "/more");
    await user.click(press("Cancel"));
    expect(live(linked).link).toBe("https://example.org/pricing");
    act(() => openLinkDialog(linked.id));
    await user.type(field(), "x");
    await user.keyboard("{Escape}");
    expect(live(linked).link).toBe("https://example.org/pricing");
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
