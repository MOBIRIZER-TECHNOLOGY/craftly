import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { PromptHost, promptText, type PromptOptions } from "./prompt";

/** Ask through the imperative API from inside act, so the dialog is on screen when this returns. */
function ask(options: PromptOptions): Promise<string | null> {
  let pending!: Promise<string | null>;
  act(() => {
    pending = promptText(options);
  });
  return pending;
}

const field = () => screen.getByRole("textbox") as HTMLInputElement;
const save = () => screen.getByRole("button", { name: /^(Save|Rename|Create)/ }) as HTMLButtonElement;

describe("<PromptHost>", () => {
  it("shows nothing until something asks", () => {
    render(<PromptHost />);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("shows a dialog with the title and a labelled field, with the cursor in it", async () => {
    render(<PromptHost />);
    const answer = ask({ title: "Rename design", label: "Design name" });
    expect(screen.getByRole("dialog", { name: "Rename design" })).toBeTruthy();
    expect(screen.getByLabelText("Design name")).toBe(field());
    expect(document.activeElement).toBe(field());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await answer;
  });

  it("starts with the initial text selected, so typing replaces it", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const answer = ask({ title: "Rename", label: "Name", initialValue: "Old name" });
    expect(field().value).toBe("Old name");
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe("Old name".length);
    await user.keyboard("New name{Enter}");
    await expect(answer).resolves.toBe("New name");
  });

  it("resolves with the trimmed text when the user presses Enter", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const answer = ask({ title: "New folder", label: "Folder name" });
    await user.type(field(), "  Campaign A  {Enter}");
    await expect(answer).resolves.toBe("Campaign A");
  });

  it("resolves with the text when the save button is pressed", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const answer = ask({ title: "New folder", label: "Folder name", confirmLabel: "Create folder" });
    await user.type(field(), "Logos");
    await user.click(screen.getByRole("button", { name: "Create folder" }));
    await expect(answer).resolves.toBe("Logos");
  });

  it("labels the button 'Save' unless told otherwise", async () => {
    render(<PromptHost />);
    const answer = ask({ title: "T", label: "L" });
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await answer;
  });

  it("will not save an empty or blank name", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const answer = ask({ title: "Rename", label: "Name", confirmLabel: "Rename", initialValue: "Keep" });
    await user.clear(field());
    expect(save().disabled).toBe(true);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.type(field(), "   ");
    expect(save().disabled).toBe(true);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.type(field(), "x");
    expect(save().disabled).toBe(false);
    await user.keyboard("{Enter}");
    await expect(answer).resolves.toBe("x");
  });

  it("resolves null when the user cancels", async () => {
    render(<PromptHost />);
    const answer = ask({ title: "Rename", label: "Name", initialValue: "Keep" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await expect(answer).resolves.toBeNull();
  });

  it("resolves null on Escape", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const answer = ask({ title: "Rename", label: "Name" });
    await user.keyboard("{Escape}");
    await expect(answer).resolves.toBeNull();
  });

  it("resolves null when the backdrop is clicked", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const answer = ask({ title: "Rename", label: "Name" });
    await user.click(screen.getByRole("dialog").parentElement as HTMLElement);
    await expect(answer).resolves.toBeNull();
  });

  it("shows the placeholder and the hint", async () => {
    render(<PromptHost />);
    const answer = ask({ title: "New folder", label: "Folder name", placeholder: "Untitled folder", hint: "You can rename it later" });
    expect(field().placeholder).toBe("Untitled folder");
    const hint = screen.getByText("You can rename it later");
    expect(field().getAttribute("aria-describedby")).toBe(hint.id);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await answer;
  });

  it("limits the length to 120 characters, or to the limit it is given", async () => {
    render(<PromptHost />);
    const first = ask({ title: "T", label: "L" });
    expect(field().maxLength).toBe(120);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await first;
    const second = ask({ title: "T", label: "L", maxLength: 12 });
    expect(field().maxLength).toBe(12);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await second;
  });

  it("asks queued questions one after the other, each with a fresh field", async () => {
    const user = userEvent.setup();
    render(<PromptHost />);
    const first = ask({ title: "First", label: "One", initialValue: "a" });
    const second = ask({ title: "Second", label: "Two", initialValue: "b" });
    expect(screen.getByRole("dialog", { name: "First" })).toBeTruthy();
    await user.keyboard("{Enter}");
    await expect(first).resolves.toBe("a");
    expect(screen.getByRole("dialog", { name: "Second" })).toBeTruthy();
    expect(field().value).toBe("b");
    await user.click(field());
    await user.keyboard("{Enter}");
    await expect(second).resolves.toBe("b");
  });
});
