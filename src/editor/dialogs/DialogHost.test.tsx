import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useEditor } from "@/core/store";
import type { DialogName } from "@/core/store";
import { chromeDesign, renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor, stubLayout } from "@/test/helpers";
import { DialogHost } from "./DialogHost";

const actions = () => useEditor.getState().actions;

let restoreLayout: () => void;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  restoreLayout = stubLayout(1000, 700);
});

afterEach(() => {
  restoreLayout();
  resetEditor();
});

const mount = () => renderChrome(<DialogHost />, chromeDesign("Dialog host"));
const open = (name: DialogName) => act(() => actions().openDialog(name));
const noDialogLeft = () => waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

describe("<DialogHost>", () => {
  it("shows nothing while no dialog is open", async () => {
    const { container } = await mount();
    expect(container.querySelector("[role=dialog]")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it.each([
    ["resize", "Resize design"],
    ["shortcuts", "Keyboard shortcuts"],
    ["findReplace", "Find and replace"],
    ["download", "Download"],
    ["versions", "Version history"],
    ["share", "Share design"],
    ["settings", "Settings"],
    ["rename", "Rename design"],
    ["models", "On-device models"],
  ] as const)("opens the %s dialog", async (name, title) => {
    await mount();
    open(name);
    expect(await screen.findByRole("dialog", { name: title })).toBeTruthy();
  });

  it("closes the dialog through the store and lets it leave before removing it", async () => {
    await mount();
    open("settings");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    act(() => actions().closeDialog());
    expect(useEditor.getState().dialog).toBeNull();
    // it stays for its exit animation ...
    expect(dialog.isConnected).toBe(true);
    // ... and is gone a moment later
    await noDialogLeft();
  });

  it("closes the dialog on Escape and from its own close button", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    open("shortcuts");
    await screen.findByRole("dialog", { name: "Keyboard shortcuts" });
    await user.keyboard("{Escape}");
    expect(useEditor.getState().dialog).toBeNull();
    await noDialogLeft();
    open("settings");
    const dialog = await screen.findByRole("dialog", { name: "Settings" });
    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    expect(useEditor.getState().dialog).toBeNull();
    await noDialogLeft();
  });

  it("lets the find panel go away when it is closed from the store", async () => {
    await mount();
    open("findReplace");
    await screen.findByRole("dialog", { name: "Find and replace" });
    act(() => actions().closeDialog());
    await noDialogLeft();
    expect(screen.queryByRole("dialog", { name: "Find and replace" })).toBeNull();
    expect(useEditor.getState().dialog).toBeNull();
  });

  it("starts a dialog afresh when it is opened again after it has left", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    open("rename");
    const field = (await screen.findByRole("textbox", { name: "Design name" })) as HTMLInputElement;
    await user.clear(field);
    await user.type(field, "Half-typed name");
    await user.keyboard("{Escape}");
    await noDialogLeft();
    await new Promise((resolve) => setTimeout(resolve, 300)); // the host forgets the dialog a moment after it closed
    open("rename");
    expect(((await screen.findByRole("textbox", { name: "Design name" })) as HTMLInputElement).value).toBe("Dialog host");
  });

  it("shows a dialog that is opened again while the last one is still leaving", async () => {
    await mount();
    open("settings");
    await screen.findByRole("dialog", { name: "Settings" });
    act(() => actions().closeDialog());
    open("rename");
    expect(await screen.findByRole("dialog", { name: "Rename design" })).toBeTruthy();
    // the pending removal of the first dialog must not take the second one down
    await new Promise((resolve) => setTimeout(resolve, 350));
    expect(screen.getByRole("dialog", { name: "Rename design" })).toBeTruthy();
  });

  it("switches from one dialog to another", async () => {
    await mount();
    open("settings");
    await screen.findByRole("dialog", { name: "Settings" });
    open("rename");
    expect(await screen.findByRole("dialog", { name: "Rename design" })).toBeTruthy();
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull());
  });

  it("sends 'newDesign' to the home page, which owns the create dialog", async () => {
    window.location.hash = "#/design/abc";
    await mount();
    open("newDesign");
    await waitFor(() => expect(window.location.hash).toBe("#/"));
    expect(sessionStorage.getItem("craftly:open-create")).toBe("1");
    expect(useEditor.getState().dialog).toBeNull();
  });

  it("shows the download options in a dialog", async () => {
    await mount();
    open("download");
    const dialog = await screen.findByRole("dialog", { name: "Download" });
    expect(within(dialog).getByRole("combobox", { name: "File type" })).toBeTruthy();
    expect(within(dialog).getByRole("button", { name: "Download" })).toBeTruthy();
  });

  it("shows the share panel in a dialog", async () => {
    await mount();
    open("share");
    const dialog = await screen.findByRole("dialog", { name: "Share design" });
    expect(
      within(dialog)
        .getAllByRole("button")
        .map((b) => b.textContent),
    ).toContain("Save project file");
  });
});
