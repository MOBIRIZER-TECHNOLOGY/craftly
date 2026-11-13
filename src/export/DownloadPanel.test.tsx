import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { toast } from "@/ui";
import { DownloadPanel } from "./DownloadPanel";
import { ExportError } from "./errors";
import { downloadBlob, exportDesign, type ExportFile } from "./exporters";
import { estimateExportBytes, resolveExportOptions } from "./options";
import { DOWNLOAD_SETTINGS_KEY, DEFAULT_DOWNLOAD_SETTINGS, toExportOptions } from "./settings";

vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn(), downloadBlob: vi.fn() };
});

/* ------------------------------------------------------------------ */

const MB = 1024 * 1024;
const pageOf = (color = "#ffffff") => createPage({ background: solid(color), elements: [createShape("rect", { x: 10, y: 10, width: 40, height: 40 })] });

function designOf(pageCount = 3, init: Partial<Pick<Design, "title" | "width" | "height">> = {}): Design {
  return createDesign({ title: "Menu", width: 400, height: 300, ...init, pages: Array.from({ length: pageCount }, (_v, i) => pageOf(i % 2 ? "#eeeeee" : "#ffffff")) });
}

function mountPanel(design: Design | null = designOf(), props: { onDone?: () => void } = {}) {
  resetEditor();
  if (design) useEditor.getState().actions.openDesign(design);
  return render(<DownloadPanel {...props} />);
}

const stored = () => JSON.parse(window.localStorage.getItem(DOWNLOAD_SETTINGS_KEY) ?? "null");
const store = (patch: Record<string, unknown>) => window.localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_DOWNLOAD_SETTINGS, ...patch }));

const fileType = () => screen.getByRole("combobox", { name: "File type" });
const downloadButton = () => screen.getByRole("button", { name: /^Download/ }) as HTMLButtonElement;
const slider = (name: string) => screen.getByRole("slider", { name });
const radio = (group: string, name: string | RegExp) => within(screen.getByRole("radiogroup", { name: group })).getByRole("radio", { name });

async function choose(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(fileType());
  await user.click(screen.getByRole("option", { name }));
}

/** An export the test finishes by hand. */
function controlledExport() {
  const control = {
    report: (_done: number, _total: number) => undefined as void,
    resolve: (_file: ExportFile) => undefined as void,
    reject: (_error: unknown) => undefined as void,
    signal: undefined as AbortSignal | undefined,
  };
  vi.mocked(exportDesign).mockImplementationOnce((_design, _options, onProgress, signal) => {
    control.report = (done, total) => onProgress?.(done, total);
    control.signal = signal;
    return new Promise<ExportFile>((resolve, reject) => {
      control.resolve = resolve;
      control.reject = reject;
    });
  });
  return control;
}

const file = (name = "Menu.zip", note?: string): ExportFile => ({ name, blob: new Blob(["x"]), note });

beforeEach(() => {
  vi.mocked(exportDesign).mockReset();
  vi.mocked(downloadBlob).mockReset();
  vi.spyOn(toast, "show").mockImplementation(() => 0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  // unmount first: resetting the store under a mounted panel would re-render it outside of act
  cleanup();
  vi.restoreAllMocks();
  resetEditor();
});

/* ------------------------------------------------------------------ */

describe("<DownloadPanel> with nothing open", () => {
  it("asks for a design to be opened", () => {
    mountPanel(null);
    expect(screen.getByText("Open a design to download it.")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /^Download/ })).toBeNull();
  });
});

describe("<DownloadPanel> choices", () => {
  it("starts with a PNG of every page at the size of the design", () => {
    mountPanel();
    expect(fileType().textContent).toContain("PNG");
    expect(slider("Size").getAttribute("aria-valuetext")).toBe("×1 · 400 × 300 px");
    expect((screen.getByRole("switch", { name: "Transparent background" }) as HTMLInputElement).checked).toBe(false);
    expect(radio("Pages to download", "All pages").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("3 pages")).toBeTruthy();
    expect(screen.getByText("Every page in this design - saved together as a .zip")).toBeTruthy();
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/^Estimated size ~\d/);
  });

  it("lists every kind of file, and offers a video only if the browser can record one", async () => {
    const user = userEvent.setup();
    mountPanel();
    await user.click(fileType());
    const names = screen.getAllByRole("option").map((o) => o.textContent);
    expect(names).toHaveLength(8);
    ["PNG", "JPG", "PDF Standard", "PDF Print", "SVG", "Animated GIF", "Video (WebM)", "Several sizes"].forEach((name, i) => expect(names[i]).toContain(name));
    const video = screen.getByRole("option", { name: /Video \(WebM\)/ });
    expect(video.getAttribute("aria-disabled")).toBe("true");
    expect(video.textContent).toContain("Not supported in this browser");
  });

  it("shows the quality of a JPG instead of the transparency of a PNG", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^JPG/);
    expect(fileType().textContent).toContain("JPG");
    expect(slider("Quality").getAttribute("aria-valuetext")).toBe("92%");
    expect(slider("Size")).toBeTruthy();
    expect(screen.queryByRole("switch", { name: "Transparent background" })).toBeNull();
    // one step is five percent
    fireEvent.keyDown(slider("Quality"), { key: "ArrowLeft" });
    expect(slider("Quality").getAttribute("aria-valuetext")).toBe("85%");
    expect(stored().quality).toBeCloseTo(0.85);
  });

  it("makes the picture bigger, or smaller, in quarter steps, and says how many pixels that is", () => {
    mountPanel();
    fireEvent.keyDown(slider("Size"), { key: "ArrowRight" });
    expect(slider("Size").getAttribute("aria-valuetext")).toBe("×1.25 · 500 × 375 px");
    fireEvent.keyDown(slider("Size"), { key: "ArrowLeft" });
    fireEvent.keyDown(slider("Size"), { key: "ArrowLeft" });
    expect(slider("Size").getAttribute("aria-valuetext")).toBe("×0.75 · 300 × 225 px");
  });

  it("says when the size had to be cut down to fit what a browser can draw", () => {
    store({ scale: 4 });
    mountPanel(designOf(1, { width: 3000, height: 2000 }));
    expect(screen.getByText("Reduced to fit 8,192 px on the longest side.")).toBeTruthy();
    expect(screen.queryByText(/Reduced to fit/)).not.toBeNull();
  });

  it("does not say so when the size fits", () => {
    mountPanel();
    expect(screen.queryByText(/Reduced to fit/)).toBeNull();
  });

  it("can make a PNG see-through", async () => {
    const user = userEvent.setup();
    mountPanel();
    await user.click(screen.getByRole("switch", { name: "Transparent background" }));
    expect(stored().transparent).toBe(true);
  });

  it("offers a digital and a print PDF, and compression", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^PDF Standard/);
    expect(fileType().textContent).toContain("PDF Standard");
    expect(radio("PDF preset", "Digital").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("Light pages for screens, email and sharing.")).toBeTruthy();
    await user.click(radio("PDF preset", "Print"));
    expect(fileType().textContent).toContain("PDF Print");
    expect(screen.getByText("300 dpi pages, sharp when printed.")).toBeTruthy();
    await user.click(screen.getByRole("switch", { name: "Compress PDF" }));
    expect(stored()).toMatchObject({ format: "pdf", pdfMode: "print", compress: true });
    // a PDF is one file whatever the number of pages
    expect(screen.getByText("Every page in this design")).toBeTruthy();
  });

  it("offers a bleed and crop marks for the print PDF only", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^PDF Standard/);
    expect(screen.queryByRole("switch", { name: "Bleed" })).toBeNull();
    expect(screen.queryByRole("switch", { name: "Crop marks" })).toBeNull();
    await user.click(radio("PDF preset", "Print"));
    const bleed = screen.getByRole("switch", { name: "Bleed" }) as HTMLInputElement;
    const marks = screen.getByRole("switch", { name: "Crop marks" }) as HTMLInputElement;
    expect([bleed.checked, marks.checked]).toEqual([false, false]);
    // the size of the bleed is asked for only when there is one
    expect(screen.queryByRole("spinbutton", { name: "Bleed size" })).toBeNull();
    // back to the PDF for screens: both are gone again
    await user.click(radio("PDF preset", "Digital"));
    expect(screen.queryByRole("switch", { name: "Bleed" })).toBeNull();
    await choose(user, /^PNG/);
    expect(screen.queryByRole("switch", { name: "Crop marks" })).toBeNull();
  });

  it("starts a bleed at 3 mm, lets it be set from 0 to 10 mm, and remembers it with the crop marks", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^PDF Print/);
    await user.click(screen.getByRole("switch", { name: "Bleed" }));
    const size = screen.getByRole("spinbutton", { name: "Bleed size" }) as HTMLInputElement;
    expect(size.value).toBe("3");
    expect([size.getAttribute("aria-valuemin"), size.getAttribute("aria-valuemax")]).toEqual(["0", "10"]);
    expect(screen.getByText(/The page background is extended 3 mm beyond every edge/)).toBeTruthy();
    await user.clear(size);
    await user.type(size, "5{Enter}");
    expect(stored()).toMatchObject({ bleed: true, bleedMm: 5, cropMarks: false });
    // more than the panel offers is brought back to 10
    await user.clear(size);
    await user.type(size, "40{Enter}");
    expect(stored().bleedMm).toBe(10);
    await user.click(screen.getByRole("switch", { name: "Crop marks" }));
    expect(stored()).toMatchObject({ bleed: true, bleedMm: 10, cropMarks: true });
    // switched off, the size is kept for the next time
    await user.click(screen.getByRole("switch", { name: "Bleed" }));
    expect(screen.queryByRole("spinbutton", { name: "Bleed size" })).toBeNull();
    expect(stored()).toMatchObject({ bleed: false, bleedMm: 10 });
  });

  it("downloads a print PDF with the bleed and the crop marks that were chosen", async () => {
    const user = userEvent.setup();
    store({ format: "pdf", pdfMode: "print", bleed: true, bleedMm: 4, cropMarks: true });
    mountPanel();
    vi.mocked(exportDesign).mockResolvedValueOnce(file("Menu.pdf"));
    await user.click(downloadButton());
    expect(vi.mocked(exportDesign).mock.calls[0][1]).toMatchObject({ format: "pdf", pdfMode: "print", bleedMm: 4, cropMarks: true });
    // the same choices do not reach a PDF for screens
    cleanup();
    store({ format: "pdf", pdfMode: "standard", bleed: true, bleedMm: 4, cropMarks: true });
    mountPanel();
    vi.mocked(exportDesign).mockResolvedValueOnce(file("Menu.pdf"));
    await user.click(downloadButton());
    expect(vi.mocked(exportDesign).mock.calls[1][1]).not.toHaveProperty("bleedMm");
  });

  it("chooses a print PDF straight from the list", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^PDF Print/);
    expect(stored()).toMatchObject({ format: "pdf", pdfMode: "print" });
    expect(radio("PDF preset", "Print").getAttribute("aria-checked")).toBe("true");
  });

  it("lets the fonts of an SVG be left out", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^SVG/);
    const embed = screen.getByRole("switch", { name: "Embed fonts" }) as HTMLInputElement;
    expect(embed.checked).toBe(true);
    await user.click(embed);
    expect(stored()).toMatchObject({ format: "svg", embedFonts: false });
    expect(screen.getByText(/relies on fonts installed on the viewing device/)).toBeTruthy();
  });
});

describe("<DownloadPanel> pages", () => {
  it("offers no choice of pages for a design of one page", () => {
    mountPanel(designOf(1));
    expect(screen.queryByRole("radiogroup", { name: "Pages to download" })).toBeNull();
    expect(screen.getByText("1 page")).toBeTruthy();
    expect(screen.queryByText(/saved together/)).toBeNull();
  });

  it("downloads just the page that is open when asked to", async () => {
    const user = userEvent.setup();
    const design = designOf(3);
    mountPanel(design);
    act(() => useEditor.setState({ activePageId: design.pages[1].id }));
    await user.click(radio("Pages to download", "Current page"));
    expect(screen.getByText("Page 2 of 3")).toBeTruthy();
    expect(screen.getByText("1 page")).toBeTruthy();
    vi.mocked(exportDesign).mockResolvedValueOnce(file("Menu.png"));
    await user.click(downloadButton());
    expect(vi.mocked(exportDesign).mock.calls[0][1].pages).toEqual([1]);
  });

  it("lets pages be ticked one by one", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(3));
    await user.click(radio("Pages to download", "Custom"));
    const grid = screen.getByRole("group", { name: "Pages to download" });
    const box = (n: number) => within(grid).getByRole("checkbox", { name: `Page ${n}` }) as HTMLInputElement;
    expect([1, 2, 3].map((n) => box(n).checked)).toEqual([true, true, true]);
    await user.click(box(2));
    expect([1, 2, 3].map((n) => box(n).checked)).toEqual([true, false, true]);
    expect(screen.getByText("2 pages")).toBeTruthy();
    await user.click(box(2));
    expect(screen.getByText("3 pages")).toBeTruthy();
  });

  it("ticks a page from its thumbnail too", async () => {
    const user = userEvent.setup();
    const { container } = mountPanel(designOf(3));
    await user.click(radio("Pages to download", "Custom"));
    fireEvent.click(container.querySelectorAll(".cf-dl__thumb")[0]);
    expect(screen.getByText("2 pages")).toBeTruthy();
  });

  it("selects all pages or none with one click, and cannot download none", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(3));
    await user.click(radio("Pages to download", "Custom"));
    const all = screen.getByRole("button", { name: "Select all" }) as HTMLButtonElement;
    const none = screen.getByRole("button", { name: "Select none" }) as HTMLButtonElement;
    expect(all.disabled).toBe(true);
    await user.click(none);
    expect(none.disabled).toBe(true);
    expect(all.disabled).toBe(false);
    expect(screen.getByText("Select at least one page to download.")).toBeTruthy();
    expect(screen.getByText("0 pages")).toBeTruthy();
    expect(downloadButton().disabled).toBe(true);
    await user.click(all);
    expect(screen.getByText("3 pages")).toBeTruthy();
    expect(downloadButton().disabled).toBe(false);
  });

  it("says that several pages of a picture format come in a zip, and several of a video play one after another", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(3));
    expect(screen.getByText("Every page in this design - saved together as a .zip")).toBeTruthy();
    await choose(user, /^Animated GIF/);
    expect(screen.getByText("Every page in this design - played one after another")).toBeTruthy();
  });

  it("keeps a choice of pages that no longer exists in range", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(3));
    await user.click(radio("Pages to download", "Custom"));
    await user.click(within(screen.getByRole("group", { name: "Pages to download" })).getByRole("checkbox", { name: "Page 3" }));
    act(() => {
      const state = useEditor.getState();
      const design = state.design!;
      useEditor.setState({ design: { ...design, pages: design.pages.slice(0, 2) } });
    });
    expect(screen.getByText("2 pages")).toBeTruthy();
  });
});

describe("<DownloadPanel> animated formats", () => {
  it("shows the size and length of an animation and the choices for it", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(3));
    await choose(user, /^Animated GIF/);
    expect(radio("Resolution", "720p").getAttribute("aria-checked")).toBe("true");
    expect(radio("Frame rate", "15 fps").getAttribute("aria-checked")).toBe("true");
    expect(screen.getByText("960 × 720 px")).toBeTruthy();
    await user.click(radio("Resolution", "480p"));
    expect(screen.getByText("640 × 480 px")).toBeTruthy();
    await user.click(radio("Frame rate", "20 fps"));
    expect(stored()).toMatchObject({ format: "gif", resolution: 480, gifFps: 20 });
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/· \d+ s$/);
  });

  it("says that nothing moves when no page is animated", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(2));
    await choose(user, /^Animated GIF/);
    expect(screen.getByText("Nothing is animated yet - use Animate on the toolbar")).toBeTruthy();
  });

  it("does not say so when there is a transition between pages", async () => {
    const user = userEvent.setup();
    const design = designOf(2);
    design.pages[1] = { ...design.pages[1], transition: { kind: "dissolve", duration: 0.5 } };
    mountPanel(design);
    await choose(user, /^Animated GIF/);
    expect(screen.queryByText(/Nothing is animated yet/)).toBeNull();
  });

  it("explains why an animation is too long for a GIF, and will not start it", async () => {
    const user = userEvent.setup();
    const design = designOf(4);
    design.pages = design.pages.map((page) => ({ ...page, duration: 60 }));
    store({ format: "gif", gifFps: 20 });
    mountPanel(design);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("This animation is too long to save as a GIF. Choose fewer pages or a lower frame rate.");
    expect(downloadButton().disabled).toBe(true);
    await user.click(downloadButton());
    expect(exportDesign).not.toHaveBeenCalled();
    // fewer frames: no longer too long, but still too much to draw at this size; a smaller picture makes it possible
    await user.click(radio("Frame rate", "10 fps"));
    expect(screen.getByRole("alert").textContent).toMatch(/^This animation is too large to save as a GIF at this size/);
    await user.click(radio("Resolution", "480p"));
    expect(screen.queryByRole("alert")).toBeNull();
    expect(downloadButton().disabled).toBe(false);
  });

  it("explains why an animation is too large for a GIF at this size", () => {
    const design = designOf(3);
    design.pages = design.pages.map((page) => ({ ...page, duration: 60 }));
    store({ format: "gif", gifFps: 20 });
    mountPanel(design);
    expect(screen.getByRole("alert").textContent).toBe("This animation is too large to save as a GIF at this size. Try a lower resolution or frame rate, or fewer pages.");
  });

  it("warns that a GIF of many megabytes is more than many sites accept", async () => {
    const design = designOf(6, { width: 1920, height: 1080 });
    design.pages = design.pages.map((page, i) => ({
      ...page,
      duration: 5,
      background: {
        type: "linear",
        angle: 45,
        stops: [
          { offset: 0, color: "#ff0000" },
          { offset: 1, color: "#0000ff" },
        ],
      },
      ...(i ? { transition: { kind: "push", duration: 1 } } : {}),
    }));
    store({ format: "gif", resolution: 1080, gifFps: 20 });
    const options = toExportOptions({ ...DEFAULT_DOWNLOAD_SETTINGS, format: "gif", resolution: 1080, gifFps: 20 }, [0, 1, 2, 3, 4, 5]);
    expect(estimateExportBytes(design, options)).toBeGreaterThan(15 * MB);
    expect(resolveExportOptions(design, options).animation).not.toBeNull();
    mountPanel(design);
    expect(screen.getByText(/Many sites accept GIFs of about 15 MB at most/)).toBeTruthy();
  });

  it("falls back on a picture format when a video was chosen in a browser that could record one", () => {
    store({ format: "webm" });
    mountPanel();
    expect(fileType().textContent).toContain("PNG");
  });
});

describe("<DownloadPanel> remembering", () => {
  it("keeps what it was last set to", () => {
    store({ format: "jpg", scale: 2, quality: 0.5, pagesMode: "current" });
    mountPanel();
    expect(fileType().textContent).toContain("JPG");
    expect(slider("Size").getAttribute("aria-valuetext")).toBe("×2 · 800 × 600 px");
    expect(slider("Quality").getAttribute("aria-valuetext")).toBe("50%");
    expect(radio("Pages to download", "Current page").getAttribute("aria-checked")).toBe("true");
  });

  it("saves the settings as soon as the panel opens, and every change after that", async () => {
    const user = userEvent.setup();
    mountPanel();
    expect(stored()).toEqual(DEFAULT_DOWNLOAD_SETTINGS);
    await choose(user, /^JPG/);
    expect(stored().format).toBe("jpg");
    fireEvent.keyDown(slider("Size"), { key: "ArrowRight" });
    expect(stored()).toMatchObject({ format: "jpg", scale: 1.25 });
    await user.click(radio("Pages to download", "Current page"));
    expect(stored()).toMatchObject({ pagesMode: "current", scale: 1.25 });
  });

  it("starts from the defaults when what was saved is damaged", () => {
    window.localStorage.setItem(DOWNLOAD_SETTINGS_KEY, "{not json");
    mountPanel();
    expect(fileType().textContent).toContain("PNG");
    expect(slider("Size").getAttribute("aria-valuetext")).toBe("×1 · 400 × 300 px");
  });

  it("starts from the defaults when the browser will not hand over what was saved", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("storage is blocked");
    });
    mountPanel();
    expect(fileType().textContent).toContain("PNG");
  });

  it("works when the browser will not save anything", async () => {
    const user = userEvent.setup();
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota");
    });
    mountPanel();
    await choose(user, /^JPG/);
    expect(fileType().textContent).toContain("JPG");
  });
});

describe("<DownloadPanel> downloading", () => {
  it("exports the chosen pages with the chosen settings and hands the file to the browser", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    mountPanel(designOf(3), { onDone });
    const result = file("Menu.zip");
    vi.mocked(exportDesign).mockResolvedValueOnce(result);
    await user.click(downloadButton());
    const [calledDesign, options] = vi.mocked(exportDesign).mock.calls[0];
    expect(calledDesign).toBe(useEditor.getState().design);
    expect(options).toEqual({ format: "png", pages: [0, 1, 2], scale: 1, quality: 0.92, transparent: false, pdfMode: "standard", embedFonts: true });
    expect(downloadBlob).toHaveBeenCalledWith(result.blob, "Menu.zip");
    expect(toast.show).toHaveBeenCalledWith({ kind: "success", message: "Downloaded Menu.zip" });
    expect(onDone).toHaveBeenCalledTimes(1);
    // ready to go again
    expect(downloadButton().disabled).toBe(false);
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("passes on the things worth telling about the file", async () => {
    const user = userEvent.setup();
    mountPanel();
    vi.mocked(exportDesign).mockResolvedValueOnce(file("Menu.zip", "One image could not be embedded."));
    await user.click(downloadButton());
    expect(toast.show).toHaveBeenCalledWith({ kind: "info", message: "One image could not be embedded.", duration: 9000 });
  });

  it("works without anyone waiting for it to finish", async () => {
    const user = userEvent.setup();
    mountPanel();
    vi.mocked(exportDesign).mockResolvedValueOnce(file());
    await expect(user.click(downloadButton())).resolves.toBeUndefined();
    expect(downloadBlob).toHaveBeenCalledTimes(1);
  });

  it("shows how far a download has got, and locks the choices while it runs", async () => {
    const user = userEvent.setup();
    mountPanel();
    const control = controlledExport();
    await user.click(downloadButton());
    const bar = screen.getByRole("progressbar", { name: "Download progress" });
    expect(bar.getAttribute("aria-valuenow")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("3");
    expect(screen.getByRole("status").textContent).toBe("Preparing page 1 of 3…");
    expect((bar.firstElementChild as HTMLElement).style.width).toBe("6%");
    expect((fileType() as HTMLButtonElement).disabled).toBe(true);
    expect(downloadButton().getAttribute("aria-busy")).toBe("true");
    expect(slider("Size").getAttribute("aria-disabled")).toBe("true");
    expect((screen.getByRole("switch", { name: "Transparent background" }) as HTMLInputElement).disabled).toBe(true);

    act(() => control.report(1, 3));
    expect(screen.getByRole("status").textContent).toBe("Preparing page 2 of 3…");
    expect(screen.getByRole("progressbar").getAttribute("aria-valuenow")).toBe("1");
    expect((screen.getByRole("progressbar").firstElementChild as HTMLElement).style.width).toMatch(/^33\.3/);

    act(() => control.report(3, 3));
    expect(screen.getByRole("status").textContent).toBe("Finishing up…");

    await act(async () => control.resolve(file()));
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says it is preparing the download, not a page, when there is one page", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(1));
    controlledExport();
    await user.click(downloadButton());
    expect(screen.getByRole("status").textContent).toBe("Preparing your download…");
  });

  it("counts the frames of a GIF as they are rendered", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choose(user, /^Animated GIF/);
    const control = controlledExport();
    await user.click(downloadButton());
    expect(screen.getByRole("status").textContent).toBe("Preparing your download…");
    act(() => control.report(4, 45));
    expect(screen.getByRole("status").textContent).toBe("Rendering frame 5 of 45…");
  });

  it("does not start a second download while one is running, however fast it is clicked", async () => {
    mountPanel();
    controlledExport();
    const button = downloadButton();
    await act(async () => {
      fireEvent.click(button);
      fireEvent.click(button);
    });
    expect(exportDesign).toHaveBeenCalledTimes(1);
  });

  it("stops the download when Cancel is pressed, and says so", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    mountPanel(designOf(), { onDone });
    const control = controlledExport();
    await user.click(downloadButton());
    expect(control.signal?.aborted).toBe(false);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(control.signal?.aborted).toBe(true);
    await act(async () => control.reject(new ExportError("cancelled", "The download was cancelled.")));
    expect(toast.show).toHaveBeenCalledWith({ kind: "info", message: "Download cancelled" });
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(onDone).not.toHaveBeenCalled();
    expect(screen.queryByRole("progressbar")).toBeNull();
  });

  it("says what went wrong, in words a person can use, when the export fails", async () => {
    const user = userEvent.setup();
    store({ scale: 2 });
    mountPanel();
    vi.mocked(exportDesign).mockRejectedValueOnce(new ExportError("too-large", "This design is too large to export."));
    await user.click(downloadButton());
    expect(toast.show).toHaveBeenCalledWith({ kind: "error", message: "This design is too large to export at 2x - try a smaller size." });
    expect(console.error).toHaveBeenCalledWith("Export failed", expect.any(ExportError));
    expect(downloadBlob).not.toHaveBeenCalled();
    // the panel is usable again
    expect(downloadButton().disabled).toBe(false);
  });

  it("leaves the size out of the message for a format that has none", async () => {
    const user = userEvent.setup();
    store({ format: "pdf", scale: 3 });
    mountPanel();
    vi.mocked(exportDesign).mockRejectedValueOnce(new ExportError("too-large", "This design is too large to export. Try fewer pages."));
    await user.click(downloadButton());
    expect(toast.show).toHaveBeenCalledWith({ kind: "error", message: "This design is too large to export. Try fewer pages." });
  });

  it("gives a general message for anything it does not know", async () => {
    const user = userEvent.setup();
    mountPanel();
    vi.mocked(exportDesign).mockRejectedValueOnce(new Error("boom"));
    await user.click(downloadButton());
    expect(toast.show).toHaveBeenCalledWith({ kind: "error", message: "Something went wrong while preparing the download. Please try again." });
  });

  it("finishes the download even if the panel was closed meanwhile, without touching what is gone", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    const view = mountPanel(designOf(), { onDone });
    const control = controlledExport();
    await user.click(downloadButton());
    view.unmount();
    await act(async () => control.resolve(file("Late.zip")));
    expect(downloadBlob).toHaveBeenCalledWith(expect.anything(), "Late.zip");
    expect(toast.show).toHaveBeenCalledWith({ kind: "success", message: "Downloaded Late.zip" });
    // nobody to tell
    expect(onDone).not.toHaveBeenCalled();
  });

  it("does not report progress to a panel that is gone", async () => {
    const user = userEvent.setup();
    const view = mountPanel();
    const control = controlledExport();
    await user.click(downloadButton());
    view.unmount();
    expect(() => control.report(1, 3)).not.toThrow();
    await act(async () => control.reject(new ExportError("cancelled", "The download was cancelled.")));
    expect(toast.show).toHaveBeenCalledWith({ kind: "info", message: "Download cancelled" });
  });
});
