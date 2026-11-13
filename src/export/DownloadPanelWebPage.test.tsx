import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDesign, createImage, createPage, solid } from "@/core/factory";
import { useEditor } from "@/core/store";
import type { Design } from "@/core/types";
import { resetEditor } from "@/test/helpers";
import { toast } from "@/ui";
import { DownloadPanel } from "./DownloadPanel";
import { ExportError } from "./errors";
import { downloadBlob, exportDesign, type ExportFile } from "./exporters";
import { DEFAULT_DOWNLOAD_SETTINGS, DOWNLOAD_SETTINGS_KEY } from "./settings";

// The painter of one page is replaced; the web page itself (webPageExport.ts, webPage.ts) is the real one.
vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn(), downloadBlob: vi.fn() };
});

function designOf(pageCount = 3, title = "Menu"): Design {
  const pages = Array.from({ length: pageCount }, (_v, i) => {
    const page = createPage({ background: solid("#ffffff"), elements: [createImage({ src: "a.png", alt: `Picture ${i + 1}` })] });
    page.notes = `Secret note ${i + 1}`;
    return page;
  });
  return createDesign({ title, width: 400, height: 300, pages });
}

function mountPanel(design: Design = designOf(), props: { onDone?: () => void } = {}) {
  resetEditor();
  useEditor.getState().actions.openDesign(design);
  return render(<DownloadPanel {...props} />);
}

const fileType = () => screen.getByRole("combobox", { name: "File type" });
const downloadButton = () => screen.getByRole("button", { name: /^Download/ }) as HTMLButtonElement;
const notesSwitch = () => screen.getByRole("switch", { name: "Include speaker notes" }) as HTMLInputElement;
const picture = (): ExportFile => ({ name: "page.jpg", blob: new Blob(["jpeg"], { type: "image/jpeg" }) });

async function chooseWebPage(user: ReturnType<typeof userEvent.setup>) {
  await user.click(fileType());
  await user.click(screen.getByRole("option", { name: /^Web page/ }));
}

/** The file that was handed to the browser, parsed. */
async function downloaded() {
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
  const text = await blob.text();
  return { name, text, doc: new DOMParser().parseFromString(text, "text/html") };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(exportDesign).mockReset();
  vi.mocked(exportDesign).mockImplementation(async () => picture());
  vi.mocked(downloadBlob).mockReset();
  vi.spyOn(toast, "show").mockImplementation(() => 0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetEditor();
  document.documentElement.removeAttribute("lang");
});

describe("<DownloadPanel> web page", () => {
  it("says what the file is and what it leaves behind, and keeps the notes out to begin with", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseWebPage(user);
    expect(fileType().textContent).toContain("Web page (HTML)");
    expect(screen.getByText(/One \.html file that shows the pages as a slideshow in any browser/)).toBeTruthy();
    expect(screen.getByText(/Animations, transitions and links are not carried over/)).toBeTruthy();
    expect(notesSwitch().checked).toBe(false);
    expect(screen.queryByRole("slider", { name: "Size" })).toBeNull();
    expect(screen.queryByText(/saved together as a \.zip/)).toBeNull();
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/^Estimated size ~\d+(\.\d)? (KB|MB)$/);
    // it is not a format that is remembered: the next visit starts where the last ordinary download was
    expect(JSON.parse(window.localStorage.getItem(DOWNLOAD_SETTINGS_KEY) ?? "{}").format).toBe(DEFAULT_DOWNLOAD_SETTINGS.format);
  });

  it("downloads one .html file with the chosen pages, their alt texts, the title and the language of the app, and no notes", async () => {
    document.documentElement.lang = "en-GB";
    const user = userEvent.setup();
    const onDone = vi.fn();
    mountPanel(designOf(), { onDone });
    await chooseWebPage(user);
    await user.click(downloadButton());
    const file = await downloaded();
    expect(file.name).toBe("Menu.html");
    expect(file.doc.title).toBe("Menu");
    expect(file.doc.documentElement.lang).toBe("en-GB");
    expect([...file.doc.querySelectorAll("img")].map((i) => i.getAttribute("alt"))).toEqual(["Picture 1", "Picture 2", "Picture 3"]);
    expect(file.text).not.toContain("Secret");
    expect(exportDesign).toHaveBeenCalledTimes(3);
    expect(vi.mocked(exportDesign).mock.calls[1][1]).toMatchObject({ format: "jpg", pages: [1] });
    expect(toast.show).toHaveBeenCalledWith({ kind: "success", message: "Downloaded Menu.html" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("writes the notes into the file when that is asked for, and only then", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseWebPage(user);
    await user.click(notesSwitch());
    expect(screen.getByText(/Everyone who gets the file can read them/)).toBeTruthy();
    await user.click(downloadButton());
    const file = await downloaded();
    expect([...file.doc.querySelectorAll(".notes p")].map((p) => p.textContent)).toEqual(["Secret note 1", "Secret note 2", "Secret note 3"]);
  });

  it("makes a page of the pages that are chosen", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseWebPage(user);
    await user.click(screen.getByRole("radio", { name: "Current page" }));
    await user.click(downloadButton());
    const file = await downloaded();
    expect(file.doc.querySelectorAll("img")).toHaveLength(1);
  });

  it("keeps a hostile title as text", async () => {
    const user = userEvent.setup();
    mountPanel(designOf(1, "</title><script>window.hacked = 1</script>"));
    await chooseWebPage(user);
    await user.click(downloadButton());
    const file = await downloaded();
    expect(file.doc.title).toBe("</title><script>window.hacked = 1</script>");
    expect(file.doc.querySelectorAll("script")).toHaveLength(1);
  });

  it("shows which page it is painting, and stops when Cancel is pressed", async () => {
    const user = userEvent.setup();
    mountPanel();
    await chooseWebPage(user);
    let finishFirst: (file: ExportFile) => void = () => undefined;
    vi.mocked(exportDesign).mockImplementationOnce(() => new Promise<ExportFile>((resolve) => (finishFirst = resolve)));
    await user.click(downloadButton());
    expect(screen.getByRole("status").textContent).toBe("Preparing page 1 of 3…");
    expect(notesSwitch().disabled).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await act(async () => finishFirst(picture()));
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "info", message: "Download cancelled" }));
    expect(downloadBlob).not.toHaveBeenCalled();
    expect(exportDesign).toHaveBeenCalledTimes(1);
  });

  it("says in plain words when a page could not be painted", async () => {
    window.localStorage.setItem(DOWNLOAD_SETTINGS_KEY, JSON.stringify({ ...DEFAULT_DOWNLOAD_SETTINGS, scale: 4 }));
    const user = userEvent.setup();
    mountPanel();
    await chooseWebPage(user);
    vi.mocked(exportDesign).mockRejectedValueOnce(new ExportError("too-large", "This design is too large to export at this size - try a smaller size."));
    await user.click(downloadButton());
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "error", message: "This design is too large to export at this size - try a smaller size." }));
  });
});
