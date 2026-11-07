import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createPage, createShape, solid } from "@/core/factory";
import { useEditor } from "@/core/store";
import { resetEditor } from "@/test/helpers";
import { toast } from "@/ui";
import { DownloadPanel } from "./DownloadPanel";
import { downloadBlob, exportDesign, type ExportFile } from "./exporters";
import { DEFAULT_DOWNLOAD_SETTINGS, DOWNLOAD_SETTINGS_KEY } from "./settings";

// A browser that can record video. (The panel looks this up once per page, so this file has its own copy of the panel.)
vi.mock("./animated/video", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./animated/video")>();
  return { ...actual, detectVideoSupport: () => ({ ok: true, mimeType: "video/webm;codecs=vp9", reason: null }) };
});
vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn(), downloadBlob: vi.fn() };
});

function mountPanel() {
  resetEditor();
  const design = createDesign({
    title: "Reel",
    width: 400,
    height: 300,
    pages: [0, 1].map(() => createPage({ background: solid("#ffffff"), elements: [createShape("rect", { x: 10, y: 10, width: 40, height: 40 })] })),
  });
  useEditor.getState().actions.openDesign(design);
  return render(<DownloadPanel />);
}

const store = (patch: Record<string, unknown>) => window.localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_DOWNLOAD_SETTINGS, ...patch }));
const stored = () => JSON.parse(window.localStorage.getItem(DOWNLOAD_SETTINGS_KEY) ?? "null");
const fileType = () => screen.getByRole("combobox", { name: "File type" });
const downloadButton = () => screen.getByRole("button", { name: /^Download/ }) as HTMLButtonElement;

function controlledExport() {
  const control = { report: (_done: number, _total: number) => undefined as void, resolve: (_file: ExportFile) => undefined as void };
  vi.mocked(exportDesign).mockImplementationOnce((_design, _options, onProgress) => {
    control.report = (done, total) => onProgress?.(done, total);
    return new Promise<ExportFile>((resolve) => {
      control.resolve = resolve;
    });
  });
  return control;
}

beforeEach(() => {
  vi.mocked(exportDesign).mockReset();
  vi.mocked(downloadBlob).mockReset();
  vi.spyOn(toast, "show").mockImplementation(() => 0);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetEditor();
});

describe("<DownloadPanel> in a browser that can record video", () => {
  it("offers the video and keeps it chosen", () => {
    store({ format: "webm" });
    mountPanel();
    expect(fileType().textContent).toContain("Video (WebM)");
  });

  it("lets a video be chosen, with a resolution and a frame rate that is not a choice", async () => {
    const user = userEvent.setup();
    mountPanel();
    await user.click(fileType());
    const option = screen.getByRole("option", { name: /Video \(WebM\)/ });
    expect(option.getAttribute("aria-disabled")).not.toBe("true");
    expect(option.textContent).toContain("Smooth, small files");
    await user.click(option);
    expect(stored().format).toBe("webm");
    expect(
      within(screen.getByRole("radiogroup", { name: "Resolution" }))
        .getByRole("radio", { name: "720p" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // a video is always recorded at 30 frames a second: said, not asked
    expect(screen.queryByRole("radiogroup", { name: "Frame rate" })).toBeNull();
    expect(screen.getByText("30 fps")).toBeTruthy();
    expect(screen.getByText(/Recorded as it plays, so it takes as long as the animation/)).toBeTruthy();
    expect(screen.getByText("Every page in this design - played one after another")).toBeTruthy();
  });

  it("records the pages at the resolution chosen", async () => {
    const user = userEvent.setup();
    store({ format: "webm", resolution: 480 });
    mountPanel();
    vi.mocked(exportDesign).mockResolvedValueOnce({ name: "Reel.webm", blob: new Blob(["v"]) });
    await user.click(downloadButton());
    expect(vi.mocked(exportDesign).mock.calls[0][1]).toMatchObject({ format: "webm", pages: [0, 1], resolution: 480, fps: 30 });
    expect(downloadBlob).toHaveBeenCalledWith(expect.anything(), "Reel.webm");
  });

  it("tells how many seconds have been recorded", async () => {
    const user = userEvent.setup();
    store({ format: "webm" });
    mountPanel();
    const control = controlledExport();
    await user.click(downloadButton());
    // before anything is reported: two pages
    expect(screen.getByRole("status").textContent).toMatch(/^Recording 0 s of \d+ s…$/);
    act(() => control.report(45, 90));
    expect(screen.getByRole("status").textContent).toBe("Recording 1 s of 3 s…");
    act(() => control.report(90, 90));
    expect(screen.getByRole("status").textContent).toBe("Finishing up…");
  });

  it("warns that recording pauses in a background tab, and stops warning when the tab comes back", async () => {
    const user = userEvent.setup();
    store({ format: "webm" });
    mountPanel();
    const control = controlledExport();
    await user.click(downloadButton());
    expect(screen.getByRole("status").textContent).toMatch(/^Recording /);

    const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("status").textContent).toBe("Recording pauses while this tab is in the background. Switch back to keep going.");
    hidden.mockReturnValue(false);
    act(() => void document.dispatchEvent(new Event("visibilitychange")));
    expect(screen.getByRole("status").textContent).toMatch(/^Recording /);
    act(() => control.report(30, 60));
    expect(screen.getByRole("status").textContent).toBe("Recording 1 s of 2 s…");
  });

  it("starts with the warning if the tab was already in the background when recording began", async () => {
    const user = userEvent.setup();
    store({ format: "webm" });
    mountPanel();
    controlledExport();
    vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    await user.click(downloadButton());
    expect(screen.getByRole("status").textContent).toMatch(/^Recording pauses/);
  });

  it("does not listen to the tab while nothing is recording", () => {
    store({ format: "webm" });
    const add = vi.spyOn(document, "addEventListener");
    mountPanel();
    expect(add.mock.calls.some((call) => call[0] === "visibilitychange")).toBe(false);
    fireEvent(document, new Event("visibilitychange"));
    expect(screen.queryByRole("status")).toBeNull();
  });
});
