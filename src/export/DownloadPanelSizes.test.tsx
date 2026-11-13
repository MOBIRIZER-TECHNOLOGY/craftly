import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import { saveDesign } from "@/core/library";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { toast } from "@/ui";
import { DownloadPanel } from "./DownloadPanel";
import { ExportError } from "./errors";
import { downloadBlob, exportDesign, type ExportFile } from "./exporters";
import { DEFAULT_DOWNLOAD_SETTINGS, DOWNLOAD_SETTINGS_KEY } from "./settings";
import { openZip } from "./zipRead";

// The exporter of one size is replaced; the loop over the sizes (multiSize.ts) is the real one.
vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn(), downloadBlob: vi.fn() };
});
vi.mock("@/core/library", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/core/library")>();
  return { ...actual, saveDesign: vi.fn(actual.saveDesign) };
});

const pageOf = () => createPage({ background: solid("#ffffff"), elements: [createShape("rect", { x: 10, y: 10, width: 40, height: 40 })] });
const designOf = (pageCount = 3, init: Partial<Pick<Design, "width" | "height" | "typeId">> = {}): Design =>
  createDesign({ title: "Menu", width: 400, height: 300, ...init, pages: Array.from({ length: pageCount }, pageOf) });

function mountPanel(design: Design = designOf(), props: { onDone?: () => void } = {}) {
  resetEditor();
  useEditor.getState().actions.openDesign(design);
  return render(<DownloadPanel {...props} />);
}

const store = (patch: Record<string, unknown>) => window.localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_DOWNLOAD_SETTINGS, ...patch }));
const fileType = () => screen.getByRole("combobox", { name: "File type" });
const downloadButton = () => screen.getByRole("button", { name: /^Download/ }) as HTMLButtonElement;
const sizes = () => screen.getByRole("group", { name: "Sizes to download" });
const size = (name: RegExp) => within(sizes()).getByRole("checkbox", { name }) as HTMLInputElement;
const ticked = () =>
  within(sizes())
    .getAllByRole("checkbox")
    .filter((box) => (box as HTMLInputElement).checked);

async function chooseSeveralSizes(user: ReturnType<typeof userEvent.setup>) {
  await user.click(fileType());
  await user.click(screen.getByRole("option", { name: /^Several sizes/ }));
}

const made = (): ExportFile => ({ name: "one.png", blob: new Blob(["x"]) });

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(exportDesign).mockReset();
  vi.mocked(exportDesign).mockImplementation(async () => made());
  vi.mocked(downloadBlob).mockReset();
  vi.mocked(saveDesign).mockClear();
  vi.spyOn(toast, "show").mockImplementation(() => 0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetEditor();
});

describe("<DownloadPanel> several sizes: choosing", () => {
  it("ticks the size of the design and three formats of its family to begin with, each with its size in pixels", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseSeveralSizes(user);
    expect(fileType().textContent).toContain("Several sizes");
    expect(ticked().map((box) => box.closest("label")?.textContent)).toEqual([
      "Original size (this design)400 × 300 px",
      "Instagram Post (4:5)1080 × 1350 px",
      "Facebook Post940 × 788 px",
      "YouTube Thumbnail1280 × 720 px",
    ]);
    expect(size(/^Instagram Story/).checked).toBe(false);
    expect(screen.getByText("4 of 10")).toBeTruthy();
    // what belongs to one picture format is not shown
    expect(screen.queryByRole("slider", { name: "Size" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Transparent background" })).toBeNull();
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/^Estimated size ~\d.* · 12 files$/);
  });

  it("names the size of a design that is a format by that format", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(1, { width: 1080, height: 1920, typeId: "instagram-story" }));
    await chooseSeveralSizes(user);
    expect(size(/^Instagram Story \(this design\)/).checked).toBe(true);
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/ · 4 files$/);
    // one page at one size is one file, still in an archive
    for (const box of ticked().slice(1)) await user.click(box);
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/ · 1 file$/);
    // one page: nothing says that pages are saved together
    expect(screen.queryByText(/saved together/)).toBeNull();
  });

  it("lets sizes be ticked and unticked, and will not start with none", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseSeveralSizes(user);
    await user.click(size(/^Instagram Story/));
    expect(screen.getByText("5 of 10")).toBeTruthy();
    for (const box of ticked()) await user.click(box);
    expect(screen.getByText("0 of 10")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("Tick at least one size.");
    expect(downloadButton().disabled).toBe(true);
    await user.click(downloadButton());
    expect(exportDesign).not.toHaveBeenCalled();
  });

  it("says that ten sizes are the most, and will not start with more", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(1));
    await chooseSeveralSizes(user);
    const boxes = within(sizes()).getAllByRole("checkbox") as HTMLInputElement[];
    for (const box of boxes.slice(0, 11)) if (!box.checked) await user.click(box);
    expect(screen.getByText("11 of 10")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe("11 sizes are ticked; one download holds 10 at most.");
    expect(downloadButton().disabled).toBe(true);
  });

  it("says when the sizes and pages together are more pixels than one download holds", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(60));
    await chooseSeveralSizes(user);
    expect(screen.queryByRole("alert")).toBeNull();
    await user.click(size(/^YouTube Banner/));
    expect(screen.getByRole("alert").textContent).toMatch(/^That is \d+ million pixels in all; one download holds 250 million\. Choose fewer sizes or fewer pages\.$/);
    expect(downloadButton().disabled).toBe(true);
    // fewer pages is one of the two ways out
    await user.click(within(screen.getByRole("radiogroup", { name: "Pages to download" })).getByRole("radio", { name: "Current page" }));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(downloadButton().disabled).toBe(false);
  });

  it("asks for a page, once, when none is chosen", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseSeveralSizes(user);
    await user.click(within(screen.getByRole("radiogroup", { name: "Pages to download" })).getByRole("radio", { name: "Custom" }));
    await user.click(screen.getByRole("button", { name: "Select none" }));
    expect(screen.getByText("Select at least one page to download.")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(downloadButton().disabled).toBe(true);
  });

  it("goes back to one kind of file with everything that belongs to it", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseSeveralSizes(user);
    await user.click(fileType());
    await user.click(screen.getByRole("option", { name: /^JPG/ }));
    expect(screen.queryByRole("group", { name: "Sizes to download" })).toBeNull();
    expect(screen.getByRole("slider", { name: "Quality" })).toBeTruthy();
    await user.click(downloadButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledWith(expect.any(Blob), "one.png"));
    expect(exportDesign).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exportDesign).mock.calls[0][1]).toMatchObject({ format: "jpg", pages: [0, 1, 2] });
  });
});

describe("<DownloadPanel> several sizes: downloading", () => {
  it("downloads one archive with every page at every ticked size", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    mountPanel(designOf(2), { onDone });
    await chooseSeveralSizes(user);
    await user.click(downloadButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
    expect(name).toBe("Menu - 4 sizes.zip");
    expect((await openZip(blob)).entries.map((e) => e.name)).toEqual([
      "Menu - Original size 400x300 - 1.png",
      "Menu - Original size 400x300 - 2.png",
      "Menu - Instagram Post (4 5) 1080x1350 - 1.png",
      "Menu - Instagram Post (4 5) 1080x1350 - 2.png",
      "Menu - Facebook Post 940x788 - 1.png",
      "Menu - Facebook Post 940x788 - 2.png",
      "Menu - YouTube Thumbnail 1280x720 - 1.png",
      "Menu - YouTube Thumbnail 1280x720 - 2.png",
    ]);
    expect(vi.mocked(exportDesign).mock.calls.map(([d]) => `${d.width}x${d.height}`)).toEqual([
      "400x300",
      "400x300",
      "1080x1350",
      "1080x1350",
      "940x788",
      "940x788",
      "1280x720",
      "1280x720",
    ]);
    expect(toast.show).toHaveBeenCalledWith({ kind: "success", message: "Downloaded Menu - 4 sizes.zip" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("works on copies: the open design, its undo history and the library stay exactly as they were", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(2));
    // one step to undo, so there is a history to lose
    act(() => useEditor.getState().actions.resizeDesign(500, 300, true, "px"));
    const before = useEditor.getState();
    const text = JSON.stringify(before.design);
    expect(before.past.length).toBe(1);
    await chooseSeveralSizes(user);
    await user.click(downloadButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    const after = useEditor.getState();
    expect(after.design).toBe(before.design);
    expect(JSON.stringify(after.design)).toBe(text);
    expect(after.past).toBe(before.past);
    expect(after.future).toBe(before.future);
    for (const [given] of vi.mocked(exportDesign).mock.calls) expect(given).not.toBe(before.design);
    expect(saveDesign).not.toHaveBeenCalled();
  });

  it("makes JPGs with the quality that was last chosen, or one PDF for each size", async () => {
    store({ quality: 0.5 });
    const user = userEvent.setup();
    mountPanel(designOf(2));
    await chooseSeveralSizes(user);
    await user.click(within(screen.getByRole("radiogroup", { name: "Format of each size" })).getByRole("radio", { name: "JPG" }));
    await user.click(downloadButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
    expect(vi.mocked(exportDesign).mock.calls[0][1]).toMatchObject({ format: "jpg", quality: 0.5, scale: 1, pages: [0] });

    vi.mocked(exportDesign).mockClear();
    await user.click(within(screen.getByRole("radiogroup", { name: "Format of each size" })).getByRole("radio", { name: "PDF" }));
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/ · 4 files$/);
    await user.click(downloadButton());
    await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(2));
    expect(exportDesign).toHaveBeenCalledTimes(4);
    expect(vi.mocked(exportDesign).mock.calls[0][1]).toMatchObject({ format: "pdf", pages: [0, 1] });
  });

  it("shows how far it has got, locks the choices, and stops when Cancel is pressed", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(2));
    await chooseSeveralSizes(user);
    let finishFirst: (file: ExportFile) => void = () => undefined;
    vi.mocked(exportDesign).mockImplementationOnce(() => new Promise<ExportFile>((resolve) => (finishFirst = resolve)));
    vi.mocked(exportDesign).mockImplementationOnce(() => new Promise<ExportFile>(() => undefined));
    await user.click(downloadButton());
    expect(screen.getByRole("status").textContent).toBe("Rendering picture 1 of 8…");
    expect(size(/^Instagram Story/).disabled).toBe(true);
    await act(async () => finishFirst(made()));
    await waitFor(() => expect(screen.getByRole("status").textContent).toBe("Rendering picture 2 of 8…"));
    expect(screen.getByRole("progressbar", { name: "Download progress" }).getAttribute("aria-valuenow")).toBe("1");

    // the second picture never finishes by itself: the exporter is told to stop through its signal
    const signal = vi.mocked(exportDesign).mock.calls[1][3] as AbortSignal;
    vi.mocked(exportDesign).mockImplementation(async () => made());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(signal.aborted).toBe(true);
  });

  it("says that the download was cancelled, and downloads nothing", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(2));
    await chooseSeveralSizes(user);
    let finishFirst: (file: ExportFile) => void = () => undefined;
    vi.mocked(exportDesign).mockImplementationOnce(() => new Promise<ExportFile>((resolve) => (finishFirst = resolve)));
    await user.click(downloadButton());
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => finishFirst(made()));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "info", message: "Download cancelled" }));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(exportDesign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("progressbar")).toBeNull();
    expect(downloadButton().disabled).toBe(false);
  });

  it("says what went wrong in the exporter's words, without a size multiplier that was not used", async () => {
    store({ scale: 4 });
    const user = userEvent.setup();
    mountPanel(designOf(1));
    await chooseSeveralSizes(user);
    vi.mocked(exportDesign).mockRejectedValueOnce(new ExportError("too-large", "This design is too large to export at this size - try a smaller size."));
    await user.click(downloadButton());
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "error", message: "This design is too large to export at this size - try a smaller size." }));
    expect(downloadBlob).not.toHaveBeenCalled();
  });

  it("passes on what the exporter had to tell about the files", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(1));
    await chooseSeveralSizes(user);
    vi.mocked(exportDesign).mockImplementation(async () => ({ ...made(), note: "An image could not be loaded." }));
    await user.click(downloadButton());
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "info", message: "An image could not be loaded.", duration: 9000 }));
  });
});
