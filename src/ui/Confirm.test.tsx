import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ConfirmHost, confirm, type ConfirmOptions } from "./Confirm";

/** Ask through the imperative API from inside act, so the dialog is on screen when this returns. */
function ask(options: ConfirmOptions): Promise<boolean> {
  let pending!: Promise<boolean>;
  act(() => {
    pending = confirm(options);
  });
  return pending;
}

const dialog = () => screen.getByRole("dialog");
const press = (name: string) => fireEvent.click(screen.getByRole("button", { name }));

describe("confirm() without a host", () => {
  // keep this first: the warning is shown only once per page
  it("falls back to the browser's confirm box and says so once", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const native = vi.spyOn(window, "confirm").mockReturnValueOnce(true).mockReturnValueOnce(false);
    await expect(confirm({ title: "Delete?", message: "This cannot be undone" })).resolves.toBe(true);
    await expect(confirm({ title: "Delete?", message: "This cannot be undone" })).resolves.toBe(false);
    expect(native).toHaveBeenCalledWith("This cannot be undone");
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toContain("ConfirmHost");
  });

  it("asks with the title when there is no text message, and with a generic question when neither is text", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const native = vi.spyOn(window, "confirm").mockReturnValue(true);
    await confirm({ title: "Discard changes?" });
    expect(native).toHaveBeenLastCalledWith("Discard changes?");
    await confirm({ title: <b>Rich</b>, message: <i>Rich too</i> });
    expect(native).toHaveBeenLastCalledWith("Are you sure?");
    await confirm({ title: "Title", message: <i>Rich</i> });
    expect(native).toHaveBeenLastCalledWith("Title");
  });
});

describe("<ConfirmHost>", () => {
  it("shows nothing until something asks", () => {
    render(<ConfirmHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows the question as a dialog with its title, message and default buttons", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Discard changes?", message: "Your edits will be lost." });
    expect(screen.getByRole("dialog", { name: "Discard changes?" })).toBeTruthy();
    expect(screen.getByText("Your edits will be lost.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Confirm" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Close" })).toBeNull();
    press("Cancel");
    await answer;
  });

  it("resolves true when the user confirms", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Go on?" });
    press("Confirm");
    await expect(answer).resolves.toBe(true);
  });

  it("resolves false when the user cancels", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Go on?" });
    press("Cancel");
    await expect(answer).resolves.toBe(false);
  });

  it("resolves false on Escape", async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    const answer = ask({ title: "Go on?" });
    await user.keyboard("{Escape}");
    await expect(answer).resolves.toBe(false);
  });

  it("resolves false when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<ConfirmHost />);
    const answer = ask({ title: "Go on?" });
    await user.click(dialog().parentElement as HTMLElement);
    await expect(answer).resolves.toBe(false);
  });

  it("uses the labels it is given", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Delete it?", confirmLabel: "Delete forever", cancelLabel: "Keep it" });
    expect(screen.getByRole("button", { name: "Keep it" })).toBeTruthy();
    press("Delete forever");
    await expect(answer).resolves.toBe(true);
  });

  it("starts on the confirm button for a normal question", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Go on?" });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Confirm" }));
    press("Cancel");
    await answer;
  });

  it("starts on Cancel for a dangerous question, so Enter cannot destroy anything by accident", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Delete it?", confirmLabel: "Delete", danger: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Delete" }).classList.contains("cf-btn--danger")).toBe(true);
    press("Cancel");
    await expect(answer).resolves.toBe(false);
  });

  it("can start on Cancel without being a dangerous question: the confirm button keeps its normal look", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Download it?", confirmLabel: "Download", focusCancel: true });
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Download" }).classList.contains("cf-btn--danger")).toBe(false);
    press("Cancel");
    await expect(answer).resolves.toBe(false);
  });

  it("shows no message paragraph without a message", async () => {
    render(<ConfirmHost />);
    const answer = ask({ title: "Go on?" });
    expect(dialog().querySelector(".cf-confirm__message")).toBeNull();
    press("Cancel");
    await answer;
  });

  it("asks queued questions one after the other", async () => {
    render(<ConfirmHost />);
    const first = ask({ title: "First?" });
    const second = ask({ title: "Second?" });
    expect(screen.getByRole("dialog", { name: "First?" })).toBeTruthy();
    press("Confirm");
    await expect(first).resolves.toBe(true);
    expect(screen.getByRole("dialog", { name: "Second?" })).toBeTruthy();
    press("Cancel");
    await expect(second).resolves.toBe(false);
  });

  it("goes back to the browser's confirm box once the host is gone", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const native = vi.spyOn(window, "confirm").mockReturnValue(true);
    const { unmount } = render(<ConfirmHost />);
    unmount();
    await expect(confirm({ title: "Anyone there?" })).resolves.toBe(true);
    expect(native).toHaveBeenCalledWith("Anyone there?");
  });
});
