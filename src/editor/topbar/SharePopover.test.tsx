import { act, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useEditor } from "@/core/store";
import { chromeDesign, renderChrome } from "@/test/chromeUtils";
import { clearLibrary, resetEditor } from "@/test/helpers";
import { copyPageAsImage, printDesign, saveProjectFile } from "./designActions";
import { SharePanel, SharePopover } from "./SharePopover";
import { applySession } from "@/cloud/state";
import { getSummary, saveDesign } from "@/core/library";

// The actions have their own tests (designActions.test.tsx): here only the wiring of the tiles is checked.
vi.mock("./designActions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./designActions")>();
  return { ...actual, saveProjectFile: vi.fn(), printDesign: vi.fn(), copyPageAsImage: vi.fn() };
});

const shareButton = () => screen.getByRole("button", { name: "Share" });
const popover = () => screen.getByRole("dialog", { name: "Share design" });
const tile = (name: string) => within(popover()).getByRole("button", { name });

beforeEach(async () => {
  resetEditor();
  await clearLibrary();
  vi.mocked(saveProjectFile).mockReset();
  vi.mocked(printDesign).mockReset();
  vi.mocked(copyPageAsImage).mockReset();
});

afterEach(() => resetEditor());

describe("<SharePopover>", () => {
  it("opens from the Share button and offers what can be done with the design", async () => {
    await renderChrome(<SharePopover />, chromeDesign("Share me"));
    const user = userEvent.setup({ delay: null });
    expect(shareButton().getAttribute("aria-haspopup")).toBe("dialog");
    expect(screen.queryByRole("dialog", { name: "Share design" })).toBeNull();
    await user.click(shareButton());
    expect(shareButton().getAttribute("aria-expanded")).toBe("true");
    expect(within(popover()).getByRole("heading", { name: "Share design" })).toBeTruthy();
    const labels = within(popover())
      .getAllByRole("button")
      .map((b) => b.textContent);
    expect(labels).toEqual(["Download", "Present", "Save project file", "Print", "Copy as image", "Start live session"]);
    expect(within(popover()).getByText(/Craftly keeps your designs on this device/)).toBeTruthy();
  });

  it("closes with Escape and with a second click on Share", async () => {
    await renderChrome(<SharePopover />, chromeDesign("Close share"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog", { name: "Share design" })).toBeNull();
    await user.click(shareButton());
    await user.click(shareButton());
    expect(screen.queryByRole("dialog", { name: "Share design" })).toBeNull();
  });

  it("starts the presentation and gets out of the way", async () => {
    await renderChrome(<SharePopover />, chromeDesign("Present from share"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    await user.click(tile("Present"));
    expect(useEditor.getState().presenting).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Share design" })).toBeNull();
  });

  it("prints and gets out of the way", async () => {
    await renderChrome(<SharePopover />, chromeDesign("Print from share"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    await user.click(tile("Print"));
    expect(printDesign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog", { name: "Share design" })).toBeNull();
  });

  it("shows the project file tile as busy while the file is made", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(saveProjectFile).mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await renderChrome(<SharePopover />, chromeDesign("Project file"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    await user.click(tile("Save project file"));
    expect(saveProjectFile).toHaveBeenCalledTimes(1);
    expect(tile("Save project file").getAttribute("aria-busy")).toBe("true");
    expect((tile("Save project file") as HTMLButtonElement).disabled).toBe(true);
    // the other tiles stay usable
    expect((tile("Copy as image") as HTMLButtonElement).disabled).toBe(false);
    await act(async () => finish());
    await waitFor(() => expect(tile("Save project file").getAttribute("aria-busy")).toBeNull());
    expect((tile("Save project file") as HTMLButtonElement).disabled).toBe(false);
    // the panel stays open so the person can do something else
    expect(popover()).toBeTruthy();
  });

  it("shows the copy tile as busy while the page is copied", async () => {
    let finish: () => void = () => undefined;
    vi.mocked(copyPageAsImage).mockReturnValue(new Promise<void>((resolve) => (finish = resolve)));
    await renderChrome(<SharePopover />, chromeDesign("Copy image"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    await user.click(tile("Copy as image"));
    expect(copyPageAsImage).toHaveBeenCalledTimes(1);
    expect(tile("Copy as image").getAttribute("aria-busy")).toBe("true");
    await act(async () => finish());
    await waitFor(() => expect(tile("Copy as image").getAttribute("aria-busy")).toBeNull());
  });

  it("adds no banner landmark of its own, in either view: the design toolbar stays the one banner of the page", async () => {
    await renderChrome(<SharePopover />, chromeDesign("No second banner"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    expect(within(popover()).queryAllByRole("banner")).toHaveLength(0);
    await user.click(tile("Download"));
    expect(within(popover()).queryAllByRole("banner")).toHaveLength(0);
  });

  it("swaps to the download options and back", async () => {
    await renderChrome(<SharePopover />, chromeDesign("Download from share"));
    const user = userEvent.setup({ delay: null });
    await user.click(shareButton());
    await user.click(tile("Download"));
    expect(within(popover()).getByRole("heading", { name: "Download" })).toBeTruthy();
    expect(within(popover()).getByRole("region", { name: "Download" })).toBeTruthy();
    expect(within(popover()).getByRole("combobox", { name: "File type" })).toBeTruthy();
    await user.click(within(popover()).getByRole("button", { name: "Back to share" }));
    expect(within(popover()).getByRole("heading", { name: "Share design" })).toBeTruthy();
  });
});

describe("<SharePanel> for a design of a team's space (B11)", () => {
  const ANN = { id: "user_ann_0000000000001", email: "ann@example.org", name: "Ann Lee" };
  const TEAM = { id: "team_studio_000000001", name: "Studio", role: "editor" as const };
  afterEach(() => act(() => applySession(null)));

  /** a design saved in the library while `space` is the space the dashboard shows: its record is in that space */
  const savedIn = async (space: string, title: string) => {
    act(() => applySession({ server: "https://accounts.example.org", token: "T".repeat(43), user: ANN, device: "Test", teams: [TEAM], activeSpace: space }));
    const design = chromeDesign(title);
    await saveDesign(design);
    expect((await getSummary(design.id))?.space).toBe(space);
    return design;
  };

  it("says the design is synced to the team's server, not kept on this device", async () => {
    await renderChrome(<SharePanel onClose={() => undefined} />, await savedIn(TEAM.id, "Team poster"));
    expect(await screen.findByText(/^This design belongs to Studio and is synced to the team's server/)).toBeTruthy();
    expect(screen.queryByText(/Craftly keeps your designs on this device/)).toBeNull();
  });

  it("still says on this device for a design of the person's own space", async () => {
    await renderChrome(<SharePanel onClose={() => undefined} />, await savedIn(ANN.id, "My poster"));
    await act(async () => new Promise((r) => setTimeout(r, 50)));
    expect(screen.getByText(/Craftly keeps your designs on this device/)).toBeTruthy();
  });
});

describe("<SharePanel>", () => {
  it("reports that it wants to close when a tile that leaves the panel is used", async () => {
    const onClose = vi.fn();
    await renderChrome(<SharePanel onClose={onClose} />, chromeDesign("Panel"));
    const user = userEvent.setup({ delay: null });
    await user.click(screen.getByRole("button", { name: "Download" }));
    expect(onClose).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back to share" }));
    await user.click(screen.getByRole("button", { name: "Print" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
