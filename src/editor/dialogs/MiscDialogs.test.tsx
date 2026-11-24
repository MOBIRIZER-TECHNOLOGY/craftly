import { act, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { chromeDesign, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { NewDesignRedirect, RenameDialog, SettingsDialog, ShareDialog } from "./MiscDialogs";

const actions = () => useEditor.getState().actions;

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
});

afterEach(() => resetEditor());

describe("<SettingsDialog>", () => {
  it("shows the current settings and switches them", async () => {
    await renderChrome(<SettingsDialog open onClose={vi.fn()} />, chromeDesign("Settings"));
    const user = userEvent.setup({ delay: null });
    const rulers = screen.getByRole("switch", { name: "Show rulers" }) as HTMLInputElement;
    const snap = screen.getByRole("switch", { name: "Snap to guides" }) as HTMLInputElement;
    const strip = screen.getByRole("switch", { name: "Show page thumbnails" }) as HTMLInputElement;
    expect([rulers.checked, snap.checked, strip.checked]).toEqual([false, true, true]);
    await user.click(rulers);
    await user.click(snap);
    await user.click(strip);
    const s = useEditor.getState();
    expect([s.showRulers, s.snapEnabled, s.showPageStrip]).toEqual([true, false, false]);
    expect([rulers.checked, snap.checked, strip.checked]).toEqual([true, false, false]);
  });

  it("shows margins and saves a custom size", async () => {
    await renderChrome(<SettingsDialog open onClose={vi.fn()} />, chromeDesign("Margins"));
    const user = userEvent.setup({ delay: null });
    const margins = screen.getByRole("switch", { name: "Show margins" }) as HTMLInputElement;
    expect(margins.checked).toBe(false);
    await user.click(margins);
    const field = screen.getByRole("spinbutton", { name: "Margin size" }) as HTMLInputElement;
    expect(field.value).toBe("36");
    await user.clear(field);
    await user.type(field, "75{Enter}");
    expect(useEditor.getState().showMargins).toBe(true);
    expect(storeDesign().margin).toBe(75);
    await user.clear(field);
    await user.type(field, "10000{Enter}");
    expect(storeDesign().margin).toBe(360);
  });

  it("closes with Done", async () => {
    const onClose = vi.fn();
    await renderChrome(<SettingsDialog open onClose={onClose} />, chromeDesign("Settings done"));
    await userEvent.setup({ delay: null }).click(screen.getByRole("button", { name: "Done" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("<RenameDialog>", () => {
  const mount = (title: string, onClose = vi.fn()) => renderChrome(<RenameDialog open onClose={onClose} />, chromeDesign(title));
  const field = () => screen.getByRole("textbox", { name: "Design name" }) as HTMLInputElement;

  it("starts with the current name selected", async () => {
    await mount("Old name");
    expect(field().value).toBe("Old name");
    expect(document.activeElement).toBe(field());
    expect(field().selectionStart).toBe(0);
    expect(field().selectionEnd).toBe("Old name".length);
    expect(field().maxLength).toBe(120);
  });

  it("renames the design with the Rename button", async () => {
    const onClose = vi.fn();
    await mount("Before", onClose);
    const user = userEvent.setup({ delay: null });
    await user.clear(field());
    await user.type(field(), "After");
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(storeDesign().title).toBe("After");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renames the design when Enter is pressed in the field", async () => {
    const onClose = vi.fn();
    await mount("Before", onClose);
    const user = userEvent.setup({ delay: null });
    await user.clear(field());
    await user.type(field(), "  Entered  {Enter}");
    expect(storeDesign().title).toBe("Entered");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("falls back to 'Untitled design' for an empty name", async () => {
    await mount("Before");
    const user = userEvent.setup({ delay: null });
    await user.clear(field());
    await user.click(screen.getByRole("button", { name: "Rename" }));
    expect(storeDesign().title).toBe("Untitled design");
  });

  it("leaves the name alone on Cancel", async () => {
    const onClose = vi.fn();
    await mount("Unchanged", onClose);
    const user = userEvent.setup({ delay: null });
    await user.clear(field());
    await user.type(field(), "Thrown away");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(storeDesign().title).toBe("Unchanged");
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("<ShareDialog>", () => {
  it("holds the share panel and passes its close request on", async () => {
    const onClose = vi.fn();
    await renderChrome(<ShareDialog open onClose={onClose} />, chromeDesign("Share dialog"));
    const dialog = screen.getByRole("dialog", { name: "Share design" });
    expect(within(dialog).getByRole("heading", { name: "Share design" })).toBeTruthy();
    await userEvent.setup({ delay: null }).click(within(dialog).getByRole("button", { name: "Present" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(useEditor.getState().presenting).toBe(true);
  });
});

describe("<NewDesignRedirect>", () => {
  it("closes itself and sends the person to the home page's create dialog", async () => {
    window.location.hash = "#/design/abc";
    const onClose = vi.fn();
    const { container } = await renderChrome(<NewDesignRedirect onClose={onClose} />, chromeDesign("Redirect"));
    expect(container.firstChild).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(sessionStorage.getItem("craftly:open-create")).toBe("1");
    expect(window.location.hash).toBe("#/");
    act(() => actions().closeDialog());
  });
});
