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
import { EMU_PER_PX } from "./pptx";
import { PPTX_MIME, exportPptx, pptxOptions } from "./pptxExport";
import { DEFAULT_DOWNLOAD_SETTINGS, DOWNLOAD_SETTINGS_KEY } from "./settings";
import { openZip } from "./zipRead";

// The painter of one page is replaced; the presentation itself (pptxExport.ts, pptx.ts) and the ZIP are the real ones.
vi.mock("./exporters", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./exporters")>();
  return { ...actual, exportDesign: vi.fn(), downloadBlob: vi.fn() };
});

function designOf(pageCount = 3, title = "Pitch"): Design {
  const pages = Array.from({ length: pageCount }, (_v, i) => {
    const page = createPage({ name: `Part ${i + 1}`, background: solid("#ffffff"), elements: [createImage({ src: "a.png", alt: `Picture ${i + 1}` })] });
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
const picture = (text = "jpeg"): ExportFile => ({ name: "page.jpg", blob: new Blob([text], { type: "image/jpeg" }) });

async function choosePowerPoint(user: ReturnType<typeof userEvent.setup>) {
  await user.click(fileType());
  await user.click(screen.getByRole("option", { name: /^PowerPoint/ }));
}

/** The file that was handed to the browser, opened as the ZIP it is. */
async function downloaded() {
  await waitFor(() => expect(downloadBlob).toHaveBeenCalledTimes(1));
  const [blob, name] = vi.mocked(downloadBlob).mock.calls[0];
  const zip = await openZip(blob);
  const names = zip.entries.map((e) => e.name);
  const text = async (part: string) => {
    const entry = zip.find(part);
    return entry ? zip.text(entry) : "";
  };
  return { name, blob, names, text };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.mocked(exportDesign).mockReset();
  vi.mocked(exportDesign).mockImplementation(async (_design, opts) => picture(`jpeg of page ${opts.pages[0] + 1}`));
  vi.mocked(downloadBlob).mockReset();
  vi.spyOn(toast, "show").mockImplementation(() => 0);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  resetEditor();
});

describe("<DownloadPanel> PowerPoint", () => {
  it("says what the file is and what it leaves behind, and keeps the notes out to begin with", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choosePowerPoint(user);
    expect(fileType().textContent).toContain("PowerPoint (PPTX)");
    expect(screen.getByText(/One \.pptx file with a slide for every page/)).toBeTruthy();
    expect(screen.getByText(/editable PowerPoint objects/)).toBeTruthy();
    expect(notesSwitch().checked).toBe(false);
    expect(screen.getByText("Notes are private and stay out of the file.")).toBeTruthy();
    expect(screen.queryByRole("slider", { name: "Size" })).toBeNull();
    expect(screen.getByText(/Estimated size/).textContent).toMatch(/^Estimated size ~\d+(\.\d)? (KB|MB)$/);
    // it is not a format that is remembered: the next visit starts where the last ordinary download was
    expect(JSON.parse(window.localStorage.getItem(DOWNLOAD_SETTINGS_KEY) ?? "{}").format).toBe(DEFAULT_DOWNLOAD_SETTINGS.format);
  });

  it("downloads one .pptx file with a slide and a picture for every page, the title and the names, and no notes", async () => {
    const user = userEvent.setup();
    const onDone = vi.fn();
    mountPanel(designOf(), { onDone });
    await choosePowerPoint(user);
    await user.click(downloadButton());
    const file = await downloaded();
    expect(file.name).toBe("Pitch.pptx");
    expect(file.blob.type).toBe(PPTX_MIME);
    expect(file.names[0]).toBe("[Content_Types].xml");
    expect(file.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toEqual(["ppt/slides/slide1.xml", "ppt/slides/slide2.xml", "ppt/slides/slide3.xml"]);
    expect(file.names.filter((n) => n.startsWith("ppt/media/"))).toEqual(["ppt/media/image1.jpeg", "ppt/media/image2.jpeg", "ppt/media/image3.jpeg"]);
    expect(await file.text("ppt/media/image2.jpeg")).toBe("jpeg of page 2");
    expect(await file.text("docProps/core.xml")).toContain("<dc:title>Pitch</dc:title>");
    expect(await file.text("ppt/presentation.xml")).toContain(`<p:sldSz cx="${400 * EMU_PER_PX}" cy="${300 * EMU_PER_PX}"/>`);
    const second = await file.text("ppt/slides/slide2.xml");
    expect(second).toContain('<p:cSld name="Part 2">');
    expect(second).toContain('descr="Picture 2"');
    expect(file.names.some((n) => n.includes("notes"))).toBe(false);
    expect(exportDesign).toHaveBeenCalledTimes(3);
    // a small design is painted at twice its size
    expect(vi.mocked(exportDesign).mock.calls[1][1]).toMatchObject({ format: "jpg", pages: [1], scale: 2 });
    expect(toast.show).toHaveBeenCalledWith({ kind: "success", message: "Downloaded Pitch.pptx" });
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("writes the notes into the file when that is asked for, and only then", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choosePowerPoint(user);
    await user.click(notesSwitch());
    expect(screen.getByText(/written as the speaker notes of each slide/)).toBeTruthy();
    await user.click(downloadButton());
    const file = await downloaded();
    expect(await file.text("ppt/notesSlides/notesSlide3.xml")).toContain("<a:t>Secret note 3</a:t>");
    expect(file.names).toContain("ppt/notesMasters/notesMaster1.xml");
  });

  it("makes slides of the pages that are chosen", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choosePowerPoint(user);
    await user.click(screen.getByRole("radio", { name: "Current page" }));
    await user.click(downloadButton());
    const file = await downloaded();
    expect(file.names.filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))).toEqual(["ppt/slides/slide1.xml"]);
  });

  it("shows which page it is painting, and stops when Cancel is pressed", async () => {
    const user = userEvent.setup();
    mountPanel();
    await choosePowerPoint(user);
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
    const user = userEvent.setup();
    mountPanel();
    await choosePowerPoint(user);
    vi.mocked(exportDesign).mockRejectedValueOnce(new ExportError("too-large", "This design is too large to export at this size - try a smaller size."));
    await user.click(downloadButton());
    await waitFor(() => expect(toast.show).toHaveBeenCalledWith({ kind: "error", message: "This design is too large to export at this size - try a smaller size." }));
  });
});

describe("exportPptx", () => {
  it("refuses when no page is chosen", async () => {
    await expect(exportPptx(designOf(), { pages: [], notes: false })).rejects.toMatchObject({ code: "no-pages" });
    await expect(exportPptx(designOf(2), { pages: [7], notes: false })).rejects.toMatchObject({ code: "no-pages" });
  });

  it("counts the pages as they are painted and passes on what the painter had to say", async () => {
    vi.mocked(exportDesign).mockImplementation(async () => ({ ...picture(), note: "The size was reduced." }));
    const seen: Array<[number, number]> = [];
    const file = await exportPptx(designOf(2), { pages: [0, 1], notes: false }, (done, total) => seen.push([done, total]));
    expect(seen).toEqual([[0, 2], [1, 2], [2, 2]]); // prettier-ignore
    expect(file.note).toBe("The size was reduced.");
    expect(file.name).toBe("Pitch.pptx");
  });

  it("stops before it paints when it was cancelled already", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(exportPptx(designOf(), { pages: [0], notes: false }, undefined, controller.signal)).rejects.toMatchObject({ code: "cancelled" });
    expect(exportDesign).not.toHaveBeenCalled();
  });

  it("paints a large design at the size that makes its longer side 2,560 pixels", () => {
    expect(pptxOptions({ width: 5120, height: 2880 }, 4)).toMatchObject({ format: "jpg", pages: [4], scale: 0.5 });
    expect(pptxOptions({ width: 400, height: 300 }, 0).scale).toBe(2);
  });
});
