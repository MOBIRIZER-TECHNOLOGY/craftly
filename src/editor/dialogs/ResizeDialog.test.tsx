import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { duplicateDesign, getDesign, listDesigns } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { chromeDesign, clearToasts, nextFrame, renderChrome, storeDesign } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { installAutosave } from "@/editor/autosave";
import { ResizeDialog } from "./ResizeDialog";

// The real library, except that a test can make the copy fail or wait.
vi.mock("@/core/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library")>();
  return { ...actual, duplicateDesign: vi.fn(actual.duplicateDesign) };
});

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  vi.mocked(duplicateDesign).mockClear();
});

afterEach(async () => {
  resetEditor();
  await clearToasts();
});

/** The dialog on a 1280 x 720 px design whose first page has a 300 x 200 box at (100, 300). */
const mount = (onClose = vi.fn(), design: Design = chromeDesign("Resize me")) => renderChrome(<ResizeDialog open onClose={onClose} />, design);
const field = (name: "Width" | "Height") => screen.getByRole("spinbutton", { name }) as HTMLInputElement;
const type = async (user: ReturnType<typeof userEvent.setup>, name: "Width" | "Height", text: string) => {
  await user.clear(field(name));
  await nextFrame(); // the field selects its text one frame after it got the focus
  await user.type(field(name), `${text}{Enter}`);
};
const fact = (name: string) => screen.getByText(name, { selector: "dt" }).nextElementSibling!.textContent;
const preset = (name: RegExp) => screen.getByRole("button", { name });
const resizeButton = () => screen.getByRole("button", { name: "Resize" });
const copyButton = () => screen.getByRole("button", { name: "Make a copy and resize" });
const isDisabled = (el: HTMLElement) => (el as HTMLButtonElement).disabled || el.getAttribute("aria-disabled") === "true";
const chooseUnit = async (user: ReturnType<typeof userEvent.setup>, unit: string) => {
  await user.click(screen.getByRole("combobox", { name: "Units" }));
  await user.click(screen.getByRole("option", { name: unit }));
};
const firstBox = () => storeDesign().pages[0].elements.find((e) => e.type === "shape")!;

describe("<ResizeDialog>: what it shows", () => {
  it("offers the formats grouped by kind of design", async () => {
    await mount();
    const formats = screen.getByRole("region", { name: "Formats" });
    const groups = within(formats)
      .getAllByRole("group")
      .map((g) => g.getAttribute("aria-label"));
    expect(groups).toEqual(["Presentations", "Social media", "Printables", "Docs", "Marketing", "Branding"]);
    const social = within(formats).getByRole("group", { name: "Social media" });
    expect(within(social).getByRole("button", { name: /^Instagram Post \(4:5\)\s*1080 × 1350 px$/ })).toBeTruthy();
    expect(within(formats).getByRole("group", { name: "Printables" }).textContent).toContain("8.5 × 11 in");
  });

  it("starts at the size of the design with nothing to apply", async () => {
    await mount();
    expect(field("Width").value).toBe("1280");
    expect(field("Height").value).toBe("720");
    expect(fact("Current")).toBe("1280 × 720 px");
    expect(fact("New")).toBe("1280 × 720 px");
    expect(screen.queryByText("In pixels")).toBeNull();
    expect(isDisabled(resizeButton())).toBe(true);
    expect(isDisabled(copyButton())).toBe(true);
    expect(screen.getByText("Sizes can be between 40 and 8000 px on each side.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock aspect ratio" }).getAttribute("aria-pressed")).toBe("true");
  });

  it("renders nothing when no design is open", () => {
    const { container } = render(<ResizeDialog open onClose={vi.fn()} />);
    expect(container.firstChild).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("<ResizeDialog>: the custom size", () => {
  it("keeps the proportions while the width is typed", async () => {
    await mount();
    await type(userEvent.setup({ delay: null }), "Width", "1000");
    expect(field("Width").value).toBe("1000");
    expect(field("Height").value).toBe("563");
    expect(fact("New")).toBe("1000 × 563 px");
    expect(isDisabled(resizeButton())).toBe(false);
    expect(isDisabled(copyButton())).toBe(false);
  });

  it("keeps the proportions while the height is typed", async () => {
    await mount();
    await type(userEvent.setup({ delay: null }), "Height", "360");
    expect(field("Width").value).toBe("640");
    expect(fact("New")).toBe("640 × 360 px");
  });

  it("changes one side alone when the proportions are unlocked", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Unlock aspect ratio" }));
    expect(screen.getByRole("button", { name: "Lock aspect ratio" }).getAttribute("aria-pressed")).toBe("false");
    await type(user, "Width", "1000");
    expect(field("Height").value).toBe("720");
    await type(user, "Height", "300");
    expect(field("Width").value).toBe("1000");
    expect(fact("New")).toBe("1000 × 300 px");
  });

  it("locks again at the proportions of the size it has been given", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Unlock aspect ratio" }));
    await type(user, "Width", "800");
    await type(user, "Height", "400");
    await user.click(screen.getByRole("button", { name: "Lock aspect ratio" }));
    await type(user, "Width", "600");
    expect(field("Height").value).toBe("300");
  });

  it("keeps each side between 40 and 8000 pixels", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Unlock aspect ratio" }));
    await type(user, "Width", "5");
    expect(field("Width").value).toBe("40");
    await type(user, "Width", "99999");
    expect(field("Width").value).toBe("8000");
    expect(fact("New")).toBe("8000 × 720 px");
  });

  it("checks a side while it is typed, before the field is left (B8)", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const alert = () => screen.queryByRole("alert")?.textContent ?? null;
    await user.clear(field("Width"));
    await nextFrame();
    await user.type(field("Width"), "9000");
    expect(document.activeElement).toBe(field("Width"));
    expect(alert()).toBe("Width must be between 40 and 8000 px.");
    expect(isDisabled(resizeButton())).toBe(true);
    expect(isDisabled(copyButton())).toBe(true);
    // "2" may still become "200": no message, but nothing to apply yet
    await user.clear(field("Width"));
    await user.type(field("Width"), "2");
    expect(alert()).toBeNull();
    expect(isDisabled(resizeButton())).toBe(true);
    await user.type(field("Width"), "00");
    expect(alert()).toBeNull();
    await user.clear(field("Width"));
    await user.type(field("Width"), "abc");
    expect(alert()).toBe("Width must be between 40 and 8000 px.");
    expect(isDisabled(resizeButton())).toBe(true);
    // Enter commits: the text was no number, so the size is as it was
    await user.keyboard("{Enter}");
    expect(alert()).toBeNull();
    expect(field("Width").value).toBe("1280");
  });

  it("shows a typed side under New as soon as it is a size, before the field is left", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.clear(field("Width"));
    await nextFrame();
    await user.type(field("Width"), "6");
    // "6" may still become "640": New keeps the size it had
    expect(fact("New")).toBe("1280 × 720 px");
    await user.type(field("Width"), "40");
    expect(document.activeElement).toBe(field("Width"));
    // the proportions are locked: the height follows as it will on Enter
    expect(fact("New")).toBe("640 × 360 px");
    await user.click(screen.getByRole("button", { name: "Unlock aspect ratio" }));
    await user.clear(field("Height"));
    await nextFrame();
    await user.type(field("Height"), "500");
    expect(fact("New")).toBe("640 × 500 px");
  });

  it("clamps the other side too when the proportions would take it outside the limits", async () => {
    await mount();
    await type(userEvent.setup({ delay: null }), "Width", "8000");
    expect(field("Height").value).toBe("4500");
    await type(userEvent.setup({ delay: null }), "Height", "40");
    expect(field("Width").value).toBe("71");
  });

  it("is back to nothing to apply when the original size is typed again", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await type(user, "Width", "1000");
    await type(user, "Width", "1280");
    expect(fact("New")).toBe("1280 × 720 px");
    expect(isDisabled(resizeButton())).toBe(true);
  });

  it("explains what happens to the content", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    const scale = screen.getByRole("checkbox", { name: "Scale content to fit" }) as HTMLInputElement;
    expect(scale.checked).toBe(true);
    expect(screen.getByText("Everything is scaled to fit the new size and centred on each page.")).toBeTruthy();
    await user.click(scale);
    expect(scale.checked).toBe(false);
    expect(screen.getByText("Everything stays where it is; the page grows or crops around it.")).toBeTruthy();
  });
});

describe("<ResizeDialog>: units", () => {
  it.each([
    ["in", "13.33", "7.50", "13.33 × 7.5 in"],
    ["mm", "338.7", "190.5", "338.7 × 190.5 mm"],
    ["cm", "33.87", "19.05", "33.87 × 19.05 cm"],
  ])("shows the size in %s", async (unit, width, height, described) => {
    await mount();
    await chooseUnit(userEvent.setup({ delay: null }), unit);
    expect(field("Width").value).toBe(width);
    expect(field("Height").value).toBe(height);
    expect(fact("New")).toBe(described);
    expect(fact("In pixels")).toBe("1280 × 720 px");
    // the size itself has not changed
    expect(isDisabled(resizeButton())).toBe(true);
  });

  it("converts a size typed in inches to pixels", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await chooseUnit(user, "in");
    await type(user, "Width", "10");
    expect(field("Height").value).toBe("5.63");
    expect(fact("New")).toBe("10 × 5.63 in");
    expect(fact("In pixels")).toBe("960 × 540 px");
  });

  it("goes back to pixels", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await chooseUnit(user, "cm");
    await chooseUnit(user, "px");
    expect(field("Width").value).toBe("1280");
    expect(screen.queryByText("In pixels")).toBeNull();
  });
});

describe("<ResizeDialog>: formats", () => {
  it("fills in the size and the proportions of a format", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(preset(/^Instagram Post \(4:5\)/));
    expect(preset(/^Instagram Post \(4:5\)/).getAttribute("aria-pressed")).toBe("true");
    expect(field("Width").value).toBe("1080");
    expect(field("Height").value).toBe("1350");
    expect(fact("New")).toBe("1080 × 1350 px");
    // the proportions are those of the format now
    await type(user, "Width", "540");
    expect(field("Height").value).toBe("675");
    expect(preset(/^Instagram Post \(4:5\)/).getAttribute("aria-pressed")).toBe("false");
  });

  it("uses the unit of a print format", async () => {
    await mount();
    await userEvent.setup({ delay: null }).click(preset(/^Poster \(18 × 24 in\)/));
    expect(field("Width").value).toBe("18.00");
    expect(field("Height").value).toBe("24.00");
    expect(fact("New")).toBe("18 × 24 in");
    expect(fact("In pixels")).toBe("1728 × 2304 px");
    expect(screen.getByRole("combobox", { name: "Units" }).textContent).toContain("in");
  });

  it("marks only the format that was picked last", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(preset(/^Logo/));
    await user.click(preset(/^Web Banner/));
    expect(preset(/^Logo/).getAttribute("aria-pressed")).toBe("false");
    expect(preset(/^Web Banner/).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("<ResizeDialog>: resizing this design", () => {
  it("resizes, scales the content to fit and closes", async () => {
    const onClose = vi.fn();
    await mount(onClose);
    const user = userEvent.setup({ delay: null });
    await type(user, "Width", "640");
    await user.click(resizeButton());
    expect(onClose).toHaveBeenCalledTimes(1);
    const design = storeDesign();
    expect([design.width, design.height]).toEqual([640, 360]);
    expect(design.typeId).toBe("custom");
    const box = firstBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([50, 150, 150, 100]);
    expect(await screen.findByText("Resized to 640 × 360 px")).toBeTruthy();
    // one step in the history
    act(() => useEditor.getState().actions.undo());
    expect([storeDesign().width, storeDesign().height]).toEqual([1280, 720]);
  });

  it("leaves the content where it is when it is not scaled", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("checkbox", { name: "Scale content to fit" }));
    await type(user, "Width", "640");
    await user.click(resizeButton());
    const box = firstBox();
    expect([box.x, box.y, box.width, box.height]).toEqual([100, 300, 300, 200]);
    expect(storeDesign().width).toBe(640);
  });

  it("stores the unit the size was given in", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(preset(/^Flyer \(US Letter\)/));
    await user.click(resizeButton());
    const design = storeDesign();
    expect([design.width, design.height, design.unit]).toEqual([816, 1056, "in"]);
    expect(await screen.findByText("Resized to 8.5 × 11 in")).toBeTruthy();
  });

  it("changes nothing on Cancel", async () => {
    const onClose = vi.fn();
    await mount(onClose);
    const user = userEvent.setup({ delay: null });
    await type(user, "Width", "640");
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(storeDesign().width).toBe(1280);
  });
});

describe("<ResizeDialog>: resizing a copy", () => {
  it("makes a resized copy, leaves the original alone and opens the copy", async () => {
    const onClose = vi.fn();
    const { design } = await mount(onClose, chromeDesign("Copy me"));
    const user = userEvent.setup({ delay: null });
    const stop = installAutosave();
    act(() => useEditor.getState().actions.setTitle("Copy me, edited"));
    await type(user, "Width", "640");
    await user.click(copyButton());
    try {
      expect(await screen.findByText("Resized copy created (640 × 360 px)")).toBeTruthy();
    } finally {
      stop();
    }
    expect(onClose).toHaveBeenCalledTimes(1);

    const all = await listDesigns();
    expect(all).toHaveLength(2);
    const summary = all.find((d) => d.id !== design.id)!;
    expect(summary.title).toBe("Copy me, edited (copy)");
    expect([summary.width, summary.height]).toEqual([640, 360]);
    expect(summary.thumbnail).toMatch(/^data:image\/jpeg/);
    const copy = (await getDesign(summary.id))!;
    expect(copy.typeId).toBe("custom");
    const box = copy.pages[0].elements.find((e) => e.type === "shape")!;
    expect([box.x, box.y, box.width, box.height]).toEqual([50, 150, 150, 100]);
    expect(window.location.hash).toBe(`#/design/${encodeURIComponent(copy.id)}`);
    // the open design is untouched
    expect([storeDesign().width, storeDesign().height]).toEqual([1280, 720]);
    expect((await getDesign(design.id))?.width).toBe(1280);
  });

  it("gives the copy the unit the size was chosen in, like resizing this design does", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    await user.click(preset(/^Flyer \(US Letter\)/));
    await user.click(copyButton());
    expect(await screen.findByText("Resized copy created (8.5 × 11 in)")).toBeTruthy();
    const summary = (await listDesigns()).find((d) => d.id !== design.id)!;
    const copy = (await getDesign(summary.id))!;
    expect([copy.width, copy.height, copy.unit]).toEqual([816, 1056, "in"]);
    expect(storeDesign().unit).toBe("px");
  });

  it("shows that it is working and cannot be started twice", async () => {
    let finish: (value: Design | null) => void = () => undefined;
    vi.mocked(duplicateDesign).mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    await mount();
    const user = userEvent.setup({ delay: null });
    await type(user, "Width", "640");
    await user.click(copyButton());
    await waitFor(() => expect(copyButton().getAttribute("aria-busy")).toBe("true"));
    expect(isDisabled(resizeButton())).toBe(true);
    await act(async () => finish(null));
    await waitFor(() => expect(copyButton().getAttribute("aria-busy")).toBeNull());
  });

  it("explains when the copy could not be made", async () => {
    const onClose = vi.fn();
    await mount(onClose);
    vi.mocked(duplicateDesign).mockResolvedValueOnce(null);
    const user = userEvent.setup({ delay: null });
    window.location.hash = "#/design/stay";
    await type(user, "Width", "640");
    await user.click(copyButton());
    expect(await screen.findByText(/Couldn't make the resized copy/)).toBeTruthy();
    expect(onClose).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("#/design/stay");
    expect(await listDesigns()).toHaveLength(1);
    await waitFor(() => expect(isDisabled(copyButton())).toBe(false));
  });

  it("still makes the copy when its thumbnail cannot be drawn", async () => {
    const { design } = await mount();
    const user = userEvent.setup({ delay: null });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(() => {
      throw new Error("tainted canvas");
    });
    await type(user, "Width", "640");
    await user.click(copyButton());
    expect(await screen.findByText("Resized copy created (640 × 360 px)")).toBeTruthy();
    const all = await listDesigns();
    expect(all).toHaveLength(2);
    expect(all.find((d) => d.id !== design.id)?.thumbnail).toBeUndefined();
  });

  it("does nothing when the design was closed in the meantime", async () => {
    await mount();
    const user = userEvent.setup({ delay: null });
    await type(user, "Width", "640");
    act(() => useEditor.getState().actions.closeDesign());
    await user.click(copyButton());
    expect(vi.mocked(duplicateDesign)).not.toHaveBeenCalled();
    expect(await listDesigns()).toHaveLength(1);
  });
});
